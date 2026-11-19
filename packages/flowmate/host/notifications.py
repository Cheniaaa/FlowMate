"""桌面宿主的脱敏持久待办通知。"""

import asyncio

from flowmate.contracts.base import identifier
from flowmate.host.protocol import HostEvent
from flowmate.api.queries import _pending_count


async def publish_notifications(store, host):
    loop = asyncio.get_running_loop()
    changed = asyncio.Event()
    unsubscribe = store.subscribe(lambda: loop.call_soon_threadsafe(changed.set))
    previous = None
    try:
        while True:
            changed.clear()
            with store.transaction(write=False) as tx:
                counts = {
                    "pending_questions": tx.execute("SELECT count(*) FROM questions WHERE status='pending'").fetchone()[0],
                    "pending_approvals": tx.execute("SELECT count(*) FROM approvals WHERE status='pending'").fetchone()[0],
                    # 复用查询投影所有者的待办语义，避免在host重复恢复/阻塞分类规则。
                    "pending_actions": _pending_count(tx),
                    "unviewed_results": tx.execute(
                        "SELECT count(*) FROM session_inbox WHERE json_extract(document,'$.viewed_at') IS NULL "
                        "AND state IN ('delivered','invalidated')"
                    ).fetchone()[0],
                }
            if counts != previous:
                await host.event(HostEvent(request_id=identifier(), method="notifications.changed", params=counts))
                previous = counts
            await changed.wait()
    finally:
        unsubscribe()
