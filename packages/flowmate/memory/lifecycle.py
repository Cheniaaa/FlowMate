"""隐私删除沿依赖清理记忆，复用既有事务与 scope 围栏。"""

from flowmate.contracts.base import DomainError
from flowmate.contracts.events import NewEvent
from flowmate.memory.contracts import MemoryChange, MemoryNotice, MemoryRecord
from flowmate.memory.provider import SQLiteMemoryProvider
from flowmate.runtime.transitions import check_scopes


def invalidate_sources(tx):
    provider = SQLiteMemoryProvider(None, tx=tx)
    for row in tx.execute("SELECT document FROM memory_records").fetchall():
        record = MemoryRecord.model_validate_json(row[0])
        if record.status == "deleted":
            continue
        try:
            check_scopes(tx, record.dependencies)
        except DomainError:
            provider.put(record.model_copy(update={"revision": record.revision + 1,
                "status": "deleted", "text": "", "evidence": [], "dependencies": []}), record.revision)
            tx.execute("INSERT OR IGNORE INTO deleted_commands SELECT command_id,request_hash FROM commands "
                "WHERE json_extract(response,'$.id')=?", (record.id,))
            tx.execute("DELETE FROM commands WHERE json_extract(response,'$.id')=?", (record.id,))
            tx.append_event(NewEvent(kind="memory.changed", workspace_id=record.scope.workspace_id,
                payload=MemoryChange(records=[MemoryNotice(id=record.id, scope=record.scope,
                    revision=record.revision + 1, status="deleted")])))
    # 用户纠正可使当前修订不再依赖旧来源；历史修订和旧命令回执仍须逐项清除。
    for row in tx.execute("SELECT document FROM memory_revisions").fetchall():
        revision = MemoryRecord.model_validate_json(row[0])
        try:
            check_scopes(tx, revision.dependencies)
        except DomainError:
            scrubbed = revision.model_copy(update={"status": "deleted", "text": "", "evidence": [], "dependencies": []})
            tx.execute("UPDATE memory_revisions SET document=? WHERE record_id=? AND revision=?",
                (scrubbed.model_dump_json(), revision.id, revision.revision))
    for row in tx.execute("SELECT command_id,request_hash,response FROM commands WHERE "
            "json_type(response,'$.claim_key')='text'").fetchall():
        record = MemoryRecord.model_validate_json(row["response"])
        try:
            check_scopes(tx, record.dependencies)
        except DomainError:
            tx.execute("INSERT OR IGNORE INTO deleted_commands VALUES (?,?)", (row["command_id"], row["request_hash"]))
            tx.execute("DELETE FROM commands WHERE command_id=?", (row["command_id"],))
    tx.execute("DELETE FROM memory_policies WHERE scope_id IN (SELECT id FROM scopes WHERE status='deleted')")
