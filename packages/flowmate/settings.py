"""持久身份与不可变配置修订；命令去重先于版本检查。"""

import hashlib
import json
from collections.abc import Callable
from typing import TypeVar

from pydantic import TypeAdapter

from flowmate.contracts.base import CommandMeta, Contract, DomainError, Id, Name
from flowmate.contracts.events import AgentSaved, NewEvent
from flowmate.contracts.execution import ScopeDependency
from flowmate.contracts.settings import (
    AgentProfile,
    ModelConnection,
    ModelProfile,
    ResolvedModelProfile,
    Session,
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

    @staticmethod
    def _default_agent(tx: UnitOfWork) -> AgentProfile:
        row = tx.execute("SELECT profile_id FROM assistant_identity WHERE singleton = 1").fetchone()
        if row is not None:
            return tx.get_profile("agent", row[0])
        profile = AgentProfile()
        tx.append_event(NewEvent(kind="agent.saved", payload=AgentSaved(
            profile=profile, set_default=True,
        )))
        return profile

    def default_agent(self) -> AgentProfile:
        with self.store.transaction() as tx:
            return self._default_agent(tx)

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
            workspace_id = result.id if isinstance(result, Workspace) else (
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

    def create_session(self, workspace_id: str, title: str, meta: CommandMeta) -> Session:
        workspace_id = IDENTIFIER.validate_python(workspace_id, strict=True)
        title = NAME.validate_python(title, strict=True)

        def apply(tx: UnitOfWork) -> Session:
            if meta.expected_version is not None:
                raise DomainError("version_conflict", "创建会话不接受已有版本")
            if not tx.execute("SELECT 1 FROM workspaces WHERE id = ?", (workspace_id,)).fetchone():
                raise DomainError("not_found", "工作区不存在", related_ids=(workspace_id,))
            session = Session(workspace_id=workspace_id, title=title,
                              agent_profile_id=self._default_agent(tx).id)
            tx.append_event(NewEvent(kind="session.created", payload=session,
                                     workspace_id=workspace_id, session_id=session.id,
                                     causation_id=meta.command_id))
            return session

        return self._command("session.create", {"workspace_id": workspace_id, "title": title},
                             meta, Session, apply)

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
        from flowmate.models.metadata import official_provider_id

        profile = ModelConnection.model_validate(profile.model_dump())
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
    def resolve_model(tx: UnitOfWork, model_id: str) -> ResolvedModelProfile:
        from flowmate.models.metadata import ModelMetadataResolver

        model = tx.get_profile("model", model_id)
        connection = tx.get_connection(model.connection_id)
        return ModelMetadataResolver().resolve(connection, model)
