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
from flowmate.contracts.execution import JoinFact, RuntimeChange
from flowmate.policy.contracts import LifecycleChange, PolicyChange, ResourceRef
from flowmate.skills.execution.contracts import ScriptExecutionResult, ScriptExecutionSummary

EVENT = TypeAdapter(PublicEvent)


def activity_view(activity):
    receipt = activity.receipt
    script_execution = None
    if activity.intent.operation == "skills.run_script" and receipt is not None and receipt.result is not None:
        result = ScriptExecutionResult.model_validate_json(json.dumps(receipt.result))
        script_execution = ScriptExecutionSummary.model_validate(
            result.model_dump(include=ScriptExecutionSummary.model_fields.keys()))
    return ActivityView(id=activity.id, version=activity.version, run_id=activity.run_id, task_id=activity.task_id,
        state=activity.state, kind=activity.intent.kind, operation=activity.intent.operation,
        error=receipt.error if receipt else None, usage=receipt.usage if receipt else None,
        actual_units=receipt.actual_units if receipt else None, dependencies=activity.intent.dependencies,
        script_execution=script_execution)


def public_event(event, execution_session_id, *, tx=None):
    payload = event.payload
    if event.kind == "delivery.changed":
        from flowmate.runtime.delivery import visible_entry
        payload=DeliveryChange(deliveries=[visible_entry(tx,entry) for entry in payload.deliveries])
    elif event.kind == "admission.stopped":
        payload=AdmissionChange(admission_fences=payload.admission_fences)
    elif isinstance(payload, RuntimeChange):
        visible_messages = execution_session_id is not None and execution_session_id == event.session_id
        payload = PublicChange(runs=payload.runs, tasks=payload.tasks,
            activities=[activity_view(activity) for activity in payload.activities], budgets=payload.budgets,
            messages=[MessageView(**message.model_dump(), event_id=event.event_id, event_index=index)
                      for index, message in enumerate(payload.messages) if visible_messages],
            artifacts=payload.artifacts, questions=payload.questions, waits=payload.waits,
            consumptions=payload.consumptions, pending_commands=payload.pending_commands,
            follow_up_intents=payload.follow_up_intents,
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
