"""资料用途授权；可信选择不读正文，所有变更与 scope 围栏原子提交。"""

import hashlib
import json
import ntpath
import re
from pathlib import PureWindowsPath
from urllib.parse import urlsplit
from uuid import UUID, uuid5

from flowmate.contracts.base import CommandMeta, DomainError
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    ArtifactRef,
    Checkpoint,
    ExecutionContext,
    McpResultSource,
    RunSnapshot,
    ScopeDependency,
    SourceObservation,
    TaskSnapshot,
)
from flowmate.contracts.scopes import ScopeRef
from flowmate.contracts.settings import ModelConnection
from flowmate.persistence.store import Store, UnitOfWork
from flowmate.policy.contracts import (
    DataUseGrant,
    FilePinInvalidReason,
    GrantCommand,
    NativeSelection,
    PolicyChange,
    PolicyDecision,
    Purpose,
    ResourceCoverage,
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


def _unique_dependencies(dependencies):
    unique = {}
    for item in dependencies:
        previous = unique.get(item.scope_id)
        if previous is not None and previous.epoch != item.epoch:
            raise DomainError("source_version_conflict", "同一来源包含冲突的授权版本")
        unique[item.scope_id] = item
    return list(unique.values())


def _dependencies(tx, ctx, dependencies, *, artifact_id=None):
    """只校验归属和 epoch，不把任何依赖解释为用途许可。"""
    values = _unique_dependencies([*ctx.scope_dependencies, *dependencies])
    skill_provenance = set()
    for item in list(values):
        if tx.execute("SELECT 1 FROM scopes WHERE id=? AND kind='skill'", (item.scope_id,)).fetchone():
            version = PolicyService.skill_version(tx, ctx, item.scope_id)
            values.extend(version.dependencies)
            skill_provenance.update(dep.scope_id for dep in version.dependencies)
    artifact_sources = set()
    task = load(tx, TaskSnapshot, ctx.task_id)
    if task.binding.input_result is not None:
        from flowmate.runtime.tasks import selected_results
        for selected in selected_results(tx, ctx, task.binding):
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
    values = _unique_dependencies(values)
    check_scopes(tx, values)
    result = {}
    for item in values:
        if item.scope_id not in {ctx.workspace_id, ctx.session_id,ctx.interaction_session_id}:
            memory_scope = tx.execute("SELECT kind FROM scopes WHERE id=?", (item.scope_id,)).fetchone()
            if memory_scope is not None and memory_scope[0] == "mcp":
                if tx.execute("SELECT 1 FROM activities WHERE id=? "
                        "AND json_extract(document,'$.mcp_source') IS NOT NULL", (item.scope_id,)).fetchone():
                    result[item.scope_id] = item
                    continue
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
                # 新委派可引用父任务已收件且已固定在目标上的交付来源，私有会话仍按任务隔离。
                if not any(row[0] in ancestors or ctx.task_id in task_ancestors(tx,row[0]) for row in targets) and not (
                        task.binding.agent_work is not None and tx.execute(
                            "SELECT 1 FROM consumptions c JOIN tasks delivered ON delivered.id=c.target_task_id "
                            "JOIN messages goal ON goal.task_id=? AND goal.id=(SELECT id FROM messages "
                            "WHERE task_id=? ORDER BY event_id,event_index LIMIT 1) "
                            "WHERE c.consumer_task_id=? AND delivered.parent_task_id=c.consumer_task_id "
                            "AND delivered.run_id=? AND delivered.execution_session_id=? "
                            "AND c.result_version=json_extract(delivered.document,'$.result_version') "
                            "AND EXISTS(SELECT 1 FROM json_each(goal.document,'$.source_dependencies') d "
                            "WHERE json_extract(d.value,'$.scope_id')=? AND json_extract(d.value,'$.epoch')=?)",
                            (task.id, task.id, task.parent_task_id, task.run_id, item.scope_id,
                             item.scope_id, item.epoch)).fetchone()):
                    raise DomainError("scope_mismatch", "私有执行依赖不属于授权任务链")
            elif value is not None and not (
                     isinstance(value, DataUseGrant) and (value.memory_scopes or value.mcp_versions or value.mcp_queries)
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


def _mcp_configuration(tx, server_id):
    from flowmate.integrations.configuration_contracts import McpToolSelection
    from flowmate.integrations.contracts import McpServerConfig

    row = tx.execute("SELECT document FROM mcp_servers WHERE id=?", (server_id,)).fetchone()
    if row is None:
        raise DomainError("mcp_server_unavailable", "MCP 配置不存在")
    stored = json.loads(row[0])
    config = McpServerConfig.model_validate({key: value for key, value in stored.items()
        if key in McpServerConfig.model_fields})
    selection = McpToolSelection.model_validate(stored["selection"]) if stored.get("selection") is not None else None
    return config, selection, stored.get("connection_identity") is not None


def _mcp_binding_current(config, selection, binding, workspace_id):
    from flowmate.integrations.tools import mcp_destination

    return (config.enabled and config.scope.workspace_id in {None, workspace_id}
        and config.revision == binding.config_revision and mcp_destination(config) == binding.destination
        and (selection is None or selection.config_revision == binding.config_revision
            and binding.original_name in selection.selected_names))


def _same_mcp_tool(first, second):
    return (first.server_id, first.config_revision, first.original_name, first.destination) == (
        second.server_id, second.config_revision, second.original_name, second.destination)


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
            from flowmate.runtime.tasks import selected_results
            chosen = next((ref for selected in selected_results(tx, ctx, task.binding)
                           for ref in selected.artifacts if ref.id == artifact.id), None)
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
        if sum(bool(value) for value in (command.resource_ids, command.memory_scopes, command.mcp_versions, command.mcp_queries)) != 1:
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
            if command.mcp_queries:
                from flowmate.integrations.permissions import check_query_binding
                if (len(command.mcp_queries) != 1 or command.purposes != ["model_send"]
                        or command.scope.kind == "session"):
                    raise DomainError("invalid_grant", "公共查询许可须绑定个人或项目范围及一个模型目的地")
                for binding in command.mcp_queries:
                    check_query_binding(tx, binding, command.scope)
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
            if grant.memory_scopes or grant.mcp_versions or grant.mcp_queries:
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

    def check_run_sources(self, tx: UnitOfWork, ctx: ExecutionContext,
                          dependencies: list[ScopeDependency], *, source_run_id=None,
                          source_task_id=None, selection=None) -> None:
        self._check_run_sources(tx, ctx, dependencies, source_run_id=source_run_id,
            source_task_id=source_task_id, selection=selection, memory_provider=self.memory_provider)

    @staticmethod
    def _check_run_sources(tx, ctx, dependencies, *, source_run_id=None, source_task_id=None,
                           selection=None, memory_provider=None):
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
            if run.kind == "follow_up":
                selected = task.binding.input_result
                if (scope.workspace_id not in {None, ctx.workspace_id} or selected is None or
                        not any(dependency in pin.dependencies
                                for pin in [selected, *task.binding.additional_result_inputs])):
                    raise DomainError("outside_run_scope", "自动总结只能使用明确交付的记忆身份与修订")
                continue
            if scope.workspace_id not in {None, ctx.workspace_id}:
                raise DomainError("outside_run_scope", "记忆不在 Run 与 Task 的固定交集范围")
            if any(scope not in chosen.memory_scopes for chosen in selections):
                if memory_provider is None or not PolicyService._default_memory_profile(
                    run, task, memory_provider.using(tx).get(dependency.scope_id),
                    personal=selection is None,
                ):
                    raise DomainError("outside_run_scope", "记忆不在 Run 与 Task 的固定交集范围")
        source_run = load(tx,RunSnapshot,source_run_id) if source_run_id is not None else run
        source_task_id = (source_task_id if source_task_id is not None else
                          task.id if source_run.id == run.id else source_run.root_task_id)
        selected = task.binding.input_result
        if selected is not None and source_run.id == run.id:
            resources = set()
            remaining = list(dependencies)
            for pin in [selected, *task.binding.additional_result_inputs]:
                scoped = [dependency for dependency in dependencies if dependency in pin.dependencies]
                remaining = [dependency for dependency in remaining if dependency not in scoped]
                resources.update(PolicyService.resource_closure(tx, scoped,
                    source_run_id=pin.handle.run_id, source_task_id=pin.handle.task_id))
            resources.update(PolicyService.resource_closure(tx, remaining,
                source_run_id=source_run.id, source_task_id=source_task_id))
        else:
            resources = PolicyService.resource_closure(tx, dependencies,
                source_run_id=source_run.id, source_task_id=source_task_id)
        for resource_id in resources:
            resource = _document(tx, "resources", ResourceRecord, resource_id)
            source_pin = source_run.file_inputs.get(resource_id)
            current_pin = run.file_inputs.get(resource_id)
            if source_pin is not None and PolicyService.file_pin_invalid_reason(tx, resource_id, source_pin):
                raise DomainError("source_version_conflict", "固定文件版本已失效，请重新选择文件")
            if (source_run.id != run.id and run.kind == "user" and task.kind == "agent"
                    and resource.kind == "file"):
                if not PolicyService.same_model_recipient(
                        source_run.config.model_profile, task.binding.config.model_profile):
                    raise DomainError("outside_run_scope", "历史文件不属于本轮接收方")
                if source_pin is not None and (current_pin is None
                        or source_pin.file_identity != current_pin.file_identity
                        or source_pin.source_version != current_pin.source_version):
                    raise DomainError("outside_run_scope", "历史文件不属于本轮所选版本")
            if (current_pin is not None and run.attached_file_ids is not None
                    and resource_id not in run.attached_file_ids):
                if (task.id != run.root_task_id or selection is not None
                        or not PolicyService.file_inheritance_grants(tx, ctx.workspace_id,
                            ctx.interaction_session_id, resource_id, current_pin,
                            task.binding.config.model_profile.endpoint,
                            excluded=excluded)):
                    raise DomainError("outside_run_scope", "文件续读授权已撤回或不适用于此任务")
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
        return self._check_sources_tx(tx, ctx, dependencies, purpose, destination,
            artifact_id=artifact_id, selected_process=purpose == "local_process_send")

    def check_script_submission(self, tx, ctx, arguments, dependencies):
        """只接纳固定脚本参数的来源用途；不构造 Activity，也不授予派发资格。"""
        from flowmate.skills.execution.contracts import RunSkillScript, process_destination

        args = RunSkillScript.model_validate(arguments)
        destination = _local_destination(tx, process_destination(args.skill_id, args.content_hash,
            args.environment_id, args.environment_revision))
        return self._check_sources_tx(tx, ctx, dependencies, "local_process_send", destination)

    def mcp_call_permission(self, tx, ctx, binding):
        """本次用户任务消费已确认的连接与工具选择，不扩大资料外发许可。"""
        run, task = _owner(tx, ctx)
        config, selection, trusted = _mcp_configuration(tx, binding.server_id)
        if (binding not in task.binding.config.catalog.mcp_tools.values()
                or not _mcp_binding_current(config, selection, binding, ctx.workspace_id)):
            raise DomainError("tool_unavailable", "MCP 工具配置已改变或已被用户停用")
        if run.kind == "user" and trusted and run.state not in TERMINAL and task.state not in TERMINAL:
            return PolicyDecision(allowed=True)
        dependencies = []
        for row in tx.execute("SELECT document FROM grants WHERE status='active' "
                "AND (workspace_id IS NULL OR workspace_id=?) AND json_extract(document,'$.destination')=? "
                "AND EXISTS(SELECT 1 FROM json_each(grants.document,'$.mcp_queries') q "
                "WHERE json_extract(q.value,'$.server_id')=?) ORDER BY id",
                (ctx.workspace_id, task.binding.config.model_profile.endpoint, binding.server_id)):
            grant = DataUseGrant.model_validate_json(row[0])
            granted = next((item for item in grant.mcp_queries if _same_mcp_tool(item, binding)), None)
            if granted is None:
                continue
            if config.scope != grant.scope or config.transport == "stdio" and not trusted:
                raise DomainError("blocked_incompatible", "公共查询许可不再对应当前工具选择")
            if granted.catalog_hash != binding.catalog_hash:
                from flowmate.integrations.tools import compatible_tool, stored_catalog
                compatible_tool(config, stored_catalog(tx, config.id, binding.catalog_hash),
                    stored_catalog(tx, config.id, granted.catalog_hash), binding.original_name)
            dependencies.append(ScopeDependency(scope_id=grant.id, epoch=grant.epoch))
            break
        return PolicyDecision(allowed=bool(dependencies), dependencies=dependencies)

    @staticmethod
    def check_user_artifact_sources(tx, workspace_id, dependencies):
        """本地历史按已实际使用的 MCP 查询许可及来源核验，无需重新申请模型发送许可。"""
        for dependency in dependencies:
            row = tx.execute("SELECT kind FROM scopes WHERE id=?", (dependency.scope_id,)).fetchone()
            if row is None:
                continue
            if row[0] in {"memory", "mcp"}:
                check_scopes(tx, [dependency])
            elif row[0] == "grant":
                grant = _document(tx, "grants", DataUseGrant, dependency.scope_id)
                if not grant.mcp_queries:
                    continue
                check_scopes(tx, [dependency])
                for binding in grant.mcp_queries:
                    config, selection, _ = _mcp_configuration(tx, binding.server_id)
                    if config.scope != grant.scope or not _mcp_binding_current(config, selection, binding, workspace_id):
                        raise DomainError("scope_revoked", "MCP 查询授权已失效")

    def _check_sources_tx(self, tx, ctx, dependencies, purpose, destination, *, artifact_id=None,
            selected_process=False):
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
        missing_memories = self._check_memory(tx, ctx, run, task, checked, purpose, destination, all_dependencies)
        missing_remote = []
        remote_dependencies = [item for item in checked if tx.execute(
            "SELECT 1 FROM scopes WHERE id=? AND kind='mcp'", (item.scope_id,)).fetchone()]
        result_sources, configurations = {}, {}
        for item in remote_dependencies:
            row = tx.execute("SELECT run_id,task_id,state,json_extract(document,'$.content_committed'),"
                "json_extract(document,'$.mcp_source') FROM activities WHERE id=?", (item.scope_id,)).fetchone()
            if row is not None and row[4] is not None:
                result_sources[item.scope_id] = (row, McpResultSource.model_validate_json(row[4]))
        return_destination = purpose == "model_send" and destination == task.binding.config.model_profile.endpoint
        if result_sources and purpose == "tool_send":
            target = task.binding.config.catalog.mcp_tools[load(tx, ActivitySnapshot, ctx.activity_id).intent.operation]
            return_destination = self.mcp_call_permission(tx, ctx, target).allowed
        candidates = None

        def remote_grants():
            nonlocal candidates
            if candidates is None:
                candidates = [DataUseGrant.model_validate_json(row[0]) for row in tx.execute(
                    "SELECT document FROM grants WHERE (workspace_id IS NULL OR workspace_id=?) AND status='active'",
                    (ctx.workspace_id,))]
            return candidates

        for grant in grant_dependencies:
            for binding in grant.mcp_queries:
                if binding.server_id not in configurations:
                    configurations[binding.server_id] = _mcp_configuration(tx, binding.server_id)
                config, selection, _ = configurations[binding.server_id]
                if config.scope != grant.scope or not _mcp_binding_current(config, selection, binding, ctx.workspace_id):
                    missing_remote.append(grant.id)
                    continue
                permitted = (purpose == "read"
                    or purpose == "model_send" and grant.destination == destination
                    or purpose == "model_send" and return_destination
                    and any(source_row[0] == run.vision_source_run_id
                        and source_row[1] == task.origin_task_id
                        and _same_mcp_tool(source.binding, binding)
                        and any(ref.activity_id == activity_id for ref in task.binding.input_artifacts)
                        for activity_id, (source_row, source) in result_sources.items())
                    or purpose == "tool_send" and binding.destination == destination
                    and ctx.activity_id is not None and _same_mcp_tool(task.binding.config.catalog.mcp_tools[
                        load(tx, ActivitySnapshot, ctx.activity_id).intent.operation], binding))
                if not permitted:
                    # 查询许可本身是具体结果的来源；不能据此放行同服务器的其它工具回执。
                    covering = next((value for value in remote_grants() if value.mcp_versions.get(
                        binding.server_id) == binding.config_revision and purpose in value.purposes
                        and value.destination == destination
                        and (value.scope.kind == "user_global" or _compatible(
                            value.scope, ctx.workspace_id, ctx.interaction_session_id))), None)
                    if covering is None:
                        missing_remote.append(grant.id)
                    else:
                        all_dependencies[covering.id] = ScopeDependency(scope_id=covering.id, epoch=covering.epoch)
        for item in remote_dependencies:
            server_id, revision = item.scope_id, item.epoch
            if item.scope_id in result_sources:
                row, source = result_sources[item.scope_id]
                binding = source.binding
                server_id, revision = binding.server_id, binding.config_revision
                if server_id not in configurations:
                    configurations[server_id] = _mcp_configuration(tx, server_id)
                config, selection, _ = configurations[server_id]
                check_scopes(tx, [ScopeDependency(scope_id=server_id, epoch=revision)])
                if (not _mcp_binding_current(config, selection, binding, ctx.workspace_id)
                        or server_id in {*run.sources.excluded_source_ids, *task.binding.sources.excluded_source_ids}):
                    missing_remote.append(item.scope_id)
                    continue
                if purpose != "read" and not row[3]:
                    missing_remote.append(item.scope_id)
                    continue
                if (row[0], row[1]) == (ctx.run_id, ctx.task_id) and return_destination and (
                        purpose != "model_send" or destination == source.model_destination):
                    continue
                if (purpose == "model_send" and return_destination
                        and run.vision_source_run_id == row[0] and task.origin_task_id == row[1]
                        and any(item.scope_id in {dependency.scope_id for dependency in ref.dependencies}
                            for ref in task.binding.input_artifacts)):
                    # 用户本次选择的接收方只消费明确保存的原调用图片，不扩大其它回执范围。
                    continue
            # 接收本次回执不授予向其它目的地转交资料的许可。
            if purpose == "read":
                continue
            covering = next((grant for grant in remote_grants() if grant.mcp_versions.get(server_id) == revision
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
            if grant.memory_scopes or grant.mcp_versions or grant.mcp_queries:
                continue
            if not any(set(grant.resource_ids).intersection(lineage) for lineage in lineages.values()):
                for id in self.resource_closure(tx,[ScopeDependency(scope_id=grant.id,epoch=grant.epoch)],
                        source_run_id=ctx.run_id,source_task_id=ctx.task_id):
                    include_source(self.resource(ctx, id, tx=tx))
        missing = [*missing_memories, *missing_remote]
        missing_resources, grants = self._cover_resources(tx, ctx.workspace_id, ctx.interaction_session_id,
            lineages, purpose, destination)
        if run.attached_file_ids is not None:
            for id in (lineages.keys() & run.file_inputs.keys()) - set(run.attached_file_ids):
                grants.extend(run.file_inputs[id].inheritance_grants)
        if selected_process:
            from flowmate.skills.execution.contracts import RunSkillScript
            from flowmate.skills.execution.permissions import selected_script
            from flowmate.skills.service import SkillService

            activity = load(tx, ActivitySnapshot, ctx.activity_id)
            args = RunSkillScript.model_validate(ToolInvocation.model_validate(activity.intent.arguments).arguments)
            if selected_script(tx, ctx, args, SkillService(self.store)):
                chosen = set(run.sources.resource_ids).intersection(task.binding.sources.resource_ids)
                if run.attached_file_ids is not None:
                    chosen.difference_update(run.file_inputs.keys() - set(run.attached_file_ids))
                missing_resources = [id for id in missing_resources
                    if id not in args.input_refs or not chosen.intersection(lineages[id])]
        missing.extend(missing_resources)
        all_dependencies.update({item.scope_id: item for item in grants})
        try:
            check_scopes(tx, list(all_dependencies.values()))
        except DomainError:
            return PolicyDecision(allowed=False, reason="scope_revoked")
        return PolicyDecision(allowed=not missing, reason="grant_required" if missing else None,
                              missing_grants=missing, dependencies=list(all_dependencies.values()))

    @staticmethod
    def matching_resource_grants(tx, workspace_id, session_id, lineages, purpose, destination):
        resource_ids = {resource_id for lineage in lineages.values() for resource_id in lineage}
        if not resource_ids:
            return
        candidates = {}
        grants_by_resource = {}
        for row in tx.execute(
                "SELECT g.id, g.document, resource.value AS resource_id FROM grants g "
                "JOIN scopes s ON s.id=g.id JOIN json_each(g.document,'$.resource_ids') resource "
                "WHERE g.workspace_id=? AND (g.session_id IS NULL OR g.session_id=?) "
                "AND g.status='active' AND s.status='active' AND s.epoch=json_extract(g.document,'$.epoch') "
                "AND resource.value IN (SELECT value FROM json_each(?)) "
                "AND EXISTS (SELECT 1 FROM json_each(g.document,'$.purposes') WHERE value=?) "
                "AND (?=0 OR json_extract(g.document,'$.destination') IS ?) ORDER BY g.id",
                (workspace_id, session_id, json.dumps(list(resource_ids)), purpose,
                 purpose in {"model_send", "tool_send", "local_process_send"}, destination)):
            grant_id = row["id"]
            if grant_id not in candidates:
                candidates[grant_id] = DataUseGrant.model_validate_json(row["document"])
            grants_by_resource.setdefault(row["resource_id"], set()).add(grant_id)
        for id, lineage in lineages.items():
            covering = {grant_id for resource_id in lineage for grant_id in grants_by_resource.get(resource_id, ())}
            yield id, (candidates[grant_id] for grant_id in sorted(covering))

    @staticmethod
    def _cover_resources(tx, workspace_id, session_id, lineages, purpose, destination):
        missing, dependencies = [], []
        for id, grants in PolicyService.matching_resource_grants(
                tx, workspace_id, session_id, lineages, purpose, destination):
            covering = next(grants, None)
            if covering is None:
                missing.append(id)
            else:
                dependencies.append(ScopeDependency(scope_id=covering.id, epoch=covering.epoch))
        return missing, dependencies

    @staticmethod
    def same_model_recipient(first, second):
        from flowmate.models.endpoints import resolve_model_endpoint

        def binding(profile):
            address = resolve_model_endpoint(profile.protocol, profile.endpoint)
            connection_id = profile.id if isinstance(profile, ModelConnection) else profile.connection_id
            return connection_id, address.protocol, address.sdk_operation_url, profile.secret_ref

        return binding(first) == binding(second)

    @staticmethod
    def file_pin_invalid_reason(tx, resource_id, pin, *, admitted_event_id=None):
        """查询已确认的失效事实，以及接纳后的现行来源观察。"""
        resource = _document(tx, "resources", ResourceRecord, resource_id, required=False)
        if resource is None:
            return None
        if (hashlib.sha256(resource.file_identity.encode()).hexdigest() != pin.file_identity
                or "file_identity_changed" in resource.file_pin_invalidations.values()):
            return "file_identity_changed"
        if pin.source_version in resource.file_pin_invalidations:
            return "file_source_changed"
        if admitted_event_id is not None and resource.source_version not in {None, pin.source_version}:
            observed = tx.execute(
                "SELECT e.event_id FROM events e "
                "JOIN json_each(e.document,'$.payload.resources') observed "
                "WHERE e.workspace_id=? AND json_extract(e.document,'$.kind')='resource.updated' "
                "AND json_extract(observed.value,'$.id')=? AND json_extract(observed.value,'$.version')=? "
                "ORDER BY e.event_id LIMIT 1",
                (resource.scope.workspace_id, resource.id, resource.version),
            ).fetchone()
            if observed is not None and observed[0] > admitted_event_id:
                return "file_source_changed"
        return None

    def record_file_pin_invalid(self, ctx, resource_id, reason: FilePinInvalidReason):
        """本机工具已派发并确认变更时记事实，即使其回执只允许结算。"""
        with self.store.transaction() as tx:
            activity = _document(tx, "activities", ActivitySnapshot, ctx.activity_id, required=False)
            if activity is None:
                return  # 删除已清理活动，不重建已删除资料。
            if ((activity.run_id, activity.task_id) != (ctx.run_id, ctx.task_id)
                    or activity.intent.kind != "tool" or activity.request_digest is None):
                raise DomainError("tool_binding", "文件失效观察不属于已派发工具")
            invocation = ToolInvocation.model_validate(activity.intent.arguments)
            if invocation.name == "files.inspect_batch":
                requested = invocation.arguments["resource_ids"]
            elif invocation.name == "files.read_text":
                requested = [invocation.arguments["resource_id"]]
            else:
                raise DomainError("tool_binding", "文件失效观察不属于本机读取工具")
            pin = load(tx, TaskSnapshot, ctx.task_id).binding.file_inputs.get(resource_id)
            if pin is None or resource_id not in requested:
                raise DomainError("tool_binding", "文件失效观察不属于固定工具输入")
            resource = _document(tx, "resources", ResourceRecord, resource_id, required=False)
            if resource is None or not tx.execute("SELECT 1 FROM scopes WHERE id=? AND status='active'",
                    (resource_id,)).fetchone():
                return
            if (reason == resource.file_pin_invalidations.get(pin.source_version)
                    or "file_identity_changed" in resource.file_pin_invalidations.values()):
                return
            updated = resource.model_copy(update={"file_pin_invalidations": {
                **resource.file_pin_invalidations, pin.source_version: reason}})
            # 未采用新文件，因此不推进已观察正文的 epoch。
            _policy_event(tx, "resource.updated", PolicyChange(resources=[updated]), resource.scope, ctx=ctx)

    @staticmethod
    def session_file_message_id(run_id):
        return str(uuid5(UUID(run_id), "context.session_files"))

    @staticmethod
    def available_session_files(tx, ctx, run, task, destination):
        if task.id != run.root_task_id or run.attached_file_ids is None:
            return []
        attached = set(run.attached_file_ids)
        excluded = {*run.sources.excluded_source_ids, *task.binding.sources.excluded_source_ids}
        return [id for id, pin in task.binding.file_inputs.items()
            if id not in attached and run.file_inputs.get(id) == pin
            and not PolicyService.file_pin_invalid_reason(tx, id, pin)
            and PolicyService.file_inheritance_grants(
                tx, ctx.workspace_id, ctx.interaction_session_id, id, pin, destination, excluded=excluded)]

    @staticmethod
    def file_inheritance_grants(tx, workspace_id, session_id, id, pin, destination, *,
                                admitted_event_id=None, excluded=()):
        """续读仍需同一文件身份、有效父链和最初覆盖的授权版本。"""
        resource = _document(tx, "resources", ResourceRecord, id, required=False)
        if (resource is None or resource.kind != "file"
                or hashlib.sha256(resource.file_identity.encode()).hexdigest() != pin.file_identity):
            return []
        lineage = []
        current = resource
        while current is not None:
            if (current.id in excluded or not _compatible(current.scope, workspace_id, session_id)
                    or not tx.execute("SELECT 1 FROM scopes WHERE id=? AND epoch=? AND status='active'",
                        (current.id, current.version)).fetchone()):
                return []
            lineage.append(current.id)
            current = (_document(tx, "resources", ResourceRecord, current.parent_resource_id)
                if current.parent_resource_id is not None else None)
        fixed = pin.inheritance_grants
        grants = []
        for purpose, target in (("read", None), ("model_send", destination)):
            (_, covering), = PolicyService.matching_resource_grants(
                tx, workspace_id, session_id, {id: lineage}, purpose, target)
            for grant in covering:
                dependency = ScopeDependency(scope_id=grant.id, epoch=grant.epoch)
                if fixed is not None and dependency not in fixed:
                    continue
                if fixed is None and admitted_event_id is not None and not tx.execute(
                    "SELECT 1 FROM events e JOIN json_each(e.document,'$.payload.grants') g "
                    "WHERE e.workspace_id=? AND e.event_id<? AND json_extract(e.document,'$.kind')='grant.created' "
                    "AND json_extract(g.value,'$.id')=?",
                    (workspace_id, admitted_event_id, grant.id),
                ).fetchone():
                    continue
                grants.append(dependency)
                break
            else:
                return []
        return _unique_dependencies(grants)

    def resource_coverage(self, session_id, request):
        """草稿覆盖与派发策略共用用途匹配；查询结果不授予执行资格。"""
        from flowmate.contracts.settings import Session
        from flowmate.settings import SettingsService

        with self.store.transaction(write=False) as tx:
            session = _document(tx, "sessions", Session, session_id)
            _scope(tx, ScopeRef(kind="session", workspace_id=session.workspace_id, session_id=session.id))
            model = SettingsService.resolve_model(tx, request.model_profile_id)
            lineages = {}
            for id in request.resource_ids:
                lineage, current = [], _document(tx, "resources", ResourceRecord, id)
                if current.kind == "export":
                    raise DomainError("invalid_resource", "导出目标不能作为附件来源")
                while current is not None:
                    if not _compatible(current.scope, session.workspace_id, session.id):
                        raise DomainError("scope_mismatch", "资料不属于当前会话")
                    check_scopes(tx, [ScopeDependency(scope_id=current.id, epoch=current.version)])
                    lineage.append(current.id)
                    current = (_document(tx, "resources", ResourceRecord, current.parent_resource_id)
                        if current.parent_resource_id is not None else None)
                lineages[id] = lineage
            read, _ = self._cover_resources(tx, session.workspace_id, session.id, lineages, "read", None)
            send, _ = self._cover_resources(tx, session.workspace_id, session.id, lineages, "model_send", model.endpoint)
            return ResourceCoverage(allowed=not read and not send, destination=model.endpoint,
                missing_read=read, missing_model_send=send)

    @staticmethod
    def _default_memory_profile(run, task, record, *, personal=True):
        return record.project_preference or (
            personal and run.kind == "user" and task.id == run.root_task_id and record.personal_preference)

    def _check_memory(self, tx, ctx, run, task, dependencies, purpose, destination, all_dependencies):
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
            selected = all(record.scope in selection.memory_scopes for selection in (run.sources, task.binding.sources))
            if not selected and run.kind != "follow_up":
                if not self._default_memory_profile(run, task, record) or purpose not in {"model_send", "read"}:
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
            from flowmate.memory.lifecycle import notify_personal_source_revocation
            notify_personal_source_revocation(tx, self.memory_provider.using(tx), revoked)
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
