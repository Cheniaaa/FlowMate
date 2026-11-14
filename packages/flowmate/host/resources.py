"""只装配到私有宿主通道的原生选择注册。"""

import asyncio
from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError

from flowmate.contracts.base import CommandMeta, Contract, DomainError, Id, Name
from flowmate.contracts.workspaces import WorkspaceDirectoryResult
from flowmate.policy.contracts import ExportTargetInfo, NativeSelection, ScopeRef
from flowmate.settings import SettingsService


class _ResourceSelection(Contract):
    scope: ScopeRef
    kind: Literal["file", "directory", "export"]
    paths: list[str] = Field(min_length=1)


class _DirectoryCreation(Contract):
    name: Name
    path: str = Field(min_length=1)
    meta: CommandMeta


class _DirectoryCommand(Contract):
    command_id: Id


class HostResources:
    def __init__(self, policy, files, config):
        self.policy = policy
        self.files = files
        self.config = config
        self.settings = SettingsService(policy.store)

    async def create_workspace_from_directory(self, params):
        try:
            request = _DirectoryCreation.model_validate(params)
        except ValidationError:
            raise DomainError("native_selection_invalid", "目录创建格式无效") from None

        def apply(tx):
            anchor = self.files.capture(Path(request.path))
            if anchor.kind != "directory":
                raise DomainError("native_selection_kind", "项目必须关联目录")
            workspace = self.settings._create_workspace(tx, request.name, request.meta)
            directory = self.policy.register_selection_tx(tx, NativeSelection(
                scope=ScopeRef(workspace_id=workspace.id), kind="directory",
                canonical_path=anchor.canonical_path, file_identity=anchor.identity))
            workspace = self.settings._set_workspace_directory(tx, workspace.id, directory.id,
                request.meta.model_copy(update={"expected_version": workspace.version}))
            return WorkspaceDirectoryResult(workspace=workspace, directory=directory)

        result = await asyncio.to_thread(self.settings._command, "workspace.create_from_directory",
            {"name": request.name, "path": request.path}, request.meta, WorkspaceDirectoryResult, apply)
        return result.model_dump(mode="json")

    async def directory_command_status(self, params):
        try:
            request = _DirectoryCommand.model_validate(params)
        except ValidationError:
            raise DomainError("native_selection_invalid", "目录命令格式无效") from None
        with self.policy.store.transaction(write=False) as tx:
            row = tx.previous_command(request.command_id)
            if row is None:
                return {"status": "not_found", "result": None}
            try:
                result = WorkspaceDirectoryResult.model_validate_json(row["response"])
            except ValidationError:
                raise DomainError("command_conflict", "命令不属于目录创建") from None
            return {"status": "confirmed", "result": result.model_dump(mode="json")}

    async def register(self, params):
        try:
            request = _ResourceSelection.model_validate(params)
        except ValidationError:
            raise DomainError("native_selection_invalid", "原生选择格式无效") from None
        if len(request.paths) > (self.config.max_selected_files if request.kind == "file" else 1):
            raise DomainError("native_selection_limit", "原生选择数量超限")

        def capture():
            selections = []
            for path in request.paths:
                if request.kind == "export":
                    target = self.files.capture_export_target(Path(path))
                    selections.append(NativeSelection(scope=request.scope, kind="export",
                        canonical_path=str(Path(target.parent.canonical_path) / target.name),
                        file_identity=target.identity or target.parent.identity,
                        export_target=ExportTargetInfo(parent_path=target.parent.canonical_path,
                            parent_identity=target.parent.identity, name=target.name,
                            target_identity=target.identity, content_hash=target.content_hash)))
                else:
                    anchor = self.files.capture(Path(path))
                    if anchor.kind != request.kind:
                        raise DomainError("native_selection_kind", "原生选择类型不一致")
                    selections.append(NativeSelection(scope=request.scope, kind=anchor.kind,
                        canonical_path=anchor.canonical_path, file_identity=anchor.identity))
            return selections

        selections = await asyncio.to_thread(capture)
        return {"resources": [self.policy.register_selection(selection).model_dump(mode="json")
                              for selection in selections]}
