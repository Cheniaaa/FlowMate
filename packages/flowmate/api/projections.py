"""公开投影只包含前端事实，不包含执行参数/原生路径/私有状态。"""

import json

from pydantic import TypeAdapter

from flowmate.api.contracts import (
    ActivityView,
    AdmissionChange,
    DeliveryChange,
    MessageView,
    PublicChange,
    PublicEvent,
    PublicLifecycleChange,
    PublicPolicyChange,
)
from flowmate.api.summaries import EMBEDDING_OPERATIONS, project_budget
from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    JoinFact,
    RunSnapshot,
    RuntimeChange,
    ScopeDependency,
    SelectedFileVersion,
    TextPart,
    ToolCallPart,
    ToolResultPart,
)
from flowmate.policy.contracts import LifecycleChange, PolicyChange, ResourceRef
from flowmate.policy.service import PolicyService
from flowmate.runtime.transitions import load
from flowmate.skills.execution.contracts import ScriptExecutionResult, ScriptExecutionSummary

EVENT = TypeAdapter(PublicEvent)


def activity_view(activity, *, tx):
    receipt = activity.receipt
    recorded_dependencies = activity.intent.dependencies
    dependencies = _visible_dependencies(tx, activity.run_id, recorded_dependencies,
        _source_scopes(tx, {item.scope_id for item in recorded_dependencies}))
    script_execution = None
    if (dependencies == recorded_dependencies and activity.intent.operation == "skills.run_script"
            and receipt is not None and receipt.result is not None):
        result = ScriptExecutionResult.model_validate_json(json.dumps(receipt.result))
        script_execution = ScriptExecutionSummary.model_validate(
            result.model_dump(include=ScriptExecutionSummary.model_fields.keys()))
    return ActivityView(id=activity.id, version=activity.version, run_id=activity.run_id, task_id=activity.task_id,
        state=activity.state, kind=activity.intent.kind, operation=activity.intent.operation,
        error=receipt.error if receipt else None, usage=receipt.usage if receipt else None,
        actual_units=receipt.actual_units if receipt else None, dependencies=dependencies,
        script_execution=script_execution)


def _stale_file_sources(tx, run_ids):
    """同一页只复核一次每个固定文件版本。"""
    if not run_ids:
        return {}
    invalid, checked = {}, {}
    for row in tx.execute(
        "SELECT r.id, pin.key, pin.value FROM runs r JOIN json_each(r.document,'$.file_inputs') pin "
        "WHERE r.id IN (SELECT value FROM json_each(?))",
        (json.dumps(list(run_ids)),),
    ):
        run_id, resource_id, document = row
        pin = SelectedFileVersion.model_validate_json(document)
        key = (resource_id, pin.file_identity, pin.source_version)
        if key not in checked:
            checked[key] = PolicyService.file_pin_invalid_reason(tx, resource_id, pin)
        if checked[key]:
            invalid.setdefault(run_id, set()).add(resource_id)
    return invalid


def _uses_stale_file(tx, run_id, dependencies, stale_files):
    if not stale_files:
        return False
    try:
        resources = PolicyService.resource_closure(tx, dependencies, source_run_id=run_id)
    except DomainError as error:
        if error.code not in {"outside_run_scope", "not_found"}:
            raise
        return True
    return not stale_files.isdisjoint(resources)


def _source_scopes(tx, ids):
    return {row["id"]: (row["epoch"], row["status"], row["kind"]) for row in tx.execute(
        "SELECT id, epoch, status, kind FROM scopes WHERE id IN (SELECT value FROM json_each(?))",
        (json.dumps(list(ids)),))} if tx is not None and ids else {}


def _visible_dependencies(tx, run_id, dependencies, scopes, *, stale_files=None):
    current = [item for item in dependencies if scopes.get(item.scope_id, ())[:2] == (item.epoch, "active")]
    resource_ids = {item.scope_id for item in dependencies
        if scopes.get(item.scope_id, (None, None, None))[2] == "resource"}
    current_ids = {item.scope_id for item in current}
    grant_ids = {item.scope_id for item in current if scopes[item.scope_id][2] == "grant"}
    if not (resource_ids & current_ids or grant_ids):
        return current

    from flowmate.api.queries import hidden_file_dependency_ids

    if stale_files is None:
        stale_files = _stale_file_sources(tx, {run_id}).get(run_id, set())
    unavailable_files = stale_files | (resource_ids - current_ids)
    hidden = hidden_file_dependency_ids(tx, load(tx, RunSnapshot, run_id), resource_ids, grant_ids, unavailable_files)
    return [item for item in current if item.scope_id not in hidden]


def project_message_sources(tx, messages):
    ids = {dependency.scope_id for message in messages for dependency in message.source_dependencies}
    scopes = _source_scopes(tx, ids)
    file_runs = {message.run_id for message in messages if any(
        scopes.get(dep.scope_id, (None, None, None))[2] in {"resource", "grant"}
        for dep in message.source_dependencies)}
    stale = _stale_file_sources(tx, file_runs)
    projected = []
    for message in messages:
        recorded_dependencies = message.source_dependencies
        stale_files = stale.get(message.run_id, set())
        dependencies = _visible_dependencies(tx, message.run_id, recorded_dependencies, scopes, stale_files=stale_files)
        update = {"source_dependencies": dependencies} if dependencies != recorded_dependencies else {}
        if message.origin == "background_report" or (message.role != "user" and recorded_dependencies):
            valid = dependencies == recorded_dependencies and not _uses_stale_file(
                tx, message.run_id, recorded_dependencies, stale_files)
            update["source_valid"] = valid
            if not valid:
                update.update(parts=[], private_ref=None)
        projected.append(message.model_copy(update=update) if update else message)
    return projected


def project_run_outputs(tx, runs):
    # 正式答复也可能由会话从 RunOutput 读取，按根任务固定的输出依赖复核。
    ids = {run.root_task_id for run in runs if run.output is not None}
    if not ids:
        return runs
    sources = {row["root_task_id"]: [ScopeDependency.model_validate(item)
        for column in ("run_scopes", "output_scopes") for item in json.loads(row[column] or "[]")]
        for row in tx.execute(
            "SELECT r.root_task_id, json_extract(r.document,'$.scope_dependencies') AS run_scopes, "
            "json_extract(c.document,'$.output_dependencies') AS output_scopes "
            "FROM json_each(?) selected JOIN runs r ON r.root_task_id=selected.value "
            "LEFT JOIN checkpoints c ON c.task_id=r.root_task_id",
            (json.dumps(list(ids)),))}
    scopes = _source_scopes(tx, {dep.scope_id for dependencies in sources.values() for dep in dependencies})
    stale = _stale_file_sources(tx, {run.id for run in runs if run.output is not None and run.file_inputs})
    invalid = ids - sources.keys()
    for run in runs:
        if run.output is None or run.root_task_id in invalid:
            continue
        dependencies = sources[run.root_task_id]
        stale_files = stale.get(run.id, set())
        if (_visible_dependencies(tx, run.id, dependencies, scopes, stale_files=stale_files) != dependencies
                or _uses_stale_file(tx, run.id, dependencies, stale_files)):
            invalid.add(run.root_task_id)
    return [run.model_copy(update={"output": None}) if run.root_task_id in invalid else run for run in runs]


def _project_file_inputs(tx, workspace_id, session_id, config, sources, pins):
    from flowmate.api.queries import visible_file_inputs

    visible = (visible_file_inputs(tx, workspace_id, session_id, pins, config.model_profile.endpoint)
               if tx is not None else {})
    hidden = pins.keys() - visible.keys()
    if hidden:
        sources = sources.model_copy(update={
            "resource_ids": [id for id in sources.resource_ids if id not in hidden],
            "excluded_source_ids": [id for id in sources.excluded_source_ids if id not in hidden],
        })
    # 冻结授权是执行围栏，公开视图只需文件身份和内容版本。
    return sources, {id: pin.model_copy(update={"inheritance_grants": None})
                     for id, pin in pins.items() if id in visible}


def run_views(tx, runs):
    if tx is None:
        runs = [run.model_copy(update={"output": None}) if run.output is not None else run for run in runs]
    else:
        runs = project_run_outputs(tx, runs)
    return [_run_file_view(tx, run) for run in runs]


def run_view(tx, run):
    return run_views(tx, [run])[0]


def _run_file_view(tx, run):
    if not run.file_inputs:
        return run
    sources, pins = _project_file_inputs(tx, run.workspace_id, run.interaction_session_id, run.config,
        run.sources, run.file_inputs)
    attached = run.attached_file_ids
    return run.model_copy(update={"sources": sources, "file_inputs": pins,
        "attached_file_ids": [id for id in attached if id in pins] if attached is not None else None})


def task_view(tx, workspace_id, task):
    binding = task.binding
    if not binding.file_inputs:
        return task
    sources, pins = _project_file_inputs(tx, workspace_id, binding.interaction_session_id, binding.config,
        binding.sources, binding.file_inputs)
    work = binding.agent_work
    hidden = binding.file_inputs.keys() - pins.keys()
    if work is not None and hidden.intersection(work.input_refs):
        work = work.model_copy(update={"input_refs": [id for id in work.input_refs if id not in hidden]})
    return task.model_copy(update={"binding": binding.model_copy(update={
        "sources": sources, "file_inputs": pins, "agent_work": work})})


def pending_command_view(tx, workspace_id, pending):
    if not (pending.file_inputs or pending.session_file_predecessors or pending.start.session_file_adoptions):
        return pending
    sources, pins = _project_file_inputs(tx, workspace_id, pending.session_id, pending.config,
        pending.start.sources, pending.file_inputs)
    return pending.model_copy(update={"file_inputs": pins, "start": pending.start.model_copy(update={
        "sources": sources, "session_file_adoptions": {
            id: version for id, version in pending.start.session_file_adoptions.items() if id in pins}}),
        "session_file_predecessors": {
            id: command_id for id, command_id in pending.session_file_predecessors.items() if id in pins}})


def message_view(message, *, run_id, event_id, event_index, tx):
    if message.origin == "task_result":
        message = message.model_copy(update={"parts": [], "source_dependencies": [], "private_ref": None})
    if tx is not None and message.role == "tool" and message.activity_id is not None:
        from flowmate.runtime.recovery import requery_authorization

        if requery_authorization(tx, run_id, message.activity_id):
            message = message.model_copy(update={"parts": [
                part.model_copy(update={"result": {**(part.result or {}), "mcp_requery": True}})
                if isinstance(part, ToolResultPart) else part for part in message.parts]})
    if message.role == "assistant" and any(isinstance(part, TextPart) for part in message.parts):
        finish = next((part for part in message.parts
                       if isinstance(part, ToolCallPart) and part.name == "run.finish"), None)
        # 用回执检查点对应的原请求边界核对补充要求与直属交付。
        if finish is not None and tx is not None and tx.execute(
                "SELECT 1 FROM messages candidate JOIN events source ON source.event_id=candidate.event_id "
                "WHERE candidate.id=? AND (EXISTS (SELECT 1 FROM messages steering "
                "WHERE steering.run_id=candidate.run_id AND steering.task_id=candidate.task_id "
                "AND steering.event_id<candidate.event_id AND json_extract(steering.document,'$.origin')='steering' "
                "AND NOT EXISTS (SELECT 1 FROM json_each(source.document, "
                "'$.payload.checkpoints[0].consumed_steering_ids') consumed WHERE consumed.value=steering.id)) "
                "OR EXISTS (SELECT 1 FROM tasks child "
                "LEFT JOIN consumptions receipt ON receipt.consumer_task_id=candidate.task_id "
                "AND receipt.execution_session_id=candidate.execution_session_id AND receipt.target_task_id=child.id "
                "AND receipt.result_version=json_extract(child.document,'$.result_version') "
                "WHERE child.run_id=candidate.run_id AND child.parent_task_id=candidate.task_id "
                "AND json_extract(child.document,'$.created_seq')<=source.seq "
                "AND (receipt.id IS NULL OR json_extract(receipt.document,'$.message_boundary') >= "
                "json_extract(source.document,'$.payload.checkpoints[0].context_manifest.model_message_boundary') "
                "OR (child.state IN ('failed','cancelled') AND NOT EXISTS "
                "(SELECT 1 FROM json_each(?, '$.output.handled_failures') handled "
                "WHERE CASE WHEN handled.type='object' THEN json_extract(handled.value,'$.task_id')=child.id "
                "AND json_extract(handled.value,'$.result_version')=receipt.result_version ELSE 0 END))))) "
                "LIMIT 1", (message.id, json.dumps(finish.arguments))).fetchone():
            message = message.model_copy(update={
                "parts": [part for part in message.parts if not isinstance(part, TextPart)]})
    tool_operation = None
    if tx is not None and message.role == "tool" and message.activity_id is not None:
        source = tx.execute("SELECT json_extract(document,'$.intent.operation') FROM activities "
            "WHERE id=? AND run_id=? AND json_extract(document,'$.intent.kind')='tool'",
            (message.activity_id, run_id)).fetchone()
        if source is not None:
            tool_operation = source[0]
    return MessageView(**message.model_dump(), run_id=run_id, event_id=event_id, event_index=event_index,
        tool_operation=tool_operation)


def public_event(event, execution_session_id, *, tx=None):
    payload = event.payload
    if event.kind == "delivery.changed":
        from flowmate.runtime.delivery import visible_entry
        payload=DeliveryChange(deliveries=[visible_entry(tx,entry) for entry in payload.deliveries])
    elif event.kind == "admission.stopped":
        payload=AdmissionChange(admission_fences=payload.admission_fences)
    elif isinstance(payload, RuntimeChange):
        visible_messages = execution_session_id is not None and execution_session_id == event.session_id
        messages = [message_view(message, run_id=event.run_id, event_id=event.event_id, event_index=index, tx=tx)
                    for index, message in enumerate(payload.messages) if visible_messages]
        messages = project_message_sources(tx, messages)
        message_watermark = None
        if tx is not None and messages:
            from flowmate.api.queries import project_message_attachments, watermark

            if event.kind == "run.started":
                messages = project_message_attachments(tx, event.workspace_id, event.session_id, messages)
            # 补读时的授权可能晚于消息发布位置。游标仍使用原 event_id。
            message_watermark = watermark(tx)
        chat_model_use = None
        if (tx is not None and event.kind == "activity.dispatched"
                and payload.activities[0].intent.kind == "model"
                and payload.activities[0].intent.operation not in EMBEDDING_OPERATIONS):
            from flowmate.api.queries import chat_model_use_at

            chat_model_use = chat_model_use_at(tx, event.event_id)
        payload = PublicChange(runs=run_views(tx, payload.runs),
            tasks=[task_view(tx, event.workspace_id, task) for task in payload.tasks],
            activities=[activity_view(activity, tx=tx) for activity in payload.activities],
            budgets=[project_budget(tx, budget) for budget in payload.budgets],
            messages=messages, message_watermark=message_watermark,
            artifacts=payload.artifacts, questions=payload.questions, waits=payload.waits,
            consumptions=payload.consumptions,
            pending_commands=[pending_command_view(tx, event.workspace_id, item) for item in payload.pending_commands],
            follow_up_intents=payload.follow_up_intents, chat_model_use=chat_model_use,
            joins=[JoinFact(**join.model_dump(), event_id=event.event_id) for join in payload.joins])
    elif isinstance(payload, PolicyChange):
        payload = PublicPolicyChange(resources=[ResourceRef.model_validate(resource.model_dump(
            include=ResourceRef.model_fields.keys())) for resource in payload.resources],
            grants=payload.grants, approvals=payload.approvals)
    elif isinstance(payload, LifecycleChange):
        payload = PublicLifecycleChange(scopes=payload.scopes, deletions=payload.deletions)
    value = event.model_dump()
    value["payload"] = payload.model_dump()
    return EVENT.validate_python(value)
