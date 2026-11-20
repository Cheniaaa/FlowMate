"""带SSE水位的有界keyset查询；同事务投影真实归属和摘要。"""

import base64
import json

from pydantic import ValidationError

from flowmate.api.contracts import (
    ActivityView,
    CommandStatus,
    InboxApproval,
    InboxItem,
    InboxQuestion,
    MemberLane,
    MessageView,
    NavigationView,
    Page,
    PageCursor,
    PendingAction,
    PendingActionCommand,
    RunDetail,
    RunFeedback,
    TaskCenterItem,
    TraceItem,
    WorkspaceNavigation,
    WorkspaceSnapshot,
)
from flowmate.api.projections import activity_view
from flowmate.api.summaries import context_usage, cost_summary
from flowmate.contracts.base import DomainError
from flowmate.contracts.events import RunEvent
from flowmate.contracts.execution import (
    ActivitySnapshot,
    AdmissionFence,
    ArtifactRef,
    BudgetAllocation,
    BudgetGroupSnapshot,
    BudgetSnapshot,
    JoinFact,
    Question,
    ResultConsumption,
    RunSnapshot,
    SessionInboxEntry,
    TaskSnapshot,
    TaskSubmission,
    WaitRecord,
)
from flowmate.contracts.settings import (
    AgentProfile,
    ModelConnection,
    ModelProfile,
    Session,
    Workspace,
)
from flowmate.policy.contracts import (
    Approval,
    DataUseGrant,
    ResourceRecord,
    ResourceRef,
)
from flowmate.runtime.recovery import CONDITION_WAITING_TASKS_SQL
from flowmate.runtime.transitions import load


def watermark(tx):
    return tx.execute("SELECT coalesce(max(event_id),0) FROM events").fetchone()[0]


def workspace(tx, id):
    row = tx.execute("SELECT * FROM workspaces WHERE id=?", (id,)).fetchone()
    if row is None:
        raise DomainError("not_found", "工作区不存在")
    return Workspace.model_validate(dict(row))


def session(tx, id):
    row = tx.execute("SELECT * FROM sessions WHERE id=?", (id,)).fetchone()
    if row is None:
        raise DomainError("not_found", "会话不存在")
    return Session.model_validate_json(row["document"])


def page_position(cursor, key, keys=("id",)):
    """SQL 与 Provider 分页共用现有 v3 游标校验。"""
    collection = key.split(":", 1)[0]
    try:
        position = PageCursor.model_validate_json(base64.b64decode(cursor, altchars=b"-_", validate=True))
        expected_type = int if keys[0] == "event_id" else str
        if (position.collection != collection or position.filter_key != key
                or len(position.upper) != len(keys) or len(position.after) != len(keys)
                or any(type(value) is not expected_type for value in [*position.upper, *position.after])
                or tuple(position.after) > tuple(position.upper)):
            raise ValueError
        return position.upper, position.after
    except (ValueError, TypeError, ValidationError):
        raise DomainError("invalid_cursor", "分页游标无效") from None


def page_cursor(key, upper, after):
    position = PageCursor(collection=key.split(":", 1)[0], filter_key=key, upper=upper, after=after)
    return base64.urlsafe_b64encode(position.model_dump_json().encode()).decode()


def _page(tx, model, key, sql, parameters, *, limit=100, cursor=None, decode=None,
          keys=("id",)):
    if not 1 <= limit <= 500:
        raise DomainError("invalid_query", "分页数量须在1至500之间")
    mark = watermark(tx)
    columns = ",".join(keys)
    placeholders = ",".join("?" for _ in keys)
    source = f"({sql}) page"
    after = None
    if cursor:
        upper, after = page_position(cursor, key, keys)
    else:
        last = tx.execute(f"SELECT {columns} FROM {source} ORDER BY " +
                          ",".join(f"{column} DESC" for column in keys) + " LIMIT 1", parameters).fetchone()
        if last is None:
            return Page[model](items=[], next_cursor=None, watermark=mark)
        upper = list(last)
    boundary = f"({columns}) <= ({placeholders})"
    values = [*parameters, *upper]
    if after is not None:
        boundary += f" AND ({columns}) > ({placeholders})"
        values.extend(after)
    positions = ",".join(f"{column} AS cursor_key_{index}" for index, column in enumerate(keys))
    rows = tx.execute(f"SELECT *,{positions} FROM {source} WHERE {boundary} ORDER BY {columns} LIMIT ?",
                      [*values, limit + 1]).fetchall()
    items = [(decode(row) if decode else model.model_validate_json(row["document"])) for row in rows[:limit]]
    next_cursor = None
    if len(rows) > limit:
        next_cursor = page_cursor(key, upper,
            [rows[limit - 1][f"cursor_key_{index}"] for index in range(len(keys))])
    return Page[model](items=items, next_cursor=next_cursor, watermark=mark)


def workspaces(tx, **paging):
    return _page(tx, Workspace, "workspaces", "SELECT * FROM workspaces", [],
                 decode=lambda row: Workspace.model_validate({name: row[name] for name in Workspace.model_fields}), keys=("id",), **paging)


def sessions(tx, id, **paging):
    workspace(tx, id)
    return _page(tx, Session, f"sessions:{id}", "SELECT * FROM sessions WHERE workspace_id=? AND kind='interaction'", [id],
                 keys=("id",), **paging)


def profiles(tx, kind, *, connection_id=None, **paging):
    model = AgentProfile if kind == "agent" else ModelProfile
    filtering = " WHERE p.connection_id=?" if connection_id is not None else ""
    return _page(tx, model, f"{kind}:{connection_id}", f"SELECT p.id,r.document FROM {kind}_profiles p JOIN {kind}_revisions r "
                 f"ON r.profile_id=p.id AND r.version=p.current_version{filtering}",
                 [connection_id] if connection_id is not None else [], **paging)


def connections(tx, **paging):
    return _page(tx, ModelConnection, "connections", "SELECT c.id,r.document FROM model_connections c "
                  "JOIN connection_revisions r ON r.connection_id=c.id AND r.version=c.current_version", [], **paging)


def run_items(tx, run_id, kind, **paging):
    load(tx, RunSnapshot, run_id)
    if kind == "messages":
        return _page(tx, MessageView, f"messages:{run_id}", "SELECT document,run_id,event_id,event_index FROM messages "
                     "WHERE run_id=? AND execution_session_id=(SELECT interaction_session_id FROM runs WHERE id=?) "
                     "ORDER BY event_id,event_index", [run_id,run_id], decode=message_view, keys=("event_id", "event_index"), **paging)
    model = {"tasks": TaskSnapshot, "activities": ActivityView, "artifacts": ArtifactRef,
             "questions": Question, "approvals": Approval, "waits": WaitRecord,
             "consumptions": ResultConsumption, "joins": JoinFact}[kind]
    decode = (lambda row: activity_view(ActivitySnapshot.model_validate_json(row["document"]))) if kind == "activities" else None
    owner_key = "consumer_run_id" if kind == "consumptions" else "run_id"
    return _page(tx, model, f"{kind}:{run_id}", f"SELECT id,document FROM {kind} WHERE {owner_key}=? ORDER BY id", [run_id],
                 decode=decode, **paging)


def message_view(row):
    return MessageView(**json.loads(row["document"]), run_id=row["run_id"],
                       event_id=row["event_id"], event_index=row["event_index"])


def messages(tx, id, **paging):
    if session(tx, id).kind != "interaction":
        raise DomainError("not_found","交互会话不存在")
    return _page(tx, MessageView, f"session_messages:{id}", "SELECT m.document,m.run_id,m.event_id,m.event_index FROM messages m "
                 "WHERE m.execution_session_id=? ORDER BY m.event_id,m.event_index", [id],
                   decode=message_view, keys=("event_id", "event_index"), **paging)


def session_runs(tx, id, **paging):
    session(tx, id)
    return _page(tx, RunSnapshot, f"session_runs:{id}",
                   "SELECT id,document FROM runs WHERE interaction_session_id=? ORDER BY id", [id], **paging)


def run_feedback(tx, id, run_ids):
    """只补可见消息的运行事实；根模型调用顺序来自持久插入位置，不按UUID推测。"""
    if session(tx, id).kind != "interaction":
        raise DomainError("not_found", "交互会话不存在")
    placeholders = ",".join("?" for _ in run_ids)
    rows = tx.execute(
        "SELECT r.id,r.document,a.document AS activity FROM runs r LEFT JOIN activities a ON a.rowid=("
        "SELECT rowid FROM activities WHERE run_id=r.id AND task_id=r.root_task_id "
        "AND json_extract(document,'$.intent.kind')='model' ORDER BY rowid DESC LIMIT 1) "
        f"WHERE r.id IN ({placeholders}) AND r.interaction_session_id=? AND r.execution_session_id=?",
        [*run_ids, id, id]).fetchall()
    if {row["id"] for row in rows} != set(run_ids):
        raise DomainError("not_found", "运行不属于该交互会话")
    items = {}
    for row in rows:
        run = RunSnapshot.model_validate_json(row["document"])
        items[run.id] = RunFeedback(run_id=run.id, version=run.version, workspace_id=run.workspace_id,
            session_id=id, root_task_id=run.root_task_id, connection_id=run.config.model_profile.connection_id,
            state=run.state, reason=run.reason,
            model_activity=activity_view(ActivitySnapshot.model_validate_json(row["activity"])) if row["activity"] else None)
    return Page[RunFeedback](items=[items[run_id] for run_id in dict.fromkeys(run_ids)], watermark=watermark(tx))


def command_status(tx, session_id, command_id):
    session(tx, session_id)
    row = tx.previous_command(command_id)
    if row is None or row["session_id"] != session_id:
        return CommandStatus(status="not_found", result=None)
    pending = tx.execute("SELECT document FROM pending_user_commands WHERE command_id=? AND session_id=?",
        (command_id, session_id)).fetchone()
    return CommandStatus(status="confirmed", result=json.loads(pending[0] if pending else row["response"]))


def pending_commands(tx, session_id, **paging):
    from flowmate.contracts.execution import PendingUserCommand
    session(tx, session_id)
    return _page(tx, PendingUserCommand, f"session_commands:{session_id}",
        "SELECT command_id AS id,document FROM pending_user_commands WHERE session_id=? ORDER BY command_id",
        [session_id], **paging)


def follow_up_intents(tx, session_id, **paging):
    from flowmate.contracts.execution import FollowUpIntent
    session(tx, session_id)
    return _page(tx, FollowUpIntent, f"session_followups:{session_id}",
        "SELECT id,document FROM follow_up_intents WHERE target_session_id=? ORDER BY id", [session_id], **paging)


def resources(tx, id, session_id=None, **paging):
    workspace(tx, id)
    if session_id and session(tx, session_id).workspace_id != id:
        raise DomainError("not_found", "会话不存在于该工作区")
    return _page(tx, ResourceRef, f"resources:{id}:{session_id}", "SELECT id,document FROM resources WHERE workspace_id=? "
                  "AND (? IS NULL OR session_id IS NULL OR session_id=?)", [id, session_id, session_id],
                 decode=lambda row: ResourceRef.model_validate(ResourceRecord.model_validate_json(row["document"]).model_dump(
                     include=ResourceRef.model_fields.keys())), **paging)


def grants(tx, id, session_id=None, **paging):
    workspace(tx, id)
    if session_id and session(tx, session_id).workspace_id != id:
        raise DomainError("not_found", "会话不存在于该工作区")
    return _page(tx, DataUseGrant, f"grants:{id}:{session_id}", "SELECT id,document FROM grants WHERE workspace_id=? "
                  "AND (? IS NULL OR session_id IS NULL OR session_id=?)", [id, session_id, session_id], **paging)


def run_detail(tx, id):
    run = load(tx, RunSnapshot, id)
    budget = load(tx, BudgetSnapshot, run.budget_id)
    return RunDetail(run=run, **{kind: run_items(tx, id, kind) for kind in (
        "tasks", "activities", "messages", "artifacts", "questions", "approvals", "waits", "consumptions", "joins")},
        budget=budget, cost_summary=cost_summary(tx, run, budget), context_usage=context_usage(tx, run), watermark=watermark(tx))


def member_lanes(tx, run_id):
    """泳道来自实际AgentTask；工具沿真实parent边归属，顺序来自持久Activity。"""
    load(tx, RunSnapshot, run_id)
    tasks = {task.id: task for row in tx.execute(
        "SELECT document FROM tasks WHERE run_id=? ORDER BY rowid", (run_id,))
        for task in [TaskSnapshot.model_validate_json(row[0])]}
    lanes = {task.id: MemberLane(task=task, profile=task.binding.config.agent_profile, activities=[], handoffs=[])
        for task in tasks.values() if task.kind == "agent"}

    def owner(id):
        task = tasks[id]
        while task.kind != "agent" and task.parent_task_id is not None:
            task = tasks[task.parent_task_id]
        return lanes.get(task.id)

    for row in tx.execute("SELECT document FROM activities WHERE run_id=? ORDER BY rowid", (run_id,)):
        activity = ActivitySnapshot.model_validate_json(row[0])
        lane = owner(activity.task_id)
        if lane is not None:
            lane.activities.append(activity_view(activity))
    for row in tx.execute("SELECT document FROM task_submissions WHERE origin_run_id=? ORDER BY rowid", (run_id,)):
        submission = TaskSubmission.model_validate_json(row[0])
        lane = owner(submission.origin_task_id)
        if lane is not None:
            lane.handoffs.append(submission.handle)
    return list(lanes.values())


def budget_group(tx, run_id):
    run = load(tx, RunSnapshot, run_id)
    return load(tx, BudgetGroupSnapshot, run.budget_group_id)


def budget_allocation(tx, run_id):
    load(tx, RunSnapshot, run_id)
    return load(tx, BudgetAllocation, run_id)


def task_center(tx,workspace_id=None,state_filter=None,run_kind=None,**paging):
    if workspace_id is not None:
        workspace(tx,workspace_id)
    sql=("SELECT r.id,r.document,t.document AS root_document, "
         "(SELECT state FROM delivery_outbox d WHERE json_extract(d.document,'$.result.run_id')=r.id "
         "ORDER BY source_event_id DESC LIMIT 1) AS delivery_state "
         "FROM runs r JOIN tasks t ON t.id=r.root_task_id WHERE (? IS NULL OR r.workspace_id=?) "
         "AND (? IS NULL OR r.state=?) AND (? IS NULL OR r.kind=?)")
    def decode(row):
        run=RunSnapshot.model_validate_json(row["document"])
        invalid=tx.execute("SELECT document FROM session_inbox WHERE json_extract(document,'$.result.run_id')=?",
                          (run.id,)).fetchall()
        from flowmate.runtime.delivery import visible_entry
        if any(not visible_entry(tx,SessionInboxEntry.model_validate_json(item[0])).source_valid for item in invalid):
            run=run.model_copy(update={"output":None})
        pending=tx.execute("SELECT count(*) FROM ("+_inbox_source()+") p WHERE p.run_id=?", (run.id,)).fetchone()[0]
        root=TaskSnapshot.model_validate_json(row["root_document"])
        return TaskCenterItem(run=run,root=root,pending_count=pending,
            delivery_state=row["delivery_state"],origin_task_id=root.origin_task_id)
    return _page(tx,TaskCenterItem,f"task_center:{workspace_id}:{state_filter}:{run_kind}",sql,
                 [workspace_id,workspace_id,state_filter,state_filter,run_kind,run_kind],decode=decode,**paging)


def session_inbox(tx,session_id,**paging):
    if session(tx,session_id).kind != "interaction":
        raise DomainError("not_found","交互结果入口不存在")
    from flowmate.runtime.delivery import visible_entry
    return _page(tx,SessionInboxEntry,f"session_inbox:{session_id}",
        "SELECT id,document FROM session_inbox WHERE target_session_id=?",[session_id],
        decode=lambda row:visible_entry(tx,SessionInboxEntry.model_validate_json(row["document"])),**paging)


def admission(tx,scope):
    from flowmate.policy.service import _scope
    from flowmate.runtime.transitions import admission_generations
    _scope(tx,scope)
    if scope.kind == "user_global" or (scope.kind == "session" and session(tx,scope.session_id).kind != "interaction"):
        raise DomainError("invalid_scope","准入入口只接受项目或交互会话范围")
    return AdmissionFence(scope=scope,generation=admission_generations(tx,scope.workspace_id,scope.session_id)[
        scope.session_id or scope.workspace_id])


def _inbox_source():
    return ("SELECT q.id,q.document,r.workspace_id,r.interaction_session_id AS session_id,q.run_id,'question' AS kind FROM questions q "
            "JOIN runs r ON r.id=q.run_id WHERE q.status='pending' UNION ALL "
            "SELECT a.id,a.document,r.workspace_id,r.interaction_session_id AS session_id,a.run_id,'approval' AS kind FROM approvals a "
            "JOIN runs r ON r.id=a.run_id WHERE a.status='pending' UNION ALL "
            "SELECT r.id,r.document,r.workspace_id,r.interaction_session_id AS session_id,r.id AS run_id, "
            "CASE WHEN json_extract(r.document,'$.reason') IN ('scope_revoked','budget_exceeded','token_limit','request_limit','step_limit','task_limit',"
            "'pricing_unknown','allocation_exceeded','managed_not_authorized','result_capacity','context_authorization_required',"
            "'outside_run_scope','grant_required','session_archived','admission_stopped') "
            "OR r.state='blocked_incompatible' THEN 'blocked' ELSE 'recovery' END AS kind "
            "FROM runs r WHERE r.state IN ('interrupted','blocked_incompatible') OR "
            "(r.state='waiting_user' AND json_extract(r.document,'$.reason')<>'question' AND NOT EXISTS "
            f"(SELECT 1 FROM ({CONDITION_WAITING_TASKS_SQL}) waiting WHERE waiting.id=r.root_task_id)) UNION ALL "
            "SELECT t.id,t.document,r.workspace_id,r.interaction_session_id AS session_id,r.id AS run_id,'recovery' AS kind "
            f"FROM ({CONDITION_WAITING_TASKS_SQL}) t JOIN runs r ON r.id=t.run_id UNION ALL "
            "SELECT d.id,d.document,r.workspace_id,r.interaction_session_id AS session_id,r.id AS run_id,'delivery_failed' AS kind "
            "FROM delivery_outbox d JOIN runs r ON r.id=json_extract(d.document,'$.result.run_id') WHERE d.state='failed'")


def inbox(tx, *, policy, catalog=None, **paging):
    sql=_inbox_source()
    def decode(row):
        ids = {name: row[name] for name in ("id", "workspace_id", "session_id", "run_id")}
        if row["kind"] == "question":
            return InboxQuestion(**ids, question=Question.model_validate_json(row["document"]))
        if row["kind"] == "approval":
            return InboxApproval(**ids, approval=Approval.model_validate_json(row["document"]))
        run=load(tx,RunSnapshot,row["run_id"])
        condition = (TaskSnapshot.model_validate_json(row["document"]) if
            row["kind"] != "delivery_failed" and row["id"] != run.id else None)
        actions=[PendingActionCommand(kind="view_task",target_id=run.id,expected_version=None)]
        if run.state not in {"completed","failed","cancelled"}:
            actions.append(PendingActionCommand(kind="cancel_run",target_id=run.id,expected_version=run.version))
        if row["kind"] == "delivery_failed":
            from flowmate.runtime.delivery import visible_entry
            entry=visible_entry(tx,SessionInboxEntry.model_validate_json(row["document"]))
            if entry.source_valid:
                actions.append(PendingActionCommand(kind="retry_delivery",target_id=entry.id,expected_version=entry.version))
            version,reason=entry.version,entry.last_error
        else:
            from flowmate.runtime.recovery import check_resume, resume_candidates
            valid=True
            try:
                check_resume(tx, run, resume_candidates(tx, run), policy=policy,
                    catalog=catalog, now=policy.clock())
            except DomainError:
                valid=False
            if valid:
                actions.append(PendingActionCommand(kind="resume",target_id=run.id,expected_version=run.version))
            if tx.execute("SELECT 1 FROM activities WHERE run_id=? AND state='uncertain' AND "
                    "json_extract(document,'$.intent.operation')='artifacts.export'",(run.id,)).fetchone():
                actions.append(PendingActionCommand(kind="inspect_export_recovery",target_id=run.id,expected_version=None))
            version,reason = ((condition.version,condition.reason) if condition is not None else
                              (run.version,run.reason or "runtime_recovery"))
        return PendingAction(**ids,kind=row["kind"],task_id=condition.id if condition is not None else run.root_task_id,
            version=version,reason=reason,allowed_actions=actions)
    return _page(tx, InboxItem, "global_inbox", sql, [], decode=decode, **paging)


def _pending_count(tx, workspace_id=None):
    return tx.execute("SELECT count(*) FROM ("+_inbox_source()+") p WHERE (? IS NULL OR workspace_id=?)",
                      (workspace_id,workspace_id)).fetchone()[0]


def recent_sessions(tx, **paging):
    # 最近创建会话使用不可变创建事件位置倒序，续页不因新消息重新排序。
    return _page(tx, Session, "recent_sessions", "SELECT s.*,-e.event_id AS event_id FROM sessions s "
        "JOIN events e ON e.session_id=s.id WHERE s.kind='interaction' AND json_extract(e.document,'$.kind')='session.created'", [],
        keys=("event_id",), **paging)


def navigation(tx, *, limit=100, cursor=None):
    default = tx.execute("SELECT workspace_id FROM workspace_identity WHERE singleton=1").fetchone()
    def decode(row):
        owner = Workspace.model_validate({name: row[name] for name in Workspace.model_fields})
        return WorkspaceNavigation(workspace=owner, sessions=sessions(tx, owner.id, limit=limit),
                                   pending_count=_pending_count(tx, owner.id))
    return NavigationView(default_workspace_id=default[0] if default else None,
        workspaces=_page(tx, WorkspaceNavigation, "navigation_workspaces",
        "SELECT * FROM workspaces", [], decode=decode, limit=limit, cursor=cursor),
        recent_sessions=recent_sessions(tx, limit=limit), pending_count=_pending_count(tx), watermark=watermark(tx))


def snapshot(tx, id):
    owner = workspace(tx, id)
    return WorkspaceSnapshot(workspace=owner, sessions=sessions(tx, id), active_runs=workspace_items(tx, id, "runs"),
        pending_approvals=workspace_items(tx, id, "approvals"), pending_questions=workspace_items(tx, id, "questions"),
        resources=resources(tx, id), grants=grants(tx, id), watermark=watermark(tx))


def workspace_items(tx, id, kind, **paging):
    workspace(tx, id)
    if kind == "runs":
        return _page(tx, RunSnapshot, f"active:{id}", "SELECT id,document FROM runs WHERE workspace_id=? AND state NOT IN "
                      "('completed','failed','cancelled')", [id], **paging)
    model = {"approvals": Approval, "questions": Question}[kind]
    return _page(tx, model, f"pending_{kind}:{id}", f"SELECT q.id,q.document FROM {kind} q JOIN runs r ON r.id=q.run_id "
                  "WHERE r.workspace_id=? AND q.status='pending'", [id], **paging)


def trace(tx, run_id, **paging):
    load(tx, RunSnapshot, run_id)
    def decode(row):
        event = RunEvent.model_validate_json(json.dumps({**json.loads(row["document"]),
            "event_id": str(row["event_id"]), "seq": row["seq"]}))
        return TraceItem(event_id=event.event_id, seq=event.seq, kind=event.kind, task_id=event.task_id,
            activity_id=event.activity_id, activities=[activity_view(activity) for activity in getattr(event.payload, "activities", [])])
    return _page(tx, TraceItem, f"trace:{run_id}", "SELECT * FROM events WHERE run_id=? ORDER BY event_id", [run_id],
                 decode=decode, keys=("event_id",), **paging)
