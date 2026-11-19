"""仅按用户管理命令固定的 Skill ZIP 保存与恢复。"""

import hashlib
import os
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Literal
from uuid import UUID, uuid4

from pydantic import Field, ValidationError

from flowmate.contracts.base import Contract, DomainError, Id
from flowmate.skills.native_files import NativeSkillFiles, SkillSaveUncertain
from flowmate.skills.packages import SkillPackage
from flowmate.tools import files as native
from flowmate.tools.files import ExportTarget


class SkillExportReceipt(Contract):
    command_id: Id
    skill_id: Id
    content_hash: str
    target_ref: Id
    target_path: str
    zip_hash: str
    state: Literal["saved", "original", "needs_restore", "conflict"]
    target_identity: str | None
    target_matches: Literal["published", "original", "missing", "other", "unknown"]
    stage_path: str
    backup_path: str | None
    stage_matches: bool | None
    backup_matches: bool | None
    cleanup_pending: bool
    reason: str | None = None
    disposition: Literal["pending", "restored", "finalized", "released"] = "pending"

    @property
    def confirmed(self):
        return self.state == "saved"


class _Record(Contract):
    format_version: Literal[1] = 1
    command_id: Id
    skill_id: Id
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    target_ref: Id
    target: ExportTarget
    zip_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    stage_name: str
    backup_name: str | None
    stage_identity: str | None = None
    resolution: Literal["pending", "saved", "restoring", "restored"] = "pending"
    disposed_receipt: SkillExportReceipt | None = None


class SkillExportCommand(Contract):
    command_id: Id
    skill_id: Id
    content_hash: str
    target_ref: Id


class SkillExports:
    def __init__(self, files: NativeSkillFiles, directory: Path):
        self.files, self.directory = files, Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        # 同原发布器：一个 Runtime 构造一个实例，串行化管理命令与文件核对。
        self._lock = RLock()

    @contextmanager
    def operation_guard(self):
        """先持此锁，再读取目标授权/进入删除事务；与save使用同一实例。"""
        with self._lock:
            yield

    def check_deletion(self, target_refs):
        with self._lock:
            pending = [record.command_id for path in sorted(self.directory.glob("*.json"))
                if (record := self._read(path.stem)).target_ref in target_refs
                and record.disposed_receipt is None]
            if pending:
                raise DomainError("skill_export_recovery_pending",
                    "删除前请在能力库的“保存记录与恢复”中恢复或处置 Skill 保存命令，再次删除。",
                    related_ids=tuple(pending))

    def forget_missing_targets(self, target_refs):
        """仅收集已处置且引用已消失的私有日志，绝不访问或删外部文件。"""
        with self._lock:
            for path in sorted(self.directory.glob("*.json")):
                record = self._read(path.stem)
                if record.target_ref not in target_refs and record.disposed_receipt is not None:
                    path.unlink()

    def _dispose(self, record, receipt, disposition):
        result = receipt.model_copy(update={"disposition": disposition})
        self._persist(record.model_copy(update={"disposed_receipt": result}))
        return result

    def _path(self, command_id):
        try:
            if not isinstance(command_id, str) or str(UUID(command_id)) != command_id:
                raise ValueError
        except ValueError:
            raise DomainError("skill_export_command_invalid") from None
        return self.directory / f"{command_id}.json"

    def commands(self) -> list[SkillExportCommand]:
        """重开能力库只先读命令引用；宿主按 target_ref 授权后才核对外部文件。"""
        with self._lock:
            return [SkillExportCommand.model_validate(self._read(path.stem).model_dump(
                include=set(SkillExportCommand.model_fields)))
                for path in sorted(self.directory.glob("*.json"))]

    def _persist(self, record: _Record):
        # 沿原 ExportPublication 的完整写/fsync/WRITE_THROUGH 原子替换。
        path = self._path(record.command_id)
        temporary = self.directory / f"{record.command_id}.{uuid4().hex}.tmp"
        try:
            with temporary.open("xb") as stream:
                stream.write(record.model_dump_json().encode("utf-8"))
                stream.flush()
                os.fsync(stream.fileno())
            native._check(self.files._kernel.MoveFileExW(
                native._native_path(temporary), native._native_path(path), 0x1 | 0x8))
        finally:
            temporary.unlink(missing_ok=True)

    def _read(self, command_id):
        try:
            raw = self._path(command_id).read_bytes()
        except FileNotFoundError:
            raise DomainError("skill_export_not_found") from None
        try:
            record = _Record.model_validate_json(raw)
            expected_stage = f".flowmate-skill-{command_id}.stage"
            expected_backup = f".flowmate-skill-{command_id}.backup" if record.target.identity else None
            if (record.command_id != command_id or record.stage_name != expected_stage
                    or record.backup_name != expected_backup
                    or len(native._components(record.target.name)) != 1
                    or record.target.parent.kind != "directory"
                    or (record.target.identity is None) != (record.target.content_hash is None)
                    or record.target.content_hash is not None
                    and not native._HASH.fullmatch(record.target.content_hash)):
                raise ValueError
            if record.disposed_receipt is not None:
                receipt = record.disposed_receipt
                if (receipt.disposition == "pending"
                        or any(getattr(receipt, key) != getattr(record, key) for key in
                               ("command_id", "skill_id", "content_hash", "target_ref", "zip_hash"))):
                    raise ValueError
        except (ValidationError, ValueError, DomainError):
            raise DomainError("skill_export_record_corrupt") from None
        return record

    def _observe(self, record, handles=None, *, reason=None):
        target, stage, backup = (handles[key] if handles is not None else None
                                 for key in ("target", "stage", "backup"))

        def matches(fact, identity, digest):
            return fact is not None and identity is not None and fact[1:] == (identity, digest)

        old = matches(target, record.target.identity, record.target.content_hash)
        new = matches(target, record.stage_identity, record.zip_hash)
        staged = matches(stage, record.stage_identity, record.zip_hash)
        backed = matches(backup, record.target.identity, record.target.content_hash)
        target_matches = ("unknown" if reason else "published" if new else "original" if old
                          else "missing" if target is None else "other")
        if reason or (stage is not None and not staged) or (backup is not None and not backed):
            state = "conflict"
        elif new:
            state = "saved"
        elif (old and backup is None) or (record.target.identity is None and target is None):
            state = "original"
        elif target is None and backed:
            state = "needs_restore"
        else:
            state = "conflict"
        parent = Path(record.target.parent.canonical_path)
        return SkillExportReceipt(
            command_id=record.command_id, skill_id=record.skill_id,
            content_hash=record.content_hash, target_ref=record.target_ref,
            target_path=str(parent / record.target.name), zip_hash=record.zip_hash,
            state=state, target_identity=target[1] if target else None,
            target_matches=target_matches, stage_path=str(parent / record.stage_name),
            backup_path=str(parent / record.backup_name) if record.backup_name else None,
            stage_matches=staged if reason is None else None,
            backup_matches=(backed if reason is None else None) if record.backup_name else None,
            cleanup_pending=reason is not None or bool(stage or backup), reason=reason)

    def inspect(self, command_id) -> SkillExportReceipt:
        with self._lock:
            record = self._read(command_id)
            if record.disposed_receipt is not None:
                return record.disposed_receipt
            try:
                with self.files.publication_handles(
                        record.target, record.stage_name, record.backup_name) as handles:
                    return self._observe(record, handles)
            except DomainError as error:
                return self._observe(record, reason=error.code)
            except OSError:
                return self._observe(record, reason="file_access_failed")

    def save(self, package: SkillPackage, target: ExportTarget | None, *,
             command_id: str, skill_id: str, target_ref: str,
             expected_target_hash=None, cancel=None):
        if target is None:
            return None
        native._cancelled(cancel)
        path = self._path(command_id)
        payload = self.files.package_payload(package, target,
            expected_target_hash=expected_target_hash)
        record = _Record(command_id=command_id, skill_id=skill_id,
            content_hash=package.content_hash, target_ref=target_ref, target=target,
            zip_hash=hashlib.sha256(payload).hexdigest(),
            stage_name=f".flowmate-skill-{command_id}.stage",
            backup_name=f".flowmate-skill-{command_id}.backup" if target.identity else None)
        with self._lock:
            if path.exists():
                previous = self._read(command_id)
                fixed = {"command_id", "skill_id", "content_hash", "target_ref",
                         "target", "zip_hash", "stage_name", "backup_name"}
                if previous.model_dump(include=fixed) != record.model_dump(include=fixed):
                    raise DomainError("skill_export_command_conflict")
                return self.inspect(command_id)
            self._persist(record)
            prepared = False
            parent = Path(target.parent.canonical_path)
            try:
                with self.files.stage_export(target, payload, record.stage_name) as staged:
                    native._cancelled(cancel)
                    record = record.model_copy(update={"stage_identity": staged.stage_identity})
                    self._persist(record)
                    # 此后任何退出均保留与已持久命令绑定的外部文件，查询不重放。
                    staged.retained = True
                    prepared = True
                    if staged.original is not None:
                        native._rename_without_replace(staged.kernel, staged.original,
                                                       parent / record.backup_name)
                    native._rename_without_replace(staged.kernel, staged.stage, parent / target.name)
                    actual, size = native._metadata(staged.kernel, staged.stage, parent / target.name)
                    raw = native._read_bytes(staged.kernel, staged.stage, size,
                                            self.files.max_file_bytes)
                    if (actual.identity != record.stage_identity
                            or hashlib.sha256(raw).hexdigest() != record.zip_hash):
                        raise DomainError("file_stage_changed")
                    native._flush(staged.kernel, staged.stage)
                    record = record.model_copy(update={"resolution": "saved"})
                    self._persist(record)
                    if staged.original is not None:
                        native._delete_handle(staged.kernel, staged.original)
            except (DomainError, OSError) as error:
                if prepared:
                    raise SkillSaveUncertain(command_id, str(parent / target.name),
                        str(parent / record.backup_name) if record.backup_name else None) from error
                if isinstance(error, OSError):
                    raise DomainError("file_write_failed") from None
                raise
            receipt = self.inspect(command_id)
            return self._dispose(record, receipt, "finalized") if (
                receipt.state == "saved" and not receipt.cleanup_pending) else receipt

    def restore(self, command_id) -> SkillExportReceipt:
        with self._lock:
            record = self._read(command_id)
            if record.disposed_receipt is not None:
                if record.disposed_receipt.disposition != "restored":
                    raise DomainError("skill_export_disposed")
                return record.disposed_receipt
            with self.files.publication_handles(record.target, record.stage_name,
                                                record.backup_name, mutable=True) as handles:
                view = self._observe(record, handles)
                if view.state not in {"original", "needs_restore"}:
                    raise DomainError("skill_export_restore_conflict")
                record = record.model_copy(update={"resolution": "restoring"})
                self._persist(record)
                if view.state == "needs_restore":
                    native._rename_without_replace(self.files._kernel, handles["backup"][0],
                                                   Path(view.target_path))
                # 恢复仅还原旧文件；未保存命令的 stage 继续留有明确身份与命令归属。
                self._persist(record.model_copy(update={"resolution": "restored"}))
            return self.inspect(command_id)

    def finalize(self, command_id) -> SkillExportReceipt:
        with self._lock:
            record = self._read(command_id)
            if record.disposed_receipt is not None:
                if record.disposed_receipt.disposition == "released":
                    raise DomainError("skill_export_disposed")
                return record.disposed_receipt
            with self.files.publication_handles(record.target, record.stage_name,
                                                record.backup_name, mutable=True) as handles:
                view = self._observe(record, handles)
                if view.state not in {"saved", "original"}:
                    raise DomainError("skill_export_finalize_conflict")
                for key in ("stage", "backup"):
                    if handles[key] is not None:
                        native._delete_handle(self.files._kernel, handles[key][0])
            receipt = self.inspect(command_id)
            return self._dispose(record, receipt,
                "restored" if record.resolution == "restored" else "finalized")

    def release(self, command_id) -> SkillExportReceipt:
        """显式放弃自动恢复，只固定处置回执；目标、stage和backup保持原状。"""
        with self._lock:
            record = self._read(command_id)
            if record.disposed_receipt is not None:
                if record.disposed_receipt.disposition != "released":
                    raise DomainError("skill_export_disposed")
                return record.disposed_receipt
            return self._dispose(record, self.inspect(command_id), "released")
