"""SQLite先提交来源围栏；派生文件在排空项目writer后可重入清理。"""

import asyncio
import json

from flowmate.artifacts.store import ArtifactStore
from flowmate.contracts.base import CommandMeta, DomainError
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    AccountingActivity,
    AccountingBudget,
    ActivitySnapshot,
    BudgetSnapshot,
    Checkpoint,
    ModelMessage,
    RunSnapshot,
    RuntimeChange,
    ScopeDependency,
    TaskSnapshot,
    TextPart,
)
from flowmate.contracts.scopes import ScopeRef
from flowmate.knowledge.contracts import KnowledgeNotice, KnowledgeSource
from flowmate.knowledge.ingestion_contracts import KnowledgeJob
from flowmate.memory.lifecycle import invalidate_sources
from flowmate.policy.contracts import LifecycleChange, ScopeState
from flowmate.policy.lifecycle import (
    ScopeLifecycle,
    _dependent_runs,
    _fingerprint,
    _interrupt_dependents,
    _replay,
)
from flowmate.policy.service import _policy_event, _scope
from flowmate.runtime.transitions import bump, emit, load


def _enqueue(tx, workspace_id, *, source_id=None, generation=None):
    key = ("source:" + source_id if source_id else
        "generation:" + generation if generation else "workspace:" + workspace_id)
    tx.execute("INSERT INTO knowledge_cleanup VALUES (?,?,?,?,1,NULL) "
        "ON CONFLICT(id) DO UPDATE SET revision=revision+1,last_error=NULL",
        (key, workspace_id, source_id, generation))


def enqueue_generation_cleanup(tx, workspace_id, generation):
    """由发布/终结事务登记已经退休的generation；不能登记仍在使用的generation。"""
    _enqueue(tx, workspace_id, generation=generation)


def enqueue_workspace_cleanup(tx, workspace_id):
    """在项目FK删除前登记；此记录故意不依赖即将删除的项目。"""
    _enqueue(tx, workspace_id)


def _generation_bound(tx, generation):
    return generation is not None and tx.execute(
        "SELECT 1 FROM knowledge_searches k JOIN tasks t ON t.id=k.task_id JOIN runs r ON r.id=k.run_id "
        "WHERE json_extract(k.document,'$.index_generation')=? AND k.result IS NULL "
        "AND t.state NOT IN ('completed','failed','cancelled') "
        "AND r.state NOT IN ('completed','failed','cancelled') LIMIT 1", (generation,)).fetchone() is not None


def _save_source(tx, source):
    tx.execute("UPDATE knowledge_sources SET revision=?,status=?,document=? WHERE id=?",
        (source.revision, source.status, source.model_dump_json(), source.id))
    tx.append_event(NewEvent(kind="knowledge.changed", workspace_id=source.workspace_id,
        payload=KnowledgeNotice(workspace_id=source.workspace_id, source_revisions={source.id: source.revision})))


def _forget_commands(tx, where, parameters):
    tx.execute("INSERT OR IGNORE INTO deleted_commands SELECT command_id,request_hash FROM commands WHERE " + where,
        parameters)
    tx.execute("DELETE FROM commands WHERE " + where, parameters)


def _delete_run_content(tx, run_id, dependency):
    """按已声明provenance清除整个受影响交互；不做句子分析，保留无正文失效占位。"""
    run = load(tx, RunSnapshot, run_id)
    job = tx.execute("SELECT json_extract(document,'$.kind') FROM knowledge_jobs WHERE "
        "json_extract(document,'$.task.run_id')=?", (run_id,)).fetchone()
    if run.kind == "knowledge" and job is not None and job[0] == "rebuild":
        _delete_rebuild_source_content(tx, run, dependency.scope_id)
        return
    budget = load(tx, BudgetSnapshot, run.budget_id)
    archived_budget = AccountingBudget(**budget.model_dump(include=AccountingBudget.model_fields.keys()),
        budget_group_id=run.budget_group_id)
    tx.execute("INSERT INTO accounting_budgets VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",
        (budget.id, run.id, archived_budget.model_dump_json()))
    for row in tx.execute("SELECT document FROM activities WHERE run_id=?", (run_id,)).fetchall():
        activity = ActivitySnapshot.model_validate_json(row[0])
        receipt = activity.receipt
        if receipt is not None:
            receipt = receipt.model_copy(update={"result": None, "error": None,
                "source_dependencies": [], "source_observations": []})
        archived = AccountingActivity(**activity.model_dump(include={
            "id", "version", "run_id", "attempt_id", "state", "reserved_units", "reserved_tokens", "result_digest"}),
            budget_id=budget.id, receipt=receipt, kind=activity.intent.kind, operation=activity.intent.operation,
            dispatched=activity.request_digest is not None)
        tx.execute("INSERT INTO accounting_activities VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING",
            (activity.id, run_id, budget.id, archived.model_dump_json()))
    tx.execute("INSERT OR IGNORE INTO content_cleanup(content_hash) SELECT content_hash FROM artifacts WHERE run_id=?",
        (run_id,))
    tx.execute("INSERT OR IGNORE INTO content_cleanup(content_hash) SELECT content_hash FROM artifact_staging "
        "WHERE activity_id IN (SELECT id FROM activities WHERE run_id=?)", (run_id,))
    tx.execute("DELETE FROM artifact_staging WHERE activity_id IN (SELECT id FROM activities WHERE run_id=?)", (run_id,))
    tx.execute("DELETE FROM context_summaries WHERE task_id IN (SELECT id FROM tasks WHERE run_id=?)", (run_id,))
    for table in ("delivery_outbox", "session_inbox"):
        tx.execute(f"DELETE FROM {table} WHERE source_event_id IN (SELECT event_id FROM events WHERE run_id=?)", (run_id,))
    tx.execute("DELETE FROM follow_up_intents WHERE json_extract(document,'$.origin_run_id')=? "
        "OR json_extract(document,'$.run_id')=?", (run_id, run_id))
    tx.execute("DELETE FROM knowledge_searches WHERE run_id=?", (run_id,))
    tx.execute("DELETE FROM knowledge_evidence WHERE activity_id IN (SELECT id FROM activities WHERE run_id=?)", (run_id,))
    tx.execute("DELETE FROM joins WHERE event_id IN (SELECT event_id FROM events WHERE run_id=?)", (run_id,))
    for table in ("private_states", "approvals", "questions", "artifacts", "messages", "outbox", "activities"):
        tx.execute(f"DELETE FROM {table} WHERE run_id=?", (run_id,))
    tx.execute("DELETE FROM task_submissions WHERE run_id=? OR origin_run_id=?", (run_id, run_id))
    _forget_commands(tx, "json_extract(response,'$.run_id')=? OR json_extract(response,'$.handle.run_id')=? "
        "OR json_extract(response,'$.id')=?", (run_id, run_id, run_id))
    tx.execute("DELETE FROM pending_user_commands WHERE json_extract(document,'$.run_id')=?", (run_id,))
    tx.execute("DELETE FROM events WHERE run_id=?", (run_id,))
    # Run/Task身份和费用继续可核对；旧内容与私有续接不再存在。
    run = bump(run, output=None, reason="knowledge_privacy_deleted")
    tasks, checkpoints, messages = [], [], []
    for row in tx.execute("SELECT document FROM tasks WHERE run_id=?", (run_id,)).fetchall():
        task = TaskSnapshot.model_validate_json(row[0])
        binding = task.binding.model_copy(update={
            "agent_work": None, "input_artifacts": [], "input_result": None, "additional_result_inputs": []})
        tasks.append(bump(task, binding=binding, reason="knowledge_privacy_deleted"))
        previous = load(tx, Checkpoint, task.id)
        checkpoints.append(Checkpoint(task_id=task.id, version=previous.version + 1,
            phase="waiting_user", output_dependencies=[dependency]))
        messages.append((task.id, ModelMessage(role="user", parts=[TextPart(text="所用资料已隐私删除。")],
            source_dependencies=[dependency])))
    # 生命周期清理只更新既有终态事实，不再次触发完成发布/导入finish_run。
    tx.append_event(NewEvent(kind="task.stepped", workspace_id=run.workspace_id,
        session_id=run.interaction_session_id, run_id=run.id, task_id=run.root_task_id,
        payload=RuntimeChange(runs=[run], tasks=tasks, checkpoints=checkpoints)))
    for task_id, message in messages:
        emit(tx, run, task_id, "task.stepped", RuntimeChange(messages=[message]))


def _delete_rebuild_source_content(tx, run, source_id):
    """只清该源的重建副本，保留其它合法批次和同一活动预算的继续事实。"""
    from flowmate.knowledge.ingestion import prune_source_checkpoint, retire_rebuild_source

    retire_rebuild_source(tx, run, source_id)
    for row in tx.execute("SELECT event_id,document FROM events WHERE run_id=?", (run.id,)).fetchall():
        event = json.loads(row["document"])
        payload = event["payload"]
        changed = False
        for checkpoint in payload.get("checkpoints", []):
            if "knowledge_import" not in checkpoint["context_manifest"]:
                continue
            original = Checkpoint.model_validate_json(json.dumps(checkpoint))
            pruned = prune_source_checkpoint(original, source_id)
            if pruned != original:
                checkpoint.clear()
                checkpoint.update(pruned.model_dump(mode="json"))
                changed = True
        for activity in payload.get("activities", []):
            intent = activity["intent"]
            if (intent["operation"] == "embedding.document"
                    and intent["arguments"]["batch"]["source_id"] == source_id):
                intent["arguments"].update({"texts": [], "source_retired": True})
                if activity["receipt"] is not None:
                    activity["receipt"]["result"] = None
                activity["content_committed"] = False
                changed = True
        if changed:
            tx.execute("UPDATE events SET document=? WHERE event_id=?",
                (json.dumps(event, ensure_ascii=False, separators=(",", ":")), row["event_id"]))
    _forget_commands(tx, "json_extract(response,'$.run_id')=? OR json_extract(response,'$.handle.run_id')=? "
        "OR json_extract(response,'$.id')=?", (run.id, run.id, run.id))


class KnowledgeLifecycle:
    def __init__(self, knowledge, *, writers):
        self.knowledge, self.store, self.writers = knowledge, knowledge.store, writers

    def apply(self, source_id, action, meta) -> KnowledgeSource:
        if action not in {"remove", "revoke", "delete"}:
            raise DomainError("knowledge_action_invalid", "来源操作无效")
        meta = CommandMeta.model_validate(meta.model_dump())
        fingerprint = _fingerprint("knowledge." + action, {"source_id": source_id}, meta)
        with self.knowledge.policy.memory_provider.atomic(), self.store.transaction() as tx:
            previous = _replay(tx, meta, fingerprint, KnowledgeSource)
            if previous is not None:
                return previous
            row = tx.execute("SELECT document FROM knowledge_sources WHERE id=?", (source_id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "项目资料不存在")
            source = KnowledgeSource.model_validate_json(row[0])
            scope = ScopeRef(kind="workspace", workspace_id=source.workspace_id)
            _scope(tx, scope)
            if source.revision != meta.expected_version:
                raise DomainError("version_conflict", "来源管理版本已改变")
            target = {"remove": "removed", "revoke": "revoked", "delete": "deleted"}[action]
            if source.status == "deleted" or source.status == "revoked" and action == "remove":
                if source.status != target:
                    raise DomainError("scope_revoked", "已停止使用或删除的来源不能恢复使用")
            if source.status != target:
                epoch = tx.execute("SELECT epoch FROM scopes WHERE id=?", (source_id,)).fetchone()[0]
                dependency = ScopeDependency(scope_id=source_id, epoch=epoch)
                state = ScopeState(id=source_id, scope=scope, epoch=epoch + 1,
                    status="deleted" if action == "delete" else "revoked")
                _policy_event(tx, "scope.deleted" if action == "delete" else "scope.revoked",
                    LifecycleChange(scopes=[state]), scope, causation_id=meta.command_id)
                source = source.model_copy(update={"revision": source.revision + 1, "status": target,
                    "cleanup_status": "pending", "cleanup_reason": None,
                    **({"label": "已删除资料", "active_version": None} if action == "delete" else {})})
                _save_source(tx, source)
                _enqueue(tx, source.workspace_id, source_id=source_id)
                _interrupt_dependents(tx, source_id, meta.command_id)
                for queued in tx.execute("SELECT document FROM knowledge_jobs WHERE source_id=? AND status='queued'",
                        (source_id,)).fetchall():
                    job = KnowledgeJob.model_validate_json(queued[0])
                    job = job.model_copy(update={"revision": job.revision + 1, "status": "cancelled", "reason": "scope_revoked"})
                    tx.execute("UPDATE knowledge_jobs SET status=?,document=? WHERE id=?",
                        (job.status, job.model_dump_json(), job.id))
                    tx.append_event(NewEvent(kind="knowledge.changed", workspace_id=source.workspace_id,
                        payload=KnowledgeNotice(workspace_id=source.workspace_id, job_revisions={job.id: job.revision})))
                invalidated = invalidate_sources(tx, self.knowledge.policy.memory_provider.using(tx), source_id=source_id)
                # 记忆tombstone会清空旧依赖；实际消费者保留原来源围栏，供后续隐私删除定位。
                for memory_id in invalidated:
                    for run_id in _dependent_runs(tx, memory_id):
                        run = load(tx, RunSnapshot, run_id)
                        if source_id not in {item.scope_id for item in run.scope_dependencies}:
                            run = bump(run, scope_dependencies=[*run.scope_dependencies, dependency])
                            tx.execute("UPDATE runs SET document=? WHERE id=?", (run.model_dump_json(), run.id))
                _interrupt_dependents(tx, source_id, meta.command_id)
                if action == "delete":
                    from flowmate.knowledge.ingestion import rebuild_source_runs

                    affected = _dependent_runs(tx, source_id) | {run.id for run in rebuild_source_runs(tx, source_id)}
                    for run_id in sorted(affected):
                        _delete_run_content(tx, run_id, dependency)
                    tx.execute("DELETE FROM knowledge_searches WHERE id IN "
                        "(SELECT k.id FROM knowledge_searches k,json_each(k.document,'$.sources') s "
                        "WHERE json_extract(s.value,'$.source_id')=?)", (source_id,))
                    tx.execute("INSERT OR IGNORE INTO content_cleanup(content_hash) "
                        "SELECT content_hash FROM knowledge_versions WHERE source_id=?", (source_id,))
                    tx.execute("DELETE FROM knowledge_versions WHERE source_id=?", (source_id,))
                    tx.execute("DELETE FROM knowledge_evidence WHERE source_id=?", (source_id,))
                    tx.execute("UPDATE knowledge_sources SET canonical_path='',file_identity='' WHERE id=?", (source_id,))
                    _forget_commands(tx, "json_extract(response,'$.id')=?", (source_id,))
                    tx.execute("UPDATE cleanup_state SET wal_pending=1 WHERE singleton=1")
            elif source.cleanup_status in {"pending", "failed"}:
                source = source.model_copy(update={"revision": source.revision + 1,
                    "cleanup_status": "pending", "cleanup_reason": None})
                _save_source(tx, source)
                _enqueue(tx, source.workspace_id, source_id=source_id)
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)",
                (meta.command_id, fingerprint, source.model_dump_json(), source.workspace_id, None))
            return source

    def pending_workspaces(self, *, retry_failed=False):
        with self.store.transaction(write=False) as tx:
            return list(dict.fromkeys(row["workspace_id"] for row in tx.execute(
                "SELECT workspace_id,generation FROM knowledge_cleanup WHERE last_error IS NULL OR ?", (retry_failed,))
                if not _generation_bound(tx, row["generation"])))

    async def collect(self, *, workspace_id=None, retry_failed=True):
        with self.store.transaction(write=False) as tx:
            workspaces = [row[0] for row in tx.execute("SELECT DISTINCT workspace_id FROM knowledge_cleanup "
                "WHERE (? IS NULL OR workspace_id=?)", (workspace_id, workspace_id))]
        for id in workspaces:
            async with self.writers.setdefault(id, asyncio.Lock()):
                work = asyncio.create_task(asyncio.to_thread(self._collect_workspace, id, retry_failed=retry_failed))
                cancelled = False
                while True:
                    try:
                        await asyncio.shield(work)
                        break
                    except asyncio.CancelledError:
                        # 多次取消也不能取消to_thread的等待句柄并提前释放writer锁。
                        cancelled = True
                if cancelled:
                    raise asyncio.CancelledError

    def _collect_workspace(self, workspace_id, *, retry_failed):
        with self.store.transaction(write=False) as tx:
            records = [dict(row) for row in tx.execute(
                "SELECT * FROM knowledge_cleanup WHERE workspace_id=? AND (last_error IS NULL OR ?) "
                "ORDER BY source_id IS NULL AND generation IS NULL",
                (workspace_id, retry_failed)) if not _generation_bound(tx, row["generation"])]
        completed = []
        for record in records:
            try:
                retriever = self.knowledge.retriever_factory(self.store.path.parent / "knowledge", workspace_id)
                if record["source_id"] is not None:
                    retriever.purge_source(record["source_id"])
                elif record["generation"] is not None:
                    with self.store.transaction(write=False) as tx:
                        active = tx.execute("SELECT json_extract(document,'$.index_generation') "
                            "FROM knowledge_settings WHERE workspace_id=?", (workspace_id,)).fetchone()
                    if active is not None and active[0] == record["generation"]:
                        raise DomainError("knowledge_cleanup_active_generation", "仍在使用的索引不能清理")
                    retriever.drop_generation(record["generation"])
                else:
                    retriever.drop_workspace()
            except DomainError as error:
                if error.code not in {"knowledge_index_cleanup_failed", "knowledge_index_open_failed", "knowledge_unavailable"}:
                    raise
                self._cleanup_result(record, "index_cleanup_failed")
            else:
                completed.append(record)
        artifacts = ArtifactStore(self.store, self.knowledge.policy, self.knowledge.files)
        ScopeLifecycle(self.store, self.knowledge.policy, artifacts).collect_content()
        with self.store.transaction(write=False) as tx:
            blob_pending = tx.execute("SELECT 1 FROM content_cleanup LIMIT 1").fetchone()
            wal_pending = tx.execute("SELECT wal_pending FROM cleanup_state WHERE singleton=1").fetchone()[0]
        reason = ("content_cleanup_failed" if blob_pending else
            "storage_checkpoint_pending" if wal_pending else None)
        for record in completed:
            self._cleanup_result(record, reason)

    def _cleanup_result(self, record, reason):
        with self.store.transaction() as tx:
            current = tx.execute("SELECT revision FROM knowledge_cleanup WHERE id=?", (record["id"],)).fetchone()
            # 物理操作期间可能有新删除或升级；旧清理结果不能覆盖新义务。
            if current is None or current[0] != record["revision"]:
                return
            if reason is None:
                tx.execute("DELETE FROM knowledge_cleanup WHERE id=?", (record["id"],))
            else:
                tx.execute("UPDATE knowledge_cleanup SET last_error=? WHERE id=?", (reason, record["id"]))
            row = tx.execute("SELECT document FROM knowledge_sources WHERE id=?", (record["source_id"],)).fetchone()
            if row is not None:
                source = KnowledgeSource.model_validate_json(row[0])
                status = "complete" if reason is None else "failed"
                if (source.cleanup_status, source.cleanup_reason) != (status, reason):
                    _save_source(tx, source.model_copy(update={"revision": source.revision + 1,
                        "cleanup_status": status, "cleanup_reason": reason}))
