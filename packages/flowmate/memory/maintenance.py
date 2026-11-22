"""两阶段整理：明确来源边界，复用单 Scheduler 和 MemoryService。"""

import asyncio
import json
from uuid import UUID, uuid5

from flowmate.contracts.base import CommandMeta, DomainError
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    ActivityIntent,
    BudgetAllocation,
    BudgetGroupSnapshot,
    BudgetSnapshot,
    Checkpoint,
    ModelMessage,
    RunOutput,
    RunSnapshot,
    RuntimeChange,
    ScopeDependency,
    StepDecision,
    TaskSnapshot,
    TextPart,
    ToolResultPart,
)
from flowmate.contracts.scopes import ScopeRef
from flowmate.memory.contracts import MemoryEvidence
from flowmate.memory.maintenance_contracts import (
    ExtractionBatch,
    ExtractionReceipt,
    MemoryMaintenanceAuthorization,
    MemoryMaintenanceInput,
    MemoryMaintenanceNotice,
    MemoryMaintenanceState,
    MemorySourceBoundary,
    MergeReceipt,
    MergeRequest,
)
from flowmate.memory.service import _locate, _merge, digest
from flowmate.models.pricing import pricing_reason, resolve_pricing
from flowmate.policy.contracts import DataUseGrant, ToolInvocation
from flowmate.runtime.budget import DIMENSIONS
from flowmate.runtime.transitions import (
    bump,
    check_dispatch,
    check_scopes,
    context_for,
    emit,
    load,
    utc_now,
)
from flowmate.settings import SettingsService
from flowmate.tools.catalog import ToolOutcome, ToolSpec

MAINTENANCE_TOOLS = {"memory.extract", "memory.merge"}


def maintenance_state(tx, task_id):
    value = load(tx, Checkpoint, task_id).context_manifest.get("memory_maintenance")
    if value is None:
        raise DomainError("maintenance_binding", "任务没有固定整理边界")
    return MemoryMaintenanceState.model_validate(value)


def permits_source(tx, ctx, run_id, event_id):
    if load(tx, RunSnapshot, ctx.run_id).kind != "maintenance":
        return False
    boundary = maintenance_state(tx, ctx.task_id).input.source_boundary
    return boundary.run_id == run_id and event_id <= boundary.event_id


class MemoryMaintenance:
    def __init__(self, store, memory, policy, service, *, settings, clock=utc_now, strategy_version=1):
        self.store, self.memory, self.policy, self.service = store, memory, policy, service
        self.settings = settings
        self.clock, self.strategy_version = clock, strategy_version
        self._activation_lock = asyncio.Lock()

    def boundary(self, run_id, *, tx=None):
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.boundary(run_id, tx=tx)
        run = load(tx, RunSnapshot, run_id)
        if run.kind not in {"user", "managed"}:
            raise DomainError("maintenance_source_invalid", "整理触发源须为真实普通或托管运行")
        event_id = tx.execute("SELECT max(event_id) FROM events WHERE run_id=?", (run_id,)).fetchone()[0]
        return MemorySourceBoundary(run_id=run_id, event_id=event_id)

    def _sources(self, tx, boundary):
        source = load(tx, RunSnapshot, boundary.run_id)
        self.boundary(source.id, tx=tx)
        if not tx.execute("SELECT 1 FROM events WHERE run_id=? AND event_id=?",
                (source.id, boundary.event_id)).fetchone():
            raise DomainError("maintenance_source_invalid", "提取边界不是该运行的已提交事件")
        evidence = []
        for row in tx.execute("SELECT document FROM messages WHERE run_id=? AND task_id=? "
                "AND event_id<=? ORDER BY event_id,event_index",
                (source.id, source.root_task_id, boundary.event_id)):
            message = ModelMessage.model_validate_json(row[0])
            for index, part in enumerate(message.parts):
                if isinstance(part, TextPart):
                    locator = f"/parts/{index}/text"
                elif isinstance(part, ToolResultPart) and part.error is None:
                    locator = f"/parts/{index}/result"
                else:
                    continue
                author = "user" if message.origin == "answer" else message.role
                if author not in {"user", "assistant", "tool"} or message.origin == "task_result":
                    continue
                item = MemoryEvidence(source_kind="message", source_id=message.id,
                    source_version=digest(row[0]), locator=locator,
                    quote_hash=digest(_locate(json.loads(row[0]), locator)), author_kind=author)
                try:
                    self.memory._evidence(tx, item)
                except DomainError as error:
                    if error.code != "invalid_evidence":
                        raise
                    continue
                evidence.append(item)
        for row in tx.execute("SELECT event_id,document FROM events WHERE run_id=? AND event_id<=? AND "
                "json_extract(document,'$.kind')='activity.received' AND json_extract(document,'$.task_id')=? "
                "ORDER BY event_id", (source.id, boundary.event_id, source.root_task_id)):
            document = json.loads(row["document"])
            for index, activity in enumerate(document["payload"]["activities"]):
                if (activity["intent"]["kind"] != "tool" or activity["state"] != "succeeded"
                        or activity["receipt"] is None or activity["receipt"]["error"] is not None):
                    continue
                locator = f"/payload/activities/{index}/receipt/result"
                item = MemoryEvidence(source_kind="event", source_id=str(row["event_id"]),
                    source_version=digest(row["document"]), locator=locator,
                    quote_hash=digest(_locate(document, locator)), author_kind="tool")
                self.memory._evidence(tx, item)
                evidence.append(item)
        if not evidence:
            raise DomainError("maintenance_no_sources", "固定边界没有可用来源")
        if len(evidence) > 100:
            raise DomainError("maintenance_source_limit", "来源超过单批边界，请选择更小的已提交范围")
        return source, evidence

    def _grant(self, tx, scope, endpoint):
        grants = [DataUseGrant.model_validate_json(row[0]) for row in tx.execute(
            "SELECT document FROM grants WHERE workspace_id IS ? AND status='active'", (scope.workspace_id,))]
        grant = next((grant for grant in grants if grant.memory_scopes == [scope]
            and grant.destination == endpoint and "model_send" in grant.purposes), None)
        if grant is None:
            raise DomainError("grant_required", "整理来源尚未授权发送至该模型目的地")
        check_scopes(tx, [ScopeDependency(scope_id=grant.id, epoch=grant.epoch)])
        return grant

    def _limits(self, tx, source, requested, confirmation):
        if confirmation is not None:
            if confirmation.limits != requested:
                raise DomainError("version_conflict", "本次确认的维护额度与已读策略不一致")
            if (requested.max_tasks < 1 or requested.max_model_requests < 1 or requested.max_steps < 4
                    or requested.max_cost_units == 0 or requested.max_total_tokens == 0):
                raise DomainError("allocation_exceeded", "本次维护预算没有可用整理额度")
            return requested
        group = load(tx, BudgetGroupSnapshot, source.budget_group_id)
        if self.clock() >= group.deadline_at:
            raise DomainError("deadline_exceeded", "原授权组期限已过")
        limits = requested.model_dump()
        active = [(BudgetAllocation.model_validate_json(row[0]), BudgetSnapshot.model_validate_json(row[1]))
            for row in tx.execute("SELECT a.document,b.document FROM budget_allocations a JOIN budgets b "
                "ON b.run_id=a.run_id WHERE a.budget_group_id=?", (group.id,))]
        for field, counters in DIMENSIONS.items():
            cap = getattr(group.limits, field)
            if cap is not None:
                occupied = sum(max(0, getattr(allocation.limits, field) -
                    sum(getattr(budget, counter) for counter in counters))
                    for allocation, budget in active if not allocation.returned and budget.run_id != source.id)
                available = max(0, cap - sum(getattr(group, counter) for counter in counters) - occupied)
                limits[field] = min(limits[field], available) if limits[field] is not None else available
        for field in ("max_delegation_depth", "max_parallel_agents"):
            limits[field] = min(limits[field], getattr(group.limits, field))
        if (limits["max_tasks"] < 1 or limits["max_model_requests"] < 1 or limits["max_steps"] < 4
                or limits["max_cost_units"] == 0 or limits["max_total_tokens"] == 0):
            raise DomainError("allocation_exceeded", "原因果预算组没有可用整理额度")
        return requested.model_validate(limits)

    async def submit_authenticated(self, scope, source_boundary, authorization, meta):
        """手动与自动入口共用凭据作用域，写事务仍拥有重放及最终配置核对。"""
        with self.store.transaction(write=False) as tx:
            previous = tx.previous_command(meta.command_id)
            if previous is None:
                self.boundary(source_boundary.run_id, tx=tx)
                setting = self.memory.get_policy(scope, tx=tx)
                model = tx.get_profile("model", setting.model_profile_id) if setting.model_profile_id else None
                connection = tx.get_connection(model.connection_id) if model else None
        if previous is not None or model is None or setting.version != authorization.policy_version:
            return self.submit(scope, source_boundary, authorization, meta)
        async with self.settings.model_resolution_scope(model.id):
            return self.submit(scope, source_boundary, authorization, meta,
                expected_binding=(setting, model, connection))

    def submit(self, scope, source_boundary, authorization, meta, *, expected_binding=None):
        source_boundary = MemorySourceBoundary.model_validate(source_boundary.model_dump())
        authorization = MemoryMaintenanceAuthorization.model_validate(authorization.model_dump())
        fingerprint = digest(json.dumps({"scope": scope.model_dump(mode="json"),
            "source_boundary": source_boundary.model_dump(mode="json"),
            "authorization": authorization.model_dump(mode="json"),
            "strategy_version": self.strategy_version}, sort_keys=True))
        from flowmate.contracts.execution import TaskHandle
        with self.store.transaction() as tx:
            previous = tx.previous_command(meta.command_id)
            if previous is not None:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict", "同一整理命令不能改变来源或授权")
                return TaskHandle.model_validate_json(previous["response"])
            self.boundary(source_boundary.run_id, tx=tx)
            self.memory._scope(tx, scope)
            setting = self.memory.get_policy(scope, tx=tx)
            if expected_binding is not None:
                prepared_setting, prepared_model, prepared_connection = expected_binding
                if (setting != prepared_setting
                        or tx.get_profile("model", prepared_model.id) != prepared_model
                        or tx.get_connection(prepared_connection.id) != prepared_connection):
                    raise DomainError("version_conflict", "整理策略、型号或连接在凭据核验期间已改变，请重新读取")
            if setting.version != authorization.policy_version:
                raise DomainError("version_conflict", "整理策略版本已改变")
            if authorization.automatic and not setting.auto_organize:
                raise DomainError("auto_organize_disabled", "自动整理未启用")
            if setting.model_profile_id is None:
                raise DomainError("maintenance_model_missing", "尚未选择整理模型")
            profile = SettingsService.resolve_model(tx, setting.model_profile_id)
            confirmation = authorization.budget_confirmation
            if confirmation is not None and (confirmation.model_profile_id != profile.id
                    or confirmation.model_version != profile.version
                    or confirmation.connection_version != profile.connection_version):
                raise DomainError("version_conflict", "本次确认的整理模型或连接版本已改变")
            if profile.secret_ref is None or not profile.capabilities.tools:
                raise DomainError("maintenance_model_missing", "整理模型缺少凭据引用或工具能力")
            grant = self._grant(tx, scope, profile.endpoint)
            source, evidence = self._sources(tx, source_boundary)
            if scope.workspace_id not in {None, source.workspace_id}:
                raise DomainError("scope_mismatch", "整理来源不属于所选项目")
            limits = self._limits(tx, source, setting.maintenance_limits, confirmation)
            dependencies = _merge([*source.scope_dependencies,
                ScopeDependency(scope_id=grant.id, epoch=grant.epoch)])
            pricing = resolve_pricing(profile)
            catalog = self.service.catalog.snapshot()
            config = source.config.model_copy(update={"model_profile": profile, "model_pricing": pricing,
                "pricing_unknown_reason": pricing_reason(profile) if pricing is None else None, "members": {},
                "catalog": catalog.model_copy(update={"tools": {
                    name: catalog.tools[name] for name in MAINTENANCE_TOOLS}})})
            input = MemoryMaintenanceInput(scope=scope, source_boundary=source_boundary,
                authorization=authorization, strategy_version=self.strategy_version, evidence=evidence,
                dependencies=dependencies, record_revisions={record.id: record.revision for record in
                    self.memory.provider.using(tx).query(scope, False, 500)})
            state = MemoryMaintenanceState(input=input)
            handle = self.service.start_maintenance_tx(tx, source, config, limits, source.sources,
                dependencies, state, meta)
            ctx = context_for(tx, handle.task_id)
            observed = []
            for item in evidence:
                observed.extend(self.memory._evidence(tx, item, ctx=ctx))
            dependencies = _merge([*dependencies, *observed])
            decision = self.policy.check_tx(tx, ctx, dependencies, "model_send", profile.endpoint)
            if not decision.allowed:
                raise DomainError(decision.reason or "grant_required", "固定来源缺少整理目的地发送许可")
            dependencies = _merge([*dependencies, *decision.dependencies])
            self._save_state(tx, ctx, state.model_copy(update={"input": input.model_copy(
                update={"dependencies": dependencies})}))
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)", (meta.command_id, fingerprint,
                handle.model_dump_json(), source.workspace_id, source.interaction_session_id))
            self._notice(tx, MemoryMaintenanceNotice(id=meta.command_id, scope=scope,
                source_boundary=source_boundary, policy_version=setting.version, task=handle))
            return handle

    def _notice(self, tx, notice):
        source = load(tx, RunSnapshot, notice.source_boundary.run_id)
        tx.append_event(NewEvent(kind="memory.maintenance_changed", workspace_id=notice.scope.workspace_id,
            session_id=source.interaction_session_id, causation_id=notice.id, payload=notice))

    def _check(self, tx, ctx):
        run, task = load(tx, RunSnapshot, ctx.run_id), load(tx, TaskSnapshot, ctx.task_id)
        if (run.kind != "maintenance" or task.id != run.root_task_id or run.state in TERMINAL
                or task.state in TERMINAL or context_for(tx, task.id) != ctx.model_copy(update={"activity_id": None})):
            raise DomainError("maintenance_binding", "整理上下文不属于当前真实维护任务")
        check_dispatch(tx, run, task, self.clock())
        state = maintenance_state(tx, task.id)
        setting = self.memory.get_policy(state.input.scope, tx=tx)
        if setting.version != state.input.authorization.policy_version:
            raise DomainError("version_conflict", "整理策略版本已改变")
        if state.input.authorization.automatic and not setting.auto_organize:
            raise DomainError("auto_organize_disabled", "自动整理已停用")
        self._grant(tx, state.input.scope, task.binding.config.model_profile.endpoint)
        check_scopes(tx, state.input.dependencies)
        for evidence in state.input.evidence:
            self.memory._evidence(tx, evidence, ctx=ctx)
        return state

    def context_message(self, tx, ctx):
        state = self._check(tx, ctx)
        items = []
        for evidence in state.input.evidence:
            table, key = ("events", "event_id") if evidence.source_kind == "event" else ("messages", "id")
            raw = tx.execute(f"SELECT document FROM {table} WHERE {key}=?", (evidence.source_id,)).fetchone()[0]
            items.append({"text": _locate(json.loads(raw), evidence.locator),
                "evidence": evidence.model_dump(mode="json")})
        return ModelMessage(id=str(uuid5(UUID(ctx.run_id), "maintenance.sources")), role="user",
            parts=[TextPart(text=json.dumps({"memory_extraction_sources": {
                "source_boundary": state.input.source_boundary.model_dump(mode="json"),
                "scope": state.input.scope.model_dump(mode="json"),
                "strategy_version": state.input.strategy_version,
                "record_revisions": state.input.record_revisions, "items": items}}, ensure_ascii=False))],
            source_dependencies=state.input.dependencies)

    def _batch(self, state, batch):
        if batch.source_boundary != state.input.source_boundary or batch.strategy_version != state.input.strategy_version:
            raise DomainError("maintenance_binding", "提取批次与固定边界或策略版本不一致")
        if any(item not in state.input.evidence for item in batch.evidence):
            raise DomainError("invalid_evidence", "批次引用不属于固定来源")
        for proposal in batch.candidates:
            if proposal.scope != state.input.scope or any(item not in batch.evidence for item in proposal.evidence):
                raise DomainError("scope_mismatch", "候选超出所选范围或批次证据")
            if proposal.record_id is not None and state.input.record_revisions.get(
                    proposal.record_id) != proposal.expected_revision:
                raise DomainError("version_conflict", "候选没有绑定提取时的原记忆修订")

    def _save_state(self, tx, ctx, state):
        checkpoint = load(tx, Checkpoint, ctx.task_id)
        manifest = {**checkpoint.context_manifest, "memory_maintenance": state.model_dump(mode="json")}
        emit(tx, load(tx, RunSnapshot, ctx.run_id), ctx.task_id, "task.stepped",
            RuntimeChange(checkpoints=[bump(checkpoint, context_manifest=manifest)]))

    def extract(self, ctx, batch):
        batch = (ExtractionBatch.model_validate_json(json.dumps(batch, allow_nan=False))
            if isinstance(batch, dict) else ExtractionBatch.model_validate(batch.model_dump()))
        with self.store.transaction() as tx:
            state = self._check(tx, ctx)
            self._batch(state, batch)
            if state.batch is not None and state.batch != batch:
                raise DomainError("command_conflict", "同一维护任务不能替换已提交批次")
            self._save_state(tx, ctx, state.model_copy(update={"batch": batch}))
        return ExtractionReceipt(candidate_count=len(batch.candidates))

    def validate_and_merge(self, ctx, batch, meta):
        return self.memory.merge_extraction(self, ctx, batch, meta)

    def before_step(self, ctx, checkpoint):
        with self.store.transaction(write=False) as tx:
            state = self._check(tx, ctx)
        if state.merged:
            if checkpoint.phase == "preparing_output":
                return None
            return StepDecision(kind="continue", checkpoint=checkpoint.model_copy(update={
                "phase": "preparing_output", "output": RunOutput(summary=f"记忆整理已提交 {len(state.record_ids)} 项审阅结果")}))
        if state.batch is not None and not checkpoint.pending_call_ids:
            call = ToolInvocation(call_id="memory.merge", name="memory.merge", version="1", arguments={})
            return StepDecision(kind="activity", intent=ActivityIntent(kind="tool", origin="runtime",
                operation=call.name, arguments=call.model_dump(mode="json"), dependencies=state.input.dependencies))
        if checkpoint.phase == "preparing_output":
            return StepDecision(kind="wait_user", reason="maintenance_extraction_required",
                checkpoint=checkpoint.model_copy(update={"phase": "waiting_user", "output": None}))
        return None

    def _ready_automatic(self):
        """只读候选来源的 ID/完成边界；不装载整份历史 Run 或扫描所有连接。"""
        ready = []
        with self.store.transaction(write=False) as tx:
            policies = [self.memory.get_policy(ScopeRef.model_validate(json.loads(row[0])["scope"]), tx=tx)
                for row in tx.execute("SELECT document FROM memory_policies WHERE json_extract(document,'$.auto_organize')=1")]
            for setting in policies:
                enabled_at = tx.execute("SELECT max(e.event_id) FROM events e,"
                    "json_each(e.document,'$.payload.policies') p WHERE "
                    "json_extract(e.document,'$.kind')='memory.policy_changed' AND "
                    "json_extract(p.value,'$.version')=? AND json_extract(p.value,'$.scope.kind')=? "
                    "AND json_extract(p.value,'$.scope.workspace_id') IS ?",
                    (setting.version, setting.scope.kind, setting.scope.workspace_id)).fetchone()[0]
                if enabled_at is None:
                    continue
                handled = {row[0] for row in tx.execute(
                    "SELECT json_extract(document,'$.causation_id') FROM events WHERE "
                    "json_extract(document,'$.kind')='memory.maintenance_changed' AND "
                    "json_extract(document,'$.payload.policy_version')=? AND "
                    "json_extract(document,'$.payload.scope.kind')=? AND "
                    "json_extract(document,'$.payload.scope.workspace_id') IS ?",
                    (setting.version, setting.scope.kind, setting.scope.workspace_id))}
                workspace_filter = " AND r.workspace_id=?" if setting.scope.workspace_id is not None else ""
                parameters = (enabled_at, setting.scope.workspace_id) if workspace_filter else (enabled_at,)
                for row in tx.execute(
                    "SELECT r.id,max(e.event_id) FROM runs r JOIN events e ON e.run_id=r.id "
                    "JOIN json_each(e.document,'$.payload.runs') completed WHERE "
                    "r.kind IN ('user','managed') AND r.state='completed' AND e.event_id>? AND "
                    "json_extract(completed.value,'$.id')=r.id AND "
                    "json_extract(completed.value,'$.state')='completed'" + workspace_filter + " GROUP BY r.id",
                    parameters):
                    source_id, completed_at = row
                    command_id = str(uuid5(UUID(source_id), f"memory:{setting.scope.model_dump_json()}:{setting.version}:{self.strategy_version}"))
                    if command_id not in handled:
                        ready.append((setting, MemorySourceBoundary(run_id=source_id, event_id=completed_at),
                            CommandMeta(command_id=command_id)))
        return ready

    async def activate_ready(self):
        # 同一 Runtime 的并发唤醒串行消费已完成/失败通知，避免重复凭据读取和失败通知。
        async with self._activation_lock:
            submitted = 0
            for setting, boundary, meta in self._ready_automatic():
                try:
                    await self.submit_authenticated(setting.scope, boundary, MemoryMaintenanceAuthorization(
                        policy_version=setting.version, automatic=True), meta)
                    submitted += 1
                except DomainError as error:
                    with self.store.transaction() as tx:
                        if (tx.execute("SELECT 1 FROM runs WHERE id=?", (boundary.run_id,)).fetchone()
                                and not tx.execute("SELECT 1 FROM events WHERE "
                                    "json_extract(document,'$.kind')='memory.maintenance_changed' AND "
                                    "json_extract(document,'$.causation_id')=?", (meta.command_id,)).fetchone()):
                            self._notice(tx, MemoryMaintenanceNotice(id=meta.command_id, scope=setting.scope,
                                source_boundary=boundary, policy_version=setting.version, reason=error.code))
            return submitted


def register_maintenance_tools(catalog, maintenance):
    async def extract(ctx, args, cancel):
        if cancel.is_set():
            raise DomainError("tool_cancelled", "提取已取消")
        return ToolOutcome(result=maintenance.extract(ctx, args).model_dump(mode="json"))

    async def merge(ctx, args, cancel):
        if cancel.is_set():
            raise DomainError("tool_cancelled", "合并已取消")
        with maintenance.store.transaction(write=False) as tx:
            state = maintenance_state(tx, ctx.task_id)
        records = maintenance.validate_and_merge(ctx, state.batch, CommandMeta(
            command_id=str(uuid5(UUID(ctx.activity_id), "memory.merge"))))
        return ToolOutcome(result=MergeReceipt(record_ids=[record.id for record in records]).model_dump(mode="json"))

    for name, handler, input_model, output, visible in (
        ("memory.extract", extract, ExtractionBatch, ExtractionReceipt, True),
        ("memory.merge", merge, MergeRequest, MergeReceipt, False),
    ):
        catalog.register(ToolSpec(name=name, version="1", input_schema=input_model.model_json_schema(),
            result_schema=output.model_json_schema(mode="serialization"), model_visible=visible,
            background_supported=False, cancellation="cooperative", retry_class="idempotent"),
            handler, input_model=input_model, result_model=output)
