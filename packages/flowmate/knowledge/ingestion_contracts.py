"""接纳命令与持久队列；运行身份不由模型参数提供。"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from flowmate.contracts.base import Contract, Id, Version
from flowmate.contracts.execution import RunLimits, TaskHandle
from flowmate.knowledge.contracts import EmbeddingProfileRef


class KnowledgeImportRequest(Contract):
    resource_ids: list[Id] = Field(default_factory=list, max_length=200)
    source_id: Id | None = None
    limits: RunLimits = Field(default_factory=RunLimits)

    @model_validator(mode="after")
    def selection_matches_action(self):
        if not self.resource_ids and self.source_id is None:
            raise ValueError("加入资料须选择文件")
        if self.source_id is not None and len(self.resource_ids) > 1:
            raise ValueError("更新一个来源最多选择一个替换文件")
        if len(self.resource_ids) != len(set(self.resource_ids)):
            raise ValueError("同一批资料不能重复选择")
        return self


class KnowledgeJob(Contract):
    id: Id
    revision: Version = 1
    command_id: Id
    workspace_id: Id
    kind: Literal["import", "rebuild"] = "import"
    source_id: Id | None = None
    source_version: Version | None = None
    target_profile: EmbeddingProfileRef | None = Field(default=None, exclude_if=lambda value: value is None)
    target_generation: Id | None = Field(default=None, exclude_if=lambda value: value is None)
    admission_generations: dict[Id, Version]
    limits: RunLimits
    status: Literal["queued", "running", "completed", "failed", "cancelled"] = "queued"
    task: TaskHandle | None = None
    reason: str | None = None
    created_at: AwareDatetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def import_requires_source_version(self):
        if self.kind == "import" and (self.source_id is None or self.source_version is None):
            raise ValueError("导入任务须绑定确切来源版本")
        if self.kind == "rebuild" and self.target_generation is None:
            raise ValueError("重建任务须绑定新的索引代次")
        return self


class RejectedKnowledgeFile(Contract):
    resource_id: Id
    reason: str


class KnowledgeImportReceipt(Contract):
    command_id: Id
    jobs: list[KnowledgeJob]
    rejected: list[RejectedKnowledgeFile]


class KnowledgeSourceAction(Contract):
    action: Literal["remove", "revoke", "delete"]


class KnowledgeCancel(Contract):
    pass
