"""检索能力契约与默认适配器入口；可选依赖不进入知识业务层。"""

import importlib.util
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from flowmate.contracts.base import DomainError, Id
from flowmate.knowledge.contracts import DocumentChunk, Evidence, SourceVersion


class Retriever(Protocol):
    """一个实例对应一个项目；实现须先按允许版本过滤，再取前limit项。"""

    def write_version(
        self, generation: Id, source: SourceVersion, chunks: list[DocumentChunk],
        vectors: list[list[float]] | None = None,
    ) -> None: ...

    def search(
        self, generation: Id, query: str, eligible_versions: list[tuple[Id, int]], *,
        mode: str, vector: list[float] | None = None, limit: int,
    ) -> list[Evidence]: ...

    def remove_versions(self, generation: Id, version_keys: list[tuple[Id, int]]) -> None: ...

    def purge_source(self, source_id: Id) -> None:
        """清理所有代次的来源正文、索引与旧碎片；调用方须排空项目writer。"""
        ...

    def drop_generation(self, generation: Id) -> None: ...

    def drop_workspace(self) -> None: ...


RetrieverFactory = Callable[[Path, Id], Retriever]


def open_lance_retriever(root: Path, workspace_id: Id) -> Retriever:
    if importlib.util.find_spec("lancedb") is None:
        raise DomainError("knowledge_unavailable", "当前安装未启用LanceDB索引组件")
    from flowmate.knowledge.retrieval import LanceRetriever

    return LanceRetriever(root, workspace_id)
