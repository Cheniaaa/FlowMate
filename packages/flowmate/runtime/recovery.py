"""只从已提交事实恢复，不重放外部操作。"""

import json

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
    ToolCallPart,
    ToolResultPart,
)
from flowmate.runtime.transitions import (
    bump,
    check_admission,
    check_scopes,
    context_for,
    emit,
    load,
    pending_outbox,
    stop_run,
)

# 关联随 run.resumed 与命令在同一事务提交，检查点后续推进不影响这条事件。
MCP_REQUERY_EVENTS = (
    "SELECT e.run_id, json_extract(c.value,'$.context_manifest.mcp_requery') AS requery "
    "FROM events e JOIN commands cmd ON cmd.command_id=json_extract(e.document,'$.causation_id') "
    "JOIN json_each(e.document,'$.payload.checkpoints') c "
    "JOIN json_each(e.document,'$.payload.activities') fresh "
    "ON json_extract(fresh.value,'$.id')=json_extract(c.value,'$.context_manifest.mcp_requery.activity_id') "
    "WHERE json_extract(e.document,'$.kind')='run.resumed' "
    "AND json_extract(c.value,'$.context_manifest.mcp_requery') IS NOT NULL"
)

# 已跳过或由用户另发，原 Activity 仍是未知结果。
MCP_QUERY_HANDLED = (
    "(json_extract(a.document,'$.mcp_source') IS NOT NULL AND ("
    "EXISTS(SELECT 1 FROM messages m WHERE m.task_id=a.task_id "
    "AND json_extract(m.document,'$.activity_id')=a.id "
    "AND json_extract(m.document,'$.parts[0].error')='mcp_call_uncertain') OR "
    f"EXISTS(SELECT 1 FROM ({MCP_REQUERY_EVENTS}) r WHERE r.run_id=a.run_id "
    "AND json_extract(r.requery,'$.original_activity_id')=a.id)))"
)

# 只释放已明确放弃的query向量义务；未知费用仍留在原Activity和预算账本。
QUERY_RESULT_RELEASED = (
    f"({MCP_QUERY_HANDLED} OR (json_extract(a.document,'$.intent.operation')='embedding.query' "
    "AND json_extract(a.document,'$.intent.origin')='runtime' "
    "AND json_extract(a.document,'$.embedding_query_abandoned')=1))"
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
    f"AND (a.state IN ('prepared','dispatched') OR (a.state='uncertain' AND ({QUERY_RESULT_RELEASED}) IS NOT TRUE)))"
)


def has_pending_activities(tx, task_id):
    return tx.execute("SELECT 1 FROM activities a WHERE a.task_id=? AND "
        f"(a.state IN ('prepared','dispatched') OR (a.state='uncertain' AND ({QUERY_RESULT_RELEASED}) IS NOT TRUE)) LIMIT 1",
        (task_id,)).fetchone() is not None


def require_catalog_available(current, saved, *, tx=None, without_mcp=False):
    if (saved.agent_executor_id != current.agent_executor_id
            or any(current.plugins.get(name) != version for name, version in saved.plugins.items())):
        raise DomainError("blocked_incompatible", "所需工具或插件版本不可用")
    changed = []
    for name, version in saved.tools.items():
        if without_mcp and name in saved.mcp_tools:
            continue
        current_version = current.tools.get(name)
        current_binding, saved_binding = current.mcp_tools.get(name), saved.mcp_tools.get(name)
        if current_version == version and current_binding == saved_binding:
            continue
        if tx is None or current_version is None or current_binding is None or saved_binding is None:
            raise DomainError("blocked_incompatible", "所需工具或插件版本不可用")
        changed.append((name, current_version, current_binding, version, saved_binding))
    if changed:
        from flowmate.integrations.tools import require_compatible_bindings
        require_compatible_bindings(tx, changed)


def resume_candidates(tx, run):
    if run.state in {"interrupted", "blocked_incompatible"}:
        rows = tx.execute("SELECT document FROM tasks WHERE run_id=? "
            "AND state NOT IN ('completed','failed','cancelled')", (run.id,))
    else:
        rows = tx.execute(f"SELECT document FROM ({CONDITION_WAITING_TASKS_SQL}) WHERE run_id=?", (run.id,))
    return [TaskSnapshot.model_validate_json(row[0]) for row in rows]


def is_uncertain_query(tx, run, task, activity, receipt):
    """只为具有固定只读声明的直接会话工具开放降级，声明不会改变派发权限。"""
    from flowmate.integrations.tools import stored_catalog

    if (run.kind != "user" or run.execution_session_id != run.interaction_session_id
            or task.id != run.root_task_id or task.kind != "agent"
            or activity.run_id != run.id or activity.task_id != task.id
            or activity.intent.kind != "tool" or activity.mcp_source is None
            or activity.intent.origin not in {"agent", "user"} or not activity.request_digest
            or (receipt is not None and (receipt.confirmed or receipt.error != "mcp_call_uncertain"))):
        return False
    binding = activity.mcp_source.binding
    if (task.binding.config.catalog.mcp_tools.get(activity.intent.operation) != binding
            or task.binding.config.model_profile.endpoint != activity.mcp_source.model_destination):
        return False
    try:
        catalog = stored_catalog(tx, binding.server_id, binding.catalog_hash)
    except DomainError as error:
        if error.code not in {"blocked_incompatible", "mcp_catalog_invalid"}:
            raise
        # 目录无法核对时保留原派发回执，按未知副作用处理。
        return False
    definition = next((tool for tool in catalog.tools if tool.name == binding.original_name), None)
    hints = definition.annotations or {} if definition is not None else {}
    return hints.get("readOnlyHint") is True and hints.get("destructiveHint") is not True


def requery_authorization(tx, run_id, activity_id):
    row = tx.execute(f"SELECT requery FROM ({MCP_REQUERY_EVENTS}) WHERE run_id=? "
        "AND json_extract(requery,'$.activity_id')=?", (run_id, activity_id)).fetchone()
    return json.loads(row[0]) if row else None


def check_requery_grant(tx, ctx, binding, destination):
    from flowmate.integrations.configuration import connection_identity
    from flowmate.integrations.permissions import query_grant
    from flowmate.integrations.tools import configured_server

    grant = query_grant(tx, ctx, binding, destination)
    if grant is None:
        raise DomainError("grant_required", "须为此工具与固定目录明确允许只读查询")
    identity = tx.execute("SELECT json_extract(document,'$.connection_identity') FROM mcp_servers WHERE id=?",
        (binding.server_id,)).fetchone()[0]
    try:
        current_identity = connection_identity(configured_server(tx, binding.server_id))
    except OSError:
        raise DomainError("mcp_connection_trust_changed", "无法核对原连接身份") from None
    if identity is None or identity != current_identity:
        raise DomainError("mcp_connection_trust_changed", "原连接身份已失效，请重新核对连接")
    dependency = ScopeDependency(scope_id=grant.id, epoch=grant.epoch)
    check_scopes(tx, [dependency])
    return dependency


def mcp_query_degraded(tx, run_id):
    return tx.execute(
        f"SELECT 1 FROM activities a WHERE a.run_id=? AND {MCP_QUERY_HANDLED} LIMIT 1",
        (run_id,)).fetchone() is not None


def skip_uncertain_query(tx, activity, checkpoint):
    from flowmate.policy.contracts import ToolInvocation

    invocation = ToolInvocation.model_validate(activity.intent.arguments)
    origin = ModelMessage.model_validate_json(tx.execute(
        "SELECT m.document FROM messages m JOIN json_each(m.document,'$.parts') p "
        "WHERE m.task_id=? AND json_extract(m.document,'$.role')='assistant' "
        "AND json_extract(p.value,'$.kind')='tool_call' AND json_extract(p.value,'$.call_id')=? "
        "AND json_extract(p.value,'$.name')=? ORDER BY m.rowid DESC LIMIT 1",
        (activity.task_id, invocation.call_id, invocation.name)).fetchone()[0])
    # 只提交调用状态。外部回执和它的内容提交状态保持原样。
    call = next(part for part in origin.parts if isinstance(part, ToolCallPart)
                and part.call_id == invocation.call_id)
    message = ModelMessage(role="tool", activity_id=activity.id,
        parts=[ToolResultPart(call_id=call.call_id, origin_message_id=origin.id,
            error="mcp_call_uncertain")], source_dependencies=origin.source_dependencies)
    pending = [id for id in checkpoint.pending_call_ids if id != call.call_id]
    return message, bump(checkpoint, pending_call_ids=pending,
        phase="dispatch_tools" if pending else "ready_model",
        pending_activity_ids=[id for id in checkpoint.pending_activity_ids if id != activity.id],
        message_boundary=checkpoint.message_boundary + 1)


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
    uncertain_query = None
    retry_grant = None
    for row in tx.execute(f"SELECT a.document, {QUERY_RESULT_RELEASED} AS handled FROM activities a WHERE a.run_id=?", (run.id,)):
        activity = ActivitySnapshot.model_validate_json(row[0])
        if row["handled"]:
            continue
        if activity.state == "uncertain":
            task = next((item for item in tasks if item.id == activity.task_id), None)
            if (task is not None and uncertain_query is None
                    and is_uncertain_query(tx, run, task, activity, activity.receipt)
                    and activity.id in load(tx, Checkpoint, task.id).pending_activity_ids):
                uncertain_query = activity
                continue
            raise DomainError("uncertain_activity", "存在未核实的外部操作，不能重放")
        if activity.receipt is not None and not activity.content_committed:
            raise DomainError("missing_activity_result", "外部结果仅完成补账，缺少可继续的业务结果")
    degraded = uncertain_query is not None or mcp_query_degraded(tx, run.id)
    if (degraded and run.execution_session_id == run.interaction_session_id
            and tx.execute("SELECT 1 FROM pending_user_commands WHERE session_id=? AND state='queued'",
                (run.interaction_session_id,)).fetchone()):
        raise DomainError("session_busy", "会话已有先接纳的用户输入")
    if uncertain_query is not None:
        from flowmate.runtime.budget import BudgetService

        BudgetService.check_mcp_continuation(tx, run)
        if uncertain_query.intent.origin == "agent":
            try:
                BudgetService.check_mcp_continuation(tx, run, requery=True)
                binding = uncertain_query.mcp_source.binding
                ctx = context_for(tx, uncertain_query.task_id)
                check_scopes(tx, [*uncertain_query.intent.dependencies,
                    *(uncertain_query.receipt.source_dependencies if uncertain_query.receipt else [])])
                if catalog is not None and catalog.mcp_tools.get(uncertain_query.intent.operation) != binding:
                    raise DomainError("blocked_incompatible", "固定查询工具不再可用")
                retry_grant = check_requery_grant(tx, ctx, binding, uncertain_query.mcp_source.model_destination)
            except DomainError:
                # 此处只投影再派发资格，模型续轮仍接受下面的资料和用途检查。
                pass
    messages = {}
    for row in tx.execute("SELECT task_id,document FROM messages WHERE run_id=?", (run.id,)):
        message = ModelMessage.model_validate_json(row["document"])
        check_scopes(tx, message.source_dependencies)
        messages.setdefault(row["task_id"], []).extend(message.source_dependencies)
    uses = []
    for task in tasks:
        if catalog is not None:
            require_catalog_available(catalog, task.binding.config.catalog, tx=tx, without_mcp=degraded)
        for row in tx.execute("SELECT document FROM activities WHERE task_id=? AND "
                "json_extract(document,'$.receipt.error')='blocked_incompatible'", (task.id,)):
            rejected = ActivitySnapshot.model_validate_json(row[0])
            if not degraded and rejected.intent.operation in task.binding.config.catalog.mcp_tools:
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
    return uncertain_query, retry_grant


def recover(store, *, catalog=None):

    available = catalog.snapshot() if hasattr(catalog, "snapshot") else catalog
    with store.transaction() as tx:
        for row in tx.execute("SELECT document FROM runs WHERE state NOT IN ('completed','failed','cancelled') "
                              "OR EXISTS(SELECT 1 FROM activities a WHERE a.run_id=runs.id AND a.state='dispatched')").fetchall():
            run = RunSnapshot.model_validate_json(row[0])
            activities = []
            abandoned = {}
            for row in tx.execute("SELECT document FROM activities WHERE run_id=? AND state='dispatched'",
                                  (run.id,)):
                activity = ActivitySnapshot.model_validate_json(row[0])
                query = (activity.intent.kind == "model" and activity.intent.origin == "runtime"
                    and activity.intent.operation == "embedding.query")
                activities.append(bump(activity, state="uncertain", embedding_query_abandoned=query))
                if query:
                    abandoned.setdefault(activity.task_id, set()).add(activity.id)
            if run.state in TERMINAL:
                emit(tx, run, run.root_task_id, "runtime.recovered", RuntimeChange(activities=activities))
                continue
            if run.kind == "knowledge" and any(
                    activity.intent.origin == "runtime" and activity.intent.operation == "embedding.document"
                    for activity in activities):
                emit(tx, run, run.root_task_id, "runtime.recovered", RuntimeChange(activities=activities))
                stop_run(tx, run, "failed", "knowledge_document_unknown")
                continue
            pending_queries = []
            released_checkpoints = [bump(load(tx, Checkpoint, task_id), pending_activity_ids=[
                id for id in load(tx, Checkpoint, task_id).pending_activity_ids if id not in ids])
                for task_id, ids in abandoned.items()]
            root = load(tx, TaskSnapshot, run.root_task_id)
            if root.executor_id == "knowledge.import":
                from flowmate.knowledge.ingestion import recover_local_import
                if recover_local_import(tx, run, root):
                    continue
            if root.executor_id == "naming.title":
                # 原样保留未派发的命名。已派发的结果未知，只保留原计费身份。
                if activities:
                    emit(tx, run, root.id, "runtime.recovered", RuntimeChange(activities=activities))
                    stop_run(tx, run, "failed", "uncertain_activity")
                continue
            checkpoint = load(tx, Checkpoint, root.id)
            by_id = {activity.id: activity for activity in activities}
            for id in checkpoint.pending_activity_ids:
                activity = by_id.get(id) or load(tx, ActivitySnapshot, id)
                if activity.state == "uncertain" and is_uncertain_query(tx, run, root, activity, activity.receipt):
                    pending_queries.append(activity)
            query_waiting = len(pending_queries) == 1
            incompatible = False
            if available is not None:
                try:
                    for task_row in tx.execute("SELECT document FROM tasks WHERE run_id=?", (run.id,)):
                        require_catalog_available(available, TaskSnapshot.model_validate_json(task_row[0]).binding.config.catalog,
                            tx=tx, without_mcp=query_waiting or mcp_query_degraded(tx, run.id))
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
            if activities or needs_stop or incompatible or (query_waiting and run.reason != "mcp_query_uncertain"):
                retired = {activity.id for activity in activities}
                outbox = [item for task_id in {activity.task_id for activity in activities}
                    for item in pending_outbox(tx, task_id, operation="activity") if item.activity_id in retired]
                changed = bump(run, state="blocked_incompatible" if incompatible else "interrupted",
                                reason="plugin_or_tool_version_unavailable" if incompatible else
                                    "mcp_query_uncertain" if query_waiting else "runtime_restart")
                emit(tx, changed, run.root_task_id, "runtime.recovered",
                     RuntimeChange(runs=[changed], tasks=tasks, activities=activities, outbox=outbox,
                         checkpoints=released_checkpoints))
                if run.yield_requested:
                    from flowmate.runtime.followups import finish_yield
                    finish_yield(tx, run.id)
