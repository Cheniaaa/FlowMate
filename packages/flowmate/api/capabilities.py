"""能力库公开契约；写入交给唯一 SkillService/原生包宿主。"""

from typing import Literal

from fastapi import APIRouter, Query
from pydantic import Field

from flowmate.api.contracts import Command, Page
from flowmate.api.routes import body
from flowmate.contracts.base import Contract, DomainError, Id
from flowmate.contracts.scopes import ScopeRef
from flowmate.skills.contracts import (
    ContentHash,
    SkillBinding,
    SkillCandidate,
    SkillCandidateDeletion,
    SkillFileSlice,
    SkillRecord,
    SkillResolution,
    SkillVersion,
    SkillView,
)
from flowmate.skills.export_publication import SkillExportReceipt


class StageSkill(Contract):
    scope: ScopeRef
    directory_name: str
    files: dict[str, str] = Field(min_length=1, max_length=2000)
    skill_id: Id | None = None
    base_hash: ContentHash | None = None


class ImportSkill(Contract):
    scope: ScopeRef
    selection_id: Id
    skill_id: Id | None = None
    base_hash: ContentHash | None = None


class PublishSkill(Contract):
    scope: ScopeRef
    staging_ref: Id
    confirmed_hash: ContentHash


class ResolveSkills(Contract):
    scope: ScopeRef
    versions: dict[Id, ContentHash]


class SaveSkillExport(Contract):
    scope: ScopeRef
    skill_id: Id
    content_hash: ContentHash
    target_ref: Id
    confirmed_target_hash: ContentHash | None = None


class SkillScopeRequest(Contract):
    scope: ScopeRef


StageSkillCommand = Command[StageSkill]
ImportSkillCommand = Command[ImportSkill]
PublishSkillCommand = Command[PublishSkill]
SaveSkillExportCommand = Command[SaveSkillExport]


def router(runtime):
    route = APIRouter(prefix="/v3/capabilities")

    def selected(scope_kind, workspace_id):
        if (scope_kind == "workspace") != (workspace_id is not None):
            raise DomainError("invalid_scope", "项目范围须提供项目；个人范围不接受项目参数")
        return ScopeRef(kind=scope_kind, workspace_id=workspace_id)

    @route.get("/skills", response_model=Page[SkillView])
    async def skills(scope_kind: Literal["user_global", "workspace"], workspace_id: Id | None = None,
                     query: str = "", cursor: str | None = None, limit: int = 100):
        return runtime.skills.list(selected(scope_kind, workspace_id), query, limit=limit, cursor=cursor)

    @route.post("/skills/resolve", response_model=SkillResolution)
    async def resolve(request: ResolveSkills):
        return runtime.skills.resolve(request.scope, request.versions)

    @route.get("/skills/{skill_id}", response_model=SkillRecord)
    async def record(skill_id: Id, scope_kind: Literal["user_global", "workspace"],
                     workspace_id: Id | None = None):
        return runtime.skills.get(skill_id, selected(scope_kind, workspace_id))

    @route.get("/skills/{skill_id}/versions/{content_hash}/file", response_model=SkillFileSlice)
    async def file(skill_id: Id, content_hash: ContentHash,
                   scope_kind: Literal["user_global", "workspace"], workspace_id: Id | None = None,
                   path: str = "SKILL.md", offset: int = Query(0, ge=0),
                   limit: int = Query(4000, ge=1, le=16000)):
        return runtime.skills.read_user(skill_id, content_hash, selected(scope_kind, workspace_id),
                                       path, offset=offset, limit=limit)

    @route.post("/skill-candidates", response_model=SkillCandidate)
    async def stage(command=body(StageSkillCommand)):
        data = command.data
        files = {}
        if data.skill_id is not None:
            if data.base_hash is None:
                raise DomainError("version_conflict", "编辑须固定原内容版本")
            files.update(runtime.skills.package(data.skill_id, data.base_hash, data.scope).files)
        try:
            files.update({path: value.encode("utf-8") for path, value in data.files.items()})
        except UnicodeError:
            raise DomainError("file_encoding_invalid", "标准文件须为 UTF-8") from None
        return runtime.skills.stage_user(data.directory_name, files, data.scope, command.meta,
            skill_id=data.skill_id, base_hash=data.base_hash)

    @route.post("/skill-imports", response_model=SkillCandidate)
    async def stage_import(command=body(ImportSkillCommand)):
        return runtime.skill_host.stage_import(command)

    @route.get("/skill-candidates/{staging_ref}", response_model=SkillCandidate)
    async def candidate(staging_ref: Id, scope_kind: Literal["user_global", "workspace"],
                        workspace_id: Id | None = None):
        return runtime.skills.candidate(staging_ref, selected(scope_kind, workspace_id))

    @route.get("/skill-candidates/{staging_ref}/file", response_model=SkillFileSlice)
    async def candidate_file(staging_ref: Id, scope_kind: Literal["user_global", "workspace"],
                             workspace_id: Id | None = None, path: str = "SKILL.md",
                             offset: int = Query(0, ge=0), limit: int = Query(4000, ge=1, le=16000)):
        return runtime.skills.read_candidate(staging_ref, selected(scope_kind, workspace_id),
                                            path, offset=offset, limit=limit)

    @route.post("/skill-candidates/{staging_ref}/discard", response_model=SkillCandidateDeletion)
    async def discard(staging_ref: Id, command=body(Command[SkillScopeRequest])):
        return runtime.skills.discard(staging_ref, command.data.scope, command.meta)

    @route.post("/skills", response_model=SkillVersion)
    async def publish(command=body(PublishSkillCommand)):
        data = command.data
        candidate = runtime.skills.candidate(data.staging_ref, data.scope)
        return runtime.skills.publish(candidate, command.meta, confirmed_hash=data.confirmed_hash)

    @route.put("/skill-bindings", response_model=SkillBinding)
    async def binding(command=body(Command[SkillBinding])):
        return runtime.skills.set_binding(command.data, command.meta)

    @route.post("/skill-exports", response_model=SkillExportReceipt)
    async def export(command=body(SaveSkillExportCommand)):
        return runtime.skill_host.save(command)

    @route.get("/skill-exports", response_model=list[SkillExportReceipt])
    async def exports(scope_kind: Literal["user_global", "workspace"],
                      workspace_id: Id | None = None, skill_id: Id | None = None):
        return runtime.skill_host.exports(selected(scope_kind, workspace_id), skill_id=skill_id)

    @route.get("/skill-exports/{command_id}", response_model=SkillExportReceipt)
    async def inspect(command_id: Id, scope_kind: Literal["user_global", "workspace"],
                      workspace_id: Id | None = None):
        return runtime.skill_host.inspect(command_id, selected(scope_kind, workspace_id))

    @route.post("/skill-exports/{command_id}/restore", response_model=SkillExportReceipt)
    async def restore(command_id: Id, request: SkillScopeRequest):
        return runtime.skill_host.restore(command_id, request.scope)

    @route.post("/skill-exports/{command_id}/finalize", response_model=SkillExportReceipt)
    async def finalize(command_id: Id, request: SkillScopeRequest):
        return runtime.skill_host.finalize(command_id, request.scope)

    @route.post("/skill-exports/{command_id}/release", response_model=SkillExportReceipt)
    async def release(command_id: Id, request: SkillScopeRequest):
        return runtime.skill_host.release(command_id, request.scope)

    return route
