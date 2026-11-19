"""范围围栏、隐私删除和无内容的迟到费用记录。"""

import hashlib
import json
from contextlib import nullcontext

from flowmate.contracts.base import CommandMeta, DomainError
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    AccountingActivity,
    AccountingBudget,
    ActivitySnapshot,
    BudgetSnapshot,
    Question,
    RunSnapshot,
    RuntimeChange,
    TaskSnapshot,
    WaitRecord,
)
from flowmate.contracts.scopes import ScopeRef
from flowmate.policy.contracts import (
    Approval,
    CleanupSummary,
    DataUseGrant,
    DeletionReceipt,
    LifecycleChange,
    PolicyChange,
    ScopeState,
)
from flowmate.policy.service import _document, _policy_event
from flowmate.runtime.transitions import bump, can_publish, emit, stop_run


def _where(scope):
    # 会话删除绝不匹配 workspace 级共享记录。
    if scope.session_id is not None:
        return "session_id=?", (scope.session_id,)
    return "workspace_id=?", (scope.workspace_id,)


def _run_where(scope):
    if scope.session_id is not None:
        return "interaction_session_id=?", (scope.session_id,)
    return "workspace_id=?", (scope.workspace_id,)


def _fingerprint(operation, parameters, meta):
    canonical = json.dumps({"operation": operation, "parameters": parameters,
                            "expected_version": meta.expected_version}, sort_keys=True,
                           separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _replay(tx, meta, fingerprint, model):
    previous = tx.previous_command(meta.command_id)
    if previous is None:
        return None
    if previous["request_hash"] != fingerprint:
        raise DomainError("command_conflict", "同一命令不能更改操作或参数")
    return model.model_validate_json(previous["response"])


def _save_command(tx, meta, fingerprint, result):
    tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)",
               (meta.command_id, fingerprint, result.model_dump_json(),
                result.scope.workspace_id, result.scope.session_id))


def apply_deletion(tx, receipt, event_id):
    """由 reducer 在围栏和计费归档之后调用；本函数不另开事务或发送事件。"""
    scope = receipt.scope
    # 删除来源前先消除其派生记忆正文，保留无内容 tombstone 抑制迟到提案。
    from flowmate.memory.lifecycle import invalidate_sources
    invalidate_sources(tx)
    from flowmate.skills.service import SkillService
    SkillService.invalidate_sources(tx)
    where, params = _where(scope)
    run_where, run_params = _run_where(scope)
    runs = f"SELECT id FROM runs WHERE {run_where}"
    from flowmate.context.summary_store import delete_scope_tx
    delete_scope_tx(tx, scope)
    sessions_where = "id=?" if scope.session_id else "workspace_id=?"
    for table, column in (("follow_up_intents", "target_session_id"), ("pending_user_commands", "session_id")):
        tx.execute(f"DELETE FROM {table} WHERE {column} IN (SELECT id FROM sessions WHERE {sessions_where})", params)
    private_sessions = [row[0] for row in tx.execute(
        f"SELECT DISTINCT execution_session_id FROM tasks WHERE run_id IN ({runs}) "
        "AND execution_session_id IN (SELECT id FROM sessions WHERE kind='execution')",run_params)]
    for table in ("delivery_outbox","session_inbox"):
        tx.execute(f"DELETE FROM {table} WHERE target_session_id IN "
            "(SELECT interaction_session_id FROM runs WHERE id IN ("+runs+"))",run_params)
    tx.execute(f"DELETE FROM delivery_reservations WHERE task_id IN (SELECT id FROM tasks WHERE run_id IN ({runs}))",run_params)
    tx.execute("INSERT OR IGNORE INTO content_cleanup(content_hash) "
               f"SELECT content_hash FROM artifacts WHERE run_id IN ({runs})", run_params)
    tx.execute("INSERT OR IGNORE INTO content_cleanup(content_hash) "
               f"SELECT content_hash FROM artifact_staging WHERE {where}", params)
    tx.execute(f"DELETE FROM artifact_staging WHERE {where}", params)
    tx.execute(f"DELETE FROM consumptions WHERE consumer_run_id IN ({runs})",run_params)
    tx.execute(f"DELETE FROM session_leases WHERE run_id IN ({runs})",run_params)
    tx.execute(f"DELETE FROM budget_allocations WHERE run_id IN ({runs})",run_params)
    for table in ("private_states", "questions", "approvals", "waits", "joins",
                  "task_submissions", "artifacts", "messages", "outbox", "activities"):
        tx.execute(f"DELETE FROM {table} WHERE run_id IN ({runs})", run_params)
    tx.execute(f"DELETE FROM checkpoints WHERE task_id IN (SELECT id FROM tasks WHERE run_id IN ({runs}))",
               run_params)
    # 父子实体同一 DELETE，运行的 root_task/budget 外键在提交时验证。
    tx.execute(f"DELETE FROM tasks WHERE run_id IN ({runs})", run_params)
    tx.execute(f"DELETE FROM budgets WHERE run_id IN ({runs})", run_params)
    tx.execute(f"DELETE FROM runs WHERE {run_where}", run_params)
    tx.execute("INSERT OR IGNORE INTO deleted_commands(command_id,request_hash) "
               f"SELECT command_id,request_hash FROM commands WHERE {where}", params)
    for table in ("grants", "resources", "commands"):
        tx.execute(f"DELETE FROM {table} WHERE {where}", params)
    # 无内容的删除审计保留，供 tombstone 重放核对所属范围；其它历史内容全部移除。
    tx.execute(f"DELETE FROM events WHERE {where} AND event_id<>? "
                "AND json_extract(document,'$.kind')<>'scope.deleted'", (*params, event_id))
    for id in private_sessions:
        tx.execute("INSERT OR IGNORE INTO content_cleanup(content_hash) "
                   "SELECT content_hash FROM artifact_staging WHERE session_id=?",(id,))
        tx.execute("DELETE FROM artifact_staging WHERE session_id=?",(id,))
        for table in ("grants","resources","commands","events"):
            tx.execute(f"DELETE FROM {table} WHERE session_id=?",(id,))
        tx.execute("DELETE FROM sessions WHERE id=?",(id,))
    if scope.session_id is not None:
        tx.execute("DELETE FROM sessions WHERE id=?", (scope.session_id,))
    else:
        tx.execute("DELETE FROM sessions WHERE workspace_id=?", (scope.workspace_id,))
        tx.execute("DELETE FROM workspaces WHERE id=?", (scope.workspace_id,))
    tx.execute("UPDATE cleanup_state SET wal_pending=1 WHERE singleton=1")


def _dependent_runs(tx, grant_id):
    """仅检查已定义的 provenance 字段，不把任意参数文本当成依赖。"""
    affected = set()
    for table, paths in (
        ("runs", ("$.scope_dependencies",)),
        ("activities", ("$.intent.dependencies", "$.receipt.source_dependencies")),
        ("checkpoints", ("$.tool_call.dependencies", "$.context_manifest.source_dependencies",
                         "$.output_dependencies")),
        ("messages", ("$.source_dependencies",)),
        ("artifacts", ("$.dependencies",)),
        ("approvals", ("$.dependencies",)),
        ("questions", ("$.dependencies",)),
        ("private_states", ("$.source_dependencies",)),
    ):
        owner = "item.id" if table == "runs" else "item.run_id"
        join = ""
        if table == "checkpoints":
            owner = "t.run_id"
            join = " JOIN tasks t ON t.id=item.task_id"
        for path in paths:
            affected.update(row[0] for row in tx.execute(
                f"SELECT DISTINCT {owner} FROM {table} item{join}, json_each(item.document,?) dep "
                "WHERE json_extract(dep.value,'$.scope_id')=?", (path, grant_id)))
    affected.update(row[0] for row in tx.execute("SELECT DISTINCT r.id FROM runs r,"
        "json_each(r.document,'$.sources.skill_versions') pin WHERE pin.key=?", (grant_id,)))
    return affected


def invalidate_skill(tx, skill_id):
    """固定 pin 是取消围栏，不把可用集合冒充所有 Task 的已用正文。"""
    _interrupt_dependents(tx, skill_id)


def _interrupt_dependents(tx, source_id, causation_id=None):
    for run_id in sorted(_dependent_runs(tx, source_id)):
        run = _document(tx, "runs", RunSnapshot, run_id)
        if run.state in TERMINAL:
            continue
        stopped = stop_run(tx, run, "interrupted", "scope_revoked")
        approvals = [bump(Approval.model_validate_json(row[0]), status="superseded")
            for row in tx.execute("SELECT document FROM approvals WHERE run_id=? "
                "AND status IN ('pending','approved')", (run_id,))]
        if approvals:
            _policy_event(tx, "approval.decided", PolicyChange(approvals=approvals),
                ScopeRef(kind="session" if run.interaction_session_id else "workspace",
                    workspace_id=run.workspace_id, session_id=run.interaction_session_id), causation_id=causation_id)
        waits = [bump(WaitRecord.model_validate_json(row[0]), state="cancelled")
            for row in tx.execute("SELECT document FROM waits WHERE run_id=? AND state<>'cancelled'", (run_id,))]
        questions = [bump(Question.model_validate_json(row[0]), status="cancelled")
            for row in tx.execute("SELECT document FROM questions WHERE run_id=? AND status='pending'", (run_id,))]
        if waits or questions:
            emit(tx, stopped, stopped.root_task_id, "task.stepped",
                RuntimeChange(waits=waits, questions=questions), causation_id)


def _deletion_boundary(tx):
    return tx.execute("SELECT coalesce(max(event_id),0) FROM events "
                      "WHERE json_extract(document,'$.kind')='scope.deleted'").fetchone()[0]


class ScopeLifecycle:
    def __init__(self, store, policy, artifacts, *, skill_exports=None):
        self.store = store
        self.policy = policy
        self.artifacts = artifacts
        self.skill_exports = skill_exports

    def revoke(self, grant_id, meta) -> ScopeState:
        meta = CommandMeta.model_validate(meta.model_dump())
        fingerprint = _fingerprint("scope.revoke", {"grant_id": grant_id}, meta)
        with self.store.transaction() as tx:
            previous = _replay(tx, meta, fingerprint, ScopeState)
            if previous is not None:
                return previous
            saved = _document(tx, "grants", DataUseGrant, grant_id)
            if meta.expected_version != saved.version:
                raise DomainError("version_conflict", "授权版本已改变")
            if saved.status == "active":
                saved = bump(saved, epoch=saved.epoch + 1, status="revoked")
                _policy_event(tx, "grant.revoked", PolicyChange(grants=[saved]), saved.scope,
                              causation_id=meta.command_id)
            from flowmate.skills.service import SkillService
            SkillService.invalidate_sources(tx)
            _interrupt_dependents(tx, grant_id, meta.command_id)
            state = ScopeState(id=saved.id, scope=saved.scope, epoch=saved.epoch, status="revoked")
            _policy_event(tx, "scope.revoked", LifecycleChange(scopes=[state]), saved.scope,
                          causation_id=meta.command_id)
            _save_command(tx, meta, fingerprint, state)
            return state

    def delete(self, scope: ScopeRef, meta: CommandMeta) -> DeletionReceipt:
        scope = ScopeRef.model_validate(scope.model_dump())
        if scope.kind == "user_global":
            raise DomainError("invalid_scope","全局记忆不能通过工作区删除入口处理")
        meta = CommandMeta.model_validate(meta.model_dump())
        scope_ids = [scope.session_id or scope.workspace_id]
        with self.artifacts.publication.deletion_guard(scope_ids), (
            self.skill_exports.operation_guard() if self.skill_exports is not None else nullcontext()
        ):
            with self.store.transaction() as tx:
                receipt = self._delete(tx, scope, meta)
            self.artifacts.publication.forget_scope(scope_ids)
            self._collect_skill_exports()
            return receipt

    def delete_session(self, session_id: str, meta: CommandMeta) -> DeletionReceipt:
        """HTTP 会话边界不推测 workspace；命令核对和删除共用写事务。"""
        meta = CommandMeta.model_validate(meta.model_dump())
        with self.artifacts.publication.deletion_guard([session_id]), (
            self.skill_exports.operation_guard() if self.skill_exports is not None else nullcontext()
        ):
            with self.store.transaction() as tx:
                previous = tx.previous_command(meta.command_id)
                if previous is not None:
                    if previous["session_id"] != session_id:
                        raise DomainError("command_conflict", "同一命令不能更改操作或目标")
                    scope = ScopeRef(kind="session",workspace_id=previous["workspace_id"], session_id=session_id)
                else:
                    row = tx.execute("SELECT workspace_id FROM sessions WHERE id=?", (session_id,)).fetchone()
                    if row is None:
                        raise DomainError("not_found", "会话不存在")
                    scope = ScopeRef(kind="session",workspace_id=row[0], session_id=session_id)
                receipt = self._delete(tx, scope, meta)
            self.artifacts.publication.forget_scope([session_id])
            self._collect_skill_exports()
            return receipt

    def _delete(self, tx, scope, meta):
        fingerprint = _fingerprint("scope.delete", scope.model_dump(mode="json"), meta)
        previous = _replay(tx, meta, fingerprint, DeletionReceipt)
        if previous is not None:
            return previous
        id = scope.session_id or scope.workspace_id
        table = "sessions" if scope.session_id is not None else "workspaces"
        entity = tx.execute(f"SELECT * FROM {table} WHERE id=?", (id,)).fetchone()
        if entity is None:
            # scopes 本身不保存所属范围；只从无内容审计核对，不能凭调用者给定 workspace 猜测。
            row = tx.execute("SELECT document FROM events WHERE "
                "json_extract(document,'$.kind')='scope.deleted' AND "
                "json_extract(document,'$.payload.deletions[0].scope.session_id') IS ? AND "
                "(? IS NOT NULL OR workspace_id=?) ORDER BY event_id DESC LIMIT 1",
                (scope.session_id, scope.session_id, scope.workspace_id)).fetchone()
            if row is None:
                raise DomainError("not_found", "删除范围不存在")
            receipt = DeletionReceipt.model_validate_json(json.dumps(json.loads(row[0])["payload"]["deletions"][0]))
            if receipt.scope != scope:
                raise DomainError("scope_mismatch", "会话不属于所选工作区")
            _save_command(tx, meta, fingerprint, receipt)
            return receipt
        if scope.session_id is not None and entity["workspace_id"] != scope.workspace_id:
            raise DomainError("scope_mismatch", "会话不属于所选工作区")
        if meta.expected_version != entity["version"]:
            raise DomainError("version_conflict", "删除范围版本已改变")
        where, params = _where(scope)
        if self.skill_exports is not None:
            target_refs = {row[0] for row in tx.execute(
                f"SELECT id FROM resources WHERE {where} AND json_extract(document,'$.kind')='export'", params)}
            self.skill_exports.check_deletion(target_refs)
        owners = {id: scope}
        if scope.session_id is None:
            owners.update((row[0], ScopeRef(kind="session",workspace_id=scope.workspace_id, session_id=row[0]))
                          for row in tx.execute("SELECT id FROM sessions WHERE workspace_id=?", params))
        for owned in ("resources", "grants"):
            owners.update((row[0], ScopeRef(kind="session" if row[2] else "workspace",workspace_id=row[1], session_id=row[2])) for row in tx.execute(
                f"SELECT id,workspace_id,session_id FROM {owned} WHERE {where}", params))
        run_where, run_params = _run_where(scope)
        for row in tx.execute("SELECT DISTINCT s.id,s.workspace_id FROM sessions s JOIN tasks t "
                              "ON t.execution_session_id=s.id WHERE s.kind='execution' "
                              f"AND t.run_id IN (SELECT id FROM runs WHERE {run_where})",run_params):
            owners[row[0]] = ScopeRef(kind="session",workspace_id=row[1],session_id=row[0])
        scopes = []
        for scope_id in sorted(owners):
            epoch = tx.execute("SELECT epoch FROM scopes WHERE id=?", (scope_id,)).fetchone()[0] + 1
            scopes.append(ScopeState(id=scope_id, scope=owners[scope_id], epoch=epoch, status="deleted"))
        receipt = DeletionReceipt(scope=scope, epoch=next(item.epoch for item in scopes if item.id == id))
        budgets, activities = [], []
        runs = f"SELECT id FROM runs WHERE {run_where}"
        for row in tx.execute(f"SELECT document FROM budgets WHERE run_id IN ({runs})", run_params):
            budget = BudgetSnapshot.model_validate_json(row[0])
            group_id = tx.execute("SELECT budget_group_id FROM runs WHERE id=?", (budget.run_id,)).fetchone()[0]
            budgets.append(AccountingBudget(**budget.model_dump(include=AccountingBudget.model_fields.keys()),
                                            budget_group_id=group_id))
            for item in tx.execute("SELECT document FROM activities WHERE run_id=?", (budget.run_id,)):
                activity = ActivitySnapshot.model_validate_json(item[0])
                archived = activity.receipt
                if archived is not None:
                    # 任意工具错误可能含原文；费用与冲突摘要保留，错误正文不进入删除归档。
                    archived = archived.model_copy(update={"result": None, "error": None,
                                                          "source_dependencies": [], "source_observations": []})
                activities.append(AccountingActivity(
                    **activity.model_dump(include={"id", "version", "run_id", "attempt_id", "state",
                                                    "reserved_units", "reserved_tokens", "result_digest"}),
                    budget_id=budget.id, receipt=archived))
        tx.append_event(NewEvent(kind="scope.deleted", workspace_id=scope.workspace_id,
            session_id=scope.session_id, causation_id=meta.command_id,
            payload=LifecycleChange(scopes=scopes, deletions=[receipt],
                                    accounting_budgets=budgets, accounting_activities=activities)))
        _save_command(tx, meta, fingerprint, receipt)
        return receipt

    def _collect_skill_exports(self):
        if self.skill_exports is not None:
            with self.skill_exports.operation_guard():
                with self.store.transaction(write=False) as tx:
                    targets = {row[0] for row in tx.execute(
                        "SELECT id FROM resources WHERE json_extract(document,'$.kind')='export'")}
                self.skill_exports.forget_missing_targets(targets)

    def collect_content(self) -> CleanupSummary:
        self._collect_skill_exports()
        from flowmate.skills.service import SkillService
        SkillService(self.store).cleanup_deleted()
        deleted = 0
        with self.store.transaction() as tx:
            # stage/publish 和 unlink 使用同一 SQLite 写锁，不会删除刚写入但尚未登记的 blob/tmp。
            protected = set()
            for row in tx.execute("SELECT s.id,s.content_hash,a.document AS activity,t.document AS task,"
                "r.document AS run FROM artifact_staging s LEFT JOIN activities a ON a.id=s.activity_id "
                "LEFT JOIN tasks t ON t.id=a.task_id LEFT JOIN runs r ON r.id=a.run_id").fetchall():
                valid = False
                if row["activity"] is not None:
                    activity = ActivitySnapshot.model_validate_json(row["activity"])
                    task = TaskSnapshot.model_validate_json(row["task"])
                    run = RunSnapshot.model_validate_json(row["run"])
                    valid = activity.state == "dispatched" and can_publish(tx, run, task, activity.intent.dependencies)
                if valid:
                    protected.add(row["content_hash"])
                else:
                    tx.execute("INSERT OR IGNORE INTO content_cleanup(content_hash) VALUES (?)", (row["content_hash"],))
                    tx.execute("DELETE FROM artifact_staging WHERE id=?", (row["id"],))
            protected.update(row[0] for row in tx.execute(
                "SELECT DISTINCT a.content_hash FROM artifacts a JOIN runs r ON r.id=a.run_id "
                "JOIN scopes w ON w.id=r.workspace_id JOIN scopes s ON s.id=r.execution_session_id "
                "WHERE w.status='active' AND s.status='active'"))
            candidates = {row[0] for row in tx.execute("SELECT content_hash FROM content_cleanup")}
            candidates.update(path.stem for path in self.artifacts.root.glob("*.blob"))
            # tmp 尚未有内容 hash，使用托管 basename 作为清理键；不记录用户路径或异常正文。
            candidates.update(path.name for path in self.artifacts.root.glob("*.tmp"))
            for key in sorted(candidates):
                if key in protected:
                    tx.execute("DELETE FROM content_cleanup WHERE content_hash=?", (key,))
                    continue
                path = self.artifacts.root / key if key.endswith(".tmp") else self.artifacts._path(key)
                try:
                    existed = path.exists()
                    path.unlink(missing_ok=True)
                except OSError as error:
                    tx.execute("INSERT INTO content_cleanup(content_hash,last_error) VALUES (?,?) "
                        "ON CONFLICT(content_hash) DO UPDATE SET last_error=excluded.last_error",
                        (key, type(error).__name__))
                else:
                    deleted += int(existed)
                    tx.execute("DELETE FROM content_cleanup WHERE content_hash=?", (key,))
            boundary = _deletion_boundary(tx)
        checkpointed = self.store.checkpoint()
        with self.store.transaction() as tx:
            # checkpoint 之外出现的新删除不能被旧的成功结果清掉；只有无内容状态写入新 WAL。
            if checkpointed and _deletion_boundary(tx) == boundary:
                tx.execute("UPDATE cleanup_state SET wal_pending=0 WHERE singleton=1")
            elif not checkpointed:
                tx.execute("UPDATE cleanup_state SET wal_pending=1 WHERE singleton=1")
            pending = tx.execute("SELECT count(*) FROM content_cleanup").fetchone()[0]
            pending += tx.execute("SELECT wal_pending FROM cleanup_state WHERE singleton=1").fetchone()[0]
        return CleanupSummary(deleted_blobs=deleted, pending_count=pending)
