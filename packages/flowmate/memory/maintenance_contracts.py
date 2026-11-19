"""T7 提交边界、提取批次和无正文维护通知。"""

from typing import Literal

from pydantic import Field, model_validator

from flowmate.contracts.base import Contract, Count, Id, Units, Version
from flowmate.contracts.execution import RunLimits, ScopeDependency, TaskHandle
from flowmate.contracts.scopes import ScopeRef
from flowmate.memory.contracts import MemoryEvidence, MemoryProposal


class MemorySourceBoundary(Contract):
    run_id: Id
    event_id: Units


class MemoryMaintenanceBudgetConfirmation(Contract):
    kind: Literal["new_budget"]
    model_profile_id: Id
    model_version: Version
    connection_version: Version
    limits: RunLimits


class MemoryMaintenanceAuthorization(Contract):
    policy_version: Version
    automatic: bool = False
    budget_confirmation: MemoryMaintenanceBudgetConfirmation | None = None

    @model_validator(mode="after")
    def automatic_budget_is_inherited(self):
        if self.automatic and self.budget_confirmation is not None:
            raise ValueError("自动整理不能提交独立维护预算")
        return self


class MemoryMaintenanceRequest(Contract):
    scope: ScopeRef
    source_boundary: MemorySourceBoundary
    budget_confirmation: MemoryMaintenanceBudgetConfirmation


class ExtractionBatch(Contract):
    source_boundary: MemorySourceBoundary
    evidence: list[MemoryEvidence] = Field(max_length=100)
    candidates: list[MemoryProposal] = Field(max_length=100)
    strategy_version: Version


class MemoryMaintenanceInput(Contract):
    scope: ScopeRef
    source_boundary: MemorySourceBoundary
    authorization: MemoryMaintenanceAuthorization
    strategy_version: Version
    evidence: list[MemoryEvidence]
    dependencies: list[ScopeDependency]
    record_revisions: dict[Id, Version]


class MemoryMaintenanceState(Contract):
    input: MemoryMaintenanceInput
    batch: ExtractionBatch | None = None
    merged: bool = False
    record_ids: list[Id] = Field(default_factory=list)


class MemoryMaintenanceNotice(Contract):
    id: Id
    scope: ScopeRef
    source_boundary: MemorySourceBoundary
    policy_version: Version
    task: TaskHandle | None = None
    reason: str | None = None


class ExtractionReceipt(Contract):
    candidate_count: Count


class MergeReceipt(Contract):
    record_ids: list[Id]


class MergeRequest(Contract):
    pass
