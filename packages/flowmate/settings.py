"""持久身份与不可变配置修订；命令去重先于版本检查。"""

import hashlib
import json
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import TypeVar

from pydantic import TypeAdapter

from flowmate.contracts.base import CommandMeta, Contract, DomainError, Id, Name
from flowmate.contracts.events import AgentSaved, NewEvent
from flowmate.contracts.execution import ModelSelection, ResolvedMember, ScopeDependency
from flowmate.contracts.settings import (
    AgentProfile,
    ModelConnection,
    ModelProfile,
    ResolvedModelProfile,
    Session,
    TitlePolicy,
    Workspace,
)
from flowmate.contracts.workspaces import WorkspaceDirectoryResult
from flowmate.persistence.store import ProfileKind, Store, UnitOfWork
from flowmate.policy.contracts import ResourceRecord
from flowmate.runtime.transitions import check_scopes

T = TypeVar("T", bound=Contract)
NAME = TypeAdapter(Name)
IDENTIFIER = TypeAdapter(Id)


class SettingsService:
    def __init__(self, store: Store):
        self.store = store
        self.model_discovery = None

    @asynccontextmanager
    async def model_resolution_scope(self, model_id: str, *, include_members: bool = False,
                                     command_id: str | None = None):
        """宿主装配的发现服务负责凭据核验；纯离线 Settings 没有本站声明。"""
        if self.model_discovery is None:
            yield
            return
        if command_id is not None:
            with self.store.transaction(write=False) as tx:
                received = tx.previous_command(command_id) is not None
            if received:
                yield
                return
        async with self.model_discovery.resolution_scope(model_id, include_members=include_members):
            yield

    @staticmethod
    def _registered_default_agent(tx: UnitOfWork) -> AgentProfile | None:
        row = tx.execute("SELECT profile_id FROM assistant_identity WHERE singleton = 1").fetchone()
        return tx.get_profile("agent", row[0]) if row is not None else None

    @classmethod
    def _default_agent(cls, tx: UnitOfWork) -> AgentProfile:
        registered = cls._registered_default_agent(tx)
        if registered is not None:
            return registered
        profile = AgentProfile()
        tx.append_event(NewEvent(kind="agent.saved", payload=AgentSaved(
            profile=profile, set_default=True,
        )))
        return profile

    def default_agent(self) -> AgentProfile:
        with self.store.transaction() as tx:
            return self._default_agent(tx)

    def get_default_agent(self) -> AgentProfile:
        with self.store.transaction(write=False) as tx:
            profile = self._registered_default_agent(tx)
            if profile is None:
                raise DomainError("not_found", "默认助理尚未登记")
            return profile

    @staticmethod
    def _workspace(tx: UnitOfWork, workspace_id: str) -> Workspace:
        row = tx.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
        if row is None:
            raise DomainError("not_found", "工作区不存在")
        return Workspace.model_validate(dict(row))

    @staticmethod
    def _create_workspace(tx: UnitOfWork, name: str, meta: CommandMeta, *, default=False) -> Workspace:
        if meta.expected_version is not None:
            raise DomainError("version_conflict", "创建工作区不接受已有版本")
        workspace = Workspace(name=name)
        tx.append_event(NewEvent(kind="workspace.default_created" if default else "workspace.created", payload=workspace,
                                 workspace_id=workspace.id, causation_id=meta.command_id))
        return workspace

    def default_workspace(self) -> Workspace:
        with self.store.transaction() as tx:
            row = tx.execute("SELECT workspace_id FROM workspace_identity WHERE singleton=1").fetchone()
            if row is not None:
                return self._workspace(tx, row[0])
            return self._create_workspace(tx, "日常", CommandMeta(), default=True)

    def _command(
        self, operation: str, parameters: dict, meta: CommandMeta,
        result_type: type[T], apply: Callable[[UnitOfWork], T],
    ) -> T:
        meta = CommandMeta.model_validate(meta.model_dump())
        canonical = json.dumps({
            "operation": operation, "parameters": parameters,
            "expected_version": meta.expected_version,
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
        with self.store.transaction() as tx:
            previous = tx.previous_command(meta.command_id)
            if previous is not None:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict", "同一命令不能更改参数")
                return result_type.model_validate_json(previous["response"])
            result = apply(tx)
            workspace_id = result.workspace_id if isinstance(result, TitlePolicy) else result.id if isinstance(result, Workspace) else (
                result.workspace_id if isinstance(result, Session) else
                result.workspace.id if isinstance(result, WorkspaceDirectoryResult) else None
            )
            session_id = result.id if isinstance(result, Session) else None
            tx.execute("INSERT INTO commands VALUES (?, ?, ?, ?, ?)",
                       (meta.command_id, fingerprint, result.model_dump_json(),
                        workspace_id, session_id))
            return result

    def create_workspace(self, name: str, meta: CommandMeta) -> Workspace:
        name = NAME.validate_python(name, strict=True)

        def apply(tx: UnitOfWork) -> Workspace:
            return self._create_workspace(tx, name, meta)

        return self._command("workspace.create", {"name": name}, meta, Workspace, apply)

    def rename_workspace(self, workspace_id: str, name: str, meta: CommandMeta) -> Workspace:
        name = NAME.validate_python(name, strict=True)

        def apply(tx):
            workspace = self._workspace(tx, workspace_id)
            if workspace.version != meta.expected_version:
                raise DomainError("version_conflict", "项目已改变，请读取当前版本")
            changed = workspace.model_copy(update={"name": name, "version": workspace.version + 1})
            tx.append_event(NewEvent(kind="workspace.renamed", workspace_id=workspace_id,
                                     payload=changed, causation_id=meta.command_id))
            return changed

        return self._command("workspace.rename", {"workspace_id": workspace_id, "name": name},
                             meta, Workspace, apply)

    def save_title_policy(self, workspace_id, binding, meta):
        from flowmate.runtime.naming import read_policy, resolve_binding

        def apply(tx):
            self._workspace(tx, workspace_id)
            current = read_policy(tx, workspace_id)
            if current.version != meta.expected_version:
                raise DomainError("version_conflict", "标题设置已改变，请读取当前版本")
            if binding is not None and resolve_binding(tx, binding) is None:
                raise DomainError("title_destination_changed", "所选模型或连接已改变，请重新确认目的地")
            if binding == current.binding:
                return current
            changed = TitlePolicy(workspace_id=workspace_id, version=(current.version or 0) + 1, binding=binding)
            tx.append_event(NewEvent(kind="naming.policy_saved", workspace_id=workspace_id, payload=changed,
                                     causation_id=meta.command_id))
            return changed

        return self._command("naming.policy.save", {"workspace_id": workspace_id,
            "binding": binding.model_dump(mode="json") if binding is not None else None}, meta, TitlePolicy, apply)

    def _set_workspace_directory(self, tx, workspace_id, resource_id, meta):
        workspace = self._workspace(tx, workspace_id)
        if workspace.version != meta.expected_version:
            raise DomainError("version_conflict", "项目已改变，请读取当前版本")
        if resource_id is not None:
            row = tx.execute("SELECT document FROM resources WHERE id=?", (resource_id,)).fetchone()
            resource = ResourceRecord.model_validate_json(row[0]) if row else None
            if (resource is None or resource.kind != "directory" or resource.scope.workspace_id != workspace_id
                    or resource.scope.session_id is not None):
                raise DomainError("workspace_directory_invalid", "关联必须是此项目的目录资源")
            check_scopes(tx, [ScopeDependency(scope_id=resource.id, epoch=resource.version)])
        changed = workspace.model_copy(update={"version": workspace.version + 1, "directory_resource_id": resource_id})
        tx.append_event(NewEvent(kind="workspace.directory_changed", payload=changed,
            workspace_id=workspace_id, causation_id=meta.command_id))
        return changed

    def set_workspace_directory(self, workspace_id: str, resource_id: str | None, meta: CommandMeta) -> Workspace:
        return self._command("workspace.directory", {"workspace_id": workspace_id, "resource_id": resource_id},
                             meta, Workspace, lambda tx: self._set_workspace_directory(tx, workspace_id, resource_id, meta))

    def create_session(self, workspace_id: str, title: str | None, meta: CommandMeta) -> Session:
        workspace_id = IDENTIFIER.validate_python(workspace_id, strict=True)
        if title is not None:
            title = NAME.validate_python(title, strict=True)

        def apply(tx: UnitOfWork) -> Session:
            if meta.expected_version is not None:
                raise DomainError("version_conflict", "创建会话不接受已有版本")
            if not tx.execute("SELECT 1 FROM workspaces WHERE id = ?", (workspace_id,)).fetchone():
                raise DomainError("not_found", "工作区不存在", related_ids=(workspace_id,))
            session = Session(workspace_id=workspace_id, title=title if title is not None else "新会话",
                              agent_profile_id=self._default_agent(tx).id,
                              automatic_title="pending" if title is None else None)
            tx.append_event(NewEvent(kind="session.created", payload=session,
                                     workspace_id=workspace_id, session_id=session.id,
                                     causation_id=meta.command_id))
            return session

        return self._command("session.create", {"workspace_id": workspace_id, "title": title},
                             meta, Session, apply)

    @staticmethod
    def derive_session_title(tx: UnitOfWork, session_id: str, text: str, command_id: str) -> Session | None:
        from flowmate.runtime.naming import goal_title

        row = tx.execute("SELECT document FROM sessions WHERE id=? AND kind='interaction'",
                         (session_id,)).fetchone()
        session = Session.model_validate_json(row[0])
        if session.automatic_title != "pending" or session.archived:
            return
        title = goal_title(text)
        if title:
            version = session.version + 1
            named = session.model_copy(update={"title": title, "automatic_title": version, "version": version})
            tx.append_event(NewEvent(kind="session.updated", workspace_id=session.workspace_id,
                                     session_id=session.id, payload=named, causation_id=command_id))
            return named
        return None

    def rename_session(self, session_id: str, name: str, meta: CommandMeta) -> Session:
        name = NAME.validate_python(name, strict=True)

        def apply(tx):
            row = tx.execute("SELECT document FROM sessions WHERE id=? AND kind='interaction'",
                             (session_id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "交互会话不存在")
            session = Session.model_validate_json(row[0])
            # 允许覆盖刚生成的标题。任何其他版本变更仍要求用户确认当前状态。
            automatic = session.automatic_title
            superseding_automatic = (isinstance(automatic, int) and
                session.version in {automatic, automatic + 1} and
                meta.expected_version in range(automatic - 1, session.version))
            if session.version != meta.expected_version and not superseding_automatic:
                raise DomainError("version_conflict", "会话版本已变化，请刷新")
            changed = session.model_copy(update={
                "title": name, "automatic_title": None, "version": session.version + 1})
            tx.append_event(NewEvent(kind="session.updated", workspace_id=session.workspace_id,
                                     session_id=session.id, payload=changed, causation_id=meta.command_id))
            return changed

        return self._command("session.rename", {"session_id": session_id, "name": name},
                             meta, Session, apply)

    def archive_session(self,session_id,archived,meta):
        def apply(tx):
            row=tx.execute("SELECT document FROM sessions WHERE id=? AND kind='interaction'",(session_id,)).fetchone()
            if row is None:
                raise DomainError("not_found","交互会话不存在")
            session=Session.model_validate_json(row[0])
            if session.version != meta.expected_version:
                raise DomainError("version_conflict","会话版本已变化，请刷新")
            changed=session.model_copy(update={"version":session.version+1,"archived":archived,
                "automatic_title": session.automatic_title if session.automatic_title == "pending" else None})
            tx.append_event(NewEvent(kind="session.updated",workspace_id=session.workspace_id,
                session_id=session.id,payload=changed,causation_id=meta.command_id))
            if archived:
                from flowmate.runtime.followups import close_intents
                close_intents(tx, session_id=session.id, reason="session_archived")
            return changed
        return self._command("session.archive",{"session_id":session_id,"archived":archived},meta,Session,apply)

    def _save_profile(self, kind: ProfileKind, profile: T, meta: CommandMeta) -> T:
        profile = type(profile).model_validate(profile.model_dump())

        def apply(tx: UnitOfWork) -> T:
            previous = tx.execute(f"SELECT current_version FROM {kind}_profiles WHERE id = ?",
                                  (profile.id,)).fetchone()
            current = previous[0] if previous else None
            if meta.expected_version != current or profile.version != (current or 1):
                raise DomainError("version_conflict", "配置已改变，请读取当前版本")
            if isinstance(profile, AgentProfile) and profile.default_model_profile_id is not None:
                tx.get_profile("model", profile.default_model_profile_id)
            if isinstance(profile, AgentProfile) and profile.delegatable:
                if profile.default_model_profile_id is None:
                    raise DomainError("member_model_required", "可委派成员必须明确选择默认模型")
                self.resolve_model(tx, profile.default_model_profile_id)
            if isinstance(profile, ModelProfile):
                tx.get_connection(profile.connection_id)
                if current is not None:
                    old = tx.get_profile("model", profile.id)
                    if (old.connection_id, old.model_id) != (profile.connection_id, profile.model_id):
                        raise DomainError("model_identity_changed", "型号和所属连接创建后不可改变，请新增模型")
                duplicate = tx.execute("SELECT id FROM model_profiles WHERE connection_id=? AND model_id=? AND id!=?",
                                       (profile.connection_id, profile.model_id, profile.id)).fetchone()
                if duplicate is not None:
                    raise DomainError("model_duplicate", "该连接已配置相同型号")
            saved = profile.model_copy(update={"version": (current + 1) if current else 1})
            payload = AgentSaved(profile=saved) if kind == "agent" else saved
            tx.append_event(NewEvent(kind=f"{kind}.saved", payload=payload,
                                     causation_id=meta.command_id))
            return saved

        return self._command(f"{kind}.save", profile.model_dump(mode="json"),
                             meta, type(profile), apply)

    def save_agent(self, profile: AgentProfile, meta: CommandMeta) -> AgentProfile:
        return self._save_profile("agent", profile, meta)

    def save_model(self, profile: ModelProfile, meta: CommandMeta) -> ModelProfile:
        return self._save_profile("model", profile, meta)

    def get_agent(self, id: str, version: int | None = None) -> AgentProfile:
        with self.store.transaction(write=False) as tx:
            return tx.get_profile("agent", id, version)

    def get_model(self, id: str, version: int | None = None) -> ModelProfile:
        with self.store.transaction(write=False) as tx:
            return tx.get_profile("model", id, version)

    def save_connection(self, profile: ModelConnection, meta: CommandMeta) -> ModelConnection:
        from flowmate.models.endpoints import resolve_model_endpoint
        from flowmate.models.metadata import official_provider_id

        profile = ModelConnection.model_validate(profile.model_dump())
        profile = profile.model_copy(update={"protocol": resolve_model_endpoint(profile.protocol, profile.endpoint).protocol})
        profile = profile.model_copy(update={"provider_preset_id": official_provider_id(profile)})

        def apply(tx):
            row = tx.execute("SELECT current_version FROM model_connections WHERE id=?", (profile.id,)).fetchone()
            current = row[0] if row else None
            if meta.expected_version != current or profile.version != (current or 1):
                raise DomainError("version_conflict", "连接已改变，请读取当前版本")
            if current is not None:
                old = tx.get_connection(profile.id)
                if ((old.protocol, old.endpoint) != (profile.protocol, profile.endpoint)
                        and old.secret_ref is not None and profile.secret_ref == old.secret_ref):
                    raise DomainError("credential_binding_changed", "目的地或协议改变需要新的凭据引用")
            saved = profile.model_copy(update={"version": current + 1 if current else 1})
            tx.append_event(NewEvent(kind="connection.saved", payload=saved, causation_id=meta.command_id))
            return saved

        return self._command("connection.save", profile.model_dump(mode="json"), meta, ModelConnection, apply)

    def get_connection(self, id: str, version: int | None = None) -> ModelConnection:
        with self.store.transaction(write=False) as tx:
            return tx.get_connection(id, version)

    @staticmethod
    def resolve_model(tx: UnitOfWork, model_id: str, *,
                      selection: ModelSelection | None = None) -> ResolvedModelProfile:
        from flowmate.models.discovery import current_discovered_model
        from flowmate.models.metadata import ModelMetadataResolver
        from flowmate.models.observations import ModelObservations

        model = tx.get_profile("model", model_id)
        connection = tx.get_connection(model.connection_id)
        if selection is not None and (model.version, connection.id, connection.version) != (
                selection.model_version, selection.connection_id, selection.connection_version):
            raise DomainError("model_destination_changed", "所选模型或接收方已变化，请重新选择并确认")
        return ModelMetadataResolver().resolve(connection, model,
            discovered=current_discovered_model(connection, model.model_id),
            observed=ModelObservations.read(tx, connection, model.model_id))

    @staticmethod
    def resolve_members(tx, catalog, skill_versions):
        from flowmate.models.pricing import pricing_reason, resolve_pricing

        members = {}
        for row in tx.execute("SELECT r.document FROM agent_profiles p JOIN agent_revisions r "
                "ON r.profile_id=p.id AND r.version=p.current_version "
                "WHERE json_extract(r.document,'$.delegatable')=1 ORDER BY p.id"):
            profile = AgentProfile.model_validate_json(row[0])
            model = SettingsService.resolve_model(tx, profile.default_model_profile_id)
            pricing = resolve_pricing(model)
            members[profile.id] = ResolvedMember(agent_profile=profile, model_profile=model,
                model_pricing=pricing, pricing_unknown_reason=pricing_reason(model) if pricing is None else None,
                tools={name: version for name, version in catalog.tools.items() if name in profile.allowed_tools},
                skill_versions={id: skill_versions[id] for id in profile.skill_ids if id in skill_versions})
        return members
