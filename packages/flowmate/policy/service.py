"""资料用途授权；可信选择不读正文，所有变更与 scope 围栏原子提交。"""

import hashlib
import json
import ntpath
import re
from pathlib import PureWindowsPath
from urllib.parse import urlsplit

from flowmate.contracts.base import CommandMeta, DomainError
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    ArtifactRef,
    Checkpoint,
    ExecutionContext,
    RunSnapshot,
    ScopeDependency,
    SourceObservation,
    TaskSnapshot,
)
from flowmate.contracts.scopes import ScopeRef
from flowmate.persistence.store import Store, UnitOfWork
from flowmate.policy.contracts import (
    DataUseGrant,
    GrantCommand,
    NativeSelection,
    PolicyChange,
    PolicyDecision,
    Purpose,
    ResourceRecord,
    ResourceRef,
    ToolInvocation,
)
from flowmate.runtime.transitions import bump, check_scopes, context_for, load, utc_now


def _document(tx, table, model, id, *, required=True):
    row = tx.execute(f"SELECT document FROM {table} WHERE id=?", (id,)).fetchone()
    if row is None:
        if required:
            raise DomainError("not_found", "授权对象不存在", related_ids=(id,))
        return None
    return model.model_validate_json(row[0])


def _scope(tx, scope):
    if scope.kind == "user_global":
        id = tx.execute("SELECT user_scope_id FROM local_identity WHERE singleton=1").fetchone()[0]
        check_scopes(tx, [ScopeDependency(scope_id=id, epoch=tx.execute(
            "SELECT epoch FROM scopes WHERE id=?", (id,)).fetchone()[0])])
        return
    if not tx.execute("SELECT 1 FROM workspaces WHERE id=?", (scope.workspace_id,)).fetchone():
        raise DomainError("not_found", "工作区不存在")
    ids = [scope.workspace_id]
    if scope.session_id is not None:
        row = tx.execute("SELECT workspace_id FROM sessions WHERE id=?", (scope.session_id,)).fetchone()
        if row is None or row[0] != scope.workspace_id:
            raise DomainError("scope_mismatch", "会话不属于所选工作区")
        ids.append(scope.session_id)
    for id in ids:
        row = tx.execute("SELECT status FROM scopes WHERE id=?", (id,)).fetchone()
        if row is None or row[0] != "active":
            raise DomainError("scope_revoked", "资料范围已失效")


def _compatible(scope, workspace_id, session_id):
    return scope.workspace_id == workspace_id and scope.session_id in {None, session_id}


def _owner(tx, ctx):
    actual = context_for(tx, ctx.task_id)
    if ctx.model_dump(exclude={"activity_id"}) != actual.model_dump(exclude={"activity_id"}):
        raise DomainError("owner_mismatch", "执行上下文不属于真实任务")
    run = load(tx, RunSnapshot, actual.run_id)
    task = load(tx, TaskSnapshot, actual.task_id)
    if ctx.activity_id is not None:
        activity = load(tx, ActivitySnapshot, ctx.activity_id)
        if (activity.run_id, activity.task_id) != (run.id, task.id):
            raise DomainError("owner_mismatch", "活动不属于当前任务")
    return run, task


def _dependencies(tx, ctx, dependencies, *, artifact_id=None):
    """只校验归属和 epoch，不把任何依赖解释为用途许可。"""
    values = [*ctx.scope_dependencies, *dependencies]
    skill_provenance = set()
    for item in list(values):
        if tx.execute("SELECT 1 FROM scopes WHERE id=? AND kind='skill'", (item.scope_id,)).fetchone():
            version = PolicyService.skill_version(tx, ctx, item.scope_id)
            values.extend(version.dependencies)
            skill_provenance.update(dep.scope_id for dep in version.dependencies)
    artifact_sources = set()
    task = load(tx, TaskSnapshot, ctx.task_id)
    if task.binding.input_result is not None:
        from flowmate.runtime.tasks import selected_result
        selected = selected_result(tx, ctx)
        values.extend(selected.dependencies)
        artifact_sources.update(item.scope_id for item in selected.dependencies)
    # 已读取内容的消息/派生产物/私有续接仍沿固定Artifact关系核验，不退化为scope白名单。
    for selected in task.binding.input_artifacts:
        current = _document(tx, "artifacts", ArtifactRef, selected.id)
        PolicyService.artifact_input(tx, ctx, current)
        values.extend(current.dependencies)
        artifact_sources.update(item.scope_id for item in current.dependencies)
    if artifact_id is not None:
        artifact = _document(tx, "artifacts", ArtifactRef, artifact_id)
        if PolicyService.artifact_input(tx, ctx, artifact):
            values.extend(artifact.dependencies)
            artifact_sources = {item.scope_id for item in artifact.dependencies}
    check_scopes(tx, values)
    result = {}
    for item in values:
        if item.scope_id not in {ctx.workspace_id, ctx.session_id,ctx.interaction_session_id}:
            memory_scope = tx.execute("SELECT kind FROM scopes WHERE id=?", (item.scope_id,)).fetchone()
            if memory_scope is not None and memory_scope[0] == "mcp":
                from flowmate.integrations.tools import configured_server
                server = configured_server(tx, item.scope_id)
                if not server.enabled or item.epoch != server.revision:
                    raise DomainError("scope_revoked", "MCP 来源配置已改变或停用")
                if server.scope.workspace_id not in {None, ctx.workspace_id}:
                    raise DomainError("scope_mismatch", "MCP 来源不属于当前项目")
                result[item.scope_id] = item
                continue
            if memory_scope is not None and (memory_scope[0] in {"user_global", "memory", "skill"}
                    or item.scope_id in skill_provenance and memory_scope[0] in {"session", "workspace"}):
                result[item.scope_id] = item
                continue
            value = (_document(tx, "resources", ResourceRecord, item.scope_id, required=False)
                     or _document(tx, "grants", DataUseGrant, item.scope_id, required=False))
            if value is None and item.scope_id not in artifact_sources:
                # 私有执行范围只沿真实Task因果链传播，不因同项目/同预算组而扩大。
                from flowmate.runtime.tasks import task_ancestors
                targets = tx.execute("SELECT t.id FROM tasks t JOIN sessions s ON s.id=t.execution_session_id "
                    "WHERE s.id=? AND s.kind='execution' AND s.workspace_id=?", (item.scope_id,ctx.workspace_id))
                ancestors = task_ancestors(tx,ctx.task_id)
                if not any(row[0] in ancestors or ctx.task_id in task_ancestors(tx,row[0]) for row in targets):
                    raise DomainError("scope_mismatch", "私有执行依赖不属于授权任务链")
            elif value is not None and not (
                    isinstance(value, DataUseGrant) and (value.memory_scopes or value.mcp_versions)
                    and value.scope.kind == "user_global") and not _compatible(value.scope, ctx.workspace_id, ctx.interaction_session_id):
                raise DomainError("scope_mismatch", "依赖不属于当前资料范围")
        result[item.scope_id] = item
    return list(result.values())


def _command(store, operation, parameters, meta, model, apply):
    meta = CommandMeta.model_validate(meta.model_dump())
    canonical = json.dumps({"operation": operation, "parameters": parameters,
                            "expected_version": meta.expected_version}, sort_keys=True,
                           separators=(",", ":"), allow_nan=False)
    fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
    with store.transaction() as tx:
        previous = tx.previous_command(meta.command_id)
        if previous:
            if previous["request_hash"] != fingerprint:
                raise DomainError("command_conflict", "同一命令不能更改参数")
            return model.model_validate_json(previous["response"])
        result = apply(tx)
        scope = result.scope if isinstance(result, DataUseGrant) else ScopeRef(
            kind="session" if result.session_id is not None else "workspace",
            workspace_id=result.workspace_id, session_id=result.session_id)
        tx.execute("INSERT INTO commands VALUES (?, ?, ?, ?, ?)",
                   (meta.command_id, fingerprint, result.model_dump_json(),
                    scope.workspace_id, scope.session_id))
        return result


def _path(value):
    raw = value.replace("/", "\\")
    path = PureWindowsPath(raw)
    if not path.is_absolute() or raw.startswith(("\\\\?\\", "\\\\.\\")):
        raise DomainError("file_path_invalid", "需要规范的绝对 Windows 路径")
    tail = raw[len(path.anchor):]
    parts = tail.split("\\") if tail else []
    if any(not part or part in {".", ".."} or part.endswith((" ", "."))
           or any(ord(char) < 32 or char in '<>:"|?*' for char in part)
           or ntpath.isreserved(part) for part in parts):
        raise DomainError("file_path_invalid", "资料路径不是规范路径")
    return ntpath.normcase(ntpath.normpath(raw))


def _selection(selection):
    selection = NativeSelection.model_validate(selection.model_dump())
    path = _path(selection.canonical_path)
    target = selection.export_target
    if selection.kind == "export":
        if target is None or not target.parent_identity or not target.name:
            raise DomainError("invalid_selection", "导出选择缺少目标身份")
        parent = _path(target.parent_path)
        if (ntpath.dirname(path) != parent or ntpath.basename(path) != target.name.lower()
                or any(char in target.name for char in "\\/")):
            raise DomainError("invalid_selection", "导出目标不属于所选父目录")
        if ((target.target_identity is None) != (target.content_hash is None)
                or (target.content_hash is not None
                    and not re.fullmatch(r"[0-9a-f]{64}", target.content_hash))):
            raise DomainError("invalid_selection", "导出目标身份与摘要不一致")
        target = target.model_copy(update={"parent_path": parent})
    elif target is not None:
        raise DomainError("invalid_selection", "来源选择不能携带导出目标")
    return selection.model_copy(update={"canonical_path": path, "export_target": target})


def _reference(record):
    return ResourceRef.model_validate(record.model_dump(include=ResourceRef.model_fields.keys()))


def _endpoint(destination):
    if not isinstance(destination, str) or not destination or any(
            char.isspace() or ord(char) < 32 for char in destination):
        raise DomainError("invalid_destination", "模型发送必须绑定明确 endpoint")
    try:
        url = urlsplit(destination)
        valid = (url.scheme in {"http", "https"} and url.hostname and url.port != 0
                 and url.username is None and url.password is None
                 and "?" not in destination and "#" not in destination and "\\" not in destination)
    except ValueError:
        valid = False
    if not valid:
        raise DomainError("invalid_destination", "endpoint 不能包含凭据或动态查询")
    return destination


def _local_destination(tx, destination):
    pattern = r"skill:([0-9a-f-]{36}):([0-9a-f]{64}):environment:([0-9a-f-]{36}):([1-9][0-9]*)"
    match = re.fullmatch(pattern, destination or "")
    if match is None or tx.execute("SELECT 1 FROM skill_versions WHERE skill_id=? AND content_hash=?",
            match.group(1, 2)).fetchone() is None or tx.execute(
            "SELECT 1 FROM execution_environments WHERE id=? AND revision=?",
            (match[3], int(match[4]))).fetchone() is None:
        raise DomainError("invalid_destination", "本机进程用途必须绑定真实 Skill 版本及环境修订")
    return destination


def _policy_event(tx, kind, change, scope, *, ctx=None, causation_id=None):
    tx.append_event(NewEvent(kind=kind, payload=change, workspace_id=scope.workspace_id,
                             session_id=scope.session_id, run_id=ctx.run_id if ctx else None,
                             task_id=ctx.task_id if ctx else None,
                             activity_id=ctx.activity_id if ctx else None, causation_id=causation_id))


class PolicyService:
    def __init__(self, store: Store, *, clock=utc_now):
        self.store = store
        self.clock = clock
        from flowmate.memory.provider import SQLiteMemoryProvider
        self.memory_provider = SQLiteMemoryProvider(store)

    @staticmethod
    def artifact_input(tx, ctx, artifact, *, artifact_version=None, content_hash=None):
        """核验实际Task的固定输入；Agent委派与用户export分别使用各自持久事实。"""
        task = load(tx, TaskSnapshot, ctx.task_id)
        if task.binding.input_result is not None:
            from flowmate.runtime.tasks import selected_result
            selected = selected_result(tx, ctx)
            chosen = next((ref for ref in selected.artifacts if ref.id == artifact.id), None)
            if chosen is not None:
                if chosen != artifact:
                    raise DomainError("source_version_conflict", "交付产物与固定输入不一致")
                return True
            if artifact.task_id != task.id:
                raise DomainError("artifact_scope_mismatch", "产物不属于明确选择的结果交付")
        if task.binding.agent_work is not None or task.binding.input_artifacts:
            selected = next((ref for ref in task.binding.input_artifacts if ref.id == artifact.id), None)
            if selected is not None:
                if artifact != selected:
                    raise DomainError("source_version_conflict", "成员选中的产物版本、内容或来源已改变")
                return True
            if artifact.task_id != task.id:
                # 已消费的真实从属交付是另一条明确来源关系，不允许读取其全部内部产物。
                row = tx.execute("SELECT c.document FROM consumptions c WHERE c.consumer_task_id=? "
                    "AND c.target_task_id=?", (task.id, artifact.task_id)).fetchone()
                checkpoint = load(tx, Checkpoint, artifact.task_id)
                if row is None or checkpoint.output is None or artifact.id not in checkpoint.output.artifact_ids:
                    raise DomainError("artifact_scope_mismatch", "产物不属于成员固定输入或明确交付")
        checkpoint = load(tx, Checkpoint, ctx.task_id)
        selected = False
        if checkpoint.tool_origin == "user" and checkpoint.tool_call is not None:
            call = ToolInvocation.model_validate(checkpoint.tool_call)
            if call.name == "artifacts.export" and call.version == "2":
                if artifact.id != call.arguments["artifact_id"]:
                    raise DomainError("artifact_scope_mismatch", "产物不是本次用户选择的导出输入")
                if (artifact.version, artifact.content_hash) != (
                        call.arguments["artifact_version"], call.arguments["content_hash"]):
                    raise DomainError("version_conflict", "所选产物版本或内容已改变")
                selected = True
        if artifact_version is not None and (artifact.version, artifact.content_hash) != (
                artifact_version, content_hash):
            raise DomainError("version_conflict", "产物与固定导出输入不一致")
        return selected

    @staticmethod
    def artifact_read_id(tool_name, arguments):
        """只有内置产物调用携带读主体；同名的第三方参数不是来源关系。"""
        return arguments["artifact_id"] if tool_name in {"artifacts.read", "artifacts.export"} else None

    def register_selection(self, selection: NativeSelection) -> ResourceRef:
        with self.store.transaction() as tx:
            return self.register_selection_tx(tx, selection)

    def register_selection_tx(self, tx, selection: NativeSelection) -> ResourceRef:
        selection = _selection(selection)
        if selection.scope.kind == "user_global":
            raise DomainError("invalid_scope","磁盘资料须属于项目或会话范围")
        _scope(tx, selection.scope)
        previous = _document(tx, "resources", ResourceRecord, selection.id, required=False)
        if previous is not None:
            fields = NativeSelection.model_fields.keys()
            if previous.model_dump(include=fields) != selection.model_dump():
                raise DomainError("resource_conflict", "同一选择身份不能更改参数")
            check_scopes(tx, [ScopeDependency(scope_id=previous.id, epoch=previous.version)])
            return _reference(previous)
        if tx.execute("SELECT 1 FROM scopes WHERE id=?", (selection.id,)).fetchone():
            raise DomainError("resource_conflict", "选择身份已被使用")
        if selection.kind != "export":
            row = tx.execute("SELECT r.document FROM resources r JOIN scopes s ON s.id=r.id "
                "WHERE r.workspace_id=? AND r.session_id IS ? AND r.canonical_path=? "
                "AND json_extract(r.document,'$.kind')=? AND json_extract(r.document,'$.file_identity')=? "
                "AND s.status='active' ORDER BY r.rowid LIMIT 1", (selection.scope.workspace_id,
                    selection.scope.session_id, selection.canonical_path, selection.kind, selection.file_identity)).fetchone()
            if row is not None:
                return _reference(ResourceRecord.model_validate_json(row[0]))
        record = ResourceRecord(**selection.model_dump(),
                                source_version=selection.export_target.content_hash if selection.kind == "export" else None,
                                label=ntpath.basename(selection.canonical_path) or "所选目录")
        _policy_event(tx, "resource.registered", PolicyChange(resources=[record]), selection.scope)
        return _reference(record)

    def register_child(self, ctx: ExecutionContext, parent_resource_id: str,
                       selection: NativeSelection) -> ResourceRef:
        selection = _selection(selection)
        with self.store.transaction() as tx:
            parent = self.resource(ctx, parent_resource_id, tx=tx)
            if (parent.kind != "directory" or selection.kind == "export"
                    or selection.scope != parent.scope):
                raise DomainError("scope_mismatch", "发现的文件不属于已选目录")
            root, child = parent.canonical_path, selection.canonical_path
            if not child.startswith(root.rstrip("\\") + "\\"):
                raise DomainError("scope_mismatch", "发现的文件超出已选目录")
            decision = self.check_tx(tx, ctx, [ScopeDependency(scope_id=parent.id,
                                                             epoch=parent.version)], "read")
            if not decision.allowed:
                raise DomainError("grant_required", "目录尚未获得读取授权")
            rows = tx.execute("SELECT document FROM resources WHERE parent_resource_id=? "
                              "AND canonical_path=? ORDER BY rowid DESC", (parent.id, child)).fetchall()
            previous = [ResourceRecord.model_validate_json(row[0]) for row in rows]
            for record in previous:
                if record.file_identity == selection.file_identity and record.kind == selection.kind:
                    return _reference(record)
            if tx.execute("SELECT 1 FROM scopes WHERE id=?", (selection.id,)).fetchone():
                raise DomainError("resource_conflict", "选择身份已被使用")
            if previous:
                _policy_event(tx, "resource.updated", PolicyChange(resources=[bump(previous[0])]),
                              parent.scope, ctx=ctx)
            record = ResourceRecord(**selection.model_dump(), label=ntpath.basename(child),
                                    parent_resource_id=parent.id)
            _policy_event(tx, "resource.registered", PolicyChange(resources=[record]), record.scope, ctx=ctx)
            return _reference(record)

    def resource(self, ctx: ExecutionContext, resource_id: str,
                 *, tx: UnitOfWork | None = None) -> ResourceRecord:
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.resource(ctx, resource_id, tx=tx)
        _owner(tx, ctx)
        _dependencies(tx, ctx, [])
        record = _document(tx, "resources", ResourceRecord, resource_id)
        if not _compatible(record.scope, ctx.workspace_id, ctx.interaction_session_id):
            raise DomainError("scope_mismatch", "资料不属于当前工作区或会话")
        check_scopes(tx, [ScopeDependency(scope_id=record.id, epoch=record.version)])
        return record

    def grant(self, command: GrantCommand, meta: CommandMeta) -> DataUseGrant:
        command = GrantCommand.model_validate(command.model_dump())
        if sum(bool(value) for value in (command.resource_ids, command.memory_scopes, command.mcp_versions)) != 1:
            raise DomainError("invalid_grant", "授权须选择文件、记忆或 MCP 来源之一")
        if command.memory_scopes and (command.memory_scopes != [command.scope]
                or command.scope.kind == "session" or len(command.purposes) != 1
                or command.purposes[0] not in {"model_send", "tool_send", "local_process_send"}):
            raise DomainError("invalid_grant", "记忆授权须绑定单一长期范围及明确发送用途")
        if command.resource_ids and command.scope.kind == "user_global":
            raise DomainError("invalid_scope", "文件资料不能使用个人记忆范围")
        command = command.model_copy(update={"resource_ids": sorted(set(command.resource_ids)),
                                             "purposes": sorted(set(command.purposes))})
        if "model_send" in command.purposes:
            _endpoint(command.destination)

        def apply(tx):
            if meta.expected_version is not None:
                raise DomainError("version_conflict", "新授权不接受已有版本")
            _scope(tx, command.scope)
            if "local_process_send" in command.purposes:
                _local_destination(tx, command.destination)
            if "tool_send" in command.purposes:
                from flowmate.integrations.tools import check_destination
                check_destination(tx, command.destination)
            if command.mcp_versions:
                from flowmate.integrations.tools import configured_server
                for server_id, revision in command.mcp_versions.items():
                    server = configured_server(tx, server_id)
                    if (not server.enabled or server.revision != revision
                            or server.scope.workspace_id not in {None, command.scope.workspace_id}):
                        raise DomainError("scope_mismatch", "MCP 授权不属于当前配置或所选范围")
                    check_scopes(tx, [ScopeDependency(scope_id=server_id, epoch=revision)])
            for id in command.resource_ids:
                record = _document(tx, "resources", ResourceRecord, id)
                if not _compatible(record.scope, command.scope.workspace_id, command.scope.session_id):
                    raise DomainError("scope_mismatch", "授权资源超出所选范围")
                check_scopes(tx, [ScopeDependency(scope_id=id, epoch=record.version)])
            for row in tx.execute("SELECT document FROM grants WHERE workspace_id IS ? AND "
                                  "session_id IS ? AND status='active' ORDER BY id",
                                  (command.scope.workspace_id, command.scope.session_id)):
                previous = DataUseGrant.model_validate_json(row[0])
                if previous.model_dump(include=GrantCommand.model_fields.keys()) == command.model_dump():
                    check_scopes(tx, [ScopeDependency(scope_id=previous.id, epoch=previous.epoch)])
                    return previous
            saved = DataUseGrant(**command.model_dump())
            _policy_event(tx, "grant.created", PolicyChange(grants=[saved]), saved.scope,
                          causation_id=meta.command_id)
            return saved

        return _command(self.store, "grant.create", command.model_dump(mode="json"), meta,
                        DataUseGrant, apply)

    def grant_memory(self, command, meta):
        from flowmate.memory.contracts import MemoryGrantCommand
        command = MemoryGrantCommand.model_validate(command.model_dump())
        return self.grant(GrantCommand(scope=command.scope, memory_scopes=[command.scope],
            purposes=["model_send"], destination=command.destination), meta)

    def check(self, ctx: ExecutionContext, dependencies: list[ScopeDependency], purpose: Purpose,
              destination: str | None = None, *, artifact_id=None) -> PolicyDecision:
        with self.store.transaction(write=False) as tx:
            return self.check_tx(tx, ctx, dependencies, purpose, destination, artifact_id=artifact_id)

    @staticmethod
    def resource_closure(tx: UnitOfWork, dependencies: list[ScopeDependency], *,
                         source_run_id=None, source_task_id=None) -> list[str]:
        resources, grants = {}, []
        for dependency in dependencies:
            resource = _document(tx, "resources", ResourceRecord, dependency.scope_id, required=False)
            if resource is not None and resource.kind != "export":
                resources[resource.id] = resource
            else:
                grant = _document(tx, "grants", DataUseGrant, dependency.scope_id, required=False)
                if grant is not None:
                    grants.append(grant)
        covered = set(resources)
        selections = []
        if source_run_id is not None:
            selections.append(load(tx,RunSnapshot,source_run_id).sources)
        if source_task_id is not None:
            selections.append(load(tx,TaskSnapshot,source_task_id).binding.sources)
        selected = {id for selection in selections for id in selection.resource_ids}
        for resource in list(resources.values()):
            parent_id = resource.parent_resource_id
            while parent_id is not None:
                covered.add(parent_id)
                parent_id = _document(tx, "resources", ResourceRecord, parent_id).parent_resource_id
        for grant in grants:
            if grant.memory_scopes or grant.mcp_versions:
                continue
            if not covered.intersection(grant.resource_ids):
                candidates = {}
                for resource_id in set(grant.resource_ids) | selected:
                    resource = _document(tx, "resources", ResourceRecord, resource_id)
                    # 孤立grant表示来源Run已选择的资料，不把同grant其他资源冒充实际输入。
                    lineage = {resource.id}
                    parent_id = resource.parent_resource_id
                    while parent_id is not None:
                        lineage.add(parent_id)
                        parent_id = _document(tx, "resources", ResourceRecord, parent_id).parent_resource_id
                    if (resource.kind != "export" and lineage.intersection(grant.resource_ids)
                            and all(lineage.intersection(selection.resource_ids)
                                    and not lineage.intersection(selection.excluded_source_ids)
                                    for selection in selections)):
                        candidates[resource.id] = resource
                if not candidates and any(_document(tx, "resources", ResourceRecord, id).kind != "export"
                                          for id in grant.resource_ids):
                    raise DomainError("outside_run_scope", "授权来源不属于原运行选择范围")
                resources.update(candidates)
        return sorted(resources)

    @staticmethod
    def check_run_sources(tx: UnitOfWork, ctx: ExecutionContext,
                          dependencies: list[ScopeDependency], *, source_run_id=None,
                          source_task_id=None, selection=None) -> None:
        run = load(tx, RunSnapshot, ctx.run_id)
        task = load(tx, TaskSnapshot, ctx.task_id)
        selections = (run.sources, task.binding.sources, *([selection] if selection is not None else []))
        excluded = {id for item in selections for id in item.excluded_source_ids}
        if excluded.intersection(item.scope_id for item in dependencies):
            raise DomainError("outside_run_scope","来源已被本次Task排除")
        for dependency in dependencies:
            if tx.execute("SELECT 1 FROM scopes WHERE id=? AND kind='skill'",
                    (dependency.scope_id,)).fetchone():
                PolicyService.skill_version(tx, ctx, dependency.scope_id)
                if selection is not None and selection.skill_versions.get(dependency.scope_id) != task.binding.sources.skill_versions.get(dependency.scope_id):
                    raise DomainError("outside_run_scope", "Skill 不在显式子来源内")
        # 记忆沿真实记录与修订核对固定范围，绝不伪装成文件 resource_id。
        for dependency in dependencies:
            row = tx.execute("SELECT kind,workspace_id FROM scopes WHERE id=?", (dependency.scope_id,)).fetchone()
            if row is None or row["kind"] != "memory":
                continue
            scope = ScopeRef(kind="workspace", workspace_id=row["workspace_id"]) if row["workspace_id"] else ScopeRef(kind="user_global")
            if scope.workspace_id not in {None, ctx.workspace_id} or any(
                    scope not in chosen.memory_scopes for chosen in selections):
                raise DomainError("outside_run_scope", "记忆不在 Run 与 Task 的固定交集范围")
        source_run = load(tx,RunSnapshot,source_run_id) if source_run_id is not None else run
        source_task_id = (source_task_id if source_task_id is not None else
                          task.id if source_run.id == run.id else source_run.root_task_id)
        if task.binding.input_result is not None and source_run.id == run.id:
            source_run = load(tx, RunSnapshot, task.binding.input_result.handle.run_id)
            source_task_id = task.binding.input_result.handle.task_id
        for resource_id in PolicyService.resource_closure(tx, dependencies,
                source_run_id=source_run.id,source_task_id=source_task_id):
            resource = _document(tx, "resources", ResourceRecord, resource_id)
            lineage = {resource.id}
            while resource.parent_resource_id is not None:
                resource = _document(tx,"resources",ResourceRecord,resource.parent_resource_id)
                lineage.add(resource.id)
            if excluded.intersection(lineage) or any(not lineage.intersection(selection.resource_ids) for selection in selections):
                raise DomainError("outside_run_scope", "资料不在Run与Task的固定交集范围")

    @staticmethod
    def skill_version(tx, ctx, skill_id):
        """用途检查只消费真实 Task 固定版本；不递归调用 reference 的用途上界检查。"""
        run = load(tx, RunSnapshot, ctx.run_id)
        task = load(tx, TaskSnapshot, ctx.task_id)
        version = task.binding.sources.skill_versions.get(skill_id)
        if version is None or run.sources.skill_versions.get(skill_id) != version:
            raise DomainError("outside_run_scope", "Skill 不在真实 Run/Task 的固定版本交集")
        from flowmate.skills.service import SkillService
        # _version 只核对内容身份、所属范围与来源存续，不将绑定停用解释为撤权。
        return SkillService._version(tx, skill_id, version,
            ScopeRef(kind="workspace", workspace_id=ctx.workspace_id))[1]

    def check_tx(self, tx: UnitOfWork, ctx: ExecutionContext, dependencies: list[ScopeDependency],
                 purpose: Purpose, destination: str | None = None, *, artifact_id=None) -> PolicyDecision:
        if purpose not in {"read", "model_send", "export", "tool_send", "local_process_send"}:
            raise DomainError("invalid_purpose", "不支持的资料用途")
        if purpose == "model_send":
            _endpoint(destination)
        if artifact_id is not None and purpose != "read":
            raise DomainError("invalid_purpose", "产物输入关系只用于读取所选产物")
        _, task = _owner(tx, ctx)
        if purpose == "local_process_send":
            _local_destination(tx, destination)
            activity = load(tx, ActivitySnapshot, ctx.activity_id)
            from flowmate.skills.execution.contracts import RunSkillScript, process_destination
            if activity.intent.kind != "tool" or activity.intent.operation != "skills.run_script":
                raise DomainError("invalid_destination", "此活动不是已绑定的脚本调用")
            call = ToolInvocation.model_validate(activity.intent.arguments)
            args = RunSkillScript.model_validate(call.arguments)
            if call.name != "skills.run_script" or destination != process_destination(args.skill_id, args.content_hash,
                    args.environment_id, args.environment_revision):
                raise DomainError("invalid_destination", "目的地与真实脚本参数不一致")
        if purpose == "tool_send":
            from flowmate.integrations.tools import check_destination
            config = check_destination(tx, destination)
            activity = load(tx, ActivitySnapshot, ctx.activity_id)
            binding = task.binding.config.catalog.mcp_tools.get(activity.intent.operation)
            if (activity.task_id != ctx.task_id or activity.run_id != ctx.run_id
                    or activity.intent.kind != "tool" or binding is None
                    or binding.destination != destination or binding.server_id != config.id
                    or binding.config_revision != config.revision
                    or activity.intent.operation not in task.binding.config.catalog.tools
                    or config.scope.workspace_id not in {None, ctx.workspace_id}):
                raise DomainError("invalid_destination", "工具发送与真实任务或 MCP 配置不一致")
        return self._check_sources_tx(tx, ctx, dependencies, purpose, destination, artifact_id=artifact_id)

    def check_script_submission(self, tx, ctx, arguments, dependencies):
        """只接纳固定脚本参数的来源用途；不构造 Activity，也不授予派发资格。"""
        from flowmate.skills.execution.contracts import RunSkillScript, process_destination

        args = RunSkillScript.model_validate(arguments)
        destination = _local_destination(tx, process_destination(args.skill_id, args.content_hash,
            args.environment_id, args.environment_revision))
        return self._check_sources_tx(tx, ctx, dependencies, "local_process_send", destination)

    def _check_sources_tx(self, tx, ctx, dependencies, purpose, destination, *, artifact_id=None):
        run, task = _owner(tx, ctx)
        if run.state in TERMINAL or task.state in TERMINAL:
            return PolicyDecision(allowed=False, reason="owner_inactive")
        try:
            checked = _dependencies(tx, ctx, dependencies, artifact_id=artifact_id)
        except DomainError as error:
            if error.code != "scope_revoked":
                raise
            return PolicyDecision(allowed=False, reason=error.code)
        self.check_run_sources(tx,ctx,checked)
        sources, grant_dependencies = {}, []
        for item in checked:
            resource = _document(tx, "resources", ResourceRecord, item.scope_id, required=False)
            if resource:
                sources[resource.id] = resource
            else:
                grant = _document(tx, "grants", DataUseGrant, item.scope_id, required=False)
                if grant:
                    grant_dependencies.append(grant)
        all_dependencies = {item.scope_id: item for item in checked}
        missing_memories = self._check_memory(tx, ctx, checked, purpose, destination, all_dependencies)
        missing_remote = []
        for item in checked:
            if not tx.execute("SELECT 1 FROM scopes WHERE id=? AND kind='mcp'", (item.scope_id,)).fetchone():
                continue
            # 接收本次回执不授予向其它目的地转交资料的许可。
            if purpose == "read":
                continue
            grants = [DataUseGrant.model_validate_json(row[0]) for row in tx.execute(
                "SELECT document FROM grants WHERE (workspace_id IS NULL OR workspace_id=?) AND status='active'",
                (ctx.workspace_id,))]
            covering = next((grant for grant in grants if grant.mcp_versions.get(item.scope_id) == item.epoch
                and (grant.scope.kind == "user_global" or _compatible(grant.scope, ctx.workspace_id, ctx.interaction_session_id))
                and purpose in grant.purposes
                and (purpose not in {"model_send", "tool_send", "local_process_send"}
                    or grant.destination == destination)), None)
            if covering is None:
                missing_remote.append(item.scope_id)
            else:
                all_dependencies[covering.id] = ScopeDependency(scope_id=covering.id, epoch=covering.epoch)
        lineages = {}

        def include_source(resource):
            lineage, current = [], resource
            while current is not None:
                if current.id in lineage:
                    raise DomainError("invalid_resource", "资料父链无效")
                lineage.append(current.id)
                if current.parent_resource_id is None:
                    break
                current = self.resource(ctx, current.parent_resource_id, tx=tx)
                if current.kind != "directory":
                    raise DomainError("invalid_resource", "资料父链无效")
            all_dependencies.setdefault(resource.id, ScopeDependency(scope_id=resource.id,
                                                                     epoch=resource.version))
            sources[resource.id] = resource
            lineages[resource.id] = lineage

        for resource in list(sources.values()):
            include_source(resource)
        # 已绑定来源的 read grant 仅是 provenance 围栏；孤立 grant 则展开来源再检查用途。
        for grant in grant_dependencies:
            if grant.memory_scopes or grant.mcp_versions:
                continue
            if not any(set(grant.resource_ids).intersection(lineage) for lineage in lineages.values()):
                for id in self.resource_closure(tx,[ScopeDependency(scope_id=grant.id,epoch=grant.epoch)],
                        source_run_id=ctx.run_id,source_task_id=ctx.task_id):
                    include_source(self.resource(ctx, id, tx=tx))
        missing = [*missing_memories, *missing_remote]
        candidates = [DataUseGrant.model_validate_json(row[0]) for row in tx.execute(
            "SELECT document FROM grants WHERE workspace_id=? AND status='active' ORDER BY id",
            (ctx.workspace_id,))]
        for id in sources:
            covering = next((grant for grant in candidates
                              if _compatible(grant.scope, ctx.workspace_id, ctx.interaction_session_id)
                              and purpose in grant.purposes
                               and (purpose not in {"model_send", "tool_send", "local_process_send"}
                                    or grant.destination == destination)
                             and set(grant.resource_ids).intersection(lineages[id])), None)
            if covering is None:
                missing.append(id)
            else:
                all_dependencies[covering.id] = ScopeDependency(scope_id=covering.id,
                                                                epoch=covering.epoch)
        try:
            check_scopes(tx, list(all_dependencies.values()))
        except DomainError:
            return PolicyDecision(allowed=False, reason="scope_revoked")
        return PolicyDecision(allowed=not missing, reason="grant_required" if missing else None,
                              missing_grants=missing, dependencies=list(all_dependencies.values()))

    def _check_memory(self, tx, ctx, dependencies, purpose, destination, all_dependencies):
        from flowmate.memory.contracts import MemoryPolicy
        from flowmate.memory.provider import scope_id
        missing = []
        for dependency in dependencies:
            row = tx.execute("SELECT kind FROM scopes WHERE id=?", (dependency.scope_id,)).fetchone()
            if row is None or row["kind"] != "memory":
                continue
            record = self.memory_provider.using(tx).get(dependency.scope_id)
            owner = tx.execute("SELECT user_scope_id FROM local_identity WHERE singleton=1").fetchone()[0]
            if record.owner_id != owner or record.status != "confirmed" or (
                    record.expires_at is not None and record.expires_at <= self.clock()):
                missing.append(record.id)
                continue
            row = tx.execute("SELECT document FROM memory_policies WHERE scope_id=?",
                (scope_id(tx, record.scope),)).fetchone()
            setting = MemoryPolicy.model_validate_json(row[0]) if row else MemoryPolicy(scope=record.scope)
            check_scopes(tx, record.dependencies)
            # 保留原来源的撤权/排除/用途检查；来源会话 epoch 是删除围栏，不扩大文件授权。
            source_dependencies = [item for item in record.dependencies if tx.execute(
                "SELECT 1 FROM scopes WHERE id=? AND kind IN ('resource','grant','memory','mcp')",
                (item.scope_id,)).fetchone()]
            if source_dependencies:
                source_decision = self._check_sources_tx(tx, ctx, source_dependencies, purpose, destination)
                if not source_decision.allowed:
                    missing.extend(source_decision.missing_grants or [record.id])
                    continue
                for item in source_decision.dependencies:
                    if tx.execute("SELECT 1 FROM grants WHERE id=?", (item.scope_id,)).fetchone():
                        all_dependencies[item.scope_id] = item
            if not setting.read_profile or purpose == "export":
                missing.append(record.id)
                continue
            if purpose == "read":
                continue
            grants = [DataUseGrant.model_validate_json(row[0]) for row in tx.execute(
                "SELECT document FROM grants WHERE workspace_id IS ? AND status='active'",
                (record.scope.workspace_id,))]
            grant = next((grant for grant in grants if record.scope in grant.memory_scopes
                and grant.destination == destination and purpose in grant.purposes), None)
            if grant is None:
                missing.append(record.id)
            else:
                all_dependencies[grant.id] = ScopeDependency(scope_id=grant.id, epoch=grant.epoch)
        return missing

    def revoke(self, grant_id: str, meta: CommandMeta) -> DataUseGrant:
        def apply(tx):
            saved = _document(tx, "grants", DataUseGrant, grant_id)
            if meta.expected_version != saved.version:
                raise DomainError("version_conflict", "授权版本已改变")
            if saved.status == "revoked":
                return saved
            revoked = bump(saved, epoch=saved.epoch + 1, status="revoked")
            _policy_event(tx, "grant.revoked", PolicyChange(grants=[revoked]), saved.scope,
                          causation_id=meta.command_id)
            return revoked

        return _command(self.store, "grant.revoke", {"grant_id": grant_id}, meta, DataUseGrant, apply)

    def publish_observation(self, tx: UnitOfWork, ctx: ExecutionContext,
                            observation: SourceObservation) -> ScopeDependency:
        observation = SourceObservation.model_validate(observation.model_dump())
        run, task = _owner(tx, ctx)
        if run.state in TERMINAL or task.state in TERMINAL:
            raise DomainError("owner_inactive", "任务已结束，不能提交来源观察")
        resource = self.resource(ctx, observation.resource_id, tx=tx)
        if resource.source_version == observation.source_version:
            return ScopeDependency(scope_id=resource.id, epoch=resource.version)
        if resource.version != observation.expected_version:
            raise DomainError("version_conflict", "来源版本已改变")
        resource = bump(resource, source_version=observation.source_version)
        _policy_event(tx, "resource.updated", PolicyChange(resources=[resource]), resource.scope,
                      ctx=ctx)
        return ScopeDependency(scope_id=resource.id, epoch=resource.version)
