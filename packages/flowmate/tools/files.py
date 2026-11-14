"""仅供可信资源记录调用的 Windows 文件 helper，不负责批准权限。

只支持本地盘符路径，保守拒绝目录链内的全部 reparse point。每次操作从卷根
逐级持有不分享写/删除的目录句柄，再校验最终路径及 file ID，避免 resolve/open
之间的竞态。发布只提供完整暂存及句柄操作，持久恢复由ExportPublication负责。
"""

import base64
import binascii
import ctypes
import hashlib
import heapq
import json
import os
import re
from collections.abc import Callable
from contextlib import ExitStack, contextmanager
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import Literal

from flowmate.contracts.base import DomainError


@dataclass(frozen=True)
class FileAnchor:
    canonical_path: str
    identity: str
    kind: Literal["file", "directory"]


@dataclass(frozen=True)
class FileRead:
    text: str
    start: int
    end: int
    total_chars: int
    source_version: str
    size_bytes: int
    line_count: int


@dataclass(frozen=True)
class FileEntry:
    name: str
    relative_path: str
    anchor: FileAnchor
    size_bytes: int


@dataclass(frozen=True)
class FilePage:
    items: list[FileEntry]
    next_cursor: str | None


@dataclass(frozen=True)
class ExportTarget:
    parent: FileAnchor
    name: str
    identity: str | None
    content_hash: str | None


@dataclass(frozen=True)
class FileApplyReceipt:
    target_identity: str
    content_hash: str
    confirmed: bool


class NativeApplyError(DomainError):
    """已发生或可能已发生写入，调用者不能安全地自动重试。"""

    uncertain = True


# Microsoft Learn 的 CreateFileW / FILE_INFO_BY_HANDLE_CLASS 定义，见切片 notes。
_GENERIC_READ = 0x80000000
_GENERIC_WRITE = 0x40000000
_DELETE = 0x10000
_WRITE_DAC = 0x40000
_SECURITY = 0x17  # owner/group/DACL/完整性label，不读取审计SACL。
_READ_ATTRIBUTES = 0x80
_SHARE_READ = 1
_CREATE_NEW = 1
_OPEN_EXISTING = 3
_BACKUP_SEMANTICS = 0x02000000
_OPEN_REPARSE_POINT = 0x00200000
_DIRECTORY = 0x10
_REPARSE_POINT = 0x400
_INVALID_HANDLE = ctypes.c_void_p(-1).value
_CHUNK_BYTES = 65536
_HASH = re.compile(r"^[0-9a-f]{64}$")


class _HandleInfo(ctypes.Structure):
    _fields_ = [
        ("attributes", wintypes.DWORD),
        ("creation", wintypes.FILETIME),
        ("access", wintypes.FILETIME),
        ("write", wintypes.FILETIME),
        ("volume", wintypes.DWORD),
        ("size_high", wintypes.DWORD),
        ("size_low", wintypes.DWORD),
        ("links", wintypes.DWORD),
        ("index_high", wintypes.DWORD),
        ("index_low", wintypes.DWORD),
    ]


class _FileIdInfo(ctypes.Structure):
    _fields_ = [("volume", ctypes.c_ulonglong), ("identifier", ctypes.c_ubyte * 16)]


class _RenameFlags(ctypes.Union):
    _fields_ = [("replace", wintypes.BYTE), ("flags", wintypes.DWORD)]


class _RenameInfo(ctypes.Structure):
    # 本机SDK WinBase.h的单一union布局；T1已验证x64 offsets 0/8/16/20。
    _fields_ = [("options", _RenameFlags), ("root", wintypes.HANDLE),
                ("name_bytes", wintypes.DWORD), ("name", wintypes.WCHAR * 1)]


class _SecurityAttributes(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("descriptor", ctypes.c_void_p),
                ("inherit_handle", wintypes.BOOL)]


def _win32():
    # 延迟装载使 DTO 可被契约代码导入；不提供不安全的非 Windows fallback。
    if os.name != "nt":
        raise DomainError("file_platform_unsupported")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateFileW": (
            [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
             wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE], wintypes.HANDLE,
        ),
        "CloseHandle": ([wintypes.HANDLE], wintypes.BOOL),
        "GetFileInformationByHandle": (
            [wintypes.HANDLE, ctypes.POINTER(_HandleInfo)], wintypes.BOOL,
        ),
        "GetFileInformationByHandleEx": (
            [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL,
        ),
        "GetFinalPathNameByHandleW": (
            [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD], wintypes.DWORD,
        ),
        "ReadFile": (
            [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
             ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p], wintypes.BOOL,
        ),
        "WriteFile": (
            [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
             ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p], wintypes.BOOL,
        ),
        "SetFilePointerEx": (
            [wintypes.HANDLE, ctypes.c_longlong, ctypes.POINTER(ctypes.c_longlong),
             wintypes.DWORD], wintypes.BOOL,
        ),
        "SetEndOfFile": ([wintypes.HANDLE], wintypes.BOOL),
        "FlushFileBuffers": ([wintypes.HANDLE], wintypes.BOOL),
        "SetFileInformationByHandle": (
            [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL,
        ),
        "LocalFree": ([ctypes.c_void_p], ctypes.c_void_p),
        "MoveFileExW": ([wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD], wintypes.BOOL),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(kernel, name)
        function.argtypes = arguments
        function.restype = result
    return kernel


def _error():
    code = ctypes.get_last_error()
    safe_code = {
        2: "file_not_found", 3: "file_not_found", 32: "file_busy", 33: "file_busy",
        80: "file_target_exists", 183: "file_target_exists",
    }.get(code, "file_access_failed")
    raise DomainError(safe_code) from None


def _check(success):
    if not success:
        _error()


def _components(relative: str) -> list[str]:
    if not isinstance(relative, str) or not relative:
        raise DomainError("file_path_invalid")
    parts = relative.replace("\\", "/").split("/")
    for part in parts:
        if (
            not part or part in {".", ".."} or part[-1] in " ."
            or any(ord(char) < 32 or char in '<>:"|?*' for char in part)
            or os.path.isreserved(part)
        ):
            raise DomainError("file_path_invalid")
    return parts


def _local_path(path: Path | str) -> Path:
    raw = str(path).replace("/", "\\")
    if not re.match(r"^[A-Za-z]:\\", raw):
        raise DomainError("file_path_invalid")
    tail = raw[3:]
    if tail:
        _components(tail)
    return Path(raw)


def _native_path(path: Path) -> str:
    return "\\\\?\\" + str(path)


def _open(kernel, stack: ExitStack, path: Path, access: int, disposition=_OPEN_EXISTING):
    handle = kernel.CreateFileW(
        _native_path(path), access, _SHARE_READ, None, disposition,
        _BACKUP_SEMANTICS | _OPEN_REPARSE_POINT, None,
    )
    if handle == _INVALID_HANDLE:
        _error()
    stack.callback(kernel.CloseHandle, handle)
    return handle


def _metadata(kernel, handle, path: Path) -> tuple[FileAnchor, int]:
    info = _HandleInfo()
    _check(kernel.GetFileInformationByHandle(handle, ctypes.byref(info)))
    if info.attributes & _REPARSE_POINT:
        raise DomainError("file_reparse_rejected")
    file_id = _FileIdInfo()
    _check(kernel.GetFileInformationByHandleEx(
        handle, 18, ctypes.byref(file_id), ctypes.sizeof(file_id),
    ))
    capacity = 512
    while True:
        buffer = ctypes.create_unicode_buffer(capacity)
        length = kernel.GetFinalPathNameByHandleW(handle, buffer, capacity, 0)
        _check(length)
        if length < capacity:
            break
        capacity = length + 1
    canonical = buffer.value
    if not canonical.startswith("\\\\?\\"):
        raise DomainError("file_path_invalid")
    canonical_path = _local_path(canonical[4:])
    if os.path.normcase(str(canonical_path)) != os.path.normcase(str(path)):
        raise DomainError("file_path_changed")
    identity = f"{file_id.volume:016x}:{bytes(file_id.identifier).hex()}"
    anchor = FileAnchor(
        str(canonical_path), identity, "directory" if info.attributes & _DIRECTORY else "file",
    )
    return anchor, (info.size_high << 32) | info.size_low


def _open_checked(kernel, stack, path, access):
    handle = _open(kernel, stack, path, access)
    anchor, size = _metadata(kernel, handle, path)
    return handle, anchor, size


def _open_chain(kernel, stack, path, access):
    # OPEN_REPARSE_POINT 只约束最后一段；必须逐段打开、检查并保持祖先句柄。
    parts = path.parts
    current = Path(parts[0])
    result = _open_checked(kernel, stack, current, access if len(parts) == 1 else _READ_ATTRIBUTES)
    for index, part in enumerate(parts[1:], start=1):
        if result[1].kind != "directory":
            raise DomainError("file_kind_invalid")
        current /= part
        result = _open_checked(
            kernel, stack, current, access if index == len(parts) - 1 else _READ_ATTRIBUTES,
        )
    return result


def _match_anchor(expected: FileAnchor, actual: FileAnchor):
    if expected.identity != actual.identity or expected.kind != actual.kind:
        raise DomainError("file_identity_changed")


@contextmanager
def _resource(kernel, anchor: FileAnchor, relative_path=""):
    parts = _components(relative_path) if relative_path else []
    if anchor.kind == "file" and parts:
        raise DomainError("file_path_invalid")
    path = _local_path(anchor.canonical_path)
    with ExitStack() as stack:
        result = _open_chain(
            kernel, stack, path, _GENERIC_READ if anchor.kind == "file" else _READ_ATTRIBUTES,
        )
        _match_anchor(anchor, result[1])
        for index, part in enumerate(parts):
            if result[1].kind != "directory":
                raise DomainError("file_kind_invalid")
            path /= part
            result = _open_checked(
                kernel, stack, path, _GENERIC_READ if index == len(parts) - 1 else _READ_ATTRIBUTES,
            )
        yield result


def _cancelled(cancel):
    if cancel is not None and cancel():
        raise DomainError("file_cancelled")


def _seek_start(kernel, handle):
    _check(kernel.SetFilePointerEx(handle, 0, None, 0))


def _read_bytes(kernel, handle, size, maximum, cancel=None):
    if size > maximum:
        raise DomainError("file_too_large")
    _seek_start(kernel, handle)
    chunks = []
    total = 0
    buffer = ctypes.create_string_buffer(_CHUNK_BYTES)
    while True:
        _cancelled(cancel)
        count = wintypes.DWORD()
        _check(kernel.ReadFile(handle, buffer, min(_CHUNK_BYTES, maximum - total + 1),
                               ctypes.byref(count), None))
        if not count.value:
            break
        total += count.value
        if total > maximum:
            raise DomainError("file_too_large")
        chunks.append(buffer.raw[:count.value])
    return b"".join(chunks)


def _write_payload(kernel, handle, payload):
    _seek_start(kernel, handle)
    position = 0
    while position < len(payload):
        chunk = payload[position:position + _CHUNK_BYTES]
        buffer = ctypes.create_string_buffer(chunk)
        count = wintypes.DWORD()
        _check(kernel.WriteFile(handle, buffer, len(chunk), ctypes.byref(count), None))
        if count.value == 0:
            raise DomainError("file_write_failed")
        position += count.value
    _check(kernel.SetEndOfFile(handle))


def _flush(kernel, handle):
    _check(kernel.FlushFileBuffers(handle))


def _rename_without_replace(kernel, handle, path):
    encoded = _native_path(path).encode("utf-16-le")
    buffer = ctypes.create_string_buffer(max(
        ctypes.sizeof(_RenameInfo), _RenameInfo.name.offset + len(encoded) + 2,
    ))
    info = _RenameInfo.from_buffer(buffer)
    info.options.replace = False
    info.name_bytes = len(encoded)
    ctypes.memmove(ctypes.addressof(buffer) + _RenameInfo.name.offset, encoded, len(encoded))
    _check(kernel.SetFileInformationByHandle(handle, 3, buffer, len(buffer)))


def _delete_handle(kernel, handle):
    disposition = wintypes.BOOL(True)
    _check(kernel.SetFileInformationByHandle(handle, 4, ctypes.byref(disposition),
                                            ctypes.sizeof(disposition)))


def _security_api():
    api = ctypes.WinDLL("advapi32", use_last_error=True)
    pointer = ctypes.POINTER(ctypes.c_void_p)
    signatures = {
        "GetSecurityInfo": ([wintypes.HANDLE, ctypes.c_int, wintypes.DWORD,
                             pointer, pointer, pointer, pointer, pointer], wintypes.DWORD),
        "SetSecurityInfo": ([wintypes.HANDLE, ctypes.c_int, wintypes.DWORD,
                             ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                             ctypes.c_void_p], wintypes.DWORD),
        "GetSecurityDescriptorControl": ([ctypes.c_void_p, ctypes.POINTER(wintypes.WORD),
                                           ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
        "GetSecurityDescriptorDacl": ([ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL),
                                       pointer, ctypes.POINTER(wintypes.BOOL)], wintypes.BOOL),
        "ConvertSecurityDescriptorToStringSecurityDescriptorW": (
            [ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, pointer,
             ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL,
        ),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(api, name)
        function.argtypes, function.restype = arguments, result
    return api


@contextmanager
def _descriptor(kernel, handle):
    descriptor = ctypes.c_void_p()
    code = _security_api().GetSecurityInfo(handle, 1, _SECURITY, None, None, None, None,
                                           ctypes.byref(descriptor))
    if code:
        raise DomainError("file_security_unavailable")
    try:
        yield descriptor
    finally:
        kernel.LocalFree(descriptor)


def _descriptor_text(kernel, descriptor):
    text = ctypes.c_void_p()
    _check(_security_api().ConvertSecurityDescriptorToStringSecurityDescriptorW(
        descriptor, 1, _SECURITY, ctypes.byref(text), None,
    ))
    try:
        return ctypes.wstring_at(text)
    finally:
        kernel.LocalFree(text)


def _create_stage(kernel, stack, path, security=None):
    attributes = _SecurityAttributes(ctypes.sizeof(_SecurityAttributes), security, False)
    handle = kernel.CreateFileW(
        _native_path(path), _GENERIC_READ | _GENERIC_WRITE | _DELETE | _WRITE_DAC,
        _SHARE_READ, ctypes.byref(attributes) if security else None,
        _CREATE_NEW, _OPEN_REPARSE_POINT, None,
    )
    if handle == _INVALID_HANDLE:
        _error()
    stack.callback(kernel.CloseHandle, handle)
    with ExitStack() as cleanup:
        cleanup.callback(_delete_handle, kernel, handle)
        if security:
            api = _security_api()
            control, revision = wintypes.WORD(), wintypes.DWORD()
            _check(api.GetSecurityDescriptorControl(security, ctypes.byref(control), ctypes.byref(revision)))
            if control.value & 0x400:
                dacl, present, defaulted = ctypes.c_void_p(), wintypes.BOOL(), wintypes.BOOL()
                _check(api.GetSecurityDescriptorDacl(security, ctypes.byref(present), ctypes.byref(dacl),
                                                     ctypes.byref(defaulted)))
                # CREATE_NEW未带入AI；仅原文件有AI时重应用，不能给无AI原文件新添AI。
                protection = 0x80000000 if control.value & 0x1000 else 0x20000000
                if api.SetSecurityInfo(handle, 1, 4 | protection, None, None, dacl, None):
                    raise DomainError("file_security_unavailable")
            with _descriptor(kernel, handle) as actual:
                if _descriptor_text(kernel, actual) != _descriptor_text(kernel, security):
                    raise DomainError("file_security_changed")
        cleanup.pop_all()
    return handle


@dataclass
class _StagedExport:
    kernel: object
    original: object
    stage: object
    stage_identity: str
    content_hash: str
    retained: bool = False


def _range(offset, limit, maximum):
    if type(offset) is not int or type(limit) is not int or offset < 0 or not 1 <= limit <= maximum:
        raise DomainError("file_range_invalid")


def _name_key(name):
    return name.casefold(), name


class NativeTextFiles:
    def __init__(
        self, max_file_bytes=8 * 1024 * 1024, allowed_extensions=(".md", ".txt"), *,
        max_read_chars=40000, max_batch_files=32, max_page_size=500,
    ):
        if any(type(value) is not int or value < 1 for value in (
            max_file_bytes, max_read_chars, max_batch_files, max_page_size,
        )):
            raise DomainError("file_config_invalid")
        if not allowed_extensions or any(
            not isinstance(ext, str) or not re.fullmatch(r"\.[A-Za-z0-9]+", ext)
            for ext in allowed_extensions
        ):
            raise DomainError("file_config_invalid")
        self.max_file_bytes = max_file_bytes
        self.allowed_extensions = tuple(ext.lower() for ext in allowed_extensions)
        self.max_read_chars = max_read_chars
        self.max_batch_files = max_batch_files
        self.max_page_size = max_page_size
        self._kernel = _win32()

    def _extension(self, path):
        if PureWindowsPath(path).suffix.lower() not in self.allowed_extensions:
            raise DomainError("file_extension_not_allowed")

    def capture(self, path: Path) -> FileAnchor:
        """可信本地选择入口；只打开属性句柄，不读源文件正文。"""
        path = _local_path(path)
        with ExitStack() as stack:
            return _open_chain(self._kernel, stack, path, _READ_ATTRIBUTES)[1]

    def _read(self, anchor, relative_path, offset, limit, source_version, cancel):
        _cancelled(cancel)
        with _resource(self._kernel, anchor, relative_path) as (handle, actual, size):
            if actual.kind != "file":
                raise DomainError("file_kind_invalid")
            self._extension(actual.canonical_path)
            raw = _read_bytes(self._kernel, handle, size, self.max_file_bytes, cancel)
            version = hashlib.sha256(raw).hexdigest()
            if source_version is not None and source_version != version:
                raise DomainError("file_source_changed")
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                raise DomainError("file_encoding_invalid") from None
            _cancelled(cancel)
            if offset > len(text):
                raise DomainError("file_range_invalid")
            end = min(offset + limit, len(text))
            return FileRead(
                text[offset:end], offset, end, len(text), version, len(raw), len(text.splitlines()),
            )

    def read_text(
        self, anchor: FileAnchor, relative_path: str = "", *, source_version: str | None = None,
        offset: int = 0, limit: int = 40000, cancel: Callable[[], bool] | None = None,
    ) -> FileRead:
        _range(offset, limit, self.max_read_chars)
        return self._read(anchor, relative_path, offset, limit, source_version, cancel)

    def list_files(
        self, anchor: FileAnchor, *, cursor: str | None = None, limit: int = 100,
        cancel: Callable[[], bool] | None = None,
    ) -> FilePage:
        _range(0, limit, self.max_page_size)
        _cancelled(cancel)
        after = None
        if cursor is not None:
            try:
                if not isinstance(cursor, str) or len(cursor) > 8192:
                    raise ValueError
                decoded = json.loads(base64.b64decode(cursor, altchars=b"-_", validate=True))
                if (
                    not isinstance(decoded, list) or len(decoded) != 2
                    or decoded[0] != anchor.identity or not isinstance(decoded[1], str)
                    or len(_components(decoded[1])) != 1
                ):
                    raise ValueError
                after = _name_key(decoded[1])
            except (ValueError, TypeError, DomainError, binascii.Error):
                raise DomainError("file_cursor_invalid") from None
        with _resource(self._kernel, anchor) as (_, actual, _):
            if actual.kind != "directory":
                raise DomainError("file_kind_invalid")
            path = Path(actual.canonical_path)

            def candidates(entries):
                for entry in entries:
                    _cancelled(cancel)
                    if (
                        entry.is_file(follow_symlinks=False)
                        and Path(entry.name).suffix.lower() in self.allowed_extensions
                        and (after is None or _name_key(entry.name) > after)
                    ):
                        yield entry.name

            try:
                with os.scandir(_native_path(path)) as entries:
                    names = heapq.nsmallest(limit + 1, candidates(entries), key=_name_key)
            except OSError:
                raise DomainError("file_access_failed") from None
            items = []
            for name in names[:limit]:
                _cancelled(cancel)
                _components(name)
                with ExitStack() as stack:
                    _, child, size = _open_checked(self._kernel, stack, path / name, _READ_ATTRIBUTES)
                    if child.kind != "file":
                        raise DomainError("file_kind_invalid")
                    items.append(FileEntry(name, name, child, size))
            next_cursor = None
            if len(names) > limit:
                next_cursor = base64.urlsafe_b64encode(
                    json.dumps([anchor.identity, names[limit - 1]]).encode(),
                ).decode()
            return FilePage(items, next_cursor)

    def inspect_batch(
        self, anchors: list[FileAnchor], *, cancel: Callable[[], bool] | None = None,
    ) -> list[FileRead]:
        if len(anchors) > self.max_batch_files:
            raise DomainError("file_batch_too_large")
        results = []
        for anchor in anchors:
            _cancelled(cancel)
            results.append(self._read(anchor, "", 0, 0, None, cancel))
        return results

    def capture_export_target(self, path: Path) -> ExportTarget:
        """只用于用户明确选择的保存目标；现有目标 hash 不授予源读取权限。"""
        path = _local_path(path)
        if not path.name:
            raise DomainError("file_path_invalid")
        self._extension(path)
        with ExitStack() as stack:
            _, parent, _ = _open_chain(self._kernel, stack, path.parent, _READ_ATTRIBUTES)
            if parent.kind != "directory":
                raise DomainError("file_kind_invalid")
            try:
                handle, actual, size = _open_checked(self._kernel, stack, path, _GENERIC_READ)
            except DomainError as error:
                if error.code == "file_not_found":
                    return ExportTarget(parent, path.name, None, None)
                raise
            if actual.kind != "file":
                raise DomainError("file_kind_invalid")
            raw = _read_bytes(self._kernel, handle, size, self.max_file_bytes)
            return ExportTarget(parent, path.name, actual.identity, hashlib.sha256(raw).hexdigest())

    def export_payload(
        self, target: ExportTarget, text: str, *, expected_target_hash: str | None = None,
    ) -> bytes:
        if len(_components(target.name)) != 1 or target.parent.kind != "directory":
            raise DomainError("file_path_invalid")
        self._extension(target.name)
        if (target.identity is None) != (target.content_hash is None):
            raise DomainError("file_target_invalid")
        if target.identity is not None and (
            not isinstance(target.content_hash, str) or not _HASH.fullmatch(target.content_hash)
        ):
            raise DomainError("file_target_invalid")
        if target.identity is not None and expected_target_hash != target.content_hash:
            raise DomainError("file_overwrite_confirmation_required")
        if not isinstance(text, str):
            raise DomainError("file_encoding_invalid")
        if len(text) > self.max_file_bytes:
            raise DomainError("file_too_large")
        try:
            payload = text.encode("utf-8")
        except UnicodeEncodeError:
            raise DomainError("file_encoding_invalid") from None
        if len(payload) > self.max_file_bytes:
            raise DomainError("file_too_large")
        return payload

    @contextmanager
    def stage_export(self, target: ExportTarget, payload: bytes, stage_name: str):
        """只向journal持有者暴露句柄；未持久记录的暂存由原句柄清除。"""
        with ExitStack() as stack:
            parent_path = _local_path(target.parent.canonical_path)
            _, parent, _ = _open_chain(self._kernel, stack, parent_path, _READ_ATTRIBUTES)
            _match_anchor(target.parent, parent)
            path = parent_path / target.name
            original = None
            try:
                handle, actual, size = _open_checked(
                    self._kernel, stack, path, _GENERIC_READ | _DELETE,
                )
            except DomainError as error:
                if error.code != "file_not_found":
                    raise
                if target.identity is not None:
                    raise DomainError("file_target_changed") from None
            else:
                if target.identity is None:
                    raise DomainError("file_target_exists")
                if actual.kind != "file" or actual.identity != target.identity:
                    raise DomainError("file_target_changed")
                raw = _read_bytes(self._kernel, handle, size, self.max_file_bytes)
                if hashlib.sha256(raw).hexdigest() != target.content_hash:
                    raise DomainError("file_target_changed")
                original = handle
            stage_path = parent_path / stage_name
            if original is not None:
                with _descriptor(self._kernel, original) as security:
                    stage = _create_stage(self._kernel, stack, stage_path, security)
            else:
                stage = _create_stage(self._kernel, stack, stage_path)
            staged = _StagedExport(self._kernel, original, stage, "", hashlib.sha256(payload).hexdigest())
            try:
                actual, _ = _metadata(self._kernel, stage, stage_path)
                staged.stage_identity = actual.identity
                _write_payload(self._kernel, stage, payload)
                _flush(self._kernel, stage)
                raw = _read_bytes(self._kernel, stage, len(payload), self.max_file_bytes)
                if hashlib.sha256(raw).hexdigest() != staged.content_hash:
                    raise DomainError("file_stage_changed")
                yield staged
            finally:
                if not staged.retained:
                    _delete_handle(self._kernel, stage)

    @contextmanager
    def publication_handles(self, target: ExportTarget, stage_name: str, backup_name: str | None,
                            *, mutable=False):
        """恢复期间同样锁住祖先、按句柄读hash；不存在与不可访问严格区分。"""
        with ExitStack() as stack:
            path = _local_path(target.parent.canonical_path)
            _, parent, _ = _open_chain(self._kernel, stack, path, _READ_ATTRIBUTES)
            _match_anchor(target.parent, parent)
            results = {}
            for key, name in (("target", target.name), ("stage", stage_name), ("backup", backup_name)):
                results[key] = None
                if name is None:
                    continue
                try:
                    handle, anchor, size = _open_checked(
                        self._kernel, stack, path / name, _GENERIC_READ | (_DELETE if mutable else 0),
                    )
                except DomainError as error:
                    if error.code != "file_not_found":
                        raise
                    continue
                if anchor.kind != "file":
                    raise DomainError("file_kind_invalid")
                raw = _read_bytes(self._kernel, handle, size, self.max_file_bytes)
                results[key] = handle, anchor.identity, hashlib.sha256(raw).hexdigest()
            yield results
