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
    MessageView,
    NavigationView,
    Page,
    PageCursor,
    RunDetail,
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
    ArtifactRef,
    BudgetSnapshot,
    JoinFact,
    Question,
    ResultConsumption,
    RunSnapshot,
    TaskSnapshot,
    WaitRecord,
)
from flowmate.contracts.settings import (
    AgentProfile,
    ModelConnection,
    ModelProfile,
    Session,
    Workspace,
)
from flowmate.policy.contracts import Approval, DataUseGrant, ResourceRecord, ResourceRef
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
    return Session.model_validate(dict(row))


def _page(tx, model, key, sql, parameters, *, limit=100, cursor=None, decode=None,
          keys=("id",)):
    if not 1 <= limit <= 500:
        raise DomainError("invalid_query", "分页数量须在1至500之间")
    mark = watermark(tx)
    collection = key.split(":", 1)[0]
    columns = ",".join(keys)
    placeholders = ",".join("?" for _ in keys)
    source = f"({sql}) page"
    after = None
    if cursor:
        try:
            position = PageCursor.model_validate_json(base64.b64decode(cursor, altchars=b"-_", validate=True))
            expected_type = int if keys[0] == "event_id" else str
            if (position.collection != collection or position.filter_key != key
                    or len(position.upper) != len(keys) or len(position.after) != len(keys)
                    or any(type(value) is not expected_type for value in [*position.upper, *position.after])
                    or tuple(position.after) > tuple(position.upper)):
                raise ValueError
            upper, after = position.upper, position.after
        except (ValueError, TypeError, ValidationError):
            raise DomainError("invalid_cursor", "分页游标无效") from None
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
        position = PageCursor(collection=collection, filter_key=key, upper=upper,
            after=[rows[limit - 1][f"cursor_key_{index}"] for index in range(len(keys))])
        next_cursor = base64.urlsafe_b64encode(position.model_dump_json().encode()).decode()
    return Page[model](items=items, next_cursor=next_cursor, watermark=mark)


def workspaces(tx, **paging):
    return _page(tx, Workspace, "workspaces", "SELECT * FROM workspaces", [],
                 decode=lambda row: Workspace.model_validate({name: row[name] for name in Workspace.model_fields}), keys=("id",), **paging)


def sessions(tx, id, **paging):
    workspace(tx, id)
    return _page(tx, Session, f"sessions:{id}", "SELECT * FROM sessions WHERE workspace_id=?", [id],
                 decode=lambda row: Session.model_validate({name: row[name] for name in Session.model_fields}), keys=("id",), **paging)


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
        return _page(tx, MessageView, f"messages:{run_id}", "SELECT document,event_id,event_index FROM messages "
                     "WHERE run_id=? ORDER BY event_id,event_index", [run_id], decode=message_view, keys=("event_id", "event_index"), **paging)
    model = {"tasks": TaskSnapshot, "activities": ActivityView, "artifacts": ArtifactRef,
             "questions": Question, "approvals": Approval, "waits": WaitRecord,
             "consumptions": ResultConsumption, "joins": JoinFact}[kind]
    decode = (lambda row: activity_view(ActivitySnapshot.model_validate_json(row["document"]))) if kind == "activities" else None
    return _page(tx, model, f"{kind}:{run_id}", f"SELECT id,document FROM {kind} WHERE run_id=? ORDER BY id", [run_id],
                 decode=decode, **paging)


def message_view(row):
    return MessageView(**json.loads(row["document"]), event_id=row["event_id"], event_index=row["event_index"])


def messages(tx, id, **paging):
    session(tx, id)
    return _page(tx, MessageView, f"session_messages:{id}", "SELECT m.document,m.event_id,m.event_index FROM messages m "
                 "JOIN runs r ON r.id=m.run_id WHERE r.session_id=? ORDER BY m.event_id,m.event_index", [id],
                   decode=message_view, keys=("event_id", "event_index"), **paging)


def session_runs(tx, id, **paging):
    session(tx, id)
    return _page(tx, RunSnapshot, f"session_runs:{id}",
                 "SELECT id,document FROM runs WHERE session_id=? ORDER BY id", [id], **paging)


def command_status(tx, session_id, command_id):
    session(tx, session_id)
    row = tx.previous_command(command_id)
    if row is None or row["session_id"] != session_id:
        return CommandStatus(status="not_found", result=None)
    return CommandStatus(status="confirmed", result=json.loads(row["response"]))


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


def global_tasks(tx, **paging):
    return _page(tx, RunSnapshot, "global_tasks", "SELECT id,document FROM runs", [], **paging)


def inbox(tx, **paging):
    sql = ("SELECT q.id,q.document,r.workspace_id,r.session_id,q.run_id,'question' AS kind FROM questions q "
           "JOIN runs r ON r.id=q.run_id WHERE q.status='pending' UNION ALL "
           "SELECT a.id,a.document,r.workspace_id,r.session_id,a.run_id,'approval' AS kind FROM approvals a "
           "JOIN runs r ON r.id=a.run_id WHERE a.status='pending'")
    def decode(row):
        ids = {name: row[name] for name in ("id", "workspace_id", "session_id", "run_id")}
        if row["kind"] == "question":
            return InboxQuestion(**ids, question=Question.model_validate_json(row["document"]))
        return InboxApproval(**ids, approval=Approval.model_validate_json(row["document"]))
    return _page(tx, InboxItem, "global_inbox", sql, [], decode=decode, **paging)


def _pending_count(tx, workspace_id=None):
    return sum(tx.execute(f"SELECT count(*) FROM {kind} q JOIN runs r ON r.id=q.run_id "
        "WHERE q.status='pending' AND (? IS NULL OR r.workspace_id=?)", (workspace_id, workspace_id)).fetchone()[0]
        for kind in ("questions", "approvals"))


def recent_sessions(tx, **paging):
    # 最近创建会话使用不可变创建事件位置倒序，续页不因新消息重新排序。
    return _page(tx, Session, "recent_sessions", "SELECT s.*,-e.event_id AS event_id FROM sessions s "
        "JOIN events e ON e.session_id=s.id WHERE json_extract(e.document,'$.kind')='session.created'", [],
        keys=("event_id",), decode=lambda row: Session.model_validate({name: row[name] for name in Session.model_fields}), **paging)


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
