"""运行状态转换共用查询与围栏；所有写入都通过事件reducer。"""

from datetime import UTC, datetime

from flowmate.contracts.base import DomainError
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    ActivitySnapshot,
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
}


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
    if change.checkpoints:
        seq = tx.execute("SELECT coalesce(max(seq),0)+1 FROM events WHERE run_id=?",
                         (run.id,)).fetchone()[0]
        change = change.model_copy(update={"checkpoints": [
            checkpoint.model_copy(update={"event_seq": seq}) for checkpoint in change.checkpoints
        ]})
    return tx.append_event(NewEvent(
        kind=kind, payload=change, workspace_id=run.workspace_id, session_id=run.session_id,
        run_id=run.id, task_id=task_id, causation_id=causation_id,
    ))


def context_for(tx, task_id):
    task = load(tx, TaskSnapshot, task_id)
    run = load(tx, RunSnapshot, task.run_id)
    return ExecutionContext(workspace_id=run.workspace_id, session_id=run.session_id,
                            run_id=run.id, task_id=task.id, budget_id=run.budget_id,
                            scope_dependencies=run.scope_dependencies)


def check_scopes(tx, dependencies):
    for dependency in dependencies:
        row = tx.execute("SELECT epoch, status FROM scopes WHERE id = ?",
                         (dependency.scope_id,)).fetchone()
        if row is None or row[0] != dependency.epoch or row[1] != "active":
            raise DomainError("scope_revoked", "资料或执行范围已失效")


def can_publish(tx, run, task, dependencies=()):
    if (run.state in {"interrupted", "blocked_incompatible", "completed", "failed", "cancelled"}
            or task.state not in {"queued", "running"}):
        return False
    try:
        check_scopes(tx, [*run.scope_dependencies, *dependencies])
    except DomainError:
        return False
    return True


def check_dispatch(tx, run, task, now):
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
            session_id=run.session_id, run_id=run.id, task_id=task_id, payload=PolicyChange(approvals=approvals)))
