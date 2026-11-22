"""项目知识HTTP出口；只接公开身份，不接受文件路径或索引状态。"""

import asyncio
import json
from pathlib import PureWindowsPath

from fastapi import APIRouter, Query, Response
from pydantic import AwareDatetime

from flowmate.api.contracts import Command, CommandStatus, Page
from flowmate.api.queries import _page, workspace, workspace_command_status
from flowmate.api.routes import body
from flowmate.contracts.base import DomainError, Id
from flowmate.knowledge.contracts import (
    EmbeddingProfile,
    EmbeddingProfileRef,
    EvidencePage,
    KnowledgeSettings,
    KnowledgeSource,
)
from flowmate.knowledge.ingestion_contracts import (
    KnowledgeCancel,
    KnowledgeImportReceipt,
    KnowledgeImportRequest,
    KnowledgeJob,
    KnowledgeSourceAction,
)
from flowmate.knowledge.settings import EmbeddingProfileView, SetProjectKnowledge


class KnowledgeSourceView(KnowledgeSource):
    latest_job: KnowledgeJob | None
    origin_hint: str | None
    added_at: AwareDatetime | None


def router(runtime):
    route = APIRouter(prefix="/v4")

    @route.get("/workspaces/{id}/commands/{command_id}", response_model=CommandStatus)
    async def command_status(id: Id, command_id: Id, response: Response):
        response.headers["Cache-Control"] = "no-store"
        with runtime.store.transaction(write=False) as tx:
            return workspace_command_status(tx, id, command_id)

    @route.get("/workspaces/{id}/knowledge/sources", response_model=Page[KnowledgeSourceView])
    async def sources(id: Id, response: Response, limit: int = 100, cursor: str | None = None):
        response.headers["Cache-Control"] = "no-store"
        with runtime.store.transaction(write=False) as tx:
            workspace(tx, id)
            return _page(tx, KnowledgeSourceView, f"knowledge_sources:{id}",
                "SELECT k.id,k.document,k.canonical_path,"
                "(SELECT j.document FROM knowledge_jobs j WHERE j.source_id=k.id ORDER BY j.rowid DESC LIMIT 1) AS latest_job,"
                "(SELECT json_extract(v.document,'$.created_at') FROM knowledge_versions v "
                "WHERE v.source_id=k.id ORDER BY v.version LIMIT 1) AS added_at "
                "FROM knowledge_sources k WHERE k.workspace_id=?", [id], limit=limit, cursor=cursor,
                decode=lambda row: KnowledgeSourceView.model_validate_json(json.dumps({
                    **json.loads(row["document"]), "latest_job": json.loads(row["latest_job"]) if row["latest_job"] else None,
                    "origin_hint": PureWindowsPath(row["canonical_path"]).parent.name or None, "added_at": row["added_at"]})))

    @route.get("/workspaces/{id}/knowledge/jobs", response_model=Page[KnowledgeJob])
    async def jobs(id: Id, response: Response, limit: int = 100, cursor: str | None = None):
        response.headers["Cache-Control"] = "no-store"
        with runtime.store.transaction(write=False) as tx:
            workspace(tx, id)
            return _page(tx, KnowledgeJob, f"knowledge_jobs:{id}",
                "SELECT id,document FROM knowledge_jobs WHERE workspace_id=?", [id], limit=limit, cursor=cursor)

    @route.post("/workspaces/{id}/knowledge/imports", response_model=KnowledgeImportReceipt, status_code=202)
    async def imports(id: Id, command=body(Command[KnowledgeImportRequest])):
        return await asyncio.to_thread(runtime.knowledge.enqueue_import, id, command.data, command.meta)

    @route.post("/knowledge/jobs/{id}/cancel", response_model=KnowledgeJob)
    async def cancel(id: Id, command=body(Command[KnowledgeCancel])):
        return runtime.knowledge.cancel_job(id, command.meta)

    @route.get("/knowledge/jobs/{id}", response_model=KnowledgeJob)
    async def job(id: Id, response: Response):
        response.headers["Cache-Control"] = "no-store"
        with runtime.store.transaction(write=False) as tx:
            row = tx.execute("SELECT workspace_id,document FROM knowledge_jobs WHERE id=?", (id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "资料处理任务不存在")
            workspace(tx, row["workspace_id"])
            return KnowledgeJob.model_validate_json(row["document"])

    @route.post("/knowledge/sources/{id}/actions", response_model=KnowledgeSource)
    async def source_action(id: Id, command=body(Command[KnowledgeSourceAction])):
        return runtime.knowledge_lifecycle.apply(id, command.data.action, command.meta)

    @route.get("/workspaces/{id}/knowledge/settings", response_model=KnowledgeSettings)
    async def settings(id: Id, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return runtime.knowledge.settings(id)

    @route.put("/workspaces/{id}/knowledge/settings", response_model=KnowledgeSettings)
    async def save_settings(id: Id, command=body(Command[SetProjectKnowledge])):
        return runtime.knowledge.embedding.settings.set_project(id, command.data, command.meta)

    @route.get("/knowledge/embedding-profiles", response_model=Page[EmbeddingProfile])
    async def profiles(response: Response, limit: int = 100, cursor: str | None = None):
        response.headers["Cache-Control"] = "no-store"
        with runtime.store.transaction(write=False) as tx:
            return _page(tx, EmbeddingProfile, "embedding_profiles",
                "SELECT id,document FROM embedding_profiles p WHERE revision="
                "(SELECT max(revision) FROM embedding_profiles WHERE id=p.id)",
                [], limit=limit, cursor=cursor)

    @route.put("/knowledge/embedding-profiles/{id}", response_model=EmbeddingProfile)
    async def save_profile(id: Id, command=body(Command[EmbeddingProfile])):
        if command.data.id != id:
            raise DomainError("owner_mismatch", "检索模型配置身份与操作目标不一致")
        return runtime.knowledge.embedding.settings.save_profile(command.data, command.meta)

    @route.get("/knowledge/embedding-profiles/{id}", response_model=EmbeddingProfileView)
    async def profile(id: Id, response: Response, revision: int = Query(ge=1)):
        response.headers["Cache-Control"] = "no-store"
        return runtime.knowledge.embedding.profile_view(EmbeddingProfileRef(id=id, revision=revision))

    @route.get("/workspaces/{id}/knowledge/evidence/{evidence_id}", response_model=EvidencePage)
    async def evidence(id: Id, evidence_id: Id, response: Response, offset: int = 0, limit: int = 4000):
        from flowmate.knowledge.evidence import EvidenceService

        response.headers["Cache-Control"] = "no-store"
        return await asyncio.to_thread(EvidenceService(runtime.knowledge).read_for_user,
            id, evidence_id, offset=offset, limit=limit)

    return route
