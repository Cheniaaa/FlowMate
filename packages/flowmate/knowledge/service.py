"""项目来源接纳：可信文件快照、不可变版本与可追踪队列同事务提交。"""

import hashlib
import json
from pathlib import PureWindowsPath

from flowmate.artifacts.blobs import BlobStore
from flowmate.config import RuntimeConfig
from flowmate.contracts.base import CommandMeta, DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import ScopeDependency
from flowmate.contracts.scopes import ScopeRef
from flowmate.knowledge.contracts import (
    KnowledgeNotice,
    KnowledgeResult,
    KnowledgeSearchBinding,
    KnowledgeSearchRequest,
    KnowledgeSettings,
    KnowledgeSource,
    SourceVersion,
)
from flowmate.knowledge.ingestion_contracts import (
    KnowledgeImportReceipt,
    KnowledgeImportRequest,
    KnowledgeJob,
    RejectedKnowledgeFile,
)
from flowmate.knowledge.parsing import Chunker, Parser
from flowmate.knowledge.provider import RetrieverFactory
from flowmate.policy.contracts import GrantCommand, ResourceRecord
from flowmate.policy.service import _scope
from flowmate.runtime.transitions import admission_generations, check_scopes
from flowmate.tools.files import FileAnchor


class KnowledgeService:
    def __init__(self, store, policy, files, *, parser: Parser, chunker: Chunker,
            retriever_factory: RetrieverFactory, config=None):
        self.store, self.policy, self.files = store, policy, files
        self.parser, self.chunker, self.retriever_factory = parser, chunker, retriever_factory
        self.embedding = None
        self.config = config or RuntimeConfig()
        self.blobs = BlobStore(store.path.parent / "artifacts" / "blobs")

    @staticmethod
    def cancel_pending(tx, workspace_id, command_id):
        revisions = {}
        for row in tx.execute("SELECT document FROM knowledge_jobs WHERE workspace_id=? AND status='queued'",
                (workspace_id,)).fetchall():
            job = KnowledgeJob.model_validate_json(row[0])
            job = job.model_copy(update={"revision": job.revision + 1, "status": "cancelled", "reason": "stop_all"})
            tx.execute("UPDATE knowledge_jobs SET status=?,document=? WHERE id=?",
                (job.status, job.model_dump_json(), job.id))
            revisions[job.id] = job.revision
        if revisions:
            tx.append_event(NewEvent(kind="knowledge.changed", workspace_id=workspace_id, causation_id=command_id,
                payload=KnowledgeNotice(workspace_id=workspace_id, job_revisions=revisions)))

    def sources(self, workspace_id):
        with self.store.transaction(write=False) as tx:
            _scope(tx, ScopeRef(kind="workspace", workspace_id=workspace_id))
            return [KnowledgeSource.model_validate_json(row[0]) for row in tx.execute(
                "SELECT document FROM knowledge_sources WHERE workspace_id=? ORDER BY rowid", (workspace_id,))]

    def settings(self, workspace_id):
        with self.store.transaction() as tx:
            return self.settings_tx(tx, workspace_id)

    @staticmethod
    def settings_tx(tx, workspace_id):
        _scope(tx, ScopeRef(kind="workspace", workspace_id=workspace_id))
        row = tx.execute("SELECT document FROM knowledge_settings WHERE workspace_id=?", (workspace_id,)).fetchone()
        if row is not None:
            return KnowledgeSettings.model_validate_json(row[0])
        settings = KnowledgeSettings(workspace_id=workspace_id, index_generation=identifier())
        tx.execute("INSERT INTO knowledge_settings VALUES (?,?)", (workspace_id, settings.model_dump_json()))
        return settings

    def cancel_job(self, job_id, meta):
        from flowmate.contracts.execution import RunSnapshot
        from flowmate.knowledge.ingestion import _save_job
        from flowmate.runtime.transitions import load, stop_run

        fingerprint = hashlib.sha256(json.dumps({"operation": "knowledge.cancel", "job_id": job_id,
            "expected_version": meta.expected_version}, sort_keys=True).encode()).hexdigest()
        with self.store.transaction() as tx:
            previous = tx.previous_command(meta.command_id)
            if previous is not None:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict", "同一取消命令不能更改任务")
                return KnowledgeJob.model_validate_json(previous["response"])
            row = tx.execute("SELECT document FROM knowledge_jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "资料任务不存在")
            job = KnowledgeJob.model_validate_json(row[0])
            _scope(tx, ScopeRef(kind="workspace", workspace_id=job.workspace_id))
            if meta.expected_version != job.revision:
                raise DomainError("version_conflict", "资料任务状态已改变")
            if job.status == "queued":
                job = job.model_copy(update={"revision": job.revision + 1, "status": "cancelled",
                    "reason": "user_cancelled"})
                _save_job(tx, job)
            elif job.status == "running":
                stop_run(tx, load(tx, RunSnapshot, job.task.run_id), "cancelled", "user_cancelled")
                job = KnowledgeJob.model_validate_json(tx.execute(
                    "SELECT document FROM knowledge_jobs WHERE id=?", (job_id,)).fetchone()[0])
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)",
                (meta.command_id, fingerprint, job.model_dump_json(), job.workspace_id, None))
            return job

    def source_version(self, source_id, version):
        with self.store.transaction(write=False) as tx:
            row = tx.execute("SELECT document FROM knowledge_versions WHERE source_id=? AND version=?",
                (source_id, version)).fetchone()
            if row is None:
                raise DomainError("knowledge_version_missing", "来源版本不存在")
            return SourceVersion.model_validate_json(row[0])

    def _source_for_task(self, tx, ctx, source_id):
        from flowmate.contracts.execution import TaskSnapshot
        from flowmate.runtime.transitions import load

        row = tx.execute("SELECT k.document,s.epoch FROM knowledge_sources k JOIN scopes s ON s.id=k.id "
            "WHERE k.id=?", (source_id,)).fetchone()
        if row is None:
            raise DomainError("knowledge_source_missing", "项目资料不存在")
        source = KnowledgeSource.model_validate_json(row["document"])
        if source.status in {"removed", "revoked", "deleted"}:
            raise DomainError("scope_revoked", "资料已移出、停止使用或删除")
        dependency = ScopeDependency(scope_id=source_id, epoch=row["epoch"])
        task = load(tx, TaskSnapshot, ctx.task_id)
        for purpose in ("read", "model_send"):
            decision = self.policy.check_tx(tx, ctx, [dependency], purpose,
                task.binding.config.model_profile.endpoint if purpose == "model_send" else None)
            if not decision.allowed:
                raise DomainError("grant_required", "资料尚未获准供当前模型使用")
        return source

    def result_dependencies(self, ctx, result):
        dependencies = {}
        with self.store.transaction(write=False) as tx:
            for id in {source.id for source in result.sources} | {item.source_id for item in result.evidence}:
                self._source_for_task(tx, ctx, id)
                epoch = tx.execute("SELECT epoch FROM scopes WHERE id=?", (id,)).fetchone()[0]
                decision = self.policy.check_tx(tx, ctx, [ScopeDependency(scope_id=id, epoch=epoch)], "read")
                dependencies.update((item.scope_id, item) for item in decision.dependencies)
        return list(dependencies.values())

    def list_for_task(self, ctx, request):
        from flowmate.runtime.tasks import _owner

        with self.store.transaction(write=False) as tx:
            run, task = _owner(tx, ctx)
            ids = sorted(set(run.sources.knowledge_source_ids) & set(task.binding.sources.knowledge_source_ids)
                - set(run.sources.excluded_source_ids) - set(task.binding.sources.excluded_source_ids))
            sources, notices = [], []
            for id in ids:
                try:
                    sources.append(self._source_for_task(tx, ctx, id))
                except DomainError as error:
                    notices.append(error.code)
            return KnowledgeResult(sources=sources[:request.limit],
                notices=list(dict.fromkeys(notices)), status="partial" if notices else "ok")

    def prepare_search(self, ctx, call_id, request, *, origin_message_id=None):
        from flowmate.contracts.execution import ActivitySnapshot, Checkpoint, ModelMessage
        from flowmate.policy.contracts import ToolInvocation
        from flowmate.runtime.tasks import _owner, task_ancestors
        from flowmate.runtime.transitions import load

        with self.store.transaction() as tx:
            run, task = _owner(tx, ctx)
            if origin_message_id is None:
                invocation = ToolInvocation.model_validate(
                    load(tx, ActivitySnapshot, ctx.activity_id).intent.arguments if ctx.activity_id else
                    load(tx, Checkpoint, task.id).tool_call)
                if (invocation.name != "knowledge.search" or invocation.call_id != call_id
                        or KnowledgeSearchRequest.model_validate(invocation.arguments) != request):
                    raise DomainError("tool_binding", "检索身份不属于当前真实工具调用")
            origin = tx.execute("SELECT m.document FROM messages m JOIN json_each(m.document,'$.parts') p "
                "WHERE m.task_id=? AND json_extract(m.document,'$.role')='assistant' "
                "AND json_extract(p.value,'$.kind')='tool_call' AND json_extract(p.value,'$.call_id')=? "
                "AND json_extract(p.value,'$.name')='knowledge.search' AND (? IS NULL OR m.id=?) "
                "ORDER BY m.rowid DESC LIMIT 1",
                (ctx.task_id, call_id, origin_message_id, origin_message_id)).fetchone()
            message_id = ModelMessage.model_validate_json(origin[0]).id if origin is not None else None
            if task.kind == "agent" and message_id is None:
                raise DomainError("tool_binding", "检索缺少原始模型调用")
            if origin_message_id is not None:
                message = ModelMessage.model_validate_json(origin[0])
                call = next(part for part in message.parts if part.kind == "tool_call" and part.call_id == call_id)
                actual = (KnowledgeSearchRequest.model_validate_json(call.arguments) if isinstance(call.arguments, str)
                    else KnowledgeSearchRequest.model_validate(call.arguments))
                if actual != request:
                    raise DomainError("tool_binding", "检索参数与原模型调用不一致")
            previous = tx.execute("SELECT document FROM knowledge_searches WHERE task_id=? "
                "AND message_id IS ? AND call_id=?", (ctx.task_id, message_id, call_id)).fetchone()
            if previous is not None:
                binding = KnowledgeSearchBinding.model_validate_json(previous[0])
                if binding.request != request:
                    raise DomainError("command_conflict", "同一检索调用不能更改参数")
                return binding
            ancestors = task_ancestors(tx, task.id)
            root_id = tx.execute("SELECT id FROM runs WHERE root_task_id IN "
                "(SELECT value FROM json_each(?)) ORDER BY rowid LIMIT 1", (json.dumps(sorted(ancestors)),)).fetchone()[0]
            count = tx.execute("SELECT count(*) FROM knowledge_searches WHERE root_run_id=?", (root_id,)).fetchone()[0]
            if count >= 4:
                raise DomainError("knowledge_search_limit", "本次任务已用完首次检索及三次补查，请用已有证据回答")
            settings_row = tx.execute("SELECT document FROM knowledge_settings WHERE workspace_id=?",
                (run.workspace_id,)).fetchone()
            settings = (KnowledgeSettings.model_validate_json(settings_row[0]) if settings_row else
                KnowledgeSettings(workspace_id=run.workspace_id, index_generation=identifier()))
            allowed = (set(run.sources.knowledge_source_ids) & set(task.binding.sources.knowledge_source_ids)
                - set(run.sources.excluded_source_ids) - set(task.binding.sources.excluded_source_ids))
            ids = set(request.source_ids) if request.source_ids else allowed
            versions, failure = [], None
            try:
                if not ids <= allowed:
                    raise DomainError("outside_run_scope", "检索来源超出本次任务的固定范围")
                for id in sorted(ids):
                    source = self._source_for_task(tx, ctx, id)
                    if source.active_version is not None:
                        versions.append(SourceVersion.model_validate_json(tx.execute(
                            "SELECT document FROM knowledge_versions WHERE source_id=? AND version=?",
                            (id, source.active_version)).fetchone()[0]))
            except DomainError as error:
                failure = KnowledgeResult(status="error", error=error.code)
            binding = KnowledgeSearchBinding(id=identifier(), workspace_id=run.workspace_id,
                root_run_id=root_id, run_id=run.id, task_id=task.id, message_id=message_id, call_id=call_id,
                ordinal=count + 1, request=request, sources=versions,
                index_generation=settings.index_generation, embedding_profile=settings.active_profile)
            tx.execute("INSERT INTO knowledge_searches VALUES (?,?,?,?,?,?,?,?)",
                (binding.id, root_id, run.id, task.id, message_id, call_id, binding.model_dump_json(),
                    failure.model_dump_json() if failure else None))
            return binding

    def search(self, ctx, binding, *, query_vector=None, vector_error=None):
        from flowmate.knowledge.evidence import EvidenceService
        from flowmate.runtime.tasks import _owner

        with self.store.transaction(write=False) as tx:
            _owner(tx, ctx)
            saved = tx.execute("SELECT document,result FROM knowledge_searches WHERE id=? AND task_id=?",
                (binding.id, ctx.task_id)).fetchone()
            if saved is None or KnowledgeSearchBinding.model_validate_json(saved["document"]) != binding:
                raise DomainError("tool_binding", "检索参数不属于已占额的固定调用")
            for source in binding.sources:
                self._source_for_task(tx, ctx, source.source_id)
            if saved["result"] is not None:
                result = KnowledgeResult.model_validate_json(saved["result"])
                for evidence in result.evidence:
                    self._source_for_task(tx, ctx, evidence.source_id)
                return result
        mode = binding.request.mode
        unavailable = query_vector is None or vector_error is not None
        if mode == "hybrid" and unavailable and vector_error is None:
            vector_error = "knowledge_vector_unavailable"
        if mode == "dense" and unavailable:
            result = KnowledgeResult(status="error", mode="dense", error=vector_error or "knowledge_vector_unavailable")
        else:
            mode = "bm25" if mode == "bm25" or unavailable else "dense" if mode == "dense" else "hybrid"
            try:
                evidence = []
                if binding.sources:
                    evidence = self.retriever_factory(self.store.path.parent / "knowledge", ctx.workspace_id).search(
                        binding.index_generation, binding.request.query,
                        [(source.source_id, source.version) for source in binding.sources],
                        mode=mode, vector=query_vector, limit=binding.request.limit)
                result = KnowledgeResult(mode=mode, evidence=[
                    item.model_copy(update={"embedding_profile": binding.embedding_profile}) for item in evidence],
                    status="partial" if vector_error else "ok", error=vector_error,
                    notices=[vector_error] if vector_error else [])
            except DomainError as error:
                result = KnowledgeResult(status="error", mode=mode, error=error.code)
        with self.store.transaction() as tx:
            _owner(tx, ctx)
            for source in binding.sources:
                self._source_for_task(tx, ctx, source.source_id)
            for evidence in result.evidence:
                source = self._source_for_task(tx, ctx, evidence.source_id)
                if source.active_version != evidence.source_version:
                    result.notices.append(f"来源 {source.id} 已更新到版本 {source.active_version}；本次证据仍为版本 {evidence.source_version}")
            EvidenceService(self).register(tx, ctx, result.evidence)
            tx.execute("UPDATE knowledge_searches SET result=? WHERE id=?", (result.model_dump_json(), binding.id))
            return result

    def read(self, ctx, request):
        from flowmate.knowledge.contracts import Evidence
        from flowmate.knowledge.evidence import EvidenceService
        from flowmate.knowledge.parsing import _line_starts, _locator
        from flowmate.runtime.tasks import _owner

        with self.store.transaction() as tx:
            _owner(tx, ctx)
            source = self._source_for_task(tx, ctx, request.source_id)
            if request.evidence_id is not None:
                original = EvidenceService(self).resolve(ctx, [request.evidence_id])[0]
                if original.source_id != source.id or request.source_version not in {None, original.source_version}:
                    raise DomainError("knowledge_evidence_mismatch", "证据与所选来源版本不一致")
                version_number = original.source_version
            else:
                original = None
                version_number = request.source_version or source.active_version
            if version_number is None:
                return KnowledgeResult(notices=["资料仍在处理中"])
            row = tx.execute("SELECT document FROM knowledge_versions WHERE source_id=? AND version=?",
                (source.id, version_number)).fetchone()
            if row is None:
                raise DomainError("knowledge_version_missing", "来源版本不存在")
            version = SourceVersion.model_validate_json(row[0])
            parsed = self.parser.parse(self.blobs.read(version.content_hash,
                max_bytes=self.config.max_file_bytes), version.media_type)
            span_start = original.locator.start_char if original else 0
            span_end = original.locator.end_char if original else len(parsed.text)
            begin, end = min(span_start + request.offset, span_end), min(
                span_start + request.offset + request.limit, span_end)
            if begin == end:
                return KnowledgeResult(sources=[source])
            settings = KnowledgeSettings.model_validate_json(tx.execute(
                "SELECT document FROM knowledge_settings WHERE workspace_id=?", (ctx.workspace_id,)).fetchone()[0])
            locator = _locator(_line_starts(parsed.text), begin, end,
                next((section.heading_path for section in parsed.sections
                    if section.start_char <= begin < section.end_char), []))
            evidence = Evidence(id=identifier(), source_id=source.id, source_version=version.version,
                content_hash=version.content_hash, chunk_id=f"read:{begin}:{end}", locator=locator, method="read",
                excerpt=parsed.text[begin:end],
                index_generation=original.index_generation if original else settings.index_generation,
                embedding_profile=original.embedding_profile if original else settings.active_profile,
                parser_version=parsed.parser_version, chunker_version="direct-read-v1")
            prior = tx.execute("SELECT 1 FROM knowledge_searches k JOIN json_each(k.document,'$.sources') s "
                "WHERE k.run_id=? AND json_extract(s.value,'$.source_id')=? "
                "AND json_extract(s.value,'$.version')<>? LIMIT 1", (ctx.run_id, source.id, version.version)).fetchone()
            notices = ([f"来源 {source.id} 当前版本为 {source.active_version}，本次读取版本为 {version.version}"]
                if prior or source.active_version != version.version else [])
            if end < span_end:
                notices.append(f"片段尚未读完；继续读取 offset={end - span_start}")
            EvidenceService(self).register(tx, ctx, [evidence])
            return KnowledgeResult(sources=[source], evidence=[evidence], notices=notices)

    def enqueue_import(self, workspace_id, request: KnowledgeImportRequest, meta: CommandMeta):
        request = KnowledgeImportRequest.model_validate(request.model_dump())
        meta = CommandMeta.model_validate(meta.model_dump())
        fingerprint = hashlib.sha256(json.dumps({
            "operation": "knowledge.import", "workspace_id": workspace_id,
            "request": request.model_dump(mode="json"), "expected_version": meta.expected_version,
        }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        with self.store.transaction() as tx:
            previous = tx.previous_command(meta.command_id)
            if previous is not None:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict", "同一导入命令不能更改资料或项目")
                return KnowledgeImportReceipt.model_validate_json(previous["response"])
            scope = ScopeRef(kind="workspace", workspace_id=workspace_id)
            _scope(tx, scope)
            if len(request.resource_ids) > self.config.max_selected_files:
                raise DomainError("native_selection_limit", "本次加入数量超限")
            updating = None
            if request.source_id is not None:
                updating = tx.execute("SELECT * FROM knowledge_sources WHERE id=? AND workspace_id=?",
                    (request.source_id, workspace_id)).fetchone()
                if updating is None:
                    raise DomainError("not_found", "项目来源不存在")
                if updating["revision"] != meta.expected_version:
                    raise DomainError("version_conflict", "来源管理版本已改变")
                epoch = tx.execute("SELECT epoch FROM scopes WHERE id=?", (request.source_id,)).fetchone()[0]
                check_scopes(tx, [ScopeDependency(scope_id=request.source_id, epoch=epoch)])
            elif meta.expected_version is not None:
                raise DomainError("version_conflict", "新来源不接受已有版本")
            generations = admission_generations(tx, workspace_id, None)
            jobs, rejected, source_revisions = [], [], {}
            for resource_id in request.resource_ids or [None]:
                try:
                    if resource_id is not None:
                        selected = tx.execute("SELECT document FROM resources WHERE id=?", (resource_id,)).fetchone()
                        if selected is None:
                            raise DomainError("not_found", "所选文件不存在")
                        resource = ResourceRecord.model_validate_json(selected[0])
                        if resource.scope.workspace_id != workspace_id or resource.kind != "file":
                            raise DomainError("scope_mismatch", "所选项不是本项目的文件")
                        _scope(tx, resource.scope)
                        check_scopes(tx, [ScopeDependency(scope_id=resource.id, epoch=resource.version)])
                        path, identity, label = resource.canonical_path, resource.file_identity, resource.label
                    else:
                        path, identity = updating["canonical_path"], updating["file_identity"]
                        label = KnowledgeSource.model_validate_json(updating["document"]).label
                    extension = PureWindowsPath(path).suffix.lower()
                    if extension not in {".md", ".txt"}:
                        raise DomainError("file_extension_not_allowed", "首版仅支持MD/TXT")
                    snapshot = self.files.read_snapshot(FileAnchor(path, identity, "file"))
                except DomainError as error:
                    if resource_id is None:
                        raise
                    rejected.append(RejectedKnowledgeFile(resource_id=resource_id, reason=error.code))
                    continue
                row = updating or tx.execute("SELECT * FROM knowledge_sources WHERE workspace_id=? "
                    "AND file_identity=? AND status IN ('pending','active','failed') ORDER BY rowid LIMIT 1",
                    (workspace_id, identity)).fetchone()
                source = KnowledgeSource.model_validate_json(row["document"]) if row else KnowledgeSource(
                    id=identifier(), workspace_id=workspace_id, label=label)
                latest = tx.execute("SELECT version,content_hash FROM knowledge_versions WHERE source_id=? "
                    "ORDER BY version DESC LIMIT 1", (source.id,)).fetchone()
                previous_job = tx.execute("SELECT document FROM knowledge_jobs WHERE source_id=? "
                    "ORDER BY rowid DESC LIMIT 1", (source.id,)).fetchone()
                if row is None:
                    tx.execute("INSERT INTO scopes(id,kind,workspace_id) VALUES (?,'knowledge',?)",
                        (source.id, workspace_id))
                    tx.execute("INSERT INTO knowledge_sources VALUES (?,?,?,?,?,?,?)",
                        (source.id, workspace_id, source.revision, source.status, path, identity, source.model_dump_json()))
                # 明确加入接纳本地读取意图；内容去重只省略重复版本和处理任务。
                if self.policy.knowledge_grant(tx, workspace_id, source.id, "read") is None:
                    self.policy.grant(GrantCommand(scope=scope, knowledge_source_ids=[source.id], purposes=["read"]),
                        meta.model_copy(update={"expected_version": None}), tx=tx)
                if latest and latest["content_hash"] == snapshot.source_version and previous_job:
                    prior = KnowledgeJob.model_validate_json(previous_job[0])
                    if prior.status in {"queued", "running", "completed"}:
                        if (path, identity, label) != (row["canonical_path"], row["file_identity"], source.label):
                            source = source.model_copy(update={"revision": source.revision + 1, "label": label})
                            tx.execute("UPDATE knowledge_sources SET revision=?,canonical_path=?,file_identity=?,"
                                "document=? WHERE id=?", (source.revision, path, identity, source.model_dump_json(), source.id))
                            source_revisions[source.id] = source.revision
                        jobs.append(prior)
                        continue
                if row is not None:
                    source = source.model_copy(update={"revision": source.revision + 1, "label": label,
                        "status": "active" if source.active_version is not None else "pending"})
                    tx.execute("UPDATE knowledge_sources SET revision=?,status=?,canonical_path=?,file_identity=?,"
                        "document=? WHERE id=?",
                        (source.revision, source.status, path, identity, source.model_dump_json(), source.id))
                if latest is None or latest["content_hash"] != snapshot.source_version:
                    version = SourceVersion(source_id=source.id, version=latest["version"] + 1 if latest else 1,
                        content_hash=self.blobs.put(snapshot.data), byte_size=len(snapshot.data),
                        media_type="text/markdown" if extension == ".md" else "text/plain")
                    tx.execute("INSERT INTO knowledge_versions VALUES (?,?,?,?)",
                        (source.id, version.version, version.content_hash, version.model_dump_json()))
                    version_number = version.version
                else:
                    version_number = latest["version"]
                job = KnowledgeJob(id=identifier(), command_id=meta.command_id, workspace_id=workspace_id,
                    source_id=source.id, source_version=version_number, admission_generations=generations,
                    limits=request.limits)
                tx.execute("INSERT INTO knowledge_jobs VALUES (?,?,?,?,?)",
                    (job.id, workspace_id, source.id, job.status, job.model_dump_json()))
                jobs.append(job)
                source_revisions[source.id] = source.revision
            settings_revision = None
            if source_revisions and tx.execute(
                    "SELECT 1 FROM knowledge_settings WHERE workspace_id=?", (workspace_id,)).fetchone() is None:
                settings = KnowledgeSettings(workspace_id=workspace_id, index_generation=identifier())
                tx.execute("INSERT INTO knowledge_settings VALUES (?,?)", (workspace_id, settings.model_dump_json()))
                settings_revision = settings.revision
            if source_revisions:
                tx.append_event(NewEvent(kind="knowledge.changed", workspace_id=workspace_id,
                    causation_id=meta.command_id, payload=KnowledgeNotice(workspace_id=workspace_id,
                        source_revisions=source_revisions, job_revisions={job.id: job.revision for job in jobs},
                        settings_revision=settings_revision)))
            receipt = KnowledgeImportReceipt(command_id=meta.command_id, jobs=jobs, rejected=rejected)
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)",
                (meta.command_id, fingerprint, receipt.model_dump_json(), workspace_id, None))
            return receipt
