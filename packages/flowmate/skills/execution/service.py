"""固定版本脚本执行；所有代码入口和路径均来自可信服务。"""

import asyncio
import base64
import hashlib
import json
import os
import shutil
import stat
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath

from pydantic import ValidationError

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    ActivitySnapshot,
    Checkpoint,
    RunSnapshot,
    ScopeDependency,
    SelectedFileVersion,
    SourceObservation,
    TaskSnapshot,
)
from flowmate.contracts.scopes import ScopeRef
from flowmate.policy.contracts import PolicyDecision
from flowmate.processes.contracts import DEFAULT_PROCESS_TIMEOUT_SECONDS, ProcessSpec
from flowmate.processes.runner import ProcessRunner
from flowmate.runtime.transitions import check_scopes, load
from flowmate.skills.execution.contracts import (
    RunSkillScript,
    ScriptArtifact,
    ScriptExecutionResult,
    ScriptLog,
    SkillScriptRequest,
    process_destination,
)
from flowmate.skills.execution.permissions import SkillExecutionPermissions, selected_script
from flowmate.tools.builtin import context_dependencies
from flowmate.tools.catalog import ToolArgumentsError, ToolOutcome
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

    def pin_inputs(self, tx, sources, workspace_id, session_id):
        """接纳时固定文件，不修改共享 Resource；排队激活和恢复不重新选择。"""
        from flowmate.policy.contracts import ResourceRecord

        versions = {}
        for id in sources.resource_ids:
            resource = ResourceRecord.model_validate_json(tx.execute(
                "SELECT document FROM resources WHERE id=?", (id,)).fetchone()[0])
            if resource.kind != "file":
                continue
            lineage, current, dependencies = [], resource, []
            while True:
                lineage.append(current.id)
                dependencies.append(ScopeDependency(scope_id=current.id, epoch=current.version))
                if current.parent_resource_id is None:
                    break
                current = ResourceRecord.model_validate_json(tx.execute(
                    "SELECT document FROM resources WHERE id=?", (current.parent_resource_id,)).fetchone()[0])
            missing, grants = self.policy._cover_resources(tx, workspace_id, session_id,
                {id: lineage}, "read", None)
            if missing:
                raise DomainError("grant_required", "所选文件尚未允许读取")
            check_scopes(tx, [*dependencies, *grants])
            snapshot = self.files.read_snapshot(
                FileAnchor(resource.canonical_path, resource.file_identity, "file"))
            versions[id] = SelectedFileVersion(
                file_identity=hashlib.sha256(resource.file_identity.encode()).hexdigest(),
                source_version=snapshot.source_version)
        return versions

    async def model_spec(self, ctx, spec):
        entries = []
        with self.store.transaction(write=False) as tx:
            choices = load(tx, RunSnapshot, ctx.run_id).sources.skill_execution_permissions
        for summary in self.skills.catalog(ctx):
            if summary.skill_id in choices and choices[summary.skill_id] is None:
                continue
            version = self.skills.reference(ctx, summary.skill_id, summary.content_hash)
            entries.append({
                "skill_id": summary.skill_id, "name": summary.name,
                "description": summary.description,
                "entries": [file.path for file in version.files if file.path.startswith("scripts/")
                    and any(file.path.endswith(suffix) for suffixes in SCRIPT_EXTENSIONS.values()
                        for suffix in ((suffixes,) if isinstance(suffixes, str) else suffixes))],
            })
        return spec.model_copy(update={
            "input_schema": SkillScriptRequest.model_json_schema(),
            "description": (
                "运行本轮已选 Skill 的登记入口。只提交入口、业务参数和已选文件引用；"
                "宿主解析已发布版本、项目解释器及固定修订。"
                "文件按原后缀复制到 FLOWMATE_INPUT_DIR，输出写入 FLOWMATE_OUTPUT_DIR 后成为可打开产物。"
                "需要参数和产物说明时先用 skills.read 读取该 Skill 的 SKILL.md。"
                "\n本轮入口：" + json.dumps(entries, ensure_ascii=False)),
        })

    async def prepare_arguments(self, ctx, arguments):
        try:
            request = SkillScriptRequest.model_validate(arguments)
        except ValidationError:
            raise ToolArgumentsError([{"schema_path": [], "rule": "schema"}]) from None
        with self.store.transaction(write=False) as tx:
            task = load(tx, TaskSnapshot, ctx.task_id)
            content_hash = task.binding.sources.skill_versions.get(request.skill_id)
            if content_hash is None:
                raise DomainError("skill_not_selected", "请先选择此任务要使用的 Skill")
            version = self.skills.reference(ctx, request.skill_id, content_hash, tx=tx)
            if request.script_relative_path not in {file.path for file in version.files}:
                raise DomainError("skill_script_invalid", "此入口不属于所选的已发布 Skill")
            binding = self.skills._binding(tx, request.skill_id,
                ScopeRef(kind="workspace", workspace_id=ctx.workspace_id))
            if binding is None or not binding.enabled:
                raise DomainError("skill_disabled", "此 Skill 已在当前项目停用")
            choice = self.permissions.choice(tx, ctx, request.skill_id, content_hash)
        kind = next((kind for kind, suffixes in SCRIPT_EXTENSIONS.items()
            if request.script_relative_path.endswith(suffixes)), None)
        if kind is None or not request.script_relative_path.startswith("scripts/"):
            raise DomainError("skill_script_invalid", "请选择已登记的脚本入口")
        if choice is not None or binding.environment_id is not None:
            selected = choice or binding
            environment = self.environments.resolve(selected.environment_id, selected.environment_revision)
            if environment.kind != kind:
                raise DomainError("environment_kind_mismatch",
                    f"此入口需要 {kind}，请更换已选择的解释器或脚本入口")
        else:
            environment = await self.environments.select(ctx.workspace_id, kind)
        args = RunSkillScript(**request.model_dump(), content_hash=content_hash,
            environment_id=environment.id, environment_revision=environment.revision)
        with self.store.transaction(write=False) as tx:
            self._check(tx, ctx, args)
        return args.model_dump(mode="json")

    def call_permission(self, tx, ctx, arguments):
        args = RunSkillScript.model_validate(arguments)
        for row in tx.execute("SELECT document FROM approvals WHERE activity_id=? AND status='denied'",
                (ctx.activity_id,)):
            from flowmate.policy.contracts import Approval
            denied = Approval.model_validate_json(row[0])
            if denied.tool_name == "skills.run_script" and denied.parameters == arguments:
                return PolicyDecision(allowed=False)
        return PolicyDecision(allowed=selected_script(tx, ctx, args, self.skills, for_call_approval=True))

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
        return self._dependencies(tx, ctx, args, version)

    def _dependencies(self, tx, ctx, args, version):
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
            dependencies = self._dependencies(tx, ctx, args, version)["local_process_send"]
            dependencies = _merge_dependencies(dependencies, activity.intent.dependencies)
            check_scopes(tx, dependencies)
            decision = self.policy.check_tx(tx, ctx, dependencies, "local_process_send",
                process_destination(args.skill_id, args.content_hash, args.environment_id,
                    args.environment_revision))
            if not decision.allowed:
                raise DomainError(decision.reason or "grant_required", "本机进程输入用途尚未授权")
            dependencies = _merge_dependencies(dependencies, decision.dependencies)
            run = load(tx, RunSnapshot, ctx.run_id)
            task = load(tx, TaskSnapshot, ctx.task_id)
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
                pinned = task.binding.file_inputs.get(id)
                if pinned is None or run.file_inputs.get(id) != pinned:
                    raise DomainError("script_input_unbound", "此任务未固定文件内容，请重新选择文件并发送")
                if pinned.file_identity != hashlib.sha256(resource.file_identity.encode()).hexdigest():
                    raise DomainError("script_input_changed", "已固定的输入文件已改变，请重新选择文件")
                try:
                    snapshot = await asyncio.to_thread(self.files.read_snapshot,
                        FileAnchor(resource.canonical_path, resource.file_identity, "file"), cancel=cancel.is_set)
                except DomainError as error:
                    if error.code != "file_identity_changed":
                        raise
                    raise DomainError("script_input_changed",
                        "已固定的输入文件已被替换，请重新选择文件") from None
                if pinned.source_version != snapshot.source_version:
                    raise DomainError("script_input_changed", "已固定的输入文件内容已改变，请重新选择文件")
                observations.append(SourceObservation(resource_id=id,
                    expected_version=resource.version, source_version=snapshot.source_version))
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
            deadline = min(run.deadline_at,
                datetime.now(UTC) + timedelta(seconds=DEFAULT_PROCESS_TIMEOUT_SECONDS))
            def authorize_start(spec):
                with self.store.transaction(write=False) as tx:
                    self._check(tx, ctx, args)
                    self.policy.check_run_sources(tx, ctx, dependencies)
                    check_scopes(tx, dependencies)
                self.environments.resolve(args.environment_id, args.environment_revision)

            with ProcessRunner.authorize_start(authorize_start):
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
            collection_error = None
            def collection_failed(error):
                raise error

            try:
                total, count = 0, 0
                for current, directories, names in os.walk(outputs, followlinks=False,
                        onerror=collection_failed):
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
            except DomainError as error:
                collection_error = error.code
            except OSError:
                collection_error = "script_output_collection_failed"
            if collection_error:
                staged, entries = [], []
            observed_dependencies = {item.resource_id: ScopeDependency(
                scope_id=item.resource_id, epoch=item.expected_version + (
                    self.policy.resource(ctx, item.resource_id).source_version != item.source_version))
                for item in observations}
            def observed(values):
                return [observed_dependencies.get(item.scope_id, item) for item in values]
            dependencies = observed(dependencies)
            staged = [item.model_copy(update={"ref": item.ref.model_copy(update={
                "dependencies": observed(item.ref.dependencies)})}) for item in staged]
            refs = {item.ref.id: item.ref for item in staged}
            entries = [entry.model_copy(update={"artifact": refs[entry.artifact.id]}) for entry in entries]
            value = ScriptExecutionResult(
                skill_id=args.skill_id, content_hash=args.content_hash,
                script_relative_path=args.script_relative_path, script_hash=script.content_hash,
                environment_id=environment.id, environment_revision=environment.revision,
                executable_identity=environment.executable_identity, attempt_id=activity.attempt_id,
                exit_code=result.exit_code, termination_reason=result.termination_reason,
                stdout=_log(result.stdout), stderr=_log(result.stderr), truncated=result.truncated,
                process_identity=result.process_identity, outputs=entries, collection_error=collection_error,
            )
            error = ("script_" + result.termination_reason if result.termination_reason != "exited"
                else "script_nonzero_exit" if result.exit_code != 0 else None)
            if error == "script_nonzero_exit":
                diagnostics = result.stderr.decode("utf-8", errors="replace")
                if (environment.kind == "python" and "ModuleNotFoundError: No module named " in diagnostics
                        or environment.kind == "node" and any(code in diagnostics for code in
                            ("MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"))
                        or environment.kind == "powershell" and "Modules_ModuleNotFound" in diagnostics
                        or environment.kind == "bash" and result.exit_code == 127
                        and "command not found" in diagnostics):
                    error = "script_dependency_missing"
            return ToolOutcome(result=value.model_dump(mode="json"), error=error or collection_error,
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
