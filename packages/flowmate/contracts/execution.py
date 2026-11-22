"""运行限制；后续运行契约随使用点增加。"""

from typing import Annotated, Literal

from pydantic import AwareDatetime, ConfigDict, Field, JsonValue, model_validator

from flowmate.contracts.base import Contract, Count, Id, Units, Version, identifier
from flowmate.contracts.pricing import PricingSnapshot
from flowmate.contracts.scopes import ScopeRef
from flowmate.contracts.settings import AgentProfile, ReasoningEffort, ResolvedModelProfile
from flowmate.knowledge.contracts import CitationRef


class RunLimits(Contract):
    max_steps: Count = 64
    max_model_requests: Count = 24
    max_tasks: Count = 64
    deadline_seconds: float = Field(default=900.0, gt=0)
    max_cost_units: Units | None = None
    max_total_tokens: Count | None = None
    max_delegation_depth: Count = 4
    max_parallel_agents: Count = 3


TaskState = Literal[
    "queued", "running", "waiting_user", "waiting_approval", "waiting_children",
    "interrupted", "blocked_incompatible", "completed", "failed", "cancelled",
]
RunKind = Literal["user", "managed", "follow_up", "maintenance", "knowledge"]
TERMINAL = frozenset({"completed", "failed", "cancelled"})


class ScopeDependency(Contract):
    scope_id: Id
    epoch: Version


class McpToolSnapshot(Contract):
    server_id: Id
    config_revision: Version
    catalog_hash: str
    original_name: str
    destination: str


class CatalogVersions(Contract):
    tools: dict[str, str] = Field(default_factory=dict)
    plugins: dict[str, str] = Field(default_factory=dict)
    agent_executor_id: str = "builtin.agent"
    mcp_tools: dict[str, McpToolSnapshot] = Field(default_factory=dict)


class ResolvedMember(Contract):
    agent_profile: AgentProfile
    model_profile: ResolvedModelProfile
    model_pricing: PricingSnapshot | None
    pricing_unknown_reason: str | None
    tools: dict[str, str]
    skill_versions: dict[Id, str]

    @model_validator(mode="after")
    def pricing_is_fixed(self):
        if (self.model_pricing is None) == (self.pricing_unknown_reason is None):
            raise ValueError("价格快照与unknown原因必须且只能提供一项")
        return self


class ConfigSnapshot(Contract):
    model_config = ConfigDict(json_schema_extra={"oneOf": [
        {"properties": {"model_pricing": {"type": "object"}, "pricing_unknown_reason": {"type": "null"}}},
        {"properties": {"model_pricing": {"type": "null"}, "pricing_unknown_reason": {"type": "string"}}},
    ]})
    kind: Literal["agent"] = "agent"
    agent_profile: AgentProfile
    model_profile: ResolvedModelProfile
    model_pricing: PricingSnapshot | None
    pricing_unknown_reason: str | None
    catalog: CatalogVersions
    members: dict[Id, ResolvedMember] = Field(default_factory=dict)

    @model_validator(mode="after")
    def pricing_is_fixed(self):
        if (self.model_pricing is None) == (self.pricing_unknown_reason is None):
            raise ValueError("价格快照与unknown原因必须且只能提供一项")
        return self


class DeterministicConfigSnapshot(Contract):
    kind: Literal["deterministic"] = "deterministic"
    catalog: CatalogVersions


ExecutionConfig = Annotated[ConfigSnapshot | DeterministicConfigSnapshot, Field(discriminator="kind")]


class SourceSelection(Contract):
    resource_ids: list[Id] = Field(default_factory=list)
    knowledge_source_ids: list[Id] = Field(default_factory=list, exclude_if=lambda value: not value)
    memory_scopes: list[ScopeRef] = Field(default_factory=list)
    skill_versions: dict[Id, str] = Field(default_factory=dict)
    # null 表示本轮只用指导；许可 ID 固定所选版本和环境。
    skill_execution_permissions: dict[Id, Id | None] = Field(default_factory=dict, exclude_if=lambda value: not value)
    excluded_source_ids: list[Id] = Field(default_factory=list)


FileContentVersion = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class SelectedFileVersion(Contract):
    """宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。"""

    file_identity: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_version: FileContentVersion
    inheritance_grants: list[ScopeDependency] | None = Field(default=None, exclude_if=lambda value: value is None)


class TaskExecutionBinding(Contract):
    execution_session_id: Id
    interaction_session_id: Id | None
    config: ExecutionConfig
    sources: SourceSelection
    file_inputs: dict[Id, SelectedFileVersion] = Field(default_factory=dict)
    delegation_depth: Count
    agent_work: "AgentWork | None" = None
    input_artifacts: list["ArtifactRef"] = Field(default_factory=list)
    input_result: "ResultInput | None" = None
    additional_result_inputs: list["ResultInput"] = Field(default_factory=list)


class ModelSelection(Contract):
    model_version: Version
    connection_id: Id
    connection_version: Version


class StartRun(Contract):
    session_id: Id
    agent_profile_id: Id
    model_profile_id: Id
    text: str = Field(min_length=1)
    sources: SourceSelection = Field(default_factory=SourceSelection)
    inherit_session_files: bool = Field(default=True, exclude_if=lambda value: value)
    session_file_adoptions: dict[Id, FileContentVersion] = Field(default_factory=dict, max_length=200,
        exclude_if=lambda value: not value)
    limits: RunLimits = Field(default_factory=RunLimits)
    allow_managed: bool = False
    allow_follow_up: bool = False
    source_result: Id | None = None
    reasoning_effort: ReasoningEffort | None = Field(default=None, exclude_if=lambda value: value is None)
    model_selection: ModelSelection | None = Field(default=None, exclude_if=lambda value: value is None)


class PendingUserCommand(Contract):
    command_id: Id
    session_id: Id
    start: StartRun
    file_inputs: dict[Id, SelectedFileVersion] = Field(default_factory=dict)
    session_file_predecessors: dict[Id, Id] = Field(default_factory=dict, exclude_if=lambda value: not value)
    state: Literal["queued", "applied", "cancelled"] = "queued"
    created_seq: Version
    config: ConfigSnapshot
    scope_dependencies: list[ScopeDependency]
    admission_generations: dict[Id, Version]
    deadline_at: AwareDatetime
    input_result: "ResultInput | None" = None
    run_id: Id | None = None
    reason: str | None = None


class ExecutionContext(Contract):
    workspace_id: Id
    session_id: Id
    interaction_session_id: Id | None
    run_id: Id
    task_id: Id
    activity_id: Id | None = None
    budget_id: Id
    budget_group_id: Id
    scope_dependencies: list[ScopeDependency]


class FailureDisposition(Contract):
    task_id: Id
    result_version: Version
    reason: str = Field(min_length=1)


class RunOutput(Contract):
    summary: str
    artifact_ids: list[Id] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list, description=(
        "尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项"
        "（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。"))
    handled_failures: list[FailureDisposition] = Field(default_factory=list)
    citations: list[CitationRef] = Field(default_factory=list, exclude_if=lambda value: not value)

    @model_validator(mode="after")
    def unique_citation_markers(self):
        if len({item.marker for item in self.citations}) != len(self.citations):
            raise ValueError("同一正文的引用标记不得重复")
        return self


class AgentResult(RunOutput):
    status: Literal["completed", "partial", "failed"]
    structured_result: JsonValue
    evidence_refs: list[Id] = Field(default_factory=list)
    verification: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def status_matches_delivery(self):
        if (self.status == "completed" and self.unresolved) or (self.status == "partial" and not self.unresolved):
            raise ValueError("完整交付不能含未完成项，部分交付须保留未完成项")
        return self


class RunSnapshot(Contract):
    id: Id
    version: Version = 1
    workspace_id: Id
    interaction_session_id: Id | None
    execution_session_id: Id
    root_task_id: Id
    budget_id: Id
    budget_group_id: Id
    kind: RunKind = "user"
    state: TaskState = "queued"
    config: ExecutionConfig
    scope_dependencies: list[ScopeDependency]
    deadline_at: AwareDatetime
    output: AgentResult | RunOutput | None = None
    reason: str | None = None
    sources: SourceSelection
    file_inputs: dict[Id, SelectedFileVersion] = Field(default_factory=dict)
    attached_file_ids: list[Id] | None = Field(default=None, exclude_if=lambda value: value is None)
    allow_managed: bool = False
    allow_follow_up: bool = False
    yield_requested: bool = False
    follow_up_closed: bool = False
    admission_generations: dict[Id, Version] = Field(default_factory=dict)
    vision_source_run_id: Id | None = None

    @model_validator(mode="after")
    def execution_kind_matches_config(self):
        if (self.kind == "knowledge") != (self.config.kind == "deterministic"):
            raise ValueError("知识任务须使用确定性配置，Agent运行须固定生成配置")
        if self.kind == "knowledge" and self.interaction_session_id is not None:
            raise ValueError("项目知识任务不占用交互会话")
        return self


class TaskSnapshot(Contract):
    id: Id
    version: Version = 1
    run_id: Id
    binding: TaskExecutionBinding
    parent_task_id: Id | None = None
    origin_task_id: Id | None = None
    kind: Literal["agent", "tool"]
    executor_id: str
    state: TaskState = "queued"
    created_seq: Count
    result_version: Version | None = None
    reason: str | None = None
    deadline_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def agent_requires_generation_config(self):
        if self.kind == "agent" and self.binding.config.kind != "agent":
            raise ValueError("Agent任务须固定真实生成模型配置")
        return self


class Checkpoint(Contract):
    task_id: Id
    version: Version = 1
    event_seq: Count = 0
    phase: str = "ready"
    message_boundary: Count = 0
    pending_activity_ids: list[Id] = Field(default_factory=list)
    pending_call_ids: list[str] = Field(default_factory=list)
    wait_ids: list[Id] = Field(default_factory=list)
    private_refs: list[Id] = Field(default_factory=list)
    config_versions: dict[str, str] = Field(default_factory=dict)
    tool_call: dict[str, JsonValue] | None = None
    tool_origin: Literal["agent", "user"] = "agent"
    consumed_steering_ids: list[Id] = Field(default_factory=list)
    context_manifest: dict[str, JsonValue] = Field(default_factory=dict)
    output: AgentResult | RunOutput | None = None
    output_dependencies: list[ScopeDependency] = Field(default_factory=list)


class ActivityIntent(Contract):
    kind: Literal["model", "tool"]
    origin: Literal["agent", "user", "runtime"] = "agent"
    operation: str
    arguments: dict[str, JsonValue] = Field(default_factory=dict)
    dependencies: list[ScopeDependency] = Field(default_factory=list)


class ActivityRef(Contract):
    id: Id
    task_id: Id
    attempt_id: Id


class Usage(Contract):
    input_tokens: Count | None = None
    output_tokens: Count | None = None
    cached_input_tokens: Count | None = None
    # 旧回执把缺失的读缓存字段也写作 0；只有实际收到该字段才记录此证据。
    cache_read_reported: Literal[True] | None = Field(default=None, exclude_if=lambda value: value is None)
    cache_write_tokens: Count | None = None
    cache_write_1h_tokens: Count | None = None
    source: str | None = None
    status: Literal["unknown", "known"] = "unknown"


class SourceObservation(Contract):
    resource_id: Id
    expected_version: Version
    source_version: str = Field(pattern=r"^[0-9a-f]{64}$")


class ActivityReceipt(Contract):
    activity_id: Id
    attempt_id: Id
    confirmed: bool
    result: JsonValue = None
    error: str | None = None
    usage: Usage = Field(default_factory=Usage)
    actual_units: Units | None = None
    provider_request_id: str | None = None
    source_dependencies: list[ScopeDependency] = Field(default_factory=list)
    source_observations: list[SourceObservation] = Field(default_factory=list)


class McpResultSource(Contract):
    binding: McpToolSnapshot
    model_destination: str


class ActivitySnapshot(Contract):
    id: Id
    version: Version = 1
    run_id: Id
    task_id: Id
    attempt_id: Id
    state: Literal["prepared", "dispatched", "succeeded", "failed", "uncertain"] = "prepared"
    intent: ActivityIntent
    request_digest: str | None = None
    reserved_units: Units = 0
    reserved_tokens: Count = 0
    receipt: ActivityReceipt | None = None
    result_digest: str | None = None
    content_committed: bool = False
    embedding_query_abandoned: bool = Field(default=False, exclude_if=lambda value: not value)
    pricing_snapshot: dict[str, JsonValue] | None = None
    lease_generation: Version | None = None
    mcp_source: McpResultSource | None = None


class ReservationEstimate(Contract):
    estimated_units: Units | None
    input_estimate: Count = 0
    max_output_tokens: Count = 0
    input_estimate_source: Literal["utf8_wire_budget", "local_image_reserve"] = "utf8_wire_budget"


class DispatchRequest(Contract):
    activity_id: Id
    attempt_id: Id
    request_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    estimate: ReservationEstimate
    source_dependencies: list[ScopeDependency] = Field(default_factory=list)
    pricing_snapshot: dict[str, JsonValue] | None = None
    mcp_source: McpResultSource | None = None


class DispatchPermit(Contract):
    activity_id: Id
    attempt_id: Id
    request_digest: str
    scope_epochs: list[ScopeDependency]
    reservation_id: Id


class BudgetSnapshot(Contract):
    id: Id
    version: Version = 1
    run_id: Id
    limits: RunLimits
    spent_units: Units = 0
    reserved_units: Units = 0
    model_requests: Count = 0
    steps: Count = 0
    task_count: Count = 1
    total_tokens: Count = 0
    reserved_tokens: Count = 0


class BudgetGroupSnapshot(Contract):
    id: Id
    version: Version = 1
    limits: RunLimits
    spent_units: Units = 0
    reserved_units: Units = 0
    steps: Count = 0
    model_requests: Count = 0
    task_count: Count = 1
    total_tokens: Count = 0
    reserved_tokens: Count = 0
    deadline_at: AwareDatetime


class BudgetAllocation(Contract):
    run_id: Id
    group_id: Id
    version: Version = 1
    limits: RunLimits
    returned: bool = False


class AccountingBudget(Contract):
    id: Id
    version: Version = 1
    run_id: Id
    spent_units: Units
    reserved_units: Units
    model_requests: Count
    budget_group_id: Id
    total_tokens: Count = 0
    reserved_tokens: Count = 0


class AccountingActivity(Contract):
    id: Id
    version: Version = 1
    run_id: Id
    budget_id: Id
    attempt_id: Id
    kind: Literal["model", "tool"]
    operation: str
    dispatched: bool
    state: Literal["prepared", "dispatched", "succeeded", "failed", "uncertain"]
    reserved_units: Units
    reserved_tokens: Count = 0
    receipt: ActivityReceipt | None = None
    result_digest: str | None = None


class TextPart(Contract):
    kind: Literal["text"] = "text"
    text: str


class ReasoningPart(Contract):
    kind: Literal["reasoning"] = "reasoning"
    text: str


class ToolCallPart(Contract):
    kind: Literal["tool_call"] = "tool_call"
    call_id: str
    name: str
    arguments: dict[str, JsonValue] | str


class ToolResultPart(Contract):
    kind: Literal["tool_result"] = "tool_result"
    call_id: str
    origin_message_id: Id | None = None
    result: JsonValue = None
    error: str | None = None


class ToolWork(Contract):
    kind: Literal["tool"] = "tool"
    name: str
    version: str
    arguments: dict[str, JsonValue]


class AgentWork(Contract):
    kind: Literal["agent"] = "agent"
    profile_id: Id
    goal: str = Field(min_length=1)
    input_refs: list[Id] = Field(default_factory=list)
    output_schema: dict[str, JsonValue]
    success_criteria: list[str]


class SubmitTask(Contract):
    work: Annotated[ToolWork | AgentWork, Field(discriminator="kind")]
    wait_mode: Literal["wait", "background"] = "background"
    lifetime: Literal["run_bound", "managed"] = "run_bound"
    limits: RunLimits = Field(default_factory=RunLimits)
    sources: SourceSelection = Field(default_factory=SourceSelection)
    allowed_tools: list[str] = Field(default_factory=list)
    completion_policy: Literal["notify_only", "follow_up", "notify_each"] = "notify_only"


class TaskHandle(Contract):
    run_id: Id
    task_id: Id
    lifetime: Literal["run_bound", "managed"] = "run_bound"
    submitted_state: TaskState = "queued"


class TaskSubmission(Contract):
    handle: TaskHandle
    command_id: Id
    origin_task_id: Id
    args_hash: str
    origin_run_id: Id
    lifetime: Literal["run_bound", "managed"] = "run_bound"
    completion_policy: Literal["notify_only", "follow_up", "notify_each"] = "notify_only"


class ConsumerRef(Contract):
    run_id: Id
    task_id: Id
    message_boundary: Count


class ResultConsumption(Contract):
    id: Id = Field(default_factory=identifier)
    run_id: Id
    task_id: Id
    execution_session_id: Id
    target_task_id: Id
    result_version: Version
    message_boundary: Count
    inbox_entry_id: Id | None = None


class WaitRecord(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    run_id: Id
    owner_task_id: Id
    target_task_id: Id
    deadline_at: AwareDatetime | None = None
    continuation_id: str
    state: Literal["pending", "ready", "timeout", "cancelled"] = "pending"
    result_version: Version | None = None


class WaitOutcome(Contract):
    kind: Literal["pending", "ready", "timeout", "cancelled"]
    result_ref: TaskHandle | None = None
    result_version: Version | None = None


class JoinDecision(Contract):
    id: Id = Field(default_factory=identifier)
    run_id: Id
    root_task_id: Id
    child_task_id: Id
    child_result_version: Version


class JoinFact(JoinDecision):
    event_id: Units


class ModelMessage(Contract):
    id: Id = Field(default_factory=identifier)
    role: Literal["user", "assistant", "tool"]
    parts: list[TextPart | ReasoningPart | ToolCallPart | ToolResultPart]
    source_dependencies: list[ScopeDependency] = Field(default_factory=list)
    activity_id: Id | None = None
    private_ref: Id | None = None
    origin: Literal["conversation", "steering", "answer", "task_result", "background_report"] = "conversation"
    delivery_ids: list[Id] = Field(default_factory=list, exclude_if=lambda value: not value)


class MessageReceipt(Contract):
    message_id: Id
    run_id: Id
    version: Version


class OutboxItem(Contract):
    id: Id = Field(default_factory=identifier)
    run_id: Id
    task_id: Id
    activity_id: Id | None = None
    operation: Literal["step", "activity"]
    state: Literal["pending", "done", "cancelled"] = "pending"


class StepDecision(Contract):
    kind: Literal["continue", "activity", "activities", "wait_user", "wait_approval", "wait_children",
                   "complete", "fail", "task_control"]
    intent: ActivityIntent | None = None
    intents: list[ActivityIntent] = Field(default_factory=list)
    output: AgentResult | RunOutput | None = None
    reason: str | None = None
    checkpoint: Checkpoint | None = None
    messages: list[ModelMessage] = Field(default_factory=list)
    question: "Question | None" = None
    control_call: ToolCallPart | None = None
    control_origin_message_id: Id | None = None
    control_dependencies: list[ScopeDependency] = Field(default_factory=list)


class Question(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    run_id: Id
    task_id: Id
    call_id: str
    message_id: Id
    question: str
    answer_schema: dict[str, JsonValue]
    status: Literal["pending", "answered", "cancelled"] = "pending"
    answer_message_id: Id | None = None
    dependencies: list[ScopeDependency] = Field(default_factory=list)


ArtifactMediaType = Literal[
    "text/plain", "text/markdown", "application/json", "application/octet-stream", "image/png", "image/jpeg",
]


class ArtifactRef(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    task_id: Id
    activity_id: Id
    dependencies: list[ScopeDependency]
    media_type: ArtifactMediaType


class StagedArtifact(Contract):
    ref: ArtifactRef
    blob_path: str
    media_type: ArtifactMediaType


class TaskResult(Contract):
    handle: TaskHandle
    result_version: Version
    state: TaskState
    result: JsonValue = None
    error: str | None = None
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    dependencies: list[ScopeDependency] = Field(default_factory=list)


DeliveryState = Literal["pending", "delivered", "failed", "invalidated"]


class SessionInboxEntry(Contract):
    id: Id
    version: Version = 1
    source_event_id: Units
    target_session_id: Id
    result: TaskHandle
    result_version: Version
    delivery_state: DeliveryState = "pending"
    viewed_at: AwareDatetime | None = None
    dependencies: list[ScopeDependency]
    attempts: Count = 0
    last_error: str | None = None
    source_valid: bool = True
    consumers: list[ResultConsumption] = Field(default_factory=list)
    task_name: str | None = Field(default=None, exclude_if=lambda value: value is None)
    assistant_name: str | None = Field(default=None, exclude_if=lambda value: value is None)


class ResultInput(Contract):
    inbox_entry_id: Id
    target_session_id: Id
    source_event_id: Units
    handle: TaskHandle
    result_version: Version
    dependencies: list[ScopeDependency]


class FollowUpIntent(Contract):
    id: Id = Field(default_factory=identifier)
    source_result: Id
    target_session_id: Id
    budget_group_id: Id
    policy_version: Version = 1
    status: Literal["ready", "active", "paused", "closed"] = "ready"
    origin_run_id: Id
    run_id: Id | None = None
    paused_task_ids: list[Id] = Field(default_factory=list)
    reason: str | None = None


class DeliveryReservation(Contract):
    task_id: Id
    target_session_id: Id
    released: bool = False


class AdmissionFence(Contract):
    scope: ScopeRef
    generation: Version = 1


class StopAllReceipt(AdmissionFence):
    cancelled_run_ids: list[Id]


class TextSlice(Contract):
    text: str
    start: Count
    end: Count
    total_chars: Count
    source_version: str
    has_structured_content: Literal[True] | None = Field(default=None, exclude_if=lambda value: value is None)


class ExportReceipt(Contract):
    activity_id: Id
    target_ref: Id
    content_hash: str
    state: Literal["applied", "uncertain"]


class ReceiptCommit(Contract):
    messages: list[ModelMessage] = Field(default_factory=list)
    checkpoint: Checkpoint
    next_decision: StepDecision = Field(default_factory=lambda: StepDecision(kind="continue"))
    artifact_refs: list[ArtifactRef] = Field(default_factory=list)
    staged_artifacts: list[StagedArtifact] = Field(default_factory=list)
    source_observations: list[SourceObservation] = Field(default_factory=list)
    private_states: list[dict[str, JsonValue]] = Field(default_factory=list, repr=False)
    context_summary: dict[str, JsonValue] | None = Field(default=None, repr=False)


class RuntimeChange(Contract):
    runs: list[RunSnapshot] = Field(default_factory=list)
    tasks: list[TaskSnapshot] = Field(default_factory=list)
    activities: list[ActivitySnapshot] = Field(default_factory=list)
    budgets: list[BudgetSnapshot] = Field(default_factory=list)
    budget_groups: list[BudgetGroupSnapshot] = Field(default_factory=list)
    budget_allocations: list[BudgetAllocation] = Field(default_factory=list)
    checkpoints: list[Checkpoint] = Field(default_factory=list)
    messages: list[ModelMessage] = Field(default_factory=list)
    outbox: list[OutboxItem] = Field(default_factory=list)
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    questions: list[Question] = Field(default_factory=list)
    submissions: list[TaskSubmission] = Field(default_factory=list)
    waits: list[WaitRecord] = Field(default_factory=list)
    consumptions: list[ResultConsumption] = Field(default_factory=list)
    joins: list[JoinDecision] = Field(default_factory=list)
    delivery_reservations: list[DeliveryReservation] = Field(default_factory=list)
    deliveries: list[SessionInboxEntry] = Field(default_factory=list)
    admission_fences: list[AdmissionFence] = Field(default_factory=list)
    pending_commands: list[PendingUserCommand] = Field(default_factory=list)
    follow_up_intents: list[FollowUpIntent] = Field(default_factory=list)
