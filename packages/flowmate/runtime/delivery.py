"""持久结果通知和独立后台交付的会话归属。"""

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from uuid import UUID, uuid5

from flowmate.config import RuntimeConfig
from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    Checkpoint,
    ConsumerRef,
    DeliveryReservation,
    ModelMessage,
    ResultConsumption,
    RunSnapshot,
    RuntimeChange,
    SessionInboxEntry,
    TaskSnapshot,
    TextPart,
)
from flowmate.runtime.transitions import (
    bump,
    check_admission,
    check_scopes,
    context_for,
    emit,
    load,
)


def visible_entry(tx, entry):
    consumers=[ResultConsumption.model_validate_json(row[0]) for row in tx.execute(
        "SELECT document FROM consumptions WHERE target_task_id=? AND result_version=?",
        (entry.result.task_id,entry.result_version))]
    available = delivery_available(tx, entry)
    task = load(tx, TaskSnapshot, entry.result.task_id) if available and entry.delivery_state != "invalidated" else None
    work = task.binding.agent_work if task else None
    return entry.model_copy(update={"consumers": consumers, "source_valid": available,
        "task_name": work.goal if work else None,
        "assistant_name": task.binding.config.agent_profile.display_name if task else None})


def managed_deliveries(tx, origin, *, owner_task_id=None):
    """从原提交读取整份委托，未完成成员也占据交付边界。"""
    return tx.execute(
        "SELECT d.document, d.state, json_extract(s.document,'$.completion_policy') AS policy, "
        "json_extract(s.document,'$.handle.task_id') AS task_id, s.origin_task_id "
        "FROM task_submissions s LEFT JOIN delivery_outbox d ON "
        "json_extract(d.document,'$.result.task_id')=json_extract(s.document,'$.handle.task_id') "
        "AND d.target_session_id=? WHERE s.origin_run_id=? AND "
        "json_extract(s.document,'$.lifetime')='managed' AND (? IS NULL OR s.origin_task_id=?) "
        "ORDER BY s.rowid", (origin.interaction_session_id, origin.id, owner_task_id, owner_task_id)).fetchall()


def unconsumed_delivery(tx, row):
    return not tx.execute(
        "SELECT 1 FROM consumptions WHERE consumer_task_id=? AND target_task_id=? AND result_version="
        "json_extract(?,'$.result_version')", (row["origin_task_id"], row["task_id"], row["document"])).fetchone()


def delivery_available(tx, entry):
    if not entry.source_valid:
        return False
    try:
        check_scopes(tx, entry.dependencies)
    except DomainError as error:
        if error.code != "scope_revoked":
            raise
        return False
    return True


def unavailable_delivery(position):
    return f"第 {position} 项后台交付因来源已撤销而不可用。"


def publish_managed_report(tx, origin, *, fallback_reason=None):
    if (origin.kind != "user" or origin.state == "cancelled" or origin.follow_up_closed
            or tx.execute("SELECT archived FROM sessions WHERE id=?",
                          (origin.interaction_session_id,)).fetchone()[0]):
        return
    try:
        check_admission(tx, origin)
    except DomainError as error:
        if error.code == "admission_stopped":
            return
        raise
    rows = managed_deliveries(tx, origin)
    groups = [(row["task_id"], [(1, row)]) for row in rows
              if row["policy"] == "notify_each" and row["state"] == "delivered"]
    grouped = [row for row in rows if row["policy"] != "notify_each"]
    if origin.state in TERMINAL and all(row["state"] in {"delivered", "invalidated"} for row in grouped):
        outstanding = [(position, row) for position, row in enumerate(grouped, 1) if unconsumed_delivery(tx, row)]
        if fallback_reason or not any(row["policy"] == "follow_up" for _, row in outstanding):
            groups.append(("final", outstanding))
    from flowmate.runtime.tasks import delivered_result

    for group, rows in groups:
        message_id = str(uuid5(UUID(origin.id), f"managed-report:{group}"))
        if tx.execute("SELECT 1 FROM messages WHERE id=?", (message_id,)).fetchone():
            continue
        sections, dependencies, delivery_ids = [], {}, []
        for position, row in rows:
            entry = SessionInboxEntry.model_validate_json(row["document"])
            delivery_ids.append(entry.id)
            if not delivery_available(tx, entry):
                sections.append(unavailable_delivery(position))
                continue
            task = load(tx, TaskSnapshot, entry.result.task_id)
            result = delivered_result(tx, task, entry.result, input_only=True)
            if task.kind == "agent" and result.result is not None:
                text = result.result["summary"]
                if result.result["unresolved"]:
                    text += "\n\n未完成：\n" + "\n".join(f"- {item}" for item in result.result["unresolved"])
            elif result.state == "cancelled":
                text = "后台任务已取消。"
            elif result.state == "failed":
                text = "后台任务未完成，可在结果中查看详情。"
            else:
                message = result.result.get("text") if isinstance(result.result, dict) else result.result
                text = message if isinstance(message, str) else "后台任务已完成，可在结果中查看交付。"
            if result.artifacts:
                text += "\n\n可在结果中打开交付产物。"
            sections.append(text)
            dependencies.update((item.scope_id, item) for item in [*entry.dependencies, *result.dependencies])
        if sections:
            if group == "final" and fallback_reason:
                message = {"budget": "原任务的剩余预算不足，以下为各项实际交付。",
                           "deadline": "原任务授权期限已到，以下为各项实际交付。"}.get(fallback_reason)
                if message:
                    sections.insert(0, message)
            message = ModelMessage(id=message_id, role="assistant", origin="background_report",
                parts=[TextPart(text="\n\n".join(sections))], source_dependencies=list(dependencies.values()),
                delivery_ids=delivery_ids)
            emit(tx, origin, origin.root_task_id, "task.stepped", RuntimeChange(messages=[message]))


class DeliveryService:
    def __init__(self, store, *, config=None, clock=None):
        self.store=store
        self.config=config or RuntimeConfig()
        self.clock=clock or (lambda: datetime.now(UTC))
        self.tasks=None

    def reserve_tx(self, tx, task_id, session_id):
        session=tx.execute("SELECT kind,archived FROM sessions WHERE id=?", (session_id,)).fetchone()
        if session is None or session[0] != "interaction":
            raise DomainError("not_found","结果目标交互会话不存在")
        if session[1]:
            raise DomainError("session_archived","归档会话不接收新的后台接管")
        used=tx.execute("SELECT count(*) FROM delivery_reservations WHERE target_session_id=? AND released=0",
                        (session_id,)).fetchone()[0]
        if used >= self.config.session_result_capacity:
            raise DomainError("result_capacity","未查看结果已达容量，请先查看或归档")
        reservation=DeliveryReservation(task_id=task_id,target_session_id=session_id)
        run=load(tx,RunSnapshot,load(tx,TaskSnapshot,task_id).run_id)
        self._emit(tx,run,RuntimeChange(delivery_reservations=[reservation]))

    @staticmethod
    def enqueue_tx(tx, result, target_session_id):
        run=load(tx,RunSnapshot,result.handle.run_id)
        source=tx.execute("SELECT event_id FROM events e WHERE e.run_id=? AND EXISTS("
            "SELECT 1 FROM json_each(e.document,'$.payload.tasks') t "
            "WHERE json_extract(t.value,'$.id')=? AND json_extract(t.value,'$.result_version')=? "
            "AND json_extract(t.value,'$.state') IN ('completed','failed','cancelled')) ORDER BY event_id LIMIT 1",
            (run.id,result.handle.task_id,result.result_version)).fetchone()[0]
        if tx.execute("SELECT 1 FROM delivery_outbox WHERE source_event_id=? AND target_session_id=?",
                       (source,target_session_id)).fetchone():
            return
        entry=SessionInboxEntry(id=identifier(),source_event_id=source,target_session_id=target_session_id,
            result=result.handle,result_version=result.result_version,dependencies=result.dependencies)
        DeliveryService._emit(tx,run,RuntimeChange(deliveries=[entry]))
        from flowmate.runtime.followups import create_intent
        create_intent(tx, entry)

    @staticmethod
    def _emit(tx, run, change, causation_id=None):
        tx.append_event(NewEvent(kind="delivery.changed",workspace_id=run.workspace_id,
            session_id=run.interaction_session_id,run_id=run.id,task_id=run.root_task_id,
            payload=change,causation_id=causation_id))

    @staticmethod
    def _load(tx,id):
        row=tx.execute("SELECT document FROM session_inbox WHERE id=?", (id,)).fetchone()
        if row is None:
            raise DomainError("not_found","结果通知不存在")
        return SessionInboxEntry.model_validate_json(row[0])

    def _deliver_tx(self,tx,entry):
        """存储故障屏障在此边界；任何失败均由外层新事务持久记录或直接传播。"""
        changed=bump(entry,attempts=entry.attempts+1,last_error=None,
            delivery_state="delivered" if visible_entry(tx,entry).source_valid else "invalidated")
        if changed.delivery_state == "invalidated":
            changed=changed.model_copy(update={"source_valid":False,"last_error":"scope_revoked"})
        self._emit(tx,load(tx,RunSnapshot,entry.result.run_id),RuntimeChange(deliveries=[changed]))
        if entry.result.lifetime == "managed":
            task = load(tx, TaskSnapshot, entry.result.task_id)
            if task.origin_task_id is not None:
                owner = load(tx, TaskSnapshot, task.origin_task_id)
                publish_managed_report(tx, load(tx, RunSnapshot, owner.run_id))

    def pending_owned_tx(self, tx, run, task):
        if task.kind != "agent" or run.interaction_session_id is None:
            return []
        entries = []
        for row in managed_deliveries(tx, run, owner_task_id=task.id):
            if row["state"] != "delivered" or not unconsumed_delivery(tx, row):
                continue
            entry = SessionInboxEntry.model_validate_json(row["document"])
            if visible_entry(tx, entry).source_valid:
                entries.append(entry)
        return entries

    def consume_owned_tx(self, tx, run, task, entries):
        """仅在调度器确认安全后，由原办理人消费已送达的版本。"""
        ctx = context_for(tx, task.id)
        for entry in entries:
            checkpoint = load(tx, Checkpoint, task.id)
            self.tasks._result(tx, ctx, entry.result, ConsumerRef(run_id=run.id,
                task_id=task.id, message_boundary=checkpoint.message_boundary), inbox_entry_id=entry.id)

    def deliver_pending(self):
        with self.store.transaction(write=False) as tx:
            ids=[row[0] for row in tx.execute("SELECT id FROM delivery_outbox WHERE state='pending' ORDER BY source_event_id")]
        delivered=0
        for id in ids:
            try:
                with self.store.transaction() as tx:
                    row=tx.execute("SELECT document FROM delivery_outbox WHERE id=? AND state='pending'",(id,)).fetchone()
                    if row is None:
                        continue
                    entry=SessionInboxEntry.model_validate_json(row[0])
                    self._deliver_tx(tx,entry)
                delivered+=1
            except (OSError,sqlite3.OperationalError) as error:
                if isinstance(error,sqlite3.OperationalError) and (error.sqlite_errorcode & 255) not in {
                        sqlite3.SQLITE_BUSY,sqlite3.SQLITE_IOERR,sqlite3.SQLITE_FULL,sqlite3.SQLITE_READONLY}:
                    raise
                with self.store.transaction() as tx:
                    row=tx.execute("SELECT document FROM delivery_outbox WHERE id=? AND state='pending'",(id,)).fetchone()
                    if row is None:
                        continue
                    entry=SessionInboxEntry.model_validate_json(row[0])
                    attempts=entry.attempts+1
                    changed=bump(entry,attempts=attempts,last_error=(
                        error.sqlite_errorname if isinstance(error,sqlite3.OperationalError) else type(error).__name__),
                        delivery_state="failed" if attempts >= self.config.delivery_max_attempts else "pending")
                    self._emit(tx,load(tx,RunSnapshot,entry.result.run_id),RuntimeChange(deliveries=[changed]))
        return delivered

    def _command(self,id,meta,operation):
        encoded=json.dumps({"id":id,"operation":operation,"expected_version":meta.expected_version},sort_keys=True)
        fingerprint=hashlib.sha256(encoded.encode()).hexdigest()
        with self.store.transaction() as tx:
            previous=tx.previous_command(meta.command_id)
            if previous:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict","同一命令不能更改操作或版本")
                return visible_entry(tx,SessionInboxEntry.model_validate_json(previous["response"]))
            entry=self._load(tx,id)
            if entry.version != meta.expected_version:
                raise DomainError("version_conflict","结果通知已改变，请刷新")
            if operation == "retry":
                check_scopes(tx,entry.dependencies)
                if entry.delivery_state != "failed":
                    raise DomainError("delivery_not_failed","只有失败通知可重投")
                changed=bump(entry,delivery_state="pending",attempts=0,last_error=None)
            else:
                changed=bump(entry,viewed_at=entry.viewed_at or self.clock())
            run=load(tx,RunSnapshot,entry.result.run_id)
            reservations=[]
            if operation == "view":
                reservation=DeliveryReservation.model_validate_json(tx.execute(
                    "SELECT document FROM delivery_reservations WHERE task_id=?", (entry.result.task_id,)).fetchone()[0])
                reservations=[reservation.model_copy(update={"released":True})]
            self._emit(tx,run,RuntimeChange(deliveries=[changed],delivery_reservations=reservations),meta.command_id)
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)",
                       (meta.command_id,fingerprint,changed.model_dump_json(),run.workspace_id,entry.target_session_id))
            return visible_entry(tx,changed)

    def mark_viewed(self,id,meta):
        return self._command(id,meta,"view")

    def retry(self,id,meta):
        return self._command(id,meta,"retry")

    def consume(self,id,ctx,consumer):
        # 消费与持久消息共用已有TaskService事务，不另外确认一个“consumed”布尔。
        with self.store.transaction() as tx:
            entry=self._load(tx,id)
            check_scopes(tx,entry.dependencies)
            return self.tasks._result(tx,ctx,entry.result,consumer,inbox_entry_id=id)
