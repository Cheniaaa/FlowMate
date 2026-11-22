"""命令转领域服务，查询使用单一读事务。"""

import asyncio
from pathlib import Path as FilePath
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter

from flowmate import __version__
from flowmate.agents.checkpoint import CONTROL_TOOLS
from flowmate.api import contracts as api
from flowmate.api import queries
from flowmate.api.projections import pending_command_view, run_view
from flowmate.contracts.base import CommandMeta, DomainError, Id
from flowmate.contracts.execution import (
    AdmissionFence,
    BudgetAllocation,
    BudgetGroupSnapshot,
    RunKind,
    RunSnapshot,
    SessionInboxEntry,
    StartRun,
    StopAllReceipt,
    SubmitTask,
    TaskResult,
    TaskSnapshot,
    TaskState,
    TaskSubmission,
)
from flowmate.contracts.publication import PublicationView
from flowmate.contracts.scopes import ScopeRef
from flowmate.contracts.settings import (
    AgentProfile,
    ModelCandidate,
    ModelConnection,
    ModelDiscoveryResult,
    ModelProfile,
    ModelResolution,
    ProviderPreset,
)
from flowmate.contracts.workspaces import WorkspaceDirectoryView
from flowmate.models.metadata import ModelMetadataResolver, list_provider_presets
from flowmate.policy.contracts import (
    DeletionReceipt,
    GrantCommand,
    ResourceCoverage,
    ResourceCoverageRequest,
    ResourceRecord,
    ResourceRef,
    ScopeState,
)
from flowmate.runtime.transitions import context_for, load
from flowmate.tools.catalog import ToolSpec


def body(model):
    adapter = TypeAdapter(model)
    async def parse(request: Request):
        return adapter.validate_json(await request.body())
    return Depends(parse)


def router(runtime):
    route = APIRouter(prefix="/v3")

    def run_response(run):
        with runtime.store.transaction(write=False) as tx:
            return run_view(tx, run)

    @route.get("/health", response_model=api.Health)
    async def health():
        return api.Health(runtime_version=__version__)

    @route.get("/tools", response_model=list[ToolSpec])
    async def tools():
        return [spec for spec in runtime.catalog.specs() if spec.name not in CONTROL_TOOLS]

    @route.get("/navigation", response_model=api.NavigationView)
    async def navigation(limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.navigation(tx, limit=limit, cursor=cursor)

    @route.get("/navigation/sessions", response_model=api.Page[api.Session])
    async def recent_sessions(limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.recent_sessions(tx, limit=limit, cursor=cursor)

    @route.get("/tasks", response_model=api.Page[api.TaskCenterItem])
    async def global_tasks(limit: int = 100, cursor: str | None = None, workspace_id: Id | None = None,
                           state: TaskState | None = None, kind: RunKind | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.task_center(tx,workspace_id,state,kind,limit=limit,cursor=cursor)

    @route.get("/inbox", response_model=api.Page[api.InboxItem])
    async def inbox(limit: int = 100, cursor: str | None = None, run_id: Id | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.inbox(tx, policy=runtime.service.policy,
                catalog=runtime.service.catalog.snapshot(), run_id=run_id, limit=limit, cursor=cursor)

    @route.get("/runs/{id}/export-recovery", response_model=list[PublicationView])
    async def export_recovery(id: Id):
        runtime.service.snapshot(id)
        return await asyncio.to_thread(runtime.artifacts.publication.list_for_run, id)

    @route.get("/runs/{id}/member-lanes", response_model=list[api.MemberLane])
    async def member_lanes(id: Id):
        with runtime.store.transaction(write=False) as tx:
            return queries.member_lanes(tx, id)

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

    @route.put("/workspaces/{id}/name", response_model=api.Workspace)
    async def rename_workspace(id: Id, command=body(api.Command[api.Rename])):
        return runtime.settings.rename_workspace(id, command.data.name, command.meta)

    @route.get("/workspaces/{id}/title-policy", response_model=api.TitlePolicy)
    async def title_policy(id: Id):
        from flowmate.runtime.naming import read_policy

        with runtime.store.transaction(write=False) as tx:
            queries.workspace(tx, id)
            return read_policy(tx, id)

    @route.put("/workspaces/{id}/title-policy", response_model=api.TitlePolicy)
    async def save_title_policy(id: Id, command=body(api.Command[api.SaveTitlePolicy])):
        return runtime.settings.save_title_policy(id, command.data.binding, command.meta)

    @route.post("/workspaces/{id}/title-suggestion", response_model=RunSnapshot, status_code=202)
    async def suggest_project_title(id: Id, meta=body(CommandMeta)):
        return run_response(runtime.service.suggest_project_title(id, meta))

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
        receipt = runtime.lifecycle.delete(ScopeRef(kind="workspace",workspace_id=id), meta)
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

    @route.get("/sessions/{id}/runs", response_model=api.SessionRunPage)
    async def session_runs(id: Id, limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.session_runs(tx, id, limit=limit, cursor=cursor)

    @route.get("/sessions/{id}/context", response_model=api.SessionContext)
    async def session_context(id: Id, limit: int = 50, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.session_context(tx, id, limit=limit, cursor=cursor)

    @route.get("/sessions/{id}/context/usage", response_model=api.SessionContextUsage)
    async def session_context_usage(id: Id):
        with runtime.store.transaction(write=False) as tx:
            return queries.session_context_usage(tx, id)

    @route.get("/sessions/{id}")
    async def session(id: Id):
        with runtime.store.transaction(write=False) as tx:
            return queries.session(tx, id)

    @route.post("/sessions/{id}/archive", response_model=api.Session)
    async def archive_session(id: Id,command=body(api.Command[api.ArchiveSession])):
        return runtime.settings.archive_session(id,command.data.archived,command.meta)

    @route.put("/sessions/{id}/title", response_model=api.Session)
    async def rename_session(id: Id, command=body(api.Command[api.Rename])):
        return runtime.settings.rename_session(id, command.data.name, command.meta)

    @route.get("/sessions/{id}/admission",response_model=AdmissionFence)
    async def session_admission(id: Id):
        with runtime.store.transaction(write=False) as tx:
            session=queries.session(tx,id)
            return queries.admission(tx,ScopeRef(kind="session",workspace_id=session.workspace_id,session_id=id))

    @route.get("/workspaces/{id}/admission",response_model=AdmissionFence)
    async def workspace_admission(id: Id):
        with runtime.store.transaction(write=False) as tx:
            return queries.admission(tx,ScopeRef(kind="workspace",workspace_id=id))

    @route.post("/sessions/{id}/stop-all",response_model=StopAllReceipt)
    async def stop_session(id: Id,meta=body(CommandMeta)):
        with runtime.store.transaction(write=False) as tx:
            session=queries.session(tx,id)
        return runtime.service.stop_all(ScopeRef(kind="session",workspace_id=session.workspace_id,session_id=id),meta)

    @route.post("/workspaces/{id}/stop-all",response_model=StopAllReceipt)
    async def stop_workspace(id: Id,meta=body(CommandMeta)):
        return runtime.service.stop_all(ScopeRef(kind="workspace",workspace_id=id),meta)

    @route.get("/sessions/{id}/results",response_model=api.Page[SessionInboxEntry])
    async def results(id: Id,limit: int=100,cursor: str | None=None):
        with runtime.store.transaction(write=False) as tx:
            return queries.session_inbox(tx,id,limit=limit,cursor=cursor)

    @route.post("/results/{id}/view",response_model=SessionInboxEntry)
    async def view_result(id: Id,meta=body(CommandMeta)):
        return runtime.delivery.mark_viewed(id,meta)

    @route.post("/results/{id}/retry",response_model=SessionInboxEntry)
    async def retry_result(id: Id,meta=body(CommandMeta)):
        return runtime.delivery.retry(id,meta)

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

    @route.get("/profiles/default", response_model=AgentProfile)
    async def default_profile():
        """读取创建新会话时使用的已登记助理及其当前修订。"""
        return runtime.settings.get_default_agent()

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
        from flowmate.models.discovery import current_discovered_model
        from flowmate.models.observations import ModelObservations

        async with runtime.settings.model_resolution_scope(id):
            with runtime.store.transaction(write=False) as tx:
                model = tx.get_profile("model", id)
                connection = tx.get_connection(model.connection_id)
                return ModelMetadataResolver().preview(connection, model,
                    discovered=current_discovered_model(connection, model.model_id),
                    observed=ModelObservations.read(tx, connection, model.model_id))

    @route.get("/model-connections", response_model=api.Page[ModelConnection])
    async def connections(limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.connections(tx, limit=limit, cursor=cursor)

    @route.get("/model-connections/{id}", response_model=ModelConnection)
    async def connection(id: Id):
        return runtime.settings.get_connection(id)

    @route.post("/model-connections/{id}/discover", response_model=ModelDiscoveryResult)
    async def discover_models(id: Id):
        return await runtime.model_discovery.refresh(id)

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
    async def start(id: Id, command=body(api.Command[api.StartRequest]), mcp_server_id: Id | None = None):
        async with runtime.settings.model_resolution_scope(command.data.model_profile_id, include_members=True,
                command_id=command.meta.command_id):
            run = runtime.service.start(StartRun(session_id=id, **command.data.model_dump()), command.meta,
                mcp_server_id=mcp_server_id)
        return run_response(run)

    @route.post("/sessions/{id}/commands", response_model=api.PendingUserCommand, status_code=202)
    async def enqueue_user(id: Id, command=body(api.Command[api.StartRequest]), mcp_server_id: Id | None = None):
        async with runtime.settings.model_resolution_scope(command.data.model_profile_id, include_members=True,
                command_id=command.meta.command_id):
            pending = runtime.service.enqueue_user(StartRun(session_id=id, **command.data.model_dump()), command.meta,
                mcp_server_id=mcp_server_id)
        with runtime.store.transaction(write=False) as tx:
            return pending_command_view(tx, queries.session(tx, id).workspace_id, pending)

    @route.get("/sessions/{id}/commands", response_model=api.Page[api.PendingUserCommand])
    async def pending_commands(id: Id, limit: int = 50, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.pending_commands(tx, id, limit=limit, cursor=cursor)

    @route.get("/sessions/{id}/follow-ups", response_model=api.Page[api.FollowUpIntent])
    async def follow_up_intents(id: Id, limit: int = 50, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.follow_up_intents(tx, id, limit=limit, cursor=cursor)

    @route.post("/runs/{id}/steering")
    async def steer(id: Id, command=body(api.Command[api.Steering])):
        return runtime.service.steer(id, command.data.text, command.meta)

    @route.post("/runs/{id}/cancel")
    async def cancel(id: Id, meta=body(CommandMeta)):
        return run_response(runtime.service.cancel(id, meta))

    @route.post("/runs/{id}/resume")
    async def resume(id: Id, meta=body(CommandMeta), retry_readonly: bool = False):
        return run_response(runtime.service.resume(id, meta, retry_readonly=retry_readonly))

    @route.post("/questions/{id}/answer")
    async def answer(id: Id, command=body(api.Command[api.Answer])):
        return run_response(runtime.service.answer(id, command.data.answer, command.meta))

    @route.post("/approvals/{id}/decision")
    async def approve(id: Id, command=body(api.Command[api.ApprovalDecision])):
        return runtime.approvals.decide(id, command.data.allow, command.meta)

    @route.post("/sessions/{id}/resource-coverage", response_model=ResourceCoverage)
    async def resource_coverage(id: Id, request=body(ResourceCoverageRequest)):
        return runtime.policy.resource_coverage(id, request)

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
            return queries.task_detail(tx, id)

    @route.post("/tasks/{id}/submit", response_model=TaskSubmission, status_code=202)
    async def submit_task(id: Id, command=body(api.Command[SubmitTask])):
        with runtime.store.transaction(write=False) as tx:
            ctx = context_for(tx, id)
        return runtime.tasks.submit(ctx, command.data, command.meta)

    @route.get("/runs/{id}/budget-group", response_model=BudgetGroupSnapshot)
    async def budget_group(id: Id):
        with runtime.store.transaction(write=False) as tx:
            return queries.budget_group(tx, id)

    @route.get("/runs/{id}/allocation", response_model=BudgetAllocation)
    async def allocation(id: Id):
        with runtime.store.transaction(write=False) as tx:
            return queries.budget_allocation(tx, id)

    @route.get("/tasks/{id}/result", response_model=TaskResult)
    async def task_result(id: Id):
        with runtime.store.transaction(write=False) as tx:
            task = load(tx, TaskSnapshot, id)
            run = load(tx, RunSnapshot, task.run_id)
            ctx = context_for(tx, run.root_task_id)
            from flowmate.runtime.tasks import handle_for
            handle = handle_for(tx, task)
        return runtime.tasks.view(ctx, handle)

    @route.get("/runs/{id}/trace")
    async def trace(id: Id, limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.trace(tx, id, limit=limit, cursor=cursor)

    @route.get("/runs/{id}/{kind}")
    async def run_items(id: Id, kind: Annotated[str, Path(pattern="^(tasks|activities|messages|artifacts|questions|approvals|waits|consumptions|joins)$")],
                        limit: int = 100, cursor: str | None = None, activity_id: Id | None = None):
        with runtime.store.transaction(write=False) as tx:
            return queries.run_items(tx, id, kind, limit=limit, cursor=cursor, activity_id=activity_id)

    @route.get("/sessions/{id}/run-feedback")
    async def run_feedback(id: Id, run_id: Annotated[list[Id], Query(min_length=1, max_length=100)]):
        with runtime.store.transaction(write=False) as tx:
            return queries.run_feedback(tx, id, run_id)

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

    @route.get("/sessions/{id}/artifacts/{artifact_id}")
    async def session_artifact(id: Id, artifact_id: Id):
        with runtime.store.transaction(write=False) as tx:
            row = tx.execute("SELECT task_id FROM artifacts WHERE id=?", (artifact_id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "产物不存在")
            ctx = context_for(tx, row[0])
            if ctx.interaction_session_id != id:
                raise DomainError("not_found", "产物不属于此会话")
            ref = runtime.artifacts.reference(ctx, artifact_id, tx=tx, for_user=True)
            return api.Page(items=[ref], watermark=queries.watermark(tx))

    @route.get("/artifacts/{id}/content")
    async def content(id: Id, offset: int = 0, limit: int = 40000, view: Literal["text", "structured"] = "text"):
        with runtime.store.transaction(write=False) as tx:
            row = tx.execute("SELECT task_id FROM artifacts WHERE id=?", (id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "产物不存在")
            ctx = context_for(tx, row[0])
        return runtime.artifacts.read(ctx, id, offset, limit, for_user=True, view=view)

    @route.get("/artifacts/{id}/image")
    async def image(id: Id):
        from fastapi.responses import Response

        with runtime.store.transaction(write=False) as tx:
            row = tx.execute("SELECT task_id FROM artifacts WHERE id=?", (id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "图片产物不存在")
            ctx = context_for(tx, row[0])
        ref = runtime.artifacts.reference(ctx, id, for_user=True)
        if ref.media_type not in {"image/png", "image/jpeg"}:
            raise DomainError("artifact_type_invalid", "该产物不是 PNG/JPEG 图片")
        return Response(runtime.artifacts._bytes(ref), media_type=ref.media_type,
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @route.post("/runs/{id}/continue-vision", status_code=202)
    async def continue_vision(id: Id, command=body(api.Command[api.VisionContinue])):
        async with runtime.settings.model_resolution_scope(command.data.model_profile_id, include_members=True):
            run = runtime.service.continue_vision(id, command.data.model_profile_id, command.meta, expected=command.data)
        return run_response(run)

    @route.post("/artifacts/{id}/export", status_code=202)
    async def export(id: Id, command=body(api.Command[api.ExportRequest])):
        run = runtime.service.export_artifact(id, command.data.target_ref, command.data.expected_target_hash, command.meta)
        return run_response(run)

    return route
