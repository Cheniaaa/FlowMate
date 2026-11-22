"""复用运行时的资料队列；本地索引可重建，active只由SQLite事务发布。"""

import asyncio
import json

from pydantic import Field

from flowmate.contracts.base import Contract, Count, DomainError, Id
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    ActivityIntent,
    ActivitySnapshot,
    CatalogVersions,
    Checkpoint,
    DeterministicConfigSnapshot,
    OutboxItem,
    RunOutput,
    RunSnapshot,
    RuntimeChange,
    ScopeDependency,
    StepDecision,
    TaskSnapshot,
)
from flowmate.knowledge.contracts import (
    DocumentChunk,
    KnowledgeNotice,
    KnowledgeSettings,
    KnowledgeSource,
    SourceVersion,
)
from flowmate.knowledge.embedding import ResolvedEmbeddingProfile
from flowmate.knowledge.ingestion_contracts import KnowledgeJob
from flowmate.runtime.transitions import (
    admission_generations,
    bump,
    check_admission,
    check_dispatch,
    check_scopes,
    emit,
    load,
    pending_outbox,
    stop_run,
)


class KnowledgeImportState(Contract):
    job_id: Id
    generation: Id
    sources: list[SourceVersion]
    source_dependencies: dict[Id, list[ScopeDependency]]
    destination_dependencies: list[ScopeDependency]
    profile: ResolvedEmbeddingProfile | None = None
    source_index: Count = 0
    chunks: list[DocumentChunk] | None = None
    embedded_until: Count = 0
    vector_activity_ids: list[Id] = Field(default_factory=list)
    chunk_count: Count = 0
    completed_chunks: dict[Id, Count] = Field(default_factory=dict)
    retired_source_ids: list[Id] = Field(default_factory=list)
    needs_source_cleanup: bool = False


# 固定分块顺序和批次边界，避免单次发送整份8MiB来源；每批均有独立Activity。
DOCUMENT_BATCH_SIZE = 128


def rebuild_source_runs(tx, source_id):
    """候选集合只用于逐源管理，不把尚未读取的正文伪装成Run全局依赖。"""
    return [RunSnapshot.model_validate_json(row[0]) for row in tx.execute(
        "SELECT r.document FROM runs r JOIN checkpoints c ON c.task_id=r.root_task_id "
        "JOIN knowledge_jobs j ON json_extract(j.document,'$.task.run_id')=r.id "
        "WHERE r.kind='knowledge' AND json_extract(j.document,'$.kind')='rebuild' AND ("
        "EXISTS(SELECT 1 FROM json_each(c.document,'$.context_manifest.knowledge_import.sources') s "
        "WHERE json_extract(s.value,'$.source_id')=?) OR "
        "EXISTS(SELECT 1 FROM json_each(c.document,'$.context_manifest.knowledge_import.retired_source_ids') s "
        "WHERE s.value=?))", (source_id, source_id))]


def prune_source_checkpoint(checkpoint, source_id):
    """移除单来源的固定版本和当前分块；其它已完成批次及游标保持可继续。"""
    state = KnowledgeImportState.model_validate_json(json.dumps(checkpoint.context_manifest["knowledge_import"]))
    position = next((index for index, source in enumerate(state.sources) if source.source_id == source_id), None)
    if position is None:
        return checkpoint
    current_removed = position == state.source_index
    cursor = state.source_index - int(position < state.source_index)
    completed = {id: count for id, count in state.completed_chunks.items() if id != source_id}
    state = state.model_copy(update={
        "sources": [source for source in state.sources if source.source_id != source_id],
        "source_dependencies": {id: items for id, items in state.source_dependencies.items() if id != source_id},
        "source_index": cursor, "completed_chunks": completed, "chunk_count": sum(completed.values()),
        "retired_source_ids": [*state.retired_source_ids, source_id], "needs_source_cleanup": True,
        **({"chunks": None, "embedded_until": 0, "vector_activity_ids": []} if current_removed else {}),
    })
    phase = checkpoint.phase
    if current_removed or phase in {"knowledge.publish", "joining"}:
        phase = ("knowledge.prune" if cursor == len(state.sources) else
            "knowledge.parse" if state.profile is not None else "knowledge.index")
    return checkpoint.model_copy(update={"phase": phase, "output": None,
        "context_manifest": {"knowledge_import": state.model_dump(mode="json")}})


def retire_rebuild_source(tx, run, source_id, causation_id=None):
    checkpoint = load(tx, Checkpoint, run.root_task_id)
    pruned = prune_source_checkpoint(checkpoint, source_id)
    if pruned == checkpoint:
        return
    sources = run.sources.model_copy(update={
        "knowledge_source_ids": [id for id in run.sources.knowledge_source_ids if id != source_id]})
    task = load(tx, TaskSnapshot, run.root_task_id)
    activities = []
    for row in tx.execute("SELECT document FROM activities WHERE run_id=?", (run.id,)).fetchall():
        activity = ActivitySnapshot.model_validate_json(row[0])
        if (activity.intent.operation == "embedding.document"
                and activity.intent.arguments["batch"]["source_id"] == source_id):
            activities.append(bump(activity, intent=activity.intent.model_copy(update={
                "arguments": {**activity.intent.arguments, "texts": [], "source_retired": True}}),
                receipt=activity.receipt.model_copy(update={"result": None}) if activity.receipt else None,
                content_committed=False))
    active = run.state not in TERMINAL
    items = []
    if active and not checkpoint.pending_activity_ids:
        items = [*pending_outbox(tx, task.id, operation="step"),
            OutboxItem(run_id=run.id, task_id=task.id, operation="step")]
    change = RuntimeChange(
        runs=[bump(run, sources=sources)], tasks=[bump(task, binding=task.binding.model_copy(update={"sources": sources}))],
        checkpoints=[pruned.model_copy(update={"version": checkpoint.version + 1})],
        activities=activities, outbox=items)
    if active:
        emit(tx, run, task.id, "task.stepped", change, causation_id)
    else:
        # 历史重建只裁剪来源副本，不再次触发Run完成发布或预算结算。
        tx.append_event(NewEvent(kind="task.stepped", workspace_id=run.workspace_id,
            run_id=run.id, task_id=task.id, causation_id=causation_id, payload=change))


def retire_rebuild_sources(tx, dependency_id, causation_id=None):
    """仅来源scope或单来源read许可可缩减；项目/embedding目的地仍停止整个Run。"""
    row = tx.execute("SELECT kind FROM scopes WHERE id=?", (dependency_id,)).fetchone()
    if row is None:
        return set()
    if row["kind"] == "knowledge":
        source_ids = [dependency_id]
    elif row["kind"] == "grant":
        from flowmate.policy.contracts import DataUseGrant

        grant = DataUseGrant.model_validate_json(tx.execute(
            "SELECT document FROM grants WHERE id=?", (dependency_id,)).fetchone()[0])
        if grant.purposes != ["read"] or grant.knowledge_scopes or len(grant.knowledge_source_ids) != 1:
            return set()
        source_ids = grant.knowledge_source_ids
    else:
        return set()
    continued = set()
    for source_id in source_ids:
        for run in rebuild_source_runs(tx, source_id):
            if run.state in TERMINAL:
                continue
            checkpoint = load(tx, Checkpoint, run.root_task_id)
            state = KnowledgeImportState.model_validate_json(json.dumps(checkpoint.context_manifest["knowledge_import"]))
            if source_id not in state.retired_source_ids:
                retire_rebuild_source(tx, run, source_id, causation_id)
            continued.add(run.id)
    return continued


def _save_job(tx, job, *, sources=()):
    if job.kind == "rebuild" and job.status in {"failed", "cancelled"}:
        from flowmate.knowledge.lifecycle import enqueue_generation_cleanup

        enqueue_generation_cleanup(tx, job.workspace_id, job.target_generation)
    tx.execute("UPDATE knowledge_jobs SET status=?,document=? WHERE id=?",
        (job.status, job.model_dump_json(), job.id))
    tx.append_event(NewEvent(kind="knowledge.changed", workspace_id=job.workspace_id,
        payload=KnowledgeNotice(workspace_id=job.workspace_id,
            job_revisions={job.id: job.revision},
            source_revisions={source.id: source.revision for source in sources})))


class KnowledgeIngestion:
    def __init__(self, knowledge, service):
        from flowmate.knowledge.lifecycle import KnowledgeLifecycle

        self.knowledge, self.service = knowledge, service
        self.store = knowledge.store
        self._writers = {}
        self.lifecycle = KnowledgeLifecycle(knowledge, writers=self._writers)

    def admit_next(self, workspace_id):
        with self.store.transaction() as tx:
            if tx.execute("SELECT 1 FROM knowledge_jobs WHERE workspace_id=? AND status='running'",
                    (workspace_id,)).fetchone():
                return None
            for row in tx.execute("SELECT document FROM knowledge_jobs WHERE workspace_id=? AND status='queued' "
                    "ORDER BY rowid", (workspace_id,)).fetchall():
                job = KnowledgeJob.model_validate_json(row[0])
                current = admission_generations(tx, workspace_id, None)
                reason = "admission_stopped" if current != job.admission_generations else None
                workspace = tx.execute("SELECT status FROM scopes WHERE id=?", (workspace_id,)).fetchone()
                if workspace["status"] != "active":
                    reason = "scope_revoked"
                if job.kind == "import":
                    scope = tx.execute("SELECT status FROM scopes WHERE id=?", (job.source_id,)).fetchone()
                    if scope["status"] != "active":
                        reason = "scope_revoked"
                settings = self.knowledge.settings_tx(tx, workspace_id)
                if job.kind == "rebuild" and settings.rebuild_job_id != job.id:
                    reason = "knowledge_rebuild_superseded"
                if reason is not None:
                    _save_job(tx, job.model_copy(update={"revision": job.revision + 1,
                        "status": "cancelled", "reason": reason}))
                    continue
                if job.kind == "import":
                    job = job.model_copy(update={"target_profile": settings.active_profile,
                        "target_generation": settings.index_generation})
                try:
                    handle = self.service.start_knowledge_import(tx, job,
                        DeterministicConfigSnapshot(catalog=CatalogVersions()))
                except DomainError as error:
                    _save_job(tx, job.model_copy(update={"revision": job.revision + 1,
                        "status": "failed", "reason": error.code}))
                    continue
                _save_job(tx, job.model_copy(update={"revision": job.revision + 1,
                    "status": "running", "task": handle}))
                return handle
        return None

    def activate_ready(self):
        with self.store.transaction(write=False) as tx:
            workspaces = [row[0] for row in tx.execute(
                "SELECT DISTINCT workspace_id FROM knowledge_jobs WHERE status='queued'")]
        for workspace_id in workspaces:
            self.admit_next(workspace_id)

    def _check(self, ctx, state):
        with self.store.transaction(write=False) as tx:
            run, task = load(tx, RunSnapshot, ctx.run_id), load(tx, TaskSnapshot, ctx.task_id)
            check_dispatch(tx, run, task, self.service.clock())
            job = KnowledgeJob.model_validate_json(tx.execute(
                "SELECT document FROM knowledge_jobs WHERE id=?", (state.job_id,)).fetchone()[0])
            settings = self.knowledge.settings_tx(tx, ctx.workspace_id)
            if job.kind == "rebuild":
                if settings.rebuild_job_id != job.id or settings.desired_profile != job.target_profile:
                    raise DomainError("knowledge_rebuild_superseded", "重建目标已被替换")
            elif (settings.index_generation != state.generation
                    or settings.active_profile != job.target_profile):
                raise DomainError("knowledge_publication_conflict", "导入索引配置已改变")
            dependencies = list(run.scope_dependencies)
            dependencies.extend(state.destination_dependencies)
            for row in tx.execute("SELECT document FROM activities WHERE run_id=?", (run.id,)):
                activity = ActivitySnapshot.model_validate_json(row[0])
                if activity.intent.arguments.get("source_retired"):
                    continue
                dependencies.extend(activity.intent.dependencies)
                if activity.receipt is not None:
                    dependencies.extend(activity.receipt.source_dependencies)
            check_scopes(tx, dependencies)
            dependencies = (state.source_dependencies[state.sources[state.source_index].source_id]
                if state.source_index < len(state.sources) else [])
            check_scopes(tx, dependencies)
            decision = self.knowledge.policy.check_tx(tx, ctx, dependencies, "read")
            if not decision.allowed:
                raise DomainError("grant_required", "导入来源的读取许可已失效")

    def _parse(self, ctx, state):
        self._check(ctx, state)
        source = state.sources[state.source_index]
        raw = self.knowledge.blobs.read(source.content_hash, max_bytes=self.knowledge.config.max_file_bytes)
        document = self.knowledge.parser.parse(raw, source.media_type)
        return self.knowledge.chunker.chunk(document)

    def _index(self, ctx, state):
        self._check(ctx, state)
        source = state.sources[state.source_index]
        chunks = self._parse(ctx, state) if state.chunks is None else state.chunks
        vectors = None
        if state.profile is not None and chunks:
            vectors = []
            with self.store.transaction(write=False) as tx:
                for activity_id in state.vector_activity_ids:
                    activity = load(tx, ActivitySnapshot, activity_id)
                    vectors.extend(activity.receipt.result["vectors"])
        self.knowledge.retriever_factory(self.store.path.parent / "knowledge", ctx.workspace_id).write_version(
            state.generation, source, chunks, vectors=vectors)
        return len(chunks)

    def _prune(self, ctx, state):
        self._check(ctx, state)
        retriever = self.knowledge.retriever_factory(self.store.path.parent / "knowledge", ctx.workspace_id)
        for source_id in state.retired_source_ids:
            retriever.purge_source(source_id)

    @staticmethod
    def finish_run(tx, run):
        """由终态事件事务调用：任务完成、来源发布及队列通知一起提交或回滚。"""
        checkpoint = load(tx, Checkpoint, run.root_task_id)
        state = KnowledgeImportState.model_validate_json(json.dumps(checkpoint.context_manifest["knowledge_import"]))
        job = KnowledgeJob.model_validate_json(tx.execute(
            "SELECT document FROM knowledge_jobs WHERE id=?", (state.job_id,)).fetchone()[0])
        sources = []
        if run.state == "completed":
            check_admission(tx, run)
            check_scopes(tx, run.scope_dependencies)
            check_scopes(tx, state.destination_dependencies)
            for row in tx.execute("SELECT document FROM activities WHERE run_id=?", (run.id,)):
                activity = ActivitySnapshot.model_validate_json(row[0])
                if activity.intent.arguments.get("source_retired"):
                    continue
                check_scopes(tx, [*activity.intent.dependencies, *activity.receipt.source_dependencies])
            check_scopes(tx, [dependency for items in state.source_dependencies.values() for dependency in items])
            settings = KnowledgeSettings.model_validate_json(tx.execute(
                "SELECT document FROM knowledge_settings WHERE workspace_id=?", (run.workspace_id,)).fetchone()[0])
            if state.source_index != len(state.sources) or state.needs_source_cleanup:
                raise DomainError("knowledge_publication_conflict", "资料处理的目标版本已改变")
            if job.kind == "rebuild":
                if settings.rebuild_job_id != job.id or settings.desired_profile != job.target_profile:
                    raise DomainError("knowledge_rebuild_superseded", "重建目标已被替换")
                from flowmate.knowledge.lifecycle import enqueue_generation_cleanup

                enqueue_generation_cleanup(tx, run.workspace_id, settings.index_generation)
                settings = settings.model_copy(update={"revision": settings.revision + 1,
                    "active_profile": job.target_profile, "index_generation": state.generation})
                tx.execute("UPDATE knowledge_settings SET document=? WHERE workspace_id=?",
                    (settings.model_dump_json(), run.workspace_id))
                tx.append_event(NewEvent(kind="knowledge.changed", workspace_id=run.workspace_id,
                    payload=KnowledgeNotice(workspace_id=run.workspace_id, settings_revision=settings.revision)))
            else:
                source = KnowledgeSource.model_validate_json(tx.execute(
                    "SELECT document FROM knowledge_sources WHERE id=?", (job.source_id,)).fetchone()[0])
                if (settings.index_generation != state.generation or settings.active_profile != job.target_profile
                        or source.active_version is not None and source.active_version > job.source_version):
                    raise DomainError("knowledge_publication_conflict", "资料处理的目标版本已改变")
                sources.append(source.model_copy(update={"revision": source.revision + 1,
                    "active_version": job.source_version, "status": "active"}))
        elif run.state == "failed" and job.kind == "import":
            source = KnowledgeSource.model_validate_json(tx.execute(
                "SELECT document FROM knowledge_sources WHERE id=?", (job.source_id,)).fetchone()[0])
            if source.active_version is None and source.status == "pending":
                sources.append(source.model_copy(update={"revision": source.revision + 1, "status": "failed"}))
        for source in sources:
            tx.execute("UPDATE knowledge_sources SET revision=?,status=?,document=? WHERE id=?",
                (source.revision, source.status, source.model_dump_json(), source.id))
        _save_job(tx, job.model_copy(update={"revision": job.revision + 1,
            "status": run.state, "reason": run.reason}), sources=sources)


class KnowledgeImportExecutor:
    def __init__(self, ingestion):
        self.ingestion = ingestion

    async def step(self, ctx, checkpoint):
        state = KnowledgeImportState.model_validate_json(json.dumps(checkpoint.context_manifest["knowledge_import"]))
        try:
            self.ingestion._check(ctx, state)
            if checkpoint.phase == "knowledge.publish":
                return StepDecision(kind="complete", output=RunOutput(summary=f"资料已处理，共 {state.chunk_count} 个片段。"))
            if checkpoint.phase == "knowledge.embedding":
                source = state.sources[state.source_index]
                batch = {"job_id": state.job_id, "source_id": source.source_id, "source_version": source.version,
                    "start": state.embedded_until, "end": min(len(state.chunks), state.embedded_until + DOCUMENT_BATCH_SIZE)}
                with self.ingestion.store.transaction(write=False) as tx:
                    existing = [ActivitySnapshot.model_validate_json(row[0]) for row in tx.execute(
                        "SELECT document FROM activities WHERE task_id=? AND "
                        "json_extract(document,'$.intent.operation')='embedding.document'", (ctx.task_id,))]
                activity = next((item for item in existing if item.intent.arguments["batch"] == batch), None)
                if activity is not None:
                    if activity.receipt is None or not activity.receipt.confirmed:
                        return StepDecision(kind="fail", reason="knowledge_document_unknown")
                    if activity.receipt.error or not activity.content_committed:
                        return StepDecision(kind="fail", reason=activity.receipt.error or "knowledge_embedding_failed")
                    state = state.model_copy(update={"embedded_until": batch["end"],
                        "vector_activity_ids": [*state.vector_activity_ids, activity.id]})
                    if state.embedded_until == len(state.chunks):
                        return self._continue(checkpoint, state, "knowledge.index")
                    batch = {**batch, "start": state.embedded_until,
                        "end": min(len(state.chunks), state.embedded_until + DOCUMENT_BATCH_SIZE)}
                if self.ingestion.knowledge.embedding is None:
                    return StepDecision(kind="fail", reason="knowledge_embedding_unavailable")
                return StepDecision(kind="activity", checkpoint=self._checkpoint(checkpoint, state, "knowledge.embedding"),
                    intent=ActivityIntent(kind="model" if state.profile.connection is not None else "tool",
                        origin="runtime", operation="embedding.document",
                        arguments={"profile": state.profile.model_dump(mode="json"),
                            "texts": [chunk.text for chunk in state.chunks[batch["start"]:batch["end"]]], "batch": batch},
                        dependencies=[*ctx.scope_dependencies, *state.source_dependencies[source.source_id]]))
            lock = self.ingestion._writers.setdefault(ctx.workspace_id, asyncio.Lock())
            async with lock:
                operation = (self.ingestion._parse if checkpoint.phase == "knowledge.parse" else
                    self.ingestion._prune if checkpoint.phase == "knowledge.prune" else self.ingestion._index)
                work = asyncio.create_task(asyncio.to_thread(operation, ctx, state))
                cancelled = False
                while True:
                    try:
                        result = await asyncio.shield(work)
                        break
                    except asyncio.CancelledError:
                        # 重复取消也必须等待真实线程退出，不能提前释放writer。
                        cancelled = True
                if cancelled:
                    raise asyncio.CancelledError
            if checkpoint.phase == "knowledge.parse":
                state = state.model_copy(update={"chunks": result})
                return self._continue(checkpoint, state, "knowledge.embedding" if result else "knowledge.index")
            if checkpoint.phase == "knowledge.prune":
                return self._continue(checkpoint, state.model_copy(update={"needs_source_cleanup": False}), "knowledge.publish")
            completed = {**state.completed_chunks, state.sources[state.source_index].source_id: result}
            state = state.model_copy(update={"source_index": state.source_index + 1,
                "chunk_count": sum(completed.values()), "completed_chunks": completed, "chunks": None,
                "embedded_until": 0, "vector_activity_ids": []})
            phase = (("knowledge.prune" if state.needs_source_cleanup else "knowledge.publish")
                if state.source_index == len(state.sources) else
                "knowledge.parse" if state.profile is not None else "knowledge.index")
            return self._continue(checkpoint, state, phase)
        except DomainError as error:
            return StepDecision(kind="fail", reason=error.code)

    @staticmethod
    def _checkpoint(checkpoint, state, phase):
        return checkpoint.model_copy(update={"phase": phase,
            "context_manifest": {"knowledge_import": state.model_dump(mode="json")}})

    def _continue(self, checkpoint, state, phase):
        return StepDecision(kind="continue", checkpoint=self._checkpoint(checkpoint, state, phase))


def recover_local_import(tx, run, root):
    """重用已提交document回执；未知派发由Runtime恢复入口先行终结。"""
    if run.state in {"interrupted", "blocked_incompatible"} and run.reason != "runtime_restart":
        return False
    checkpoint = load(tx, Checkpoint, root.id)
    if checkpoint.phase not in {"knowledge.parse", "knowledge.embedding", "knowledge.index", "knowledge.prune", "knowledge.publish", "joining"}:
        return False
    activities = [ActivitySnapshot.model_validate_json(row[0]) for row in tx.execute(
        "SELECT document FROM activities WHERE run_id=?", (run.id,))]
    try:
        check_scopes(tx, run.scope_dependencies)
        state = KnowledgeImportState.model_validate_json(json.dumps(checkpoint.context_manifest["knowledge_import"]))
        check_scopes(tx, state.destination_dependencies)
        check_admission(tx, run)
        for activity in activities:
            if activity.intent.arguments.get("source_retired"):
                continue
            check_scopes(tx, [*activity.intent.dependencies,
                *(activity.receipt.source_dependencies if activity.receipt else [])])
    except DomainError as error:
        stop_run(tx, run, "cancelled", error.code)
        return True
    if checkpoint.phase == "joining":
        return True
    prepared = any(activity.state == "prepared" for activity in activities)
    emit(tx, run, root.id, "runtime.recovered", RuntimeChange(
        runs=[bump(run, state="running", reason=None)], tasks=[bump(root, state="queued", reason=None)],
        outbox=[*pending_outbox(tx, root.id), *([] if prepared else [
            OutboxItem(run_id=run.id, task_id=root.id, operation="step")])]))
    return True
