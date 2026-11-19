"""持久事件补读与可丢失预览共用出口。"""

import asyncio
import json
from collections import deque
from dataclasses import dataclass, field

from flowmate.api.contracts import DeltaEvent, DurableEvent
from flowmate.api.projections import public_event
from flowmate.contracts.base import DomainError
from flowmate.contracts.events import RunEvent
from flowmate.contracts.execution import ActivitySnapshot, RunSnapshot, TaskSnapshot
from flowmate.runtime.transitions import can_publish, load


@dataclass(eq=False)
class _Subscriber:
    workspace_id: str
    wake: asyncio.Event
    queue: deque = field(default_factory=lambda: deque(maxlen=128))


class EventStream:
    def __init__(self, store):
        self.store = store
        self.listeners = set()
        self.closed = False

    def _allowed(self, ctx):
        with self.store.transaction(write=False) as tx:
            try:
                activity = load(tx, ActivitySnapshot, ctx.activity_id)
                run = load(tx, RunSnapshot, ctx.run_id)
                task = load(tx, TaskSnapshot, ctx.task_id)
                return ((activity.run_id, activity.task_id, run.workspace_id) == (ctx.run_id, ctx.task_id, ctx.workspace_id)
                    and task.binding.execution_session_id == run.interaction_session_id
                    and activity.state == "dispatched" and can_publish(tx, run, task,
                        [*ctx.scope_dependencies, *activity.intent.dependencies]))
            except DomainError:
                return False

    def check_cursor(self, workspace_id, after):
        if type(after) is not int or after < 0:
            raise DomainError("invalid_cursor", "事件游标无效")
        with self.store.transaction(write=False) as tx:
            if not tx.execute("SELECT 1 FROM workspaces WHERE id=?", (workspace_id,)).fetchone():
                raise DomainError("not_found", "工作区不存在")
            latest = tx.execute("SELECT coalesce(max(event_id),0) FROM events").fetchone()[0]
            if after > latest:
                raise DomainError("snapshot_required", "事件游标不属于当前快照")

    def _events(self, workspace_id, after):
        with self.store.transaction(write=False) as tx:
            rows = tx.execute("SELECT event_id FROM events WHERE event_id>? AND (workspace_id=? OR workspace_id IS NULL) "
                               "ORDER BY event_id LIMIT 100", (after, workspace_id)).fetchall()
            return [row["event_id"] for row in rows]

    def publish(self, ctx, index, text, *, kind="delta"):
        if self.closed or not text or not self._allowed(ctx):
            return
        delta = DeltaEvent(kind=kind, activity_id=ctx.activity_id, index=index, text=text)
        for listener in tuple(self.listeners):
            if listener.workspace_id == ctx.workspace_id:
                listener.queue.append((ctx, delta))
                listener.wake.set()

    def publish_reasoning(self, ctx, index, text):
        self.publish(ctx, index, text, kind="reasoning_delta")

    async def subscribe(self, workspace_id, after):
        after = int(after)
        self.check_cursor(workspace_id, after)
        loop = asyncio.get_running_loop()
        listener = _Subscriber(workspace_id, asyncio.Event())
        unsubscribe = self.store.subscribe(lambda: loop.call_soon_threadsafe(listener.wake.set))
        self.listeners.add(listener)
        try:
            while not self.closed:
                listener.wake.clear()
                events = self._events(workspace_id, after)
                if events:
                    for event_id in events:
                        after = event_id
                        # batch只保留位置；每次实际出队重新读取，删除后不发送已缓存原文。
                        with self.store.transaction(write=False) as tx:
                            row = tx.execute("SELECT * FROM events WHERE event_id=? "
                                "AND (workspace_id=? OR workspace_id IS NULL)", (event_id, workspace_id)).fetchone()
                            if row is None:
                                continue
                            event = RunEvent.model_validate_json(json.dumps({**json.loads(row["document"]),
                                "event_id": str(row["event_id"]), "seq": row["seq"]}))
                            owner = tx.execute("SELECT execution_session_id FROM tasks WHERE id=?",
                                               (event.task_id,)).fetchone()
                            durable = DurableEvent(event_id=event.event_id, event=public_event(
                                event,owner[0] if owner is not None else None,tx=tx))
                        yield durable
                    continue
                while listener.queue:
                    ctx, delta = listener.queue.popleft()
                    # 在最后一次持久补读后、交给发送器前复核；中间没有await。
                    if self._allowed(ctx):
                        yield delta
                    # 每个delta后重新优先补读持久事实，防围栏事件被积压预览越过。
                    if self._events(workspace_id, after):
                        break
                else:
                    await listener.wake.wait()
        finally:
            unsubscribe()
            self.listeners.discard(listener)

    def close(self):
        self.closed = True
        for listener in tuple(self.listeners):
            listener.wake.set()
