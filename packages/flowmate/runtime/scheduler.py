"""统一调度：步骤只提出决定，外部发送和回执各有一个事务边界。"""

import asyncio
import hashlib
import json
import sqlite3
from datetime import timedelta

from flowmate.contracts.base import CommandMeta, DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    AccountingActivity,
    AccountingBudget,
    ActivityReceipt,
    ActivityRef,
    ActivitySnapshot,
    AgentResult,
    BudgetSnapshot,
    Checkpoint,
    ConsumerRef,
    DispatchPermit,
    ExportReceipt,
    JoinDecision,
    ModelMessage,
    OutboxItem,
    ReceiptCommit,
    RunSnapshot,
    RuntimeChange,
    StepDecision,
    TaskHandle,
    TaskSnapshot,
    ToolResultPart,
    WaitRecord,
)
from flowmate.host.diagnostics import make_diagnostic, write_diagnostic
from flowmate.policy.contracts import LifecycleChange, ResourceRecord
from flowmate.runtime.budget import BudgetService, known_tokens
from flowmate.runtime.leases import owns_session
from flowmate.runtime.recovery import recover
from flowmate.runtime.transitions import (
    bump,
    can_publish,
    check_dispatch,
    check_scopes,
    context_for,
    emit,
    load,
    pending_outbox,
    stop_run,
    stop_task,
    utc_now,
)


def _result_digest(receipt):
    body = json.dumps([receipt.result, receipt.error], sort_keys=True,
                      separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(body.encode()).hexdigest()


def _merge_receipt(activity, incoming, *, model_protocol=None):
    previous = activity.receipt
    if previous is None:
        return incoming
    for name in ("actual_units", "provider_request_id"):
        old, new = getattr(previous, name), getattr(incoming, name)
        if old is not None and new is not None and old != new:
            raise DomainError("receipt_conflict", "确定回执不一致")
    usage = previous.usage.model_dump()
    for name in ("input_tokens", "output_tokens", "cached_input_tokens", "cache_write_tokens",
                 "cache_write_1h_tokens", "source"):
        old, new = usage[name], getattr(incoming.usage, name)
        if name == "cached_input_tokens":
            # 旧 wire 回执也用零表示缺失。重放这种回执不能覆盖后来收到的计数。
            if old == 0 and previous.usage.source == "provider_wire" and not previous.usage.cache_read_reported:
                old = None
            if new == 0 and incoming.usage.source == "provider_wire" and not incoming.usage.cache_read_reported:
                new = None
        if old is not None and new is not None and old != new:
            if name == "input_tokens" and model_protocol == "anthropic":
                legacy, reported = ((incoming, previous) if previous.usage.cache_read_reported
                                    else (previous, incoming))
                legacy_usage, reported_usage = legacy.usage, reported.usage
                cached = reported_usage.cached_input_tokens
                # 旧 Messages 总量少加了默认成零的缓存读数。只接受普通输入、写入和输出都能对上的补正。
                if (legacy.confirmed and reported.confirmed and legacy.actual_units is None
                        and legacy_usage.source == reported_usage.source == "provider_wire"
                        and legacy_usage.cache_read_reported is None and legacy_usage.cached_input_tokens == 0
                        and reported_usage.cache_read_reported is True and cached is not None and cached > 0
                        and legacy_usage.output_tokens is not None
                        and legacy_usage.output_tokens == reported_usage.output_tokens
                        and legacy_usage.cache_write_tokens is not None
                        and legacy_usage.cache_write_tokens == reported_usage.cache_write_tokens
                        and legacy_usage.input_tokens >= legacy_usage.cache_write_tokens
                        and reported_usage.input_tokens - legacy_usage.input_tokens == cached):
                    usage[name] = reported_usage.input_tokens
                    continue
            raise DomainError("receipt_conflict", "确定用量不一致")
        if new is not None:
            usage[name] = new
    if incoming.usage.status == "known":
        usage["status"] = "known"
    if incoming.usage.cache_read_reported:
        usage["cache_read_reported"] = True
    if previous.confirmed and incoming.confirmed and activity.result_digest != _result_digest(incoming):
        raise DomainError("receipt_conflict", "确定执行结果不一致")
    return incoming.model_copy(update={
        "confirmed": previous.confirmed or incoming.confirmed,
        "result": incoming.result if incoming.confirmed else previous.result,
        "error": incoming.error if incoming.confirmed else previous.error,
        "actual_units": incoming.actual_units if incoming.actual_units is not None else previous.actual_units,
        "provider_request_id": incoming.provider_request_id or previous.provider_request_id,
        "usage": previous.usage.model_validate(usage),
    })


class Scheduler:
    def __init__(self, store, executors, limits, *, clock=None):
        self.store = store
        self.executors = dict(executors)
        self.limits = limits
        self.clock = clock or utc_now
        self.budgets = BudgetService()
        self._drivers = {}
        self._wake = asyncio.Event()
        self._pump_task = None
        self._maintenance_task = None
        self._knowledge_cleanup_tasks = {}
        self._knowledge_cleanup_initial = True
        self._failure = None
        self._running = {}
        self._unsubscribe = None
        self._slots = {}
        self._active_slots = {}
        self._running_slots = {}
        self._interactive_batch = {}
        self._background_cursor = {}
        self.policy = None
        self.artifacts = None
        self.private_state = None
        self.tasks = None
        self.waits = None
        self.followups = None
        self.maintenance = None
        self.knowledge = None
        self.compaction = None
        self.naming_model = None

    def configure_tasks(self, catalog):
        from flowmate.runtime.delivery import DeliveryService
        from flowmate.runtime.tasks import TaskService
        from flowmate.runtime.waits import WaitService

        if self._pump_task is not None or self.tasks is not None:
            raise DomainError("runtime_configuration_frozen", "任务服务须在调度启动前装配一次")
        self.delivery = DeliveryService(self.store,config=self.limits,clock=self.clock)
        self.tasks = TaskService(self.store, catalog, policy=self.policy, clock=self.clock,
            delivery=self.delivery, artifacts=self.artifacts, scheduler=self)
        self.waits = WaitService(self.store, clock=self.clock)

    def configure_models(self, private_state):
        if self._pump_task is not None or self.private_state is not None:
            raise DomainError("runtime_configuration_frozen", "模型服务须在调度启动前装配一次")
        self.private_state = private_state

    def configure_context(self, compaction):
        if self._pump_task is not None or self.compaction is not None:
            raise DomainError("runtime_configuration_frozen", "上下文提交策略须在调度启动前装配一次")
        self.compaction = compaction

    def configure_followups(self, service):
        from flowmate.runtime.followups import FollowUpService
        self.followups = FollowUpService(self.store, service)

    def configure_maintenance(self, maintenance):
        self.maintenance = maintenance

    def configure_knowledge(self, ingestion):
        self.knowledge = ingestion

    def configure_tools(self, policy, artifacts):
        if self._pump_task is not None or self.policy is not None:
            raise DomainError("runtime_configuration_frozen", "工具服务须在调度启动前装配一次")
        self.policy = policy
        self.artifacts = artifacts

    def register_driver(self, kind, driver):
        """driver(ctx, activity, cancel, before_send)返回(receipt, pure_proposal)。"""
        if kind not in {"model", "tool"} or kind in self._drivers or self._pump_task:
            raise DomainError("driver_conflict", "活动执行器须在启动前明确装配")
        self._drivers[kind] = driver

    async def start(self, *, catalog=None):
        if self._pump_task is not None:
            return
        recover(self.store, catalog=catalog)
        if self.artifacts is not None:
            for view in self.artifacts.publication.reconcile():
                if view.state == "published":
                    applied = self.artifacts.publication.applied_receipt(view.id)
                    activity = self.activity(view.activity_id)
                    result = ExportReceipt(activity_id=activity.id,
                        target_ref=activity.intent.arguments["arguments"]["target_ref"],
                        content_hash=applied.content_hash, state="applied")
                    self.record_receipt_only(ActivityReceipt(activity_id=activity.id, attempt_id=activity.attempt_id,
                        confirmed=True, actual_units=0, result=result.model_dump(mode="json")), reason="runtime_restart")
        loop = asyncio.get_running_loop()
        self._failure = loop.create_future()
        self._knowledge_cleanup_initial = True
        self._slots = {"step": asyncio.Semaphore(self.limits.model_concurrency),
                        "model": asyncio.Semaphore(self.limits.model_concurrency),
                        "tool": asyncio.Semaphore(self.limits.file_concurrency)}
        if self.naming_model is not None:
            self._slots["naming"] = asyncio.Semaphore(1)
        self._active_slots = dict.fromkeys(self._slots, 0)
        self._interactive_batch = dict.fromkeys(self._slots, 0)
        self._background_cursor = dict.fromkeys(self._slots, "")
        self._unsubscribe = self.store.subscribe(lambda: loop.call_soon_threadsafe(self._wake.set))
        self._wake.set()
        self._pump_task = asyncio.create_task(self._pump())
        self._pump_task.add_done_callback(self._observe_failure)

    async def wait_failed(self):
        raise await asyncio.shield(self._failure)

    def _observe_failure(self, task):
        if not task.cancelled() and (error := task.exception()) is not None:
            if not self._failure.done():
                self._failure.set_result(error)
            self._wake.set()

    async def stop(self):
        if self._pump_task is None:
            return
        self._unsubscribe()
        self._pump_task.cancel()
        await asyncio.gather(self._pump_task, return_exceptions=True)
        if self._maintenance_task is not None:
            self._maintenance_task.cancel()
            await asyncio.gather(self._maintenance_task, return_exceptions=True)
            self._maintenance_task = None
        cleanup = list(self._knowledge_cleanup_tasks.values())
        for task in cleanup:
            task.cancel()
        await asyncio.gather(*cleanup, return_exceptions=True)
        self._knowledge_cleanup_tasks.clear()
        handles = list(self._running.values())
        for task, cancel, _ in handles:
            cancel.set()
            task.cancel()
        await asyncio.gather(*(item[0] for item in handles), return_exceptions=True)
        self._running.clear()
        self._running_slots.clear()
        self._pump_task = None
        if not self._failure.done():
            recover(self.store)

    async def _collect_knowledge(self, workspace_id, *, retry_failed):
        async with self._slots["tool"]:
            await self.knowledge.lifecycle.collect(workspace_id=workspace_id, retry_failed=retry_failed)

    async def _pump(self):
        from flowmate.runtime.naming import OPERATION

        delay = None
        while True:
            try:
                await asyncio.wait_for(self._wake.wait(), delay)
            except TimeoutError:
                pass
            self._wake.clear()
            if self._failure.done():
                return
            if self.tasks is not None:
                self.delivery.deliver_pending()
            if self.followups is not None:
                self.followups.activate_ready()
            if self.knowledge is not None:
                self.knowledge.activate_ready()
                self._knowledge_cleanup_tasks = {id: task for id, task in self._knowledge_cleanup_tasks.items()
                    if not task.done()}
                retry_failed = self._knowledge_cleanup_initial
                for id in self.knowledge.lifecycle.pending_workspaces(retry_failed=retry_failed):
                    if id not in self._knowledge_cleanup_tasks:
                        task = asyncio.create_task(self._collect_knowledge(id, retry_failed=retry_failed))
                        self._knowledge_cleanup_tasks[id] = task
                        task.add_done_callback(self._observe_failure)
                        task.add_done_callback(lambda _: self._wake.set())
                self._knowledge_cleanup_initial = False
            if self.maintenance is not None and (
                    self._maintenance_task is None or self._maintenance_task.done()):
                # 凭据读取可等待宿主；仅保留一个准备任务，不阻塞前台步骤和运行期限处理。
                self._maintenance_task = asyncio.create_task(self.maintenance.activate_ready())
                self._maintenance_task.add_done_callback(self._observe_failure)
            delay = self._expire_runs()
            with self.store.transaction(write=False) as tx:
                for key, (_, cancel, run_id) in self._running.items():
                    if tx.execute("SELECT 1 FROM accounting_budgets WHERE run_id=?", (run_id,)).fetchone():
                        cancel.set()
                        continue
                    activity = tx.execute("SELECT task_id FROM activities WHERE id=?", (key,)).fetchone()
                    task = load(tx, TaskSnapshot, activity[0] if activity else key)
                    run = load(tx, RunSnapshot, run_id)
                    if run.yield_requested or not can_publish(tx, run, task):
                        cancel.set()
                rows = tx.execute(
                    "SELECT o.document,r.kind,a.document FROM outbox o JOIN runs r ON r.id=o.run_id "
                    "JOIN tasks t ON t.id=o.task_id LEFT JOIN activities a ON a.id=o.activity_id WHERE o.state='pending' "
                    "AND r.state NOT IN ('interrupted','blocked_incompatible','completed','failed','cancelled') "
                     "AND t.state IN ('queued','running') ORDER BY o.rowid",
                ).fetchall()
            ready = {slot: [] for slot in self._slots}
            for row in rows:
                item = OutboxItem.model_validate_json(row[0])
                with self.store.transaction(write=False) as tx:
                    if load(tx, RunSnapshot, item.run_id).yield_requested:
                        continue
                key = item.activity_id or item.task_id
                if key not in self._running:
                    slot = "tool" if item.operation == "step" and row[1] == "knowledge" else "step"
                    if item.operation != "step":
                        intent = ActivitySnapshot.model_validate_json(row[2]).intent
                        slot = intent.kind
                        if intent.operation == OPERATION:
                            if self.naming_model is None:
                                continue
                            after = intent.arguments["after_run_id"]
                            if after is not None:
                                with self.store.transaction(write=False) as tx:
                                    source = tx.execute("SELECT state FROM runs WHERE id=?", (after,)).fetchone()
                                if source is not None and source[0] not in TERMINAL:
                                    continue
                            slot = "naming"
                    ready[slot].append((item, row[1] != "user"))
            for slot, candidates in ready.items():
                capacity = self.limits.file_concurrency if slot == "tool" else self.limits.model_concurrency
                if slot == "naming":
                    capacity = 1
                while candidates and self._active_slots[slot] < capacity:
                    interactive = [entry for entry in candidates if not entry[1]]
                    background = [entry for entry in candidates if entry[1]]
                    if background and (not interactive or self._interactive_batch[slot] >= 4):
                        after = [entry for entry in background if entry[0].run_id > self._background_cursor[slot]]
                        chosen = min(after or background, key=lambda entry: entry[0].run_id)
                        self._background_cursor[slot] = chosen[0].run_id
                        self._interactive_batch[slot] = 0
                    else:
                        chosen = interactive[0]
                        self._interactive_batch[slot] += 1
                    candidates.remove(chosen)
                    item = chosen[0]
                    key = item.activity_id or item.task_id
                    cancel = asyncio.Event()
                    task = asyncio.create_task(self._drive(item, cancel))
                    self._active_slots[slot] += 1
                    self._running_slots[key] = slot
                    self._running[key] = (task, cancel, item.run_id)
                    task.add_done_callback(lambda task, key=key: self._finished(key, task))

    def _expire_runs(self):
        from flowmate.runtime.waits import resolve_waits

        nearest = None
        now = self.clock()
        with self.store.transaction(write=False) as tx:
            rows = tx.execute("SELECT id FROM runs WHERE state NOT IN "
                              "('completed','failed','cancelled')").fetchall()
        for row in rows:
            run_id = row[0]
            try:
                with self.store.transaction() as tx:
                    run = load(tx, RunSnapshot, run_id)
                    remaining = (run.deadline_at - now).total_seconds()
                    if remaining <= 0:
                        stop_run(tx, run, "failed", "deadline_exceeded")
                        continue
                    nearest = remaining if nearest is None else min(nearest, remaining)
                    for task_row in tx.execute("SELECT document FROM tasks WHERE run_id=? AND id!=? AND state NOT IN "
                            "('completed','failed','cancelled')", (run.id, run.root_task_id)).fetchall():
                        task = TaskSnapshot.model_validate_json(task_row[0])
                        if task.deadline_at is not None:
                            time_left = (task.deadline_at - now).total_seconds()
                            if time_left <= 0:
                                stop_task(tx, run, task, "cancelled", "deadline_exceeded")
                            else:
                                nearest = min(nearest, time_left)
                    resolve_waits(tx, now, run_id=run.id)
                    self._try_join(tx, run.id)
                    for wait_row in tx.execute("SELECT document FROM waits WHERE state='pending' AND run_id=?",
                                               (run.id,)):
                        wait = WaitRecord.model_validate_json(wait_row[0])
                        if wait.deadline_at is not None:
                            nearest = min(nearest, max(0, (wait.deadline_at - now).total_seconds()))
            except sqlite3.Error:
                raise
            except Exception as error:
                code = error.code if isinstance(error, DomainError) else "scheduler_failed"
                write_diagnostic(make_diagnostic("scheduler_run_failed", error, request_id=run_id))
                with self.store.transaction() as tx:
                    stop_run(tx, load(tx, RunSnapshot, run_id), "failed", code)
        return nearest

    def _finished(self, key, task):
        self._running.pop(key, None)
        slot = self._running_slots.pop(key)
        self._active_slots[slot] -= 1
        self._observe_failure(task)
        self._wake.set()

    async def _drive(self, item, cancel):
        from flowmate.runtime.naming import OPERATION, drive_title

        receipt = None
        try:
            if self.is_deleted(item.run_id):
                return
            if item.operation == "step":
                slot = "tool" if self._read(RunSnapshot, item.run_id).kind == "knowledge" else "step"
                async with self._slots[slot]:
                    with self.store.transaction(write=False) as tx:
                        task = load(tx, TaskSnapshot, item.task_id)
                        run = load(tx, RunSnapshot, item.run_id)
                        check_dispatch(tx, run, task, self.clock())
                        ctx = context_for(tx, task.id)
                        checkpoint = load(tx, Checkpoint, task.id)
                    executor = self.executors.get(task.executor_id)
                    if executor is None:
                        raise DomainError("blocked_incompatible", "所需任务执行器未装配")
                    decision = await executor.step(ctx, checkpoint)
                    self.commit_step(task.id, task.version, decision)
            else:
                activity = self.activity(item.activity_id)
                ctx = self.context(item.task_id).model_copy(update={"activity_id": activity.id})
                naming = activity.intent.operation == OPERATION
                async with self._slots["naming" if naming else activity.intent.kind]:
                    if naming:
                        result = await drive_title(self.store, self.naming_model, ctx, activity, cancel, self.dispatch)
                    else:
                        driver = self._drivers.get(activity.intent.kind)
                        if driver is None:
                            raise DomainError("blocked_incompatible", "所需活动执行器未装配")
                        result = await driver(ctx, activity, cancel, self.dispatch)
                    if result is None:
                        return
                    receipt, proposal = result
                    self.record_receipt(receipt, proposal)
        except asyncio.CancelledError:
            if receipt is not None:
                self.record_receipt_only(receipt, reason="execution_cancelled")
            elif item.activity_id:
                with self.store.transaction(write=False) as tx:
                    row = tx.execute("SELECT document FROM accounting_activities WHERE id=?", (item.activity_id,)).fetchone()
                activity = AccountingActivity.model_validate_json(row[0]) if row else self.activity(item.activity_id)
                if activity.state == "dispatched":
                    self.record_receipt(ActivityReceipt(activity_id=activity.id,
                        attempt_id=activity.attempt_id, confirmed=False))
            raise
        except sqlite3.Error:
            raise
        except Exception as error:
            code = error.code if isinstance(error, DomainError) else "executor_failed"
            if code == "export_finalize_failed":
                raise
            if not isinstance(error, DomainError):
                write_diagnostic(make_diagnostic("scheduler_driver_failed", error,
                    request_id=f"{item.run_id}_{item.task_id}"))
            if receipt is not None:
                self.record_receipt_only(receipt, reason=code)
                return
            if self.is_deleted(item.run_id):
                if item.activity_id:
                    with self.store.transaction(write=False) as tx:
                        row = tx.execute("SELECT document FROM accounting_activities WHERE id=?", (item.activity_id,)).fetchone()
                    activity = AccountingActivity.model_validate_json(row[0])
                    if activity.state == "dispatched":
                        self.record_receipt(ActivityReceipt(activity_id=activity.id, attempt_id=activity.attempt_id,
                            confirmed=False, error="scope_deleted"))
                return
            if isinstance(error, DomainError) and error.code in {"version_conflict", "yield_requested"}:
                return
            if item.activity_id:
                activity = self.activity(item.activity_id)
                if activity.state == "dispatched":
                    self.record_receipt(ActivityReceipt(activity_id=activity.id,
                        attempt_id=activity.attempt_id, confirmed=False, error=code))
            with self.store.transaction() as tx:
                run = load(tx, RunSnapshot, item.run_id)
                if run.state not in TERMINAL:
                    if code == "deadline_exceeded":
                        stop_run(tx, run, "failed", code)
                        return
                    state = "blocked_incompatible" if code == "blocked_incompatible" else "interrupted"
                    task = load(tx, TaskSnapshot, item.task_id)
                    emit(tx, run, task.id, "task.stepped", RuntimeChange(
                        runs=[bump(run, state=state, reason=code)],
                        tasks=[bump(task, state=state, reason=code)],
                    ))

    def _read(self, model, id):
        with self.store.transaction(write=False) as tx:
            return load(tx, model, id)

    def task(self, task_id):
        return self._read(TaskSnapshot, task_id)

    def is_deleted(self, run_id):
        with self.store.transaction(write=False) as tx:
            return tx.execute("SELECT 1 FROM accounting_budgets WHERE run_id=?", (run_id,)).fetchone() is not None

    def activity(self, activity_id):
        return self._read(ActivitySnapshot, activity_id)

    def budget(self, run_id):
        with self.store.transaction(write=False) as tx:
            return load(tx, BudgetSnapshot, load(tx, RunSnapshot, run_id).budget_id)

    def checkpoint(self, task_id):
        return self._read(Checkpoint, task_id)

    def context(self, task_id):
        with self.store.transaction(write=False) as tx:
            return context_for(tx, task_id)

    def _prepare(self, tx, ctx, intent):
        actual = context_for(tx, ctx.task_id)
        if ctx.model_copy(update={"activity_id":None}) != actual:
            raise DomainError("owner_mismatch", "活动归属不一致")
        task = load(tx, TaskSnapshot, ctx.task_id)
        run = load(tx, RunSnapshot, ctx.run_id)
        check_dispatch(tx, run, task, self.clock())
        check_scopes(tx, intent.dependencies)
        activity = ActivitySnapshot(id=identifier(), task_id=task.id, run_id=run.id,
                                    attempt_id=identifier(), intent=intent)
        checkpoint = load(tx, Checkpoint, task.id)
        if (intent.kind == "model" and intent.operation not in {"embedding.query", "embedding.document"}
                and checkpoint.context_manifest):
            checkpoint = checkpoint.model_copy(update={"context_manifest": {
                **checkpoint.context_manifest, "activity_id": activity.id}})
        checkpoint = bump(checkpoint,
                          pending_activity_ids=[*checkpoint.pending_activity_ids, activity.id])
        items = pending_outbox(tx, task.id, operation="step")
        items.append(OutboxItem(run_id=run.id, task_id=task.id, activity_id=activity.id,
                                operation="activity"))
        emit(tx, run, task.id, "activity.prepared", RuntimeChange(
            runs=[bump(run, state="running")] if task.id == run.root_task_id or run.state == "queued" else [],
            tasks=[bump(task, state="running")],
            activities=[activity], checkpoints=[checkpoint], outbox=items,
        ))
        return ActivityRef(id=activity.id, task_id=task.id, attempt_id=activity.attempt_id)

    def prepare(self, ctx, intent):
        with self.store.transaction() as tx:
            return self._prepare(tx, ctx, intent)

    def dispatch(self, request, *, authorize=None):
        with self.store.transaction() as tx:
            activity = load(tx, ActivitySnapshot, request.activity_id)
            if activity.attempt_id != request.attempt_id:
                raise DomainError("attempt_mismatch", "活动尝试身份不一致")
            if activity.state != "prepared":
                raise DomainError("already_dispatched", "同一活动不能重复派发")
            run = load(tx, RunSnapshot, activity.run_id)
            task = load(tx, TaskSnapshot, activity.task_id)
            check_dispatch(tx, run, task, self.clock())
            dependencies = [*run.scope_dependencies, *activity.intent.dependencies,
                            *request.source_dependencies]
            check_scopes(tx, dependencies)
            if authorize is not None:
                authorize(tx)
            if request.mcp_source is not None and (
                    activity.intent.kind != "tool"
                    or task.binding.config.catalog.mcp_tools.get(activity.intent.operation) != request.mcp_source.binding
                    or task.binding.config.model_profile.endpoint != request.mcp_source.model_destination):
                raise DomainError("tool_binding", "MCP 来源不属于当前实际调用")
            if request.mcp_source is not None and activity.intent.origin == "user":
                from flowmate.runtime.recovery import requery_authorization
                if requery_authorization(tx, run.id, activity.id):
                    self.budgets.check_mcp_continuation(tx, run)
            reservation_id = self.budgets.reserve(tx, activity.id, request.estimate,
                                                  activity.intent.kind)
            changed = bump(activity, state="dispatched", request_digest=request.request_digest,
                            mcp_source=request.mcp_source,
                           pricing_snapshot=request.pricing_snapshot,
                            lease_generation=(tx.execute(
                                "SELECT generation FROM session_leases WHERE session_id=? AND run_id=?",
                                (run.interaction_session_id, run.id)).fetchone()[0]
                                if run.execution_session_id == run.interaction_session_id else None),
                            reserved_units=request.estimate.estimated_units or 0,
                            reserved_tokens=(request.estimate.input_estimate + request.estimate.max_output_tokens
                                             if activity.intent.kind == "model" else 0),
                           intent=activity.intent.model_copy(update={"dependencies": dependencies}))
            emit(tx, run, task.id, "activity.dispatched", RuntimeChange(activities=[changed]))
            return DispatchPermit(activity_id=activity.id, attempt_id=activity.attempt_id,
                request_digest=request.request_digest, scope_epochs=dependencies,
                reservation_id=reservation_id)

    def _apply_decision(self, tx, task, decision, *, count_step):
        run = load(tx, RunSnapshot, task.run_id)
        if run.state in TERMINAL or task.state in TERMINAL:
            return task
        check_dispatch(tx, run, task, self.clock())
        checkpoint = load(tx, Checkpoint, task.id)
        if (self.tasks is not None and checkpoint.phase in {"ready_model", "preparing_output", "preparing_structured_output"}
                and not checkpoint.pending_call_ids and not checkpoint.pending_activity_ids):
            entries = self.delivery.pending_owned_tx(tx, run, task)
            if entries:
                self._queue_model(tx, run, task, checkpoint)
                self.delivery.consume_owned_tx(tx, run, task, entries)
                return load(tx, TaskSnapshot, task.id)
        if count_step:
            self.budgets.count(tx, run.id, "steps")
        budget = load(tx, BudgetSnapshot, run.budget_id)
        if decision.kind == "task_control":
            return self._task_control(tx, task, decision, budget)
        if (self.tasks is not None and task.kind == "agent" and not checkpoint.pending_call_ids
                and not checkpoint.pending_activity_ids and decision.kind == "activity"
                and decision.intent is not None and decision.intent.kind == "model"):
            ctx = context_for(tx, task.id)
            finalizing = checkpoint.phase == "preparing_structured_output"
            boundary = checkpoint.context_manifest.get("model_message_boundary") if finalizing else None
            ids = self.tasks._pending_direct_results(tx, ctx, model_boundary=boundary)
            if ids:
                self._queue_model(tx, run, task, checkpoint)
                self.tasks._receive_direct_results(tx, ctx, ids)
                return load(tx, TaskSnapshot, task.id)
        if decision.checkpoint is not None:
            current = load(tx, Checkpoint, task.id)
            if decision.checkpoint.task_id != task.id or decision.checkpoint.version != current.version:
                raise DomainError("version_conflict", "检查点已被另一结果推进")
            if decision.checkpoint.phase == "waiting_compaction" and self.compaction is not None:
                from flowmate.context.compaction import CompactionPlan
                plan = CompactionPlan.model_validate_json(json.dumps(decision.checkpoint.context_manifest["compaction"]))
                if self.compaction.prepare_tx(tx, context_for(tx, task.id), plan) != decision.intent:
                    raise DomainError("compaction_binding", "压缩活动意图与固定提议不一致")
            for message in decision.messages:
                check_scopes(tx, message.source_dependencies)
            if decision.question is not None:
                check_scopes(tx, decision.question.dependencies)
            emit(tx, run, task.id, "question.asked" if decision.question else "task.stepped", RuntimeChange(
                checkpoints=[bump(decision.checkpoint)], messages=decision.messages,
                questions=[decision.question] if decision.question else []))
        if decision.kind in {"activity", "activities"}:
            intents = [decision.intent] if decision.kind == "activity" else decision.intents
            if not intents or any(intent is None for intent in intents):
                raise DomainError("invalid_decision", "活动决定缺少意图")
            for intent in intents:
                self._prepare(tx, context_for(tx, task.id), intent)
            return load(tx, TaskSnapshot, task.id)
        state = {"continue": "running", "complete": "completed", "fail": "failed",
                 "wait_user": "waiting_user", "wait_approval": "waiting_approval",
                 "wait_children": "waiting_children"}[decision.kind]
        if decision.kind == "wait_user" and decision.reason == "blocked_incompatible":
            state = "blocked_incompatible"
        if state == "completed":
            output = decision.output
            if output is None or (output.unresolved and not isinstance(output, AgentResult)) or not (
                    output.summary or output.artifact_ids):
                raise DomainError("invalid_output", "任务尚无有效完成结果")
            checkpoint = load(tx, Checkpoint, task.id)
            if checkpoint.pending_call_ids or checkpoint.wait_ids:
                raise DomainError("pending_obligations", "仍有未解决工具或澄清")
            check_scopes(tx, checkpoint.output_dependencies)
            if output.artifact_ids:
                if self.artifacts is None:
                    raise DomainError("invalid_artifact", "产物服务未装配")
                self.artifacts.validate_output(tx, context_for(tx, task.id), output.artifact_ids)
            from flowmate.runtime.recovery import has_pending_activities
            if has_pending_activities(tx, task.id):
                raise DomainError("pending_obligations", "仍有未结算外部操作")
            if task.id == run.root_task_id or task.kind == "agent":
                self._validate_failures(tx, task, output)
                emit(tx, run, task.id, "task.stepped", RuntimeChange(
                    runs=[bump(run, state="waiting_children", reason="joining")] if task.id == run.root_task_id else [],
                    tasks=[bump(task, state="waiting_children", reason="joining")],
                    checkpoints=[bump(checkpoint, phase="joining", output=output)],
                    outbox=pending_outbox(tx, task.id, operation="step")))
                self._try_join(tx, run.id)
                return load(tx, TaskSnapshot, task.id)
        if state == "failed":
            if task.id == run.root_task_id:
                stop_run(tx, run, "failed", decision.reason)
            else:
                stop_task(tx, run, task, "failed", decision.reason)
                self._child_changed(tx, run.id, task.id)
            return load(tx, TaskSnapshot, task.id)
        task = bump(task, state=state, reason=decision.reason,
                    result_version=1 if state == "completed" else task.result_version)
        changed = bump(run, state=state, reason=decision.reason) if task.id == run.root_task_id else run
        items = pending_outbox(tx, task.id, operation="step")
        checkpoint = load(tx, Checkpoint, task.id)
        if state == "running" and not checkpoint.pending_activity_ids:
            items.append(OutboxItem(run_id=run.id, task_id=task.id, operation="step"))
        emit(tx, changed, task.id, "task.stepped",
             RuntimeChange(runs=[changed] if task.id == run.root_task_id else [],
                  tasks=[task], outbox=items,
                  checkpoints=[bump(checkpoint, phase="done")] if state == "completed" else []))
        if state == "completed":
            self._child_changed(tx, run.id, task.id)
        return task

    def _task_control(self, tx, task, decision, budget):
        from flowmate.agents.checkpoint import ConsumedTaskResult
        from flowmate.runtime.tasks import control_command_id

        run = load(tx, RunSnapshot, task.run_id)
        ctx = context_for(tx, task.id)
        call = decision.control_call
        check_scopes(tx, decision.control_dependencies)
        command_id = control_command_id(run.id, task.id, decision.control_origin_message_id, call.call_id)
        value, error, dependencies = None, None, list(decision.control_dependencies)
        wait = None
        tx.execute("SAVEPOINT task_control")
        try:
            tool = self.tasks.catalog.get(call.name, task.binding.config.catalog.tools[call.name])
            args = tool.validate_input(call.arguments)
            if call.name == "task.submit":
                submission = self.tasks._submit(tx, ctx, args, CommandMeta(command_id=command_id),
                                                dependencies=decision.control_dependencies)
                handle = submission.handle
                if args["wait_mode"] == "background":
                    value = submission.model_dump(mode="json")
            else:
                handle = TaskHandle.model_validate(args["handle"])
            if call.name == "task.status":
                # _view要求终态，status只查询归属检查过的Task。
                from flowmate.runtime.tasks import _target
                target = _target(tx, ctx, handle)[2]
                value = target.model_dump(mode="json")
            elif call.name == "task.cancel":
                value = self.tasks._cancel(tx, ctx, handle,
                    CommandMeta(command_id=command_id, expected_version=args["expected_version"])).model_dump(mode="json")
                self._child_changed(tx, run.id, handle.task_id)
            elif call.name in {"task.await", "task.result"} or (call.name == "task.submit" and args["wait_mode"] == "wait"):
                if call.name != "task.result":
                    row = tx.execute("SELECT document FROM waits WHERE owner_task_id=? AND continuation_id=?",
                                     (task.id, command_id)).fetchone()
                    timeout = args["timeout_seconds"] if call.name == "task.await" else None
                    deadline = self.clock() + timedelta(seconds=timeout) if timeout is not None else None
                    wait = (WaitRecord.model_validate_json(row[0]) if row else
                            self.waits._register(tx, ctx, handle, deadline, command_id))
                    if wait.state == "pending":
                        # 本步骤已持久登记；释放许可，终态或timer只唤醒一次。
                        tx.execute("RELEASE task_control")
                        return load(tx, TaskSnapshot, task.id)
                    if wait.state in {"timeout", "cancelled"}:
                        from flowmate.contracts.execution import WaitOutcome
                        value = WaitOutcome(kind=wait.state, result_ref=handle).model_dump(mode="json")
                if value is None:
                    current = load(tx, Checkpoint, task.id)
                    result, fresh = self.tasks._consume(tx, ctx, handle, ConsumerRef(run_id=run.id,
                        task_id=task.id, message_boundary=current.message_boundary))
                    dependencies.extend(result.dependencies)
                    value = (result if fresh else ConsumedTaskResult(handle=handle,
                        result_version=result.result_version)).model_dump(mode="json")
        except (DomainError, KeyError) as caught:
            tx.execute("ROLLBACK TO task_control")
            error = caught.code if isinstance(caught, DomainError) else "tool_unavailable"
        tx.execute("RELEASE task_control")
        current = load(tx, Checkpoint, task.id)
        pending = [id for id in current.pending_call_ids if id != call.call_id]
        message = ModelMessage(role="tool", parts=[ToolResultPart(call_id=call.call_id,
            origin_message_id=decision.control_origin_message_id, result=value, error=error)],
                               source_dependencies=dependencies)
        check_scopes(tx, dependencies)
        latest_task = load(tx, TaskSnapshot, task.id)
        latest_run = load(tx, RunSnapshot, run.id)
        emit(tx, run, task.id, "task.stepped", RuntimeChange(messages=[message],
            runs=[bump(latest_run, state="running", reason=None)] if task.id == run.root_task_id else [],
            tasks=[bump(latest_task, state="running", reason=None)],
            checkpoints=[bump(current, pending_call_ids=pending,
                wait_ids=[id for id in current.wait_ids if wait is None or id != wait.id],
                phase="dispatch_tools" if pending else "ready_model", message_boundary=current.message_boundary + 1)],
            outbox=[*pending_outbox(tx, task.id, operation="step"),
                    OutboxItem(run_id=run.id, task_id=task.id, operation="step")]))
        return load(tx, TaskSnapshot, task.id)

    def _child_changed(self, tx, run_id, task_id):
        from flowmate.runtime.waits import resolve_waits

        resolve_waits(tx, self.clock(), run_id=run_id, target_task_id=task_id)
        self._try_join(tx, run_id)

    def _validate_failures(self, tx, owner, output):
        seen = set()
        for disposition in output.handled_failures:
            target = load(tx, TaskSnapshot, disposition.task_id)
            if (target.run_id != owner.run_id or target.parent_task_id != owner.id or target.id in seen
                    or target.state not in {"failed", "cancelled"} or target.result_version != disposition.result_version
                    or not tx.execute("SELECT 1 FROM consumptions WHERE consumer_task_id=? AND target_task_id=? AND result_version=?",
                        (owner.id, target.id, disposition.result_version)).fetchone()):
                raise DomainError("failure_disposition_invalid", "失败处理决定须对应已消费的从属结果版本")
            seen.add(target.id)

    def _try_join(self, tx, run_id):
        run = load(tx, RunSnapshot, run_id)
        if run.state in TERMINAL or run.state in {"interrupted", "blocked_incompatible"}:
            return
        waiting = [TaskSnapshot.model_validate_json(row[0]) for row in tx.execute(
            "SELECT t.document FROM tasks t JOIN checkpoints c ON c.task_id=t.id WHERE t.run_id=? "
            "AND t.state='waiting_children' AND json_extract(c.document,'$.phase')='joining' "
            "ORDER BY json_extract(t.document,'$.binding.delegation_depth') DESC,t.rowid DESC", (run.id,))]
        for owner in waiting:
            run = load(tx, RunSnapshot, run_id)
            if run.state in TERMINAL:
                return
            self._try_task_join(tx, run, owner)

    def _try_task_join(self, tx, run, root):
        checkpoint = load(tx, Checkpoint, root.id)
        if root.state != "waiting_children" or checkpoint.phase != "joining":
            return
        check_scopes(tx, [*run.scope_dependencies, *checkpoint.output_dependencies])
        steering = {row[0] for row in tx.execute("SELECT id FROM messages WHERE task_id=? "
            "AND json_extract(document,'$.origin')='steering'", (root.id,))}
        if not steering <= set(checkpoint.consumed_steering_ids):
            self._queue_model(tx, run, root, checkpoint)
            return
        children = [TaskSnapshot.model_validate_json(row[0]) for row in tx.execute(
            "SELECT document FROM tasks WHERE run_id=? AND parent_task_id=? ORDER BY rowid", (run.id, root.id))]
        children_pending = any(task.state not in TERMINAL for task in children)
        if self.tasks is not None and root.kind == "agent":
            # 代理可收到失败交付并重新综合，等直属交付齐备后再判断候选。
            if children_pending:
                return
            entries = self.delivery.pending_owned_tx(tx, run, root)
            if entries:
                self._queue_model(tx, run, root, checkpoint)
                self.delivery.consume_owned_tx(tx, run, root, entries)
                return
            if children:
                ctx = context_for(tx, root.id)
                boundary = checkpoint.context_manifest.get("model_message_boundary")
                ids = self.tasks._pending_direct_results(tx, ctx, model_boundary=boundary)
                if ids:
                    self._queue_model(tx, run, root, checkpoint)
                    self.tasks._receive_direct_results(tx, ctx, ids)
                    return
        handled = {item.task_id for item in checkpoint.output.handled_failures}
        if any(task.state in {"failed", "cancelled"} and task.id not in handled for task in children):
            if self.tasks is not None and root.kind == "agent" and "candidate_answer" in checkpoint.context_manifest:
                from flowmate.runtime.tasks import child_failure_feedback

                feedback = child_failure_feedback(tx, root, checkpoint, checkpoint.output)
                if feedback is not None and feedback[0] is not None:
                    fresh, notice = feedback
                    manifest = {**checkpoint.context_manifest, "child_failure_feedback": fresh,
                                "child_failure_notice": notice}
                    self._queue_model(tx, run, root, checkpoint.model_copy(update={"context_manifest": manifest}))
                    return
            if root.id == run.root_task_id:
                stop_run(tx, run, "failed", "unhandled_child_failure")
            else:
                stop_task(tx, run, root, "failed", "unhandled_child_failure")
            return
        if children_pending:
            return
        subtree = ("WITH RECURSIVE tree(id) AS (VALUES(?) UNION ALL "
                   "SELECT t.id FROM tasks t JOIN tree p ON t.parent_task_id=p.id) ")
        from flowmate.runtime.recovery import QUERY_RESULT_RELEASED
        if tx.execute(subtree + "SELECT 1 FROM activities a WHERE a.task_id IN (SELECT id FROM tree) "
                      f"AND (a.state='dispatched' OR (a.state='uncertain' AND ({QUERY_RESULT_RELEASED}) IS NOT TRUE) "
                      "OR (a.state='prepared' AND EXISTS "
                      "(SELECT 1 FROM outbox o WHERE o.activity_id=a.id AND o.state='pending')))",
                      (root.id,)).fetchone():
            return
        if tx.execute(subtree + "SELECT 1 FROM approvals WHERE task_id IN (SELECT id FROM tree) AND status='pending'",
                      (root.id,)).fetchone():
            return
        if checkpoint.output.artifact_ids:
            self.artifacts.validate_output(tx, context_for(tx, root.id), checkpoint.output.artifact_ids)
        joins = [JoinDecision(run_id=run.id, root_task_id=root.id, child_task_id=task.id,
                              child_result_version=task.result_version) for task in children]
        if root.id == run.root_task_id and run.kind == "user" and self.maintenance is not None:
            from flowmate.memory.intent import commit
            with self.maintenance.memory.provider.atomic():
                commit(self.maintenance.memory, tx, root)
        manifest = dict(checkpoint.context_manifest)
        candidate = manifest.pop("candidate_answer", None)
        messages = [ModelMessage.model_validate(candidate)] if candidate is not None else []
        refs = [message.private_ref for message in messages if message.private_ref is not None]
        emit(tx, run, root.id, "task.joined", RuntimeChange(
            runs=[bump(run, state="completed", reason=None, output=checkpoint.output)] if root.id == run.root_task_id else [],
            tasks=[bump(root, state="completed", reason=None, result_version=1)],
            checkpoints=[bump(checkpoint, phase="done", context_manifest=manifest,
                              message_boundary=checkpoint.message_boundary + len(messages),
                              private_refs=[*checkpoint.private_refs, *refs])], joins=joins, messages=messages,
            outbox=pending_outbox(tx, root.id)))

    def _queue_model(self, tx, run, task, checkpoint):
        manifest = dict(checkpoint.context_manifest)
        manifest.pop("candidate_answer", None)
        emit(tx, run, task.id, "task.stepped", RuntimeChange(
            runs=[bump(run, state="running", reason=None)] if task.id == run.root_task_id else [],
            tasks=[bump(task, state="running", reason=None)],
            checkpoints=[bump(checkpoint, phase="ready_model", output=None,
                              output_dependencies=[], context_manifest=manifest)],
            outbox=[*pending_outbox(tx, task.id, operation="step"),
                    OutboxItem(run_id=run.id, task_id=task.id, operation="step")]))

    def commit_step(self, task_id, expected_version, decision):
        with self.store.transaction() as tx:
            task = load(tx, TaskSnapshot, task_id)
            if task.version != expected_version:
                raise DomainError("version_conflict", "任务已被其他提交推进")
            return self._apply_decision(tx, task, decision, count_step=True)

    def record_receipt(self, receipt, propose=None):
        task = self._record_receipt(receipt, propose)
        self._finalize_export(receipt, task)
        return task

    def record_receipt_only(self, receipt, *, reason):
        task = self._record_receipt(receipt, None, reason=reason)
        self._finalize_export(receipt, task)

    def _finalize_export(self, receipt, task):
        if (self.artifacts is not None and task is not None and receipt.confirmed and receipt.error is None
                and self.activity(receipt.activity_id).intent.operation == "artifacts.export"):
            try:
                self.artifacts.publication.finalize(receipt.activity_id, receipt.attempt_id)
            except (OSError, DomainError) as error:
                # 回执已提交；journal不可写是维护故障，不能补造unknown或重派写操作。
                raise DomainError("export_finalize_failed", "导出已确认，恢复记录维护失败") from error

    def _record_receipt(self, receipt, propose, *, reason=None):
        from flowmate.runtime.naming import OPERATION, commit_title

        with self.store.transaction() as tx:
            retired = tx.execute("SELECT document FROM accounting_activities WHERE id=?", (receipt.activity_id,)).fetchone()
            if retired is not None:
                self._record_accounting(tx, AccountingActivity.model_validate_json(retired[0]), receipt)
                return None
            activity = load(tx, ActivitySnapshot, receipt.activity_id)
            not_sent_error = (activity.state == "prepared" and receipt.confirmed
                              and receipt.error is not None and receipt.actual_units == 0
                              and receipt.result is None)
            if (activity.attempt_id != receipt.attempt_id
                    or (activity.state == "prepared" and not not_sent_error)):
                raise DomainError("attempt_mismatch", "回执不对应已派发活动")
            run = load(tx, RunSnapshot, activity.run_id)
            task = load(tx, TaskSnapshot, activity.task_id)
            if activity.state == "uncertain":
                from flowmate.runtime.recovery import is_uncertain_query
                if is_uncertain_query(tx, run, task, activity, activity.receipt):
                    # 原查询的未知状态是不再消费的边界。MCP 没有可补记的本机模型用量。
                    return task
            run_expired = self.clock() >= run.deadline_at
            expired = run_expired or (task.deadline_at is not None and self.clock() >= task.deadline_at)
            protocol = (task.binding.config.model_profile.protocol if activity.intent.kind == "model"
                and activity.intent.operation not in {"embedding.query", "embedding.document"} else None)
            merged = _merge_receipt(activity, receipt, model_protocol=protocol)
            dependencies = [*activity.intent.dependencies, *receipt.source_dependencies]
            lease_current = (run.execution_session_id != run.interaction_session_id
                or owns_session(tx, run.interaction_session_id, run.id, generation=activity.lease_generation))
            # 相同hash的并行观察是同一版本；仅能重定位该资源的epoch，grant围栏保持不变。
            if (receipt.source_observations and activity.receipt is None and merged.confirmed
                    and lease_current and not expired and can_publish(tx, run, task)):
                if self.policy is None:
                    raise DomainError("policy_unavailable", "来源观察服务未装配")
                for observation in receipt.source_observations:
                    if not any(item.scope_id == observation.resource_id
                               and item.epoch == observation.expected_version for item in dependencies):
                        raise DomainError("source_observation_invalid", "来源观察未绑定派发依赖")
                    row = tx.execute("SELECT document FROM resources WHERE id=?",
                                     (observation.resource_id,)).fetchone()
                    current = ResourceRecord.model_validate_json(row[0]) if row else None
                    if current is not None and current.source_version == observation.source_version:
                        dependencies = [item.model_copy(update={"epoch": current.version})
                            if item.scope_id == current.id else item for item in dependencies]
            # 补账/围栏后的结果只更新确定事实，不再执行内容提议。
            retired_document = (run.kind == "knowledge" and activity.intent.origin == "runtime"
                and activity.intent.operation == "embedding.document"
                and activity.intent.arguments.get("source_retired") is True)
            retired_checkpoint = None
            if retired_document and merged.confirmed and lease_current and reason is None and not expired:
                from flowmate.knowledge.ingestion import KnowledgeImportState

                checkpoint = load(tx, Checkpoint, task.id)
                state = KnowledgeImportState.model_validate_json(json.dumps(checkpoint.context_manifest["knowledge_import"]))
                if (activity.id in checkpoint.pending_activity_ids
                        and can_publish(tx, run, task, state.destination_dependencies)):
                    retired_checkpoint = checkpoint
            publish = not retired_document and not activity.embedding_query_abandoned and lease_current and reason is None and not expired and activity.receipt is None and merged.confirmed and can_publish(
                tx, run, task, dependencies)
            abandon_query = (not merged.confirmed and not activity.embedding_query_abandoned
                and activity.intent.kind == "model" and activity.intent.origin == "runtime"
                and activity.intent.operation == "embedding.query"
                and lease_current and reason is None and not expired and can_publish(tx, run, task, dependencies))
            failed_document = (not merged.confirmed and run.kind == "knowledge"
                and activity.intent.origin == "runtime" and activity.intent.operation == "embedding.document"
                and run.state not in TERMINAL)
            normalized = merged if publish or activity.content_committed else merged.model_copy(
                update={"result": None, "error": merged.error})
            digest = _result_digest(receipt) if receipt.confirmed else activity.result_digest
            if (activity.receipt == normalized and activity.result_digest == digest
                    and activity.reserved_units == (0 if merged.actual_units is not None
                                                    else activity.reserved_units)):
                return task
            self.budgets.settle(tx, merged)
            updated = bump(activity, receipt=normalized, result_digest=digest,
                state=("failed" if merged.error else "succeeded") if merged.confirmed else "uncertain",
                reserved_units=0 if merged.actual_units is not None else activity.reserved_units,
                reserved_tokens=0 if known_tokens(merged) is not None else activity.reserved_tokens,
                content_committed=activity.content_committed or publish,
                embedding_query_abandoned=activity.embedding_query_abandoned or abandon_query)
            items = [item.model_copy(update={"state": "done"}) for item in pending_outbox(tx, task.id,
                      operation="activity") if item.activity_id == activity.id]
            change = RuntimeChange(activities=[updated], outbox=items)
            decision = None
            if abandon_query:
                checkpoint = load(tx, Checkpoint, task.id)
                change = change.model_copy(update={"checkpoints": [bump(checkpoint,
                    pending_activity_ids=[id for id in checkpoint.pending_activity_ids if id != activity.id])]})
                decision = StepDecision(kind="continue")
            elif retired_checkpoint is not None:
                # 来源已从检查点剔除；只释放原批次等待，不消费向量或执行旧提议。
                change = change.model_copy(update={"checkpoints": [bump(retired_checkpoint,
                    pending_activity_ids=[id for id in retired_checkpoint.pending_activity_ids if id != activity.id])]})
                decision = StepDecision(kind="continue")
            elif publish:
                checkpoint = load(tx, Checkpoint, task.id)
                proposal = propose(checkpoint) if propose else ReceiptCommit(checkpoint=checkpoint)
                if proposal.checkpoint.task_id != task.id:
                    raise DomainError("owner_mismatch", "检查点不属于当前任务")
                ctx = context_for(tx, task.id).model_copy(update={"activity_id": activity.id})
                if proposal.source_observations:
                    if self.policy is None:
                        raise DomainError("policy_unavailable", "来源版本服务未装配")
                    if proposal.source_observations != receipt.source_observations:
                        raise DomainError("source_observation_invalid", "来源提议与回执不一致")
                    observed = {observation.resource_id: self.policy.publish_observation(tx, ctx, observation)
                                for observation in proposal.source_observations}
                    proposal = proposal.model_copy(update={"messages": [message.model_copy(update={
                        "source_dependencies": [observed.get(item.scope_id, item)
                                                for item in message.source_dependencies],
                    }) for message in proposal.messages]})
                compacting = proposal.context_summary is not None
                if compacting:
                    tx.execute("SAVEPOINT context_compaction")
                try:
                    if proposal.staged_artifacts or proposal.artifact_refs:
                        if self.artifacts is None:
                            raise DomainError("artifact_unavailable", "产物服务未装配")
                        wanted = {ref.id: ref for ref in proposal.artifact_refs}
                        for staged in proposal.staged_artifacts:
                            if wanted.get(staged.ref.id) != staged.ref:
                                raise DomainError("artifact_stage_invalid", "产物提议引用不一致")
                            self.artifacts.publish(tx, staged)
                        self.artifacts.validate_output(tx, ctx, list(wanted))
                    if compacting:
                        from flowmate.context.compaction import CompactionPlan, ContextSummary
                        if self.compaction is None:
                            raise DomainError("blocked_incompatible", "摘要提交策略未装配")
                        value = proposal.context_summary
                        plan = CompactionPlan.model_validate_json(json.dumps(value["plan"]))
                        summary = ContextSummary.model_validate(value["summary"])
                        self.compaction.commit_tx(tx, ctx, plan, summary, receipt=normalized,
                            artifact=wanted[summary.artifact_id])
                except DomainError as error:
                    if not compacting or error.code not in {"version_conflict", "context_incomplete",
                            "context_authorization_required", "scope_revoked", "scope_mismatch", "outside_run_scope",
                            "source_version_conflict", "invalid_compaction_summary", "compaction_binding"}:
                        raise
                    tx.execute("ROLLBACK TO context_compaction")
                    retry = error.code == "version_conflict"
                    manifest = {key: value for key, value in checkpoint.context_manifest.items() if key != "compaction"}
                    proposal = ReceiptCommit(checkpoint=checkpoint.model_copy(update={
                        "phase": "ready_model" if retry else "waiting_user",
                        "context_manifest": {**manifest, "compaction_state": "invalidated" if retry else "blocked",
                            "compaction_reason": "source_changed" if retry else error.code}}),
                        next_decision=StepDecision(kind="continue" if retry else "wait_user",
                            reason=None if retry else error.code))
                finally:
                    if compacting:
                        tx.execute("RELEASE context_compaction")
                for message in proposal.messages:
                    check_scopes(tx, message.source_dependencies)
                if proposal.private_states or any(message.private_ref for message in proposal.messages):
                    if self.private_state is None:
                        raise DomainError("private_state_unavailable", "私有续接服务未装配")
                    self.private_state.publish(tx, ctx, proposal.private_states, proposal.messages)
                if (self.tasks is not None and task.id == run.root_task_id
                        and activity.intent.operation == "model.generate"
                        and proposal.checkpoint.phase == "preparing_output" and proposal.messages
                        and tx.execute("SELECT 1 FROM tasks WHERE parent_task_id=? OR origin_task_id=? LIMIT 1",
                            (task.id, task.id)).fetchone()):
                    # 有从属工作时先保存自然文本候选，通过 joining 才成为会话消息。
                    candidate, = proposal.messages
                    proposed = proposal.checkpoint
                    proposal = proposal.model_copy(update={"messages": [], "checkpoint": proposed.model_copy(update={
                        "context_manifest": {**proposed.context_manifest,
                                             "candidate_answer": candidate.model_dump(mode="json")},
                        "message_boundary": checkpoint.message_boundary, "private_refs": checkpoint.private_refs})})
                checkpoint = proposal.checkpoint.model_copy(update={
                    "version": checkpoint.version + 1,
                    "pending_activity_ids": [id for id in proposal.checkpoint.pending_activity_ids
                                             if id != activity.id],
                })
                change = change.model_copy(update={"checkpoints": [checkpoint],
                                                   "messages": proposal.messages})
                decision = proposal.next_decision
                if (activity.intent.operation == OPERATION and decision is not None
                        and decision.kind == "complete"
                        and not commit_title(tx, run, activity.intent.arguments, decision.output.summary)):
                    decision = StepDecision(kind="fail", reason="title_authorization_changed")
            elif not failed_document and not activity.embedding_query_abandoned and activity.intent.operation != OPERATION and lease_current and not run.yield_requested and (not merged.confirmed or (activity.receipt is None and not expired
                                          and run.state in {"queued", "running"}
                                           and task.state in {"queued", "running"})) and (
                                               run.state not in TERMINAL and task.state not in TERMINAL):
                if reason is None:
                    from flowmate.runtime.recovery import is_uncertain_query
                    reason = ("mcp_query_uncertain" if not expired and is_uncertain_query(tx, run, task, activity, merged)
                              else "uncertain_activity" if not merged.confirmed else "source_scope_changed")
                change = change.model_copy(update={
                    "runs": [bump(run, state="interrupted", reason=reason)],
                    "tasks": [bump(task, state="interrupted", reason=reason)],
                })
            emit(tx, run, task.id, "activity.received", change)
            if failed_document:
                stop_run(tx, load(tx, RunSnapshot, run.id), "failed", "knowledge_document_unknown")
                return load(tx, TaskSnapshot, task.id)
            if activity.intent.operation == OPERATION and not merged.confirmed and run.state not in TERMINAL:
                stop_run(tx, run, "failed", "uncertain_activity")
                return load(tx, TaskSnapshot, task.id)
            if run.yield_requested:
                from flowmate.runtime.followups import finish_yield
                finish_yield(tx, run.id)
                return load(tx, TaskSnapshot, task.id)
            if run.state in TERMINAL:
                self.budgets.return_unused(tx, run.id)
            if not lease_current:
                return load(tx, TaskSnapshot, task.id)
            # proposal构造期间也可能越过deadline；已结算的回执不随被拒后继回滚。
            run_expired = self.clock() >= run.deadline_at
            expired = run_expired or (task.deadline_at is not None and self.clock() >= task.deadline_at)
            if expired and run.state not in TERMINAL:
                if run_expired:
                    stop_run(tx, load(tx, RunSnapshot, run.id), "failed", "deadline_exceeded")
                else:
                    stop_task(tx, run, load(tx, TaskSnapshot, task.id), "cancelled", "deadline_exceeded")
                    if reason is None:
                        self._child_changed(tx, run.id, task.id)
                return load(tx, TaskSnapshot, task.id)
            if decision is not None:
                budget = load(tx, BudgetSnapshot, run.budget_id)
                intents = ([decision.intent] if decision.kind == "activity" else
                           decision.intents if decision.kind == "activities" else [])
                limit_reason = None
                if decision.kind == "continue" and budget.steps >= budget.limits.max_steps:
                    limit_reason = "step_limit"
                elif budget.model_requests + sum(intent.kind == "model" for intent in intents) > budget.limits.max_model_requests:
                    limit_reason = "request_limit"
                if limit_reason is not None:
                    stop_run(tx, load(tx, RunSnapshot, run.id), "failed", limit_reason)
                    return load(tx, TaskSnapshot, task.id)
                return self._apply_decision(tx, task, decision, count_step=False)
            return load(tx, TaskSnapshot, task.id)

    def _record_accounting(self, tx, activity, receipt):
        if activity.attempt_id != receipt.attempt_id:
            raise DomainError("attempt_mismatch", "回执不对应已删除活动的原尝试")
        # 删除归档已去掉任务的固定模型协议，不能验证 Anthropic 输入总量补正。
        merged = _merge_receipt(activity, receipt)
        normalized = merged.model_copy(update={"result": None, "error": None,
                                               "source_dependencies": [], "source_observations": []})
        digest = _result_digest(receipt) if receipt.confirmed else activity.result_digest
        if activity.receipt == normalized and activity.result_digest == digest:
            return
        budget = AccountingBudget.model_validate_json(tx.execute(
            "SELECT document FROM accounting_budgets WHERE id=?", (activity.budget_id,)).fetchone()[0])
        changed, group = self.budgets.settle_accounting(tx, budget, activity, merged)
        updated = bump(activity, receipt=normalized, result_digest=digest,
            reserved_units=0 if merged.actual_units is not None else activity.reserved_units,
            reserved_tokens=0 if known_tokens(merged) is not None else activity.reserved_tokens,
            state=(("failed" if receipt.error else "succeeded") if receipt.confirmed
                   else activity.state if merged.confirmed else "uncertain"))
        tx.append_event(NewEvent(kind="accounting.settled", run_id=activity.run_id,
            payload=LifecycleChange(accounting_activities=[updated], accounting_budgets=[changed] if changed else [],
                                    budget_groups=[group] if group else [])))
