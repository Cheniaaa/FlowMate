"""SQLite 存储适配；语义决定由 MemoryService 作出。"""

from contextlib import contextmanager
from typing import Protocol

from flowmate.contracts.base import DomainError
from flowmate.memory.contracts import (
    MemoryArchive,
    MemoryCandidate,
    MemoryCapabilities,
    MemoryRecord,
)


class MemoryProvider(Protocol):
    capabilities: MemoryCapabilities

    def query(self, scope, confirmed_only: bool, limit: int) -> list[MemoryRecord]: ...
    def list_records(self, scope=None, *, status=None, claim=None, after=None, upper=None,
                     limit=None, descending=False) -> list[MemoryRecord]: ...
    def candidates_for(self, scope, *, claim=None, record_id=None) -> list[MemoryCandidate]: ...
    def scrub_history(self, invalid) -> None: ...
    def get(self, id: str) -> MemoryRecord: ...
    def put(self, record: MemoryRecord, expected_revision: int | None) -> MemoryRecord: ...
    def export_scope(self, scope) -> MemoryArchive: ...
    def import_scope(self, archive: MemoryArchive) -> None: ...
    # 与调用方现有事务一起提交/回滚，不另起持久业务边界。
    def using(self, tx) -> "MemoryProvider": ...
    def atomic(self): ...
    def put_candidate(self, candidate: MemoryCandidate) -> None: ...


def scope_id(tx, scope):
    if scope.kind == "session":
        raise DomainError("invalid_scope", "长期记忆只支持个人或项目范围")
    if scope.kind == "user_global":
        return tx.execute("SELECT user_scope_id FROM local_identity WHERE singleton=1").fetchone()[0]
    return scope.workspace_id


def validate_archive(archive):
    archive = MemoryArchive.model_validate(archive.model_dump())
    records = {record.id: record for record in archive.records}
    revisions = {(record.id, record.revision): record for record in archive.revisions}
    if (len(records) != len(archive.records) or len(revisions) != len(archive.revisions)
            or any(record.scope != archive.scope for record in [*archive.records, *archive.revisions])):
        raise DomainError("invalid_archive", "归档范围或修订重复")
    for id, record in records.items():
        history = sorted(revision for key, revision in revisions if key == id)
        if history != list(range(1, record.revision + 1)) or revisions[(id, record.revision)] != record:
            raise DomainError("invalid_archive", "归档修订不完整")
        if any(revisions[(id, revision)].owner_id != record.owner_id for revision in history):
            raise DomainError("invalid_archive", "归档所有者不能改变")
        if record.status == "deleted" and any(revisions[(id, n)].text for n in history):
            raise DomainError("invalid_archive", "删除记录不能携带历史正文")
    if any(id not in records for id, _ in revisions) or any(
            item.record_id not in records or item.scope != archive.scope for item in archive.candidates):
        raise DomainError("invalid_archive", "归档候选或修订没有所属记录")
    keys = [(item.source_version, item.policy_version, item.normalized_claim) for item in archive.candidates]
    if len(keys) != len(set(keys)) or len({c.id for c in archive.candidates}) != len(archive.candidates):
        raise DomainError("invalid_archive", "归档候选身份重复")
    return archive


class SQLiteMemoryProvider:
    capabilities = MemoryCapabilities(revisions=True, scope_query=True, archive_roundtrip=True)

    def __init__(self, store, *, tx=None):
        self.store = store
        self.tx = tx

    @contextmanager
    def transaction(self, *, write=False):
        if self.tx is not None:
            yield self.tx
        else:
            with self.store.transaction(write=write) as tx:
                yield tx

    def using(self, tx):
        return SQLiteMemoryProvider(self.store, tx=tx)

    @contextmanager
    def atomic(self):
        # SQLite 写入使用 using(tx) 传入的同一事务。
        yield

    def query(self, scope, confirmed_only, limit):
        if not 1 <= limit <= 500:
            raise DomainError("invalid_query", "记忆查询数量须在1至500之间")
        return self.list_records(scope, status="confirmed" if confirmed_only else None, limit=limit)

    def list_records(self, scope=None, *, status=None, claim=None, after=None, upper=None,
                     limit=None, descending=False):
        with self.transaction() as tx:
            clauses, params = [], []
            if scope is not None:
                clauses.append("scope_id=?")
                params.append(scope_id(tx, scope))
            for field, value in (("status", status), ("claim_key", claim)):
                if value is not None:
                    clauses.append(f"json_extract(document,'$.{field}')=?")
                    params.append(value)
            for operator, value in ((">", after), ("<=", upper)):
                if value is not None:
                    clauses.append(f"id{operator}?")
                    params.append(value)
            sql = "SELECT document FROM memory_records"
            if clauses:
                sql += " WHERE " + " AND ".join(clauses)
            sql += " ORDER BY id" + (" DESC" if descending else "")
            if limit is not None:
                sql += " LIMIT ?"
                params.append(limit)
            rows = tx.execute(sql, params)
            return [MemoryRecord.model_validate_json(row[0]) for row in rows]

    def candidates_for(self, scope, *, claim=None, record_id=None):
        with self.transaction() as tx:
            clauses, params = ["scope_id=?"], [scope_id(tx, scope)]
            if claim is not None:
                clauses.append("normalized_claim=?")
                params.append(claim)
            if record_id is not None:
                clauses.append("json_extract(document,'$.record_id')=?")
                params.append(record_id)
            return [MemoryCandidate.model_validate_json(row[0]) for row in tx.execute(
                "SELECT document FROM memory_candidates WHERE " + " AND ".join(clauses) + " ORDER BY id", params)]

    def scrub_history(self, invalid):
        with self.transaction(write=True) as tx:
            for row in tx.execute("SELECT document FROM memory_revisions").fetchall():
                revision = MemoryRecord.model_validate_json(row[0])
                if invalid(revision.dependencies):
                    scrubbed = revision.model_copy(update={
                        "status": "deleted", "text": "", "evidence": [], "dependencies": []})
                    tx.execute("UPDATE memory_revisions SET document=? WHERE record_id=? AND revision=?",
                        (scrubbed.model_dump_json(), revision.id, revision.revision))

    def get(self, id):
        with self.transaction() as tx:
            row = tx.execute("SELECT document FROM memory_records WHERE id=?", (id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "记忆不存在")
            return MemoryRecord.model_validate_json(row[0])

    def put(self, record, expected_revision):
        record = MemoryRecord.model_validate(record.model_dump())
        with self.transaction(write=True) as tx:
            row = tx.execute("SELECT document FROM memory_records WHERE id=?", (record.id,)).fetchone()
            current = MemoryRecord.model_validate_json(row[0]) if row else None
            if (expected_revision != (current.revision if current else None)
                    or record.revision != (current.revision + 1 if current else 1)):
                raise DomainError("version_conflict", "记忆修订已改变")
            if current and (record.scope != current.scope or record.owner_id != current.owner_id):
                raise DomainError("scope_mismatch", "已有记忆不能更改所有者或提升范围")
            existing_scope = tx.execute("SELECT kind FROM scopes WHERE id=?", (record.id,)).fetchone()
            if existing_scope is not None and existing_scope[0] != "memory":
                raise DomainError("scope_mismatch", "归档记忆身份不能占用其他来源范围")
            owner_scope = scope_id(tx, record.scope)
            tx.execute("INSERT INTO scopes(id,kind,workspace_id,epoch,status) VALUES (?,'memory',?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,status=excluded.status",
                (record.id, record.scope.workspace_id, record.revision,
                 "deleted" if record.status == "deleted" else "active"))
            tx.execute("INSERT INTO memory_records VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "current_revision=excluded.current_revision,document=excluded.document",
                (record.id, owner_scope, record.revision, record.model_dump_json()))
            tx.execute("INSERT INTO memory_revisions VALUES (?,?,?)",
                (record.id, record.revision, record.model_dump_json()))
            if record.status == "deleted":
                for previous in tx.execute("SELECT document FROM memory_revisions WHERE record_id=?",
                        (record.id,)).fetchall():
                    old = MemoryRecord.model_validate_json(previous[0]).model_copy(update={
                        "status": "deleted", "text": "", "evidence": [], "dependencies": []})
                    tx.execute("UPDATE memory_revisions SET document=? WHERE record_id=? AND revision=?",
                        (old.model_dump_json(), record.id, old.revision))
            return record

    def put_candidate(self, candidate):
        candidate = MemoryCandidate.model_validate(candidate.model_dump())
        with self.transaction(write=True) as tx:
            record = self.using(tx).get(candidate.record_id)
            if record.scope != candidate.scope:
                raise DomainError("scope_mismatch", "候选不属于记忆范围")
            row = tx.execute("SELECT document FROM memory_candidates WHERE id=? OR "
                "(scope_id=? AND source_version=? AND policy_version=? AND normalized_claim=?)",
                (candidate.id, scope_id(tx, candidate.scope), candidate.source_version,
                 candidate.policy_version, candidate.normalized_claim)).fetchone()
            if row is not None:
                if MemoryCandidate.model_validate_json(row[0]) != candidate:
                    raise DomainError("candidate_conflict", "候选去重身份已被使用")
                return
            tx.execute("INSERT INTO memory_candidates VALUES (?,?,?,?,?,?)",
                (candidate.id, scope_id(tx, candidate.scope), candidate.source_version,
                 candidate.policy_version, candidate.normalized_claim, candidate.model_dump_json()))

    def export_scope(self, scope):
        with self.transaction() as tx:
            id = scope_id(tx, scope)
            return MemoryArchive(scope=scope,
                records=[MemoryRecord.model_validate_json(row[0]) for row in tx.execute(
                    "SELECT document FROM memory_records WHERE scope_id=? ORDER BY id", (id,))],
                revisions=[MemoryRecord.model_validate_json(row[0]) for row in tx.execute(
                    "SELECT v.document FROM memory_revisions v JOIN memory_records r ON r.id=v.record_id "
                    "WHERE r.scope_id=? ORDER BY v.record_id,v.revision", (id,))],
                candidates=[MemoryCandidate.model_validate_json(row[0]) for row in tx.execute(
                    "SELECT document FROM memory_candidates WHERE scope_id=? ORDER BY id", (id,))])

    def import_scope(self, archive):
        archive = validate_archive(archive)
        with self.transaction(write=True) as tx:
            bound = self.using(tx)
            existing = bound.export_scope(archive.scope)
            if existing.records:
                if existing != archive:
                    raise DomainError("archive_conflict", "导入不能覆盖已有记忆或决定")
                return
            for record in archive.revisions:
                bound.put(record, record.revision - 1 if record.revision > 1 else None)
            for candidate in archive.candidates:
                bound.put_candidate(candidate)
