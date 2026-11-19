"""Skill 管理事实；包正文、宿主路径及执行许可不进入目录。"""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from flowmate.contracts.base import Contract, Count, Id, Version, identifier
from flowmate.contracts.execution import ScopeDependency
from flowmate.contracts.scopes import ScopeRef

ContentHash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class SkillSource(Contract):
    kind: Literal["external", "user_created", "user_edited", "generated"]
    command_id: Id
    base_hash: ContentHash | None = None
    resource_id: Id | None = None
    resource_version: Version | None = None
    source_version: str | None = None
    run_id: Id | None = None
    task_id: Id | None = None
    activity_id: Id | None = None
    attempt_id: Id | None = None


class SkillFile(Contract):
    path: str
    size_bytes: Count
    content_hash: ContentHash


class SkillVersion(Contract):
    skill_id: Id
    content_hash: ContentHash
    directory_name: str
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=1024)
    metadata: dict[str, str] = Field(default_factory=dict)
    license: str | None = None
    compatibility: str | None = None
    allowed_tools: str | None = None
    files: list[SkillFile]
    source: SkillSource
    scope: ScopeRef
    dependencies: list[ScopeDependency]


class SkillCandidate(SkillVersion):
    id: Id = Field(default_factory=identifier)
    staging_ref: Id = Field(default_factory=identifier)
    base_hash: ContentHash | None = None


class SkillRecord(Contract):
    skill_id: Id
    current_hash: ContentHash
    scope: ScopeRef
    revision: Version = 1
    status: Literal["active", "deleted"] = "active"


class SkillBinding(Contract):
    id: Id = Field(default_factory=identifier)
    skill_id: Id
    scope: ScopeRef
    enabled: bool = True
    environment_id: Id | None = None
    environment_revision: Version | None = None
    revision: Version = 1

    @model_validator(mode="after")
    def paired_environment(self):
        if (self.environment_id is None) != (self.environment_revision is None):
            raise ValueError("环境身份与固定修订须同时提供")
        if self.scope.kind == "session":
            raise ValueError("Skill 只支持个人或项目绑定")
        return self


class SkillSummary(Contract):
    skill_id: Id
    content_hash: ContentHash
    name: str
    description: str


class SkillResolution(Contract):
    versions: dict[Id, ContentHash]
    dependencies: list[ScopeDependency]
    entries: list[SkillSummary]


class SkillView(Contract):
    version: SkillVersion
    binding: SkillBinding | None
    readiness: Literal["content_available", "source_unavailable"]


class SkillFileSlice(Contract):
    skill_id: Id
    content_hash: ContentHash
    path: str
    file_hash: ContentHash
    encoding: Literal["utf-8", "base64"]
    content: str
    start: Count
    end: Count
    total: Count


class SkillNotice(Contract):
    skill_id: Id
    scope: ScopeRef
    revision: Version
    status: Literal["active", "deleted"]


class SkillDeletion(SkillNotice):
    status: Literal["deleted"] = "deleted"


class SkillCandidateDeletion(Contract):
    skill_id: Id
    staging_ref: Id
    scope: ScopeRef
    discarded: Literal[True] = True
