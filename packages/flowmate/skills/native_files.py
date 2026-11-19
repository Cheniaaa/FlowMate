"""标准包的受控 Windows 文件衔接，不负责管理授权或持久回执。"""

import os
from contextlib import ExitStack

from flowmate.contracts.base import DomainError
from flowmate.skills.packages import (
    MAX_FILE_BYTES,
    MAX_FILES,
    MAX_TOTAL_BYTES,
    SkillPackage,
    export_zip,
    import_directory,
    import_zip,
)
from flowmate.tools import files as native
from flowmate.tools.files import (
    ExportTarget,
    FileAnchor,
    NativeApplyError,
    NativeTextFiles,
)

# 给文件名的两份 ZIP 头及压缩开销留界；内容限额仍由格式层逐文件执行。
MAX_ARCHIVE_BYTES = 2 * MAX_TOTAL_BYTES + MAX_FILES * (2 * 65535 + 76) + 65535 + 22


class SkillSaveUncertain(NativeApplyError):
    """命令已登记后的发布未获确定回执；按原 command_id 查询，不自动重放。"""

    def __init__(self, command_id, target_path, backup_path):
        self.command_id = command_id
        self.target_path = target_path
        self.backup_path = backup_path
        super().__init__("skill_export_unconfirmed")


class NativeSkillFiles(NativeTextFiles):
    def __init__(self):
        super().__init__(max_file_bytes=MAX_ARCHIVE_BYTES, allowed_extensions=(".zip",))

    def read_package(
        self, anchor: FileAnchor, *, directory_name: str | None = None, cancel=None,
    ) -> SkillPackage:
        native._cancelled(cancel)
        with ExitStack() as handles:
            path = native._local_path(anchor.canonical_path)
            handle, actual, size = native._open_chain(self._kernel, handles, path,
                native._GENERIC_READ if anchor.kind == "file" else native._READ_ATTRIBUTES)
            native._match_anchor(anchor, actual)
            if actual.kind == "file":
                self._extension(path)
                raw = native._read_bytes(self._kernel, handle, size, MAX_ARCHIVE_BYTES, cancel)
                native._cancelled(cancel)
                return import_zip(raw, directory_name=directory_name)
            contents, total = {}, 0
            pending = [(path, "")]
            while pending:
                directory, prefix = pending.pop()
                native._cancelled(cancel)
                try:
                    with os.scandir(native._native_path(directory)) as entries:
                        for entry in entries:
                            native._cancelled(cancel)
                            native._components(entry.name)
                            relative = f"{prefix}/{entry.name}" if prefix else entry.name
                            child_path = directory / entry.name
                            child_handle, child, size = native._open_checked(
                                self._kernel, handles, child_path, native._GENERIC_READ)
                            if child.kind == "directory":
                                pending.append((child_path, relative))
                                continue
                            if len(contents) == MAX_FILES:
                                raise DomainError("skill_package_limit")
                            raw = native._read_bytes(self._kernel, child_handle, size,
                                min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total), cancel)
                            total += len(raw)
                            contents[relative] = raw
                except OSError:
                    raise DomainError("file_access_failed") from None
            native._cancelled(cancel)
            return import_directory(path.name, contents)

    def package_payload(
        self, package: SkillPackage, target: ExportTarget, *,
        expected_target_hash: str | None = None,
    ) -> bytes:
        """核对已确认目标并编码二进制；实际发布只经 SkillExports 管理命令。"""
        if len(native._components(target.name)) != 1 or target.parent.kind != "directory":
            raise DomainError("file_path_invalid")
        self._extension(target.name)
        if ((target.identity is None) != (target.content_hash is None)
                or target.identity is not None and (
                    not isinstance(target.content_hash, str)
                    or not native._HASH.fullmatch(target.content_hash))):
            raise DomainError("file_target_invalid")
        if target.identity is not None and expected_target_hash != target.content_hash:
            raise DomainError("file_overwrite_confirmation_required")
        payload = export_zip(package)
        if len(payload) > MAX_ARCHIVE_BYTES:
            raise DomainError("file_too_large")
        return payload
