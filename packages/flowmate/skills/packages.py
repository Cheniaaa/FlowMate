"""标准 Skill 包的内存格式边界；不读取宿主路径或启动进程。"""

import hashlib
import io
import lzma
import stat
import unicodedata
import zipfile
import zlib
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

import yaml

MAX_FILES = 2000
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
_RESERVED = {"con", "prn", "aux", "nul", "conin$", "conout$"}
_RESERVED |= {f"{prefix}{digit}" for prefix in ("com", "lpt") for digit in "123456789¹²³"}


class SkillPackageError(ValueError):
    """格式层错误；集成服务负责映射到产品 DomainError。"""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class SkillPackage:
    directory_name: str
    frontmatter: Mapping[str, object]
    files: Mapping[str, bytes]
    file_hashes: Mapping[str, str]
    content_hash: str

    @property
    def name(self) -> str:
        return self.frontmatter["name"]

    @property
    def description(self) -> str:
        return self.frontmatter["description"]


class _StringLoader(yaml.SafeLoader):
    # 官方参考使用字符串标量；仅关闭隐式转换，不修改全局 SafeLoader。
    yaml_implicit_resolvers = {}

    def construct_mapping(self, node, deep=False):
        result = super().construct_mapping(node, deep=deep)
        if len(result) != len(node.value):
            raise yaml.constructor.ConstructorError(None, None, "重复 YAML 键", node.start_mark)
        return result


def _path(path: str) -> None:
    if not isinstance(path, str) or not path or "\\" in path:
        raise SkillPackageError("invalid_package_path", "包内路径必须为非空相对 POSIX 路径")
    try:
        path.encode("utf-8")
    except UnicodeError:
        raise SkillPackageError("invalid_package_path", "包内路径不是有效 Unicode") from None
    for part in path.split("/"):
        if (not part or part in {".", ".."} or part.endswith((".", " "))
                or any(ord(char) < 32 or ord(char) == 127 or char in '<>:"|?*' for char in part)
                or part.split(".", 1)[0].casefold() in _RESERVED):
            raise SkillPackageError("invalid_package_path", "包内路径越界或不能安全表示为宿主文件")


def _paths(files, directories=()) -> None:
    seen = set()
    file_keys = {path.casefold() for path in files}
    for path in (*files, *directories):
        _path(path)
        key = path.casefold()
        if key in seen:
            raise SkillPackageError("duplicate_package_path", "包中存在重复或大小写冲突路径")
        seen.add(key)
        parts = key.split("/")
        if any("/".join(parts[:index]) in file_keys for index in range(1, len(parts))):
            raise SkillPackageError("duplicate_package_path", "文件与目录路径冲突")


def _sizes(sizes) -> None:
    sizes = tuple(sizes)
    if (len(sizes) > MAX_FILES or any(size > MAX_FILE_BYTES for size in sizes)
            or sum(sizes) > MAX_TOTAL_BYTES):
        raise SkillPackageError("skill_package_limit", "包超过文件数、单文件或总内容上限")


def _freeze(value):
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, set):
        return frozenset(_freeze(item) for item in value)
    return value


def _metadata(raw: bytes, directory_name: str):
    try:
        lines = raw.decode("utf-8-sig").splitlines(keepends=True)
        if not lines or lines[0].rstrip("\r\n") != "---":
            raise SkillPackageError("invalid_skill_metadata", "SKILL.md 缺少 YAML frontmatter")
        end = next((index for index in range(1, len(lines))
                    if lines[index].rstrip("\r\n") == "---"), None)
        if end is None:
            raise SkillPackageError("invalid_skill_metadata", "SKILL.md frontmatter 未关闭")
        header = "".join(lines[1:end])
        if any(isinstance(token, yaml.tokens.AliasToken) for token in yaml.scan(header)):
            raise SkillPackageError("invalid_skill_metadata", "不支持 YAML 别名")
        data = yaml.load(header, Loader=_StringLoader)
        if not isinstance(data, dict) or any(not isinstance(key, str) for key in data):
            raise SkillPackageError("invalid_skill_metadata", "frontmatter 必须为字符串键映射")
        name = data.get("name")
        if not isinstance(name, str) or not name.strip():
            raise SkillPackageError("invalid_skill_metadata", "name 必须为非空字符串")
        checked_name = unicodedata.normalize("NFKC", name.strip())
        if (not 1 <= len(checked_name) <= 64 or checked_name != checked_name.lower()
                or checked_name.startswith("-") or checked_name.endswith("-")
                or "--" in checked_name
                or not all(char.isalnum() or char == "-" for char in checked_name)
                or unicodedata.normalize("NFKC", directory_name) != checked_name):
            raise SkillPackageError("invalid_skill_metadata", "name 格式或包目录名不匹配")
        description = data.get("description")
        if (not isinstance(description, str) or not description.strip()
                or len(description) > 1024):
            raise SkillPackageError("invalid_skill_metadata", "description 须为 1–1024 字符")
        for field in ("license", "allowed-tools"):
            if field in data and not isinstance(data[field], str):
                raise SkillPackageError("invalid_skill_metadata", "可选标准字段须为字符串")
        if "compatibility" in data:
            value = data["compatibility"]
            if not isinstance(value, str) or not value.strip() or len(value) > 500:
                raise SkillPackageError("invalid_skill_metadata", "compatibility 须为 1–500 字符")
        if "metadata" in data:
            value = data["metadata"]
            if not isinstance(value, dict) or any(
                    not isinstance(key, str) or not isinstance(item, str)
                    for key, item in value.items()):
                raise SkillPackageError("invalid_skill_metadata", "metadata 须为字符串键值映射")
        return _freeze(data)
    except (UnicodeError, yaml.YAMLError, RecursionError):
        raise SkillPackageError("invalid_skill_metadata", "SKILL.md 编码或 YAML 格式无效") from None


def import_directory(directory_name: str, files: Mapping[str, bytes]) -> SkillPackage:
    """接收宿主已安全取得的普通文件映射；路径不含包根目录。"""
    _path(directory_name)
    if "/" in directory_name:
        raise SkillPackageError("invalid_package_path", "包目录名必须为单个路径段")
    snapshot = dict(files)
    _paths(snapshot)
    if any(not isinstance(content, bytes) for content in snapshot.values()):
        raise TypeError("文件映射的值必须为 bytes")
    _sizes(len(content) for content in snapshot.values())
    if "SKILL.md" not in snapshot:
        raise SkillPackageError("invalid_skill_metadata", "包根目录缺少 SKILL.md")
    metadata = _metadata(snapshot["SKILL.md"], directory_name)
    digest = hashlib.sha256(b"flowmate-skill-package-v1\0")
    hashes = {}
    for path, content in sorted(snapshot.items()):
        encoded = path.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
        hashes[path] = hashlib.sha256(content).hexdigest()
    return SkillPackage(directory_name, metadata, MappingProxyType(snapshot),
                        MappingProxyType(hashes), digest.hexdigest())


def import_zip(data: bytes, *, directory_name: str | None = None) -> SkillPackage:
    """接收受控 ZIP 字节；平铺包必须显式提供宿主包目录名。"""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            files, directories = [], []
            for info in archive.infolist():
                raw_path = info.orig_filename
                path = raw_path[:-1] if raw_path.endswith("/") else raw_path
                _path(path)
                kind = stat.S_IFMT(info.external_attr >> 16)
                if (info.external_attr & 0x400
                        or kind not in {0, stat.S_IFREG, stat.S_IFDIR}
                        or kind == stat.S_IFDIR and not info.is_dir()
                        or kind == stat.S_IFREG and info.is_dir()):
                    raise SkillPackageError("unsupported_skill_entry", "不支持链接或特殊文件")
                if info.flag_bits & 1:
                    raise SkillPackageError("invalid_skill_zip", "不支持加密 ZIP")
                if info.is_dir():
                    if info.file_size:
                        raise SkillPackageError("invalid_package_path", "ZIP 目录不能携带内容")
                    directories.append(path)
                else:
                    files.append(info)
            _paths([info.filename for info in files], directories)
            _sizes(info.file_size for info in files)
            paths = [info.filename for info in files]
            if "SKILL.md" in paths:
                if directory_name is None:
                    raise SkillPackageError("invalid_skill_zip", "平铺 ZIP 需要显式包目录名")
                prefix = ""
            else:
                roots = {path.split("/")[0] for path in (*paths, *directories)}
                if len(roots) != 1:
                    raise SkillPackageError("invalid_skill_zip", "ZIP 必须包含单一标准包")
                root = roots.pop()
                if directory_name is not None and (
                        unicodedata.normalize("NFKC", directory_name)
                        != unicodedata.normalize("NFKC", root)):
                    raise SkillPackageError("invalid_skill_metadata", "ZIP 根目录与包目录名不匹配")
                directory_name, prefix = root, f"{root}/"
                if f"{prefix}SKILL.md" not in paths:
                    raise SkillPackageError("invalid_skill_metadata", "ZIP 包根目录缺少 SKILL.md")
            contents, total = {}, 0
            for info in files:
                with archive.open(info) as source:
                    content = source.read(min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total) + 1)
                total += len(content)
                if len(content) > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
                    raise SkillPackageError("skill_package_limit", "ZIP 实际解压量超过上限")
                if len(content) != info.file_size:
                    raise SkillPackageError("invalid_skill_zip", "ZIP 内容长度与声明不符")
                contents[info.filename.removeprefix(prefix)] = content
            return import_directory(directory_name, contents)
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError, OSError,
            UnicodeError, zlib.error, lzma.LZMAError):
        raise SkillPackageError("invalid_skill_zip", "ZIP 损坏或压缩格式不支持") from None


def export_zip(package: SkillPackage) -> bytes:
    """导出单一标准包目录；固定容器属性，不改写任何文件内容。"""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, content in sorted(package.files.items()):
            info = zipfile.ZipInfo(f"{package.directory_name}/{path}", (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED)
    return output.getvalue()
