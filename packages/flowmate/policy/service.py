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
    ExecutionContext,
    RunSnapshot,
    ScopeDependency,
    SourceObservation,
    TaskSnapshot,
)
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
    ScopeRef,
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


def _dependencies(tx, ctx, dependencies):
    """只校验归属和 epoch，不把任何依赖解释为用途许可。"""
    values = [*ctx.scope_dependencies, *dependencies]
    check_scopes(tx, values)
    result = {}
    for item in values:
        if item.scope_id not in {ctx.workspace_id, ctx.session_id}:
            value = (_document(tx, "resources", ResourceRecord, item.scope_id, required=False)
                     or _document(tx, "grants", DataUseGrant, item.scope_id, required=False))
            if value is None or not _compatible(value.scope, ctx.workspace_id, ctx.session_id):
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


def _policy_event(tx, kind, change, scope, *, ctx=None, causation_id=None):
    tx.append_event(NewEvent(kind=kind, payload=change, workspace_id=scope.workspace_id,
                             session_id=scope.session_id, run_id=ctx.run_id if ctx else None,
                             task_id=ctx.task_id if ctx else None,
                             activity_id=ctx.activity_id if ctx else None, causation_id=causation_id))


class PolicyService:
    def __init__(self, store: Store, *, clock=utc_now):
        self.store = store
        self.clock = clock

    def register_selection(self, selection: NativeSelection) -> ResourceRef:
        with self.store.transaction() as tx:
            return self.register_selection_tx(tx, selection)

    def register_selection_tx(self, tx, selection: NativeSelection) -> ResourceRef:
        selection = _selection(selection)
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
        if not _compatible(record.scope, ctx.workspace_id, ctx.session_id):
            raise DomainError("scope_mismatch", "资料不属于当前工作区或会话")
        check_scopes(tx, [ScopeDependency(scope_id=record.id, epoch=record.version)])
        return record

    def grant(self, command: GrantCommand, meta: CommandMeta) -> DataUseGrant:
        command = GrantCommand.model_validate(command.model_dump())
        command = command.model_copy(update={"resource_ids": sorted(set(command.resource_ids)),
                                             "purposes": sorted(set(command.purposes))})
        if "model_send" in command.purposes:
            _endpoint(command.destination)

        def apply(tx):
            if meta.expected_version is not None:
                raise DomainError("version_conflict", "新授权不接受已有版本")
            _scope(tx, command.scope)
            for id in command.resource_ids:
                record = _document(tx, "resources", ResourceRecord, id)
                if not _compatible(record.scope, command.scope.workspace_id, command.scope.session_id):
                    raise DomainError("scope_mismatch", "授权资源超出所选范围")
                check_scopes(tx, [ScopeDependency(scope_id=id, epoch=record.version)])
            for row in tx.execute("SELECT document FROM grants WHERE workspace_id=? AND "
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

    def check(self, ctx: ExecutionContext, dependencies: list[ScopeDependency], purpose: Purpose,
              destination: str | None = None) -> PolicyDecision:
        with self.store.transaction(write=False) as tx:
            return self.check_tx(tx, ctx, dependencies, purpose, destination)

    @staticmethod
    def resource_closure(tx: UnitOfWork, dependencies: list[ScopeDependency], *, source_run_id=None) -> list[str]:
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
        selected = set(load(tx, RunSnapshot, source_run_id).resource_ids) if source_run_id is not None else None
        for resource in list(resources.values()):
            parent_id = resource.parent_resource_id
            while parent_id is not None:
                covered.add(parent_id)
                parent_id = _document(tx, "resources", ResourceRecord, parent_id).parent_resource_id
        for grant in grants:
            if not covered.intersection(grant.resource_ids):
                candidates = {}
                for resource_id in set(grant.resource_ids) | (selected or set()):
                    resource = _document(tx, "resources", ResourceRecord, resource_id)
                    # 孤立grant表示来源Run已选择的资料，不把同grant其他资源冒充实际输入。
                    lineage = {resource.id}
                    parent_id = resource.parent_resource_id
                    while parent_id is not None:
                        lineage.add(parent_id)
                        parent_id = _document(tx, "resources", ResourceRecord, parent_id).parent_resource_id
                    if (resource.kind != "export" and lineage.intersection(grant.resource_ids)
                            and (selected is None or lineage.intersection(selected))):
                        candidates[resource.id] = resource
                if not candidates and any(_document(tx, "resources", ResourceRecord, id).kind != "export"
                                          for id in grant.resource_ids):
                    raise DomainError("outside_run_scope", "授权来源不属于原运行选择范围")
                resources.update(candidates)
        return sorted(resources)

    @staticmethod
    def check_run_sources(tx: UnitOfWork, ctx: ExecutionContext,
                          dependencies: list[ScopeDependency], *, source_run_id=None) -> None:
        run = load(tx, RunSnapshot, ctx.run_id)
        selected = set(run.resource_ids)
        for resource_id in PolicyService.resource_closure(tx, dependencies, source_run_id=source_run_id or ctx.run_id):
            resource = _document(tx, "resources", ResourceRecord, resource_id)
            while resource.id not in selected:
                if resource.parent_resource_id is None:
                    raise DomainError("outside_run_scope", "资料不在本次固定范围，请选择资料后新建运行")
                resource = _document(tx, "resources", ResourceRecord, resource.parent_resource_id)

    def check_tx(self, tx: UnitOfWork, ctx: ExecutionContext, dependencies: list[ScopeDependency],
                 purpose: Purpose, destination: str | None = None) -> PolicyDecision:
        if purpose not in {"read", "model_send", "export"}:
            raise DomainError("invalid_purpose", "不支持的资料用途")
        if purpose == "model_send":
            _endpoint(destination)
        run, task = _owner(tx, ctx)
        if run.state in TERMINAL or task.state in TERMINAL:
            return PolicyDecision(allowed=False, reason="owner_inactive")
        try:
            checked = _dependencies(tx, ctx, dependencies)
        except DomainError as error:
            if error.code != "scope_revoked":
                raise
            return PolicyDecision(allowed=False, reason=error.code)
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
            if not any(set(grant.resource_ids).intersection(lineage) for lineage in lineages.values()):
                for id in grant.resource_ids:
                    include_source(self.resource(ctx, id, tx=tx))
        missing = []
        candidates = [DataUseGrant.model_validate_json(row[0]) for row in tx.execute(
            "SELECT document FROM grants WHERE workspace_id=? AND status='active' ORDER BY id",
            (ctx.workspace_id,))]
        for id in sources:
            covering = next((grant for grant in candidates
                             if _compatible(grant.scope, ctx.workspace_id, ctx.session_id)
                              and purpose in grant.purposes
                              and (purpose != "model_send" or grant.destination == destination)
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
