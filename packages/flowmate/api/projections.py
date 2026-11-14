"""公开投影只包含前端事实，不包含执行参数/原生路径/私有状态。"""

from pydantic import TypeAdapter

from flowmate.api.contracts import (
    ActivityView,
    MessageView,
    PublicChange,
    PublicEvent,
    PublicLifecycleChange,
    PublicPolicyChange,
)
from flowmate.contracts.execution import JoinFact, RuntimeChange
from flowmate.policy.contracts import LifecycleChange, PolicyChange, ResourceRef

EVENT = TypeAdapter(PublicEvent)


def activity_view(activity):
    receipt = activity.receipt
    return ActivityView(id=activity.id, version=activity.version, run_id=activity.run_id, task_id=activity.task_id,
        state=activity.state, kind=activity.intent.kind, operation=activity.intent.operation,
        error=receipt.error if receipt else None, usage=receipt.usage if receipt else None,
        actual_units=receipt.actual_units if receipt else None, dependencies=activity.intent.dependencies)


def public_event(event):
    payload = event.payload
    if isinstance(payload, RuntimeChange):
        payload = PublicChange(runs=payload.runs, tasks=payload.tasks,
            activities=[activity_view(activity) for activity in payload.activities], budgets=payload.budgets,
            messages=[MessageView(**message.model_dump(), event_id=event.event_id, event_index=index)
                      for index, message in enumerate(payload.messages)],
            artifacts=payload.artifacts, questions=payload.questions, waits=payload.waits,
            consumptions=payload.consumptions,
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
