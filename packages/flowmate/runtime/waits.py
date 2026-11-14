"""等待与继续身份属于持久事务，不占用执行许可。"""

from datetime import UTC

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    TERMINAL,
    Checkpoint,
    OutboxItem,
    RunSnapshot,
    RuntimeChange,
    TaskHandle,
    TaskSnapshot,
    WaitOutcome,
    WaitRecord,
)
from flowmate.runtime.tasks import _target
from flowmate.runtime.transitions import bump, emit, load, pending_outbox, utc_now


def _resolve(tx, wait, now):
    wait = load(tx, WaitRecord, wait.id)
    if wait.state != "pending":
        return wait
    run = load(tx, RunSnapshot, wait.run_id)
    owner = load(tx, TaskSnapshot, wait.owner_task_id)
    target = load(tx, TaskSnapshot, wait.target_task_id)
    result_version = None
    if run.state in TERMINAL or owner.state in TERMINAL:
        state = "cancelled"
    elif target.state in TERMINAL:
        state, result_version = "ready", target.result_version
    elif wait.deadline_at is not None and now >= wait.deadline_at:
        state = "timeout"
    else:
        return wait
    changed = bump(wait, state=state, result_version=result_version)
    change = RuntimeChange(waits=[changed])
    if (state != "cancelled" and run.state not in {"interrupted", "blocked_incompatible"}
            and owner.state not in {"interrupted", "blocked_incompatible"}):
        change = change.model_copy(update={"tasks": [bump(owner, state="running", reason=None)]})
        if owner.id == run.root_task_id:
            change = change.model_copy(update={"runs": [bump(run, state="running", reason=None)]})
        if not tx.execute("SELECT 1 FROM outbox WHERE task_id=? AND operation='step' "
                          "AND state='pending'", (owner.id,)).fetchone():
            change = change.model_copy(update={"outbox": [OutboxItem(
                run_id=run.id, task_id=owner.id, operation="step")]})
    emit(tx, run, owner.id, "wait.resolved", change)
    return changed


def resolve_waits(tx, now, *, run_id, target_task_id=None):
    sql, params = "SELECT document FROM waits WHERE state='pending' AND run_id=?", (run_id,)
    if target_task_id is not None:
        sql += " AND target_task_id=?"
        params += (target_task_id,)
    return [_resolve(tx, WaitRecord.model_validate_json(row[0]), now)
            for row in tx.execute(sql, params).fetchall()]


class WaitService:
    def __init__(self, store, *, clock=None):
        self.store = store
        self.clock = clock or utc_now

    def register(self, ctx, handle, timeout_at, continuation_id):
        with self.store.transaction() as tx:
            return self._register(tx, ctx, handle, timeout_at, continuation_id)

    def _register(self, tx, ctx, handle, timeout_at, continuation_id):
        run, owner, target = _target(tx, ctx, handle)
        previous = tx.execute("SELECT document FROM waits WHERE owner_task_id=? AND continuation_id=?",
                              (owner.id, continuation_id)).fetchone()
        if previous:
            wait = WaitRecord.model_validate_json(previous[0])
            if (wait.target_task_id, wait.deadline_at) != (target.id, timeout_at):
                raise DomainError("wait_conflict", "同一继续身份不能更改等待目标或时限")
            return wait
        if (owner.state in TERMINAL or run.state in TERMINAL
                or owner.state in {"interrupted", "blocked_incompatible"}
                or run.state in {"interrupted", "blocked_incompatible"}):
            raise DomainError("owner_inactive", "当前上下文不能登记新等待")
        # 只沿仍有效的有向等待边遍历，完成的历史边不构成环。
        reached, frontier = set(), [target.id]
        while frontier:
            current = frontier.pop()
            if current == owner.id:
                raise DomainError("wait_cycle", "等待关系不能形成有向环")
            if current in reached:
                continue
            reached.add(current)
            frontier.extend(row[0] for row in tx.execute(
                "SELECT target_task_id FROM waits WHERE owner_task_id=? AND state='pending'",
                (current,)))
        wait = WaitRecord(run_id=run.id, owner_task_id=owner.id, target_task_id=target.id,
                          deadline_at=timeout_at, continuation_id=continuation_id)
        if wait.deadline_at is not None:
            wait = wait.model_copy(update={"deadline_at": wait.deadline_at.astimezone(UTC)})
        if target.state in TERMINAL:
            wait = wait.model_copy(update={"state": "ready", "result_version": target.result_version})
        elif wait.deadline_at is not None and self.clock() >= wait.deadline_at:
            wait = wait.model_copy(update={"state": "timeout"})
        checkpoint = load(tx, Checkpoint, owner.id)
        change = RuntimeChange(waits=[wait], checkpoints=[bump(
            checkpoint, wait_ids=[*checkpoint.wait_ids, wait.id])])
        if wait.state == "pending":
            change = change.model_copy(update={"tasks": [bump(owner, state="waiting_children")],
                                               "outbox": pending_outbox(tx, owner.id, operation="step")})
            if owner.id == run.root_task_id:
                change = change.model_copy(update={"runs": [bump(run, state="waiting_children")]})
        emit(tx, run, owner.id, "wait.registered", change)
        return wait

    def complete_or_timeout(self, wait_id):
        with self.store.transaction() as tx:
            wait = self._resolve(tx, load(tx, WaitRecord, wait_id), self.clock())
            return WaitOutcome(kind=wait.state, result_version=wait.result_version,
                result_ref=TaskHandle(run_id=wait.run_id, task_id=wait.target_task_id)
                if wait.state == "ready" else None)

    @staticmethod
    def _resolve(tx, wait, now):
        return _resolve(tx, wait, now)
