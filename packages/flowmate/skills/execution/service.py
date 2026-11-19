"""固定版本脚本执行；所有代码入口和路径均来自可信服务。"""

import asyncio
import base64
import os
import shutil
import stat
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import ActivitySnapshot, Checkpoint, RunSnapshot, ScopeDependency
from flowmate.contracts.scopes import ScopeRef
from flowmate.processes.contracts import ProcessSpec
from flowmate.runtime.transitions import check_scopes, load
from flowmate.skills.execution.contracts import (
    RunSkillScript,
    ScriptArtifact,
    ScriptExecutionResult,
    ScriptLog,
    process_destination,
)
from flowmate.skills.execution.permissions import SkillExecutionPermissions
from flowmate.tools.builtin import context_dependencies
from flowmate.tools.catalog import ToolOutcome
from flowmate.tools.files import FileAnchor
from flowmate.tools.gateway import _merge_dependencies

MAX_OUTPUT_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_FILES = 200
SCRIPT_EXTENSIONS = {"python": ".py", "node": (".js", ".mjs", ".cjs"), "powershell": ".ps1", "bash": ".sh"}


def _log(data):
    try:
        return ScriptLog(encoding="utf-8", content=data.decode("utf-8"))
    except UnicodeDecodeError:
        return ScriptLog(encoding="base64", content=base64.b64encode(data).decode("ascii"))


def _ordinary(path):
    info = path.lstat()
    if (stat.S_ISLNK(info.st_mode)
            or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
            or stat.S_ISREG(info.st_mode) and info.st_nlink != 1):
        raise DomainError("script_output_link", "脚本输出不能包含链接或重解析点")
    return info


class SkillExecutionService:
    def __init__(self, skills, environments, policy, files, artifacts, scheduler):
        self.skills, self.environments = skills, environments
        self.policy, self.files, self.artifacts, self.scheduler = policy, files, artifacts, scheduler
        self.store = skills.store
        self.permissions = SkillExecutionPermissions(skills, environments)
        self.root = self.store.path.parent / "script-attempts"

    def _check(self, tx, ctx, args):
        version = self.skills.reference(ctx, args.skill_id, args.content_hash, tx=tx)
        self.permissions.require(tx, ctx, args)
        environment = self.environments.get(args.environment_id, args.environment_revision)
        if environment.status != "probed":
            raise DomainError("environment_not_probed", "环境尚未完成检测")
        script = PurePosixPath(args.script_relative_path)
        registered = {item.path: item for item in version.files}
        if (script.is_absolute() or "\\" in args.script_relative_path
                or any(part in {"", ".", ".."} for part in args.script_relative_path.split("/"))
                or len(script.parts) < 2 or script.parts[0] != "scripts"
                or args.script_relative_path not in registered
                or not str(script).endswith(SCRIPT_EXTENSIONS[environment.kind])):
            raise DomainError("skill_script_invalid", "入口须为此发布版本登记的普通脚本")
        if any("\0" in argument for argument in args.arguments) or len(set(args.input_refs)) != len(args.input_refs):
            raise DomainError("tool_arguments_invalid", "参数或输入引用无效")
        return version, environment, registered[args.script_relative_path]

    def resolve_dependencies(self, tx, ctx, args: RunSkillScript):
        version, _, _ = self._check(tx, ctx, args)
        checkpoint = load(tx, Checkpoint, ctx.task_id)
        from flowmate.agents.checkpoint import content_dependencies
        history = content_dependencies(checkpoint, [
            *context_dependencies(tx, ctx), *checkpoint.output_dependencies,
            *[ScopeDependency.model_validate(value) for value in
              checkpoint.context_manifest.get("source_dependencies", [])],
        ])
        dependencies = [
            *history, *version.dependencies,
            ScopeDependency(scope_id=version.skill_id, epoch=tx.execute(
                "SELECT epoch FROM scopes WHERE id=?", (version.skill_id,)).fetchone()[0]),
        ]
        for id in args.input_refs:
            resource = self.policy.resource(ctx, id, tx=tx)
            if resource.kind != "file":
                raise DomainError("script_input_invalid", "脚本输入须为明确选择的普通文件")
            dependencies.append(ScopeDependency(scope_id=id, epoch=resource.version))
        dependencies = _merge_dependencies(dependencies)
        self.policy.check_run_sources(tx, ctx, dependencies)
        return {"read": dependencies, "local_process_send": dependencies}

    async def run(self, ctx, args: RunSkillScript, cancel):
        # 注册边界已恢复领域 DTO；这里只复核真实执行事实。
        with self.store.transaction(write=False) as tx:
            version, _, script = self._check(tx, ctx, args)
            activity = load(tx, ActivitySnapshot, ctx.activity_id)
            if activity.state != "dispatched" or activity.intent.operation != "skills.run_script":
                raise DomainError("script_not_dispatched", "脚本必须经过实际工具派发")
            dependencies = self.resolve_dependencies(tx, ctx, args)["local_process_send"]
            dependencies = _merge_dependencies(dependencies, activity.intent.dependencies)
            check_scopes(tx, dependencies)
            decision = self.policy.check_tx(tx, ctx, dependencies, "local_process_send",
                process_destination(args.skill_id, args.content_hash, args.environment_id,
                    args.environment_revision))
            if not decision.allowed:
                raise DomainError(decision.reason or "grant_required", "本机进程输入用途尚未授权")
            dependencies = _merge_dependencies(dependencies, decision.dependencies)
            run = load(tx, RunSnapshot, ctx.run_id)
        environment = self.environments.resolve(args.environment_id, args.environment_revision)
        package = self.skills.package(args.skill_id, args.content_hash,
            ScopeRef(kind="workspace", workspace_id=ctx.workspace_id))
        attempt = self.root / activity.attempt_id
        self.root.mkdir(parents=True, exist_ok=True)
        try:
            attempt.mkdir()
        except FileExistsError:
            raise DomainError("script_attempt_already_started", "同一 attempt 不能重复执行") from None
        package_root, inputs, outputs = (attempt / name for name in ("package", "inputs", "outputs"))
        observations = []
        try:
            for directory in (package_root, inputs, outputs):
                directory.mkdir()
            for relative, data in package.files.items():
                target = package_root.joinpath(*PurePosixPath(relative).parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            for id in args.input_refs:
                resource = self.policy.resource(ctx, id)
                snapshot = await asyncio.to_thread(self.files.read_snapshot,
                    FileAnchor(resource.canonical_path, resource.file_identity, "file"), cancel=cancel.is_set)
                if resource.source_version is None or resource.source_version != snapshot.source_version:
                    raise DomainError("script_input_version_unobserved", "输入须先经真实读取记录内容版本")
                (inputs / (resource.id + Path(resource.canonical_path).suffix)).write_bytes(snapshot.data)
            # 快照读取会让出控制权；开始进程前必须消费最新许可、环境修订与来源围栏。
            with self.store.transaction(write=False) as tx:
                self._check(tx, ctx, args)
                self.policy.check_run_sources(tx, ctx, dependencies)
                check_scopes(tx, dependencies)
            environment = self.environments.resolve(args.environment_id, args.environment_revision)
            # 只增加本次受控目录，不从宿主继承凭据。用户 env 不能覆盖这些值。
            environment = environment.model_copy(update={"env": {
                **environment.env,
                "FLOWMATE_INPUT_DIR": inputs.as_posix(),
                "FLOWMATE_OUTPUT_DIR": outputs.as_posix(),
            }})
            executable_script = package_root.joinpath(*PurePosixPath(args.script_relative_path).parts)
            argv = [str(executable_script), *args.arguments]
            if environment.kind == "powershell":
                argv = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", *argv]
            elif environment.kind == "bash":
                argv[0] = executable_script.as_posix()
            cwd = package_root if environment.cwd_mode == "package_copy" else attempt
            deadline = min(run.deadline_at, datetime.now(UTC) + timedelta(seconds=300))
            result = await self.environments.runner.run(ProcessSpec(
                invocation_id=activity.attempt_id, environment=environment, argv=argv, cwd=str(cwd),
                deadline=deadline,
            ), cancel)
            # 发布前重新检查许可、版本及来源，撤销/删除后的迟到输出不能变成产物。
            with self.store.transaction(write=False) as tx:
                self._check(tx, ctx, args)
                self.policy.check_run_sources(tx, ctx, dependencies)
                check_scopes(tx, dependencies)
            staged, entries = [], []
            total, count = 0, 0
            for current, directories, names in os.walk(outputs, followlinks=False):
                _ordinary(Path(current))
                for name in directories:
                    _ordinary(Path(current) / name)
                for name in sorted(names):
                    path = Path(current) / name
                    info = _ordinary(path)
                    if not stat.S_ISREG(info.st_mode):
                        raise DomainError("script_output_invalid", "只能采集普通输出文件")
                    total += info.st_size
                    count += 1
                    if total > MAX_OUTPUT_BYTES or count > MAX_OUTPUT_FILES or info.st_size > self.artifacts.config.max_file_bytes:
                        raise DomainError("script_output_limit", "脚本输出超过采集上限")
                    with path.open("rb") as stream:
                        data = stream.read(self.artifacts.config.max_file_bytes + 1)
                    if len(data) != info.st_size:
                        raise DomainError("script_output_changed", "采集期间输出发生变化")
                    try:
                        text = data.decode("utf-8")
                    except UnicodeDecodeError:
                        artifact = self.artifacts.stage_binary(ctx, data, dependencies)
                    else:
                        media = "text/markdown" if path.suffix.lower() == ".md" else "text/plain"
                        if b"\0" in data or path.suffix.lower() not in {".txt", ".md"}:
                            artifact = self.artifacts.stage_binary(ctx, data, dependencies)
                        else:
                            artifact = self.artifacts.stage_text(ctx, text, media, dependencies)
                    staged.append(artifact)
                    entries.append(ScriptArtifact(relative_path=path.relative_to(outputs).as_posix(),
                        artifact=artifact.ref))
            value = ScriptExecutionResult(
                skill_id=args.skill_id, content_hash=args.content_hash,
                script_relative_path=args.script_relative_path, script_hash=script.content_hash,
                environment_id=environment.id, environment_revision=environment.revision,
                executable_identity=environment.executable_identity, attempt_id=activity.attempt_id,
                exit_code=result.exit_code, termination_reason=result.termination_reason,
                stdout=_log(result.stdout), stderr=_log(result.stderr), truncated=result.truncated,
                process_identity=result.process_identity, outputs=entries,
            )
            error = ("script_" + result.termination_reason if result.termination_reason != "exited"
                else "script_nonzero_exit" if result.exit_code != 0 else None)
            return ToolOutcome(result=value.model_dump(mode="json"), error=error,
                dependencies=dependencies, staged_artifacts=staged, source_observations=observations)
        finally:
            # 空 attempt 目录是执行过的持久标记；输入/执行副本和原始输出不长期留存。
            for directory in (package_root, inputs, outputs):
                if directory.is_junction():
                    directory.rmdir()
                elif directory.is_symlink():
                    directory.unlink()
                elif directory.exists():
                    shutil.rmtree(directory)
