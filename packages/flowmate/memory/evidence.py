"""用户显式打开的依据节选；校验仍由 MemoryService 的单一来源入口完成。"""

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import ArtifactRef, RunSnapshot, TaskSnapshot, TextSlice
from flowmate.memory.contracts import MemoryEvidenceExcerpt
from flowmate.runtime.tasks import delivered_result, handle_for
from flowmate.runtime.transitions import check_scopes, context_for, load

EXCERPT_CHARS = 2000


def _public_message(tx, id):
    return tx.execute(
        "SELECT m.*,s.title FROM messages m JOIN runs r ON r.id=m.run_id "
        "JOIN tasks t ON t.id=m.task_id JOIN sessions s ON s.id=m.execution_session_id "
        "WHERE m.id=? AND s.kind='interaction' AND m.execution_session_id=r.interaction_session_id "
        "AND m.task_id=r.root_task_id", (id,),
    ).fetchone()


def _display_source(memory, tx, evidence):
    if evidence.source_kind == "user_edit":
        return True, "用户记忆编辑"
    if evidence.source_kind == "message":
        row = _public_message(tx, evidence.source_id)
        return (True, f"对话「{row['title']}」") if row is not None else (False, "任务内部消息来源")
    if evidence.source_kind == "event":
        # _evidence 对事件只允许 /payload/activities/*/receipt/result。
        # 现有 PublicEvent 只发布 ActivityView，不公开原始 receipt/result。
        return False, "工具活动依据（原始内部回执未公开）"
    row = tx.execute("SELECT document FROM artifacts WHERE id=?", (evidence.source_id,)).fetchone()
    if row is None or memory.artifacts is None:
        raise DomainError("invalid_evidence", "产物来源不可用")
    artifact = ArtifactRef.model_validate_json(row[0])
    task = load(tx, TaskSnapshot, artifact.task_id)
    run = load(tx, RunSnapshot, task.run_id)
    public = (task.id == run.root_task_id
        and task.binding.execution_session_id == run.interaction_session_id
        and run.interaction_session_id is not None)
    if not public:
        # 私有任务只允许已经明确交付的产物，不把内部全文变成管理页可见内容。
        if task.state not in {"completed", "failed", "cancelled"}:
            return False, "任务内部产物来源"
        result = delivered_result(tx, task, handle_for(tx, task), input_only=True)
        if artifact not in result.artifacts:
            return False, "任务内部产物来源"
    memory.artifacts.reference(context_for(tx, task.id), artifact.id, tx=tx, for_user=True,
        artifact_version=artifact.version, content_hash=artifact.content_hash)
    return True, "已公开的产物内容"


def read_excerpt(memory, tx, id, evidence_index, expected_revision, *, offset, receipt_message_id):
    record = memory._get(tx, id)
    if receipt_message_id is not None:
        from flowmate.memory.chat import candidate_for_receipt
        if _public_message(tx, receipt_message_id) is None:
            raise DomainError("memory_receipt_invalid", "依据只能从原聊天中仍可见的候选读取")
        record = candidate_for_receipt(memory, tx, id, receipt_message_id)
    if expected_revision != record.revision:
        raise DomainError("version_conflict", "记忆已修订，请重新核对当前记录与依据")
    if type(evidence_index) is not int or not 0 <= evidence_index < len(record.evidence):
        raise DomainError("invalid_evidence", "该记录没有此依据")
    if type(offset) is not int or offset < 0:
        raise DomainError("invalid_query", "依据节选位置须为非负整数")
    evidence = record.evidence[evidence_index]
    label = "原始依据"
    try:
        check_scopes(tx, record.dependencies)
        public, label = _display_source(memory, tx, evidence)
        if not public:
            return MemoryEvidenceExcerpt(record_id=record.id, record_revision=record.revision,
                evidence=evidence, source_label=label, excerpt=None, reason="source_not_public")
        _, quote = memory._evidence(tx, evidence, include_quote=True, record_id=record.id)
    except DomainError as error:
        if error.code not in {"invalid_evidence", "scope_revoked", "scope_mismatch", "not_found",
                "source_version_conflict", "grant_required", "artifact_missing", "artifact_corrupt",
                "artifact_not_found", "artifact_scope_mismatch", "task_result_unavailable",
                "context_authorization_required"}:
            raise
        return MemoryEvidenceExcerpt(record_id=record.id, record_revision=record.revision,
            evidence=evidence, source_label=label, excerpt=None, reason="source_unavailable")
    if offset > len(quote):
        raise DomainError("invalid_query", "依据节选位置超出原文")
    end = min(len(quote), offset + EXCERPT_CHARS)
    return MemoryEvidenceExcerpt(record_id=record.id, record_revision=record.revision,
        evidence=evidence, source_label=label,
        excerpt=TextSlice(text=quote[offset:end], start=offset, end=end,
            total_chars=len(quote), source_version=evidence.source_version))
