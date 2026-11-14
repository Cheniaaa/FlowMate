"""审批绑定准备活动与规范调用摘要；批准本身不执行工具或授予资料用途。"""

from datetime import timedelta

from flowmate.contracts.base import CommandMeta, DomainError
from flowmate.contracts.execution import (
    ActivitySnapshot,
    ExecutionContext,
    OutboxItem,
    RuntimeChange,
)
from flowmate.persistence.store import Store, UnitOfWork
from flowmate.policy.contracts import (
    Approval,
    ExportApprovalPreview,
    PolicyChange,
    ScopeRef,
    ToolInvocation,
    invocation_hash,
)
from flowmate.policy.service import (
    _command,
    _dependencies,
    _document,
    _owner,
    _policy_event,
)
from flowmate.runtime.transitions import bump, context_for, emit, load, utc_now


class ApprovalService:
    def __init__(self, store: Store, *, clock=utc_now, ttl_seconds=1800):
        self.store = store
        self.clock = clock
        if ttl_seconds <= 0:
            raise ValueError("审批有效期必须为正数")
        self.ttl_seconds = ttl_seconds

    def _prepared(self, tx, ctx):
        run, task = _owner(tx, ctx)
        if run.state in {"interrupted", "blocked_incompatible", "completed", "failed", "cancelled"} or task.state not in {
                "queued", "running", "waiting_approval"}:
            raise DomainError("owner_inactive", "任务当前不可审批")
        if ctx.activity_id is None:
            raise DomainError("approval_binding", "审批必须绑定真实活动")
        activity = load(tx, ActivitySnapshot, ctx.activity_id)
        if activity.state != "prepared" or activity.intent.kind != "tool":
            raise DomainError("approval_binding", "只有未派发的工具活动可以审批")
        if self.clock() >= min(run.deadline_at, task.deadline_at or run.deadline_at):
            raise DomainError("approval_expired", "执行时限已过")
        return run, task, activity

    @staticmethod
    def _event(tx, kind, approvals, ctx, causation_id=None):
        _policy_event(tx, kind, PolicyChange(approvals=approvals),
                      ScopeRef(workspace_id=ctx.workspace_id, session_id=ctx.session_id),
                      ctx=ctx, causation_id=causation_id)

    def propose(self, call: ToolInvocation, ctx: ExecutionContext, *,
                export_preview: ExportApprovalPreview | None = None) -> Approval:
        call = ToolInvocation.model_validate(call.model_dump())
        digest = invocation_hash(call)
        with self.store.transaction() as tx:
            run, task, activity = self._prepared(tx, ctx)
            dependencies = _dependencies(tx, ctx, [*activity.intent.dependencies, *call.dependencies])
            changed = []
            rows = tx.execute("SELECT document FROM approvals WHERE activity_id=? AND call_id=? "
                              "AND status IN ('pending','approved','denied')",
                              (activity.id, call.call_id)).fetchall()
            for row in rows:
                previous = Approval.model_validate_json(row[0])
                if (previous.args_hash == digest and previous.dependencies == dependencies
                        and self.clock() < previous.expires_at):
                    return previous
                changed.append(bump(previous, status=("expired" if self.clock() >= previous.expires_at
                                                       else "superseded")))
            approval = Approval(workspace_id=run.workspace_id, session_id=run.session_id,
                run_id=run.id, task_id=task.id, activity_id=activity.id, call_id=call.call_id,
                tool_name=call.name, tool_version=call.version, args_hash=digest, target=call.target,
                parameters=call.arguments, dependencies=dependencies, export_preview=export_preview,
                expires_at=min(self.clock() + timedelta(seconds=self.ttl_seconds), run.deadline_at,
                               task.deadline_at or run.deadline_at))
            self._event(tx, "approval.proposed", [*changed, approval], ctx)
            runs = [bump(run, state="waiting_approval")] if (
                task.id == run.root_task_id and run.state != "waiting_approval") else []
            tasks = [bump(task, state="waiting_approval")] if task.state != "waiting_approval" else []
            if tasks or runs:
                emit(tx, run, task.id, "task.stepped", RuntimeChange(runs=runs, tasks=tasks))
            return approval

    def decide(self, approval_id: str, allow: bool, meta: CommandMeta) -> Approval:
        if type(allow) is not bool:
            raise DomainError("invalid_command", "审批决定必须为布尔值")

        def apply(tx):
            approval = _document(tx, "approvals", Approval, approval_id)
            if meta.expected_version != approval.version:
                raise DomainError("version_conflict", "审批版本已改变")
            ctx = context_for(tx, approval.task_id).model_copy(update={"activity_id": approval.activity_id})
            run, task, activity = self._prepared(tx, ctx)
            self._binding(approval, ctx)
            if self.clock() >= approval.expires_at:
                raise DomainError("approval_expired", "审批有效期已过")
            _dependencies(tx, ctx, [*activity.intent.dependencies, *approval.dependencies])
            status = "approved" if allow else "denied"
            if approval.status == status:
                return approval
            if approval.status != "pending":
                raise DomainError("approval_decided", "审批已决定或被新参数替代")
            decided = bump(approval, status=status)
            self._event(tx, "approval.decided", [decided], ctx, meta.command_id)
            pending = tx.execute("SELECT 1 FROM approvals WHERE task_id=? AND status='pending' LIMIT 1",
                                 (task.id,)).fetchone()
            if pending is None:
                tasks = [bump(task, state="running")] if task.state == "waiting_approval" else []
                runs = [bump(run, state="running")] if (
                    task.id == run.root_task_id and run.state == "waiting_approval") else []
                items = []
                for row in tx.execute("SELECT id FROM activities WHERE task_id=? AND state='prepared'",
                                      (task.id,)).fetchall():
                    if not tx.execute("SELECT 1 FROM outbox WHERE activity_id=? AND operation='activity' "
                                      "AND state='pending'", (row[0],)).fetchone():
                        items.append(OutboxItem(run_id=run.id, task_id=task.id, activity_id=row[0],
                                                operation="activity"))
                emit(tx, run, task.id, "task.stepped", RuntimeChange(runs=runs, tasks=tasks,
                                                                     outbox=items), meta.command_id)
            return decided

        return _command(self.store, "approval.decide", {"approval_id": approval_id, "allow": allow},
                        meta, Approval, apply)

    @staticmethod
    def _binding(approval, ctx):
        if (approval.workspace_id, approval.session_id, approval.run_id, approval.task_id,
                approval.activity_id) != (ctx.workspace_id, ctx.session_id, ctx.run_id,
                                          ctx.task_id, ctx.activity_id):
            raise DomainError("approval_binding", "审批归属与活动不一致")

    def validate(self, tx: UnitOfWork, ctx: ExecutionContext, call: ToolInvocation,
                 approval_id: str) -> Approval:
        call = ToolInvocation.model_validate(call.model_dump())
        _, _, activity = self._prepared(tx, ctx)
        approval = _document(tx, "approvals", Approval, approval_id)
        self._binding(approval, ctx)
        if self.clock() >= approval.expires_at:
            raise DomainError("approval_expired", "审批有效期已过")
        if approval.status != "approved":
            raise DomainError("approval_required", "调用未获得有效批准")
        dependencies = _dependencies(tx, ctx, [*activity.intent.dependencies, *call.dependencies])
        if (approval.call_id != call.call_id or approval.tool_name != call.name
                or approval.tool_version != call.version or approval.args_hash != invocation_hash(call)
                or approval.target != call.target or approval.dependencies != dependencies):
            raise DomainError("approval_binding", "调用参数或依赖已改变，原审批失效")
        return approval
