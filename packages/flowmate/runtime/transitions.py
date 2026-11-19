"""运行状态转换共用查询与围栏；所有写入都通过事件reducer。"""

from datetime import UTC, datetime

from flowmate.contracts.base import DomainError
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    ActivitySnapshot,
    ArtifactRef,
    BudgetAllocation,
    BudgetGroupSnapshot,
    BudgetSnapshot,
    Checkpoint,
    ExecutionContext,
    OutboxItem,
    Question,
    ResultConsumption,
    RunSnapshot,
    RuntimeChange,
    TaskSnapshot,
    WaitRecord,
)
from flowmate.policy.contracts import Approval, PolicyChange

TABLES = {
    RunSnapshot: ("runs", "id"), TaskSnapshot: ("tasks", "id"),
    ActivitySnapshot: ("activities", "id"), BudgetSnapshot: ("budgets", "id"),
    Checkpoint: ("checkpoints", "task_id"), OutboxItem: ("outbox", "id"),
    Question: ("questions", "id"),
    WaitRecord: ("waits", "id"), ResultConsumption: ("consumptions", "id"),
    BudgetGroupSnapshot: ("budget_groups", "id"), BudgetAllocation: ("budget_allocations", "run_id"),
}


def admission_generations(tx, workspace_id, session_id):
    result={}
    for id in (workspace_id,session_id):
        if id is not None:
            row=tx.execute("SELECT generation FROM admission_fences WHERE scope_id=?", (id,)).fetchone()
            result[id]=row[0] if row is not None else 1
    return result


def check_admission(tx, run):
    current=admission_generations(tx,run.workspace_id,run.interaction_session_id)
    if any(current[id] != generation for id,generation in run.admission_generations.items()):
        raise DomainError("admission_stopped","原任务链已被停止全部围栏退役")


def utc_now():
    return datetime.now(UTC)


def load(tx, model, id):
    table, key = TABLES[model]
    row = tx.execute(f"SELECT document FROM {table} WHERE {key} = ?", (id,)).fetchone()
    if row is None:
        raise DomainError("not_found", "运行对象不存在", related_ids=(id,))
    return model.model_validate_json(row[0])


def bump(model, **changes):
    return model.model_copy(update={"version": model.version + 1, **changes})


def emit(tx, run, task_id, kind, change, causation_id=None):
    from flowmate.runtime.leases import SessionLease, release_session

    intents = list(change.follow_up_intents)
    for changed in change.runs:
        if changed.kind == "follow_up" and changed.state in {"completed", "failed", "cancelled"}:
            from flowmate.contracts.execution import FollowUpIntent
            row = tx.execute("SELECT document FROM follow_up_intents WHERE json_extract(document,'$.run_id')=?",
                (changed.id,)).fetchone()
            if row:
                intent = FollowUpIntent.model_validate_json(row[0])
                if intent.status != "closed":
                    intents.append(intent.model_copy(update={"status": "closed", "reason": changed.reason}))
        if changed.state in {"interrupted","blocked_incompatible","completed","failed","cancelled"}:
            row = tx.execute("SELECT session_id,generation FROM session_leases WHERE run_id=?",
                             (changed.id,)).fetchone()
            if row is not None:
                release_session(tx, SessionLease(session_id=row[0],run_id=changed.id,generation=row[1]))
    change = change.model_copy(update={"follow_up_intents": intents})
    if change.checkpoints:
        seq = tx.execute("SELECT coalesce(max(seq),0)+1 FROM events WHERE run_id=?",
                         (run.id,)).fetchone()[0]
        change = change.model_copy(update={"checkpoints": [
            checkpoint.model_copy(update={"event_seq": seq}) for checkpoint in change.checkpoints
        ]})
    event = tx.append_event(NewEvent(
        kind=kind, payload=change, workspace_id=run.workspace_id, session_id=run.interaction_session_id,
        run_id=run.id, task_id=task_id, causation_id=causation_id,
    ))
    from flowmate.contracts.execution import TERMINAL
    from flowmate.runtime.budget import BudgetService
    from flowmate.runtime.waits import resolve_waits
    for changed in change.runs:
        if changed.kind == "managed" and changed.state in TERMINAL and changed.interaction_session_id is not None:
            from flowmate.contracts.execution import (
                ModelMessage,
                ScopeDependency,
                TaskHandle,
                TaskResult,
            )
            from flowmate.runtime.delivery import DeliveryService
            root=load(tx,TaskSnapshot,changed.root_task_id)
            messages=[ModelMessage.model_validate_json(row[0]) for row in tx.execute(
                "SELECT document FROM messages WHERE task_id=? ORDER BY event_id,event_index",(root.id,))]
            dependencies=[*changed.scope_dependencies,*(item for message in messages for item in message.source_dependencies)]
            for row in tx.execute("SELECT document FROM artifacts WHERE task_id=?",(root.id,)):
                dependencies.extend(ArtifactRef.model_validate_json(row[0]).dependencies)
            if not messages:
                checkpoint=load(tx,Checkpoint,root.id)
                if checkpoint.tool_call is not None:
                    dependencies.extend(ScopeDependency.model_validate(item)
                        for item in checkpoint.tool_call["dependencies"])
            DeliveryService.enqueue_tx(tx,TaskResult(handle=TaskHandle(run_id=changed.id,task_id=root.id,lifetime="managed"),
                state=root.state,result_version=root.result_version,
                dependencies=list({item.scope_id:item for item in dependencies}.values())),changed.interaction_session_id)

    for changed in change.tasks:
        if changed.state in TERMINAL:
            row = tx.execute("SELECT 1 FROM task_submissions WHERE json_extract(document,'$.handle.task_id')=? "
                "AND json_extract(document,'$.completion_policy')='follow_up'", (changed.id,)).fetchone()
            if row is not None and run.interaction_session_id is not None:
                from flowmate.runtime.delivery import DeliveryService
                from flowmate.runtime.tasks import delivered_result, handle_for
                DeliveryService.enqueue_tx(tx, delivered_result(tx, changed, handle_for(tx, changed)),
                    run.interaction_session_id)
            resolve_waits(tx, utc_now(), target_task_id=changed.id)
    for changed in change.runs:
        if changed.state in TERMINAL:
            BudgetService().return_unused(tx, changed.id)
    return event


def context_for(tx, task_id):
    task = load(tx, TaskSnapshot, task_id)
    run = load(tx, RunSnapshot, task.run_id)
    dependencies = list(run.scope_dependencies)
    if task.binding.execution_session_id not in {item.scope_id for item in dependencies}:
        row = tx.execute("SELECT epoch FROM scopes WHERE id=?", (task.binding.execution_session_id,)).fetchone()
        from flowmate.contracts.execution import ScopeDependency
        dependencies.append(ScopeDependency(scope_id=task.binding.execution_session_id,epoch=row[0]))
    return ExecutionContext(workspace_id=run.workspace_id, session_id=task.binding.execution_session_id,
                            interaction_session_id=task.binding.interaction_session_id,
                            run_id=run.id, task_id=task.id, budget_id=run.budget_id,
                            budget_group_id=run.budget_group_id,scope_dependencies=dependencies)


def check_scopes(tx, dependencies):
    for dependency in dependencies:
        row = tx.execute("SELECT epoch, status FROM scopes WHERE id = ?",
                         (dependency.scope_id,)).fetchone()
        if row is None or row[0] != dependency.epoch or row[1] != "active":
            raise DomainError("scope_revoked", "资料或执行范围已失效")


def can_publish(tx, run, task, dependencies=()):
    from flowmate.runtime.leases import owns_session

    if (run.state in {"interrupted", "blocked_incompatible", "completed", "failed", "cancelled"}
            or task.state not in {"queued", "running"}):
        return False
    if (run.execution_session_id == run.interaction_session_id
            and not owns_session(tx, run.interaction_session_id, run.id)):
        return False
    try:
        check_scopes(tx, [*run.scope_dependencies, *dependencies])
        check_admission(tx,run)
    except DomainError:
        return False
    return True


def check_dispatch(tx, run, task, now):
    check_admission(tx,run)
    if run.yield_requested:
        raise DomainError("yield_requested", "自动总结已让出，不再派发后继工作")
    if not can_publish(tx, run, task):
        raise DomainError("dispatch_blocked", "当前任务状态或授权不允许派发")
    if now >= run.deadline_at:
        raise DomainError("deadline_exceeded", "任务已超过执行时限")
    if task.deadline_at is not None and now >= task.deadline_at:
        raise DomainError("task_deadline_exceeded", "从属任务已超过执行时限")


def pending_outbox(tx, task_id, *, operation=None, state="done"):
    sql = "SELECT document FROM outbox WHERE task_id = ? AND state = 'pending'"
    params = [task_id]
    if operation:
        sql += " AND operation = ?"
        params.append(operation)
    return [OutboxItem.model_validate_json(row[0]).model_copy(update={"state": state})
            for row in tx.execute(sql, params).fetchall()]


def stop_run(tx, run, state, reason=None):
    from flowmate.contracts.execution import TERMINAL

    if state == "cancelled":
        from flowmate.runtime.followups import close_intents
        close_intents(tx, origin_run_id=run.id, reason=reason or "user_cancelled")
        run = load(tx, RunSnapshot, run.id)
    if run.state in TERMINAL:
        return run
    changed = bump(run, state=state, reason=reason)
    tasks, outbox = [], []
    for row in tx.execute("SELECT document FROM tasks WHERE run_id = ?", (run.id,)):
        task = TaskSnapshot.model_validate_json(row[0])
        if task.state not in TERMINAL:
            tasks.append(bump(task, state=state if task.id == run.root_task_id else "cancelled",
                              reason=reason, result_version=1))
            outbox.extend(pending_outbox(tx, task.id, state="cancelled"))
            if state in TERMINAL:
                _retire_interactions(tx, run, task.id)
    waits = [bump(WaitRecord.model_validate_json(row[0]), state="cancelled") for row in tx.execute(
        "SELECT document FROM waits WHERE run_id=? AND state='pending'", (run.id,))]
    emit(tx, changed, run.root_task_id, "run.cancelled",
         RuntimeChange(runs=[changed], tasks=tasks, outbox=outbox, waits=waits))
    return changed


def stop_task(tx, run, task, state, reason=None):
    from flowmate.contracts.execution import TERMINAL

    if task.state in TERMINAL:
        return task
    for row in tx.execute("SELECT document FROM tasks WHERE parent_task_id=?", (task.id,)).fetchall():
        child = TaskSnapshot.model_validate_json(row[0])
        stop_task(tx, run, child, "cancelled", reason)
    _retire_interactions(tx, run, task.id)
    changed = bump(task, state=state, reason=reason, result_version=1)
    waits = [bump(WaitRecord.model_validate_json(row[0]), state="cancelled") for row in tx.execute(
        "SELECT document FROM waits WHERE owner_task_id=? AND state='pending'", (task.id,))]
    emit(tx, run, task.id, "task.cancelled", RuntimeChange(tasks=[changed], waits=waits,
        outbox=pending_outbox(tx, task.id, state="cancelled")))
    return changed


def _retire_interactions(tx, run, task_id):
    """终止任务的待办在同一事务退役，其他入口不会看到无法处理的pending。"""
    questions = [bump(Question.model_validate_json(row[0]), status="cancelled") for row in tx.execute(
        "SELECT document FROM questions WHERE task_id=? AND status='pending'", (task_id,))]
    if questions:
        emit(tx, run, task_id, "task.stepped", RuntimeChange(questions=questions))
    approvals = [bump(Approval.model_validate_json(row[0]), status="superseded") for row in tx.execute(
        "SELECT document FROM approvals WHERE task_id=? AND status IN ('pending','approved')", (task_id,))]
    if approvals:
        tx.append_event(NewEvent(kind="approval.decided", workspace_id=run.workspace_id,
            session_id=run.interaction_session_id, run_id=run.id, task_id=task_id, payload=PolicyChange(approvals=approvals)))
