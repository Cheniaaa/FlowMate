"""真实回执、实际模型输入与不可变快照共同约束知识引用。"""

import bisect
import json
from uuid import UUID, uuid5

from pydantic import ValidationError

from flowmate.artifacts.tool_results import tool_result_bytes
from flowmate.contracts.base import DomainError, Id
from flowmate.contracts.execution import (
    ActivitySnapshot,
    Checkpoint,
    ExecutionContext,
    ModelMessage,
    ScopeDependency,
    TaskResult,
    TaskSnapshot,
    ToolResultPart,
)
from flowmate.contracts.scopes import ScopeRef
from flowmate.knowledge.contracts import (
    Evidence,
    EvidencePage,
    KnowledgeResult,
    KnowledgeSource,
    SourceVersion,
)
from flowmate.policy.contracts import ToolInvocation
from flowmate.policy.service import _scope
from flowmate.runtime.transitions import check_scopes, context_for, load


def _invalid():
    raise DomainError("knowledge_evidence_invalid", "知识证据与可信来源不一致")


def _registered(tx, workspace_id, evidence_id):
    row = tx.execute("SELECT * FROM knowledge_evidence WHERE id=? AND workspace_id=?",
        (evidence_id, workspace_id)).fetchone()
    if row is None:
        raise DomainError("knowledge_evidence_missing", "项目知识证据不存在")
    evidence = Evidence.model_validate_json(row["document"])
    if (row["id"], row["source_id"], row["source_version"]) != (
            evidence.id, evidence.source_id, evidence.source_version):
        _invalid()
    return evidence, row["activity_id"]


def _successful(activity):
    receipt = activity.receipt
    return (activity.state == "succeeded" and activity.content_committed and receipt is not None
        and receipt.confirmed and receipt.error is None
        and (receipt.activity_id, receipt.attempt_id) == (activity.id, activity.attempt_id))


def _prefix(evidence, size):
    text = evidence.excerpt[:size]
    return evidence.model_copy(update={"excerpt": text, "locator": evidence.locator.model_copy(update={
        "end_char": evidence.locator.start_char + len(text),
        "end_line": evidence.locator.start_line + max(1, len(text.splitlines())) - 1,
    })})


def _is_projection(original, shown):
    return (original.model_dump(exclude={"excerpt", "locator"}) == shown.model_dump(exclude={"excerpt", "locator"})
        and original.excerpt.startswith(shown.excerpt) and bool(shown.excerpt)
        and _prefix(original, len(shown.excerpt)) == shown)


def _result(value):
    try:
        return KnowledgeResult.model_validate(value)
    except ValidationError:
        _invalid()


def _committed_tool(tx, activity_id, evidence):
    activity = load(tx, ActivitySnapshot, activity_id)
    if (activity.intent.kind == "tool" and activity.intent.operation in {"knowledge.search", "knowledge.read"}
            and _successful(activity) and any(
                _is_projection(evidence, item) for item in _result(activity.receipt.result).evidence
                if item.id == evidence.id)):
        return activity
    raise DomainError("knowledge_evidence_not_visible", "知识工具回执尚未提交")


def _tool_evidence(tx, ctx, message):
    if message.activity_id is None:
        return {}
    activity = load(tx, ActivitySnapshot, message.activity_id)
    if (activity.intent.kind != "tool" or activity.intent.operation not in {"knowledge.search", "knowledge.read"}
            or not _successful(activity)):
        return {}
    call = ToolInvocation.model_validate(activity.intent.arguments)
    actual = _result(activity.receipt.result)
    originals = {item.id: item for item in actual.evidence}
    visible = {}
    for part in message.parts:
        if not isinstance(part, ToolResultPart) or part.error is not None:
            continue
        if part.call_id != call.call_id:
            _invalid()
        if not isinstance(part.result, dict) or not part.result.get("evidence"):
            continue
        for shown in _result(part.result).evidence:
            registered, _ = _registered(tx, ctx.workspace_id, shown.id)
            if (shown.id not in originals or not _is_projection(registered, originals[shown.id])
                    or not _is_projection(originals[shown.id], shown)):
                _invalid()
            visible[shown.id] = shown
    return visible


def _latest_visible_tx(tx, ctx):
    manifest = load(tx, Checkpoint, ctx.task_id).context_manifest
    allowed = set(manifest.get("knowledge_evidence_ids", []))
    if not allowed:
        return {}
    row = tx.execute("SELECT document FROM activities WHERE task_id=? AND state='succeeded' "
        "AND json_extract(document,'$.intent.kind')='model' "
        "AND json_extract(document,'$.intent.origin')!='runtime' ORDER BY rowid DESC LIMIT 1",
        (ctx.task_id,)).fetchone()
    if row is None:
        return {}
    activity = ActivitySnapshot.model_validate_json(row[0])
    if not _successful(activity):
        return {}
    response = ModelMessage.model_validate(activity.receipt.result)
    if response.activity_id != activity.id:
        _invalid()
    persisted = tx.execute("SELECT document FROM messages WHERE id=? AND task_id=?",
        (response.id, ctx.task_id)).fetchone()
    if persisted is None or ModelMessage.model_validate_json(persisted[0]) != response:
        _invalid()
    messages = [ModelMessage.model_validate(value) for value in activity.intent.arguments["messages"]]
    return {id: evidence for id, evidence in visible_evidence_tx(tx, ctx, messages).items() if id in allowed}


def delivery_message_id(ctx, message_id):
    return str(uuid5(UUID(message_id), f"context.knowledge_delivery:{ctx.task_id}"))


def _delivered_evidence(tx, ctx, message, *, references=False):
    from flowmate.context.compaction import ContextCompaction
    from flowmate.runtime.tasks import delivered_result

    ContextCompaction._result_consumptions(tx, ctx, [message])
    delivered = TaskResult.model_validate_json(message.parts[0].text)
    task = load(tx, TaskSnapshot, delivered.handle.task_id)
    if delivered_result(tx, task, delivered.handle).result != delivered.result:
        _invalid()
    if task.kind != "agent":
        if references:
            return {}
        # 工具成员的完整知识结果仍沿实际工具回执核验，不扫描其余私有内容。
        rows = tx.execute("SELECT document FROM messages WHERE task_id=? "
            "AND json_extract(document,'$.role')='tool' ORDER BY rowid DESC LIMIT 1", (task.id,)).fetchone()
        if rows is None:
            return {}
        original = ModelMessage.model_validate_json(rows[0])
        if not any(isinstance(part, ToolResultPart) and part.result == delivered.result for part in original.parts):
            return {}
        return _tool_evidence(tx, ctx, original)
    if not references:
        # 成员的自由文字和CitationRef没有原文；只在实际派生资料消息中授予可见资格。
        return {}
    output = load(tx, Checkpoint, task.id).output
    citations = output.citations if output is not None else []
    if not citations:
        return {}
    seen = _latest_visible_tx(tx, context_for(tx, task.id))
    if any(item.evidence_id not in seen for item in citations):
        raise DomainError("knowledge_evidence_not_visible", "成员交付引用了未实际提供的知识证据")
    return {item.evidence_id: seen[item.evidence_id] for item in citations}


def _delivery_source_ctx(tx, ctx, message, source_run_id, source_task_id):
    # 与Builder历史选择保持一致：当前Task，或同会话较早Run的Agent根任务。
    row = tx.execute(
        "SELECT m.document FROM messages m JOIN runs r ON r.id=m.run_id "
        "JOIN tasks t ON t.id=m.task_id JOIN runs receiver ON receiver.id=? "
        "WHERE m.id=? AND m.run_id=? AND m.task_id=? "
        "AND r.workspace_id=? AND m.execution_session_id=? "
        "AND ((r.id=receiver.id AND t.id=?) OR (receiver.kind<>'follow_up' "
        "AND r.rowid<receiver.rowid AND t.id=r.root_task_id AND t.parent_task_id IS NULL "
        "AND json_extract(t.document,'$.kind')='agent'))",
        (ctx.run_id, message.id, source_run_id, source_task_id,
            ctx.workspace_id, ctx.session_id, ctx.task_id)).fetchone()
    if row is None or ModelMessage.model_validate_json(row[0]) != message:
        _invalid()
    return context_for(tx, source_task_id)


def delivery_evidence_tx(tx, ctx, message, *, source_run_id=None, source_task_id=None):
    """来源身份核对原Task消费；ctx仍是本次资料接收方，不继承旧Task授权。"""
    source = _delivery_source_ctx(tx, ctx, message,
        source_run_id or ctx.run_id, source_task_id or ctx.task_id)
    return _delivered_evidence(tx, source, message, references=True)


def knowledge_versions_tx(tx, ctx, evidence):
    versions = {}
    for item in evidence.values():
        row = tx.execute("SELECT document FROM knowledge_sources WHERE id=? AND workspace_id=?",
            (item.source_id, ctx.workspace_id)).fetchone()
        if row is None:
            raise DomainError("knowledge_evidence_missing", "项目知识来源不存在")
        source = KnowledgeSource.model_validate_json(row[0])
        if source.active_version is not None and source.active_version != item.source_version:
            versions[(item.source_id, item.source_version)] = {
                "source_id": item.source_id, "evidence_version": item.source_version,
                "current_version": source.active_version,
            }
    return list(versions.values())


def summary_evidence_tx(tx, ctx, record):
    """仅沿已提交摘要引用的真实源消息取证；summary中的UUID不是证据授权。"""
    from flowmate.context.compaction import _digest

    messages = []
    for message_id in record.summary.evidence_refs:
        row = tx.execute("SELECT document FROM messages WHERE id=? AND task_id=?",
            (message_id, ctx.task_id)).fetchone()
        if row is None:
            _invalid()
        message = ModelMessage.model_validate_json(row[0])
        if record.source_hashes.get(message_id) != _digest(message.model_dump(mode="json")):
            _invalid()
        messages.append(message)
    evidence = visible_evidence_tx(tx, ctx, messages, summaries={})
    for message in messages:
        if message.origin == "task_result":
            evidence.update(delivery_evidence_tx(tx, ctx, message))
    return evidence


def visible_evidence_tx(tx, ctx, messages, *, summaries=None):
    """消费Builder最终选入或实际Model Activity中的结构化消息，不扫描任意正文。"""
    if summaries is None:
        from flowmate.context.summary_store import CommittedContextSummary

        records = [CommittedContextSummary.model_validate_json(row[0]) for row in tx.execute(
            "SELECT document FROM context_summaries WHERE task_id=?", (ctx.task_id,))]
        summaries = {str(uuid5(UUID(record.id), "context.summary")): record for record in records}
    visible = {}
    deliveries = {delivery_message_id(ctx, message.id): message
        for message in messages if message.origin == "task_result"}
    for message in messages:
        if message.id in deliveries:
            origin = deliveries[message.id]
            row = tx.execute("SELECT run_id,task_id FROM messages WHERE id=?", (origin.id,)).fetchone()
            if row is None:
                _invalid()
            expected = delivery_evidence_tx(tx, ctx, origin,
                source_run_id=row["run_id"], source_task_id=row["task_id"])
            value = json.loads(message.parts[0].text)
            if value.get("knowledge_delivery") != origin.id:
                _invalid()
            for item in _result(value["result"]).evidence:
                if item.id not in expected or not _is_projection(expected[item.id], item):
                    _invalid()
                visible[item.id] = item
            continue
        if message.id in summaries:
            record = summaries[message.id]
            expected = summary_evidence_tx(tx, ctx, record)
            value = json.loads(message.parts[0].text)
            if (value.get("context_summary") != record.summary.model_dump(mode="json")
                    or value.get("knowledge_evidence", []) != [
                        item.model_dump(mode="json") for item in expected.values()]):
                _invalid()
            visible.update(expected)
            continue
        if message.role != "tool" and message.origin != "task_result":
            continue
        row = tx.execute("SELECT document,task_id,run_id FROM messages WHERE id=?", (message.id,)).fetchone()
        if row is None or ModelMessage.model_validate_json(row["document"]) != message:
            _invalid()
        if message.role == "tool":
            if message.activity_id is not None:
                activity = load(tx, ActivitySnapshot, message.activity_id)
                if (activity.task_id, activity.run_id) != (row["task_id"], row["run_id"]):
                    _invalid()
            visible.update(_tool_evidence(tx, ctx, message))
        elif message.origin == "task_result":
            source = _delivery_source_ctx(tx, ctx, message, row["run_id"], row["task_id"])
            visible.update(_delivered_evidence(tx, source, message))
    return visible


class EvidenceService:
    def __init__(self, knowledge):
        self.knowledge = knowledge

    def register(self, tx, ctx: ExecutionContext, evidence: list[Evidence]) -> None:
        if context_for(tx, ctx.task_id) != ctx.model_copy(update={"activity_id": None}):
            raise DomainError("owner_mismatch", "证据注册不属于真实任务")
        if ctx.activity_id is None:
            _invalid()
        activity = load(tx, ActivitySnapshot, ctx.activity_id)
        if ((activity.run_id, activity.task_id) != (ctx.run_id, ctx.task_id)
                or activity.intent.kind != "tool"
                or activity.intent.operation not in {"knowledge.search", "knowledge.read"}):
            _invalid()
        for item in evidence:
            self._snapshot_tx(tx, ctx.workspace_id, item)
            previous = tx.execute("SELECT workspace_id,document FROM knowledge_evidence WHERE id=?",
                (item.id,)).fetchone()
            if previous is not None:
                if previous["workspace_id"] != ctx.workspace_id or Evidence.model_validate_json(previous["document"]) != item:
                    raise DomainError("knowledge_evidence_conflict", "同一证据身份不能替换原始内容")
                continue
            tx.execute("INSERT INTO knowledge_evidence VALUES (?,?,?,?,?,?)",
                (item.id, ctx.workspace_id, item.source_id, item.source_version, activity.id, item.model_dump_json()))

    def resolve(self, ctx: ExecutionContext, evidence_ids: list[Id]) -> list[Evidence]:
        if not evidence_ids:
            return []
        with self.knowledge.store.transaction(write=False) as tx:
            if context_for(tx, ctx.task_id) != ctx.model_copy(update={"activity_id": None}):
                raise DomainError("owner_mismatch", "引用不属于真实任务")
            visible = _latest_visible_tx(tx, ctx)
            if any(id not in visible for id in evidence_ids):
                raise DomainError("knowledge_evidence_not_visible", "只能引用本任务实际模型上下文中可见的证据")
            task = load(tx, TaskSnapshot, ctx.task_id)
            resolved = {}
            for id in dict.fromkeys(evidence_ids):
                registered, activity_id = _registered(tx, ctx.workspace_id, id)
                self._snapshot_tx(tx, ctx.workspace_id, registered)
                activity = _committed_tool(tx, activity_id, registered)
                check_scopes(tx, [*activity.intent.dependencies, *activity.receipt.source_dependencies])
                origin = context_for(tx, activity.task_id)
                execution_scopes = {origin.workspace_id, origin.session_id, origin.interaction_session_id}
                # 原回执围栏仍须有效；接收用途按当前ctx核验，不把旧私有会话授予新Run。
                dependencies = [*(item for item in activity.receipt.source_dependencies
                    if item.scope_id not in execution_scopes),
                    ScopeDependency(scope_id=registered.source_id, epoch=tx.execute(
                        "SELECT epoch FROM scopes WHERE id=?", (registered.source_id,)).fetchone()[0])]
                self.knowledge.policy.check_run_sources(tx, ctx, dependencies)
                for purpose, destination in [("read", None), ("model_send", task.binding.config.model_profile.endpoint)]:
                    if not self.knowledge.policy.check_tx(tx, ctx, dependencies, purpose, destination).allowed:
                        raise DomainError("grant_required", "知识证据缺少当前用途授权")
                resolved[id] = registered
            # 可见资格按实际投影核验；解析回完整不可变片段，供模型继续精读。
            return [resolved[id] for id in evidence_ids]

    def read_for_user(
        self, workspace_id: Id, evidence_id: Id, *, offset: int, limit: int,
    ) -> EvidencePage:
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 20000:
            raise DomainError("knowledge_read_invalid", "知识原文分页范围无效")
        with self.knowledge.store.transaction(write=False) as tx:
            evidence, activity_id = _registered(tx, workspace_id, evidence_id)
            _committed_tool(tx, activity_id, evidence)
            text, source = self._snapshot_tx(tx, workspace_id, evidence, historical_review=True)
            if offset > len(text):
                raise DomainError("knowledge_read_invalid", "知识原文分页偏移超出片段")
            end = min(offset + limit, len(text))
            return EvidencePage(evidence=evidence, text=text[offset:end], offset=offset,
                next_offset=end if end < len(text) else None, total_chars=len(text),
                current_version=source.active_version)

    def _snapshot_tx(self, tx, workspace_id, evidence, *, historical_review=False):
        _scope(tx, ScopeRef(kind="workspace", workspace_id=workspace_id))
        row = tx.execute("SELECT k.document,s.status FROM knowledge_sources k JOIN scopes s ON s.id=k.id "
            "WHERE k.id=? AND k.workspace_id=?", (evidence.source_id, workspace_id)).fetchone()
        if row is None:
            raise DomainError("knowledge_evidence_missing", "项目知识来源不存在")
        source = KnowledgeSource.model_validate_json(row["document"])
        removed_review = historical_review and source.status == "removed"
        if (source.status in {"revoked", "deleted"}
                or not removed_review and (row["status"] != "active" or source.status == "removed")):
            raise DomainError("scope_revoked", "知识来源已移除或撤权")
        if self.knowledge.policy.knowledge_grant(tx, workspace_id, source.id, "read") is None:
            raise DomainError("grant_required", "知识来源缺少本地读取授权")
        row = tx.execute("SELECT document FROM knowledge_versions WHERE source_id=? AND version=?",
            (evidence.source_id, evidence.source_version)).fetchone()
        if row is None:
            _invalid()
        version = SourceVersion.model_validate_json(row[0])
        if (version.source_id, version.version, version.content_hash) != (
                evidence.source_id, evidence.source_version, evidence.content_hash):
            _invalid()
        raw = self.knowledge.blobs.read(evidence.content_hash, max_bytes=version.byte_size)
        if len(raw) != version.byte_size:
            _invalid()
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise DomainError("knowledge_evidence_invalid", "历史知识快照编码无效") from error
        locator = evidence.locator
        if (not 0 <= locator.start_char < locator.end_char <= len(text)
                or text[locator.start_char:locator.end_char] != evidence.excerpt):
            _invalid()
        starts, position = [], 0
        for line in text.splitlines(keepends=True):
            starts.append(position)
            position += len(line)
        if (locator.start_line, locator.end_line) != (
                bisect.bisect_right(starts, locator.start_char),
                bisect.bisect_right(starts, locator.end_char - 1)):
            _invalid()
        return text[locator.start_char:locator.end_char], source


def trim_result(result: KnowledgeResult, max_bytes: int) -> KnowledgeResult:
    """按模型实际JSON UTF-8预算保留排名前缀；证据正文与定位同时裁剪。"""
    if tool_result_bytes(result.model_dump(mode="json")) <= max_bytes:
        return result
    trimmed = result.model_copy(update={"status": "error" if result.status == "error" else "partial",
        "sources": [], "evidence": [], "notices": ["knowledge_result_truncated"]})
    if tool_result_bytes(trimmed.model_dump(mode="json")) > max_bytes:
        trimmed = trimmed.model_copy(update={"notices": []})
    if tool_result_bytes(trimmed.model_dump(mode="json")) > max_bytes:
        raise DomainError("knowledge_result_limit", "工具上下文预算不足以保留知识结果结构")
    sources = {source.id: source for source in result.sources}
    for evidence in result.evidence:
        selected = list(trimmed.sources)
        if evidence.source_id in sources and evidence.source_id not in {item.id for item in selected}:
            selected.append(sources[evidence.source_id])
        candidate = trimmed.model_copy(update={"sources": selected, "evidence": [*trimmed.evidence, evidence]})
        if tool_result_bytes(candidate.model_dump(mode="json")) <= max_bytes:
            trimmed = candidate
            continue
        low, high = 0, len(evidence.excerpt)
        while low < high:
            size = (low + high + 1) // 2
            prefix = candidate.model_copy(update={"evidence": [*trimmed.evidence, _prefix(evidence, size)]})
            if tool_result_bytes(prefix.model_dump(mode="json")) <= max_bytes:
                low = size
            else:
                high = size - 1
        if low:
            trimmed = candidate.model_copy(update={"evidence": [*trimmed.evidence, _prefix(evidence, low)]})
        break
    if not result.evidence:
        for source in result.sources:
            candidate = trimmed.model_copy(update={"sources": [*trimmed.sources, source]})
            if tool_result_bytes(candidate.model_dump(mode="json")) > max_bytes:
                break
            trimmed = candidate
    return trimmed
