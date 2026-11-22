"""事实、来源、提案和可替换存储的共同契约。"""

from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from flowmate.contracts.base import Contract, Count, Id, Version, identifier
from flowmate.contracts.execution import RunLimits, ScopeDependency, TextSlice
from flowmate.contracts.scopes import ScopeRef

AuthorKind = Literal["user", "assistant", "tool"]
MemoryKind = Literal["fact", "preference", "instruction", "episode"]
PERSONAL_PROFILE_MEMORY_KINDS: tuple[MemoryKind, ...] = ("preference", "instruction")
DEFAULT_PROJECT_MEMORY_KINDS: tuple[MemoryKind, ...] = ("preference", "instruction")
OTHER_PROJECT_MEMORY_KINDS: tuple[MemoryKind, ...] = ("fact", "episode")
MemoryStatus = Literal["candidate", "confirmed", "rejected", "deleted"]
MemoryAction = Literal["accept", "reject", "revise", "delete", "undo"]


class MemoryEvidence(Contract):
    source_kind: Literal["message", "event", "artifact", "user_edit"]
    source_id: str = Field(min_length=1)
    source_version: str = Field(min_length=1)
    locator: str
    quote_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    author_kind: AuthorKind


class MemoryRecord(Contract):
    id: Id = Field(default_factory=identifier)
    owner_id: Id
    scope: ScopeRef
    revision: Version = 1
    text: str
    kind: MemoryKind
    author_kind: AuthorKind
    status: MemoryStatus
    supersedes: Id | None = None
    expires_at: AwareDatetime | None = None
    evidence: list[MemoryEvidence] = Field(default_factory=list)
    dependencies: list[ScopeDependency] = Field(default_factory=list)
    claim_key: str = Field(pattern=r"^[0-9a-f]{64}$")

    @property
    def project_preference(self):
        return self.scope.kind == "workspace" and self.kind in DEFAULT_PROJECT_MEMORY_KINDS

    @property
    def personal_preference(self):
        return self.scope.kind == "user_global" and self.kind in PERSONAL_PROFILE_MEMORY_KINDS

    @model_validator(mode="after")
    def long_term_scope(self):
        if self.scope.kind == "session":
            raise ValueError("长期事实只支持个人或项目范围")
        if self.status == "deleted" and (self.text or self.evidence or self.dependencies):
            raise ValueError("删除标记不能保留正文或来源")
        if self.status != "deleted" and not self.text.strip():
            raise ValueError("记忆正文不能为空")
        return self


class MemoryProposal(Contract):
    text: str = Field(min_length=1, max_length=16000)
    scope: ScopeRef
    kind: MemoryKind
    author_kind: AuthorKind
    evidence: list[MemoryEvidence] = Field(min_length=1, max_length=32)
    expected_revision: Count | None = None
    record_id: Id | None = None
    policy_version: Version = 1
    expires_at: AwareDatetime | None = None


class MemoryCandidate(Contract):
    id: Id
    scope: ScopeRef
    source_version: str
    policy_version: Version
    normalized_claim: str
    record_id: Id
    base_record_id: Id | None = None
    expected_revision: Count | None = None
    extraction_run_id: Id | None = None
    extraction_task_id: Id | None = None
    proposal_activity_id: Id | None = None
    proposal_message_id: Id | None = None


class MemoryArchive(Contract):
    format_version: Literal[1] = 1
    scope: ScopeRef
    records: list[MemoryRecord]
    revisions: list[MemoryRecord]
    candidates: list[MemoryCandidate]


class MemoryCapabilities(Contract):
    revisions: bool
    scope_query: bool
    archive_roundtrip: bool


class MemoryPolicy(Contract):
    scope: ScopeRef
    version: Version = 1
    read_profile: bool = True
    auto_organize: bool = False
    model_profile_id: Id | None = None
    maintenance_limits: RunLimits = Field(default_factory=RunLimits)


class MemoryGrantCommand(Contract):
    scope: ScopeRef
    destination: str


class CreateMemory(Contract):
    text: str = Field(min_length=1, max_length=16000)
    scope: ScopeRef
    kind: MemoryKind


class MemoryDecision(Contract):
    action: MemoryAction
    text: str | None = Field(default=None, min_length=1, max_length=16000)
    scope: ScopeRef


class MemoryNotice(Contract):
    id: Id
    scope: ScopeRef
    revision: Version
    status: MemoryStatus


class MemoryChange(Contract):
    """事件仅用于失效通知；不复制可删除的事实正文。"""
    records: list[MemoryNotice] = Field(default_factory=list)
    policies: list[MemoryPolicy] = Field(default_factory=list)


class MemoryEvidenceView(Contract):
    evidence: MemoryEvidence
    available: bool
    reason: str | None = None


class MemoryEvidenceExcerpt(Contract):
    record_id: Id
    record_revision: Version
    evidence: MemoryEvidence
    source_label: str
    excerpt: TextSlice | None
    reason: Literal["source_unavailable", "source_not_public"] | None = None


class MemoryProposalReceipt(Contract):
    id: Id
    revision: Version
    status: MemoryStatus


class MemoryRememberReceipt(Contract):
    outcome: Literal["staged", "candidate", "turn_only", "ambiguous", "existing", "budget"]
    id: Id | None = None
    revision: Version | None = None
