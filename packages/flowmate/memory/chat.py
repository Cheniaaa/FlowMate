"""原聊天的候选读取：真实调用、成功回执与当前来源共同约束正文。"""

from pydantic import ValidationError

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    ActivitySnapshot,
    ModelMessage,
    ToolCallPart,
    ToolResultPart,
)
from flowmate.memory.contracts import MemoryProposal, MemoryProposalReceipt
from flowmate.policy.contracts import ToolInvocation
from flowmate.runtime.transitions import check_scopes


def candidate_for_receipt(memory, tx, id, receipt_message_id):
    def invalid():
        raise DomainError("memory_receipt_invalid", "记忆回执与原调用不匹配，请刷新对话")

    receipt_row = tx.execute("SELECT * FROM messages WHERE id=?", (receipt_message_id,)).fetchone()
    if receipt_row is None:
        invalid()
    receipt = ModelMessage.model_validate_json(receipt_row["document"])
    parts = [part for part in receipt.parts if isinstance(part, ToolResultPart)
        and isinstance(part.result, dict) and part.result.get("id") == id]
    if receipt.role != "tool" or len(parts) != 1 or parts[0].error is not None:
        invalid()
    part = parts[0]
    origin_row = tx.execute("SELECT * FROM messages WHERE id=?", (part.origin_message_id,)).fetchone()
    if origin_row is None or any(origin_row[key] != receipt_row[key] for key in
            ("run_id", "task_id", "execution_session_id")):
        invalid()
    origin = ModelMessage.model_validate_json(origin_row["document"])
    calls = [call for call in origin.parts if isinstance(call, ToolCallPart)
        and call.name == "memory.propose" and call.call_id == part.call_id]
    if origin.role != "assistant" or len(calls) != 1:
        invalid()
    model_row = tx.execute("SELECT document FROM activities WHERE id=?", (origin.activity_id,)).fetchone()
    if model_row is None:
        invalid()
    model = ActivitySnapshot.model_validate_json(model_row[0])
    if (model.run_id != origin_row["run_id"] or model.task_id != origin_row["task_id"]
            or model.intent.kind != "model" or model.state != "succeeded" or not model.content_committed
            or model.receipt is None or not model.receipt.confirmed or model.receipt.error is not None
            or model.receipt.result != origin.model_dump(mode="json")):
        invalid()
    activity_row = tx.execute("SELECT document FROM activities WHERE id=?", (receipt.activity_id,)).fetchone()
    if activity_row is None:
        invalid()
    activity = ActivitySnapshot.model_validate_json(activity_row[0])
    if (activity.run_id != receipt_row["run_id"] or activity.task_id != receipt_row["task_id"]
            or activity.intent.kind != "tool" or activity.intent.origin != "agent"
            or activity.intent.operation != "memory.propose" or activity.state != "succeeded"
            or not activity.content_committed or activity.receipt is None
            or not activity.receipt.confirmed or activity.receipt.error is not None
            or activity.receipt.result != part.result):
        invalid()
    try:
        value = MemoryProposalReceipt.model_validate(part.result)
        call = ToolInvocation.model_validate(activity.intent.arguments)
        proposal = MemoryProposal.model_validate(calls[0].arguments)
        actual = MemoryProposal.model_validate(call.arguments)
    except ValidationError:
        invalid()
    if (value.id != id or value.status != "candidate" or call.name != "memory.propose"
            or call.version != "1" or call.call_id != part.call_id or actual != proposal):
        invalid()
    record = memory._get(tx, id)
    candidate = next((item for item in memory.provider.using(tx).candidates_for(record.scope, record_id=id)
        if item.proposal_activity_id == activity.id), None)
    if (candidate is None or candidate.extraction_run_id != activity.run_id
            or candidate.extraction_task_id != activity.task_id or candidate.proposal_message_id != origin.id):
        invalid()
    if record.status != "candidate":
        raise DomainError("memory_candidate_resolved", "记忆候选已处理，请刷新当前状态")
    if value.revision != record.revision:
        raise DomainError("version_conflict", "记忆候选版本已改变")
    if (record.text != proposal.text or record.scope != proposal.scope or record.kind != proposal.kind
            or record.author_kind != proposal.author_kind or record.evidence != proposal.evidence
            or record.supersedes != proposal.record_id or record.expires_at != proposal.expires_at
            or candidate.base_record_id != proposal.record_id
            or candidate.expected_revision != proposal.expected_revision):
        invalid()
    if record.expires_at is not None and record.expires_at <= memory.clock():
        raise DomainError("memory_source_unavailable", "记忆候选已过期")
    check_scopes(tx, record.dependencies)
    for evidence in record.evidence:
        memory._evidence(tx, evidence)
    if candidate.base_record_id is not None:
        base = memory._get(tx, candidate.base_record_id)
        if base.revision != candidate.expected_revision:
            raise DomainError("version_conflict", "候选依据的记忆已被用户修订")
    return record
