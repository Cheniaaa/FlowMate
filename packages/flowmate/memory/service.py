"""长期记忆的唯一语义写入口；模型提案与用户命令分别验证。"""

import hashlib
import json
import unicodedata

from flowmate.contracts.base import CommandMeta, DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    ArtifactRef,
    ModelMessage,
    RunSnapshot,
    ScopeDependency,
    TextPart,
    ToolCallPart,
    ToolResultPart,
)
from flowmate.memory.contracts import (
    MemoryCandidate,
    MemoryChange,
    MemoryEvidence,
    MemoryNotice,
    MemoryPolicy,
    MemoryProposal,
    MemoryRecord,
)
from flowmate.memory.provider import scope_id
from flowmate.policy.contracts import ToolInvocation
from flowmate.policy.service import _owner, _scope
from flowmate.runtime.transitions import check_scopes, utc_now


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def claim_key(text):
    return digest(" ".join(unicodedata.normalize("NFKC", text).casefold().split()))


def _merge(values):
    result = {}
    for item in values:
        if item.scope_id in result and result[item.scope_id] != item:
            raise DomainError("source_version_conflict", "记忆来源版本不一致")
        result[item.scope_id] = item
    return list(result.values())


def _locate(value, locator):
    if locator == "":
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if not locator.startswith("/"):
        raise DomainError("invalid_evidence", "证据定位须使用 JSON Pointer")
    try:
        for token in locator[1:].split("/"):
            token = token.replace("~1", "/").replace("~0", "~")
            value = value[int(token)] if isinstance(value, list) and token.isdecimal() else value[token]
    except (KeyError, IndexError, TypeError, ValueError):
        raise DomainError("invalid_evidence", "证据定位不存在") from None
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class MemoryService:
    def __init__(self, store, provider, policy, *, artifacts=None, clock=utc_now):
        if not all(getattr(provider.capabilities, key) for key in ("revisions", "scope_query", "archive_roundtrip")):
            raise DomainError("memory_provider_incompatible", "记忆存储缺少必需能力")
        self.store, self.provider, self.policy = store, provider, policy
        self.artifacts, self.clock = artifacts, clock
        self.policy.memory_provider = provider

    @staticmethod
    def _owner_id(tx):
        return tx.execute("SELECT user_scope_id FROM local_identity WHERE singleton=1").fetchone()[0]

    def _scope(self, tx, scope):
        id = scope_id(tx, scope)
        _scope(tx, scope)
        row = tx.execute("SELECT epoch FROM scopes WHERE id=?", (id,)).fetchone()
        return ScopeDependency(scope_id=id, epoch=row[0])

    def _get(self, tx, id):
        record = self.provider.using(tx).get(id)
        if record.owner_id != self._owner_id(tx):
            raise DomainError("scope_mismatch", "记忆不属于本机用户")
        self._scope(tx, record.scope)
        return record

    def _command(self, operation, parameters, meta, apply, model=MemoryRecord):
        meta = CommandMeta.model_validate(meta.model_dump())
        fingerprint = digest(json.dumps({"operation": operation, "parameters": parameters,
            "expected_version": meta.expected_version}, sort_keys=True, separators=(",", ":"), allow_nan=False))
        with self.provider.atomic(), self.store.transaction() as tx:
            previous = tx.previous_command(meta.command_id)
            if previous is not None:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict", "同一记忆命令不能更改参数")
                if operation == "memory.propose":
                    old = MemoryRecord.model_validate_json(previous["response"])
                    return self._get(tx, old.id)
                if parameters.get("receipt_message_id") is not None:
                    response = model.model_validate_json(previous["response"])
                    current = self._get(tx, response.id)
                    if response != current:
                        raise DomainError("version_conflict", "记忆已改变，请刷新当前状态")
                    check_scopes(tx, current.dependencies)
                    for evidence in current.evidence:
                        self._evidence(tx, evidence)
                return model.model_validate_json(previous["response"])
            result = apply(tx)
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)", (meta.command_id, fingerprint,
                result.model_dump_json(), result.scope.workspace_id, None))
            return result

    def _save(self, tx, record, expected, meta):
        record = self.provider.using(tx).put(record, expected)
        tx.execute("INSERT INTO scopes(id,kind,workspace_id,epoch,status) VALUES (?,'memory',?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,status=excluded.status",
            (record.id, record.scope.workspace_id, record.revision,
             "deleted" if record.status == "deleted" else "active"))
        tx.append_event(NewEvent(kind="memory.changed", workspace_id=record.scope.workspace_id,
            causation_id=meta.command_id, payload=MemoryChange(records=[MemoryNotice(
                id=record.id, scope=record.scope, revision=record.revision, status=record.status)])))
        return record

    @staticmethod
    def _edit_evidence(meta, text):
        return MemoryEvidence(source_kind="user_edit", source_id=meta.command_id,
            source_version="1", locator="/text", quote_hash=digest(text), author_kind="user")

    def create(self, text, scope, kind, meta):
        from flowmate.memory.contracts import CreateMemory
        command = CreateMemory(text=text, scope=scope, kind=kind)

        def apply(tx):
            if meta.expected_version is not None:
                raise DomainError("version_conflict", "新记忆不接受已有修订")
            dependency = self._scope(tx, scope)
            record = MemoryRecord(owner_id=self._owner_id(tx), scope=scope, text=text,
                kind=kind, author_kind="user", status="confirmed", claim_key=claim_key(text),
                evidence=[self._edit_evidence(meta, text)], dependencies=[dependency])
            return self._save(tx, record, None, meta)
        return self._command("memory.create", command.model_dump(mode="json"), meta, apply)

    def _tool_evidence(self, tx, message, part, activity, source):
        if (activity is None or activity.state != "succeeded" or activity.intent.kind != "tool"
                or activity.receipt is None or part.error is not None):
            raise DomainError("invalid_evidence", "工具消息没有成功活动的实际结果")
        if part.result == activity.receipt.result:
            # 普通原值及历史上直接保存的压缩回执沿原身份继续可读。
            return
        if (not activity.content_committed or activity.run_id != source["run_id"]
                or activity.task_id != source["task_id"] or self.artifacts is None):
            raise DomainError("invalid_evidence", "派生工具消息不属于实际提交的活动")
        call = ToolInvocation.model_validate(activity.intent.arguments)
        if call.call_id != part.call_id or call.name != activity.intent.operation:
            raise DomainError("invalid_evidence", "派生工具消息与实际调用身份不符")
        result = part.result
        if not isinstance(result, dict) or result.get("truncated") is not True or "artifact_id" not in result:
            raise DomainError("invalid_evidence", "工具消息不是实际结果或已登记摘要")
        row = tx.execute("SELECT document FROM artifacts WHERE id=?", (result["artifact_id"],)).fetchone()
        if row is None:
            raise DomainError("invalid_evidence", "工具摘要产物不存在")
        artifact = ArtifactRef.model_validate_json(row[0])
        serialized = json.dumps(activity.receipt.result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        expected = {"artifact_id": artifact.id, "truncated": True,
            "preview": serialized[:1024], "total_chars": len(serialized)}
        if (artifact.activity_id != activity.id or artifact.task_id != activity.task_id
                or artifact.media_type != "text/plain" or artifact.content_hash != digest(serialized)
                or result != expected or self.artifacts._text(artifact) != serialized
                or set((item.scope_id, item.epoch) for item in artifact.dependencies)
                    != set((item.scope_id, item.epoch) for item in message.source_dependencies)):
            raise DomainError("invalid_evidence", "工具摘要与真实回执内容或来源不符")
        check_scopes(tx, artifact.dependencies)

    def _evidence(self, tx, evidence, *, ctx=None, include_quote=False):
        """从权威来源取值，不保存原文副本，也不把引用存在视为用户授权。"""
        dependencies = []
        author = None
        if evidence.source_kind == "user_edit":
            command = tx.previous_command(evidence.source_id)
            if command is None:
                raise DomainError("invalid_evidence", "用户命令证据不存在")
            value = json.loads(command["response"])
            if not any(item.get("source_id") == evidence.source_id and item.get("source_kind") == "user_edit"
                       for item in value.get("evidence", [])):
                raise DomainError("invalid_evidence", "证据不是用户记忆命令")
            source_record = MemoryRecord.model_validate_json(command["response"])
            if source_record.owner_id != self._owner_id(tx) or (
                    ctx is not None and source_record.scope.workspace_id not in {None, ctx.workspace_id}):
                raise DomainError("scope_mismatch", "用户编辑证据超出当前范围")
            dependencies.extend(source_record.dependencies)
            version, author = "1", "user"
        elif evidence.source_kind == "artifact":
            row = tx.execute("SELECT document FROM artifacts WHERE id=?", (evidence.source_id,)).fetchone()
            if row is None or self.artifacts is None:
                raise DomainError("invalid_evidence", "产物证据不可用")
            artifact = ArtifactRef.model_validate_json(row[0])
            if ctx is not None:
                self.artifacts.reference(ctx, artifact.id, tx=tx)
                decision = self.policy.check_tx(tx, ctx, artifact.dependencies, "read", artifact_id=artifact.id)
                if not decision.allowed:
                    raise DomainError("grant_required", "产物证据尚未授权")
                dependencies.extend(decision.dependencies)
            dependencies.extend(artifact.dependencies)
            value = self.artifacts._text(artifact)
            version, author = artifact.content_hash, "tool"
        else:
            table, key = ("messages", "id") if evidence.source_kind == "message" else ("events", "event_id")
            row = tx.execute(f"SELECT * FROM {table} WHERE {key}=?", (evidence.source_id,)).fetchone()
            if row is None:
                raise DomainError("invalid_evidence", "记忆引用的来源不存在")
            raw = row["document"]
            value, version = json.loads(raw), digest(raw)
            if evidence.source_kind == "message":
                message = ModelMessage.model_validate_json(raw)
                author = message.role
                if author not in {"user", "assistant", "tool"} or message.origin == "task_result":
                    raise DomainError("invalid_evidence", "内部载荷不是用户或工具事实")
                source_run = RunSnapshot.model_validate_json(tx.execute(
                    "SELECT document FROM runs WHERE id=?", (row["run_id"],)).fetchone()[0])
                source_event = json.loads(tx.execute("SELECT document FROM events WHERE event_id=?",
                    (row["event_id"],)).fetchone()[0])
                if message.role == "user" or message.origin == "answer":
                    user_command = tx.previous_command(source_event["causation_id"]) if source_event["causation_id"] else None
                    response = json.loads(user_command["response"]) if user_command else {}
                    command_matches = (
                        source_event["kind"] == "run.started" and source_run.kind == "user"
                        and response.get("id") == source_run.id
                        or source_event["kind"] == "run.steered" and response.get("message_id") == message.id
                        and response.get("run_id") == source_run.id
                        or source_event["kind"] == "question.answered" and message.origin == "answer"
                        and response.get("id") == source_run.id)
                    if (source_event["kind"] not in {"run.started", "run.steered", "question.answered"}
                            or user_command is None
                            or not command_matches
                            or user_command["session_id"] != source_run.interaction_session_id
                            or row["task_id"] != source_run.root_task_id and source_event["kind"] != "question.answered"
                            or source_run.kind == "follow_up" and message.origin == "conversation"):
                        raise DomainError("invalid_evidence", "消息没有真实用户命令或属于合成初始指令")
                    author = "user"
                if author == "tool":
                    activity_row = tx.execute("SELECT document FROM activities WHERE id=?",
                        (message.activity_id,)).fetchone()
                    activity = ActivitySnapshot.model_validate_json(activity_row[0]) if activity_row else None
                    locator = evidence.locator.split("/")
                    if (len(locator) < 4 or locator[1] != "parts" or not locator[2].isdecimal()
                            or int(locator[2]) >= len(message.parts)
                            or not isinstance(message.parts[int(locator[2])], ToolResultPart)):
                        raise DomainError("invalid_evidence", "工具证据须引用实际结果")
                    self._tool_evidence(tx, message, message.parts[int(locator[2])], activity, row)
                if ctx is not None and row["execution_session_id"] != ctx.session_id:
                    from flowmate.memory.maintenance import permits_source
                    if not permits_source(tx, ctx, row["run_id"], row["event_id"]):
                        raise DomainError("scope_mismatch", "记忆证据不属于实际执行会话")
                locator = evidence.locator.split("/")
                part_kind = "tool_result" if message.role == "tool" else "text"
                field = "result" if part_kind == "tool_result" else "text"
                if (len(locator) < 4 or locator[1] != "parts" or not locator[2].isdecimal()
                        or int(locator[2]) >= len(message.parts) or locator[3] != field
                        or message.parts[int(locator[2])].kind != part_kind):
                    raise DomainError("invalid_evidence", "消息证据只能引用实际正文或结果")
                dependencies.extend(message.source_dependencies)
                source_scope = row["execution_session_id"]
            else:
                if value["kind"] != "activity.received":
                    raise DomainError("invalid_evidence", "事件不是已提交的工具回执")
                locator = evidence.locator.split("/")
                if (len(locator) < 6 or locator[1:3] != ["payload", "activities"]
                        or not locator[3].isdecimal() or locator[4:6] != ["receipt", "result"]):
                    raise DomainError("invalid_evidence", "工具依据只能引用真实回执结果")
                activities = value["payload"]["activities"]
                if not activities or any(a["intent"]["kind"] != "tool" or a["state"] != "succeeded" for a in activities):
                    raise DomainError("invalid_evidence", "工具证据须来自成功的真实工具活动")
                author = "tool"
                for activity in activities:
                    dependencies.extend(activity["intent"]["dependencies"])
                    dependencies.extend(activity["receipt"]["source_dependencies"])
                dependencies = [ScopeDependency.model_validate(item) if isinstance(item, dict) else item
                    for item in dependencies]
                source_scope = row["session_id"]
                if ctx is not None and (row["run_id"] != ctx.run_id or value["task_id"] != ctx.task_id):
                    from flowmate.memory.maintenance import permits_source
                    if not permits_source(tx, ctx, row["run_id"], row["event_id"]):
                        raise DomainError("scope_mismatch", "工具证据不属于当前任务")
            if source_scope is not None:
                epoch = tx.execute("SELECT epoch FROM scopes WHERE id=?", (source_scope,)).fetchone()[0]
                dependencies.append(ScopeDependency(scope_id=source_scope, epoch=epoch))
            if ctx is not None:
                decision = self.policy.check_tx(tx, ctx, dependencies, "read")
                if not decision.allowed:
                    raise DomainError("grant_required", "记忆来源尚未授权")
                dependencies.extend(decision.dependencies)
        if version != evidence.source_version or author != evidence.author_kind:
            raise DomainError("invalid_evidence", "来源版本或作者不符")
        quote = _locate(value, evidence.locator)
        if digest(quote) != evidence.quote_hash:
            raise DomainError("invalid_evidence", "来源原文摘要不符")
        check_scopes(tx, dependencies)
        checked = _merge(dependencies)
        return (checked, quote) if include_quote else checked

    def chat_sources(self, tx, ctx, messages):
        """只描述当次实际可见且由真实用户命令产生的正文；不授予保存权。"""
        from flowmate.contracts.scopes import ScopeRef
        items = []
        for message in messages:
            if message.origin == "task_result" or (
                    message.role != "user" and message.origin != "answer"):
                continue
            row = tx.execute("SELECT document FROM messages WHERE id=?", (message.id,)).fetchone()
            if row is None:
                continue
            for index, part in enumerate(message.parts):
                if isinstance(part, TextPart):
                    locator, quote = f"/parts/{index}/text", part.text
                elif message.origin == "answer" and isinstance(part, ToolResultPart):
                    locator = f"/parts/{index}/result"
                    quote = _locate(json.loads(row[0]), locator)
                else:
                    continue
                evidence = MemoryEvidence(source_kind="message", source_id=message.id,
                    source_version=digest(row[0]), locator=locator, quote_hash=digest(quote),
                    author_kind="user")
                try:
                    self._evidence(tx, evidence, ctx=ctx)
                except DomainError as error:
                    if error.code not in {"invalid_evidence", "scope_revoked", "scope_mismatch",
                            "grant_required", "outside_run_scope", "scope_deleted"}:
                        raise
                    continue
                items.append({"text": quote, "evidence": evidence.model_dump(mode="json")})
        return {"user_global_scope": ScopeRef(kind="user_global").model_dump(mode="json"),
            "workspace_scope": ScopeRef(kind="workspace", workspace_id=ctx.workspace_id).model_dump(mode="json"),
            "items": items}

    def propose(self, ctx, proposal, meta, *, tx=None, exact_source=False):
        proposal = (MemoryProposal.model_validate_json(json.dumps(proposal, allow_nan=False))
            if isinstance(proposal, dict) else MemoryProposal.model_validate(proposal.model_dump()))

        def apply(tx):
            run, task = _owner(tx, ctx)
            if run.state in TERMINAL or task.state in TERMINAL:
                raise DomainError("owner_inactive", "任务已结束")
            dependency = self._scope(tx, proposal.scope)
            if proposal.scope.kind == "workspace" and proposal.scope.workspace_id != ctx.workspace_id:
                raise DomainError("scope_mismatch", "记忆提案超出当前项目")
            dependencies = [dependency, *ctx.scope_dependencies]
            for evidence in proposal.evidence:
                dependencies.extend(self._evidence(tx, evidence, ctx=ctx))
            if (proposal.author_kind not in {e.author_kind for e in proposal.evidence}
                    and not (exact_source and proposal.author_kind == "assistant")):
                raise DomainError("invalid_evidence", "提案作者没有对应来源")
            provider = self.provider.using(tx)
            key = claim_key(proposal.text)
            records = provider.list_records(proposal.scope, claim=key)
            candidates = provider.candidates_for(proposal.scope, claim=key)
            prior = next(iter(records), None)
            prior_candidate = next(iter(candidates), None)
            if exact_source:
                version = digest(json.dumps([e.model_dump(mode="json") for e in proposal.evidence],
                    sort_keys=True, separators=(",", ":")))
                decided = next((r for r in records if r.status != "candidate"), None)
                current_candidates = [self._get(tx, item.record_id) for item in candidates]
                corrected = next((record for record in current_candidates if record.revision > 1), None)
                if decided is not None or corrected is not None:
                    return decided or corrected
                prior = None
                prior_candidate = next((item for item in candidates
                    if item.source_version == version and item.policy_version == proposal.policy_version), None)
            if prior is not None or prior_candidate is not None:
                return prior or self._get(tx, prior_candidate.record_id)
            if proposal.record_id is not None:
                base = self._get(tx, proposal.record_id)
                if base.scope != proposal.scope:
                    raise DomainError("scope_mismatch", "范围提升须由独立用户命令确认")
            record = MemoryRecord(owner_id=self._owner_id(tx), scope=proposal.scope,
                text=proposal.text, kind=proposal.kind, author_kind=proposal.author_kind,
                status="candidate", supersedes=proposal.record_id, expires_at=proposal.expires_at,
                evidence=proposal.evidence, dependencies=_merge(dependencies), claim_key=key)
            self._save(tx, record, None, meta)
            origin_message_id = None
            if ctx.activity_id is not None:
                activity = tx.execute("SELECT document FROM activities WHERE id=?", (ctx.activity_id,)).fetchone()
                intent = ActivitySnapshot.model_validate_json(activity[0]).intent
                if intent.operation == "memory.propose":
                    row = tx.execute("SELECT document FROM messages WHERE task_id=? AND "
                        "json_extract(document,'$.role')='assistant' ORDER BY rowid DESC LIMIT 1",
                        (ctx.task_id,)).fetchone()
                    if row is not None:
                        origin = ModelMessage.model_validate_json(row[0])
                        if any(isinstance(part, ToolCallPart) and part.name == "memory.propose"
                                and part.call_id == intent.arguments["call_id"] for part in origin.parts):
                            origin_message_id = origin.id
            candidate = MemoryCandidate(id=identifier(), scope=proposal.scope,
                source_version=digest(json.dumps([e.model_dump(mode="json") for e in proposal.evidence],
                    sort_keys=True, separators=(",", ":"))),
                policy_version=proposal.policy_version, normalized_claim=key, record_id=record.id,
                base_record_id=proposal.record_id, expected_revision=proposal.expected_revision,
                extraction_run_id=ctx.run_id, extraction_task_id=ctx.task_id,
                proposal_activity_id=ctx.activity_id, proposal_message_id=origin_message_id)
            self.provider.using(tx).put_candidate(candidate)
            return record
        if tx is not None:
            return apply(tx)
        return self._command("memory.propose", {"ctx": ctx.model_dump(mode="json"),
            "proposal": proposal.model_dump(mode="json")}, meta, apply)

    def merge_extraction(self, maintenance, ctx, batch, meta):
        """源校验、候选去重与批次完成在一个原子写边界提交。"""
        from flowmate.memory.maintenance_contracts import ExtractionBatch
        batch = ExtractionBatch.model_validate(batch.model_dump())
        fingerprint = digest(json.dumps({"task_id": ctx.task_id, "batch": batch.model_dump(mode="json")},
            sort_keys=True, separators=(",", ":")))
        with self.provider.atomic(), self.store.transaction() as tx:
            state = maintenance._check(tx, ctx)
            maintenance._batch(state, batch)
            if state.batch != batch:
                raise DomainError("maintenance_binding", "必须合并已提交的真实提取批次")
            previous = tx.previous_command(meta.command_id)
            if previous is not None:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict", "同一合并命令不能改变批次")
                return [self._get(tx, id) for id in json.loads(previous["response"])["record_ids"]]
            if state.merged:
                return [self._get(tx, id) for id in state.record_ids]
            records = []
            for proposal in batch.candidates:
                if proposal.record_id is not None:
                    current = self._get(tx, proposal.record_id)
                    if current.revision != proposal.expected_revision:
                        raise DomainError("version_conflict", "提取后原记忆已被用户修订")
                    if current.status == "deleted":
                        raise DomainError("memory_deleted", "删除后的旧提取不能恢复事实")
                authors = {item.author_kind for item in proposal.evidence}
                # 只有逐字主张能沿用来源作者；改写和推断属于提取模型。
                verbatim = any(digest(proposal.text) == item.quote_hash for item in proposal.evidence)
                author = (next(iter(authors)) if verbatim and len(authors) == 1
                    and proposal.author_kind != "assistant" else "assistant")
                evidence = {item.model_dump_json(): item for item in proposal.evidence}
                normalized = proposal.model_copy(update={"author_kind": author,
                    "policy_version": batch.strategy_version,
                    "evidence": [item for _, item in sorted(evidence.items())]})
                records.append(self.propose(ctx, normalized, meta, tx=tx, exact_source=True))
            ids = list(dict.fromkeys(record.id for record in records))
            maintenance._save_state(tx, ctx, state.model_copy(update={"merged": True, "record_ids": ids}))
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)", (meta.command_id, fingerprint,
                json.dumps({"record_ids": ids}), state.input.scope.workspace_id, ctx.interaction_session_id))
            return records

    def decide(self, id, action, text, scope, meta, *, receipt_message_id=None):
        from flowmate.memory.contracts import MemoryDecision
        command = MemoryDecision(action=action, text=text, scope=scope)

        def apply(tx):
            if receipt_message_id is not None:
                from flowmate.memory.chat import candidate_for_receipt
                if action != "accept":
                    raise DomainError("invalid_request", "聊天回执仅用于采纳已展示的候选")
                saved = candidate_for_receipt(self, tx, id, receipt_message_id)
            else:
                saved = self._get(tx, id)
            if saved.scope != scope:
                raise DomainError("scope_mismatch", "修改记忆不能隐式提升范围")
            if saved.revision != meta.expected_version:
                raise DomainError("version_conflict", "记忆修订已改变")
            if action == "revise" and (text is None or not text.strip()):
                raise DomainError("invalid_request", "修订须提供正文")
            if action != "revise" and text is not None:
                raise DomainError("invalid_request", "仅修订接受正文")
            if saved.status == "deleted":
                raise DomainError("memory_deleted", "删除的正文不能恢复；请以新用户命令新建")
            if action in {"accept", "revise"}:
                candidate = next(iter(self.provider.using(tx).candidates_for(scope, record_id=id)), None)
                if candidate and candidate.base_record_id:
                    base = self._get(tx, candidate.base_record_id)
                    if base.revision != candidate.expected_revision:
                        raise DomainError("version_conflict", "候选依据的记忆已被用户修订")
                    if base.status == "deleted":
                        raise DomainError("memory_deleted", "删除后的旧候选不能恢复事实")
                    self._save(tx, base.model_copy(update={
                        "revision": base.revision + 1, "status": "rejected"}), base.revision, meta)
            updates = {"revision": saved.revision + 1,
                "status": {"accept": "confirmed", "revise": "confirmed", "reject": "rejected", "delete": "deleted"}[action]}
            if action == "delete":
                updates.update(text="", evidence=[], dependencies=[])
                tx.execute("INSERT OR IGNORE INTO deleted_commands SELECT command_id,request_hash FROM commands "
                    "WHERE json_extract(response,'$.id')=?", (id,))
                tx.execute("DELETE FROM commands WHERE json_extract(response,'$.id')=?", (id,))
                tx.execute("UPDATE cleanup_state SET wal_pending=1 WHERE singleton=1")
            elif action in {"accept", "revise"}:
                for evidence in saved.evidence if action == "accept" else []:
                    self._evidence(tx, evidence)
                body = text if action == "revise" else saved.text
                updates.update(text=body, author_kind="user", claim_key=claim_key(body),
                    evidence=[*(saved.evidence if action == "accept" else []), self._edit_evidence(meta, body)],
                    dependencies=saved.dependencies if action == "accept" else [self._scope(tx, scope)])
            return self._save(tx, saved.model_copy(update=updates), saved.revision, meta)
        parameters = {"id": id, **command.model_dump(mode="json")}
        if receipt_message_id is not None:
            parameters["receipt_message_id"] = receipt_message_id
        return self._command("memory.decide", parameters, meta, apply)

    def get_policy(self, scope, *, tx=None):
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.get_policy(scope, tx=tx)
        self._scope(tx, scope)
        row = tx.execute("SELECT document FROM memory_policies WHERE scope_id=?", (scope_id(tx, scope),)).fetchone()
        return MemoryPolicy.model_validate_json(row[0]) if row else MemoryPolicy(scope=scope)

    def save_policy(self, setting, meta):
        setting = MemoryPolicy.model_validate(setting.model_dump())

        def apply(tx):
            current = self.get_policy(setting.scope, tx=tx)
            if meta.expected_version != current.version or setting.version != current.version:
                raise DomainError("version_conflict", "记忆设置版本已改变")
            if setting.model_profile_id is not None:
                tx.get_profile("model", setting.model_profile_id)
            saved = setting.model_copy(update={"version": current.version + 1})
            tx.execute("INSERT INTO memory_policies VALUES (?,?) ON CONFLICT(scope_id) DO UPDATE SET "
                "document=excluded.document", (scope_id(tx, saved.scope), saved.model_dump_json()))
            tx.append_event(NewEvent(kind="memory.policy_changed", workspace_id=saved.scope.workspace_id,
                causation_id=meta.command_id, payload=MemoryChange(policies=[saved])))
            return saved
        return self._command("memory.policy", setting.model_dump(mode="json"), meta, apply, MemoryPolicy)

    def evidence(self, id, *, tx=None):
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.evidence(id, tx=tx)
        from flowmate.memory.contracts import MemoryEvidenceView
        record = self._get(tx, id)
        result = []
        for evidence in record.evidence:
            try:
                check_scopes(tx, record.dependencies)
                self._evidence(tx, evidence)
            except DomainError as error:
                result.append(MemoryEvidenceView(evidence=evidence, available=False, reason=error.code))
            else:
                result.append(MemoryEvidenceView(evidence=evidence, available=True))
        return result

    def evidence_excerpt(self, id, evidence_index, expected_revision, *, offset=0,
                         receipt_message_id=None, tx=None):
        """仅供用户显式阅读依据；不扩展 evidence() 的元数据返回或其它消费方。"""
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.evidence_excerpt(id, evidence_index, expected_revision, offset=offset,
                    receipt_message_id=receipt_message_id, tx=tx)
        from flowmate.memory.evidence import read_excerpt
        return read_excerpt(self, tx, id, evidence_index, expected_revision,
            offset=offset, receipt_message_id=receipt_message_id)

    def profile(self, ctx, destination, *, tx=None):
        if tx is None:
            with self.store.transaction(write=False) as tx:
                return self.profile(ctx, destination, tx=tx)
        from flowmate.contracts.scopes import ScopeRef
        run, task = _owner(tx, ctx)
        if run.state in TERMINAL or task.state in TERMINAL:
            return []
        result, candidates = [], []
        if run.kind == "follow_up":
            # 明确交付只延续固定的记忆身份；不查询同范围其它记录。
            selected = task.binding.input_result
            if selected is not None:
                candidates = [self.provider.using(tx).get(item.scope_id) for item in selected.dependencies
                    if tx.execute("SELECT 1 FROM scopes WHERE id=? AND kind='memory'",
                        (item.scope_id,)).fetchone()]
        else:
            # Run/Task 两个固定选择均须包含该范围；读取策略本身不扩大来源上界。
            for scope in [ScopeRef(kind="user_global"), ScopeRef(kind="workspace", workspace_id=ctx.workspace_id)]:
                if (not all(scope in selected.memory_scopes for selected in (run.sources, task.binding.sources))
                        or not self.get_policy(scope, tx=tx).read_profile):
                    continue
                candidates.extend(self.provider.using(tx).query(scope, True, 100))
        for record in candidates:
            if (record.owner_id != self._owner_id(tx) or record.status != "confirmed"
                    or record.expires_at and record.expires_at <= self.clock()):
                continue
            try:
                dependencies = [ScopeDependency(scope_id=record.id, epoch=record.revision)]
                decision = self.policy.check_tx(tx, ctx, dependencies, "model_send", destination)
                if not decision.allowed:
                    continue
                for evidence in record.evidence:
                    self._evidence(tx, evidence)
            except DomainError as error:
                if error.code not in {"scope_revoked", "invalid_evidence", "scope_deleted", "outside_run_scope",
                        "scope_mismatch", "not_found"}:
                    raise
                continue
            result.append(record)
        return result
