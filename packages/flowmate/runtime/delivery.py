"""持久结果通知：只投递引用，不执行任务、模型或自动总结。"""

import hashlib
import json
import sqlite3
from datetime import UTC, datetime

from flowmate.config import RuntimeConfig
from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    DeliveryReservation,
    ResultConsumption,
    RunSnapshot,
    RuntimeChange,
    SessionInboxEntry,
    TaskSnapshot,
)
from flowmate.runtime.transitions import bump, check_scopes, load


def visible_entry(tx, entry):
    consumers=[ResultConsumption.model_validate_json(row[0]) for row in tx.execute(
        "SELECT document FROM consumptions WHERE target_task_id=? AND result_version=?",
        (entry.result.task_id,entry.result_version))]
    entry=entry.model_copy(update={"consumers":consumers})
    try:
        check_scopes(tx,entry.dependencies)
    except DomainError as error:
        if error.code != "scope_revoked":
            raise
        return entry.model_copy(update={"source_valid":False})
    return entry


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
