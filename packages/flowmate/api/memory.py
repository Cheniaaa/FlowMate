"""记忆审阅和策略 API；全部写操作转发至权威服务。"""

from typing import Literal

from fastapi import APIRouter, Response

from flowmate.api.contracts import Command, Page
from flowmate.api.queries import _page, page_cursor, page_position, watermark
from flowmate.api.routes import body
from flowmate.contracts.base import DomainError, Id
from flowmate.contracts.execution import TaskHandle
from flowmate.contracts.scopes import ScopeRef
from flowmate.memory.contracts import (
    CreateMemory,
    MemoryDecision,
    MemoryEvidenceExcerpt,
    MemoryEvidenceView,
    MemoryGrantCommand,
    MemoryPolicy,
    MemoryRecord,
)
from flowmate.memory.maintenance_contracts import (
    MemoryMaintenanceAuthorization,
    MemoryMaintenanceNotice,
    MemoryMaintenanceRequest,
    MemorySourceBoundary,
)
from flowmate.policy.contracts import DataUseGrant


def router(runtime):
    route = APIRouter(prefix="/v3")

    def scope(scope_kind, workspace_id):
        if (scope_kind == "workspace") != (workspace_id is not None):
            raise DomainError("invalid_scope", "项目记忆须指定工作区，个人记忆不接受工作区")
        return ScopeRef(kind=scope_kind, workspace_id=workspace_id)

    @route.get("/memory/source-boundaries/{id}", response_model=MemorySourceBoundary)
    async def source_boundary(id: Id):
        return runtime.maintenance.boundary(id)

    @route.post("/memory/maintenance", response_model=TaskHandle, status_code=202)
    async def submit_maintenance(command=body(Command[MemoryMaintenanceRequest])):
        if command.meta.expected_version is None:
            raise DomainError("version_conflict", "整理须绑定已读取的策略版本")
        return runtime.maintenance.submit(command.data.scope, command.data.source_boundary,
            MemoryMaintenanceAuthorization(policy_version=command.meta.expected_version,
                budget_confirmation=command.data.budget_confirmation), command.meta)

    def maintenance_page(tx, selected, record_id=None, *, limit=100, cursor=None):
        runtime.memory._scope(tx, selected)
        sql = ("SELECT json_extract(document,'$.payload.id') AS id,"
            "json_extract(document,'$.payload') AS document FROM events WHERE "
            "json_extract(document,'$.kind')='memory.maintenance_changed' AND "
            "json_extract(document,'$.payload.scope.kind')=? AND "
            "json_extract(document,'$.payload.scope.workspace_id') IS ?")
        params = [selected.kind, selected.workspace_id]
        if record_id is not None:
            runs = {item.extraction_run_id for item in runtime.memory.provider.using(tx).candidates_for(
                selected, record_id=record_id) if item.extraction_run_id is not None}
            sql += (" AND json_extract(document,'$.payload.task.run_id') IN (" +
                ",".join("?" for _ in runs) + ")") if runs else " AND 0"
            params.extend(sorted(runs))
        return _page(tx, MemoryMaintenanceNotice, f"memory_maintenance:{selected.model_dump_json()}:{record_id}",
            sql, params, limit=limit, cursor=cursor)

    @route.get("/memory/maintenance", response_model=Page[MemoryMaintenanceNotice])
    async def maintenance(scope_kind: Literal["user_global", "workspace"], workspace_id: Id | None = None,
                          limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return maintenance_page(tx, scope(scope_kind, workspace_id), limit=limit, cursor=cursor)

    @route.get("/memory/records/{id}/maintenance", response_model=Page[MemoryMaintenanceNotice])
    async def record_maintenance(id: Id, limit: int = 100, cursor: str | None = None):
        with runtime.store.transaction(write=False) as tx:
            return maintenance_page(tx, runtime.memory._get(tx, id).scope, id, limit=limit, cursor=cursor)

    @route.get("/memory/records", response_model=Page[MemoryRecord])
    async def records(scope_kind: Literal["user_global", "workspace"], workspace_id: Id | None = None,
                      status: Literal["candidate", "confirmed", "rejected", "deleted"] | None = None,
                      limit: int = 100, cursor: str | None = None):
        selected = scope(scope_kind, workspace_id)
        if not 1 <= limit <= 500:
            raise DomainError("invalid_query", "分页数量须在1至500之间")
        with runtime.store.transaction(write=False) as tx:
            runtime.memory._scope(tx, selected)
            provider = runtime.memory.provider.using(tx)
            key = f"memory:{selected.model_dump_json()}:{status}"
            after = None
            if cursor:
                upper, after = page_position(cursor, key)
                upper, after = upper[0], after[0]
            else:
                last = provider.list_records(selected, status=status, limit=1, descending=True)
                if not last:
                    return Page[MemoryRecord](items=[], watermark=watermark(tx))
                upper = last[0].id
            rows = provider.list_records(selected, status=status, after=after, upper=upper, limit=limit + 1)
            next_cursor = page_cursor(key, [upper], [rows[limit - 1].id]) if len(rows) > limit else None
            return Page[MemoryRecord](items=rows[:limit], next_cursor=next_cursor, watermark=watermark(tx))

    @route.post("/memory/records", response_model=MemoryRecord, status_code=201)
    async def create(command=body(Command[CreateMemory])):
        return runtime.memory.create(command.data.text, command.data.scope, command.data.kind, command.meta)

    @route.get("/memory/records/{id}", response_model=MemoryRecord)
    async def record(id: Id, response: Response, receipt_message_id: Id | None = None):
        response.headers["Cache-Control"] = "no-store"
        with runtime.store.transaction(write=False) as tx:
            if receipt_message_id is not None:
                from flowmate.memory.chat import candidate_for_receipt
                return candidate_for_receipt(runtime.memory, tx, id, receipt_message_id)
            return runtime.memory._get(tx, id)

    @route.post("/memory/records/{id}/decisions", response_model=MemoryRecord)
    async def decide(id: Id, command=body(Command[MemoryDecision]), receipt_message_id: Id | None = None):
        return runtime.memory.decide(id, command.data.action, command.data.text, command.data.scope, command.meta,
            receipt_message_id=receipt_message_id)

    @route.get("/memory/records/{id}/evidence", response_model=Page[MemoryEvidenceView])
    async def evidence(id: Id, response: Response):
        response.headers["Cache-Control"] = "no-store"
        with runtime.store.transaction(write=False) as tx:
            return Page[MemoryEvidenceView](items=runtime.memory.evidence(id, tx=tx), watermark=watermark(tx))

    @route.get("/memory/records/{id}/evidence/{evidence_index}/excerpt", response_model=MemoryEvidenceExcerpt)
    async def evidence_excerpt(id: Id, evidence_index: int, expected_revision: int, response: Response,
                               offset: int = 0, receipt_message_id: Id | None = None):
        response.headers["Cache-Control"] = "no-store"
        with runtime.store.transaction(write=False) as tx:
            return runtime.memory.evidence_excerpt(id, evidence_index, expected_revision,
                offset=offset, receipt_message_id=receipt_message_id, tx=tx)

    @route.get("/settings/memory", response_model=MemoryPolicy)
    async def setting(scope_kind: Literal["user_global", "workspace"], workspace_id: Id | None = None):
        return runtime.memory.get_policy(scope(scope_kind, workspace_id))

    @route.put("/settings/memory", response_model=MemoryPolicy)
    async def save_setting(command=body(Command[MemoryPolicy])):
        return runtime.memory.save_policy(command.data, command.meta)

    @route.post("/memory/grants", response_model=DataUseGrant, status_code=201)
    async def grant(command=body(Command[MemoryGrantCommand])):
        return runtime.policy.grant_memory(command.data, command.meta)

    @route.get("/memory/grants", response_model=Page[DataUseGrant])
    async def grants(scope_kind: Literal["user_global", "workspace"], workspace_id: Id | None = None,
                     limit: int = 100, cursor: str | None = None):
        selected = scope(scope_kind, workspace_id)
        with runtime.store.transaction(write=False) as tx:
            runtime.memory._scope(tx, selected)
            return _page(tx, DataUseGrant, f"memory_grants:{selected.model_dump_json()}",
                "SELECT id,document FROM grants WHERE workspace_id IS ? AND "
                "json_array_length(json_extract(document,'$.memory_scopes'))>0",
                [selected.workspace_id], limit=limit, cursor=cursor)

    return route
