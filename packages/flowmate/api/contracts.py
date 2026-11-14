"""显式公共wire根；内部控制通道、私有候选和执行意图不导出。"""

from typing import Annotated, Generic, Literal, TypeVar

from pydantic import AwareDatetime, Field, JsonValue

from flowmate.contracts.base import CommandMeta, Contract, Count, Id, Name, Units, Version
from flowmate.contracts.events import AgentSaved
from flowmate.contracts.execution import (
    ArtifactRef,
    BudgetSnapshot,
    JoinFact,
    ModelMessage,
    Question,
    ResultConsumption,
    RunLimits,
    RunSnapshot,
    ScopeDependency,
    TaskSnapshot,
    Usage,
    WaitRecord,
)
from flowmate.contracts.pricing import Price
from flowmate.contracts.settings import ModelConnection, ModelProfile, Session, Workspace
from flowmate.contracts.workspaces import WorkspaceDirectoryResult as WorkspaceDirectoryResult
from flowmate.policy.contracts import (
    Approval,
    DataUseGrant,
    DeletionReceipt,
    ResourceRef,
    ScopeState,
)

T = TypeVar("T")


class Command(Contract, Generic[T]):
    meta: CommandMeta
    data: T


class Page(Contract, Generic[T]):
    items: list[T]
    next_cursor: str | None = None
    watermark: Units


class PageCursor(Contract):
    version: Literal[1] = 1
    collection: str
    filter_key: str
    upper: list[str | int] = Field(min_length=1, max_length=2)
    after: list[str | int] = Field(min_length=1, max_length=2)


class CommandStatus(Contract):
    status: Literal["confirmed", "not_found"]
    result: JsonValue | None


class Health(Contract):
    api_version: Literal[2] = 2
    runtime_version: str
    schema_version: Literal[2] = 2


class ErrorBody(Contract):
    code: str
    safe_message: str
    retryable: bool = False
    related_ids: list[Id] = Field(default_factory=list)


class ErrorEnvelope(Contract):
    error: ErrorBody


class CreateWorkspace(Contract):
    name: Name


class SetWorkspaceDirectory(Contract):
    resource_id: Id | None


class CreateSession(Contract):
    title: Name


class StartRequest(Contract):
    agent_profile_id: Id
    model_profile_id: Id
    text: str = Field(min_length=1)
    resource_ids: list[Id] = Field(default_factory=list)
    limits: RunLimits = Field(default_factory=RunLimits)


class Steering(Contract):
    text: str = Field(min_length=1)


class Answer(Contract):
    answer: JsonValue


class ApprovalDecision(Contract):
    allow: bool


class ExportRequest(Contract):
    target_ref: Id
    expected_target_hash: str | None = None


class ActivityView(Contract):
    id: Id
    version: Version
    run_id: Id
    task_id: Id
    kind: Literal["model", "tool"]
    operation: str
    state: Literal["prepared", "dispatched", "succeeded", "failed", "uncertain"]
    error: str | None = None
    usage: Usage | None = None
    actual_units: Units | None = None
    dependencies: list[ScopeDependency] = Field(default_factory=list)


class MessageView(ModelMessage):
    event_id: Units
    event_index: Count


class PublicChange(Contract):
    runs: list[RunSnapshot] = Field(default_factory=list)
    tasks: list[TaskSnapshot] = Field(default_factory=list)
    activities: list[ActivityView] = Field(default_factory=list)
    budgets: list[BudgetSnapshot] = Field(default_factory=list)
    messages: list[MessageView] = Field(default_factory=list)
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    questions: list[Question] = Field(default_factory=list)
    waits: list[WaitRecord] = Field(default_factory=list)
    consumptions: list[ResultConsumption] = Field(default_factory=list)
    joins: list[JoinFact] = Field(default_factory=list)


class PublicPolicyChange(Contract):
    resources: list[ResourceRef] = Field(default_factory=list)
    grants: list[DataUseGrant] = Field(default_factory=list)
    approvals: list[Approval] = Field(default_factory=list)


class PublicLifecycleChange(Contract):
    scopes: list[ScopeState] = Field(default_factory=list)
    deletions: list[DeletionReceipt] = Field(default_factory=list)


class EventBase(Contract):
    event_id: Units
    seq: Count | None
    event_version: Literal[1] = 1
    workspace_id: Id | None
    session_id: Id | None
    run_id: Id | None
    task_id: Id | None
    activity_id: Id | None
    causation_id: Id | None
    created_at: AwareDatetime


class WorkspaceEvent(EventBase):
    kind: Literal["workspace.created", "workspace.default_created", "workspace.directory_changed"]
    payload: Workspace


class SessionEvent(EventBase):
    kind: Literal["session.created"]
    payload: Session


class AgentEvent(EventBase):
    kind: Literal["agent.saved"]
    payload: AgentSaved


class ModelProfileEvent(EventBase):
    kind: Literal["model.saved"]
    payload: ModelProfile


class ModelConnectionEvent(EventBase):
    kind: Literal["connection.saved"]
    payload: ModelConnection


class ExecutionEvent(EventBase):
    kind: Literal["run.started", "run.cancelled", "run.resumed", "run.steered", "task.stepped",
        "activity.prepared", "activity.dispatched", "activity.received", "budget.reserved", "budget.settled",
        "runtime.recovered", "artifact.published", "question.asked", "question.answered",
        "task.submitted", "task.cancelled", "task.consumed", "task.joined", "wait.registered", "wait.resolved"]
    payload: PublicChange


class PolicyEvent(EventBase):
    kind: Literal["resource.registered", "resource.updated", "grant.created", "grant.revoked",
                  "approval.proposed", "approval.decided"]
    payload: PublicPolicyChange


class LifecycleEvent(EventBase):
    kind: Literal["scope.deleted", "scope.revoked", "accounting.settled"]
    payload: PublicLifecycleChange


PublicEvent = Annotated[WorkspaceEvent | SessionEvent | AgentEvent | ModelProfileEvent | ModelConnectionEvent | ExecutionEvent | PolicyEvent | LifecycleEvent,
                        Field(discriminator="kind")]


class DurableEvent(Contract):
    kind: Literal["durable"] = "durable"
    event_id: Units
    event: PublicEvent


class DeltaEvent(Contract):
    kind: Literal["delta", "reasoning_delta"] = "delta"
    activity_id: Id
    index: Count
    text: str


StreamEvent = Annotated[DurableEvent | DeltaEvent, Field(discriminator="kind")]


class WorkspaceSnapshot(Contract):
    workspace: Workspace
    sessions: Page[Session]
    active_runs: Page[RunSnapshot]
    pending_approvals: Page[Approval]
    pending_questions: Page[Question]
    resources: Page[ResourceRef]
    grants: Page[DataUseGrant]
    watermark: Units


class PricingBasis(Contract):
    source: str | None
    snapshot_id: str | None
    catalog_version: str | None
    effective_multiplier: Price | None
    assumptions: list[str]
    unknown_reason: str | None


class RunCostSummary(Contract):
    calculated_units: Units
    reserved_units: Units
    unknown_request_count: Count
    pending_request_count: Count
    currency: Literal["USD"] = "USD"
    units_per_currency: Units
    pricing_basis: PricingBasis


class ContextUsageSummary(Contract):
    activity_id: Id
    state: Literal["prepared", "dispatched", "succeeded", "failed", "uncertain"]
    omitted_group_count: Count
    omitted_message_count: Count
    reason_counts: dict[Literal["outside_run_scope", "source_invalid", "replay_incompatible", "capacity"], Count]


class WorkspaceNavigation(Contract):
    workspace: Workspace
    sessions: Page[Session]
    pending_count: Count


class NavigationView(Contract):
    default_workspace_id: Id | None
    workspaces: Page[WorkspaceNavigation]
    recent_sessions: Page[Session]
    pending_count: Count
    watermark: Units


class InboxQuestion(Contract):
    id: Id
    kind: Literal["question"] = "question"
    workspace_id: Id
    session_id: Id
    run_id: Id
    question: Question


class InboxApproval(Contract):
    id: Id
    kind: Literal["approval"] = "approval"
    workspace_id: Id
    session_id: Id
    run_id: Id
    approval: Approval


InboxItem = Annotated[InboxQuestion | InboxApproval, Field(discriminator="kind")]


class RunDetail(Contract):
    run: RunSnapshot
    tasks: Page[TaskSnapshot]
    activities: Page[ActivityView]
    messages: Page[MessageView]
    artifacts: Page[ArtifactRef]
    questions: Page[Question]
    approvals: Page[Approval]
    waits: Page[WaitRecord]
    consumptions: Page[ResultConsumption]
    joins: Page[JoinFact]
    budget: BudgetSnapshot
    cost_summary: RunCostSummary
    context_usage: ContextUsageSummary | None
    watermark: Units


class TraceItem(Contract):
    event_id: Units
    seq: Count | None
    kind: str
    task_id: Id | None
    activity_id: Id | None
    activities: list[ActivityView] = Field(default_factory=list)
