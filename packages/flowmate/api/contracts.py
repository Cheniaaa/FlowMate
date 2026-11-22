"""显式公共wire根；内部控制通道、私有候选和执行意图不导出。"""

from typing import Annotated, Generic, Literal, TypeVar

from pydantic import AwareDatetime, Field, JsonValue

from flowmate.contracts.base import CommandMeta, Contract, Count, Id, Name, Units, Version
from flowmate.contracts.events import AgentSaved
from flowmate.contracts.execution import (
    AdmissionFence,
    ArtifactRef,
    BudgetSnapshot,
    DeliveryState,
    FileContentVersion,
    FollowUpIntent,
    JoinFact,
    ModelMessage,
    ModelSelection,
    PendingUserCommand,
    Question,
    ResultConsumption,
    RunLimits,
    RunSnapshot,
    ScopeDependency,
    SessionInboxEntry,
    SourceSelection,
    TaskHandle,
    TaskSnapshot,
    TaskState,
    Usage,
    WaitRecord,
)
from flowmate.contracts.pricing import Price
from flowmate.contracts.settings import (
    AgentProfile,
    ModelConnection,
    ModelProfile,
    ReasoningEffort,
    Session,
    TitleModelBinding,
    TitlePolicy,
    Workspace,
)
from flowmate.contracts.workspaces import WorkspaceDirectoryResult as WorkspaceDirectoryResult
from flowmate.integrations.configuration_contracts import McpNotice
from flowmate.memory.contracts import MemoryChange
from flowmate.memory.maintenance_contracts import MemoryMaintenanceNotice
from flowmate.policy.contracts import (
    Approval,
    DataUseGrant,
    DeletionReceipt,
    ResourceRef,
    ScopeState,
)
from flowmate.processes.contracts import EnvironmentChanged
from flowmate.skills.contracts import SkillNotice
from flowmate.skills.execution.contracts import ScriptExecutionSummary

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
    api_version: Literal[3] = 3
    runtime_version: str
    schema_version: Literal[3] = 3


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
    title: Name | None = None


class Rename(Contract):
    name: Name


class SaveTitlePolicy(Contract):
    binding: TitleModelBinding | None


class StartRequest(Contract):
    agent_profile_id: Id
    model_profile_id: Id
    reasoning_effort: ReasoningEffort | None = None
    model_selection: ModelSelection | None = None
    text: str = Field(min_length=1)
    sources: SourceSelection = Field(default_factory=SourceSelection)
    inherit_session_files: bool = Field(default=True, exclude_if=lambda value: value)
    session_file_adoptions: dict[Id, FileContentVersion] = Field(default_factory=dict, max_length=200,
        exclude_if=lambda value: not value)
    limits: RunLimits = Field(default_factory=RunLimits)
    allow_managed: bool = False
    allow_follow_up: bool = False
    source_result: Id | None = None


class Steering(Contract):
    text: str = Field(min_length=1)

class VisionContinue(Contract):
    model_profile_id: Id
    model_profile_version: Version
    connection_version: Version
    endpoint: str


class Answer(Contract):
    answer: JsonValue


class ApprovalDecision(Contract):
    allow: bool


class ArchiveSession(Contract):
    archived: bool


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
    script_execution: ScriptExecutionSummary | None = None


class MemberLane(Contract):
    task: TaskSnapshot
    profile: AgentProfile
    activities: list[ActivityView]
    handoffs: list[TaskHandle]


class MessageAttachment(Contract):
    resource_id: Id
    name: str
    resource_lineage: list[Id]
    read_grant_ids: list[Id]


class MessageView(ModelMessage):
    run_id: Id
    event_id: Units
    event_index: Count
    source_valid: bool | None = Field(default=None, exclude_if=lambda value: value is None)
    attachments: list[MessageAttachment] = Field(default_factory=list, exclude_if=lambda value: not value)
    tool_operation: str | None = Field(default=None, exclude_if=lambda value: value is None)


class ChatModelUse(Contract):
    event_id: Units
    session_id: Id
    model_profile_id: Id
    reasoning_effort: ReasoningEffort | None


class SessionRunPage(Page[RunSnapshot]):
    last_model_use: ChatModelUse | None = Field(default=None, exclude_if=lambda value: value is None)


class PublicChange(Contract):
    runs: list[RunSnapshot] = Field(default_factory=list)
    tasks: list[TaskSnapshot] = Field(default_factory=list)
    activities: list[ActivityView] = Field(default_factory=list)
    budgets: list[BudgetSnapshot] = Field(default_factory=list)
    messages: list[MessageView] = Field(default_factory=list)
    message_watermark: Units | None = Field(default=None, exclude_if=lambda value: value is None)
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    questions: list[Question] = Field(default_factory=list)
    waits: list[WaitRecord] = Field(default_factory=list)
    consumptions: list[ResultConsumption] = Field(default_factory=list)
    joins: list[JoinFact] = Field(default_factory=list)
    pending_commands: list[PendingUserCommand] = Field(default_factory=list)
    follow_up_intents: list[FollowUpIntent] = Field(default_factory=list)
    chat_model_use: ChatModelUse | None = Field(default=None, exclude_if=lambda value: value is None)


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
    kind: Literal["workspace.created", "workspace.default_created", "workspace.directory_changed", "workspace.renamed"]
    payload: Workspace


class SessionEvent(EventBase):
    kind: Literal["session.created","session.updated"]
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
        "budget.allocated", "budget.counted", "budget.returned",
        "runtime.recovered", "artifact.published", "question.asked", "question.answered",
        "task.submitted", "task.cancelled", "task.consumed", "task.joined", "wait.registered", "wait.resolved",
        "follow_up.changed", "command.queued", "command.applied", "command.cancelled", "run.yielded",
        "naming.task_changed"]
    payload: PublicChange


class PolicyEvent(EventBase):
    kind: Literal["resource.registered", "resource.updated", "grant.created", "grant.revoked",
                  "approval.proposed", "approval.decided"]
    payload: PublicPolicyChange


class LifecycleEvent(EventBase):
    kind: Literal["scope.deleted", "scope.revoked", "accounting.settled"]
    payload: PublicLifecycleChange


class DeliveryChange(Contract):
    deliveries: list[SessionInboxEntry]


class DeliveryEvent(EventBase):
    kind: Literal["delivery.changed"]
    payload: DeliveryChange


class AdmissionChange(Contract):
    admission_fences: list[AdmissionFence]


class AdmissionEvent(EventBase):
    kind: Literal["admission.stopped"]
    payload: AdmissionChange


class MemoryEvent(EventBase):
    kind: Literal["memory.changed", "memory.policy_changed"]
    payload: MemoryChange


class MemoryMaintenanceEvent(EventBase):
    kind: Literal["memory.maintenance_changed"]
    payload: MemoryMaintenanceNotice


class SkillEvent(EventBase):
    kind: Literal["skill.changed"]
    payload: SkillNotice


class EnvironmentEvent(EventBase):
    kind: Literal["environment.changed"]
    payload: EnvironmentChanged


class McpEvent(EventBase):
    kind: Literal["mcp.changed"]
    payload: McpNotice


class TitlePolicyEvent(EventBase):
    kind: Literal["naming.policy_saved"]
    payload: TitlePolicy


PublicEvent = Annotated[WorkspaceEvent | SessionEvent | AgentEvent | ModelProfileEvent | ModelConnectionEvent | ExecutionEvent | PolicyEvent | LifecycleEvent | DeliveryEvent | AdmissionEvent | MemoryEvent | MemoryMaintenanceEvent | SkillEvent | EnvironmentEvent | McpEvent | TitlePolicyEvent,
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
    recent_model_uses: list[ChatModelUse] = Field(default_factory=list, max_length=10, exclude_if=lambda value: not value)


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
    activity_id: Id | None
    state: Literal["prepared", "dispatched", "succeeded", "failed", "uncertain"] | None
    omitted_group_count: Count
    omitted_message_count: Count
    reason_counts: dict[Literal["outside_run_scope", "source_invalid", "replay_incompatible", "capacity"], Count]
    compaction_state: Literal["none", "running", "committed", "blocked", "invalidated"] = "none"
    summary_count: Count = 0
    compacted_message_count: Count = 0
    compaction_reason: str | None = None


class ContextFile(Contract):
    name: str
    origin: Literal["attached", "inherited"] | None = None
    changed: bool = False
    size_bytes: Count | None = None
    line_count: Count | None = None
    start: Count | None = None
    end: Count | None = None
    total_chars: Count | None = None


class ContextActivity(Contract):
    id: Id
    kind: Literal["model", "inspect", "read"]
    state: Literal["prepared", "dispatched", "succeeded", "failed", "uncertain"]
    model: str | None = None
    compaction: bool = False
    input_tokens: Count | None = None
    output_tokens: Count | None = None
    cached_input_tokens: Count | None = None
    input_limit: Count | None = None
    calculated_units: Units | None = None
    cost_pending: Literal[True] | None = Field(default=None, exclude_if=lambda value: value is None)
    files: list[ContextFile] = Field(default_factory=list)
    hidden_file_count: Count = 0
    file_changed: bool = False


class ContextRound(Contract):
    run_id: Id
    state: TaskState
    source_attention: bool
    file_changed: Literal[True] | None = Field(default=None, exclude_if=lambda value: value is None)
    replacement_file_ids: list[Id] = Field(default_factory=list, exclude_if=lambda value: not value)


class SessionContextUsage(Contract):
    requests: Count = 0
    input_tokens: Count = 0
    output_tokens: Count = 0
    input_reported_requests: Count = 0
    output_reported_requests: Count = 0
    cached_input_tokens: Count = 0
    cache_reported_requests: Count = 0
    cache_reported_input_tokens: Count = 0
    cached_tokens_with_reported_input: Count = 0
    calculated_units: Units = 0
    unknown_cost_requests: Count = 0
    pending_cost_requests: Count = 0
    units_per_currency: Units


class SessionContext(Contract):
    round: ContextRound | None
    files: list[ContextFile]
    hidden_file_count: Count
    history: ContextUsageSummary | None
    latest_request: ContextActivity | None
    activities: Page[ContextActivity]
    units_per_currency: Units


class RunFeedback(Contract):
    run_id: Id
    version: Version
    workspace_id: Id
    session_id: Id
    root_task_id: Id
    connection_id: Id
    state: TaskState
    reason: str | None
    model_activity: ActivityView | None
    context_usage: ContextUsageSummary | None


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


class InboxOwner(Contract):
    id: Id
    workspace_id: Id
    session_id: Id | None
    run_id: Id
    workspace_name: str | None = Field(default=None, exclude_if=lambda value: value is None)
    session_title: str | None = Field(default=None, exclude_if=lambda value: value is None)
    task_goal: str | None = Field(default=None, exclude_if=lambda value: value is None)


class InboxQuestion(InboxOwner):
    kind: Literal["question"] = "question"
    question: Question


class InboxApproval(InboxOwner):
    kind: Literal["approval"] = "approval"
    approval: Approval


class PendingActionCommand(Contract):
    kind: Literal["view_task","resume","cancel_run","retry_delivery","inspect_export_recovery"]
    target_id: Id
    expected_version: Version | None


class PendingAction(InboxOwner):
    kind: Literal["recovery","blocked","delivery_failed"]
    task_id: Id
    version: Version
    reason: str
    allowed_actions: list[PendingActionCommand]


InboxItem = Annotated[InboxQuestion | InboxApproval | PendingAction, Field(discriminator="kind")]


class TaskCenterItem(Contract):
    run: RunSnapshot
    root: TaskSnapshot
    pending_count: Count
    delivery_state: DeliveryState | None
    origin_task_id: Id | None
    task_goal: str | None = Field(default=None, exclude_if=lambda value: value is None)
    task_title: str | None = Field(default=None, exclude_if=lambda value: value is None)
    session_title: str | None = Field(default=None, exclude_if=lambda value: value is None)
    source_valid: bool = Field(default=True, exclude_if=lambda value: value)


class RunDetail(Contract):
    run: RunSnapshot
    task_goal: str | None = Field(default=None, exclude_if=lambda value: value is None)
    task_title: str | None = Field(default=None, exclude_if=lambda value: value is None)
    task_titles: dict[Id, str] = Field(default_factory=dict, exclude_if=lambda value: not value)
    file_names: dict[Id, str] = Field(default_factory=dict, exclude_if=lambda value: not value)
    source_valid: bool = Field(default=True, exclude_if=lambda value: value)
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
