"""知识能力的公开身份与通知；不依赖运行契约或索引库。"""

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator

from flowmate.contracts.base import CallId, Contract, Count, Id, Name, Version, identifier
from flowmate.contracts.settings import Price

ContentHash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class KnowledgeSource(Contract):
    id: Id
    workspace_id: Id
    revision: Version = 1
    label: Name
    active_version: Version | None = None
    status: Literal["pending", "active", "failed", "removed", "revoked", "deleted"] = "pending"
    cleanup_status: Literal["none", "pending", "failed", "complete"] = "none"
    cleanup_reason: Literal["index_cleanup_failed", "content_cleanup_failed", "storage_checkpoint_pending"] | None = None


class SourceVersion(Contract):
    source_id: Id
    version: Version
    content_hash: ContentHash
    byte_size: Count
    media_type: Literal["text/plain", "text/markdown"]
    created_at: AwareDatetime = Field(default_factory=lambda: datetime.now(UTC))


class TextLocator(Contract):
    start_line: Version
    end_line: Version
    start_char: Count
    end_char: Count
    heading_path: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def ordered_span(self):
        if self.end_line < self.start_line or self.end_char < self.start_char:
            raise ValueError("原文定位范围必须有序")
        return self


class ParsedDocument(Contract):
    text: str
    content_hash: ContentHash
    parser_version: str
    sections: list[TextLocator]


class DocumentChunk(Contract):
    text: str
    locator: TextLocator
    parser_version: str
    chunker_version: str


class EmbeddingProfileRef(Contract):
    id: Id
    revision: Version


class EmbeddingPricing(Contract):
    provider_id: Name | None = None
    model_id: Name | None = None
    multiplier: Price | None = None
    input_per_million: Price | None = None
    currency: Literal["USD"] = "USD"


class EmbeddingProfile(Contract):
    id: Id = Field(default_factory=identifier)
    revision: Version = 1
    display_name: Name
    provider: Literal["openai", "fastembed"]
    model_id: Name
    model_revision: str | None = None
    dimensions: Version
    request_dimensions: bool = False
    query_prefix: str = ""
    document_prefix: str = ""
    connection_id: Id | None = None
    local_resource_id: Id | None = None
    request_timeout_seconds: float = Field(default=60.0, gt=0)
    pricing: EmbeddingPricing = Field(default_factory=EmbeddingPricing)

    @model_validator(mode="after")
    def provider_location(self):
        if self.provider == "openai":
            if self.connection_id is None or self.local_resource_id is not None:
                raise ValueError("云embedding须引用连接且不能指定本地资源")
        elif self.local_resource_id is None or self.connection_id is not None:
            raise ValueError("本地embedding须引用可信目录资源且不能指定云连接")
        return self


class Evidence(Contract):
    id: Id
    source_id: Id
    source_version: Version
    content_hash: ContentHash
    chunk_id: str
    locator: TextLocator
    method: Literal["bm25", "dense", "hybrid", "read"]
    excerpt: str
    index_generation: Id
    parser_version: str
    chunker_version: str
    embedding_profile: EmbeddingProfileRef | None = None


class CitationRef(Contract):
    marker: Version
    evidence_id: Id


class KnowledgeListRequest(Contract):
    limit: int = Field(default=50, ge=1, le=100)


class KnowledgeSearchRequest(Contract):
    query: str = Field(min_length=1, max_length=4000)
    mode: Literal["auto", "bm25", "dense", "hybrid"] = "auto"
    source_ids: list[Id] = Field(default_factory=list, max_length=200)
    limit: int = Field(default=5, ge=1, le=20)


class KnowledgeReadRequest(Contract):
    source_id: Id
    source_version: Version | None = None
    evidence_id: Id | None = None
    offset: Count = 0
    limit: int = Field(default=4000, ge=1, le=20000)


class KnowledgeResult(Contract):
    status: Literal["ok", "partial", "error"] = "ok"
    mode: Literal["bm25", "dense", "hybrid", "none"] = "none"
    sources: list[KnowledgeSource] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    error: str | None = None
    notices: list[str] = Field(default_factory=list)


class KnowledgeSearchBinding(Contract):
    id: Id
    workspace_id: Id
    root_run_id: Id
    run_id: Id
    task_id: Id
    message_id: Id | None
    call_id: CallId
    ordinal: Version
    request: KnowledgeSearchRequest
    sources: list[SourceVersion]
    index_generation: Id
    embedding_profile: EmbeddingProfileRef | None = None


class EvidencePage(Contract):
    evidence: Evidence
    text: str
    offset: Count
    next_offset: Count | None
    total_chars: Count
    current_version: Version | None


class KnowledgeSettings(Contract):
    workspace_id: Id
    revision: Version = 1
    active_profile: EmbeddingProfileRef | None = None
    desired_profile: EmbeddingProfileRef | None = None
    index_generation: Id
    rebuild_job_id: Id | None = None


class KnowledgeNotice(Contract):
    workspace_id: Id | None
    source_revisions: dict[Id, Version] = Field(default_factory=dict)
    job_revisions: dict[Id, Version] = Field(default_factory=dict)
    settings_revision: Version | None = None
    profile_revisions: dict[Id, Version] = Field(default_factory=dict)

    @model_validator(mode="after")
    def project_changes_require_workspace(self):
        if self.workspace_id is None and (self.source_revisions or self.job_revisions
                                         or self.settings_revision is not None):
            raise ValueError("项目资料通知须绑定工作区")
        return self
