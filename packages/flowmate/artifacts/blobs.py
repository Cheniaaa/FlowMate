"""内容寻址字节存储；调用方在SQLite写事务内登记引用并协调回收。"""

import hashlib
import os
from pathlib import Path

from flowmate.contracts.base import DomainError, identifier


class BlobStore:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, content_hash: str) -> Path:
        return self.root / (content_hash + ".blob")

    def read(self, content_hash: str, *, max_bytes: int) -> bytes:
        try:
            with self.path(content_hash).open("rb") as handle:
                data = handle.read(max_bytes + 1)
        except FileNotFoundError:
            raise DomainError("blob_missing", "受控内容缺失") from None
        if len(data) > max_bytes or hashlib.sha256(data).hexdigest() != content_hash:
            raise DomainError("blob_corrupt", "受控内容校验失败")
        return data

    def put(self, data: bytes) -> str:
        content_hash = hashlib.sha256(data).hexdigest()
        target = self.path(content_hash)
        if target.exists():
            self.read(content_hash, max_bytes=len(data))
            return content_hash
        temporary = self.root / (identifier() + ".tmp")
        try:
            with temporary.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        return content_hash
