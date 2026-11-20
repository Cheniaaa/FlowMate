"""隐私删除沿依赖清理记忆，复用既有事务与 scope 围栏。"""

from collections import defaultdict, deque

from flowmate.contracts.base import DomainError
from flowmate.contracts.events import NewEvent
from flowmate.memory.contracts import MemoryChange, MemoryNotice, MemoryRecord
from flowmate.runtime.transitions import check_scopes


def invalidate_sources(tx, provider):
    def invalid(dependencies):
        try:
            check_scopes(tx, dependencies)
        except DomainError as error:
            if error.code != "scope_revoked":
                raise
            return True
        return False

    records = {record.id: record for record in provider.list_records() if record.status != "deleted"}
    dependents = defaultdict(list)
    pending = deque()
    scheduled = set()
    for record in records.values():
        for dependency in record.dependencies:
            dependents[dependency.scope_id].append(record.id)
        if invalid(record.dependencies):
            pending.append(record.id)
            scheduled.add(record.id)
    # 当前依赖只建一次反向索引；删除围栏沿队列传播，不依赖 Provider 的枚举顺序。
    while pending:
        record = records[pending.popleft()]
        provider.put(record.model_copy(update={"revision": record.revision + 1,
            "status": "deleted", "text": "", "evidence": [], "dependencies": []}), record.revision)
        tx.execute("UPDATE scopes SET epoch=?,status='deleted' WHERE id=?",
            (record.revision + 1, record.id))
        tx.execute("INSERT OR IGNORE INTO deleted_commands SELECT command_id,request_hash FROM commands "
            "WHERE json_extract(response,'$.id')=?", (record.id,))
        tx.execute("DELETE FROM commands WHERE json_extract(response,'$.id')=?", (record.id,))
        tx.append_event(NewEvent(kind="memory.changed", workspace_id=record.scope.workspace_id,
            payload=MemoryChange(records=[MemoryNotice(id=record.id, scope=record.scope,
                revision=record.revision + 1, status="deleted")])))
        for id in dependents[record.id]:
            if id not in scheduled:
                pending.append(id)
                scheduled.add(id)
    # 用户纠正可使当前修订不再依赖旧来源；历史修订和旧命令回执仍须逐项清除。
    provider.scrub_history(invalid)
    for row in tx.execute("SELECT command_id,request_hash,response FROM commands WHERE "
            "json_type(response,'$.claim_key')='text'").fetchall():
        record = MemoryRecord.model_validate_json(row["response"])
        if invalid(record.dependencies):
            tx.execute("INSERT OR IGNORE INTO deleted_commands VALUES (?,?)", (row["command_id"], row["request_hash"]))
            tx.execute("DELETE FROM commands WHERE command_id=?", (row["command_id"],))
    tx.execute("DELETE FROM memory_policies WHERE scope_id IN (SELECT id FROM scopes WHERE status='deleted')")
