"""带SSE水位的有界keyset查询；同事务投影真实归属和摘要。"""

import base64
import hashlib
import json
from collections import Counter

from pydantic import ValidationError

from flowmate.api.contracts import (
    ActivityView,
    ChatModelUse,
    CommandStatus,
    ContextActivity,
    ContextFile,
    ContextRound,
    InboxApproval,
    InboxItem,
    InboxQuestion,
    MemberLane,
    MessageAttachment,
    MessageView,
    NavigationView,
    Page,
    PageCursor,
    PendingAction,
    PendingActionCommand,
    RunDetail,
    RunFeedback,
    SessionContext,
    SessionContextUsage,
    SessionRunPage,
    TaskCenterItem,
    TraceItem,
    WorkspaceNavigation,
    WorkspaceSnapshot,
)
from flowmate.api.projections import (
    activity_view,
    message_view,
    pending_command_view,
    project_message_sources,
    run_view,
    run_views,
    task_view,
)
from flowmate.api.summaries import context_usage, cost_summary, model_cost_pending
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
    ModelMessage,
    PendingUserCommand,
    Question,
    ResultConsumption,
    RunSnapshot,
    SessionInboxEntry,
    TaskSnapshot,
    TaskSubmission,
    TextSlice,
    WaitRecord,
)
from flowmate.contracts.settings import (
    AgentProfile,
    ModelConnection,
    ModelProfile,
    Session,
    Workspace,
)
from flowmate.models.pricing import SCALE
from flowmate.policy.contracts import (
    Approval,
    DataUseGrant,
    ResourceRecord,
    ResourceRef,
)
from flowmate.policy.service import PolicyService
from flowmate.runtime.naming import task_title
from flowmate.runtime.recovery import CONDITION_WAITING_TASKS_SQL
from flowmate.runtime.transitions import check_scopes, load


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


def run_items(tx, run_id, kind, *, activity_id=None, **paging):
    run = load(tx, RunSnapshot, run_id)
    if activity_id is not None:
        if kind != "activities" or paging.get("cursor") is not None:
            raise DomainError("invalid_query", "指定活动不可与其他列表或游标一起查询")
        row = tx.execute("SELECT document FROM activities WHERE run_id=? AND id=?", (run_id, activity_id)).fetchone()
        if row is None:
            raise DomainError("not_found", "活动不存在")
        activity = ActivitySnapshot.model_validate_json(row["document"])
        check_scopes(tx, [*run.scope_dependencies, *activity.intent.dependencies])
        return Page[ActivityView](items=[activity_view(activity, tx=tx)], watermark=watermark(tx))
    if kind == "messages":
        page = _page(tx, MessageView, f"messages:{run_id}",
                     "SELECT document,run_id,event_id,event_index FROM messages "
                     "WHERE run_id=? AND execution_session_id=? ORDER BY event_id,event_index",
                     [run_id, run.interaction_session_id], decode=lambda row: _message_row(tx, row),
                     keys=("event_id", "event_index"), **paging)
        return _project_message_page(tx, run.workspace_id, run.interaction_session_id, page)
    model = {"tasks": TaskSnapshot, "activities": ActivityView, "artifacts": ArtifactRef,
             "questions": Question, "approvals": Approval, "waits": WaitRecord,
             "consumptions": ResultConsumption, "joins": JoinFact}[kind]
    decode = {
        "activities": lambda row: activity_view(ActivitySnapshot.model_validate_json(row["document"]), tx=tx),
        "tasks": lambda row: task_view(tx, run.workspace_id, TaskSnapshot.model_validate_json(row["document"])),
    }.get(kind)
    owner_key = "consumer_run_id" if kind == "consumptions" else "run_id"
    return _page(tx, model, f"{kind}:{run_id}", f"SELECT id,document FROM {kind} WHERE {owner_key}=? ORDER BY id", [run_id],
                 decode=decode, **paging)


def _message_row(tx, row):
    return message_view(ModelMessage.model_validate_json(row["document"]), run_id=row["run_id"],
                         event_id=row["event_id"], event_index=row["event_index"], tx=tx)


def messages(tx, id, **paging):
    owner = session(tx, id)
    if owner.kind != "interaction":
        raise DomainError("not_found","交互会话不存在")
    page = _page(tx, MessageView, f"session_messages:{id}", "SELECT m.document,m.run_id,m.event_id,m.event_index FROM messages m "
                 "WHERE m.execution_session_id=? ORDER BY m.event_id,m.event_index", [id],
                 decode=lambda row: _message_row(tx, row), keys=("event_id", "event_index"), **paging)
    return _project_message_page(tx, owner.workspace_id, id, page)


def _project_message_page(tx, workspace_id, session_id, page):
    items = project_message_sources(tx, page.items)
    return page.model_copy(update={"items": project_message_attachments(tx, workspace_id, session_id, items)})


def session_runs(tx, id, **paging):
    session(tx, id)
    page = _page(tx, RunSnapshot, f"session_runs:{id}",
                 "SELECT id,document FROM runs WHERE interaction_session_id=? ORDER BY id", [id], **paging)
    return SessionRunPage(items=run_views(tx, page.items), next_cursor=page.next_cursor,
                          watermark=page.watermark, last_model_use=_session_model_use(tx, id) if not paging.get("cursor") else None)


# 用首个根模型派发作为一次人工发送的事实，后续步骤与恢复不会重排人工发送。
_CHAT_MODEL_DISPATCH = """
    SELECT e.event_id, e.session_id,
           json_extract(r.document,'$.config.model_profile.id') AS model_profile_id,
           json_extract(r.document,'$.config.model_profile.reasoning_effort') AS reasoning_effort
    FROM events e JOIN runs r ON r.id=e.run_id
    WHERE r.kind='user' AND e.session_id=r.interaction_session_id
      AND r.execution_session_id=r.interaction_session_id
      AND json_extract(r.document,'$.vision_source_run_id') IS NULL
      AND json_extract(e.document,'$.kind')='activity.dispatched'
      AND json_extract(e.document,'$.task_id')=r.root_task_id
      AND json_extract(e.document,'$.payload.activities[0].intent.kind')='model'
      AND NOT EXISTS (
          SELECT 1 FROM events previous WHERE previous.run_id=e.run_id AND previous.seq<e.seq
            AND json_extract(previous.document,'$.kind')='activity.dispatched'
            AND json_extract(previous.document,'$.task_id')=r.root_task_id
            AND json_extract(previous.document,'$.payload.activities[0].intent.kind')='model'
      )
"""


def _session_model_use(tx, session_id):
    row = tx.execute(_CHAT_MODEL_DISPATCH + " AND e.session_id=? ORDER BY e.event_id DESC LIMIT 1", (session_id,)).fetchone()
    return ChatModelUse.model_validate(dict(row)) if row else None


def chat_model_use_at(tx, event_id):
    row = tx.execute(_CHAT_MODEL_DISPATCH + " AND e.event_id=?", (int(event_id),)).fetchone()
    return ChatModelUse.model_validate(dict(row)) if row else None


def _recent_model_uses(tx, workspace_id):
    rows = tx.execute(
        f"WITH dispatched AS ({_CHAT_MODEL_DISPATCH} AND e.workspace_id=?), "
        "ranked AS (SELECT *,row_number() OVER(PARTITION BY model_profile_id ORDER BY event_id DESC) AS rank FROM dispatched) "
        "SELECT event_id,session_id,model_profile_id,reasoning_effort FROM ranked WHERE rank=1 ORDER BY event_id DESC LIMIT 10",
        (workspace_id,),
    )
    return [ChatModelUse.model_validate(dict(row)) for row in rows]


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
            model_activity=activity_view(ActivitySnapshot.model_validate_json(row["activity"]), tx=tx) if row["activity"] else None,
            context_usage=context_usage(tx, run))
    return Page[RunFeedback](items=[items[run_id] for run_id in dict.fromkeys(run_ids)], watermark=watermark(tx))


def command_status(tx, session_id, command_id):
    session(tx, session_id)
    row = tx.previous_command(command_id)
    if row is None or row["session_id"] != session_id:
        return CommandStatus(status="not_found", result=None)
    pending = tx.execute("SELECT document FROM pending_user_commands WHERE command_id=? AND session_id=?",
        (command_id, session_id)).fetchone()
    if pending:
        item = PendingUserCommand.model_validate_json(pending[0])
        return CommandStatus(status="confirmed", result=pending_command_view(
            tx, row["workspace_id"], item).model_dump(mode="json"))

    result = json.loads(row["response"])
    if isinstance(result, dict) and "root_task_id" in result and "execution_session_id" in result:
        result = run_view(tx, RunSnapshot.model_validate_json(row["response"])).model_dump(mode="json")
    elif isinstance(result, dict) and "target_session_id" in result and "delivery_state" in result:
        from flowmate.runtime.delivery import visible_entry

        # 保留原回执的版本和状态，按当前授权公开交付名称和来源状态。
        entry = SessionInboxEntry.model_validate_json(row["response"])
        result = visible_entry(tx, entry).model_dump(mode="json")
    return CommandStatus(status="confirmed", result=result)


def pending_commands(tx, session_id, **paging):
    owner = session(tx, session_id)
    return _page(tx, PendingUserCommand, f"session_commands:{session_id}",
        "SELECT command_id AS id,document FROM pending_user_commands WHERE session_id=? ORDER BY command_id",
        [session_id], decode=lambda row: pending_command_view(tx, owner.workspace_id,
            PendingUserCommand.model_validate_json(row["document"])), **paging)


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


def run_sources_current(tx, run):
    try:
        check_scopes(tx, run.scope_dependencies)
    except DomainError as error:
        if error.code != "scope_revoked":
            raise
        return False
    return True


def run_goal(tx, run, root):
    if root.binding.agent_work is not None:
        return root.binding.agent_work.goal
    if run.kind != "user":
        return None
    row = tx.execute("SELECT document FROM messages WHERE run_id=? AND task_id=? "
        "AND json_extract(document,'$.origin')='conversation' AND json_extract(document,'$.role')='user' "
        "ORDER BY event_id,event_index LIMIT 1", (run.id, root.id)).fetchone()
    if row is None:
        return None
    message = ModelMessage.model_validate_json(row[0])
    return "\n".join(part.text for part in message.parts if part.kind == "text") or None


def _fixed_file_resources(tx, workspace_id, session_id, resource_ids, *, include_inactive=False):
    if not resource_ids:
        return {}, {}
    rows = tx.execute(
        "WITH RECURSIVE chain(id, parent_resource_id, document) AS ("
        "SELECT r.id,r.parent_resource_id,r.document FROM json_each(?) selected "
        "JOIN resources r ON r.id=selected.value UNION "
        "SELECT r.id,r.parent_resource_id,r.document FROM chain c JOIN resources r ON r.id=c.parent_resource_id) "
        "SELECT c.document FROM chain c JOIN resources r ON r.id=c.id JOIN scopes s ON s.id=c.id "
        "WHERE r.workspace_id=? AND (r.session_id IS NULL OR r.session_id=?) "
        "AND (? OR (s.status='active' AND s.epoch=json_extract(c.document,'$.version')))",
        (json.dumps(list(resource_ids)), workspace_id, session_id, include_inactive))
    records = (ResourceRecord.model_validate_json(row[0]) for row in rows)
    resources = {resource.id: resource for resource in records}
    lineages = {}
    for id in resource_ids:
        if id not in resources or resources[id].kind != "file":
            continue
        lineage, current = [], id
        while current is not None and current in resources:
            lineage.append(current)
            current = resources[current].parent_resource_id
        if current is None:
            lineages[id] = lineage
    return resources, lineages


def _matches_file_pin(tx, workspace_id, session_id, resource, pin, destination):
    return (hashlib.sha256(resource.file_identity.encode()).hexdigest() == pin.file_identity
            and (not pin.inheritance_grants or bool(PolicyService.file_inheritance_grants(
                tx, workspace_id, session_id, resource.id, pin, destination))))


def _readable_files(tx, workspace_id, session_id, file_ids):
    resources, lineages = _fixed_file_resources(tx, workspace_id, session_id, file_ids)
    return {id: resources[id] for id, covering in PolicyService.matching_resource_grants(
        tx, workspace_id, session_id, lineages, "read", None)
        if next(covering, None) is not None}


def visible_file_inputs(tx, workspace_id, session_id, pins, destination):
    return {id: resource for id, resource in _readable_files(tx, workspace_id, session_id, pins).items()
        if _matches_file_pin(tx, workspace_id, session_id, resource, pins[id], destination)}


def hidden_file_dependency_ids(tx, run, resource_ids, grant_ids, stale_files):
    # 授权失效后，保留内部父链以识别需要从公开回执遮去的关联。
    grants = {row["id"]: set(json.loads(row["resources"])) for row in tx.execute(
        "SELECT id, json_extract(document,'$.resource_ids') AS resources FROM grants "
        "WHERE id IN (SELECT value FROM json_each(?))", (json.dumps(list(grant_ids)),))} if grant_ids else {}
    candidates = resource_ids.copy()
    if any(grants.values()):
        candidates.update(run.sources.resource_ids)
        candidates.update(run.file_inputs)
        candidates.update(set().union(*grants.values()))
    workspace_id, session_id = run.workspace_id, run.interaction_session_id
    records, lineages = _fixed_file_resources(tx, workspace_id, session_id, candidates, include_inactive=True)
    files = {id for id in candidates if id in run.file_inputs or id in records and records[id].kind == "file"}
    if not files:
        return set()
    readable = _readable_files(tx, workspace_id, session_id, files)
    hidden = files - readable.keys() | (files & stale_files)
    for id in (files & run.file_inputs.keys()) - hidden:
        if not _matches_file_pin(tx, workspace_id, session_id, readable[id], run.file_inputs[id],
                run.config.model_profile.endpoint):
            hidden.add(id)
    hidden_grants = set()
    for grant_id, covered_ids in grants.items():
        covered_files = {id for id in files if not covered_ids.isdisjoint(lineages.get(id, (id,)))}
        # 直接记录的来源优先于 Run 选择集，避免把同一目录授权的无关文件算作本次依赖。
        used_files = covered_files & resource_ids or covered_files
        if not hidden.isdisjoint(used_files):
            hidden_grants.add(grant_id)
    return hidden | hidden_grants


def fixed_file_names(tx, run):
    return {id: resource.label for id, resource in visible_file_inputs(tx, run.workspace_id,
        run.interaction_session_id, run.file_inputs, run.config.model_profile.endpoint).items()}


_CONTEXT_FILES = {"files.inspect_batch": "inspect", "files.read_text": "read"}
_FILE_VERSION_ERRORS = {"file_identity_changed", "file_source_changed", "source_version_conflict"}
_DISPATCHED_MODEL = ("json_extract(document,'$.intent.kind')='model' "
                     "AND json_extract(document,'$.request_digest') IS NOT NULL")


def _model_metering(usage):
    # 结算状态可能因其他计量字段缺失而未知，仍可公开逐字段的 wire 证据。
    if usage is None or usage.source != "provider_wire":
        return None, None, None
    cached = usage.cached_input_tokens
    if cached == 0 and not usage.cache_read_reported:
        cached = None
    return usage.input_tokens, usage.output_tokens, cached


def _session_context_usage(tx, session_id):
    from flowmate.contracts.execution import Usage

    usage = Counter()
    for row in tx.execute(
        "SELECT a.state,r.state AS run_state,t.state AS task_state,"
        "json_type(a.document,'$.receipt') = 'object' AS receipt_present,"
        "json_extract(a.document,'$.receipt.usage') AS usage,"
        "json_extract(a.document,'$.receipt.actual_units') AS cost "
        "FROM runs r JOIN activities a ON a.run_id=r.id JOIN tasks t ON t.id=a.task_id "
        "WHERE r.interaction_session_id=? AND json_extract(a.document,'$.intent.kind')='model' "
        "AND json_extract(a.document,'$.request_digest') IS NOT NULL", (session_id,)
    ):
        usage["requests"] += 1
        input_tokens, output_tokens, cached = _model_metering(
            Usage.model_validate_json(row["usage"]) if row["usage"] is not None else None)
        if input_tokens is not None:
            usage["input_reported_requests"] += 1
            usage["input_tokens"] += input_tokens
        if output_tokens is not None:
            usage["output_reported_requests"] += 1
            usage["output_tokens"] += output_tokens
        if cached is not None:
            usage["cache_reported_requests"] += 1
            usage["cached_input_tokens"] += cached
            if input_tokens is not None and cached <= input_tokens:
                usage["cache_reported_input_tokens"] += input_tokens
                usage["cached_tokens_with_reported_input"] += cached
        if row["cost"] is not None:
            usage["calculated_units"] += int(row["cost"])
        elif model_cost_pending(row["state"], row["receipt_present"], row["run_state"], row["task_state"]):
            usage["pending_cost_requests"] += 1
        else:
            usage["unknown_cost_requests"] += 1
    return SessionContextUsage(units_per_currency=SCALE, **usage)


def session_context_usage(tx, session_id):
    if session(tx, session_id).kind != "interaction":
        raise DomainError("not_found", "交互会话不存在")
    return _session_context_usage(tx, session_id)


def _model_context_activity(activity, task, run_state):
    profile = task.binding.config.model_profile
    receipt = activity.receipt
    input_tokens, output_tokens, cached = _model_metering(receipt.usage if receipt else None)
    limit = None
    window_source = profile.metadata_sources.get("context_window_tokens")
    max_output = activity.intent.arguments.get("max_output_tokens")
    if (window_source and window_source.kind in {"user", "service", "catalog", "observed"}
            and type(max_output) is int and 0 < max_output <= profile.max_output_tokens):
        limit = max(0, profile.input_budget(max_output)) or None
    return ContextActivity(id=activity.id, kind="model", state=activity.state, model=profile.display_name or profile.model_id,
        input_tokens=input_tokens, output_tokens=output_tokens, cached_input_tokens=cached,
        calculated_units=receipt.actual_units if receipt else None, input_limit=limit,
        compaction=activity.intent.origin == "runtime" and activity.intent.operation == "model.generate",
        cost_pending=True if model_cost_pending(activity.state, receipt is not None, run_state, task.state) else None)


def _context_file_ids(activity):
    args = activity.intent.arguments["arguments"]
    ids = args.get("resource_ids") if activity.intent.operation == "files.inspect_batch" else [args.get("resource_id")]
    return [id for id in ids if isinstance(id, str)] if isinstance(ids, list) else []


def _file_context_activity(tx, activity, resources, names, fixed_ids):
    from flowmate.tools.builtin import BatchResult

    kind = _CONTEXT_FILES[activity.intent.operation]
    receipt = activity.receipt
    ids = _context_file_ids(activity)
    result = receipt.result if receipt else None
    deps = {item.scope_id: item for item in activity.intent.dependencies}
    if receipt:
        deps.update({item.scope_id: item for item in receipt.source_dependencies})
        for item in receipt.source_observations:
            resource = resources.get(item.resource_id)
            if resource and resource.source_version == item.source_version and resource.id in deps:
                deps[resource.id] = deps[resource.id].model_copy(update={"epoch": resource.version})
    visible = {id for id in ids if id in names and (id in fixed_ids or activity.request_digest is not None)}
    try:
        check_scopes(tx, deps.values())
    except DomainError as error:
        if error.code != "scope_revoked":
            raise
        visible.clear()
    file_changed = bool(receipt and receipt.error in _FILE_VERSION_ERRORS)
    changed_ids = set()
    if file_changed and receipt.confirmed and isinstance(result, dict):
        changed_ids = {id for id in result.get("invalid_file_inputs", []) if id in visible}
    observations = {}
    if activity.state == "succeeded" and result is not None and any(id in visible for id in ids):
        if kind == "inspect":
            observations = {item.resource_id: item.model_dump(include={"size_bytes", "line_count"})
                for item in BatchResult.model_validate(result).items}
        elif ids:
            observations[ids[0]] = TextSlice.model_validate(result).model_dump(include={"start", "end", "total_chars"})
    return (ContextActivity(id=activity.id, kind=kind, state=activity.state, file_changed=file_changed,
        files=[ContextFile(name=names[id], changed=id in changed_ids, **observations.get(id, {})) for id in ids if id in visible],
        hidden_file_count=sum(id not in visible for id in ids)), changed_ids)


def session_context(tx, session_id, **paging):
    if session(tx, session_id).kind != "interaction":
        raise DomainError("not_found", "交互会话不存在")
    selected = tx.execute(
        "SELECT r.document FROM events e INDEXED BY events_session JOIN runs r ON r.id=e.run_id "
        "WHERE e.session_id=? AND e.seq=1 AND r.interaction_session_id=e.session_id "
        "AND r.execution_session_id=e.session_id AND r.kind IN ('user','follow_up') "
        "ORDER BY e.event_id DESC LIMIT 1", (session_id,)).fetchone()
    if selected is None:
        return SessionContext(round=None, files=[], hidden_file_count=0, history=None, latest_request=None,
            activities=Page[ContextActivity](items=[], watermark=watermark(tx)), units_per_currency=SCALE)
    run = RunSnapshot.model_validate_json(selected[0])
    page = _page(tx, ActivitySnapshot, f"context_activity:{run.id}",
        f"SELECT rowid AS event_id,document FROM activities WHERE run_id=? AND (({_DISPATCHED_MODEL}) "
        "OR json_extract(document,'$.intent.operation') IN ('files.inspect_batch','files.read_text'))",
        [run.id], keys=("event_id",), **paging)
    latest_row = tx.execute(
        "SELECT a.document FROM events e JOIN activities a "
        "ON a.id=json_extract(e.document,'$.payload.activities[0].id') "
        "WHERE e.run_id=? AND json_extract(e.document,'$.kind')='activity.dispatched' "
        "AND json_extract(e.document,'$.payload.activities[0].intent.kind')='model' "
        "AND json_extract(a.document,'$.request_digest') IS NOT NULL "
        "ORDER BY e.seq DESC LIMIT 1", (run.id,)).fetchone()
    if latest_row is None:
        latest_row = tx.execute(f"SELECT document FROM activities WHERE run_id=? AND {_DISPATCHED_MODEL} "
            "ORDER BY rowid DESC LIMIT 1", (run.id,)).fetchone()
    source_current = run_sources_current(tx, run)
    resource_ids = set(run.file_inputs)
    for activity in page.items:
        if activity.intent.kind == "tool":
            resource_ids.update(_context_file_ids(activity))
    resources, lineages = _fixed_file_resources(tx, run.workspace_id, session_id, resource_ids) if source_current else ({}, {})
    missing, _ = PolicyService._cover_resources(tx, run.workspace_id, session_id, lineages, "read", None)
    names = {id: resources[id].label for id in lineages.keys() - set(missing)}
    files = []
    fixed_ids = set()
    replacement_ids = set()
    attached = set(run.attached_file_ids if run.attached_file_ids is not None else run.file_inputs)
    for id, pin in run.file_inputs.items():
        if id not in names:
            continue
        resource = resources[id]
        if not _matches_file_pin(tx, run.workspace_id, session_id, resource, pin, run.config.model_profile.endpoint):
            del names[id]
            continue
        fixed_ids.add(id)
        changed = bool((resource.source_version is not None and resource.source_version != pin.source_version)
            or PolicyService.file_pin_invalid_reason(tx, id, pin))
        if changed:
            replacement_ids.add(id)
        files.append(ContextFile(name=names[id], origin="attached" if id in attached else "inherited", changed=changed))
    tasks = {}
    def project_model(item):
        if item.task_id not in tasks:
            tasks[item.task_id] = load(tx, TaskSnapshot, item.task_id)
        return _model_context_activity(item, tasks[item.task_id], run.state)

    activities = []
    for item in page.items:
        if item.intent.kind == "model":
            detail = project_model(item)
        else:
            detail, changed_ids = _file_context_activity(tx, item, resources, names, fixed_ids)
            replacement_ids.update(changed_ids)
        activities.append(detail)
    hidden = len(run.file_inputs) - len(files)
    changed = bool(replacement_ids or run.reason in _FILE_VERSION_ERRORS or any(item.file_changed for item in activities))
    return SessionContext(round=ContextRound(run_id=run.id, state=run.state, file_changed=True if changed else None,
        replacement_file_ids=sorted(replacement_ids),
        source_attention=not source_current or hidden > 0 or changed or run.reason in {"source_scope_changed", "scope_revoked"}),
        files=files, hidden_file_count=hidden, history=context_usage(tx, run),
        latest_request=project_model(ActivitySnapshot.model_validate_json(latest_row[0])) if latest_row else None,
        activities=Page[ContextActivity](items=activities, next_cursor=page.next_cursor, watermark=page.watermark),
        units_per_currency=SCALE)


def project_message_attachments(tx, workspace_id, session_id, views):
    ids = [view.id for view in views if view.role == "user" and view.origin == "conversation"]
    if not ids:
        return views
    # 用持久发布位置确认原始输入；补充要求和内部续轮不借用源 Run 的冻结文件。
    rows = tx.execute(
        "SELECT m.id,json_extract(r.document,'$.file_inputs') AS pins,"
        "json_extract(r.document,'$.attached_file_ids') AS attached FROM messages m "
        "JOIN runs r ON r.id=m.run_id AND r.root_task_id=m.task_id "
        "JOIN events e ON e.event_id=m.event_id AND e.seq=1 "
        "WHERE m.id IN (SELECT value FROM json_each(?)) AND m.event_index=0 AND m.execution_session_id=? "
        "AND r.workspace_id=? AND r.interaction_session_id=? AND r.kind='user' "
        "AND json_extract(e.document,'$.kind')='run.started' "
        "AND json_extract(r.document,'$.vision_source_run_id') IS NULL",
        (json.dumps(ids), session_id, workspace_id, session_id))
    inputs = {}
    for row in rows:
        pins = json.loads(row["pins"]) if row["pins"] is not None else {}
        attached = json.loads(row["attached"]) if row["attached"] is not None else pins
        inputs[row["id"]] = {id: pins[id] for id in attached if id in pins}
    resource_ids = {id for pins in inputs.values() for id in pins}
    if not resource_ids:
        return views
    resources, lineages = _fixed_file_resources(tx, workspace_id, session_id, resource_ids)
    grants = PolicyService.matching_resource_grants(tx, workspace_id, session_id, lineages, "read", None)
    attachments = {}
    for id, covering in grants:
        grant_ids = [grant.id for grant in covering]
        if grant_ids:
            resource = resources[id]
            identity = hashlib.sha256(resource.file_identity.encode()).hexdigest()
            attachments[id] = (identity, MessageAttachment(resource_id=id, name=resource.label,
                resource_lineage=lineages[id], read_grant_ids=grant_ids))
    return [view.model_copy(update={"attachments": [
        attachments[id][1] for id, pin in inputs[view.id].items()
        if id in attachments and attachments[id][0] == pin["file_identity"]]})
        if view.id in inputs else view for view in views]


def run_detail(tx, id):
    run = load(tx, RunSnapshot, id)
    current = run_sources_current(tx, run)
    if not current:
        run = run.model_copy(update={"output": None})
    budget = load(tx, BudgetSnapshot, run.budget_id)
    root = load(tx, TaskSnapshot, run.root_task_id)
    goal = run_goal(tx, run, root) if current else None
    pages = {kind: run_items(tx, id, kind) for kind in (
        "tasks", "activities", "messages", "artifacts", "questions", "approvals", "waits", "consumptions", "joins")}
    titles = {task.id: title for task in pages["tasks"].items if task.binding.agent_work is not None
              and (title := task_title(tx, task, task.binding.agent_work.goal))} if current else {}
    return RunDetail(run=run_view(tx, run), **pages, task_titles=titles,
        task_goal=goal, task_title=task_title(tx, root, goal) if current else None,
        file_names=fixed_file_names(tx, run) if current else {}, source_valid=current,
        budget=budget, cost_summary=cost_summary(tx, run, budget), context_usage=context_usage(tx, run), watermark=watermark(tx))


def task_detail(tx, id):
    task = load(tx, TaskSnapshot, id)
    run = load(tx, RunSnapshot, task.run_id)
    return task_view(tx, run.workspace_id, task)


def member_lanes(tx, run_id):
    """泳道来自实际AgentTask；工具沿真实parent边归属，顺序来自持久Activity。"""
    run = load(tx, RunSnapshot, run_id)
    tasks = {task.id: task for row in tx.execute(
        "SELECT document FROM tasks WHERE run_id=? ORDER BY rowid", (run_id,))
        for task in [TaskSnapshot.model_validate_json(row[0])]}
    lanes = {task.id: MemberLane(task=task_view(tx, run.workspace_id, task),
        profile=task.binding.config.agent_profile, activities=[], handoffs=[])
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
            lane.activities.append(activity_view(activity, tx=tx))
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
    sql=("SELECT r.id,r.document,t.document AS root_document, json_extract(s.document,'$.title') AS session_title, "
         "(SELECT state FROM delivery_outbox d WHERE json_extract(d.document,'$.result.run_id')=r.id "
         "ORDER BY source_event_id DESC LIMIT 1) AS delivery_state "
         "FROM runs r JOIN tasks t ON t.id=r.root_task_id LEFT JOIN sessions s ON s.id=r.interaction_session_id "
         "WHERE (? IS NULL OR r.workspace_id=?) "
         "AND (? IS NULL OR r.state=?) AND (? IS NULL OR r.kind=?)")
    def decode(row):
        run=RunSnapshot.model_validate_json(row["document"])
        invalid=tx.execute("SELECT document FROM session_inbox WHERE json_extract(document,'$.result.run_id')=?",
                          (run.id,)).fetchall()
        from flowmate.runtime.delivery import visible_entry
        current=run_sources_current(tx, run) and all(
            visible_entry(tx,SessionInboxEntry.model_validate_json(item[0])).source_valid for item in invalid)
        if not current:
            run=run.model_copy(update={"output":None})
        pending=tx.execute("SELECT count(*) FROM ("+_inbox_source()+") p WHERE p.run_id=?", (run.id,)).fetchone()[0]
        root=TaskSnapshot.model_validate_json(row["root_document"])
        goal = run_goal(tx, run, root) if current else None
        return TaskCenterItem(run=run,root=task_view(tx, run.workspace_id, root),pending_count=pending,
            delivery_state=row["delivery_state"],origin_task_id=root.origin_task_id,
            task_goal=goal, task_title=task_title(tx, root, goal) if current else None,
            session_title=row["session_title"], source_valid=current)
    page = _page(tx,TaskCenterItem,f"task_center:{workspace_id}:{state_filter}:{run_kind}",sql,
                 [workspace_id,workspace_id,state_filter,state_filter,run_kind,run_kind],decode=decode,**paging)
    runs = run_views(tx, [item.run for item in page.items])
    return page.model_copy(update={"items": [
        item if item.run is run else item.model_copy(update={"run": run})
        for item, run in zip(page.items, runs, strict=True)]})


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


def inbox(tx, *, policy, catalog=None, run_id=None, **paging):
    sql=("SELECT p.*, w.name AS workspace_name, json_extract(s.document,'$.title') AS session_title, "
         "r.document AS run_document, root.document AS root_document, member.document AS member_document "
         f"FROM ({_inbox_source()}) p JOIN runs r ON r.id=p.run_id "
         "JOIN tasks root ON root.id=r.root_task_id "
         "LEFT JOIN workspaces w ON w.id=p.workspace_id "
         "LEFT JOIN sessions s ON s.id=p.session_id AND s.workspace_id=p.workspace_id "
         "LEFT JOIN tasks member ON member.run_id=p.run_id AND member.id=CASE "
         "WHEN p.kind IN ('question','approval') THEN json_extract(p.document,'$.task_id') "
         "ELSE p.id END")
    goals = {}
    def decode(row):
        owner = {name: row[name] for name in (
            "id", "workspace_id", "session_id", "run_id", "workspace_name", "session_title")}
        run = RunSnapshot.model_validate_json(row["run_document"])
        member = TaskSnapshot.model_validate_json(row["member_document"]) if row["member_document"] else None
        goal_key = (run.id, member.id if member and member.binding.agent_work is not None else run.root_task_id)
        if row["kind"] != "delivery_failed" and goal_key not in goals:
            goals[goal_key] = None
            if run_sources_current(tx, run):
                task = member if member and member.id == goal_key[1] else TaskSnapshot.model_validate_json(row["root_document"])
                goals[goal_key] = run_goal(tx, run, task)
        owner["task_goal"] = goals.get(goal_key)
        if row["kind"] == "question":
            return InboxQuestion(**owner, question=Question.model_validate_json(row["document"]))
        if row["kind"] == "approval":
            return InboxApproval(**owner, approval=Approval.model_validate_json(row["document"]))
        condition = (TaskSnapshot.model_validate_json(row["document"]) if
            row["kind"] != "delivery_failed" and row["id"] != run.id else None)
        actions=[PendingActionCommand(kind="view_task",target_id=run.id,expected_version=None)]
        if run.state not in {"completed","failed","cancelled"}:
            actions.append(PendingActionCommand(kind="cancel_run",target_id=run.id,expected_version=run.version))
        if row["kind"] == "delivery_failed":
            from flowmate.runtime.delivery import visible_entry
            entry=visible_entry(tx,SessionInboxEntry.model_validate_json(row["document"]))
            if entry.source_valid:
                owner["task_goal"] = entry.task_name
                actions.append(PendingActionCommand(kind="retry_delivery",target_id=entry.id,expected_version=entry.version))
            else:
                owner["task_goal"] = None
            version,reason=entry.version,entry.last_error
        else:
            from flowmate.runtime.recovery import check_resume, resume_candidates
            retry_readonly = False
            try:
                _, retry_readonly = check_resume(tx, run, resume_candidates(tx, run), policy=policy,
                    catalog=catalog, now=policy.clock())
            except DomainError:
                pass
            else:
                actions.append(PendingActionCommand(kind="resume",target_id=run.id,expected_version=run.version))
            if tx.execute("SELECT 1 FROM activities WHERE run_id=? AND state='uncertain' AND "
                    "json_extract(document,'$.intent.operation')='artifacts.export'",(run.id,)).fetchone():
                actions.append(PendingActionCommand(kind="inspect_export_recovery",target_id=run.id,expected_version=None))
            version,reason = ((condition.version,condition.reason) if condition is not None else
                              (run.version,run.reason or "runtime_recovery"))
            if retry_readonly:
                reason = "mcp_query_uncertain_retry_available"
        return PendingAction(**owner,kind=row["kind"],task_id=condition.id if condition is not None else run.root_task_id,
            version=version,reason=reason,allowed_actions=actions)
    if run_id is not None:
        return _page(tx, InboxItem, f"global_inbox:{run_id}", f"SELECT * FROM ({sql}) WHERE run_id=?",
            [run_id], decode=decode, **paging)
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
        resources=resources(tx, id), grants=grants(tx, id), watermark=watermark(tx),
        recent_model_uses=_recent_model_uses(tx, id))


def workspace_items(tx, id, kind, **paging):
    workspace(tx, id)
    if kind == "runs":
        return _page(tx, RunSnapshot, f"active:{id}", "SELECT id,document FROM runs WHERE workspace_id=? AND state NOT IN "
                      "('completed','failed','cancelled')", [id],
                      decode=lambda row: run_view(tx, RunSnapshot.model_validate_json(row["document"])), **paging)
    model = {"approvals": Approval, "questions": Question}[kind]
    return _page(tx, model, f"pending_{kind}:{id}", f"SELECT q.id,q.document FROM {kind} q JOIN runs r ON r.id=q.run_id "
                  "WHERE r.workspace_id=? AND q.status='pending'", [id], **paging)


def trace(tx, run_id, **paging):
    load(tx, RunSnapshot, run_id)
    def decode(row):
        event = RunEvent.model_validate_json(json.dumps({**json.loads(row["document"]),
            "event_id": str(row["event_id"]), "seq": row["seq"]}))
        return TraceItem(event_id=event.event_id, seq=event.seq, kind=event.kind, task_id=event.task_id,
            activity_id=event.activity_id, activities=[
                activity_view(activity, tx=tx) for activity in getattr(event.payload, "activities", [])])
    return _page(tx, TraceItem, f"trace:{run_id}", "SELECT * FROM events WHERE run_id=? ORDER BY event_id", [run_id],
                 decode=decode, keys=("event_id",), **paging)
