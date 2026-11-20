"""只从已提交事实恢复，不重放外部操作。"""

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    Checkpoint,
    FollowUpIntent,
    ModelMessage,
    RunSnapshot,
    RuntimeChange,
    ScopeDependency,
    TaskSnapshot,
)
from flowmate.runtime.transitions import (
    bump,
    check_admission,
    check_scopes,
    context_for,
    emit,
    load,
)

# 命令与待办共用真实选择集；正常同伴、问题、审批及从属join不是条件恢复对象。
CONDITION_WAITING_TASKS_SQL = (
    "SELECT t.id,t.run_id,t.document FROM tasks t JOIN runs r ON r.id=t.run_id "
    "JOIN checkpoints c ON c.task_id=t.id "
    "WHERE r.state NOT IN ('interrupted','blocked_incompatible','completed','failed','cancelled') "
    "AND t.state='waiting_user' AND json_extract(t.document,'$.kind')='agent' "
    "AND json_extract(t.document,'$.reason') IS NOT NULL AND json_extract(t.document,'$.reason')<>'question' "
    "AND json_extract(c.document,'$.phase')='waiting_user' "
    "AND NOT EXISTS(SELECT 1 FROM questions q WHERE q.task_id=t.id AND q.status='pending') "
    "AND NOT EXISTS(SELECT 1 FROM approvals a WHERE a.task_id=t.id AND a.status='pending') "
    "AND NOT EXISTS(SELECT 1 FROM waits w WHERE w.owner_task_id=t.id AND w.state='pending') "
    "AND NOT EXISTS(SELECT 1 FROM activities a WHERE a.task_id=t.id "
    "AND a.state IN ('prepared','dispatched','uncertain'))"
)


def require_catalog_available(current, saved):
    if (saved.agent_executor_id != current.agent_executor_id
            or any(current.tools.get(name) != version for name, version in saved.tools.items())
            or any(current.mcp_tools.get(name) != binding for name, binding in saved.mcp_tools.items()
                if name in saved.tools)
            or any(current.plugins.get(name) != version for name, version in saved.plugins.items())):
        raise DomainError("blocked_incompatible", "所需工具或插件版本不可用")


def resume_candidates(tx, run):
    if run.state in {"interrupted", "blocked_incompatible"}:
        rows = tx.execute("SELECT document FROM tasks WHERE run_id=? "
            "AND state NOT IN ('completed','failed','cancelled')", (run.id,))
    else:
        rows = tx.execute(f"SELECT document FROM ({CONDITION_WAITING_TASKS_SQL}) WHERE run_id=?", (run.id,))
    return [TaskSnapshot.model_validate_json(row[0]) for row in rows]


def check_resume(tx, run, tasks, *, policy, catalog=None, now):
    """恢复命令与待办共同消费当前事实，不改变状态或重放活动。"""
    from flowmate.policy.contracts import ToolInvocation

    if not tasks:
        raise DomainError("resume_blocked", "当前没有可恢复的任务")
    check_scopes(tx, run.scope_dependencies)
    check_admission(tx, run)
    if run.execution_session_id == run.interaction_session_id:
        if tx.execute("SELECT archived FROM sessions WHERE id=?", (run.interaction_session_id,)).fetchone()[0]:
            raise DomainError("session_archived", "归档会话不能恢复自动交互")
        if tx.execute("SELECT 1 FROM session_leases WHERE session_id=? AND run_id IS NOT NULL AND run_id<>?",
                (run.interaction_session_id, run.id)).fetchone():
            raise DomainError("session_busy", "会话已有其他推进中的运行")
    if now >= run.deadline_at:
        raise DomainError("deadline_exceeded", "原授权执行时限已过")
    if run.kind == "follow_up" and run.reason == "yield_to_user":
        row = tx.execute("SELECT document FROM follow_up_intents WHERE json_extract(document,'$.run_id')=?",
            (run.id,)).fetchone()
        if (row is None or FollowUpIntent.model_validate_json(row[0]).status != "paused"
                or tx.execute("SELECT 1 FROM pending_user_commands WHERE session_id=? AND state='queued'",
                    (run.interaction_session_id,)).fetchone()):
            raise DomainError("resume_blocked", "意图已关闭或仍有用户输入待处理")
    for row in tx.execute("SELECT document FROM activities WHERE run_id=?", (run.id,)):
        activity = ActivitySnapshot.model_validate_json(row[0])
        if activity.state == "uncertain":
            raise DomainError("uncertain_activity", "存在未核实的外部操作，不能重放")
        if activity.receipt is not None and not activity.content_committed:
            raise DomainError("missing_activity_result", "外部结果仅完成补账，缺少可继续的业务结果")
    messages = {}
    for row in tx.execute("SELECT task_id,document FROM messages WHERE run_id=?", (run.id,)):
        message = ModelMessage.model_validate_json(row["document"])
        check_scopes(tx, message.source_dependencies)
        messages.setdefault(row["task_id"], []).extend(message.source_dependencies)
    uses = []
    for task in tasks:
        if catalog is not None:
            require_catalog_available(catalog, task.binding.config.catalog)
        for row in tx.execute("SELECT document FROM activities WHERE task_id=? AND "
                "json_extract(document,'$.receipt.error')='blocked_incompatible'", (task.id,)):
            rejected = ActivitySnapshot.model_validate_json(row[0])
            if rejected.intent.operation in task.binding.config.catalog.mcp_tools:
                raise DomainError("blocked_incompatible", "MCP 已拒绝此 Run 的固定目录，请新建 Run")
        if task.deadline_at is not None and now >= task.deadline_at:
            raise DomainError("task_deadline_exceeded", "成员原执行时限已过")
        checkpoint = load(tx, Checkpoint, task.id)
        check_scopes(tx, checkpoint.output_dependencies)
        dependencies = [*messages.get(task.id, []), *checkpoint.output_dependencies,
            *[ScopeDependency.model_validate(value)
                for value in checkpoint.context_manifest.get("source_dependencies", [])]]
        if checkpoint.tool_call is not None:
            dependencies.extend(ToolInvocation.model_validate(checkpoint.tool_call).dependencies)
        check_scopes(tx, dependencies)
        uses.append((task, dependencies))
    for task, dependencies in uses:
        ctx = context_for(tx, task.id)
        for purpose in ("read", "model_send") if task.kind == "agent" else ("read",):
            decision = policy.check_tx(tx, ctx, dependencies, purpose,
                task.binding.config.model_profile.endpoint if purpose == "model_send" else None)
            if not decision.allowed:
                raise DomainError("grant_required", "恢复所需资料的当前用途授权已失效")


def recover(store, *, catalog=None):

    available = catalog.snapshot() if hasattr(catalog, "snapshot") else catalog
    with store.transaction() as tx:
        for row in tx.execute("SELECT document FROM runs WHERE state NOT IN ('completed','failed','cancelled') "
                              "OR EXISTS(SELECT 1 FROM activities a WHERE a.run_id=runs.id AND a.state='dispatched')").fetchall():
            run = RunSnapshot.model_validate_json(row[0])
            activities = []
            for row in tx.execute("SELECT document FROM activities WHERE run_id=? AND state='dispatched'",
                                  (run.id,)):
                activities.append(bump(ActivitySnapshot.model_validate_json(row[0]), state="uncertain"))
            if run.state in TERMINAL:
                emit(tx, run, run.root_task_id, "runtime.recovered", RuntimeChange(activities=activities))
                continue
            incompatible = False
            if available is not None:
                try:
                    for task_row in tx.execute("SELECT document FROM tasks WHERE run_id=?", (run.id,)):
                        require_catalog_available(available, TaskSnapshot.model_validate_json(task_row[0]).binding.config.catalog)
                except DomainError:
                    incompatible = True
            runnable = tx.execute("SELECT 1 FROM tasks WHERE run_id=? AND state IN ('queued','running')",
                                  (run.id,)).fetchone()
            needs_stop = bool(runnable) or bool(activities)
            tasks = []
            if needs_stop:
                for row in tx.execute("SELECT document FROM tasks WHERE run_id=? AND state IN "
                                      "('queued','running')", (run.id,)):
                    task = TaskSnapshot.model_validate_json(row[0])
                    tasks.append(bump(task, state="interrupted", reason="runtime_restart"))
            if activities or needs_stop or incompatible:
                changed = bump(run, state="blocked_incompatible" if incompatible else "interrupted",
                               reason="plugin_or_tool_version_unavailable" if incompatible else "runtime_restart")
                emit(tx, changed, run.root_task_id, "runtime.recovered",
                     RuntimeChange(runs=[changed], tasks=tasks, activities=activities))
                if run.yield_requested:
                    from flowmate.runtime.followups import finish_yield
                    finish_yield(tx, run.id)
