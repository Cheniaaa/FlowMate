"""运行限制；后续运行契约随使用点增加。"""

from typing import Literal

from pydantic import AwareDatetime, ConfigDict, Field, JsonValue, model_validator

from flowmate.contracts.base import Contract, Count, Id, Units, Version, identifier
from flowmate.contracts.pricing import PricingSnapshot
from flowmate.contracts.settings import AgentProfile, ResolvedModelProfile


class RunLimits(Contract):
    max_steps: Count = 64
    max_model_requests: Count = 24
    max_tasks: Count = 64
    deadline_seconds: float = Field(default=900.0, gt=0)
    max_cost_units: Units | None = None


TaskState = Literal[
    "queued", "running", "waiting_user", "waiting_approval", "waiting_children",
    "interrupted", "blocked_incompatible", "completed", "failed", "cancelled",
]
TERMINAL = frozenset({"completed", "failed", "cancelled"})


class ScopeDependency(Contract):
    scope_id: Id
    epoch: Version


class CatalogVersions(Contract):
    tools: dict[str, str] = Field(default_factory=dict)
    plugins: dict[str, str] = Field(default_factory=dict)
    agent_executor_id: str = "builtin.agent"


class ConfigSnapshot(Contract):
    model_config = ConfigDict(json_schema_extra={"oneOf": [
        {"properties": {"model_pricing": {"type": "object"}, "pricing_unknown_reason": {"type": "null"}}},
        {"properties": {"model_pricing": {"type": "null"}, "pricing_unknown_reason": {"type": "string"}}},
    ]})
    agent_profile: AgentProfile
    model_profile: ResolvedModelProfile
    model_pricing: PricingSnapshot | None
    pricing_unknown_reason: str | None
    catalog: CatalogVersions

    @model_validator(mode="after")
    def pricing_is_fixed(self):
        if (self.model_pricing is None) == (self.pricing_unknown_reason is None):
            raise ValueError("价格快照与unknown原因必须且只能提供一项")
        return self


class StartRun(Contract):
    session_id: Id
    agent_profile_id: Id
    model_profile_id: Id
    text: str = Field(min_length=1)
    resource_ids: list[Id] = Field(default_factory=list)
    limits: RunLimits = Field(default_factory=RunLimits)


class ExecutionContext(Contract):
    workspace_id: Id
    session_id: Id
    run_id: Id
    task_id: Id
    activity_id: Id | None = None
    budget_id: Id
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


class RunSnapshot(Contract):
    id: Id
    version: Version = 1
    workspace_id: Id
    session_id: Id
    root_task_id: Id
    budget_id: Id
    state: TaskState = "queued"
    config: ConfigSnapshot
    scope_dependencies: list[ScopeDependency]
    deadline_at: AwareDatetime
    output: RunOutput | None = None
    reason: str | None = None
    resource_ids: list[Id] = Field(default_factory=list)


class TaskSnapshot(Contract):
    id: Id
    version: Version = 1
    run_id: Id
    parent_task_id: Id | None = None
    origin_task_id: Id | None = None
    kind: Literal["agent", "tool"]
    executor_id: str
    state: TaskState = "queued"
    created_seq: Count
    result_version: Version | None = None
    reason: str | None = None
    deadline_at: AwareDatetime | None = None


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
    output: RunOutput | None = None
    output_dependencies: list[ScopeDependency] = Field(default_factory=list)


class ActivityIntent(Contract):
    kind: Literal["model", "tool"]
    origin: Literal["agent", "user"] = "agent"
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
    receipt: ActivityReceipt | None = None
    result_digest: str | None = None
    content_committed: bool = False
    pricing_snapshot: dict[str, JsonValue] | None = None


class ReservationEstimate(Contract):
    estimated_units: Units | None
    input_estimate: Count = 0
    max_output_tokens: Count = 0


class DispatchRequest(Contract):
    activity_id: Id
    attempt_id: Id
    request_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    estimate: ReservationEstimate
    source_dependencies: list[ScopeDependency] = Field(default_factory=list)
    pricing_snapshot: dict[str, JsonValue] | None = None


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


class AccountingBudget(Contract):
    id: Id
    version: Version = 1
    run_id: Id
    spent_units: Units
    reserved_units: Units
    model_requests: Count


class AccountingActivity(Contract):
    id: Id
    version: Version = 1
    run_id: Id
    budget_id: Id
    attempt_id: Id
    state: Literal["prepared", "dispatched", "succeeded", "failed", "uncertain"]
    reserved_units: Units
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
    arguments: dict[str, JsonValue]


class ToolResultPart(Contract):
    kind: Literal["tool_result"] = "tool_result"
    call_id: str
    origin_message_id: Id | None = None
    result: JsonValue = None
    error: str | None = None


class SubmitToolTask(Contract):
    name: str
    version: str
    arguments: dict[str, JsonValue]
    wait_mode: Literal["wait", "background"] = "background"
    lifetime: Literal["run_bound"] = "run_bound"
    deadline_at: AwareDatetime | None = None


class TaskHandle(Contract):
    run_id: Id
    task_id: Id
    lifetime: Literal["run_bound"] = "run_bound"
    submitted_state: TaskState = "queued"


class TaskSubmission(Contract):
    handle: TaskHandle
    command_id: Id
    origin_task_id: Id
    args_hash: str


class ConsumerRef(Contract):
    run_id: Id
    task_id: Id
    message_boundary: Count


class ResultConsumption(Contract):
    id: Id = Field(default_factory=identifier)
    run_id: Id
    task_id: Id
    target_task_id: Id
    result_version: Version
    message_boundary: Count


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
    origin: Literal["conversation", "steering", "answer", "task_result"] = "conversation"


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
    output: RunOutput | None = None
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


class ArtifactRef(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    task_id: Id
    activity_id: Id
    dependencies: list[ScopeDependency]
    media_type: Literal["text/plain", "text/markdown"]


class StagedArtifact(Contract):
    ref: ArtifactRef
    blob_path: str
    media_type: Literal["text/plain", "text/markdown"]


class TaskResult(Contract):
    handle: TaskHandle
    result_version: Version
    state: TaskState
    result: JsonValue = None
    error: str | None = None
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    dependencies: list[ScopeDependency] = Field(default_factory=list)


class TextSlice(Contract):
    text: str
    start: Count
    end: Count
    total_chars: Count
    source_version: str


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


class RuntimeChange(Contract):
    runs: list[RunSnapshot] = Field(default_factory=list)
    tasks: list[TaskSnapshot] = Field(default_factory=list)
    activities: list[ActivitySnapshot] = Field(default_factory=list)
    budgets: list[BudgetSnapshot] = Field(default_factory=list)
    checkpoints: list[Checkpoint] = Field(default_factory=list)
    messages: list[ModelMessage] = Field(default_factory=list)
    outbox: list[OutboxItem] = Field(default_factory=list)
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    questions: list[Question] = Field(default_factory=list)
    submissions: list[TaskSubmission] = Field(default_factory=list)
    waits: list[WaitRecord] = Field(default_factory=list)
    consumptions: list[ResultConsumption] = Field(default_factory=list)
    joins: list[JoinDecision] = Field(default_factory=list)
