"""命令转领域服务，查询使用单一读事务。"""

import asyncio
from pathlib import Path as FilePath
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter

from flowmate import __version__
from flowmate.api import contracts as api
from flowmate.api import queries
from flowmate.contracts.base import CommandMeta, DomainError, Id
from flowmate.contracts.execution import RunSnapshot, StartRun, TaskHandle, TaskResult, TaskSnapshot
from flowmate.contracts.publication import PublicationView
from flowmate.contracts.settings import (
    AgentProfile,
    ModelCandidate,
    ModelConnection,
    ModelProfile,
    ModelResolution,
    ProviderPreset,
)
from flowmate.contracts.workspaces import WorkspaceDirectoryView
from flowmate.models.metadata import ModelMetadataResolver, list_provider_presets
from flowmate.policy.contracts import (
    DeletionReceipt,
    GrantCommand,
    ResourceRecord,
    ResourceRef,
    ScopeRef,
    ScopeState,
)
from flowmate.runtime.transitions import context_for, load


def body(model):
    adapter = TypeAdapter(model)
    async def parse(request: Request):
        return adapter.validate_json(await request.body())
    return Depends(parse)


def router(runtime):
    route = APIRouter(prefix="/v2")

    @route.get("/health", response_model=api.Health)
    async def health():
        return api.Health(runtime_version=__version__)

    @route.get("/navigation", response_model=api.NavigationView)
    async def navigation(limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.navigation(tx, limit=limit, cursor=cursor)

    @route.get("/navigation/sessions", response_model=api.Page[api.Session])
    async def recent_sessions(limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.recent_sessions(tx, limit=limit, cursor=cursor)

    @route.get("/tasks", response_model=api.Page[RunSnapshot])
    async def global_tasks(limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.global_tasks(tx, limit=limit, cursor=cursor)

    @route.get("/inbox", response_model=api.Page[api.InboxItem])
    async def inbox(limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.inbox(tx, limit=limit, cursor=cursor)

    @route.get("/runs/{id}/export-recovery", response_model=list[PublicationView])
    async def export_recovery(id: Id):
        runtime.service.snapshot(id)
        return await asyncio.to_thread(runtime.artifacts.publication.list_for_run, id)

    @route.post("/export-recovery/{id}/restore", response_model=PublicationView)
    async def restore_export(id: Id, meta=body(CommandMeta)):
        return await asyncio.to_thread(runtime.artifacts.publication.restore, id, meta)

    @route.post("/export-recovery/{id}/release", response_model=PublicationView)
    async def release_export(id: Id, meta=body(CommandMeta)):
        return await asyncio.to_thread(runtime.artifacts.publication.release, id, meta)

    @route.get("/workspaces")
    async def workspaces(limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.workspaces(tx, limit=limit, cursor=cursor)

    @route.post("/workspaces", status_code=201)
    async def create_workspace(command=body(api.Command[api.CreateWorkspace])):
        return runtime.settings.create_workspace(command.data.name, command.meta)

    @route.put("/workspaces/{id}/directory")
    async def set_workspace_directory(id: Id, command=body(api.Command[api.SetWorkspaceDirectory])):
        return runtime.settings.set_workspace_directory(id, command.data.resource_id, command.meta)

    @route.get("/workspaces/{id}/directory", response_model=WorkspaceDirectoryView)
    async def workspace_directory(id: Id):
        with runtime.store.transaction(write=False) as tx:
            workspace = queries.workspace(tx, id)
            if workspace.directory_resource_id is None:
                return WorkspaceDirectoryView(workspace_id=id, workspace_version=workspace.version,
                    resource=None, state="unlinked", reason=None)
            row = tx.execute("SELECT r.document,s.status FROM resources r JOIN scopes s ON s.id=r.id WHERE r.id=?",
                             (workspace.directory_resource_id,)).fetchone()
            record = ResourceRecord.model_validate_json(row["document"])
            reason = "scope_revoked" if row["status"] != "active" else None
        if reason is None:
            try:
                anchor = await asyncio.to_thread(runtime.artifacts.files.capture, FilePath(record.canonical_path))
                if anchor.identity != record.file_identity or anchor.kind != "directory":
                    reason = "file_identity_changed"
            except DomainError as error:
                reason = error.code
        return WorkspaceDirectoryView(workspace_id=id, workspace_version=workspace.version,
            resource=ResourceRef.model_validate(record.model_dump(include=ResourceRef.model_fields.keys())),
            state="unavailable" if reason is not None else "available", reason=reason)

    @route.delete("/workspaces/{id}", response_model=DeletionReceipt)
    async def delete_workspace(id: Id, meta=body(CommandMeta)):
        receipt = runtime.lifecycle.delete(ScopeRef(workspace_id=id), meta)
        await asyncio.to_thread(runtime.lifecycle.collect_content)
        return receipt

    @route.delete("/sessions/{id}", response_model=DeletionReceipt)
    async def delete_session(id: Id, meta=body(CommandMeta)):
        receipt = runtime.lifecycle.delete_session(id, meta)
        await asyncio.to_thread(runtime.lifecycle.collect_content)
        return receipt

    @route.get("/workspaces/{id}/sessions")
    async def sessions(id: Id, limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.sessions(tx, id, limit=limit, cursor=cursor)

    @route.get("/sessions/{id}/runs", response_model=api.Page[RunSnapshot])
    async def session_runs(id: Id, limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.session_runs(tx, id, limit=limit, cursor=cursor)

    @route.get("/sessions/{id}")
    async def session(id: Id):
        with runtime.store.transaction(write=False) as tx:
            return queries.session(tx, id)

    @route.get("/sessions/{id}/commands/{command_id}", response_model=api.CommandStatus)
    async def command_status(id: Id, command_id: Id):
        with runtime.store.transaction(write=False) as tx:
            return queries.command_status(tx, id, command_id)

    @route.post("/workspaces/{id}/sessions", status_code=201)
    async def create_session(id: Id, command=body(api.Command[api.CreateSession])):
        return runtime.settings.create_session(id, command.data.title, command.meta)

    @route.get("/profiles")
    async def profiles(limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.profiles(tx, "agent", limit=limit, cursor=cursor)

    @route.get("/models")
    async def models(limit: int = 100, cursor: str | None = None, connection_id: Id | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.profiles(tx, "model", connection_id=connection_id, limit=limit, cursor=cursor)

    @route.get("/provider-presets", response_model=list[ProviderPreset])
    async def provider_presets():
        return list_provider_presets()

    @route.get("/model-catalog", response_model=list[ModelCandidate])
    async def model_catalog(provider_preset_id: str, query: str = ""):
        return ModelMetadataResolver.list_candidates(provider_preset_id, query)

    @route.get("/models/{id}/resolved", response_model=ModelResolution)
    async def model_resolution(id: Id):
        with runtime.store.transaction(write=False) as tx:
            model = tx.get_profile("model", id)
            return ModelMetadataResolver().preview(tx.get_connection(model.connection_id), model)

    @route.get("/model-connections", response_model=api.Page[ModelConnection])
    async def connections(limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.connections(tx, limit=limit, cursor=cursor)

    @route.get("/model-connections/{id}", response_model=ModelConnection)
    async def connection(id: Id):
        return runtime.settings.get_connection(id)

    @route.put("/model-connections/{id}", response_model=ModelConnection)
    async def save_connection(id: Id, command=body(api.Command[ModelConnection])):
        if id != command.data.id:
            raise DomainError("owner_mismatch", "路径与连接身份不一致")
        return runtime.settings.save_connection(command.data, command.meta)

    @route.put("/profiles/{id}")
    async def save_profile(id: Id, command=body(api.Command[AgentProfile])):
        if id != command.data.id:
            raise DomainError("owner_mismatch", "路径与配置身份不一致")
        return runtime.settings.save_agent(command.data, command.meta)

    @route.put("/models/{id}")
    async def save_model(id: Id, command=body(api.Command[ModelProfile])):
        if id != command.data.id:
            raise DomainError("owner_mismatch", "路径与配置身份不一致")
        return runtime.settings.save_model(command.data, command.meta)

    @route.post("/sessions/{id}/runs", status_code=202)
    async def start(id: Id, command=body(api.Command[api.StartRequest])):
        return runtime.service.start(StartRun(session_id=id, **command.data.model_dump()), command.meta)

    @route.post("/runs/{id}/steering")
    async def steer(id: Id, command=body(api.Command[api.Steering])):
        return runtime.service.steer(id, command.data.text, command.meta)

    @route.post("/runs/{id}/cancel")
    async def cancel(id: Id, meta=body(CommandMeta)):
        return runtime.service.cancel(id, meta)

    @route.post("/runs/{id}/resume")
    async def resume(id: Id, meta=body(CommandMeta)):
        return runtime.service.resume(id, meta)

    @route.post("/questions/{id}/answer")
    async def answer(id: Id, command=body(api.Command[api.Answer])):
        return runtime.service.answer(id, command.data.answer, command.meta)

    @route.post("/approvals/{id}/decision")
    async def approve(id: Id, command=body(api.Command[api.ApprovalDecision])):
        return runtime.approvals.decide(id, command.data.allow, command.meta)

    @route.post("/grants", status_code=201)
    async def grant(command=body(api.Command[GrantCommand])):
        return runtime.policy.grant(command.data, command.meta)

    @route.post("/grants/{id}/revoke", response_model=ScopeState)
    async def revoke(id: Id, meta=body(CommandMeta)):
        return runtime.lifecycle.revoke(id, meta)

    @route.get("/runs/{id}", response_model=api.RunDetail)
    async def run(id: Id):
        with runtime.store.transaction(write=False) as tx:
            return queries.run_detail(tx, id)

    @route.get("/tasks/{id}", response_model=TaskSnapshot)
    async def task(id: Id):
        with runtime.store.transaction(write=False) as tx:
            return load(tx, TaskSnapshot, id)

    @route.get("/tasks/{id}/result", response_model=TaskResult)
    async def task_result(id: Id):
        with runtime.store.transaction(write=False) as tx:
            task = load(tx, TaskSnapshot, id)
            run = load(tx, RunSnapshot, task.run_id)
            ctx = context_for(tx, run.root_task_id)
        return runtime.tasks.view(ctx, TaskHandle(run_id=run.id, task_id=task.id))

    @route.get("/runs/{id}/trace")
    async def trace(id: Id, limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.trace(tx, id, limit=limit, cursor=cursor)

    @route.get("/runs/{id}/{kind}")
    async def run_items(id: Id, kind: Annotated[str, Path(pattern="^(tasks|activities|messages|artifacts|questions|approvals|waits|consumptions|joins)$")],
                        limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.run_items(tx, id, kind, limit=limit, cursor=cursor)

    @route.get("/sessions/{id}/messages")
    async def messages(id: Id, limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.messages(tx, id, limit=limit, cursor=cursor)

    @route.get("/workspaces/{id}/resources")
    async def resources(id: Id, session_id: Id | None = None, limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.resources(tx, id, session_id, limit=limit, cursor=cursor)

    @route.get("/workspaces/{id}/snapshot", response_model=api.WorkspaceSnapshot)
    async def snapshot(id: Id):
        with runtime.store.transaction(write=False) as tx:
            return queries.snapshot(tx, id)

    @route.get("/workspaces/{id}/grants", response_model=api.Page[api.DataUseGrant])
    async def grants(id: Id, session_id: Id | None = None, limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.grants(tx, id, session_id=session_id, limit=limit, cursor=cursor)

    @route.get("/workspaces/{id}/events")
    async def events(id: Id, after: int = 0):
        runtime.streams.check_cursor(id, after)
        async def stream():
            async for event in runtime.streams.subscribe(id, after):
                yield ("data: " + event.model_dump_json() + "\n\n").encode()
        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    @route.get("/workspaces/{id}/{kind}")
    async def workspace_items(id: Id, kind: Annotated[str, Path(pattern="^(runs|approvals|questions)$")],
                              limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.workspace_items(tx, id, kind, limit=limit, cursor=cursor)

    @route.get("/artifacts/{id}/content")
    async def content(id: Id, offset: int = 0, limit: int = 40000):
        with runtime.store.transaction(write=False) as tx:
            row = tx.execute("SELECT task_id FROM artifacts WHERE id=?", (id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "产物不存在")
            ctx = context_for(tx, row[0])
        return runtime.artifacts.read(ctx, id, offset, limit, for_user=True)

    @route.post("/artifacts/{id}/export", status_code=202)
    async def export(id: Id, command=body(api.Command[api.ExportRequest])):
        return runtime.service.export_artifact(id, command.data.target_ref, command.data.expected_target_hash, command.meta)

    return route
