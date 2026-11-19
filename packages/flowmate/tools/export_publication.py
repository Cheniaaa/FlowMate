"""单Runtime内的可恢复发布；journal只记录外部文件事实，不替代SQLite回执。"""

import hashlib
import os
from collections.abc import Callable, Iterable
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import Field

from flowmate.contracts.base import CommandMeta, Contract, DomainError, identifier
from flowmate.contracts.execution import ActivitySnapshot, ExecutionContext, ScopeDependency
from flowmate.contracts.publication import PublicationView
from flowmate.persistence.store import Store
from flowmate.tools import files as native
from flowmate.tools.files import ExportTarget, FileApplyReceipt, NativeApplyError, NativeTextFiles

_DISPOSED = {"released", "restored", "finalized"}
_UNAVAILABLE = {
    "file_not_found", "file_access_failed", "file_busy", "file_identity_changed",
    "file_path_changed", "file_reparse_rejected", "file_kind_invalid", "file_too_large",
}


class _Command(Contract):
    operation: Literal["restore", "release"]
    meta: CommandMeta
    result: PublicationView | None = None


class _Record(Contract):
    format_version: Literal[1] = 1
    view: PublicationView
    target: ExportTarget
    scopes: list[ScopeDependency]
    stage_name: str
    backup_name: str | None
    stage_identity: str
    content_hash: str
    commands: dict[str, _Command] = Field(default_factory=dict)


class ExportPublication:
    def __init__(self, store: Store, files: NativeTextFiles, directory: Path, *,
                 is_executing: Callable[[str, str], bool] | None = None):
        self.store, self.files, self.directory = store, files, Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        # 一个Runtime只构造一个实例；包括to_thread调用和删除判定，不另建锁注册表。
        self._lock = RLock()
        self._is_executing = is_executing

    def _path(self, publication_id):
        try:
            if str(UUID(publication_id)) != publication_id:
                raise ValueError
        except (ValueError, TypeError, AttributeError):
            raise DomainError("export_publication_not_found") from None
        return self.directory / f"{publication_id}.json"

    def _read(self, publication_id):
        try:
            raw = self._path(publication_id).read_bytes()
        except FileNotFoundError:
            raise DomainError("export_publication_not_found") from None
        record = _Record.model_validate_json(raw)
        if record.view.id != publication_id:
            raise DomainError("export_publication_corrupt")
        return record

    def _records(self):
        return [self._read(path.stem) for path in sorted(self.directory.glob("*.json"))]

    def _persist(self, record):
        path = self._path(record.view.id)
        temporary = self.directory / f"{record.view.id}.{identifier()}.tmp"
        try:
            with temporary.open("xb") as stream:
                stream.write(record.model_dump_json().encode("utf-8"))
                stream.flush()
                os.fsync(stream.fileno())
            # Windows下同时要求rename完成刷盘；仅os.replace不表达WRITE_THROUGH。
            native._check(self.files._kernel.MoveFileExW(
                native._native_path(temporary), native._native_path(path), 0x1 | 0x8,
            ))
        finally:
            temporary.unlink(missing_ok=True)

    def _activity(self, activity_id):
        with self.store.transaction(write=False) as tx:
            row = tx.execute("SELECT document FROM activities WHERE id=?", (activity_id,)).fetchone()
        if row is None:
            raise DomainError("export_activity_not_found")
        return ActivitySnapshot.model_validate_json(row[0])

    def _require_stopped(self, record):
        view = record.view
        executing = (self._is_executing(view.activity_id, view.attempt_id)
                     if self._is_executing is not None else
                     self._activity(view.activity_id).state == "dispatched")
        if executing:
            raise DomainError("export_activity_running")

    def _receipt_committed(self, record):
        activity = self._activity(record.view.activity_id)
        receipt = activity.receipt
        if (activity.attempt_id != record.view.attempt_id or receipt is None or not receipt.confirmed
                or receipt.error is not None or activity.result_digest is None):
            return False
        # 围栏后的accounting-only提交按既有契约省略result，仍保留确定回执及digest。
        return receipt.result is None or (
            isinstance(receipt.result, dict) and receipt.result.get("state") == "applied"
            and receipt.result.get("content_hash") == record.content_hash
        )

    def _observe(self, record, handles):
        def matches(key, identity, digest):
            fact = handles[key]
            return fact is not None and fact[1:] == (identity, digest)

        old = matches("target", record.target.identity, record.target.content_hash)
        new = matches("target", record.stage_identity, record.content_hash)
        stage = matches("stage", record.stage_identity, record.content_hash)
        backup = (matches("backup", record.target.identity, record.target.content_hash)
                  if record.backup_name is not None else None)
        target = "published" if new else "original" if old else (
            "missing" if handles["target"] is None else "other")
        state = record.view.state
        if new and (record.backup_name is None or backup or (
            handles["backup"] is None and self._receipt_committed(record)
        )):
            state = "published"
        elif old and handles["backup"] is None:
            state = "staged" if stage and state == "staged" else "restored"
        elif target == "missing" and backup:
            state = "needs_restore"
        elif record.target.identity is None and target == "missing" and stage:
            state = "staged"
        elif (record.target.identity is None and target == "missing"
              and handles["stage"] is None and handles["backup"] is None
              and any(command.operation == "restore" and command.result is None
                      for command in record.commands.values())):
            state = "restored"
        else:
            state = "conflict"
        return record.view.model_copy(update={
            "state": state, "target_matches": target, "stage_matches": stage,
            "backup_matches": backup, "last_checked": datetime.now(UTC),
        })

    def _checked(self, record):
        if record.view.state in _DISPOSED:
            return record
        try:
            with self.files.publication_handles(record.target, record.stage_name, record.backup_name) as handles:
                view = self._observe(record, handles)
        except DomainError as error:
            if error.code not in _UNAVAILABLE:
                raise
            view = record.view.model_copy(update={
                "state": "conflict", "target_matches": "unknown", "stage_matches": None,
                "backup_matches": None, "last_checked": datetime.now(UTC),
            })
        return record.model_copy(update={"view": view})

    def _save_checked(self, record):
        checked = self._checked(record)
        if checked == record:
            return record
        changed = checked.view.model_dump(exclude={"last_checked", "version"}) != (
            record.view.model_dump(exclude={"last_checked", "version"}))
        view = checked.view.model_copy(update={"version": record.view.version + int(changed)})
        checked = checked.model_copy(update={"view": view})
        self._persist(checked)
        return checked

    def publish(self, ctx: ExecutionContext, target: ExportTarget, content: str | bytes, *,
                expected_target_hash: str | None) -> FileApplyReceipt:
        payload = self.files.export_payload(target, content, expected_target_hash=expected_target_hash)
        digest = hashlib.sha256(payload).hexdigest()
        with self._lock:
            activity = self._activity(ctx.activity_id)
            if activity.run_id != ctx.run_id or activity.task_id != ctx.task_id:
                raise DomainError("export_activity_mismatch")
            publication_id = str(uuid5(NAMESPACE_URL, f"flowmate:export:{activity.id}:{activity.attempt_id}"))
            if self._path(publication_id).exists():
                record = self._read(publication_id)
                if record.target != target or record.content_hash != digest:
                    raise DomainError("export_publication_mismatch")
                record = self._save_checked(record)
                if record.view.state in {"published", "finalized"}:
                    return FileApplyReceipt(record.stage_identity, digest, True)
                raise NativeApplyError("file_apply_uncertain", related_ids=(publication_id,))
            if activity.state != "dispatched":
                raise DomainError("export_not_dispatched")
            with self.store.transaction(write=False) as tx:
                state = tx.execute("SELECT state FROM runs WHERE id=?", (ctx.run_id,)).fetchone()[0]
            if state in {"cancelled", "failed", "completed"}:
                raise DomainError("export_run_stopped")
            stage_name = f".flowmate-{publication_id}.stage"
            backup_name = f".flowmate-{publication_id}.backup" if target.identity is not None else None
            path = Path(target.parent.canonical_path)
            with self.files.stage_export(target, payload, stage_name) as staged:
                view = PublicationView(
                    id=publication_id, version=1, state="staged", workspace_id=ctx.workspace_id,
                    session_id=ctx.session_id, run_id=ctx.run_id, task_id=ctx.task_id,
                    activity_id=activity.id, attempt_id=activity.attempt_id,
                    target_path=str(path / target.name), stage_path=str(path / stage_name),
                    backup_path=str(path / backup_name) if backup_name else None,
                )
                scopes = list({item.scope_id: item for item in (
                    *ctx.scope_dependencies, *activity.intent.dependencies,
                )}.values())
                record = _Record(view=view, target=target, scopes=scopes,
                                 stage_name=stage_name, backup_name=backup_name,
                                 stage_identity=staged.stage_identity, content_hash=digest)
                self._persist(record)
                staged.retained = True
                try:
                    if staged.original is not None:
                        native._rename_without_replace(staged.kernel, staged.original, path / backup_name)
                    native._rename_without_replace(staged.kernel, staged.stage, path / target.name)
                    actual, size = native._metadata(staged.kernel, staged.stage, path / target.name)
                    raw = native._read_bytes(staged.kernel, staged.stage, size, self.files.max_file_bytes)
                    if actual.identity != staged.stage_identity or hashlib.sha256(raw).hexdigest() != digest:
                        raise DomainError("file_stage_changed")
                except DomainError as error:
                    # journal已落盘，不能把两次改名之间的失败报告成无副作用。
                    raise NativeApplyError("file_apply_uncertain", related_ids=(publication_id,)) from error
                view = view.model_copy(update={
                    "version": 2, "state": "published", "target_matches": "published",
                    "stage_matches": False, "backup_matches": bool(backup_name) if backup_name else None,
                    "last_checked": datetime.now(UTC),
                })
                self._persist(record.model_copy(update={"view": view}))
                return FileApplyReceipt(staged.stage_identity, digest, True)

    def inspect(self, publication_id: str) -> PublicationView:
        with self._lock:
            return self._save_checked(self._read(publication_id)).view

    def list_for_run(self, run_id: str) -> list[PublicationView]:
        with self._lock:
            return [self._save_checked(record).view for record in self._records() if record.view.run_id == run_id]

    def reconcile(self) -> list[PublicationView]:
        """启动只核查，不发布/恢复/结算。released等处置终态完全不访问外部路径。"""
        with self._lock:
            return [self._save_checked(record).view for record in self._records()]

    def applied_receipt(self, publication_id: str) -> FileApplyReceipt | None:
        with self._lock:
            record = self._save_checked(self._read(publication_id))
            if record.view.state not in {"published", "finalized"}:
                return None
            return FileApplyReceipt(record.stage_identity, record.content_hash, True)

    def _command(self, record, operation, meta):
        for existing in self._records():
            previous = existing.commands.get(meta.command_id)
            if previous is not None:
                if existing.view.id != record.view.id or previous.operation != operation or previous.meta != meta:
                    raise DomainError("command_conflict")
                if previous.result is None:
                    if record.view.state in {"released", "finalized"}:
                        raise DomainError("export_publication_disposed")
                    self._require_stopped(record)
                return previous.result
        if meta.expected_version != record.view.version:
            raise DomainError("version_conflict", related_ids=(record.view.id,))
        if record.view.state in _DISPOSED:
            raise DomainError("export_publication_disposed")
        self._require_stopped(record)
        return None

    def _save_command(self, record, operation, meta, view):
        view = view.model_copy(update={"version": record.view.version + 1})
        commands = {**record.commands, meta.command_id: _Command(operation=operation, meta=meta, result=view)}
        self._persist(record.model_copy(update={"view": view, "commands": commands}))
        return view

    def restore(self, publication_id: str, meta: CommandMeta) -> PublicationView:
        with self._lock:
            record = self._read(publication_id)
            previous = self._command(record, "restore", meta)
            if previous is not None:
                return previous
            with self.files.publication_handles(record.target, record.stage_name, record.backup_name,
                                                mutable=True) as handles:
                view = self._observe(record, handles)
                pending = record.commands.get(meta.command_id)
                if view.state not in {"needs_restore", "staged"} and not (
                    view.state == "restored" and pending is not None
                ):
                    raise DomainError("export_restore_conflict")
                if pending is None:
                    # 外部改名前先持久命令身份；结果写入失败/强杀后仍能核对同命令。
                    record = record.model_copy(update={
                        "view": record.view.model_copy(update={"version": record.view.version + 1}),
                        "commands": {**record.commands, meta.command_id: _Command(operation="restore", meta=meta)},
                    })
                    self._persist(record)
                if view.state == "needs_restore":
                    native._rename_without_replace(self.files._kernel, handles["backup"][0], Path(view.target_path))
                if view.stage_matches:
                    native._delete_handle(self.files._kernel, handles["stage"][0])
                view = view.model_copy(update={
                    "state": "restored", "target_matches": "original" if record.target.identity else "missing",
                    "stage_matches": False,
                    "backup_matches": False if record.backup_name else None, "last_checked": datetime.now(UTC),
                })
                return self._save_command(record, "restore", meta, view)

    def release(self, publication_id: str, meta: CommandMeta) -> PublicationView:
        with self._lock:
            record = self._read(publication_id)
            previous = self._command(record, "release", meta)
            if previous is not None:
                return previous
            if record.view.state not in {"needs_restore", "conflict"}:
                raise DomainError("export_release_not_pending")
            checked = self._checked(record)
            if checked.view.state not in {"needs_restore", "conflict"}:
                raise DomainError("export_release_not_pending")
            return self._save_command(record, "release", meta, checked.view.model_copy(update={"state": "released"}))

    def finalize(self, activity_id: str, attempt_id: str) -> None:
        with self._lock:
            records = [record for record in self._records()
                       if (record.view.activity_id, record.view.attempt_id) == (activity_id, attempt_id)]
            if not records or records[0].view.state in _DISPOSED:
                return
            record, = records
            if not self._receipt_committed(record):
                raise DomainError("export_receipt_not_committed")
            try:
                with self.files.publication_handles(record.target, record.stage_name, record.backup_name,
                                                    mutable=True) as handles:
                    view = self._observe(record, handles)
                    if view.state != "published":
                        raise DomainError("export_finalize_conflict")
                    for key, matches in (("backup", view.backup_matches), ("stage", view.stage_matches)):
                        if handles[key] is not None:
                            if not matches:
                                raise DomainError("export_finalize_conflict")
                            native._delete_handle(self.files._kernel, handles[key][0])
                view = view.model_copy(update={"state": "finalized", "maintenance_reason": None,
                                               "stage_matches": False,
                                               "backup_matches": False if record.backup_name else None})
            except (OSError, DomainError) as error:
                view = record.view.model_copy(update={
                    "maintenance_reason": error.code if isinstance(error, DomainError) else "export_cleanup_failed",
                })
            view = view.model_copy(update={"version": record.view.version + 1})
            # journal失败必须上抛，不能伪称清理已持久完成；SQLite成功回执不回滚。
            self._persist(record.model_copy(update={"view": view}))

    def _scope_records(self, scope_ids: Iterable[str]):
        scopes = set(scope_ids)
        return [record for record in self._records() if scopes.intersection(
            {record.view.workspace_id, record.view.session_id, record.view.run_id,
             *(dependency.scope_id for dependency in record.scopes)}
        )]

    @contextmanager
    def deletion_guard(self, scope_ids: Iterable[str]):
        """调用者须将删除判定及内部映射删除包在此guard，不能先检查再解锁删除。"""
        with self._lock:
            records = [self._save_checked(record) for record in self._scope_records(scope_ids)]
            pending = tuple(record.view.id for record in records if record.view.state not in _DISPOSED)
            if pending:
                raise DomainError("export_recovery_pending", related_ids=pending)
            yield

    def forget_scope(self, scope_ids: Iterable[str]) -> None:
        """仅删除处置终态内部journal；永不清理released外部文件。"""
        scopes = tuple(scope_ids)
        with self.deletion_guard(scopes):
            for record in self._scope_records(scopes):
                self._path(record.view.id).unlink()
