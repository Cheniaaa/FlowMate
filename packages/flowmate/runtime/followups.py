"""自动总结、持久用户队列和安全让出；由唯一Scheduler调用，无独立后台循环。"""

from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    BudgetGroupSnapshot,
    BudgetSnapshot,
    FollowUpIntent,
    OutboxItem,
    PendingUserCommand,
    RunSnapshot,
    RuntimeChange,
    SourceSelection,
    StartRun,
    TaskSnapshot,
)
from flowmate.runtime.budget import DIMENSIONS
from flowmate.runtime.leases import acquire_session
from flowmate.runtime.tasks import result_input
from flowmate.runtime.transitions import (
    bump,
    check_admission,
    check_scopes,
    context_for,
    emit,
    load,
    pending_outbox,
)


def create_intent(tx, entry):
    row = tx.execute("SELECT origin_run_id,document FROM task_submissions WHERE "
        "json_extract(document,'$.handle.task_id')=?", (entry.result.task_id,)).fetchone()
    if row is None:
        return
    from flowmate.contracts.execution import TaskSubmission
    submission = TaskSubmission.model_validate_json(row["document"])
    if submission.completion_policy != "follow_up":
        return
    origin = load(tx, RunSnapshot, row["origin_run_id"])
    if (not origin.allow_follow_up or origin.follow_up_closed or origin.state == "cancelled"
            or tx.execute("SELECT archived FROM sessions WHERE id=?", (entry.target_session_id,)).fetchone()[0]):
        return
    if tx.execute("SELECT 1 FROM follow_up_intents WHERE source_result_id=? AND target_session_id=? AND policy_version=1",
            (entry.id, entry.target_session_id)).fetchone():
        return
    intent = FollowUpIntent(source_result=entry.id, target_session_id=entry.target_session_id,
        budget_group_id=origin.budget_group_id, origin_run_id=origin.id)
    emit(tx, origin, origin.root_task_id, "follow_up.changed", RuntimeChange(follow_up_intents=[intent]))


def request_yield(tx, run_id, reason):
    run = load(tx, RunSnapshot, run_id)
    if run.kind != "follow_up" or run.state in TERMINAL or run.reason == "yield_to_user":
        return
    if not run.yield_requested:
        run = bump(run, yield_requested=True)
        emit(tx, run, run.root_task_id, "follow_up.changed", RuntimeChange(runs=[run]))
    finish_yield(tx, run.id)


def finish_yield(tx, run_id):
    run = load(tx, RunSnapshot, run_id)
    if (not run.yield_requested or run.state in TERMINAL
            or run.state == "interrupted" and run.reason != "runtime_restart"):
        return
    if tx.execute("SELECT 1 FROM activities WHERE run_id=? AND state='dispatched'", (run.id,)).fetchone():
        return
    paused = [TaskSnapshot.model_validate_json(row[0]) for row in tx.execute(
        "SELECT document FROM tasks WHERE run_id=? AND (state IN ('queued','running') OR "
        "(state='interrupted' AND json_extract(document,'$.reason')='runtime_restart'))", (run.id,))]
    row = tx.execute("SELECT document FROM follow_up_intents WHERE json_extract(document,'$.run_id')=?",
        (run.id,)).fetchone()
    intents = []
    if row:
        intent = FollowUpIntent.model_validate_json(row[0])
        intents = [intent.model_copy(update={"status": "closed" if intent.status == "closed" else "paused",
            "paused_task_ids": [task.id for task in paused]})]
    changed = bump(run, state="interrupted", reason="yield_to_user")
    emit(tx, changed, changed.root_task_id, "run.yielded", RuntimeChange(runs=[changed],
        tasks=[bump(task, state="interrupted", reason="yield_to_user") for task in paused],
        follow_up_intents=intents))


def close_intents(tx, *, session_id=None, origin_run_id=None, reason):
    where, args = ("interaction_session_id=?", (session_id,)) if session_id else ("id=?", (origin_run_id,))
    for row in tx.execute(f"SELECT document FROM runs WHERE {where}", args).fetchall():
        origin = RunSnapshot.model_validate_json(row[0])
        if origin.allow_follow_up and not origin.follow_up_closed:
            emit(tx, origin, origin.root_task_id, "follow_up.changed", RuntimeChange(
                runs=[bump(origin, follow_up_closed=True)]))
    where, args = ("target_session_id=?", (session_id,)) if session_id else (
        "json_extract(document,'$.origin_run_id')=?", (origin_run_id,))
    for row in tx.execute(f"SELECT document FROM follow_up_intents WHERE {where}", args).fetchall():
        intent = FollowUpIntent.model_validate_json(row[0])
        if intent.status == "closed":
            continue
        origin = load(tx, RunSnapshot, intent.origin_run_id)
        emit(tx, origin, origin.root_task_id, "follow_up.changed", RuntimeChange(
            follow_up_intents=[intent.model_copy(update={"status": "closed", "reason": reason})]))
        if intent.run_id is not None:
            request_yield(tx, intent.run_id, reason)


class FollowUpService:
    def __init__(self, store, service):
        self.store, self.service = store, service
        self.clock = service.clock

    def _pending_event(self, tx, pending, kind):
        workspace_id = tx.execute("SELECT workspace_id FROM sessions WHERE id=?",
            (pending.session_id,)).fetchone()[0]
        tx.append_event(NewEvent(kind=kind, workspace_id=workspace_id,
            session_id=pending.session_id, causation_id=pending.command_id,
            payload=RuntimeChange(pending_commands=[pending])))

    def _apply_users(self, tx):
        applied = 0
        rows = tx.execute("SELECT document FROM pending_user_commands WHERE state='queued' ORDER BY session_id,sequence").fetchall()
        for row in rows:
            pending = PendingUserCommand.model_validate_json(row[0])
            if tx.execute("SELECT 1 FROM session_leases WHERE session_id=? AND run_id IS NOT NULL",
                    (pending.session_id,)).fetchone():
                continue
            tx.execute("SAVEPOINT apply_user")
            try:
                run = self.service._start_tx(tx, pending)
            except DomainError as error:
                tx.execute("ROLLBACK TO apply_user")
                pending = pending.model_copy(update={"state": "cancelled", "reason": error.code})
                self._pending_event(tx, pending, "command.cancelled")
            else:
                pending = pending.model_copy(update={"state": "applied", "run_id": run.id})
                self._pending_event(tx, pending, "command.applied")
                applied += 1
            tx.execute("RELEASE apply_user")
        return applied

    def _resume(self, tx, intent, run):
        check_scopes(tx, run.scope_dependencies)
        check_admission(tx, run)
        self.service.catalog.require_available(run.config.catalog)
        if self.clock() >= run.deadline_at:
            raise DomainError("deadline_exceeded", "原自动总结授权时限已过")
        for row in tx.execute("SELECT document FROM activities WHERE run_id=?", (run.id,)):
            activity = ActivitySnapshot.model_validate_json(row[0])
            if activity.state == "uncertain" or (activity.receipt is not None and not activity.content_committed):
                raise DomainError("missing_activity_result", "外部结果尚未核实，不能自动重放")
        from flowmate.runtime.tasks import selected_result
        ctx = context_for(tx, run.root_task_id)
        result = selected_result(tx, ctx)
        for purpose in ("read", "model_send"):
            from flowmate.policy.service import PolicyService
            decision = PolicyService(self.store, clock=self.clock).check_tx(tx, ctx, result.dependencies, purpose,
                run.config.model_profile.endpoint if purpose == "model_send" else None)
            if not decision.allowed:
                raise DomainError("grant_required", "自动总结所需用途授权已失效")
        for row in tx.execute("SELECT document FROM messages WHERE run_id=?", (run.id,)):
            from flowmate.contracts.execution import ModelMessage
            check_scopes(tx, ModelMessage.model_validate_json(row[0]).source_dependencies)
        tasks, items = [], []
        for id in intent.paused_task_ids:
            task = load(tx, TaskSnapshot, id)
            if task.state != "interrupted" or task.reason != "yield_to_user":
                continue
            tasks.append(bump(task, state="running", reason=None))
            prepared = tx.execute("SELECT id FROM activities WHERE task_id=? AND state='prepared'", (id,)).fetchall()
            items.extend(pending_outbox(tx, id))
            items.extend(OutboxItem(run_id=run.id, task_id=id, operation="activity", activity_id=row[0]) for row in prepared)
            if not prepared:
                items.append(OutboxItem(run_id=run.id, task_id=id, operation="step"))
        acquire_session(tx, run.interaction_session_id, run.id)
        root = next((task for task in tasks if task.id == run.root_task_id), load(tx, TaskSnapshot, run.root_task_id))
        emit(tx, run, run.root_task_id, "run.resumed", RuntimeChange(
            runs=[bump(run, state=root.state, reason=root.reason, yield_requested=False)],
            tasks=tasks, outbox=items, follow_up_intents=[intent.model_copy(update={
                "status": "active", "paused_task_ids": [], "reason": None})]))

    def activate_ready(self):
        count = 0
        with self.store.transaction() as tx:
            count += self._apply_users(tx)
            for row in tx.execute("SELECT document FROM follow_up_intents ORDER BY rowid").fetchall():
                intent = FollowUpIntent.model_validate_json(row[0])
                if intent.status not in {"ready", "paused"}:
                    continue
                origin = load(tx, RunSnapshot, intent.origin_run_id)
                if origin.follow_up_closed or origin.state == "cancelled":
                    close_intents(tx, origin_run_id=origin.id, reason="origin_cancelled")
                    continue
                if tx.execute("SELECT archived FROM sessions WHERE id=?", (intent.target_session_id,)).fetchone()[0]:
                    close_intents(tx, session_id=intent.target_session_id, reason="session_archived")
                    continue
                if (tx.execute("SELECT 1 FROM session_leases WHERE session_id=? AND run_id IS NOT NULL",
                        (intent.target_session_id,)).fetchone() or tx.execute(
                        "SELECT 1 FROM pending_user_commands WHERE session_id=? AND state='queued'",
                        (intent.target_session_id,)).fetchone()):
                    continue
                tx.execute("SAVEPOINT activate_follow_up")
                try:
                    if intent.run_id:
                        self._resume(tx, intent, load(tx, RunSnapshot, intent.run_id))
                    else:
                        selected = result_input(tx, intent.source_result, intent.target_session_id)
                        from flowmate.policy.service import PolicyService
                        sources = PolicyService.resource_closure(tx, selected.dependencies,
                            source_run_id=selected.handle.run_id, source_task_id=selected.handle.task_id)
                        group = load(tx, BudgetGroupSnapshot, origin.budget_group_id)
                        # 仅申请组内未占用额度；既有allocate在同事务核验并转拨。
                        limits = group.limits.model_dump()
                        ledgers = [(item, BudgetSnapshot.model_validate_json(item["budget"])) for item in tx.execute(
                            "SELECT a.document,b.document AS budget FROM budget_allocations a JOIN budgets b "
                            "ON b.run_id=a.run_id WHERE a.budget_group_id=?", (group.id,))]
                        from flowmate.contracts.execution import BudgetAllocation
                        for field, counters in DIMENSIONS.items():
                            cap = getattr(group.limits, field)
                            if cap is not None:
                                occupied = sum(max(0, getattr(BudgetAllocation.model_validate_json(item["document"]).limits, field)
                                    - sum(getattr(ledger, key) for key in counters)) for item, ledger in ledgers
                                    if not BudgetAllocation.model_validate_json(item["document"]).returned
                                    and ledger.run_id != origin.id)
                                limits[field] = max(0, cap - sum(getattr(group, key) for key in counters) - occupied)
                        if limits["max_tasks"] < 1 or limits["max_model_requests"] < 1 or self.clock() >= group.deadline_at:
                            raise DomainError("allocation_exceeded", "原授权组无可用总结额度")
                        config = origin.config.model_copy(update={"members": {},
                            "catalog": origin.config.catalog.model_copy(update={"tools": {
                                name: version for name, version in origin.config.catalog.tools.items()
                                if name in {"run.finish", "artifacts.read"}}})})
                        command = StartRun(session_id=intent.target_session_id,
                            agent_profile_id=config.agent_profile.id, model_profile_id=config.model_profile.id,
                            text="总结指定后台任务的明确交付，引用依据；不要执行新任务。",
                            sources=SourceSelection(resource_ids=sources), limits=group.limits.model_validate(limits),
                            source_result=intent.source_result)
                        pending = PendingUserCommand(command_id=identifier(), session_id=command.session_id,
                            start=command, created_seq=1, config=config,
                            scope_dependencies=origin.scope_dependencies,
                            admission_generations=origin.admission_generations, deadline_at=group.deadline_at,
                            input_result=selected)
                        run = self.service._start_tx(tx, pending, kind="follow_up", origin=origin)
                        emit(tx, run, run.root_task_id, "follow_up.changed", RuntimeChange(follow_up_intents=[
                            intent.model_copy(update={"run_id": run.id, "status": "active", "reason": None})]))
                    count += 1
                except DomainError as error:
                    tx.execute("ROLLBACK TO activate_follow_up")
                    if intent.reason != error.code:
                        emit(tx, origin, origin.root_task_id, "follow_up.changed", RuntimeChange(
                            follow_up_intents=[intent.model_copy(update={"reason": error.code})]))
                tx.execute("RELEASE activate_follow_up")
        return count
