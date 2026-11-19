"""已有环境登记及固定版本检测；不安装依赖，不取得产品凭据。"""

import asyncio
import hashlib
import json
import os
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from pydantic import ValidationError

from flowmate.contracts.base import CommandMeta, DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.persistence.store import Store, UnitOfWork
from flowmate.processes.contracts import (
    DependencyEvidence,
    EnvironmentChanged,
    EnvironmentProbe,
    ExecutionEnvironment,
    ExecutionEnvironmentCommandStatus,
    ExecutionEnvironmentView,
    FileEvidence,
    ProcessSpec,
    SaveExecutionEnvironment,
)
from flowmate.processes.runner import ProcessRunner

PROBE_TIMEOUT_SECONDS = 10
PROBE_OUTPUT_LIMIT = 16 * 1024
MINIMUM_HOST_ENV = ("SYSTEMROOT", "WINDIR", "TEMP", "TMP")
VERSION_ARGUMENTS = {
    "python": ("--version",),
    "node": ("--version",),
    "powershell": ("-NoLogo", "-NoProfile", "-NonInteractive", "-Version"),
    "bash": ("--version",),
}
VERSION_PATTERNS = {
    "python": re.compile(r"Python ([0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*)"),
    "node": re.compile(r"v([0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*)"),
    "powershell": re.compile(r"PowerShell ([0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*)"),
    "bash": re.compile(r"GNU bash, version ([0-9][0-9A-Za-z.()+-]*) \([^)]+\)"),
}
SECRET_VARIABLE = re.compile(
    r"(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|API_?KEY|PRIVATE_?KEY)(?:$|_)"
)


def _minimum_env() -> dict[str, str]:
    return {key: os.environ[key] for key in MINIMUM_HOST_ENV if key in os.environ}


def _file_evidence(path: Path) -> FileEvidence:
    try:
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
    except FileNotFoundError:
        digest = None
    return FileEvidence(path=str(path), sha256=digest)


def _observe(environment) -> tuple[str | None, DependencyEvidence, bool]:
    """只读取选定解释器、标准 venv 元数据和显式选定清单的文件内容摘要。"""
    executable = Path(environment.executable_path)
    selected = _file_evidence(executable)
    manifests = [_file_evidence(Path(path)) for path in environment.dependency_manifest_paths]
    config = None
    base = None
    if environment.kind == "python":
        # 与 CPython 的两处 pyvenv.cfg 入口相同；不 resolve/替换用户的启动路径。
        for path in (executable.parent / "pyvenv.cfg", executable.parent.parent / "pyvenv.cfg"):
            if path.is_file():
                config = _file_evidence(path)
                home = None
                for line in path.read_text(encoding="utf-8").splitlines():
                    key, separator, value = line.partition("=")
                    if separator and key.strip().lower() == "home":
                        home = Path(value.strip())
                        break
                if home is None or not home.is_absolute():
                    raise DomainError("environment_venv_invalid", "venv 的 home 配置无效")
                filename = "pythonw.exe" if executable.name.lower() == "pythonw.exe" else "python.exe"
                base = _file_evidence(home / filename)
                break
    evidence = DependencyEvidence(
        coverage="manifests_only" if manifests else "unverified",
        manifests=manifests, venv_config=config, base_executable=base,
    )
    identity = None
    if selected.sha256 is not None:
        identity = hashlib.sha256(json.dumps({
            "path": os.path.normcase(str(executable)), "sha256": selected.sha256,
            "venv_config": config.model_dump() if config else None,
            "base_executable": base.model_dump() if base else None,
        }, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    missing = selected.sha256 is None or (base is not None and base.sha256 is None)
    return identity, evidence, missing


def _difference(environment, observation):
    identity, evidence, missing = observation
    if missing:
        return "missing_executable", "executable_missing"
    if identity != environment.executable_identity:
        return "identity_changed", "identity_changed"
    if evidence != environment.dependency_evidence:
        return "dependency_changed", "dependency_changed"
    if environment.status in {"identity_changed", "dependency_changed"}:
        return environment.status, environment.status
    return None, None


class EnvironmentService:
    def __init__(self, store: Store, runner: ProcessRunner):
        self.store = store
        self.runner = runner

    @staticmethod
    def _get(tx: UnitOfWork, id: str) -> ExecutionEnvironment:
        row = tx.execute("SELECT document FROM execution_environments WHERE id=?", (id,)).fetchone()
        if row is None:
            raise DomainError("not_found", "运行环境不存在", related_ids=(id,))
        return ExecutionEnvironment.model_validate_json(row["document"])

    @staticmethod
    def _put(tx: UnitOfWork, environment: ExecutionEnvironment, causation_id=None) -> None:
        document = environment.model_dump_json()
        previous = tx.execute(
            "SELECT document FROM execution_environments WHERE id=?", (environment.id,),
        ).fetchone()
        if previous is not None and previous["document"] == document:
            return
        tx.execute(
            "INSERT INTO execution_environments(id,revision,kind,document) VALUES (?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,kind=excluded.kind,"
            "document=excluded.document",
            (environment.id, environment.revision, environment.kind, document),
        )
        tx.append_event(NewEvent(kind="environment.changed",
            payload=EnvironmentChanged(environment_id=environment.id), causation_id=causation_id))

    def save(self, command: SaveExecutionEnvironment, meta: CommandMeta) -> ExecutionEnvironment:
        return self._save(command, meta, public=False)

    def save_view(self, command: SaveExecutionEnvironment, meta: CommandMeta) -> ExecutionEnvironmentView:
        return self._save(command, meta, public=True)

    def _save(self, command, meta, *, public):
        command = SaveExecutionEnvironment.model_validate(command.model_dump())
        meta = CommandMeta.model_validate(meta.model_dump())
        fingerprint = hashlib.sha256(json.dumps({
            "operation": "environment.save.public" if public else "environment.save",
            "parameters": command.model_dump(mode="json"),
            "expected_version": meta.expected_version,
        }, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
        with self.store.transaction() as tx:
            previous = tx.previous_command(meta.command_id)
            if previous is not None:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict", "同一命令不能更改参数")
                model = ExecutionEnvironmentView if public else ExecutionEnvironment
                return model.model_validate_json(previous["response"])
            row = tx.execute("SELECT document FROM execution_environments WHERE id=?", (command.id,)).fetchone()
            current = ExecutionEnvironment.model_validate_json(row["document"]) if row else None
            if meta.expected_version != (current.revision if current else None):
                raise DomainError("version_conflict", "运行环境已改变，请刷新")
            manifests = command.dependency_manifest_paths
            if manifests is None:
                manifests = current.dependency_manifest_paths if current else []
            for path in (command.executable_path, *manifests):
                if not Path(path).is_absolute() or "\0" in path:
                    raise DomainError("environment_path_invalid", "请选择绝对路径")
            configured_env = command.env
            if configured_env is None:
                configured_env = current.env if current else {}
            explicit_env = {}
            for key, value in configured_env.items():
                normalized = key.upper()
                if (not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) or "\0" in value
                        or normalized.startswith("FLOWMATE_") or SECRET_VARIABLE.search(normalized)
                        or normalized == "__PYVENV_LAUNCHER__" or normalized in explicit_env):
                    raise DomainError("environment_variable_invalid", "环境变量必须是明确的非秘密配置")
                explicit_env[normalized] = value
            parameters = command.model_dump(exclude={"id"})
            parameters["env"] = explicit_env
            parameters["dependency_manifest_paths"] = manifests
            identity, evidence, missing = _observe(command.model_copy(update=parameters))
            unchanged = current is not None and (
                current.model_dump(include=set(parameters)) == parameters
                and current.executable_identity == identity
                and current.dependency_evidence == evidence
                and current.status in {"unprobed", "probed", "probe_failed"}
            )
            if unchanged:
                saved = current
            else:
                saved = ExecutionEnvironment(
                    id=command.id, revision=current.revision + 1 if current else 1,
                    **parameters, executable_identity=identity, dependency_evidence=evidence,
                    version=None, status="missing_executable" if missing else "unprobed",
                )
                self._put(tx, saved, causation_id=meta.command_id)
            result = self._view(saved) if public else saved
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)", (
                meta.command_id, fingerprint, result.model_dump_json(), None, None,
            ))
            return result

    def command_status(self, command_id: str) -> ExecutionEnvironmentCommandStatus:
        with self.store.transaction(write=False) as tx:
            row = tx.previous_command(command_id)
        if row is not None:
            try:
                result = ExecutionEnvironmentView.model_validate_json(row["response"])
            except ValidationError:
                # 此出口只核对公开环境保存命令，不读取或转投其它领域的内部回执。
                pass
            else:
                return ExecutionEnvironmentCommandStatus(status="confirmed", result=result)
        return ExecutionEnvironmentCommandStatus(status="not_found", result=None)

    def get(self, id: str, revision: int | None = None) -> ExecutionEnvironment:
        with self.store.transaction(write=False) as tx:
            environment = self._get(tx, id)
        if revision is not None and environment.revision != revision:
            raise DomainError("environment_revision_changed", "固定环境修订已改变")
        return environment

    @staticmethod
    def _view(environment: ExecutionEnvironment) -> ExecutionEnvironmentView:
        probe = environment.last_probe
        return ExecutionEnvironmentView(
            id=environment.id, revision=environment.revision, kind=environment.kind,
            executable_path=environment.executable_path,
            executable_identity=environment.executable_identity,
            version=environment.version if environment.status == "probed" else None,
            cwd_mode=environment.cwd_mode, env_keys=sorted(environment.env),
            dependency_coverage=environment.dependency_evidence.coverage,
            manifest_count=len(environment.dependency_manifest_paths), status=environment.status,
            checked_at=probe.checked_at if probe else None,
            diagnostic_code=probe.diagnostic_code if probe else None,
        )

    def get_view(self, id: str) -> ExecutionEnvironmentView:
        return self._view(self.get(id))

    def list_views(self) -> list[ExecutionEnvironmentView]:
        with self.store.transaction(write=False) as tx:
            rows = tx.execute("SELECT document FROM execution_environments ORDER BY id").fetchall()
        return [self._view(ExecutionEnvironment.model_validate_json(row["document"])) for row in rows]

    def resolve(self, id: str, revision: int) -> ExecutionEnvironment:
        """T11 派发前复核固定修订；不存在历史修订时阻塞，绝不切换环境。"""
        environment = self.get(id, revision)
        status, diagnostic = _difference(environment, _observe(environment))
        with self.store.transaction() as tx:
            current = self._get(tx, id)
            if current.revision != revision:
                raise DomainError("environment_revision_changed", "固定环境修订已改变")
            if status is not None:
                self._put(tx, current.model_copy(update={
                    "status": status,
                    "version": current.version if status == "missing_executable" else None,
                }))
        if status is not None:
            raise DomainError(f"environment_{diagnostic}", "运行环境已改变，请重新检测并确认")
        if current.status != "probed":
            raise DomainError("environment_not_probed", "请先检测并确认此环境")
        return current.model_copy(update={"env": {**_minimum_env(), **current.env}})

    async def probe(self, id: str, cancel: asyncio.Event | None = None) -> EnvironmentProbe:
        started_at = datetime.now(UTC)
        environment = self.get(id)
        observation = await asyncio.to_thread(_observe, environment)
        status, diagnostic = _difference(environment, observation)
        version = None
        observed_version = None
        exit_code = None
        if status is None:
            # 版本检测不加载用户的启动注入变量、产品变量或 PATH，不运行 Skill 自检。
            with TemporaryDirectory(prefix="environment-probe-", dir=self.store.path.parent) as cwd:
                result = await self.runner.run(ProcessSpec(
                    invocation_id=identifier(),
                    environment=environment.model_copy(update={"env": _minimum_env()}),
                    argv=list(VERSION_ARGUMENTS[environment.kind]), cwd=cwd,
                    deadline=datetime.now(UTC) + timedelta(seconds=PROBE_TIMEOUT_SECONDS),
                    stdout_limit=PROBE_OUTPUT_LIMIT, stderr_limit=PROBE_OUTPUT_LIMIT,
                ), cancel if cancel is not None else asyncio.Event())
            exit_code = result.exit_code
            status = "probe_failed"
            if result.termination_reason != "exited":
                diagnostic = f"probe_{result.termination_reason}"
            elif result.exit_code != 0:
                diagnostic = "probe_nonzero_exit"
            elif result.truncated:
                diagnostic = "probe_output_truncated"
            elif result.stderr:
                diagnostic = "probe_unexpected_stderr"
            else:
                lines = result.stdout.strip().splitlines()
                try:
                    first = lines[0].decode("ascii") if lines else ""
                except UnicodeDecodeError:
                    first = ""
                match = VERSION_PATTERNS[environment.kind].fullmatch(first)
                if match is None or (environment.kind != "bash" and len(lines) != 1):
                    diagnostic = "probe_version_invalid"
                else:
                    status, diagnostic, version = "probed", None, match.group(1)
                    observed_version = version
                    if environment.version is not None and version != environment.version:
                        status, diagnostic, version = (
                            "identity_changed", "interpreter_version_changed", None,
                        )
            observation = await asyncio.to_thread(_observe, environment)
            changed_status, changed_diagnostic = _difference(environment, observation)
            if changed_status is not None:
                status, diagnostic, version = changed_status, changed_diagnostic, None
        identity, evidence, _ = observation
        probe = EnvironmentProbe(
            environment_id=environment.id, revision=environment.revision,
            executable_identity=environment.executable_identity,
            dependency_evidence=environment.dependency_evidence,
            observed_executable_identity=identity, observed_dependency_evidence=evidence,
            version=version, observed_version=observed_version,
            started_at=started_at, checked_at=datetime.now(UTC), status=status,
            diagnostic_code=diagnostic, exit_code=exit_code,
        )
        with self.store.transaction() as tx:
            current = self._get(tx, id)
            if current.revision != environment.revision:
                return probe.model_copy(update={
                    "applied": False, "diagnostic_code": "configuration_changed",
                })
            if current.last_probe is not None and current.last_probe.started_at > started_at:
                return probe.model_copy(update={
                    "applied": False, "diagnostic_code": "probe_superseded",
                })
            if current.status in {"identity_changed", "dependency_changed"}:
                status, diagnostic, version = current.status, current.status, None
                probe = probe.model_copy(update={
                    "status": status, "diagnostic_code": diagnostic, "version": None,
                })
            self._put(tx, current.model_copy(update={
                "version": (
                    current.version if status in {"probe_failed", "missing_executable"} else version
                ),
                "status": status, "last_probe": probe,
            }))
        return probe
