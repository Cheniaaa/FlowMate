"""按项目和generation隔离的LanceDB派生检索索引。"""

import hashlib
import json
import math
import shutil
import threading
from contextlib import contextmanager
from datetime import timedelta
from functools import wraps
from pathlib import Path
from uuid import UUID

import lancedb
import pyarrow as pa
from lancedb.expr import col, lit
from lancedb.index import FTS, IvfFlat
from lancedb.rerankers import RRFReranker

from flowmate.contracts.base import DomainError, Id, identifier
from flowmate.knowledge.contracts import DocumentChunk, Evidence, SourceVersion, TextLocator

_LOCKS: dict[Path, threading.RLock] = {}


def _serialized(method):
    @wraps(method)
    def call(self, *args, **kwargs):
        # 同项目的每次查询完全物化后才释放；新实例与writer/collector共用锁。
        with self._lock:
            return method(self, *args, **kwargs)
    return call


@contextmanager
def _lance_boundary(operation: str):
    """只归一实际库/I/O边界异常；保留cause供内部诊断。"""
    try:
        yield
    except (ValueError, RuntimeError, OSError, pa.ArrowException) as error:
        raise DomainError(f"knowledge_index_{operation}_failed", "资料检索索引操作失败") from error


class LanceRetriever:
    def __init__(self, root: Path, workspace_id: Id):
        # 路径身份来自可信Runtime契约；UUID规范化避免路径字符进入数据库目录。
        self.workspace_id = str(UUID(workspace_id))
        self.directory = root / self.workspace_id / "lance"
        self._lock = _LOCKS.setdefault(self.directory.resolve(), threading.RLock())
        with self._lock, _lance_boundary("open"):
            self.connection = lancedb.connect(str(self.directory))

    @_serialized
    def write_version(
        self, generation: Id, source: SourceVersion, chunks: list[DocumentChunk], vectors=None,
    ) -> None:
        dimension = self._vector_dimension(vectors, len(chunks))
        rows = []
        for position, chunk in enumerate(chunks):
            identity = [source.source_id, source.version, source.content_hash,
                        chunk.locator.start_char, chunk.locator.end_char,
                        chunk.parser_version, chunk.chunker_version]
            row = {
                "workspace_id": self.workspace_id, "source_id": source.source_id,
                "source_version": source.version, "content_hash": source.content_hash,
                "chunk_id": hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest(),
                "text": chunk.text, "locator": chunk.locator.model_dump(),
                "parser_version": chunk.parser_version, "chunker_version": chunk.chunker_version,
            }
            if vectors is not None:
                row["vector"] = vectors[position]
            rows.append(row)
        with _lance_boundary("write"):
            table = self._open(generation)
            if table is None:
                table = self.connection.create_table(
                    self._table_name(generation), schema=self._schema(dimension))
            elif (dimension is not None and "vector" not in table.schema.names
                    and table.count_rows() == 0):
                # 空正文没有可推断的向量维度；首次实际向量写入才确定空表schema。
                table = self.connection.create_table(
                    self._table_name(generation), schema=self._schema(dimension), mode="overwrite")
            if chunks:
                self._check_dimension(table, dimension)
            data = pa.Table.from_pylist(rows, schema=table.schema)
            # merge的删除条件限于本source/version；一次提交同时替换残留并保证重放幂等。
            (table.merge_insert(["workspace_id", "source_id", "source_version", "chunk_id"])
             .when_matched_update_all().when_not_matched_insert_all()
             .when_not_matched_by_source_delete(self._filter([(source.source_id, source.version)]))
             .execute(data))
            if rows:
                table.create_index("text", config=FTS(
                    base_tokenizer="icu", stem=False, remove_stop_words=False, ascii_folding=False,
                ), replace=True)
                if dimension is not None:
                    table.create_index("vector", config=IvfFlat(), replace=True)

    @_serialized
    def search(
        self, generation: Id, query: str, eligible_versions: list[tuple[Id, int]], *,
        mode: str, vector=None, limit: int,
    ) -> list[Evidence]:
        if mode not in {"bm25", "dense", "hybrid"} or not 1 <= limit <= 100:
            raise DomainError("knowledge_search_invalid", "检索模式或数量无效")
        if not query.strip() or not eligible_versions:
            return []
        with _lance_boundary("search"):
            table = self._open(generation)
            if table is None:
                raise DomainError("knowledge_index_missing", "资料检索索引缺失")
            if table.count_rows() == 0:
                return []
            indices = list(table.list_indices())
            if mode in {"bm25", "hybrid"} and not any(
                    index.columns == ["text"] and index.index_type == "FTS" for index in indices):
                raise DomainError("knowledge_index_missing", "资料全文索引缺失")
            if mode != "bm25":
                if "vector" not in table.schema.names or vector is None:
                    raise DomainError("knowledge_vector_unavailable", "资料向量索引尚未启用")
                dimension = self._vector_dimension([vector], 1)
                self._check_dimension(table, dimension)
                if not any(index.columns == ["vector"] for index in indices):
                    raise DomainError("knowledge_index_missing", "资料向量索引缺失")
            if mode == "bm25":
                builder = table.search(query, query_type="fts", fts_columns="text")
            elif mode == "dense":
                builder = table.search(vector, query_type="vector", vector_column_name="vector")
            else:
                builder = (table.search(query_type="hybrid", vector_column_name="vector",
                                        fts_columns="text")
                           .vector(vector).text(query).rerank(RRFReranker()))
            # 库内hybrid会把where/prefilter传给FTS和vector两支，再由库RRF融合。
            rows = builder.where(self._filter(eligible_versions), prefilter=True).limit(limit).to_list()
        return [Evidence(
            id=identifier(), source_id=row["source_id"], source_version=row["source_version"],
            content_hash=row["content_hash"], chunk_id=row["chunk_id"],
            locator=TextLocator.model_validate(row["locator"]), method=mode, excerpt=row["text"],
            index_generation=generation, parser_version=row["parser_version"],
            chunker_version=row["chunker_version"],
        ) for row in rows]

    @_serialized
    def remove_versions(self, generation: Id, version_keys: list[tuple[Id, int]]) -> None:
        if not version_keys:
            return
        with _lance_boundary("delete"):
            table = self._open(generation)
            if table is None:
                raise DomainError("knowledge_index_missing", "资料检索索引缺失")
            table.delete(self._filter(version_keys))

    @_serialized
    def purge_source(self, source_id: Id) -> None:
        with _lance_boundary("cleanup"):
            for name in self.connection.list_tables():
                table = self.connection.open_table(name)
                table.delete((col("workspace_id") == self.workspace_id) & (col("source_id") == source_id))
                schema = table.schema
                if table.count_rows() == 0:
                    self.connection.drop_table(name)
                    self.connection.create_table(name, schema=schema)
                    continue
                # 将删除位图实际写入新fragment，连少量删除也必须回收原正文。
                table.optimize(cleanup_older_than=timedelta(0), delete_unverified=True,
                    compaction_options={"materialize_deletions": True, "materialize_deletions_threshold": 0.0})
                table.create_index("text", config=FTS(
                    base_tokenizer="icu", stem=False, remove_stop_words=False, ascii_folding=False), replace=True)
                if "vector" in schema.names:
                    table.create_index("vector", config=IvfFlat(), replace=True)
                # 重建后清掉旧FTS/vector文件及其旧manifest。
                table.optimize(cleanup_older_than=timedelta(0), delete_unverified=True)

    @_serialized
    def drop_generation(self, generation: Id) -> None:
        with _lance_boundary("cleanup"):
            name = self._table_name(generation)
            if name in self.connection.list_tables():
                self.connection.drop_table(name)

    @_serialized
    def drop_workspace(self) -> None:
        with _lance_boundary("cleanup"):
            # 仅删除由UUID限定的应用派生目录，不访问用户原路径。
            directory = self.directory.parent
            if directory.exists():
                shutil.rmtree(directory)

    @staticmethod
    def _table_name(generation: Id) -> str:
        return "chunks_" + UUID(generation).hex

    def _open(self, generation: Id):
        name = self._table_name(generation)
        if name not in self.connection.list_tables():
            return None
        # 每次打开当前已提交版本，不持有跨Runtime实例过期的表指针。
        return self.connection.open_table(name)

    def _filter(self, keys: list[tuple[Id, int]]):
        versions = lit(False)
        for source_id, version in keys:
            versions = versions | ((col("source_id") == source_id) & (col("source_version") == version))
        return (col("workspace_id") == self.workspace_id) & versions

    @staticmethod
    def _schema(dimension: int | None) -> pa.Schema:
        fields = [
            ("workspace_id", pa.string()), ("source_id", pa.string()),
            ("source_version", pa.int64()), ("content_hash", pa.string()),
            ("chunk_id", pa.string()), ("text", pa.string()),
            ("locator", pa.struct([
                ("start_line", pa.int64()), ("end_line", pa.int64()),
                ("start_char", pa.int64()), ("end_char", pa.int64()),
                ("heading_path", pa.list_(pa.string())),
            ])),
            ("parser_version", pa.string()), ("chunker_version", pa.string()),
        ]
        if dimension is not None:
            fields.append(("vector", pa.list_(pa.float32(), dimension)))
        return pa.schema(fields)

    @staticmethod
    def _vector_dimension(vectors, count: int) -> int | None:
        if vectors is None:
            return None
        if len(vectors) != count:
            raise DomainError("knowledge_vectors_incomplete", "向量数量与分块数量不一致")
        if not vectors:
            return None
        dimension = len(vectors[0])
        if dimension == 0 or any(
                len(vector) != dimension or not all(math.isfinite(value) for value in vector)
                for vector in vectors):
            raise DomainError("knowledge_vector_invalid", "资料向量维度或数值无效")
        return dimension

    @staticmethod
    def _check_dimension(table, dimension: int | None) -> None:
        expected = table.schema.field("vector").type.list_size if "vector" in table.schema.names else None
        if expected != dimension:
            if expected is None:
                raise DomainError("knowledge_generation_profile_mismatch", "向量配置变更须使用新索引generation")
            if dimension is None:
                raise DomainError("knowledge_vector_unavailable", "本索引generation的分块必须提供向量")
            raise DomainError("knowledge_vector_dimension_mismatch", "向量维度与索引generation不一致")
