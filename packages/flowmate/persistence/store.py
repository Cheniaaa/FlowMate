"""一个SQLite事务入口；只访问相关实体，不复制整库。"""

import json
import logging
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from importlib.resources import files
from pathlib import Path
from typing import Literal

from flowmate.config import APPLICATION_ID, SCHEMA_VERSION
from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.events import NewEvent, RunEvent
from flowmate.contracts.settings import AgentProfile, ModelConnection, ModelProfile
from flowmate.persistence.events import apply_event

ProfileKind = Literal["agent", "model"]
PROFILE_TYPES = {"agent": AgentProfile, "model": ModelProfile}


class UnitOfWork:
    """仅领域服务/reducer使用；不作为插件或API出口。"""

    def __init__(self, connection: sqlite3.Connection):
        self._connection = connection
        self.emitted = False

    def execute(self, sql: str, parameters=()) -> sqlite3.Cursor:
        return self._connection.execute(sql, parameters)

    def previous_command(self, command_id):
        if self.execute("SELECT 1 FROM deleted_commands WHERE command_id=?", (command_id,)).fetchone():
            raise DomainError("scope_deleted", "命令所属范围已删除，不能重放")
        return self.execute("SELECT * FROM commands WHERE command_id=?", (command_id,)).fetchone()

    def get_profile(self, kind: ProfileKind, id: str, version: int | None = None):
        model = PROFILE_TYPES[kind]
        if version is None:
            row = self.execute(
                f"SELECT r.document FROM {kind}_revisions r JOIN {kind}_profiles p "
                "ON p.id = r.profile_id AND p.current_version = r.version WHERE p.id = ?", (id,),
            ).fetchone()
        else:
            row = self.execute(
                f"SELECT document FROM {kind}_revisions WHERE profile_id = ? AND version = ?",
                (id, version),
            ).fetchone()
        if row is None:
            raise DomainError("not_found", "配置不存在", related_ids=(id,))
        return model.model_validate_json(row["document"])

    def get_connection(self, id: str, version: int | None = None) -> ModelConnection:
        if version is None:
            row = self.execute(
                "SELECT r.document FROM connection_revisions r JOIN model_connections c "
                "ON c.id=r.connection_id AND c.current_version=r.version WHERE c.id=?", (id,),
            ).fetchone()
        else:
            row = self.execute("SELECT document FROM connection_revisions WHERE connection_id=? AND version=?",
                               (id, version)).fetchone()
        if row is None:
            raise DomainError("not_found", "连接不存在", related_ids=(id,))
        return ModelConnection.model_validate_json(row["document"])

    def save_connection(self, connection: ModelConnection) -> None:
        row = self.execute("SELECT current_version FROM model_connections WHERE id=?", (connection.id,)).fetchone()
        if connection.version != (row[0] + 1 if row else 1):
            raise DomainError("version_conflict", "连接修订必须连续")
        self.execute("INSERT INTO model_connections VALUES (?,?) ON CONFLICT(id) DO UPDATE SET "
                     "current_version=excluded.current_version", (connection.id, connection.version))
        self.execute("INSERT INTO connection_revisions VALUES (?,?,?)",
                     (connection.id, connection.version, connection.model_dump_json()))

    def save_profile(self, kind: ProfileKind, profile: AgentProfile | ModelProfile) -> None:
        PROFILE_TYPES[kind]
        previous = self.execute(
            f"SELECT current_version FROM {kind}_profiles WHERE id = ?", (profile.id,),
        ).fetchone()
        next_version = previous[0] + 1 if previous else 1
        if profile.version != next_version:
            raise DomainError("version_conflict", "配置修订必须连续")
        if previous is None:
            if kind == "model":
                self.execute("INSERT INTO model_profiles VALUES (?, ?, ?, ?)",
                             (profile.id, profile.version, profile.connection_id, profile.model_id))
            else:
                self.execute("INSERT INTO agent_profiles VALUES (?, ?)", (profile.id, profile.version))
        else:
            self.execute(f"UPDATE {kind}_profiles SET current_version = ? WHERE id = ?",
                         (profile.version, profile.id))
        if kind == "agent":
            self.execute("INSERT INTO agent_revisions VALUES (?, ?, ?, ?)",
                         (profile.id, profile.version, profile.default_model_profile_id,
                          profile.model_dump_json()))
        else:
            self.execute("INSERT INTO model_revisions VALUES (?, ?, ?)",
                         (profile.id, profile.version, profile.model_dump_json()))

    def append_event(self, event: NewEvent) -> RunEvent:
        if event.event_version != 1:
            raise DomainError("blocked_incompatible", "事件版本不兼容")
        event = NewEvent.model_validate(event.model_dump())
        seq = None
        if event.run_id is not None:
            seq = self.execute("SELECT coalesce(max(seq), 0) + 1 FROM events WHERE run_id = ?",
                               (event.run_id,)).fetchone()[0]
        cursor = self.execute(
            "INSERT INTO events(run_id, seq, workspace_id, session_id, event_version, document) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (event.run_id, seq, event.workspace_id, event.session_id, event.event_version,
             event.model_dump_json()),
        )
        published = RunEvent(**event.model_dump(), event_id=cursor.lastrowid, seq=seq)
        apply_event(self, published)
        self.emitted = True
        return published


class Store:
    def __init__(self, path: Path):
        self.path = path
        self._closed = False
        self._listeners = []

    @staticmethod
    def _check_schema(connection: sqlite3.Connection) -> int:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        app_id = connection.execute("PRAGMA application_id").fetchone()[0]
        has_tables = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
        ).fetchone()
        if (version not in {0, SCHEMA_VERSION}
                or (version == 0 and (has_tables or app_id not in {0, APPLICATION_ID}))
                or (version == SCHEMA_VERSION and app_id != APPLICATION_ID)):
            raise DomainError("blocked_incompatible", "数据库版本或应用身份不兼容")
        return version

    @classmethod
    def open(cls, data_dir: Path) -> "Store":
        data_dir = Path(data_dir).resolve()
        path = data_dir / "flowmate.sqlite3"
        # 已有库先只读检查，未来版本或别的应用数据库不会被设置WAL或重建。
        if path.exists():
            connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
            try:
                cls._check_schema(connection)
            finally:
                connection.close()
        data_dir.mkdir(parents=True, exist_ok=True)
        store = cls(path)
        connection = store._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            if cls._check_schema(connection) == 0:
                schema = files("flowmate.persistence").joinpath("schema.sql").read_text("utf-8")
                for statement in schema.split(";"):
                    if statement.strip():
                        connection.execute(statement)
                user_scope_id = identifier()
                connection.execute("INSERT INTO scopes(id,kind) VALUES (?,'user_global')", (user_scope_id,))
                connection.execute("INSERT INTO local_identity VALUES (1,?)", (user_scope_id,))
                connection.execute(f"PRAGMA application_id = {APPLICATION_ID}")
                connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            # 同一版本的已有账本也补建查询索引，无需修改事实或投影。
            for suffix, columns in (("workspace", "workspace_id, event_id"), ("run", "run_id, seq")):
                connection.execute(
                    f"CREATE INDEX IF NOT EXISTS events_model_dispatch_{suffix} ON events({columns}) "
                    "WHERE json_extract(document,'$.kind')='activity.dispatched' "
                    "AND json_extract(document,'$.payload.activities[0].intent.kind')='model'"
                )
            connection.commit()
            connection.execute("PRAGMA journal_mode = WAL")
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()
        return store

    def _connect(self) -> sqlite3.Connection:
        if self._closed:
            raise RuntimeError("store is closed")
        connection = sqlite3.connect(self.path, timeout=5.0, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA secure_delete = ON")
        return connection

    def checkpoint(self) -> bool:
        """清理不能等待外部读者无限释放快照；繁忙时保留待清理事实。"""
        connection = self._connect()
        try:
            # 先以正常连接策略加入 WAL，避免首次访问与最后连接关闭的 exclusive 清理锁竞争。
            # 此读操作不保留事务；随后 checkpoint 仍不等待持有旧快照的读者。
            connection.execute("PRAGMA main.user_version").fetchone()
            connection.execute("PRAGMA busy_timeout = 0")
            return connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0] == 0
        finally:
            connection.close()

    @contextmanager
    def transaction(self, *, write: bool = True) -> Iterator[UnitOfWork]:
        connection = self._connect()
        tx = UnitOfWork(connection)
        try:
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield tx
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()
        if tx.emitted:
            for listener in tuple(self._listeners):
                try:
                    listener()
                except Exception:
                    logging.getLogger(__name__).warning("运行事实已提交，内存监听器唤醒失败")

    def subscribe(self, listener):
        """通知只唤醒读取者，持久游标和outbox仍是事实来源。"""
        self._listeners.append(listener)

        def unsubscribe():
            if listener in self._listeners:
                self._listeners.remove(listener)

        return unsubscribe

    def events(self, run_id: str | None, after_seq: int, limit: int) -> list[RunEvent]:
        """run_id为空读取全局event_id游标；指定Run时读取其seq游标。"""
        if after_seq < 0 or not 1 <= limit <= 500:
            raise ValueError("事件查询范围无效")
        with self.transaction(write=False) as tx:
            if run_id is None:
                rows = tx.execute("SELECT * FROM events WHERE event_id > ? ORDER BY event_id LIMIT ?",
                                  (after_seq, limit)).fetchall()
            else:
                rows = tx.execute(
                    "SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?",
                    (run_id, after_seq, limit),
                ).fetchall()
        return [RunEvent.model_validate_json(json.dumps({
            **json.loads(row["document"]), "event_id": str(row["event_id"]), "seq": row["seq"],
        })) for row in rows]

    def close(self) -> None:
        self._closed = True
