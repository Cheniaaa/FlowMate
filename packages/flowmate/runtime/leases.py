"""事务内的Session推进权；释放保留代次，旧回执不能释放新租约。"""

from flowmate.contracts.base import Contract, DomainError, Id, Version


class SessionLease(Contract):
    session_id: Id
    run_id: Id
    generation: Version


def acquire_session(tx, session_id: Id, run_id: Id) -> SessionLease:
    row = tx.execute("SELECT run_id,generation FROM session_leases WHERE session_id=?",
                     (session_id,)).fetchone()
    if row is not None and row["run_id"] is not None:
        if row["run_id"] != run_id:
            raise DomainError("session_busy", "会话已有推进中的运行", related_ids=(row["run_id"],))
        return SessionLease(session_id=session_id, run_id=run_id, generation=row["generation"])
    generation = row["generation"] + 1 if row is not None else 1
    tx.execute("INSERT INTO session_leases VALUES (?,?,?) ON CONFLICT(session_id) DO UPDATE SET "
               "run_id=excluded.run_id,generation=excluded.generation", (session_id, run_id, generation))
    return SessionLease(session_id=session_id, run_id=run_id, generation=generation)


def release_session(tx, lease: SessionLease) -> None:
    tx.execute("UPDATE session_leases SET run_id=NULL WHERE session_id=? AND run_id=? AND generation=?",
               (lease.session_id, lease.run_id, lease.generation))


def owns_session(tx, session_id: Id, run_id: Id, *, generation: Version | None = None) -> bool:
    row = tx.execute("SELECT run_id,generation FROM session_leases WHERE session_id=?",
                     (session_id,)).fetchone()
    return (row is not None and row["run_id"] == run_id
            and (generation is None or row["generation"] == generation))
