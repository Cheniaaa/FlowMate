// 自动生成；请修改 Python 公共契约后重新生成，不要手工编辑。
export namespace ActivityPageSchema {
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id = string;
  export type Kind = 'model' | 'tool';
  export type Operation = string;
  export type RunId = string;
  export type AttemptId = string;
  export type CollectionError = string | null;
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type ExitCode = number | null;
  export type ExternalCosts = 'unknown';
  export type ActivityId = string;
  export type ContentHash1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id1 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;
  export type RelativePath = string;
  export type Outputs = ScriptArtifact[];
  export type ScriptRelativePath = string;
  export type SkillId = string;
  export type TerminationReason = 'exited' | 'cancelled' | 'timed_out';
  export type Truncated = boolean;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId1 = string;
  export type CacheReadReported = true | null;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version1 = number;
  export type Items = ActivityView[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface ActivityPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id;
    kind: Kind;
    operation: Operation;
    run_id: RunId;
    script_execution: ScriptExecutionSummary | null;
    state: State;
    task_id: TaskId1;
    usage: Usage | null;
    version: Version1;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。
   */
  export interface ScriptExecutionSummary {
    attempt_id: AttemptId;
    collection_error: CollectionError;
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    exit_code: ExitCode;
    external_costs: ExternalCosts;
    outputs: Outputs;
    script_relative_path: ScriptRelativePath;
    skill_id: SkillId;
    termination_reason: TerminationReason;
    truncated: Truncated;
  }
  export interface ScriptArtifact {
    artifact: ArtifactRef;
    relative_path: RelativePath;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash1;
    dependencies: Dependencies1;
    id: Id1;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface Usage {
    cache_read_reported?: CacheReadReported;
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }

}
export type ActivityPage = ActivityPageSchema.ActivityPage;

export namespace ActivityViewSchema {
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id = string;
  export type Kind = 'model' | 'tool';
  export type Operation = string;
  export type RunId = string;
  export type AttemptId = string;
  export type CollectionError = string | null;
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type ExitCode = number | null;
  export type ExternalCosts = 'unknown';
  export type ActivityId = string;
  export type ContentHash1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id1 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;
  export type RelativePath = string;
  export type Outputs = ScriptArtifact[];
  export type ScriptRelativePath = string;
  export type SkillId = string;
  export type TerminationReason = 'exited' | 'cancelled' | 'timed_out';
  export type Truncated = boolean;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId1 = string;
  export type CacheReadReported = true | null;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version1 = number;

  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id;
    kind: Kind;
    operation: Operation;
    run_id: RunId;
    script_execution: ScriptExecutionSummary | null;
    state: State;
    task_id: TaskId1;
    usage: Usage | null;
    version: Version1;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。
   */
  export interface ScriptExecutionSummary {
    attempt_id: AttemptId;
    collection_error: CollectionError;
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    exit_code: ExitCode;
    external_costs: ExternalCosts;
    outputs: Outputs;
    script_relative_path: ScriptRelativePath;
    skill_id: SkillId;
    termination_reason: TerminationReason;
    truncated: Truncated;
  }
  export interface ScriptArtifact {
    artifact: ArtifactRef;
    relative_path: RelativePath;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash1;
    dependencies: Dependencies1;
    id: Id1;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface Usage {
    cache_read_reported?: CacheReadReported;
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }

}
export type ActivityView = ActivityViewSchema.ActivityView;

export namespace AdmissionFenceSchema {
  export type Generation = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;

  export interface AdmissionFence {
    generation: Generation;
    scope: ScopeRef;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type AdmissionFence = AdmissionFenceSchema.AdmissionFence;

export namespace AgentProfileSchema {
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;

  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }

}
export type AgentProfile = AgentProfileSchema.AgentProfile;

export namespace AgentProfilePageSchema {
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type Items = AgentProfile[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface AgentProfilePage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }

}
export type AgentProfilePage = AgentProfilePageSchema.AgentProfilePage;

export namespace AgentResultSchema {
  export type ArtifactIds = string[];
  export type EvidenceRefs = string[];
  export type Reason = string;
  export type ResultVersion = number;
  export type TaskId = string;
  export type HandledFailures = FailureDisposition[];
  export type Status = 'completed' | 'partial' | 'failed';
  export type JsonValue = unknown;
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Verification = string[];

  export interface AgentResult {
    artifact_ids: ArtifactIds;
    evidence_refs: EvidenceRefs;
    handled_failures: HandledFailures;
    status: Status;
    structured_result: JsonValue;
    summary: Summary;
    unresolved: Unresolved;
    verification: Verification;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion;
    task_id: TaskId;
  }

}
export type AgentResult = AgentResultSchema.AgentResult;

export namespace AnswerCommandSchema {
  export type JsonValue = unknown;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface AnswerCommand {
    data: Answer;
    meta: CommandMeta;
  }
  export interface Answer {
    answer: JsonValue;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type AnswerCommand = AnswerCommandSchema.AnswerCommand;

export namespace ApprovalSchema {
  export type ActivityId = string;
  export type ArgsHash = string;
  export type CallId = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type ExpiresAt = string;
  export type ArtifactId = string;
  export type ArtifactVersion = number;
  export type TargetExists = boolean;
  export type TargetPath = string;
  export type Id = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type JsonValue = unknown;
  export type RunId = string;
  export type SessionId = string | null;
  export type Status = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
  export type Target = string | null;
  export type TaskId = string;
  export type ToolName = string;
  export type ToolVersion = string;
  export type Version = number;
  export type WorkspaceId = string;

  export interface Approval {
    activity_id: ActivityId;
    args_hash: ArgsHash;
    call_id: CallId;
    dependencies: Dependencies;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id;
    mcp: McpToolSnapshot | null;
    parameters: Parameters;
    run_id: RunId;
    session_id: SessionId;
    status: Status;
    target: Target;
    task_id: TaskId;
    tool_name: ToolName;
    tool_version: ToolVersion;
    version: Version;
    workspace_id: WorkspaceId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 仅供本地审批展示的固定选择事实；不进入工具参数或模型消息。
   */
  export interface ExportApprovalPreview {
    artifact_id: ArtifactId;
    artifact_version: ArtifactVersion;
    target_exists: TargetExists;
    target_path: TargetPath;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Parameters {
    [k: string]: JsonValue;
  }

}
export type Approval = ApprovalSchema.Approval;

export namespace ApprovalCommandSchema {
  export type Allow = boolean;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface ApprovalCommand {
    data: ApprovalDecision;
    meta: CommandMeta;
  }
  export interface ApprovalDecision {
    allow: Allow;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type ApprovalCommand = ApprovalCommandSchema.ApprovalCommand;

export namespace ApprovalPageSchema {
  export type ActivityId = string;
  export type ArgsHash = string;
  export type CallId = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type ExpiresAt = string;
  export type ArtifactId = string;
  export type ArtifactVersion = number;
  export type TargetExists = boolean;
  export type TargetPath = string;
  export type Id = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type JsonValue = unknown;
  export type RunId = string;
  export type SessionId = string | null;
  export type Status = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
  export type Target = string | null;
  export type TaskId = string;
  export type ToolName = string;
  export type ToolVersion = string;
  export type Version = number;
  export type WorkspaceId = string;
  export type Items = Approval[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface ApprovalPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface Approval {
    activity_id: ActivityId;
    args_hash: ArgsHash;
    call_id: CallId;
    dependencies: Dependencies;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id;
    mcp: McpToolSnapshot | null;
    parameters: Parameters;
    run_id: RunId;
    session_id: SessionId;
    status: Status;
    target: Target;
    task_id: TaskId;
    tool_name: ToolName;
    tool_version: ToolVersion;
    version: Version;
    workspace_id: WorkspaceId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 仅供本地审批展示的固定选择事实；不进入工具参数或模型消息。
   */
  export interface ExportApprovalPreview {
    artifact_id: ArtifactId;
    artifact_version: ArtifactVersion;
    target_exists: TargetExists;
    target_path: TargetPath;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Parameters {
    [k: string]: JsonValue;
  }

}
export type ApprovalPage = ApprovalPageSchema.ApprovalPage;

export namespace ArchiveSessionCommandSchema {
  export type Archived = boolean;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface ArchiveSessionCommand {
    data: ArchiveSession;
    meta: CommandMeta;
  }
  export interface ArchiveSession {
    archived: Archived;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type ArchiveSessionCommand = ArchiveSessionCommandSchema.ArchiveSessionCommand;

export namespace ArtifactPageSchema {
  export type ActivityId = string;
  export type ContentHash = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Id = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;
  export type Items = ArtifactRef[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface ArtifactPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash;
    dependencies: Dependencies;
    id: Id;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }

}
export type ArtifactPage = ArtifactPageSchema.ArtifactPage;

export namespace ArtifactRefSchema {
  export type ActivityId = string;
  export type ContentHash = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Id = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;

  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash;
    dependencies: Dependencies;
    id: Id;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }

}
export type ArtifactRef = ArtifactRefSchema.ArtifactRef;

export namespace BindSkillCommandSchema {
  export type Enabled = boolean;
  export type EnvironmentId = string | null;
  export type EnvironmentRevision = number | null;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface BindSkillCommand {
    data: SkillBinding;
    meta: CommandMeta;
  }
  export interface SkillBinding {
    enabled?: Enabled;
    environment_id?: EnvironmentId;
    environment_revision?: EnvironmentRevision;
    id?: Id;
    revision?: Revision;
    scope: ScopeRef;
    skill_id: SkillId;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type BindSkillCommand = BindSkillCommandSchema.BindSkillCommand;

export namespace BudgetAllocationSchema {
  export type GroupId = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type Returned = boolean;
  export type RunId = string;
  export type Version = number;

  export interface BudgetAllocation {
    group_id: GroupId;
    limits: RunLimits;
    returned: Returned;
    run_id: RunId;
    version: Version;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_delegation_depth: MaxDelegationDepth;
    max_model_requests: MaxModelRequests;
    max_parallel_agents: MaxParallelAgents;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
    max_total_tokens: MaxTotalTokens;
  }

}
export type BudgetAllocation = BudgetAllocationSchema.BudgetAllocation;

export namespace BudgetGroupSnapshotSchema {
  export type DeadlineAt = string;
  export type Id = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelRequests = number;
  export type ReservedTokens = number;
  export type ReservedUnits = string;
  export type SpentUnits = string;
  export type Steps = number;
  export type TaskCount = number;
  export type TotalTokens = number;
  export type Version = number;

  export interface BudgetGroupSnapshot {
    deadline_at: DeadlineAt;
    id: Id;
    limits: RunLimits;
    model_requests: ModelRequests;
    reserved_tokens: ReservedTokens;
    reserved_units: ReservedUnits;
    spent_units: SpentUnits;
    steps: Steps;
    task_count: TaskCount;
    total_tokens: TotalTokens;
    version: Version;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_delegation_depth: MaxDelegationDepth;
    max_model_requests: MaxModelRequests;
    max_parallel_agents: MaxParallelAgents;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
    max_total_tokens: MaxTotalTokens;
  }

}
export type BudgetGroupSnapshot = BudgetGroupSnapshotSchema.BudgetGroupSnapshot;

export namespace BudgetSnapshotSchema {
  export type Id = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelRequests = number;
  export type ReservedTokens = number;
  export type ReservedUnits = string;
  export type RunId = string;
  export type SpentUnits = string;
  export type Steps = number;
  export type TaskCount = number;
  export type TotalTokens = number;
  export type Version = number;

  export interface BudgetSnapshot {
    id: Id;
    limits: RunLimits;
    model_requests: ModelRequests;
    reserved_tokens: ReservedTokens;
    reserved_units: ReservedUnits;
    run_id: RunId;
    spent_units: SpentUnits;
    steps: Steps;
    task_count: TaskCount;
    total_tokens: TotalTokens;
    version: Version;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_delegation_depth: MaxDelegationDepth;
    max_model_requests: MaxModelRequests;
    max_parallel_agents: MaxParallelAgents;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
    max_total_tokens: MaxTotalTokens;
  }

}
export type BudgetSnapshot = BudgetSnapshotSchema.BudgetSnapshot;

export namespace CommandMetaSchema {
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type CommandMeta = CommandMetaSchema.CommandMeta;

export namespace CommandStatusSchema {
  export type Status = 'confirmed' | 'not_found';

  export interface CommandStatus {
    result: unknown;
    status: Status;
  }

}
export type CommandStatus = CommandStatusSchema.CommandStatus;

export namespace ConsumptionPageSchema {
  export type ExecutionSessionId = string;
  export type Id = string;
  export type InboxEntryId = string | null;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId = string;
  export type TargetTaskId = string;
  export type TaskId = string;
  export type Items = ResultConsumption[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface ConsumptionPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface ResultConsumption {
    execution_session_id: ExecutionSessionId;
    id: Id;
    inbox_entry_id: InboxEntryId;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId;
    target_task_id: TargetTaskId;
    task_id: TaskId;
  }

}
export type ConsumptionPage = ConsumptionPageSchema.ConsumptionPage;

export namespace ContextUsageSummarySchema {
  export type ActivityId = string | null;
  export type CompactedMessageCount = number;
  export type CompactionReason = string | null;
  export type CompactionState = 'none' | 'running' | 'committed' | 'blocked' | 'invalidated';
  export type OmittedGroupCount = number;
  export type OmittedMessageCount = number;
  export type State = ('prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain') | null;
  export type SummaryCount = number;

  export interface ContextUsageSummary {
    activity_id: ActivityId;
    compacted_message_count: CompactedMessageCount;
    compaction_reason: CompactionReason;
    compaction_state: CompactionState;
    omitted_group_count: OmittedGroupCount;
    omitted_message_count: OmittedMessageCount;
    reason_counts: ReasonCounts;
    state: State;
    summary_count: SummaryCount;
  }
  export interface ReasonCounts {
    [k: string]: number;
  }

}
export type ContextUsageSummary = ContextUsageSummarySchema.ContextUsageSummary;

export namespace CreateMemoryCommandSchema {
  export type Kind = 'fact' | 'preference' | 'instruction' | 'episode';
  export type Kind1 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Text = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface CreateMemoryCommand {
    data: CreateMemory;
    meta: CommandMeta;
  }
  export interface CreateMemory {
    kind: Kind;
    scope: ScopeRef;
    text: Text;
  }
  export interface ScopeRef {
    kind: Kind1;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type CreateMemoryCommand = CreateMemoryCommandSchema.CreateMemoryCommand;

export namespace CreateSessionCommandSchema {
  export type Title = string | null;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface CreateSessionCommand {
    data: CreateSession;
    meta: CommandMeta;
  }
  export interface CreateSession {
    title?: Title;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type CreateSessionCommand = CreateSessionCommandSchema.CreateSessionCommand;

export namespace CreateWorkspaceCommandSchema {
  export type Name = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface CreateWorkspaceCommand {
    data: CreateWorkspace;
    meta: CommandMeta;
  }
  export interface CreateWorkspace {
    name: Name;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type CreateWorkspaceCommand = CreateWorkspaceCommandSchema.CreateWorkspaceCommand;

export namespace DataUseGrantSchema {
  export type Destination = string | null;
  export type Epoch = number;
  export type Id = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination1 = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type McpQueries = McpToolSnapshot[];
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  /**
   * @minItems 1
   */
  export type Purposes = [
    'read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send',
    ...('read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send')[]
  ];
  export type ResourceIds = string[];
  export type Status = 'active' | 'revoked';
  export type Version = number;

  export interface DataUseGrant {
    destination: Destination;
    epoch: Epoch;
    id: Id;
    mcp_queries: McpQueries;
    mcp_versions: McpVersions;
    memory_scopes: MemoryScopes;
    purposes: Purposes;
    resource_ids: ResourceIds;
    scope: ScopeRef;
    status: Status;
    version: Version;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination1;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface McpVersions {
    /**
     * This interface was referenced by `McpVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type DataUseGrant = DataUseGrantSchema.DataUseGrant;

export namespace DeletionReceiptSchema {
  export type Epoch = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Status = 'deleted';

  export interface DeletionReceipt {
    epoch: Epoch;
    scope: ScopeRef;
    status: Status;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type DeletionReceipt = DeletionReceiptSchema.DeletionReceipt;

export namespace DiscardSkillCandidateCommandSchema {
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface DiscardSkillCandidateCommand {
    data: SkillScopeRequest;
    meta: CommandMeta;
  }
  export interface SkillScopeRequest {
    scope: ScopeRef;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type DiscardSkillCandidateCommand = DiscardSkillCandidateCommandSchema.DiscardSkillCandidateCommand;

export namespace ErrorEnvelopeSchema {
  export type Code = string;
  export type RelatedIds = string[];
  export type Retryable = boolean;
  export type SafeMessage = string;

  export interface ErrorEnvelope {
    error: ErrorBody;
  }
  export interface ErrorBody {
    code: Code;
    related_ids: RelatedIds;
    retryable: Retryable;
    safe_message: SafeMessage;
  }

}
export type ErrorEnvelope = ErrorEnvelopeSchema.ErrorEnvelope;

export namespace ExecutionEnvironmentCommandStatusSchema {
  export type CheckedAt = string | null;
  export type CwdMode = 'attempt' | 'package_copy';
  export type DependencyCoverage = 'unverified' | 'manifests_only';
  export type DiagnosticCode = string | null;
  export type EnvKeys = string[];
  export type ExecutableIdentity = string | null;
  export type ExecutablePath = string;
  export type Id = string;
  export type Kind = 'python' | 'node' | 'powershell' | 'bash';
  export type ManifestCount = number;
  export type Revision = number;
  export type Status =
    'unprobed' | 'probed' | 'missing_executable' | 'identity_changed' | 'dependency_changed' | 'probe_failed';
  export type Version = string | null;
  export type Status1 = 'confirmed' | 'not_found';

  export interface ExecutionEnvironmentCommandStatus {
    result: ExecutionEnvironmentView | null;
    status: Status1;
  }
  /**
   * 公开设置投影；只显示用户选择的路径，不携带执行 env 值或基础环境私有路径。
   */
  export interface ExecutionEnvironmentView {
    checked_at: CheckedAt;
    cwd_mode: CwdMode;
    dependency_coverage: DependencyCoverage;
    diagnostic_code: DiagnosticCode;
    env_keys: EnvKeys;
    executable_identity: ExecutableIdentity;
    executable_path: ExecutablePath;
    id: Id;
    kind: Kind;
    manifest_count: ManifestCount;
    revision: Revision;
    status: Status;
    version: Version;
  }

}
export type ExecutionEnvironmentCommandStatus = ExecutionEnvironmentCommandStatusSchema.ExecutionEnvironmentCommandStatus;

export namespace ExecutionEnvironmentPageSchema {
  export type CheckedAt = string | null;
  export type CwdMode = 'attempt' | 'package_copy';
  export type DependencyCoverage = 'unverified' | 'manifests_only';
  export type DiagnosticCode = string | null;
  export type EnvKeys = string[];
  export type ExecutableIdentity = string | null;
  export type ExecutablePath = string;
  export type Id = string;
  export type Kind = 'python' | 'node' | 'powershell' | 'bash';
  export type ManifestCount = number;
  export type Revision = number;
  export type Status =
    'unprobed' | 'probed' | 'missing_executable' | 'identity_changed' | 'dependency_changed' | 'probe_failed';
  export type Version = string | null;
  export type Items = ExecutionEnvironmentView[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface ExecutionEnvironmentPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  /**
   * 公开设置投影；只显示用户选择的路径，不携带执行 env 值或基础环境私有路径。
   */
  export interface ExecutionEnvironmentView {
    checked_at: CheckedAt;
    cwd_mode: CwdMode;
    dependency_coverage: DependencyCoverage;
    diagnostic_code: DiagnosticCode;
    env_keys: EnvKeys;
    executable_identity: ExecutableIdentity;
    executable_path: ExecutablePath;
    id: Id;
    kind: Kind;
    manifest_count: ManifestCount;
    revision: Revision;
    status: Status;
    version: Version;
  }

}
export type ExecutionEnvironmentPage = ExecutionEnvironmentPageSchema.ExecutionEnvironmentPage;

export namespace ExecutionEnvironmentViewSchema {
  export type CheckedAt = string | null;
  export type CwdMode = 'attempt' | 'package_copy';
  export type DependencyCoverage = 'unverified' | 'manifests_only';
  export type DiagnosticCode = string | null;
  export type EnvKeys = string[];
  export type ExecutableIdentity = string | null;
  export type ExecutablePath = string;
  export type Id = string;
  export type Kind = 'python' | 'node' | 'powershell' | 'bash';
  export type ManifestCount = number;
  export type Revision = number;
  export type Status =
    'unprobed' | 'probed' | 'missing_executable' | 'identity_changed' | 'dependency_changed' | 'probe_failed';
  export type Version = string | null;

  /**
   * 公开设置投影；只显示用户选择的路径，不携带执行 env 值或基础环境私有路径。
   */
  export interface ExecutionEnvironmentView {
    checked_at: CheckedAt;
    cwd_mode: CwdMode;
    dependency_coverage: DependencyCoverage;
    diagnostic_code: DiagnosticCode;
    env_keys: EnvKeys;
    executable_identity: ExecutableIdentity;
    executable_path: ExecutablePath;
    id: Id;
    kind: Kind;
    manifest_count: ManifestCount;
    revision: Revision;
    status: Status;
    version: Version;
  }

}
export type ExecutionEnvironmentView = ExecutionEnvironmentViewSchema.ExecutionEnvironmentView;

export namespace ExportCommandSchema {
  export type ExpectedTargetHash = string | null;
  export type TargetRef = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface ExportCommand {
    data: ExportRequest;
    meta: CommandMeta;
  }
  export interface ExportRequest {
    expected_target_hash?: ExpectedTargetHash;
    target_ref: TargetRef;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type ExportCommand = ExportCommandSchema.ExportCommand;

export namespace ExportReceiptSchema {
  export type ActivityId = string;
  export type ContentHash = string;
  export type State = 'applied' | 'uncertain';
  export type TargetRef = string;

  export interface ExportReceipt {
    activity_id: ActivityId;
    content_hash: ContentHash;
    state: State;
    target_ref: TargetRef;
  }

}
export type ExportReceipt = ExportReceiptSchema.ExportReceipt;

export namespace FollowUpIntentSchema {
  export type BudgetGroupId = string;
  export type Id = string;
  export type OriginRunId = string;
  export type PausedTaskIds = string[];
  export type PolicyVersion = number;
  export type Reason = string | null;
  export type RunId = string | null;
  export type SourceResult = string;
  export type Status = 'ready' | 'active' | 'paused' | 'closed';
  export type TargetSessionId = string;

  export interface FollowUpIntent {
    budget_group_id: BudgetGroupId;
    id: Id;
    origin_run_id: OriginRunId;
    paused_task_ids: PausedTaskIds;
    policy_version: PolicyVersion;
    reason: Reason;
    run_id: RunId;
    source_result: SourceResult;
    status: Status;
    target_session_id: TargetSessionId;
  }

}
export type FollowUpIntent = FollowUpIntentSchema.FollowUpIntent;

export namespace FollowUpIntentPageSchema {
  export type BudgetGroupId = string;
  export type Id = string;
  export type OriginRunId = string;
  export type PausedTaskIds = string[];
  export type PolicyVersion = number;
  export type Reason = string | null;
  export type RunId = string | null;
  export type SourceResult = string;
  export type Status = 'ready' | 'active' | 'paused' | 'closed';
  export type TargetSessionId = string;
  export type Items = FollowUpIntent[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface FollowUpIntentPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface FollowUpIntent {
    budget_group_id: BudgetGroupId;
    id: Id;
    origin_run_id: OriginRunId;
    paused_task_ids: PausedTaskIds;
    policy_version: PolicyVersion;
    reason: Reason;
    run_id: RunId;
    source_result: SourceResult;
    status: Status;
    target_session_id: TargetSessionId;
  }

}
export type FollowUpIntentPage = FollowUpIntentPageSchema.FollowUpIntentPage;

export namespace GrantPageSchema {
  export type Destination = string | null;
  export type Epoch = number;
  export type Id = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination1 = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type McpQueries = McpToolSnapshot[];
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  /**
   * @minItems 1
   */
  export type Purposes = [
    'read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send',
    ...('read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send')[]
  ];
  export type ResourceIds = string[];
  export type Status = 'active' | 'revoked';
  export type Version = number;
  export type Items = DataUseGrant[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface GrantPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface DataUseGrant {
    destination: Destination;
    epoch: Epoch;
    id: Id;
    mcp_queries: McpQueries;
    mcp_versions: McpVersions;
    memory_scopes: MemoryScopes;
    purposes: Purposes;
    resource_ids: ResourceIds;
    scope: ScopeRef;
    status: Status;
    version: Version;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination1;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface McpVersions {
    /**
     * This interface was referenced by `McpVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type GrantPage = GrantPageSchema.GrantPage;

export namespace GrantRequestSchema {
  export type Destination = string | null;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination1 = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type McpQueries = McpToolSnapshot[];
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  /**
   * @minItems 1
   */
  export type Purposes = [
    'read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send',
    ...('read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send')[]
  ];
  export type ResourceIds = string[];
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface GrantRequest {
    data: GrantCommand;
    meta: CommandMeta;
  }
  export interface GrantCommand {
    destination?: Destination;
    mcp_queries?: McpQueries;
    mcp_versions?: McpVersions;
    memory_scopes?: MemoryScopes;
    purposes: Purposes;
    resource_ids?: ResourceIds;
    scope: ScopeRef;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination1;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface McpVersions {
    /**
     * This interface was referenced by `McpVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type GrantRequest = GrantRequestSchema.GrantRequest;

export namespace HealthSchema {
  export type ApiVersion = 3;
  export type RuntimeVersion = string;
  export type SchemaVersion = 3;

  export interface Health {
    api_version: ApiVersion;
    runtime_version: RuntimeVersion;
    schema_version: SchemaVersion;
  }

}
export type Health = HealthSchema.Health;

export namespace ImportSkillCommandSchema {
  export type BaseHash = string | null;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SelectionId = string;
  export type SkillId = string | null;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface ImportSkillCommand {
    data: ImportSkill;
    meta: CommandMeta;
  }
  export interface ImportSkill {
    base_hash?: BaseHash;
    scope: ScopeRef;
    selection_id: SelectionId;
    skill_id?: SkillId;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type ImportSkillCommand = ImportSkillCommandSchema.ImportSkillCommand;

export namespace InboxPageSchema {
  export type Id = string;
  export type Kind = 'question';
  export type AnswerMessageId = string | null;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Id1 = string;
  export type MessageId = string;
  export type Question1 = string;
  export type RunId = string;
  export type Status = 'pending' | 'answered' | 'cancelled';
  export type TaskId = string;
  export type Version = number;
  export type RunId1 = string;
  export type SessionId = string | null;
  export type SessionTitle = string | null;
  export type TaskGoal = string | null;
  export type WorkspaceId = string;
  export type WorkspaceName = string | null;
  export type ActivityId = string;
  export type ArgsHash = string;
  export type CallId1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type ExpiresAt = string;
  export type ArtifactId = string;
  export type ArtifactVersion = number;
  export type TargetExists = boolean;
  export type TargetPath = string;
  export type Id2 = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type RunId2 = string;
  export type SessionId1 = string | null;
  export type Status1 = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
  export type Target = string | null;
  export type TaskId1 = string;
  export type ToolName = string;
  export type ToolVersion = string;
  export type Version1 = number;
  export type WorkspaceId1 = string;
  export type Id3 = string;
  export type Kind1 = 'approval';
  export type RunId3 = string;
  export type SessionId2 = string | null;
  export type SessionTitle1 = string | null;
  export type TaskGoal1 = string | null;
  export type WorkspaceId2 = string;
  export type WorkspaceName1 = string | null;
  export type ExpectedVersion = number | null;
  export type Kind2 = 'view_task' | 'resume' | 'cancel_run' | 'retry_delivery' | 'inspect_export_recovery';
  export type TargetId = string;
  export type AllowedActions = PendingActionCommand[];
  export type Id4 = string;
  export type Kind3 = 'recovery' | 'blocked' | 'delivery_failed';
  export type Reason = string;
  export type RunId4 = string;
  export type SessionId3 = string | null;
  export type SessionTitle2 = string | null;
  export type TaskGoal2 = string | null;
  export type TaskId2 = string;
  export type Version2 = number;
  export type WorkspaceId3 = string;
  export type WorkspaceName2 = string | null;
  export type Items = (InboxQuestion | InboxApproval | PendingAction)[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface InboxPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface InboxQuestion {
    id: Id;
    kind: Kind;
    question: Question;
    run_id: RunId1;
    session_id: SessionId;
    session_title?: SessionTitle;
    task_goal?: TaskGoal;
    workspace_id: WorkspaceId;
    workspace_name?: WorkspaceName;
  }
  export interface Question {
    answer_message_id: AnswerMessageId;
    answer_schema: AnswerSchema;
    call_id: CallId;
    dependencies: Dependencies;
    id: Id1;
    message_id: MessageId;
    question: Question1;
    run_id: RunId;
    status: Status;
    task_id: TaskId;
    version: Version;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface InboxApproval {
    approval: Approval;
    id: Id3;
    kind: Kind1;
    run_id: RunId3;
    session_id: SessionId2;
    session_title?: SessionTitle1;
    task_goal?: TaskGoal1;
    workspace_id: WorkspaceId2;
    workspace_name?: WorkspaceName1;
  }
  export interface Approval {
    activity_id: ActivityId;
    args_hash: ArgsHash;
    call_id: CallId1;
    dependencies: Dependencies1;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id2;
    mcp: McpToolSnapshot | null;
    parameters: Parameters;
    run_id: RunId2;
    session_id: SessionId1;
    status: Status1;
    target: Target;
    task_id: TaskId1;
    tool_name: ToolName;
    tool_version: ToolVersion;
    version: Version1;
    workspace_id: WorkspaceId1;
  }
  /**
   * 仅供本地审批展示的固定选择事实；不进入工具参数或模型消息。
   */
  export interface ExportApprovalPreview {
    artifact_id: ArtifactId;
    artifact_version: ArtifactVersion;
    target_exists: TargetExists;
    target_path: TargetPath;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Parameters {
    [k: string]: JsonValue;
  }
  export interface PendingAction {
    allowed_actions: AllowedActions;
    id: Id4;
    kind: Kind3;
    reason: Reason;
    run_id: RunId4;
    session_id: SessionId3;
    session_title?: SessionTitle2;
    task_goal?: TaskGoal2;
    task_id: TaskId2;
    version: Version2;
    workspace_id: WorkspaceId3;
    workspace_name?: WorkspaceName2;
  }
  export interface PendingActionCommand {
    expected_version: ExpectedVersion;
    kind: Kind2;
    target_id: TargetId;
  }

}
export type InboxPage = InboxPageSchema.InboxPage;

export namespace JoinFactSchema {
  export type ChildResultVersion = number;
  export type ChildTaskId = string;
  export type EventId = string;
  export type Id = string;
  export type RootTaskId = string;
  export type RunId = string;

  export interface JoinFact {
    child_result_version: ChildResultVersion;
    child_task_id: ChildTaskId;
    event_id: EventId;
    id: Id;
    root_task_id: RootTaskId;
    run_id: RunId;
  }

}
export type JoinFact = JoinFactSchema.JoinFact;

export namespace JoinPageSchema {
  export type ChildResultVersion = number;
  export type ChildTaskId = string;
  export type EventId = string;
  export type Id = string;
  export type RootTaskId = string;
  export type RunId = string;
  export type Items = JoinFact[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface JoinPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface JoinFact {
    child_result_version: ChildResultVersion;
    child_task_id: ChildTaskId;
    event_id: EventId;
    id: Id;
    root_task_id: RootTaskId;
    run_id: RunId;
  }

}
export type JoinPage = JoinPageSchema.JoinPage;

export namespace McpConfiguredServerSchema {
  export type Args = string[];
  export type Command = string | null;
  export type CredentialRef = string | null;
  export type Cwd = string | null;
  export type DisplayName = string;
  export type Enabled = boolean;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Transport = 'stdio' | 'http';
  export type Url = string | null;

  export interface McpConfiguredServer {
    args: Args;
    command: Command;
    credential_ref: CredentialRef;
    cwd: Cwd;
    display_name: DisplayName;
    enabled: Enabled;
    env_refs: EnvRefs;
    id: Id;
    revision: Revision;
    scope: ScopeRef;
    transport: Transport;
    url: Url;
  }
  export interface EnvRefs {
    [k: string]: string;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type McpConfiguredServer = McpConfiguredServerSchema.McpConfiguredServer;

export namespace McpImportPreviewSchema {
  export type Args = string[];
  export type Command = string | null;
  export type CredentialRef = string | null;
  export type Cwd = string | null;
  export type DisplayName = string;
  export type Enabled = boolean;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Transport = 'stdio' | 'http';
  export type Url = string | null;
  export type Configs = McpConfiguredServer[];
  export type Errors = string[];
  export type EnvName = string | null;
  export type Purpose = 'env' | 'http_token';
  export type ServerId = string;
  export type Slot = string;
  export type RequiredSecretSlots = McpSecretSlot[];

  export interface McpImportPreview {
    configs: Configs;
    errors: Errors;
    required_secret_slots: RequiredSecretSlots;
  }
  export interface McpConfiguredServer {
    args: Args;
    command: Command;
    credential_ref: CredentialRef;
    cwd: Cwd;
    display_name: DisplayName;
    enabled: Enabled;
    env_refs: EnvRefs;
    id: Id;
    revision: Revision;
    scope: ScopeRef;
    transport: Transport;
    url: Url;
  }
  export interface EnvRefs {
    [k: string]: string;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface McpSecretSlot {
    env_name: EnvName;
    purpose: Purpose;
    server_id: ServerId;
    slot: Slot;
  }

}
export type McpImportPreview = McpImportPreviewSchema.McpImportPreview;

export namespace McpImportRequestSchema {
  export type SanitizedJson = string;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;

  export interface McpImportRequest {
    sanitized_json: SanitizedJson;
    scope: ScopeRef;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }

}
export type McpImportRequest = McpImportRequestSchema.McpImportRequest;

export namespace McpSaveCommandSchema {
  export type Args = string[];
  export type Command = string | null;
  export type CredentialRef = string | null;
  export type Cwd = string | null;
  export type DisplayName = string;
  export type Enabled = boolean;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Transport = 'stdio' | 'http';
  export type Url = string | null;
  export type Confirmed = boolean;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface McpSaveCommand {
    data: McpSave;
    meta: CommandMeta;
  }
  export interface McpSave {
    config: McpConfiguredServer;
    confirmed: Confirmed;
  }
  export interface McpConfiguredServer {
    args?: Args;
    command?: Command;
    credential_ref?: CredentialRef;
    cwd?: Cwd;
    display_name: DisplayName;
    enabled?: Enabled;
    env_refs?: EnvRefs;
    id: Id;
    revision: Revision;
    scope: ScopeRef;
    transport: Transport;
    url?: Url;
  }
  export interface EnvRefs {
    [k: string]: string;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type McpSaveCommand = McpSaveCommandSchema.McpSaveCommand;

export namespace McpSelectToolsCommandSchema {
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SelectedNames = string[];
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface McpSelectToolsCommand {
    data: McpSelectTools;
    meta: CommandMeta;
  }
  export interface McpSelectTools {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    scope: ScopeRef;
    selected_names: SelectedNames;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type McpSelectToolsCommand = McpSelectToolsCommandSchema.McpSelectToolsCommand;

export namespace McpServerPageSchema {
  export type ConfigRevision = number;
  export type ContentHash = string;
  export type ServerId = string;
  export type Annotations = {
    [k: string]: JsonValue;
  } | null;
  export type JsonValue = unknown;
  export type Description = string | null;
  export type Name = string;
  export type OutputSchema = {
    [k: string]: JsonValue;
  } | null;
  export type UnavailableReason = string | null;
  export type Tools = McpToolDefinition[];
  export type Args = string[];
  export type Command = string | null;
  export type CredentialRef = string | null;
  export type Cwd = string | null;
  export type DisplayName = string;
  export type Enabled = boolean;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Transport = 'stdio' | 'http';
  export type Url = string | null;
  export type ErrorCode = string | null;
  export type Destination = string | null;
  export type Epoch = number;
  export type Id1 = string;
  export type CatalogHash = string;
  export type ConfigRevision1 = number;
  export type Destination1 = string;
  export type OriginalName = string;
  export type ServerId1 = string;
  export type McpQueries = McpToolSnapshot[];
  export type MemoryScopes = ScopeRef[];
  /**
   * @minItems 1
   */
  export type Purposes = [
    'read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send',
    ...('read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send')[]
  ];
  export type ResourceIds = string[];
  export type Status = 'active' | 'revoked';
  export type Version = number;
  export type QueryGrants = DataUseGrant[];
  export type CatalogHash1 = string;
  export type ConfigRevision2 = number;
  export type SelectedNames = string[];
  export type ServerId2 = string;
  export type Version1 = number;
  export type State = 'saved' | 'connecting' | 'connected' | 'failed' | 'stopped';
  export type Items = McpServerView[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface McpServerPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface McpServerView {
    catalog: McpCatalog | null;
    config: McpConfiguredServer;
    error_code: ErrorCode;
    query_grants: QueryGrants;
    selection: McpToolSelection | null;
    state: State;
  }
  export interface McpCatalog {
    config_revision: ConfigRevision;
    content_hash: ContentHash;
    server_id: ServerId;
    tools: Tools;
  }
  export interface McpToolDefinition {
    annotations: Annotations;
    description: Description;
    input_schema: InputSchema;
    name: Name;
    output_schema: OutputSchema;
    unavailable_reason: UnavailableReason;
  }
  export interface InputSchema {
    [k: string]: JsonValue;
  }
  export interface McpConfiguredServer {
    args: Args;
    command: Command;
    credential_ref: CredentialRef;
    cwd: Cwd;
    display_name: DisplayName;
    enabled: Enabled;
    env_refs: EnvRefs;
    id: Id;
    revision: Revision;
    scope: ScopeRef;
    transport: Transport;
    url: Url;
  }
  export interface EnvRefs {
    [k: string]: string;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface DataUseGrant {
    destination: Destination;
    epoch: Epoch;
    id: Id1;
    mcp_queries: McpQueries;
    mcp_versions: McpVersions;
    memory_scopes: MemoryScopes;
    purposes: Purposes;
    resource_ids: ResourceIds;
    scope: ScopeRef;
    status: Status;
    version: Version;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision1;
    destination: Destination1;
    original_name: OriginalName;
    server_id: ServerId1;
  }
  export interface McpVersions {
    /**
     * This interface was referenced by `McpVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface McpToolSelection {
    catalog_hash: CatalogHash1;
    config_revision: ConfigRevision2;
    scope: ScopeRef;
    selected_names: SelectedNames;
    server_id: ServerId2;
    version: Version1;
  }

}
export type McpServerPage = McpServerPageSchema.McpServerPage;

export namespace McpServerViewSchema {
  export type ConfigRevision = number;
  export type ContentHash = string;
  export type ServerId = string;
  export type Annotations = {
    [k: string]: JsonValue;
  } | null;
  export type JsonValue = unknown;
  export type Description = string | null;
  export type Name = string;
  export type OutputSchema = {
    [k: string]: JsonValue;
  } | null;
  export type UnavailableReason = string | null;
  export type Tools = McpToolDefinition[];
  export type Args = string[];
  export type Command = string | null;
  export type CredentialRef = string | null;
  export type Cwd = string | null;
  export type DisplayName = string;
  export type Enabled = boolean;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Transport = 'stdio' | 'http';
  export type Url = string | null;
  export type ErrorCode = string | null;
  export type Destination = string | null;
  export type Epoch = number;
  export type Id1 = string;
  export type CatalogHash = string;
  export type ConfigRevision1 = number;
  export type Destination1 = string;
  export type OriginalName = string;
  export type ServerId1 = string;
  export type McpQueries = McpToolSnapshot[];
  export type MemoryScopes = ScopeRef[];
  /**
   * @minItems 1
   */
  export type Purposes = [
    'read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send',
    ...('read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send')[]
  ];
  export type ResourceIds = string[];
  export type Status = 'active' | 'revoked';
  export type Version = number;
  export type QueryGrants = DataUseGrant[];
  export type CatalogHash1 = string;
  export type ConfigRevision2 = number;
  export type SelectedNames = string[];
  export type ServerId2 = string;
  export type Version1 = number;
  export type State = 'saved' | 'connecting' | 'connected' | 'failed' | 'stopped';

  export interface McpServerView {
    catalog: McpCatalog | null;
    config: McpConfiguredServer;
    error_code: ErrorCode;
    query_grants: QueryGrants;
    selection: McpToolSelection | null;
    state: State;
  }
  export interface McpCatalog {
    config_revision: ConfigRevision;
    content_hash: ContentHash;
    server_id: ServerId;
    tools: Tools;
  }
  export interface McpToolDefinition {
    annotations: Annotations;
    description: Description;
    input_schema: InputSchema;
    name: Name;
    output_schema: OutputSchema;
    unavailable_reason: UnavailableReason;
  }
  export interface InputSchema {
    [k: string]: JsonValue;
  }
  export interface McpConfiguredServer {
    args: Args;
    command: Command;
    credential_ref: CredentialRef;
    cwd: Cwd;
    display_name: DisplayName;
    enabled: Enabled;
    env_refs: EnvRefs;
    id: Id;
    revision: Revision;
    scope: ScopeRef;
    transport: Transport;
    url: Url;
  }
  export interface EnvRefs {
    [k: string]: string;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface DataUseGrant {
    destination: Destination;
    epoch: Epoch;
    id: Id1;
    mcp_queries: McpQueries;
    mcp_versions: McpVersions;
    memory_scopes: MemoryScopes;
    purposes: Purposes;
    resource_ids: ResourceIds;
    scope: ScopeRef;
    status: Status;
    version: Version;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision1;
    destination: Destination1;
    original_name: OriginalName;
    server_id: ServerId1;
  }
  export interface McpVersions {
    /**
     * This interface was referenced by `McpVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface McpToolSelection {
    catalog_hash: CatalogHash1;
    config_revision: ConfigRevision2;
    scope: ScopeRef;
    selected_names: SelectedNames;
    server_id: ServerId2;
    version: Version1;
  }

}
export type McpServerView = McpServerViewSchema.McpServerView;

export namespace McpToolSelectionSchema {
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SelectedNames = string[];
  export type ServerId = string;
  export type Version = number;

  export interface McpToolSelection {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    scope: ScopeRef;
    selected_names: SelectedNames;
    server_id: ServerId;
    version: Version;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type McpToolSelection = McpToolSelectionSchema.McpToolSelection;

export namespace MemberLaneSchema {
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id = string;
  export type Kind = 'model' | 'tool';
  export type Operation = string;
  export type RunId = string;
  export type AttemptId = string;
  export type CollectionError = string | null;
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type ExitCode = number | null;
  export type ExternalCosts = 'unknown';
  export type ActivityId = string;
  export type ContentHash1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id1 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;
  export type RelativePath = string;
  export type Outputs = ScriptArtifact[];
  export type ScriptRelativePath = string;
  export type SkillId = string;
  export type TerminationReason = 'exited' | 'cancelled' | 'timed_out';
  export type Truncated = boolean;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId1 = string;
  export type CacheReadReported = true | null;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version1 = number;
  export type Activities = ActivityView[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId1 = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId2 = string;
  export type Handoffs = TaskHandle[];
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id2 = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version2 = number;
  export type Dependencies2 = ScopeDependency[];
  export type InboxEntryId = string;
  export type ResultVersion = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;
  export type AdditionalResultInputs = ResultInput[];
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind1 = 'agent';
  export type JsonValue = unknown;
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source1 = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id3 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind2 = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source2 = string | null;
  export type VerifiedAt = string | null;
  export type Version3 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version4 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DelegationDepth = number;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type SourceVersion = string;
  export type InputArtifacts = ArtifactRef[];
  export type InteractionSessionId = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind3 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type CreatedSeq = number;
  export type DeadlineAt = string | null;
  export type ExecutorId = string;
  export type Id4 = string;
  export type Kind4 = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason = string | null;
  export type ResultVersion1 = number | null;
  export type RunId2 = string;
  export type State1 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version5 = number;

  export interface MemberLane {
    activities: Activities;
    handoffs: Handoffs;
    profile: AgentProfile;
    task: TaskSnapshot;
  }
  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id;
    kind: Kind;
    operation: Operation;
    run_id: RunId;
    script_execution: ScriptExecutionSummary | null;
    state: State;
    task_id: TaskId1;
    usage: Usage | null;
    version: Version1;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。
   */
  export interface ScriptExecutionSummary {
    attempt_id: AttemptId;
    collection_error: CollectionError;
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    exit_code: ExitCode;
    external_costs: ExternalCosts;
    outputs: Outputs;
    script_relative_path: ScriptRelativePath;
    skill_id: SkillId;
    termination_reason: TerminationReason;
    truncated: Truncated;
  }
  export interface ScriptArtifact {
    artifact: ArtifactRef;
    relative_path: RelativePath;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash1;
    dependencies: Dependencies1;
    id: Id1;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface Usage {
    cache_read_reported?: CacheReadReported;
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId1;
    submitted_state: SubmittedState;
    task_id: TaskId2;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id2;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version2;
  }
  export interface TaskSnapshot {
    binding: TaskExecutionBinding;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    executor_id: ExecutorId;
    id: Id4;
    kind: Kind4;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason;
    result_version: ResultVersion1;
    run_id: RunId2;
    state: State1;
    version: Version5;
  }
  export interface TaskExecutionBinding {
    additional_result_inputs: AdditionalResultInputs;
    agent_work: AgentWork | null;
    config: ConfigSnapshot;
    delegation_depth: DelegationDepth;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    input_artifacts: InputArtifacts;
    input_result: ResultInput | null;
    interaction_session_id: InteractionSessionId;
    sources: SourceSelection;
  }
  export interface ResultInput {
    dependencies: Dependencies2;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId;
    result_version: ResultVersion;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs: InputRefs;
    kind: Kind1;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source1;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id3;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version4;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind2;
    note: Note;
    source: Source2;
    verified_at: VerifiedAt;
    version: Version3;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind3;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type MemberLane = MemberLaneSchema.MemberLane;

export namespace MemberLaneListSchema {
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id = string;
  export type Kind = 'model' | 'tool';
  export type Operation = string;
  export type RunId = string;
  export type AttemptId = string;
  export type CollectionError = string | null;
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type ExitCode = number | null;
  export type ExternalCosts = 'unknown';
  export type ActivityId = string;
  export type ContentHash1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id1 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;
  export type RelativePath = string;
  export type Outputs = ScriptArtifact[];
  export type ScriptRelativePath = string;
  export type SkillId = string;
  export type TerminationReason = 'exited' | 'cancelled' | 'timed_out';
  export type Truncated = boolean;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId1 = string;
  export type CacheReadReported = true | null;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version1 = number;
  export type Activities = ActivityView[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId1 = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId2 = string;
  export type Handoffs = TaskHandle[];
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id2 = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version2 = number;
  export type Dependencies2 = ScopeDependency[];
  export type InboxEntryId = string;
  export type ResultVersion = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;
  export type AdditionalResultInputs = ResultInput[];
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind1 = 'agent';
  export type JsonValue = unknown;
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source1 = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id3 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind2 = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source2 = string | null;
  export type VerifiedAt = string | null;
  export type Version3 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version4 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DelegationDepth = number;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type SourceVersion = string;
  export type InputArtifacts = ArtifactRef[];
  export type InteractionSessionId = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind3 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type CreatedSeq = number;
  export type DeadlineAt = string | null;
  export type ExecutorId = string;
  export type Id4 = string;
  export type Kind4 = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason = string | null;
  export type ResultVersion1 = number | null;
  export type RunId2 = string;
  export type State1 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version5 = number;
  export type MemberLaneList = MemberLane[];

  export interface MemberLane {
    activities: Activities;
    handoffs: Handoffs;
    profile: AgentProfile;
    task: TaskSnapshot;
  }
  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id;
    kind: Kind;
    operation: Operation;
    run_id: RunId;
    script_execution: ScriptExecutionSummary | null;
    state: State;
    task_id: TaskId1;
    usage: Usage | null;
    version: Version1;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。
   */
  export interface ScriptExecutionSummary {
    attempt_id: AttemptId;
    collection_error: CollectionError;
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    exit_code: ExitCode;
    external_costs: ExternalCosts;
    outputs: Outputs;
    script_relative_path: ScriptRelativePath;
    skill_id: SkillId;
    termination_reason: TerminationReason;
    truncated: Truncated;
  }
  export interface ScriptArtifact {
    artifact: ArtifactRef;
    relative_path: RelativePath;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash1;
    dependencies: Dependencies1;
    id: Id1;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface Usage {
    cache_read_reported?: CacheReadReported;
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId1;
    submitted_state: SubmittedState;
    task_id: TaskId2;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id2;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version2;
  }
  export interface TaskSnapshot {
    binding: TaskExecutionBinding;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    executor_id: ExecutorId;
    id: Id4;
    kind: Kind4;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason;
    result_version: ResultVersion1;
    run_id: RunId2;
    state: State1;
    version: Version5;
  }
  export interface TaskExecutionBinding {
    additional_result_inputs: AdditionalResultInputs;
    agent_work: AgentWork | null;
    config: ConfigSnapshot;
    delegation_depth: DelegationDepth;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    input_artifacts: InputArtifacts;
    input_result: ResultInput | null;
    interaction_session_id: InteractionSessionId;
    sources: SourceSelection;
  }
  export interface ResultInput {
    dependencies: Dependencies2;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId;
    result_version: ResultVersion;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs: InputRefs;
    kind: Kind1;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source1;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id3;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version4;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind2;
    note: Note;
    source: Source2;
    verified_at: VerifiedAt;
    version: Version3;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind3;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type MemberLaneList = MemberLaneListSchema.MemberLaneList;

export namespace MemoryDecisionCommandSchema {
  export type Action = 'accept' | 'reject' | 'revise' | 'delete' | 'undo';
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Text = string | null;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface MemoryDecisionCommand {
    data: MemoryDecision;
    meta: CommandMeta;
  }
  export interface MemoryDecision {
    action: Action;
    scope: ScopeRef;
    text?: Text;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type MemoryDecisionCommand = MemoryDecisionCommandSchema.MemoryDecisionCommand;

export namespace MemoryEvidenceExcerptSchema {
  export type AuthorKind = 'user' | 'assistant' | 'tool';
  export type Locator = string;
  export type QuoteHash = string;
  export type SourceId = string;
  export type SourceKind = 'message' | 'event' | 'artifact' | 'user_edit';
  export type SourceVersion = string;
  export type End = number;
  export type HasStructuredContent = true | null;
  export type SourceVersion1 = string;
  export type Start = number;
  export type Text = string;
  export type TotalChars = number;
  export type Reason = ('source_unavailable' | 'source_not_public') | null;
  export type RecordId = string;
  export type RecordRevision = number;
  export type SourceLabel = string;

  export interface MemoryEvidenceExcerpt {
    evidence: MemoryEvidence;
    excerpt: TextSlice | null;
    reason: Reason;
    record_id: RecordId;
    record_revision: RecordRevision;
    source_label: SourceLabel;
  }
  export interface MemoryEvidence {
    author_kind: AuthorKind;
    locator: Locator;
    quote_hash: QuoteHash;
    source_id: SourceId;
    source_kind: SourceKind;
    source_version: SourceVersion;
  }
  export interface TextSlice {
    end: End;
    has_structured_content?: HasStructuredContent;
    source_version: SourceVersion1;
    start: Start;
    text: Text;
    total_chars: TotalChars;
  }

}
export type MemoryEvidenceExcerpt = MemoryEvidenceExcerptSchema.MemoryEvidenceExcerpt;

export namespace MemoryEvidencePageSchema {
  export type Available = boolean;
  export type AuthorKind = 'user' | 'assistant' | 'tool';
  export type Locator = string;
  export type QuoteHash = string;
  export type SourceId = string;
  export type SourceKind = 'message' | 'event' | 'artifact' | 'user_edit';
  export type SourceVersion = string;
  export type Reason = string | null;
  export type Items = MemoryEvidenceView[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface MemoryEvidencePage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface MemoryEvidenceView {
    available: Available;
    evidence: MemoryEvidence;
    reason: Reason;
  }
  export interface MemoryEvidence {
    author_kind: AuthorKind;
    locator: Locator;
    quote_hash: QuoteHash;
    source_id: SourceId;
    source_kind: SourceKind;
    source_version: SourceVersion;
  }

}
export type MemoryEvidencePage = MemoryEvidencePageSchema.MemoryEvidencePage;

export namespace MemoryGrantRequestSchema {
  export type Destination = string;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface MemoryGrantRequest {
    data: MemoryGrantCommand;
    meta: CommandMeta;
  }
  export interface MemoryGrantCommand {
    destination: Destination;
    scope: ScopeRef;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type MemoryGrantRequest = MemoryGrantRequestSchema.MemoryGrantRequest;

export namespace MemoryMaintenanceNoticeSchema {
  export type Id = string;
  export type PolicyVersion = number;
  export type Reason = string | null;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type EventId = string;
  export type RunId = string;
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId1 = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;

  export interface MemoryMaintenanceNotice {
    id: Id;
    policy_version: PolicyVersion;
    reason: Reason;
    scope: ScopeRef;
    source_boundary: MemorySourceBoundary;
    task: TaskHandle | null;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface MemorySourceBoundary {
    event_id: EventId;
    run_id: RunId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId1;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }

}
export type MemoryMaintenanceNotice = MemoryMaintenanceNoticeSchema.MemoryMaintenanceNotice;

export namespace MemoryMaintenancePageSchema {
  export type Id = string;
  export type PolicyVersion = number;
  export type Reason = string | null;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type EventId = string;
  export type RunId = string;
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId1 = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;
  export type Items = MemoryMaintenanceNotice[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface MemoryMaintenancePage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface MemoryMaintenanceNotice {
    id: Id;
    policy_version: PolicyVersion;
    reason: Reason;
    scope: ScopeRef;
    source_boundary: MemorySourceBoundary;
    task: TaskHandle | null;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface MemorySourceBoundary {
    event_id: EventId;
    run_id: RunId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId1;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }

}
export type MemoryMaintenancePage = MemoryMaintenancePageSchema.MemoryMaintenancePage;

export namespace MemoryPolicySchema {
  export type AutoOrganize = boolean;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelProfileId = string | null;
  export type ReadProfile = boolean;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Version = number;

  export interface MemoryPolicy {
    auto_organize: AutoOrganize;
    maintenance_limits: RunLimits;
    model_profile_id: ModelProfileId;
    read_profile: ReadProfile;
    scope: ScopeRef;
    version: Version;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_delegation_depth: MaxDelegationDepth;
    max_model_requests: MaxModelRequests;
    max_parallel_agents: MaxParallelAgents;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
    max_total_tokens: MaxTotalTokens;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type MemoryPolicy = MemoryPolicySchema.MemoryPolicy;

export namespace MemoryRecordSchema {
  export type AuthorKind = 'user' | 'assistant' | 'tool';
  export type ClaimKey = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type AuthorKind1 = 'user' | 'assistant' | 'tool';
  export type Locator = string;
  export type QuoteHash = string;
  export type SourceId = string;
  export type SourceKind = 'message' | 'event' | 'artifact' | 'user_edit';
  export type SourceVersion = string;
  export type Evidence = MemoryEvidence[];
  export type ExpiresAt = string | null;
  export type Id = string;
  export type Kind = 'fact' | 'preference' | 'instruction' | 'episode';
  export type OwnerId = string;
  export type Revision = number;
  export type Kind1 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Status = 'candidate' | 'confirmed' | 'rejected' | 'deleted';
  export type Supersedes = string | null;
  export type Text = string;

  export interface MemoryRecord {
    author_kind: AuthorKind;
    claim_key: ClaimKey;
    dependencies: Dependencies;
    evidence: Evidence;
    expires_at: ExpiresAt;
    id: Id;
    kind: Kind;
    owner_id: OwnerId;
    revision: Revision;
    scope: ScopeRef;
    status: Status;
    supersedes: Supersedes;
    text: Text;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface MemoryEvidence {
    author_kind: AuthorKind1;
    locator: Locator;
    quote_hash: QuoteHash;
    source_id: SourceId;
    source_kind: SourceKind;
    source_version: SourceVersion;
  }
  export interface ScopeRef {
    kind: Kind1;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type MemoryRecord = MemoryRecordSchema.MemoryRecord;

export namespace MemoryRecordPageSchema {
  export type AuthorKind = 'user' | 'assistant' | 'tool';
  export type ClaimKey = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type AuthorKind1 = 'user' | 'assistant' | 'tool';
  export type Locator = string;
  export type QuoteHash = string;
  export type SourceId = string;
  export type SourceKind = 'message' | 'event' | 'artifact' | 'user_edit';
  export type SourceVersion = string;
  export type Evidence = MemoryEvidence[];
  export type ExpiresAt = string | null;
  export type Id = string;
  export type Kind = 'fact' | 'preference' | 'instruction' | 'episode';
  export type OwnerId = string;
  export type Revision = number;
  export type Kind1 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Status = 'candidate' | 'confirmed' | 'rejected' | 'deleted';
  export type Supersedes = string | null;
  export type Text = string;
  export type Items = MemoryRecord[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface MemoryRecordPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface MemoryRecord {
    author_kind: AuthorKind;
    claim_key: ClaimKey;
    dependencies: Dependencies;
    evidence: Evidence;
    expires_at: ExpiresAt;
    id: Id;
    kind: Kind;
    owner_id: OwnerId;
    revision: Revision;
    scope: ScopeRef;
    status: Status;
    supersedes: Supersedes;
    text: Text;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface MemoryEvidence {
    author_kind: AuthorKind1;
    locator: Locator;
    quote_hash: QuoteHash;
    source_id: SourceId;
    source_kind: SourceKind;
    source_version: SourceVersion;
  }
  export interface ScopeRef {
    kind: Kind1;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type MemoryRecordPage = MemoryRecordPageSchema.MemoryRecordPage;

export namespace MemorySourceBoundarySchema {
  export type EventId = string;
  export type RunId = string;

  export interface MemorySourceBoundary {
    event_id: EventId;
    run_id: RunId;
  }

}
export type MemorySourceBoundary = MemorySourceBoundarySchema.MemorySourceBoundary;

export namespace MessagePageSchema {
  export type ActivityId = string | null;
  export type Name = string;
  export type ReadGrantIds = string[];
  export type ResourceId = string;
  export type ResourceLineage = string[];
  export type Attachments = MessageAttachment[];
  export type DeliveryIds = string[];
  export type EventId = string;
  export type EventIndex = number;
  export type Id = string;
  export type Origin = 'conversation' | 'steering' | 'answer' | 'task_result' | 'background_report';
  export type Kind = 'text';
  export type Text = string;
  export type Kind1 = 'reasoning';
  export type Text1 = string;
  export type Arguments =
    | {
        [k: string]: JsonValue;
      }
    | string;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Kind2 = 'tool_call';
  export type Name1 = string;
  export type CallId1 = string;
  export type Error = string | null;
  export type Kind3 = 'tool_result';
  export type OriginMessageId = string | null;
  export type Parts = (TextPart | ReasoningPart | ToolCallPart | ToolResultPart)[];
  export type PrivateRef = string | null;
  export type Role = 'user' | 'assistant' | 'tool';
  export type RunId = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type SourceDependencies = ScopeDependency[];
  export type SourceValid = boolean | null;
  export type ToolOperation = string | null;
  export type Items = MessageView[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface MessagePage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface MessageView {
    activity_id: ActivityId;
    attachments?: Attachments;
    delivery_ids?: DeliveryIds;
    event_id: EventId;
    event_index: EventIndex;
    id: Id;
    origin: Origin;
    parts: Parts;
    private_ref: PrivateRef;
    role: Role;
    run_id: RunId;
    source_dependencies: SourceDependencies;
    source_valid?: SourceValid;
    tool_operation?: ToolOperation;
  }
  export interface MessageAttachment {
    name: Name;
    read_grant_ids: ReadGrantIds;
    resource_id: ResourceId;
    resource_lineage: ResourceLineage;
  }
  export interface TextPart {
    kind: Kind;
    text: Text;
  }
  export interface ReasoningPart {
    kind: Kind1;
    text: Text1;
  }
  export interface ToolCallPart {
    arguments: Arguments;
    call_id: CallId;
    kind: Kind2;
    name: Name1;
  }
  export interface ToolResultPart {
    call_id: CallId1;
    error: Error;
    kind: Kind3;
    origin_message_id: OriginMessageId;
    result: {
      [k: string]: unknown;
    };
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }

}
export type MessagePage = MessagePageSchema.MessagePage;

export namespace MessageReceiptSchema {
  export type MessageId = string;
  export type RunId = string;
  export type Version = number;

  export interface MessageReceipt {
    message_id: MessageId;
    run_id: RunId;
    version: Version;
  }

}
export type MessageReceipt = MessageReceiptSchema.MessageReceipt;

export namespace ModelCandidateListSchema {
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type Vision = boolean | null;
  export type ContextWindowTokens = number | null;
  export type DisplayName = string | null;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number | null;
  export type Kind = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source = string | null;
  export type VerifiedAt = string | null;
  export type Version = string | null;
  export type ModelId = string;
  export type ProviderPresetId = string;
  export type ModelCandidateList = ModelCandidate[];

  export interface ModelCandidate {
    capabilities: ModelCapabilities;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    provider_preset_id: ProviderPresetId;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind;
    note: Note;
    source: Source;
    verified_at: VerifiedAt;
    version: Version;
  }

}
export type ModelCandidateList = ModelCandidateListSchema.ModelCandidateList;

export namespace ModelConnectionSchema {
  export type DisplayName = string;
  export type Endpoint = string;
  export type Id = string;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type SecretRef = string | null;
  export type Version = number;

  export interface ModelConnection {
    display_name: DisplayName;
    endpoint: Endpoint;
    id: Id;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    secret_ref: SecretRef;
    version: Version;
  }

}
export type ModelConnection = ModelConnectionSchema.ModelConnection;

export namespace ModelConnectionPageSchema {
  export type DisplayName = string;
  export type Endpoint = string;
  export type Id = string;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type SecretRef = string | null;
  export type Version = number;
  export type Items = ModelConnection[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface ModelConnectionPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface ModelConnection {
    display_name: DisplayName;
    endpoint: Endpoint;
    id: Id;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    secret_ref: SecretRef;
    version: Version;
  }

}
export type ModelConnectionPage = ModelConnectionPageSchema.ModelConnectionPage;

export namespace ModelDiscoveryResultSchema {
  export type Cached = boolean;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type FetchedAt = string | null;
  export type CanonicalId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type Vision = boolean | null;
  export type ContextWindowTokens = number | null;
  export type DisplayName = string | null;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number | null;
  export type Kind = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source = string | null;
  export type VerifiedAt = string | null;
  export type Version = string | null;
  export type ModelId = string;
  export type Items = DiscoveredModel[];
  export type Message = string;
  export type Status = 'ready' | 'unavailable' | 'authentication_error' | 'error';

  export interface ModelDiscoveryResult {
    cached: Cached;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    fetched_at: FetchedAt;
    items: Items;
    message: Message;
    status: Status;
  }
  export interface DiscoveredModel {
    canonical_id: CanonicalId;
    capabilities: ModelCapabilities;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind;
    note: Note;
    source: Source;
    verified_at: VerifiedAt;
    version: Version;
  }

}
export type ModelDiscoveryResult = ModelDiscoveryResultSchema.ModelDiscoveryResult;

export namespace ModelMessageSchema {
  export type ActivityId = string | null;
  export type Name = string;
  export type ReadGrantIds = string[];
  export type ResourceId = string;
  export type ResourceLineage = string[];
  export type Attachments = MessageAttachment[];
  export type DeliveryIds = string[];
  export type EventId = string;
  export type EventIndex = number;
  export type Id = string;
  export type Origin = 'conversation' | 'steering' | 'answer' | 'task_result' | 'background_report';
  export type Kind = 'text';
  export type Text = string;
  export type Kind1 = 'reasoning';
  export type Text1 = string;
  export type Arguments =
    | {
        [k: string]: JsonValue;
      }
    | string;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Kind2 = 'tool_call';
  export type Name1 = string;
  export type CallId1 = string;
  export type Error = string | null;
  export type Kind3 = 'tool_result';
  export type OriginMessageId = string | null;
  export type Parts = (TextPart | ReasoningPart | ToolCallPart | ToolResultPart)[];
  export type PrivateRef = string | null;
  export type Role = 'user' | 'assistant' | 'tool';
  export type RunId = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type SourceDependencies = ScopeDependency[];
  export type SourceValid = boolean | null;
  export type ToolOperation = string | null;

  export interface ModelMessage {
    activity_id: ActivityId;
    attachments?: Attachments;
    delivery_ids?: DeliveryIds;
    event_id: EventId;
    event_index: EventIndex;
    id: Id;
    origin: Origin;
    parts: Parts;
    private_ref: PrivateRef;
    role: Role;
    run_id: RunId;
    source_dependencies: SourceDependencies;
    source_valid?: SourceValid;
    tool_operation?: ToolOperation;
  }
  export interface MessageAttachment {
    name: Name;
    read_grant_ids: ReadGrantIds;
    resource_id: ResourceId;
    resource_lineage: ResourceLineage;
  }
  export interface TextPart {
    kind: Kind;
    text: Text;
  }
  export interface ReasoningPart {
    kind: Kind1;
    text: Text1;
  }
  export interface ToolCallPart {
    arguments: Arguments;
    call_id: CallId;
    kind: Kind2;
    name: Name1;
  }
  export interface ToolResultPart {
    call_id: CallId1;
    error: Error;
    kind: Kind3;
    origin_message_id: OriginMessageId;
    result: {
      [k: string]: unknown;
    };
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }

}
export type ModelMessage = ModelMessageSchema.ModelMessage;

export namespace ModelProfileSchema {
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ContextWindowTokens = number | null;
  export type DisplayName = string | null;
  export type Id = string;
  export type MaxOutputTokens = number;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type RequestTimeoutSeconds = number;
  export type Version = number;

  export interface ModelProfile {
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName;
    id: Id;
    max_output_tokens: MaxOutputTokens;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    request_timeout_seconds: RequestTimeoutSeconds;
    version: Version;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
    vision: Vision;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }

}
export type ModelProfile = ModelProfileSchema.ModelProfile;

export namespace ModelProfilePageSchema {
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ContextWindowTokens = number | null;
  export type DisplayName = string | null;
  export type Id = string;
  export type MaxOutputTokens = number;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type RequestTimeoutSeconds = number;
  export type Version = number;
  export type Items = ModelProfile[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface ModelProfilePage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface ModelProfile {
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName;
    id: Id;
    max_output_tokens: MaxOutputTokens;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    request_timeout_seconds: RequestTimeoutSeconds;
    version: Version;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
    vision: Vision;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }

}
export type ModelProfilePage = ModelProfilePageSchema.ModelProfilePage;

export namespace ModelResolutionSchema {
  export type Blockers = string[];
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number | null;
  export type DisplayName = string | null;
  export type Endpoint = string;
  export type Id = string;
  export type LocalContextBudgetTokens = number;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source = string | null;
  export type VerifiedAt = string | null;
  export type Version = string | null;
  export type ModelId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source1 = string;
  export type Variants = PriceVariant[];
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type PricingUnknownReason = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version1 = number;

  /**
   * 预览允许有效容量缺失或输出超过容量，由blockers说明，不能充当Run快照。
   */
  export interface ModelResolution {
    blockers: Blockers;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName;
    endpoint: Endpoint;
    id: Id;
    local_context_budget_tokens: LocalContextBudgetTokens;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    model_pricing: PricingSnapshot | null;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    pricing_unknown_reason: PricingUnknownReason;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version1;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind;
    note: Note;
    source: Source;
    verified_at: VerifiedAt;
    version: Version;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source1;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }

}
export type ModelResolution = ModelResolutionSchema.ModelResolution;

export namespace NavigationViewSchema {
  export type DefaultWorkspaceId = string | null;
  export type PendingCount = number;
  export type AgentProfileId = string;
  export type Archived = boolean;
  export type AutomaticTitle = 'pending' | number | null;
  export type Id = string;
  export type Kind = 'interaction' | 'execution';
  export type Title = string;
  export type Version = number;
  export type WorkspaceId = string;
  export type Items = Session[];
  export type NextCursor = string | null;
  export type Watermark = string;
  export type Watermark1 = string;
  export type PendingCount1 = number;
  export type DirectoryResourceId = string | null;
  export type Id1 = string;
  export type Name = string;
  export type Version1 = number;
  export type Items1 = WorkspaceNavigation[];
  export type NextCursor1 = string | null;
  export type Watermark2 = string;

  export interface NavigationView {
    default_workspace_id: DefaultWorkspaceId;
    pending_count: PendingCount;
    recent_sessions: PageSession;
    watermark: Watermark1;
    workspaces: PageWorkspaceNavigation;
  }
  export interface PageSession {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface Session {
    agent_profile_id: AgentProfileId;
    archived: Archived;
    automatic_title?: AutomaticTitle;
    id: Id;
    kind: Kind;
    title: Title;
    version: Version;
    workspace_id: WorkspaceId;
  }
  export interface PageWorkspaceNavigation {
    items: Items1;
    next_cursor: NextCursor1;
    watermark: Watermark2;
  }
  export interface WorkspaceNavigation {
    pending_count: PendingCount1;
    sessions: PageSession;
    workspace: Workspace;
  }
  export interface Workspace {
    directory_resource_id: DirectoryResourceId;
    id: Id1;
    name: Name;
    version: Version1;
  }

}
export type NavigationView = NavigationViewSchema.NavigationView;

export namespace PendingActionSchema {
  export type ExpectedVersion = number | null;
  export type Kind = 'view_task' | 'resume' | 'cancel_run' | 'retry_delivery' | 'inspect_export_recovery';
  export type TargetId = string;
  export type AllowedActions = PendingActionCommand[];
  export type Id = string;
  export type Kind1 = 'recovery' | 'blocked' | 'delivery_failed';
  export type Reason = string;
  export type RunId = string;
  export type SessionId = string | null;
  export type SessionTitle = string | null;
  export type TaskGoal = string | null;
  export type TaskId = string;
  export type Version = number;
  export type WorkspaceId = string;
  export type WorkspaceName = string | null;

  export interface PendingAction {
    allowed_actions: AllowedActions;
    id: Id;
    kind: Kind1;
    reason: Reason;
    run_id: RunId;
    session_id: SessionId;
    session_title?: SessionTitle;
    task_goal?: TaskGoal;
    task_id: TaskId;
    version: Version;
    workspace_id: WorkspaceId;
    workspace_name?: WorkspaceName;
  }
  export interface PendingActionCommand {
    expected_version: ExpectedVersion;
    kind: Kind;
    target_id: TargetId;
  }

}
export type PendingAction = PendingActionSchema.PendingAction;

export namespace PendingUserCommandSchema {
  export type CommandId = string;
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type CreatedSeq = number;
  export type DeadlineAt = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type SourceVersion = string;
  export type Dependencies = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;
  export type InboxEntryId = string;
  export type ResultVersion = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;
  export type Reason = string | null;
  export type RunId1 = string | null;
  export type ScopeDependencies = ScopeDependency[];
  export type SessionId = string;
  export type AgentProfileId = string;
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type InheritSessionFiles = boolean;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelProfileId = string;
  export type ConnectionId1 = string;
  export type ConnectionVersion1 = number;
  export type ModelVersion = number;
  export type ReasoningEffort1 = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type SessionId1 = string;
  export type SourceResult = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind1 = 'user_global' | 'workspace' | 'session';
  export type SessionId2 = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type Text = string;
  export type State = 'queued' | 'applied' | 'cancelled';

  export interface PendingUserCommand {
    admission_generations: AdmissionGenerations;
    command_id: CommandId;
    config: ConfigSnapshot;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    file_inputs: FileInputs;
    input_result: ResultInput | null;
    reason: Reason;
    run_id: RunId1;
    scope_dependencies: ScopeDependencies;
    session_file_predecessors?: SessionFilePredecessors;
    session_id: SessionId;
    start: StartRun;
    state: State;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface ResultInput {
    dependencies: Dependencies;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId;
    result_version: ResultVersion;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }
  export interface SessionFilePredecessors {
    /**
     * This interface was referenced by `SessionFilePredecessors`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface StartRun {
    agent_profile_id: AgentProfileId;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    inherit_session_files?: InheritSessionFiles;
    limits: RunLimits;
    model_profile_id: ModelProfileId;
    model_selection?: ModelSelection | null;
    reasoning_effort?: ReasoningEffort1;
    session_file_adoptions?: SessionFileAdoptions;
    session_id: SessionId1;
    source_result: SourceResult;
    sources: SourceSelection;
    text: Text;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_delegation_depth: MaxDelegationDepth;
    max_model_requests: MaxModelRequests;
    max_parallel_agents: MaxParallelAgents;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
    max_total_tokens: MaxTotalTokens;
  }
  export interface ModelSelection {
    connection_id: ConnectionId1;
    connection_version: ConnectionVersion1;
    model_version: ModelVersion;
  }
  export interface SessionFileAdoptions {
    /**
     * This interface was referenced by `SessionFileAdoptions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind1;
    session_id: SessionId2;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type PendingUserCommand = PendingUserCommandSchema.PendingUserCommand;

export namespace PendingUserCommandPageSchema {
  export type CommandId = string;
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type CreatedSeq = number;
  export type DeadlineAt = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type SourceVersion = string;
  export type Dependencies = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;
  export type InboxEntryId = string;
  export type ResultVersion = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;
  export type Reason = string | null;
  export type RunId1 = string | null;
  export type ScopeDependencies = ScopeDependency[];
  export type SessionId = string;
  export type AgentProfileId = string;
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type InheritSessionFiles = boolean;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelProfileId = string;
  export type ConnectionId1 = string;
  export type ConnectionVersion1 = number;
  export type ModelVersion = number;
  export type ReasoningEffort1 = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type SessionId1 = string;
  export type SourceResult = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind1 = 'user_global' | 'workspace' | 'session';
  export type SessionId2 = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type Text = string;
  export type State = 'queued' | 'applied' | 'cancelled';
  export type Items = PendingUserCommand[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface PendingUserCommandPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface PendingUserCommand {
    admission_generations: AdmissionGenerations;
    command_id: CommandId;
    config: ConfigSnapshot;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    file_inputs: FileInputs;
    input_result: ResultInput | null;
    reason: Reason;
    run_id: RunId1;
    scope_dependencies: ScopeDependencies;
    session_file_predecessors?: SessionFilePredecessors;
    session_id: SessionId;
    start: StartRun;
    state: State;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface ResultInput {
    dependencies: Dependencies;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId;
    result_version: ResultVersion;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }
  export interface SessionFilePredecessors {
    /**
     * This interface was referenced by `SessionFilePredecessors`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface StartRun {
    agent_profile_id: AgentProfileId;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    inherit_session_files?: InheritSessionFiles;
    limits: RunLimits;
    model_profile_id: ModelProfileId;
    model_selection?: ModelSelection | null;
    reasoning_effort?: ReasoningEffort1;
    session_file_adoptions?: SessionFileAdoptions;
    session_id: SessionId1;
    source_result: SourceResult;
    sources: SourceSelection;
    text: Text;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_delegation_depth: MaxDelegationDepth;
    max_model_requests: MaxModelRequests;
    max_parallel_agents: MaxParallelAgents;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
    max_total_tokens: MaxTotalTokens;
  }
  export interface ModelSelection {
    connection_id: ConnectionId1;
    connection_version: ConnectionVersion1;
    model_version: ModelVersion;
  }
  export interface SessionFileAdoptions {
    /**
     * This interface was referenced by `SessionFileAdoptions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind1;
    session_id: SessionId2;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type PendingUserCommandPage = PendingUserCommandPageSchema.PendingUserCommandPage;

export namespace ProviderPresetListSchema {
  export type AuthMode = 'api_key';
  export type DefaultEndpoint = string;
  export type DisplayName = string;
  export type Id = string;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type SourceUrl = string;
  export type SourceVersion = string;
  export type VerifiedAt = string;
  export type ProviderPresetList = ProviderPreset[];

  export interface ProviderPreset {
    auth_mode: AuthMode;
    default_endpoint: DefaultEndpoint;
    display_name: DisplayName;
    id: Id;
    protocol: Protocol;
    source_url: SourceUrl;
    source_version: SourceVersion;
    verified_at: VerifiedAt;
  }

}
export type ProviderPresetList = ProviderPresetListSchema.ProviderPresetList;

export namespace PublicEventSchema {
  export type PublicEvent =
    | WorkspaceEvent
    | SessionEvent
    | AgentEvent
    | ModelProfileEvent
    | ModelConnectionEvent
    | ExecutionEvent
    | PolicyEvent
    | LifecycleEvent
    | DeliveryEvent
    | AdmissionEvent
    | MemoryEvent
    | MemoryMaintenanceEvent
    | SkillEvent
    | EnvironmentEvent
    | McpEvent
    | TitlePolicyEvent;
  export type ActivityId = string | null;
  export type CausationId = string | null;
  export type CreatedAt = string;
  export type EventId = string;
  export type EventVersion = 1;
  export type Kind =
    'workspace.created' | 'workspace.default_created' | 'workspace.directory_changed' | 'workspace.renamed';
  export type DirectoryResourceId = string | null;
  export type Id = string;
  export type Name = string;
  export type Version = number;
  export type RunId = string | null;
  export type Seq = number | null;
  export type SessionId = string | null;
  export type TaskId = string | null;
  export type WorkspaceId = string | null;
  export type ActivityId1 = string | null;
  export type CausationId1 = string | null;
  export type CreatedAt1 = string;
  export type EventId1 = string;
  export type EventVersion1 = 1;
  export type Kind1 = 'session.created' | 'session.updated';
  export type AgentProfileId = string;
  export type Archived = boolean;
  export type AutomaticTitle = 'pending' | number | null;
  export type Id1 = string;
  export type Kind2 = 'interaction' | 'execution';
  export type Title = string;
  export type Version1 = number;
  export type WorkspaceId1 = string;
  export type RunId1 = string | null;
  export type Seq1 = number | null;
  export type SessionId1 = string | null;
  export type TaskId1 = string | null;
  export type WorkspaceId2 = string | null;
  export type ActivityId2 = string | null;
  export type CausationId2 = string | null;
  export type CreatedAt2 = string;
  export type EventId2 = string;
  export type EventVersion2 = 1;
  export type Kind3 = 'agent.saved';
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id2 = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version2 = number;
  export type SetDefault = boolean;
  export type RunId2 = string | null;
  export type Seq2 = number | null;
  export type SessionId2 = string | null;
  export type TaskId2 = string | null;
  export type WorkspaceId3 = string | null;
  export type ActivityId3 = string | null;
  export type CausationId3 = string | null;
  export type CreatedAt3 = string;
  export type EventId3 = string;
  export type EventVersion3 = 1;
  export type Kind4 = 'model.saved';
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ContextWindowTokens = number | null;
  export type DisplayName1 = string | null;
  export type Id3 = string;
  export type MaxOutputTokens = number;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type RequestTimeoutSeconds = number;
  export type Version3 = number;
  export type RunId3 = string | null;
  export type Seq3 = number | null;
  export type SessionId3 = string | null;
  export type TaskId3 = string | null;
  export type WorkspaceId4 = string | null;
  export type ActivityId4 = string | null;
  export type CausationId4 = string | null;
  export type CreatedAt4 = string;
  export type EventId4 = string;
  export type EventVersion4 = 1;
  export type Kind5 = 'connection.saved';
  export type DisplayName2 = string;
  export type Endpoint = string;
  export type Id4 = string;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type SecretRef = string | null;
  export type Version4 = number;
  export type RunId4 = string | null;
  export type Seq4 = number | null;
  export type SessionId4 = string | null;
  export type TaskId4 = string | null;
  export type WorkspaceId5 = string | null;
  export type ActivityId5 = string | null;
  export type CausationId5 = string | null;
  export type CreatedAt5 = string;
  export type EventId5 = string;
  export type EventVersion5 = 1;
  export type Kind6 =
    | 'run.started'
    | 'run.cancelled'
    | 'run.resumed'
    | 'run.steered'
    | 'task.stepped'
    | 'activity.prepared'
    | 'activity.dispatched'
    | 'activity.received'
    | 'budget.reserved'
    | 'budget.settled'
    | 'budget.allocated'
    | 'budget.counted'
    | 'budget.returned'
    | 'runtime.recovered'
    | 'artifact.published'
    | 'question.asked'
    | 'question.answered'
    | 'task.submitted'
    | 'task.cancelled'
    | 'task.consumed'
    | 'task.joined'
    | 'wait.registered'
    | 'wait.resolved'
    | 'follow_up.changed'
    | 'command.queued'
    | 'command.applied'
    | 'command.cancelled'
    | 'run.yielded'
    | 'naming.task_changed';
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id5 = string;
  export type Kind7 = 'model' | 'tool';
  export type Operation = string;
  export type RunId5 = string;
  export type AttemptId = string;
  export type CollectionError = string | null;
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type ExitCode = number | null;
  export type ExternalCosts = 'unknown';
  export type ActivityId6 = string;
  export type ContentHash1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id6 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId5 = string;
  export type Version5 = number;
  export type RelativePath = string;
  export type Outputs = ScriptArtifact[];
  export type ScriptRelativePath = string;
  export type SkillId = string;
  export type TerminationReason = 'exited' | 'cancelled' | 'timed_out';
  export type Truncated = boolean;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId6 = string;
  export type CacheReadReported = true | null;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version6 = number;
  export type Activities = ActivityView[];
  export type Artifacts = ArtifactRef[];
  export type Id7 = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelRequests = number;
  export type ReservedTokens = number;
  export type ReservedUnits = string;
  export type RunId6 = string;
  export type SpentUnits = string;
  export type Steps = number;
  export type TaskCount = number;
  export type TotalTokens = number;
  export type Version7 = number;
  export type Budgets = BudgetSnapshot[];
  export type EventId6 = string;
  export type ModelProfileId = string;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type SessionId5 = string;
  export type ExecutionSessionId = string;
  export type Id8 = string;
  export type InboxEntryId = string | null;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId7 = string;
  export type TargetTaskId = string;
  export type TaskId7 = string;
  export type Consumptions = ResultConsumption[];
  export type BudgetGroupId = string;
  export type Id9 = string;
  export type OriginRunId = string;
  export type PausedTaskIds = string[];
  export type PolicyVersion = number;
  export type Reason = string | null;
  export type RunId8 = string | null;
  export type SourceResult = string;
  export type Status1 = 'ready' | 'active' | 'paused' | 'closed';
  export type TargetSessionId = string;
  export type FollowUpIntents = FollowUpIntent[];
  export type ChildResultVersion = number;
  export type ChildTaskId = string;
  export type EventId7 = string;
  export type Id10 = string;
  export type RootTaskId = string;
  export type RunId9 = string;
  export type Joins = JoinFact[];
  export type MessageWatermark = string | null;
  export type ActivityId7 = string | null;
  export type Name1 = string;
  export type ReadGrantIds = string[];
  export type ResourceId = string;
  export type ResourceLineage = string[];
  export type Attachments = MessageAttachment[];
  export type DeliveryIds = string[];
  export type EventId8 = string;
  export type EventIndex = number;
  export type Id11 = string;
  export type Origin = 'conversation' | 'steering' | 'answer' | 'task_result' | 'background_report';
  export type Kind8 = 'text';
  export type Text = string;
  export type Kind9 = 'reasoning';
  export type Text1 = string;
  export type Arguments =
    | {
        [k: string]: JsonValue;
      }
    | string;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Kind10 = 'tool_call';
  export type Name2 = string;
  export type CallId1 = string;
  export type Error1 = string | null;
  export type Kind11 = 'tool_result';
  export type OriginMessageId = string | null;
  export type Parts = (TextPart | ReasoningPart | ToolCallPart | ToolResultPart)[];
  export type PrivateRef = string | null;
  export type Role = 'user' | 'assistant' | 'tool';
  export type RunId10 = string;
  export type SourceDependencies = ScopeDependency[];
  export type SourceValid = boolean | null;
  export type ToolOperation = string | null;
  export type Messages = MessageView[];
  export type CommandId = string;
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency1 = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source1 = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ConnectionId1 = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens1 = number;
  export type DisplayName3 = string | null;
  export type Endpoint1 = string;
  export type Id12 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens1 = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind12 = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source2 = string | null;
  export type VerifiedAt = string | null;
  export type Version8 = string | null;
  export type ModelId2 = string;
  export type OpenaiMaxTokensField1 = ('max_tokens' | 'max_completion_tokens') | null;
  export type Protocol1 = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId1 = string | null;
  export type ReasoningEffort1 = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds1 = number;
  export type SecretRef1 = string | null;
  export type Version9 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type CreatedSeq = number;
  export type DeadlineAt = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type SourceVersion = string;
  export type Dependencies2 = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId11 = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId8 = string;
  export type InboxEntryId1 = string;
  export type ResultVersion1 = number;
  export type SourceEventId = string;
  export type TargetSessionId1 = string;
  export type Reason1 = string | null;
  export type RunId12 = string | null;
  export type ScopeDependencies = ScopeDependency[];
  export type SessionId6 = string;
  export type AgentProfileId1 = string;
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type InheritSessionFiles = boolean;
  export type ModelProfileId1 = string;
  export type ConnectionId2 = string;
  export type ConnectionVersion1 = number;
  export type ModelVersion = number;
  export type ReasoningEffort2 = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type SessionId7 = string;
  export type SourceResult1 = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind13 = 'user_global' | 'workspace' | 'session';
  export type SessionId8 = string | null;
  export type WorkspaceId6 = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type Text2 = string;
  export type State1 = 'queued' | 'applied' | 'cancelled';
  export type PendingCommands = PendingUserCommand[];
  export type AnswerMessageId = string | null;
  export type CallId2 = string;
  export type Dependencies3 = ScopeDependency[];
  export type Id13 = string;
  export type MessageId = string;
  export type Question1 = string;
  export type RunId13 = string;
  export type Status2 = 'pending' | 'answered' | 'cancelled';
  export type TaskId9 = string;
  export type Version10 = number;
  export type Questions = Question[];
  export type AllowFollowUp1 = boolean;
  export type AllowManaged1 = boolean;
  export type AttachedFileIds = string[] | null;
  export type BudgetGroupId1 = string;
  export type BudgetId = string;
  export type DeadlineAt1 = string;
  export type ExecutionSessionId1 = string;
  export type FollowUpClosed = boolean;
  export type Id14 = string;
  export type InteractionSessionId = string | null;
  export type Kind14 = 'user' | 'managed' | 'follow_up' | 'maintenance';
  export type Output = AgentResult | RunOutput | null;
  export type ArtifactIds = string[];
  export type EvidenceRefs = string[];
  export type Reason2 = string;
  export type ResultVersion2 = number;
  export type TaskId10 = string;
  export type HandledFailures = FailureDisposition[];
  export type Status3 = 'completed' | 'partial' | 'failed';
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Verification = string[];
  export type ArtifactIds1 = string[];
  export type HandledFailures1 = FailureDisposition[];
  export type Summary1 = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved1 = string[];
  export type Reason3 = string | null;
  export type RootTaskId1 = string;
  export type ScopeDependencies1 = ScopeDependency[];
  export type State2 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version11 = number;
  export type VisionSourceRunId = string | null;
  export type WorkspaceId7 = string;
  export type YieldRequested = boolean;
  export type Runs = RunSnapshot[];
  export type AdditionalResultInputs = ResultInput[];
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind15 = 'agent';
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type DelegationDepth = number;
  export type ExecutionSessionId2 = string;
  export type InputArtifacts = ArtifactRef[];
  export type InteractionSessionId1 = string | null;
  export type CreatedSeq1 = number;
  export type DeadlineAt2 = string | null;
  export type ExecutorId = string;
  export type Id15 = string;
  export type Kind16 = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason4 = string | null;
  export type ResultVersion3 = number | null;
  export type RunId14 = string;
  export type State3 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version12 = number;
  export type Tasks = TaskSnapshot[];
  export type ContinuationId = string;
  export type DeadlineAt3 = string | null;
  export type Id16 = string;
  export type OwnerTaskId = string;
  export type ResultVersion4 = number | null;
  export type RunId15 = string;
  export type State4 = 'pending' | 'ready' | 'timeout' | 'cancelled';
  export type TargetTaskId1 = string;
  export type Version13 = number;
  export type Waits = WaitRecord[];
  export type RunId16 = string | null;
  export type Seq5 = number | null;
  export type SessionId9 = string | null;
  export type TaskId11 = string | null;
  export type WorkspaceId8 = string | null;
  export type ActivityId8 = string | null;
  export type CausationId6 = string | null;
  export type CreatedAt6 = string;
  export type EventId9 = string;
  export type EventVersion6 = 1;
  export type Kind17 =
    | 'resource.registered'
    | 'resource.updated'
    | 'grant.created'
    | 'grant.revoked'
    | 'approval.proposed'
    | 'approval.decided';
  export type ActivityId9 = string;
  export type ArgsHash = string;
  export type CallId3 = string;
  export type Dependencies4 = ScopeDependency[];
  export type ExpiresAt = string;
  export type ArtifactId = string;
  export type ArtifactVersion = number;
  export type TargetExists = boolean;
  export type TargetPath = string;
  export type Id17 = string;
  export type RunId17 = string;
  export type SessionId10 = string | null;
  export type Status4 = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
  export type Target = string | null;
  export type TaskId12 = string;
  export type ToolName = string;
  export type ToolVersion = string;
  export type Version14 = number;
  export type WorkspaceId9 = string;
  export type Approvals = Approval[];
  export type Destination1 = string | null;
  export type Epoch1 = number;
  export type Id18 = string;
  export type McpQueries = McpToolSnapshot[];
  export type MemoryScopes1 = ScopeRef[];
  /**
   * @minItems 1
   */
  export type Purposes = [
    'read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send',
    ...('read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send')[]
  ];
  export type ResourceIds1 = string[];
  export type Status5 = 'active' | 'revoked';
  export type Version15 = number;
  export type Grants = DataUseGrant[];
  export type Id19 = string;
  export type Kind18 = 'file' | 'directory' | 'export';
  export type Label = string;
  export type SourceVersion1 = string | null;
  export type Version16 = number;
  export type Resources = ResourceRef[];
  export type RunId18 = string | null;
  export type Seq6 = number | null;
  export type SessionId11 = string | null;
  export type TaskId13 = string | null;
  export type WorkspaceId10 = string | null;
  export type ActivityId10 = string | null;
  export type CausationId7 = string | null;
  export type CreatedAt7 = string;
  export type EventId10 = string;
  export type EventVersion7 = 1;
  export type Kind19 = 'scope.deleted' | 'scope.revoked' | 'accounting.settled';
  export type Epoch2 = number;
  export type Status6 = 'deleted';
  export type Deletions = DeletionReceipt[];
  export type Epoch3 = number;
  export type Id20 = string;
  export type Status7 = 'active' | 'revoked' | 'deleted';
  export type Scopes = ScopeState[];
  export type RunId19 = string | null;
  export type Seq7 = number | null;
  export type SessionId12 = string | null;
  export type TaskId14 = string | null;
  export type WorkspaceId11 = string | null;
  export type ActivityId11 = string | null;
  export type CausationId8 = string | null;
  export type CreatedAt8 = string;
  export type EventId11 = string;
  export type EventVersion8 = 1;
  export type Kind20 = 'delivery.changed';
  export type AssistantName = string | null;
  export type Attempts = number;
  export type Consumers = ResultConsumption[];
  export type DeliveryState = 'pending' | 'delivered' | 'failed' | 'invalidated';
  export type Dependencies5 = ScopeDependency[];
  export type Id21 = string;
  export type LastError = string | null;
  export type ResultVersion5 = number;
  export type SourceEventId1 = string;
  export type SourceValid1 = boolean;
  export type TargetSessionId2 = string;
  export type TaskName = string | null;
  export type Version17 = number;
  export type ViewedAt = string | null;
  export type Deliveries = SessionInboxEntry[];
  export type RunId20 = string | null;
  export type Seq8 = number | null;
  export type SessionId13 = string | null;
  export type TaskId15 = string | null;
  export type WorkspaceId12 = string | null;
  export type ActivityId12 = string | null;
  export type CausationId9 = string | null;
  export type CreatedAt9 = string;
  export type EventId12 = string;
  export type EventVersion9 = 1;
  export type Kind21 = 'admission.stopped';
  export type Generation = number;
  export type AdmissionFences = AdmissionFence[];
  export type RunId21 = string | null;
  export type Seq9 = number | null;
  export type SessionId14 = string | null;
  export type TaskId16 = string | null;
  export type WorkspaceId13 = string | null;
  export type ActivityId13 = string | null;
  export type CausationId10 = string | null;
  export type CreatedAt10 = string;
  export type EventId13 = string;
  export type EventVersion10 = 1;
  export type Kind22 = 'memory.changed' | 'memory.policy_changed';
  export type AutoOrganize = boolean;
  export type ModelProfileId2 = string | null;
  export type ReadProfile = boolean;
  export type Version18 = number;
  export type Policies = MemoryPolicy[];
  export type Id22 = string;
  export type Revision = number;
  export type Status8 = 'candidate' | 'confirmed' | 'rejected' | 'deleted';
  export type Records = MemoryNotice[];
  export type RunId22 = string | null;
  export type Seq10 = number | null;
  export type SessionId15 = string | null;
  export type TaskId17 = string | null;
  export type WorkspaceId14 = string | null;
  export type ActivityId14 = string | null;
  export type CausationId11 = string | null;
  export type CreatedAt11 = string;
  export type EventId14 = string;
  export type EventVersion11 = 1;
  export type Kind23 = 'memory.maintenance_changed';
  export type Id23 = string;
  export type PolicyVersion1 = number;
  export type Reason5 = string | null;
  export type EventId15 = string;
  export type RunId23 = string;
  export type RunId24 = string | null;
  export type Seq11 = number | null;
  export type SessionId16 = string | null;
  export type TaskId18 = string | null;
  export type WorkspaceId15 = string | null;
  export type ActivityId15 = string | null;
  export type CausationId12 = string | null;
  export type CreatedAt12 = string;
  export type EventId16 = string;
  export type EventVersion12 = 1;
  export type Kind24 = 'skill.changed';
  export type Revision1 = number;
  export type SkillId1 = string;
  export type Status9 = 'active' | 'deleted';
  export type RunId25 = string | null;
  export type Seq12 = number | null;
  export type SessionId17 = string | null;
  export type TaskId19 = string | null;
  export type WorkspaceId16 = string | null;
  export type ActivityId16 = string | null;
  export type CausationId13 = string | null;
  export type CreatedAt13 = string;
  export type EventId17 = string;
  export type EventVersion13 = 1;
  export type Kind25 = 'environment.changed';
  export type EnvironmentId1 = string;
  export type RunId26 = string | null;
  export type Seq13 = number | null;
  export type SessionId18 = string | null;
  export type TaskId20 = string | null;
  export type WorkspaceId17 = string | null;
  export type ActivityId17 = string | null;
  export type CausationId14 = string | null;
  export type CreatedAt14 = string;
  export type EventId18 = string;
  export type EventVersion14 = 1;
  export type Kind26 = 'mcp.changed';
  export type ConfigRevision1 = number;
  export type ServerId1 = string;
  export type RunId27 = string | null;
  export type Seq14 = number | null;
  export type SessionId19 = string | null;
  export type TaskId21 = string | null;
  export type WorkspaceId18 = string | null;
  export type ActivityId18 = string | null;
  export type CausationId15 = string | null;
  export type CreatedAt15 = string;
  export type EventId19 = string;
  export type EventVersion15 = 1;
  export type Kind27 = 'naming.policy_saved';
  export type ConnectionVersion2 = number;
  export type Endpoint2 = string;
  export type MaxCostUnits1 = string | null;
  export type MaxRequests = number;
  export type MaxTokens = number;
  export type ModelProfileId3 = string;
  export type ModelVersion1 = number;
  export type Version19 = number | null;
  export type WorkspaceId19 = string;
  export type RunId28 = string | null;
  export type Seq15 = number | null;
  export type SessionId20 = string | null;
  export type TaskId22 = string | null;
  export type WorkspaceId20 = string | null;

  export interface WorkspaceEvent {
    activity_id: ActivityId;
    causation_id: CausationId;
    created_at: CreatedAt;
    event_id: EventId;
    event_version: EventVersion;
    kind: Kind;
    payload: Workspace;
    run_id: RunId;
    seq: Seq;
    session_id: SessionId;
    task_id: TaskId;
    workspace_id: WorkspaceId;
  }
  export interface Workspace {
    directory_resource_id: DirectoryResourceId;
    id: Id;
    name: Name;
    version: Version;
  }
  export interface SessionEvent {
    activity_id: ActivityId1;
    causation_id: CausationId1;
    created_at: CreatedAt1;
    event_id: EventId1;
    event_version: EventVersion1;
    kind: Kind1;
    payload: Session;
    run_id: RunId1;
    seq: Seq1;
    session_id: SessionId1;
    task_id: TaskId1;
    workspace_id: WorkspaceId2;
  }
  export interface Session {
    agent_profile_id: AgentProfileId;
    archived: Archived;
    automatic_title?: AutomaticTitle;
    id: Id1;
    kind: Kind2;
    title: Title;
    version: Version1;
    workspace_id: WorkspaceId1;
  }
  export interface AgentEvent {
    activity_id: ActivityId2;
    causation_id: CausationId2;
    created_at: CreatedAt2;
    event_id: EventId2;
    event_version: EventVersion2;
    kind: Kind3;
    payload: AgentSaved;
    run_id: RunId2;
    seq: Seq2;
    session_id: SessionId2;
    task_id: TaskId2;
    workspace_id: WorkspaceId3;
  }
  export interface AgentSaved {
    profile: AgentProfile;
    set_default: SetDefault;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id2;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version2;
  }
  export interface ModelProfileEvent {
    activity_id: ActivityId3;
    causation_id: CausationId3;
    created_at: CreatedAt3;
    event_id: EventId3;
    event_version: EventVersion3;
    kind: Kind4;
    payload: ModelProfile;
    run_id: RunId3;
    seq: Seq3;
    session_id: SessionId3;
    task_id: TaskId3;
    workspace_id: WorkspaceId4;
  }
  export interface ModelProfile {
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    id: Id3;
    max_output_tokens: MaxOutputTokens;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    request_timeout_seconds: RequestTimeoutSeconds;
    version: Version3;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
    vision: Vision;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface ModelConnectionEvent {
    activity_id: ActivityId4;
    causation_id: CausationId4;
    created_at: CreatedAt4;
    event_id: EventId4;
    event_version: EventVersion4;
    kind: Kind5;
    payload: ModelConnection;
    run_id: RunId4;
    seq: Seq4;
    session_id: SessionId4;
    task_id: TaskId4;
    workspace_id: WorkspaceId5;
  }
  export interface ModelConnection {
    display_name: DisplayName2;
    endpoint: Endpoint;
    id: Id4;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    secret_ref: SecretRef;
    version: Version4;
  }
  export interface ExecutionEvent {
    activity_id: ActivityId5;
    causation_id: CausationId5;
    created_at: CreatedAt5;
    event_id: EventId5;
    event_version: EventVersion5;
    kind: Kind6;
    payload: PublicChange;
    run_id: RunId16;
    seq: Seq5;
    session_id: SessionId9;
    task_id: TaskId11;
    workspace_id: WorkspaceId8;
  }
  export interface PublicChange {
    activities: Activities;
    artifacts: Artifacts;
    budgets: Budgets;
    chat_model_use?: ChatModelUse | null;
    consumptions: Consumptions;
    follow_up_intents: FollowUpIntents;
    joins: Joins;
    message_watermark?: MessageWatermark;
    messages: Messages;
    pending_commands: PendingCommands;
    questions: Questions;
    runs: Runs;
    tasks: Tasks;
    waits: Waits;
  }
  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id5;
    kind: Kind7;
    operation: Operation;
    run_id: RunId5;
    script_execution: ScriptExecutionSummary | null;
    state: State;
    task_id: TaskId6;
    usage: Usage | null;
    version: Version6;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。
   */
  export interface ScriptExecutionSummary {
    attempt_id: AttemptId;
    collection_error: CollectionError;
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    exit_code: ExitCode;
    external_costs: ExternalCosts;
    outputs: Outputs;
    script_relative_path: ScriptRelativePath;
    skill_id: SkillId;
    termination_reason: TerminationReason;
    truncated: Truncated;
  }
  export interface ScriptArtifact {
    artifact: ArtifactRef;
    relative_path: RelativePath;
  }
  export interface ArtifactRef {
    activity_id: ActivityId6;
    content_hash: ContentHash1;
    dependencies: Dependencies1;
    id: Id6;
    media_type: MediaType;
    task_id: TaskId5;
    version: Version5;
  }
  export interface Usage {
    cache_read_reported?: CacheReadReported;
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }
  export interface BudgetSnapshot {
    id: Id7;
    limits: RunLimits;
    model_requests: ModelRequests;
    reserved_tokens: ReservedTokens;
    reserved_units: ReservedUnits;
    run_id: RunId6;
    spent_units: SpentUnits;
    steps: Steps;
    task_count: TaskCount;
    total_tokens: TotalTokens;
    version: Version7;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_delegation_depth: MaxDelegationDepth;
    max_model_requests: MaxModelRequests;
    max_parallel_agents: MaxParallelAgents;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
    max_total_tokens: MaxTotalTokens;
  }
  export interface ChatModelUse {
    event_id: EventId6;
    model_profile_id: ModelProfileId;
    reasoning_effort: ReasoningEffort;
    session_id: SessionId5;
  }
  export interface ResultConsumption {
    execution_session_id: ExecutionSessionId;
    id: Id8;
    inbox_entry_id: InboxEntryId;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId7;
    target_task_id: TargetTaskId;
    task_id: TaskId7;
  }
  export interface FollowUpIntent {
    budget_group_id: BudgetGroupId;
    id: Id9;
    origin_run_id: OriginRunId;
    paused_task_ids: PausedTaskIds;
    policy_version: PolicyVersion;
    reason: Reason;
    run_id: RunId8;
    source_result: SourceResult;
    status: Status1;
    target_session_id: TargetSessionId;
  }
  export interface JoinFact {
    child_result_version: ChildResultVersion;
    child_task_id: ChildTaskId;
    event_id: EventId7;
    id: Id10;
    root_task_id: RootTaskId;
    run_id: RunId9;
  }
  export interface MessageView {
    activity_id: ActivityId7;
    attachments?: Attachments;
    delivery_ids?: DeliveryIds;
    event_id: EventId8;
    event_index: EventIndex;
    id: Id11;
    origin: Origin;
    parts: Parts;
    private_ref: PrivateRef;
    role: Role;
    run_id: RunId10;
    source_dependencies: SourceDependencies;
    source_valid?: SourceValid;
    tool_operation?: ToolOperation;
  }
  export interface MessageAttachment {
    name: Name1;
    read_grant_ids: ReadGrantIds;
    resource_id: ResourceId;
    resource_lineage: ResourceLineage;
  }
  export interface TextPart {
    kind: Kind8;
    text: Text;
  }
  export interface ReasoningPart {
    kind: Kind9;
    text: Text1;
  }
  export interface ToolCallPart {
    arguments: Arguments;
    call_id: CallId;
    kind: Kind10;
    name: Name2;
  }
  export interface ToolResultPart {
    call_id: CallId1;
    error: Error1;
    kind: Kind11;
    origin_message_id: OriginMessageId;
    result: {
      [k: string]: unknown;
    };
  }
  export interface PendingUserCommand {
    admission_generations: AdmissionGenerations;
    command_id: CommandId;
    config: ConfigSnapshot;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    file_inputs: FileInputs;
    input_result: ResultInput | null;
    reason: Reason1;
    run_id: RunId12;
    scope_dependencies: ScopeDependencies;
    session_file_predecessors?: SessionFilePredecessors;
    session_id: SessionId6;
    start: StartRun;
    state: State1;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools1;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools1 {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency1;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source1;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId1;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens1;
    display_name: DisplayName3;
    endpoint: Endpoint1;
    id: Id12;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens1;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId2;
    openai_max_tokens_field: OpenaiMaxTokensField1;
    pricing: ModelPricing;
    protocol: Protocol1;
    provider_preset_id: ProviderPresetId1;
    reasoning_effort?: ReasoningEffort1;
    request_timeout_seconds: RequestTimeoutSeconds1;
    secret_ref: SecretRef1;
    version: Version9;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind12;
    note: Note;
    source: Source2;
    verified_at: VerifiedAt;
    version: Version8;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   *
   * This interface was referenced by `FileInputs1`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   *
   * This interface was referenced by `FileInputs2`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ResultInput {
    dependencies: Dependencies2;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId1;
    result_version: ResultVersion1;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId1;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId11;
    submitted_state: SubmittedState;
    task_id: TaskId8;
  }
  export interface SessionFilePredecessors {
    /**
     * This interface was referenced by `SessionFilePredecessors`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface StartRun {
    agent_profile_id: AgentProfileId1;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    inherit_session_files?: InheritSessionFiles;
    limits: RunLimits;
    model_profile_id: ModelProfileId1;
    model_selection?: ModelSelection | null;
    reasoning_effort?: ReasoningEffort2;
    session_file_adoptions?: SessionFileAdoptions;
    session_id: SessionId7;
    source_result: SourceResult1;
    sources: SourceSelection;
    text: Text2;
  }
  export interface ModelSelection {
    connection_id: ConnectionId2;
    connection_version: ConnectionVersion1;
    model_version: ModelVersion;
  }
  export interface SessionFileAdoptions {
    /**
     * This interface was referenced by `SessionFileAdoptions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind13;
    session_id: SessionId8;
    workspace_id: WorkspaceId6;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Question {
    answer_message_id: AnswerMessageId;
    answer_schema: AnswerSchema;
    call_id: CallId2;
    dependencies: Dependencies3;
    id: Id13;
    message_id: MessageId;
    question: Question1;
    run_id: RunId13;
    status: Status2;
    task_id: TaskId9;
    version: Version10;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface RunSnapshot {
    admission_generations: AdmissionGenerations1;
    allow_follow_up: AllowFollowUp1;
    allow_managed: AllowManaged1;
    attached_file_ids?: AttachedFileIds;
    budget_group_id: BudgetGroupId1;
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt1;
    execution_session_id: ExecutionSessionId1;
    file_inputs: FileInputs1;
    follow_up_closed: FollowUpClosed;
    id: Id14;
    interaction_session_id: InteractionSessionId;
    kind: Kind14;
    output: Output;
    reason: Reason3;
    root_task_id: RootTaskId1;
    scope_dependencies: ScopeDependencies1;
    sources: SourceSelection;
    state: State2;
    version: Version11;
    vision_source_run_id: VisionSourceRunId;
    workspace_id: WorkspaceId7;
    yield_requested: YieldRequested;
  }
  export interface AdmissionGenerations1 {
    /**
     * This interface was referenced by `AdmissionGenerations1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface FileInputs1 {
    [k: string]: SelectedFileVersion;
  }
  export interface AgentResult {
    artifact_ids: ArtifactIds;
    evidence_refs: EvidenceRefs;
    handled_failures: HandledFailures;
    status: Status3;
    structured_result: JsonValue;
    summary: Summary;
    unresolved: Unresolved;
    verification: Verification;
  }
  export interface FailureDisposition {
    reason: Reason2;
    result_version: ResultVersion2;
    task_id: TaskId10;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds1;
    handled_failures: HandledFailures1;
    summary: Summary1;
    unresolved: Unresolved1;
  }
  export interface TaskSnapshot {
    binding: TaskExecutionBinding;
    created_seq: CreatedSeq1;
    deadline_at: DeadlineAt2;
    executor_id: ExecutorId;
    id: Id15;
    kind: Kind16;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason4;
    result_version: ResultVersion3;
    run_id: RunId14;
    state: State3;
    version: Version12;
  }
  export interface TaskExecutionBinding {
    additional_result_inputs: AdditionalResultInputs;
    agent_work: AgentWork | null;
    config: ConfigSnapshot;
    delegation_depth: DelegationDepth;
    execution_session_id: ExecutionSessionId2;
    file_inputs: FileInputs2;
    input_artifacts: InputArtifacts;
    input_result: ResultInput | null;
    interaction_session_id: InteractionSessionId1;
    sources: SourceSelection;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs: InputRefs;
    kind: Kind15;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface FileInputs2 {
    [k: string]: SelectedFileVersion;
  }
  export interface WaitRecord {
    continuation_id: ContinuationId;
    deadline_at: DeadlineAt3;
    id: Id16;
    owner_task_id: OwnerTaskId;
    result_version: ResultVersion4;
    run_id: RunId15;
    state: State4;
    target_task_id: TargetTaskId1;
    version: Version13;
  }
  export interface PolicyEvent {
    activity_id: ActivityId8;
    causation_id: CausationId6;
    created_at: CreatedAt6;
    event_id: EventId9;
    event_version: EventVersion6;
    kind: Kind17;
    payload: PublicPolicyChange;
    run_id: RunId18;
    seq: Seq6;
    session_id: SessionId11;
    task_id: TaskId13;
    workspace_id: WorkspaceId10;
  }
  export interface PublicPolicyChange {
    approvals: Approvals;
    grants: Grants;
    resources: Resources;
  }
  export interface Approval {
    activity_id: ActivityId9;
    args_hash: ArgsHash;
    call_id: CallId3;
    dependencies: Dependencies4;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id17;
    mcp: McpToolSnapshot | null;
    parameters: Parameters;
    run_id: RunId17;
    session_id: SessionId10;
    status: Status4;
    target: Target;
    task_id: TaskId12;
    tool_name: ToolName;
    tool_version: ToolVersion;
    version: Version14;
    workspace_id: WorkspaceId9;
  }
  /**
   * 仅供本地审批展示的固定选择事实；不进入工具参数或模型消息。
   */
  export interface ExportApprovalPreview {
    artifact_id: ArtifactId;
    artifact_version: ArtifactVersion;
    target_exists: TargetExists;
    target_path: TargetPath;
  }
  export interface Parameters {
    [k: string]: JsonValue;
  }
  export interface DataUseGrant {
    destination: Destination1;
    epoch: Epoch1;
    id: Id18;
    mcp_queries: McpQueries;
    mcp_versions: McpVersions;
    memory_scopes: MemoryScopes1;
    purposes: Purposes;
    resource_ids: ResourceIds1;
    scope: ScopeRef;
    status: Status5;
    version: Version15;
  }
  export interface McpVersions {
    /**
     * This interface was referenced by `McpVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ResourceRef {
    id: Id19;
    kind: Kind18;
    label: Label;
    scope: ScopeRef;
    source_version: SourceVersion1;
    version: Version16;
  }
  export interface LifecycleEvent {
    activity_id: ActivityId10;
    causation_id: CausationId7;
    created_at: CreatedAt7;
    event_id: EventId10;
    event_version: EventVersion7;
    kind: Kind19;
    payload: PublicLifecycleChange;
    run_id: RunId19;
    seq: Seq7;
    session_id: SessionId12;
    task_id: TaskId14;
    workspace_id: WorkspaceId11;
  }
  export interface PublicLifecycleChange {
    deletions: Deletions;
    scopes: Scopes;
  }
  export interface DeletionReceipt {
    epoch: Epoch2;
    scope: ScopeRef;
    status: Status6;
  }
  export interface ScopeState {
    epoch: Epoch3;
    id: Id20;
    scope: ScopeRef;
    status: Status7;
  }
  export interface DeliveryEvent {
    activity_id: ActivityId11;
    causation_id: CausationId8;
    created_at: CreatedAt8;
    event_id: EventId11;
    event_version: EventVersion8;
    kind: Kind20;
    payload: DeliveryChange;
    run_id: RunId20;
    seq: Seq8;
    session_id: SessionId13;
    task_id: TaskId15;
    workspace_id: WorkspaceId12;
  }
  export interface DeliveryChange {
    deliveries: Deliveries;
  }
  export interface SessionInboxEntry {
    assistant_name?: AssistantName;
    attempts: Attempts;
    consumers: Consumers;
    delivery_state: DeliveryState;
    dependencies: Dependencies5;
    id: Id21;
    last_error: LastError;
    result: TaskHandle;
    result_version: ResultVersion5;
    source_event_id: SourceEventId1;
    source_valid: SourceValid1;
    target_session_id: TargetSessionId2;
    task_name?: TaskName;
    version: Version17;
    viewed_at: ViewedAt;
  }
  export interface AdmissionEvent {
    activity_id: ActivityId12;
    causation_id: CausationId9;
    created_at: CreatedAt9;
    event_id: EventId12;
    event_version: EventVersion9;
    kind: Kind21;
    payload: AdmissionChange;
    run_id: RunId21;
    seq: Seq9;
    session_id: SessionId14;
    task_id: TaskId16;
    workspace_id: WorkspaceId13;
  }
  export interface AdmissionChange {
    admission_fences: AdmissionFences;
  }
  export interface AdmissionFence {
    generation: Generation;
    scope: ScopeRef;
  }
  export interface MemoryEvent {
    activity_id: ActivityId13;
    causation_id: CausationId10;
    created_at: CreatedAt10;
    event_id: EventId13;
    event_version: EventVersion10;
    kind: Kind22;
    payload: MemoryChange;
    run_id: RunId22;
    seq: Seq10;
    session_id: SessionId15;
    task_id: TaskId17;
    workspace_id: WorkspaceId14;
  }
  /**
   * 事件仅用于失效通知；不复制可删除的事实正文。
   */
  export interface MemoryChange {
    policies: Policies;
    records: Records;
  }
  export interface MemoryPolicy {
    auto_organize: AutoOrganize;
    maintenance_limits: RunLimits;
    model_profile_id: ModelProfileId2;
    read_profile: ReadProfile;
    scope: ScopeRef;
    version: Version18;
  }
  export interface MemoryNotice {
    id: Id22;
    revision: Revision;
    scope: ScopeRef;
    status: Status8;
  }
  export interface MemoryMaintenanceEvent {
    activity_id: ActivityId14;
    causation_id: CausationId11;
    created_at: CreatedAt11;
    event_id: EventId14;
    event_version: EventVersion11;
    kind: Kind23;
    payload: MemoryMaintenanceNotice;
    run_id: RunId24;
    seq: Seq11;
    session_id: SessionId16;
    task_id: TaskId18;
    workspace_id: WorkspaceId15;
  }
  export interface MemoryMaintenanceNotice {
    id: Id23;
    policy_version: PolicyVersion1;
    reason: Reason5;
    scope: ScopeRef;
    source_boundary: MemorySourceBoundary;
    task: TaskHandle | null;
  }
  export interface MemorySourceBoundary {
    event_id: EventId15;
    run_id: RunId23;
  }
  export interface SkillEvent {
    activity_id: ActivityId15;
    causation_id: CausationId12;
    created_at: CreatedAt12;
    event_id: EventId16;
    event_version: EventVersion12;
    kind: Kind24;
    payload: SkillNotice;
    run_id: RunId25;
    seq: Seq12;
    session_id: SessionId17;
    task_id: TaskId19;
    workspace_id: WorkspaceId16;
  }
  export interface SkillNotice {
    revision: Revision1;
    scope: ScopeRef;
    skill_id: SkillId1;
    status: Status9;
  }
  export interface EnvironmentEvent {
    activity_id: ActivityId16;
    causation_id: CausationId13;
    created_at: CreatedAt13;
    event_id: EventId17;
    event_version: EventVersion13;
    kind: Kind25;
    payload: EnvironmentChanged;
    run_id: RunId26;
    seq: Seq13;
    session_id: SessionId18;
    task_id: TaskId20;
    workspace_id: WorkspaceId17;
  }
  /**
   * 全局失效只给读取者一个重新查询的定位，不广播执行配置。
   */
  export interface EnvironmentChanged {
    environment_id: EnvironmentId1;
  }
  export interface McpEvent {
    activity_id: ActivityId17;
    causation_id: CausationId14;
    created_at: CreatedAt14;
    event_id: EventId18;
    event_version: EventVersion14;
    kind: Kind26;
    payload: McpNotice;
    run_id: RunId27;
    seq: Seq14;
    session_id: SessionId19;
    task_id: TaskId21;
    workspace_id: WorkspaceId18;
  }
  export interface McpNotice {
    config_revision: ConfigRevision1;
    scope: ScopeRef;
    server_id: ServerId1;
  }
  export interface TitlePolicyEvent {
    activity_id: ActivityId18;
    causation_id: CausationId15;
    created_at: CreatedAt15;
    event_id: EventId19;
    event_version: EventVersion15;
    kind: Kind27;
    payload: TitlePolicy;
    run_id: RunId28;
    seq: Seq15;
    session_id: SessionId20;
    task_id: TaskId22;
    workspace_id: WorkspaceId20;
  }
  export interface TitlePolicy {
    binding: TitleModelBinding | null;
    version: Version19;
    workspace_id: WorkspaceId19;
  }
  export interface TitleModelBinding {
    connection_version: ConnectionVersion2;
    endpoint: Endpoint2;
    max_cost_units: MaxCostUnits1;
    max_requests: MaxRequests;
    max_tokens: MaxTokens;
    model_profile_id: ModelProfileId3;
    model_version: ModelVersion1;
  }

}
export type PublicEvent = PublicEventSchema.PublicEvent;

export namespace PublicationListSchema {
  export type ActivityId = string;
  export type AttemptId = string;
  export type BackupMatches = boolean | null;
  export type BackupPath = string | null;
  export type Id = string;
  export type LastChecked = string | null;
  export type MaintenanceReason = string | null;
  export type RunId = string;
  export type SessionId = string;
  export type StageMatches = boolean | null;
  export type StagePath = string;
  export type State = 'staged' | 'published' | 'needs_restore' | 'conflict' | 'restored' | 'released' | 'finalized';
  export type TargetMatches = 'original' | 'published' | 'missing' | 'other' | 'unknown';
  export type TargetPath = string;
  export type TaskId = string;
  export type Version = number;
  export type WorkspaceId = string;
  export type PublicationList = PublicationView[];

  export interface PublicationView {
    activity_id: ActivityId;
    attempt_id: AttemptId;
    backup_matches: BackupMatches;
    backup_path: BackupPath;
    id: Id;
    last_checked: LastChecked;
    maintenance_reason: MaintenanceReason;
    run_id: RunId;
    session_id: SessionId;
    stage_matches: StageMatches;
    stage_path: StagePath;
    state: State;
    target_matches: TargetMatches;
    target_path: TargetPath;
    task_id: TaskId;
    version: Version;
    workspace_id: WorkspaceId;
  }

}
export type PublicationList = PublicationListSchema.PublicationList;

export namespace PublicationViewSchema {
  export type ActivityId = string;
  export type AttemptId = string;
  export type BackupMatches = boolean | null;
  export type BackupPath = string | null;
  export type Id = string;
  export type LastChecked = string | null;
  export type MaintenanceReason = string | null;
  export type RunId = string;
  export type SessionId = string;
  export type StageMatches = boolean | null;
  export type StagePath = string;
  export type State = 'staged' | 'published' | 'needs_restore' | 'conflict' | 'restored' | 'released' | 'finalized';
  export type TargetMatches = 'original' | 'published' | 'missing' | 'other' | 'unknown';
  export type TargetPath = string;
  export type TaskId = string;
  export type Version = number;
  export type WorkspaceId = string;

  export interface PublicationView {
    activity_id: ActivityId;
    attempt_id: AttemptId;
    backup_matches: BackupMatches;
    backup_path: BackupPath;
    id: Id;
    last_checked: LastChecked;
    maintenance_reason: MaintenanceReason;
    run_id: RunId;
    session_id: SessionId;
    stage_matches: StageMatches;
    stage_path: StagePath;
    state: State;
    target_matches: TargetMatches;
    target_path: TargetPath;
    task_id: TaskId;
    version: Version;
    workspace_id: WorkspaceId;
  }

}
export type PublicationView = PublicationViewSchema.PublicationView;

export namespace PublishSkillCommandSchema {
  export type ConfirmedHash = string;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type StagingRef = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface PublishSkillCommand {
    data: PublishSkill;
    meta: CommandMeta;
  }
  export interface PublishSkill {
    confirmed_hash: ConfirmedHash;
    scope: ScopeRef;
    staging_ref: StagingRef;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type PublishSkillCommand = PublishSkillCommandSchema.PublishSkillCommand;

export namespace QuestionSchema {
  export type AnswerMessageId = string | null;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Id = string;
  export type MessageId = string;
  export type Question1 = string;
  export type RunId = string;
  export type Status = 'pending' | 'answered' | 'cancelled';
  export type TaskId = string;
  export type Version = number;

  export interface Question {
    answer_message_id: AnswerMessageId;
    answer_schema: AnswerSchema;
    call_id: CallId;
    dependencies: Dependencies;
    id: Id;
    message_id: MessageId;
    question: Question1;
    run_id: RunId;
    status: Status;
    task_id: TaskId;
    version: Version;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }

}
export type Question = QuestionSchema.Question;

export namespace QuestionPageSchema {
  export type AnswerMessageId = string | null;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Id = string;
  export type MessageId = string;
  export type Question1 = string;
  export type RunId = string;
  export type Status = 'pending' | 'answered' | 'cancelled';
  export type TaskId = string;
  export type Version = number;
  export type Items = Question[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface QuestionPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface Question {
    answer_message_id: AnswerMessageId;
    answer_schema: AnswerSchema;
    call_id: CallId;
    dependencies: Dependencies;
    id: Id;
    message_id: MessageId;
    question: Question1;
    run_id: RunId;
    status: Status;
    task_id: TaskId;
    version: Version;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }

}
export type QuestionPage = QuestionPageSchema.QuestionPage;

export namespace RenameCommandSchema {
  export type Name = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface RenameCommand {
    data: Rename;
    meta: CommandMeta;
  }
  export interface Rename {
    name: Name;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type RenameCommand = RenameCommandSchema.RenameCommand;

export namespace ResolveSkillsSchema {
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;

  export interface ResolveSkills {
    scope: ScopeRef;
    versions: Versions;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface Versions {
    /**
     * This interface was referenced by `Versions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type ResolveSkills = ResolveSkillsSchema.ResolveSkills;

export namespace ResolvedMemberSchema {
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;

  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools1 {
    [k: string]: string;
  }

}
export type ResolvedMember = ResolvedMemberSchema.ResolvedMember;

export namespace ResourceCoverageSchema {
  export type Allowed = boolean;
  export type Destination = string;
  export type MissingModelSend = string[];
  export type MissingRead = string[];

  export interface ResourceCoverage {
    allowed: Allowed;
    destination: Destination;
    missing_model_send: MissingModelSend;
    missing_read: MissingRead;
  }

}
export type ResourceCoverage = ResourceCoverageSchema.ResourceCoverage;

export namespace ResourceCoverageRequestSchema {
  export type ModelProfileId = string;
  /**
   * @maxItems 200
   */
  export type ResourceIds = string[];

  export interface ResourceCoverageRequest {
    model_profile_id: ModelProfileId;
    resource_ids: ResourceIds;
  }

}
export type ResourceCoverageRequest = ResourceCoverageRequestSchema.ResourceCoverageRequest;

export namespace ResourcePageSchema {
  export type Id = string;
  export type Kind = 'file' | 'directory' | 'export';
  export type Label = string;
  export type Kind1 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SourceVersion = string | null;
  export type Version = number;
  export type Items = ResourceRef[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface ResourcePage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface ResourceRef {
    id: Id;
    kind: Kind;
    label: Label;
    scope: ScopeRef;
    source_version: SourceVersion;
    version: Version;
  }
  export interface ScopeRef {
    kind: Kind1;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type ResourcePage = ResourcePageSchema.ResourcePage;

export namespace ResourceRefSchema {
  export type Id = string;
  export type Kind = 'file' | 'directory' | 'export';
  export type Label = string;
  export type Kind1 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SourceVersion = string | null;
  export type Version = number;

  export interface ResourceRef {
    id: Id;
    kind: Kind;
    label: Label;
    scope: ScopeRef;
    source_version: SourceVersion;
    version: Version;
  }
  export interface ScopeRef {
    kind: Kind1;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type ResourceRef = ResourceRefSchema.ResourceRef;

export namespace ResultConsumptionSchema {
  export type ExecutionSessionId = string;
  export type Id = string;
  export type InboxEntryId = string | null;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId = string;
  export type TargetTaskId = string;
  export type TaskId = string;

  export interface ResultConsumption {
    execution_session_id: ExecutionSessionId;
    id: Id;
    inbox_entry_id: InboxEntryId;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId;
    target_task_id: TargetTaskId;
    task_id: TaskId;
  }

}
export type ResultConsumption = ResultConsumptionSchema.ResultConsumption;

export namespace ResultInputSchema {
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;
  export type InboxEntryId = string;
  export type ResultVersion = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;

  export interface ResultInput {
    dependencies: Dependencies;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId;
    result_version: ResultVersion;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }

}
export type ResultInput = ResultInputSchema.ResultInput;

export namespace RunCostSummarySchema {
  export type CalculatedUnits = string;
  export type Currency = 'USD';
  export type PendingRequestCount = number;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type EffectiveMultiplier = string | null;
  export type SnapshotId = string | null;
  export type Source = string | null;
  export type UnknownReason = string | null;
  export type ReservedUnits = string;
  export type UnitsPerCurrency = string;
  export type UnknownRequestCount = number;

  export interface RunCostSummary {
    calculated_units: CalculatedUnits;
    currency: Currency;
    pending_request_count: PendingRequestCount;
    pricing_basis: PricingBasis;
    reserved_units: ReservedUnits;
    units_per_currency: UnitsPerCurrency;
    unknown_request_count: UnknownRequestCount;
  }
  export interface PricingBasis {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    effective_multiplier: EffectiveMultiplier;
    snapshot_id: SnapshotId;
    source: Source;
    unknown_reason: UnknownReason;
  }

}
export type RunCostSummary = RunCostSummarySchema.RunCostSummary;

export namespace RunDetailSchema {
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id = string;
  export type Kind = 'model' | 'tool';
  export type Operation = string;
  export type RunId = string;
  export type AttemptId = string;
  export type CollectionError = string | null;
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type ExitCode = number | null;
  export type ExternalCosts = 'unknown';
  export type ActivityId = string;
  export type ContentHash1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id1 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;
  export type RelativePath = string;
  export type Outputs = ScriptArtifact[];
  export type ScriptRelativePath = string;
  export type SkillId = string;
  export type TerminationReason = 'exited' | 'cancelled' | 'timed_out';
  export type Truncated = boolean;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId1 = string;
  export type CacheReadReported = true | null;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version1 = number;
  export type Items = ActivityView[];
  export type NextCursor = string | null;
  export type Watermark = string;
  export type ActivityId1 = string;
  export type ArgsHash = string;
  export type CallId = string;
  export type Dependencies2 = ScopeDependency[];
  export type ExpiresAt = string;
  export type ArtifactId = string;
  export type ArtifactVersion = number;
  export type TargetExists = boolean;
  export type TargetPath = string;
  export type Id2 = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type JsonValue = unknown;
  export type RunId1 = string;
  export type SessionId = string | null;
  export type Status1 = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
  export type Target = string | null;
  export type TaskId2 = string;
  export type ToolName = string;
  export type ToolVersion = string;
  export type Version2 = number;
  export type WorkspaceId = string;
  export type Items1 = Approval[];
  export type NextCursor1 = string | null;
  export type Watermark1 = string;
  export type Items2 = ArtifactRef[];
  export type NextCursor2 = string | null;
  export type Watermark2 = string;
  export type Id3 = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelRequests = number;
  export type ReservedTokens = number;
  export type ReservedUnits = string;
  export type RunId2 = string;
  export type SpentUnits = string;
  export type Steps = number;
  export type TaskCount = number;
  export type TotalTokens = number;
  export type Version3 = number;
  export type ExecutionSessionId = string;
  export type Id4 = string;
  export type InboxEntryId = string | null;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId3 = string;
  export type TargetTaskId = string;
  export type TaskId3 = string;
  export type Items3 = ResultConsumption[];
  export type NextCursor3 = string | null;
  export type Watermark3 = string;
  export type ActivityId2 = string | null;
  export type CompactedMessageCount = number;
  export type CompactionReason = string | null;
  export type CompactionState = 'none' | 'running' | 'committed' | 'blocked' | 'invalidated';
  export type OmittedGroupCount = number;
  export type OmittedMessageCount = number;
  export type State1 = ('prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain') | null;
  export type SummaryCount = number;
  export type CalculatedUnits = string;
  export type Currency = 'USD';
  export type PendingRequestCount = number;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type EffectiveMultiplier = string | null;
  export type SnapshotId = string | null;
  export type Source1 = string | null;
  export type UnknownReason = string | null;
  export type ReservedUnits1 = string;
  export type UnitsPerCurrency = string;
  export type UnknownRequestCount = number;
  export type ChildResultVersion = number;
  export type ChildTaskId = string;
  export type EventId = string;
  export type Id5 = string;
  export type RootTaskId = string;
  export type RunId4 = string;
  export type Items4 = JoinFact[];
  export type NextCursor4 = string | null;
  export type Watermark4 = string;
  export type ActivityId3 = string | null;
  export type Name = string;
  export type ReadGrantIds = string[];
  export type ResourceId = string;
  export type ResourceLineage = string[];
  export type Attachments = MessageAttachment[];
  export type DeliveryIds = string[];
  export type EventId1 = string;
  export type EventIndex = number;
  export type Id6 = string;
  export type Origin = 'conversation' | 'steering' | 'answer' | 'task_result' | 'background_report';
  export type Kind1 = 'text';
  export type Text = string;
  export type Kind2 = 'reasoning';
  export type Text1 = string;
  export type Arguments =
    | {
        [k: string]: JsonValue;
      }
    | string;
  export type CallId1 = string;
  export type Kind3 = 'tool_call';
  export type Name1 = string;
  export type CallId2 = string;
  export type Error1 = string | null;
  export type Kind4 = 'tool_result';
  export type OriginMessageId = string | null;
  export type Parts = (TextPart | ReasoningPart | ToolCallPart | ToolResultPart)[];
  export type PrivateRef = string | null;
  export type Role = 'user' | 'assistant' | 'tool';
  export type RunId5 = string;
  export type SourceDependencies = ScopeDependency[];
  export type SourceValid = boolean | null;
  export type ToolOperation = string | null;
  export type Items5 = MessageView[];
  export type NextCursor5 = string | null;
  export type Watermark5 = string;
  export type AnswerMessageId = string | null;
  export type CallId3 = string;
  export type Dependencies3 = ScopeDependency[];
  export type Id7 = string;
  export type MessageId = string;
  export type Question1 = string;
  export type RunId6 = string;
  export type Status2 = 'pending' | 'answered' | 'cancelled';
  export type TaskId4 = string;
  export type Version4 = number;
  export type Items6 = Question[];
  export type NextCursor6 = string | null;
  export type Watermark6 = string;
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type AttachedFileIds = string[] | null;
  export type BudgetGroupId = string;
  export type BudgetId = string;
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id8 = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version5 = number;
  export type AgentExecutorId = string;
  export type Assumptions1 = string[];
  export type CatalogVersion1 = string | null;
  export type Currency1 = 'USD';
  export type EffectiveMultiplier1 = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId1 = string;
  export type Source2 = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id9 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind5 = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source3 = string | null;
  export type VerifiedAt = string | null;
  export type Version6 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency2 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version7 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DeadlineAt = string;
  export type ExecutionSessionId1 = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type SourceVersion = string;
  export type FollowUpClosed = boolean;
  export type Id10 = string;
  export type InteractionSessionId = string | null;
  export type Kind6 = 'user' | 'managed' | 'follow_up' | 'maintenance';
  export type Output = AgentResult | RunOutput | null;
  export type ArtifactIds = string[];
  export type EvidenceRefs = string[];
  export type Reason = string;
  export type ResultVersion1 = number;
  export type TaskId5 = string;
  export type HandledFailures = FailureDisposition[];
  export type Status3 = 'completed' | 'partial' | 'failed';
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Verification = string[];
  export type ArtifactIds1 = string[];
  export type HandledFailures1 = FailureDisposition[];
  export type Summary1 = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved1 = string[];
  export type Reason1 = string | null;
  export type RootTaskId1 = string;
  export type ScopeDependencies = ScopeDependency[];
  export type ExcludedSourceIds = string[];
  export type Kind7 = 'user_global' | 'workspace' | 'session';
  export type SessionId1 = string | null;
  export type WorkspaceId1 = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type State2 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version8 = number;
  export type VisionSourceRunId = string | null;
  export type WorkspaceId2 = string;
  export type YieldRequested = boolean;
  export type SourceValid1 = boolean;
  export type TaskGoal = string | null;
  export type TaskTitle = string | null;
  export type Dependencies4 = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId7 = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId6 = string;
  export type InboxEntryId1 = string;
  export type ResultVersion2 = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;
  export type AdditionalResultInputs = ResultInput[];
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind8 = 'agent';
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type DelegationDepth = number;
  export type ExecutionSessionId2 = string;
  export type InputArtifacts = ArtifactRef[];
  export type InteractionSessionId1 = string | null;
  export type CreatedSeq = number;
  export type DeadlineAt1 = string | null;
  export type ExecutorId = string;
  export type Id11 = string;
  export type Kind9 = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason2 = string | null;
  export type ResultVersion3 = number | null;
  export type RunId8 = string;
  export type State3 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version9 = number;
  export type Items7 = TaskSnapshot[];
  export type NextCursor7 = string | null;
  export type Watermark7 = string;
  export type ContinuationId = string;
  export type DeadlineAt2 = string | null;
  export type Id12 = string;
  export type OwnerTaskId = string;
  export type ResultVersion4 = number | null;
  export type RunId9 = string;
  export type State4 = 'pending' | 'ready' | 'timeout' | 'cancelled';
  export type TargetTaskId1 = string;
  export type Version10 = number;
  export type Items8 = WaitRecord[];
  export type NextCursor8 = string | null;
  export type Watermark8 = string;
  export type Watermark9 = string;

  export interface RunDetail {
    activities: PageActivityView;
    approvals: PageApproval;
    artifacts: PageArtifactRef;
    budget: BudgetSnapshot;
    consumptions: PageResultConsumption;
    context_usage: ContextUsageSummary | null;
    cost_summary: RunCostSummary;
    file_names?: FileNames;
    joins: PageJoinFact;
    messages: PageMessageView;
    questions: PageQuestion;
    run: RunSnapshot;
    source_valid?: SourceValid1;
    task_goal?: TaskGoal;
    task_title?: TaskTitle;
    task_titles?: TaskTitles;
    tasks: PageTaskSnapshot;
    waits: PageWaitRecord;
    watermark: Watermark9;
  }
  export interface PageActivityView {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id;
    kind: Kind;
    operation: Operation;
    run_id: RunId;
    script_execution: ScriptExecutionSummary | null;
    state: State;
    task_id: TaskId1;
    usage: Usage | null;
    version: Version1;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。
   */
  export interface ScriptExecutionSummary {
    attempt_id: AttemptId;
    collection_error: CollectionError;
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    exit_code: ExitCode;
    external_costs: ExternalCosts;
    outputs: Outputs;
    script_relative_path: ScriptRelativePath;
    skill_id: SkillId;
    termination_reason: TerminationReason;
    truncated: Truncated;
  }
  export interface ScriptArtifact {
    artifact: ArtifactRef;
    relative_path: RelativePath;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash1;
    dependencies: Dependencies1;
    id: Id1;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface Usage {
    cache_read_reported?: CacheReadReported;
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }
  export interface PageApproval {
    items: Items1;
    next_cursor: NextCursor1;
    watermark: Watermark1;
  }
  export interface Approval {
    activity_id: ActivityId1;
    args_hash: ArgsHash;
    call_id: CallId;
    dependencies: Dependencies2;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id2;
    mcp: McpToolSnapshot | null;
    parameters: Parameters;
    run_id: RunId1;
    session_id: SessionId;
    status: Status1;
    target: Target;
    task_id: TaskId2;
    tool_name: ToolName;
    tool_version: ToolVersion;
    version: Version2;
    workspace_id: WorkspaceId;
  }
  /**
   * 仅供本地审批展示的固定选择事实；不进入工具参数或模型消息。
   */
  export interface ExportApprovalPreview {
    artifact_id: ArtifactId;
    artifact_version: ArtifactVersion;
    target_exists: TargetExists;
    target_path: TargetPath;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Parameters {
    [k: string]: JsonValue;
  }
  export interface PageArtifactRef {
    items: Items2;
    next_cursor: NextCursor2;
    watermark: Watermark2;
  }
  export interface BudgetSnapshot {
    id: Id3;
    limits: RunLimits;
    model_requests: ModelRequests;
    reserved_tokens: ReservedTokens;
    reserved_units: ReservedUnits;
    run_id: RunId2;
    spent_units: SpentUnits;
    steps: Steps;
    task_count: TaskCount;
    total_tokens: TotalTokens;
    version: Version3;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_delegation_depth: MaxDelegationDepth;
    max_model_requests: MaxModelRequests;
    max_parallel_agents: MaxParallelAgents;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
    max_total_tokens: MaxTotalTokens;
  }
  export interface PageResultConsumption {
    items: Items3;
    next_cursor: NextCursor3;
    watermark: Watermark3;
  }
  export interface ResultConsumption {
    execution_session_id: ExecutionSessionId;
    id: Id4;
    inbox_entry_id: InboxEntryId;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId3;
    target_task_id: TargetTaskId;
    task_id: TaskId3;
  }
  export interface ContextUsageSummary {
    activity_id: ActivityId2;
    compacted_message_count: CompactedMessageCount;
    compaction_reason: CompactionReason;
    compaction_state: CompactionState;
    omitted_group_count: OmittedGroupCount;
    omitted_message_count: OmittedMessageCount;
    reason_counts: ReasonCounts;
    state: State1;
    summary_count: SummaryCount;
  }
  export interface ReasonCounts {
    [k: string]: number;
  }
  export interface RunCostSummary {
    calculated_units: CalculatedUnits;
    currency: Currency;
    pending_request_count: PendingRequestCount;
    pricing_basis: PricingBasis;
    reserved_units: ReservedUnits1;
    units_per_currency: UnitsPerCurrency;
    unknown_request_count: UnknownRequestCount;
  }
  export interface PricingBasis {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    effective_multiplier: EffectiveMultiplier;
    snapshot_id: SnapshotId;
    source: Source1;
    unknown_reason: UnknownReason;
  }
  export interface FileNames {
    /**
     * This interface was referenced by `FileNames`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface PageJoinFact {
    items: Items4;
    next_cursor: NextCursor4;
    watermark: Watermark4;
  }
  export interface JoinFact {
    child_result_version: ChildResultVersion;
    child_task_id: ChildTaskId;
    event_id: EventId;
    id: Id5;
    root_task_id: RootTaskId;
    run_id: RunId4;
  }
  export interface PageMessageView {
    items: Items5;
    next_cursor: NextCursor5;
    watermark: Watermark5;
  }
  export interface MessageView {
    activity_id: ActivityId3;
    attachments?: Attachments;
    delivery_ids?: DeliveryIds;
    event_id: EventId1;
    event_index: EventIndex;
    id: Id6;
    origin: Origin;
    parts: Parts;
    private_ref: PrivateRef;
    role: Role;
    run_id: RunId5;
    source_dependencies: SourceDependencies;
    source_valid?: SourceValid;
    tool_operation?: ToolOperation;
  }
  export interface MessageAttachment {
    name: Name;
    read_grant_ids: ReadGrantIds;
    resource_id: ResourceId;
    resource_lineage: ResourceLineage;
  }
  export interface TextPart {
    kind: Kind1;
    text: Text;
  }
  export interface ReasoningPart {
    kind: Kind2;
    text: Text1;
  }
  export interface ToolCallPart {
    arguments: Arguments;
    call_id: CallId1;
    kind: Kind3;
    name: Name1;
  }
  export interface ToolResultPart {
    call_id: CallId2;
    error: Error1;
    kind: Kind4;
    origin_message_id: OriginMessageId;
    result: {
      [k: string]: unknown;
    };
  }
  export interface PageQuestion {
    items: Items6;
    next_cursor: NextCursor6;
    watermark: Watermark6;
  }
  export interface Question {
    answer_message_id: AnswerMessageId;
    answer_schema: AnswerSchema;
    call_id: CallId3;
    dependencies: Dependencies3;
    id: Id7;
    message_id: MessageId;
    question: Question1;
    run_id: RunId6;
    status: Status2;
    task_id: TaskId4;
    version: Version4;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface RunSnapshot {
    admission_generations: AdmissionGenerations;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    attached_file_ids?: AttachedFileIds;
    budget_group_id: BudgetGroupId;
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    execution_session_id: ExecutionSessionId1;
    file_inputs: FileInputs;
    follow_up_closed: FollowUpClosed;
    id: Id10;
    interaction_session_id: InteractionSessionId;
    kind: Kind6;
    output: Output;
    reason: Reason1;
    root_task_id: RootTaskId1;
    scope_dependencies: ScopeDependencies;
    sources: SourceSelection;
    state: State2;
    version: Version8;
    vision_source_run_id: VisionSourceRunId;
    workspace_id: WorkspaceId2;
    yield_requested: YieldRequested;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id8;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version5;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions1;
    catalog_version: CatalogVersion1;
    currency: Currency1;
    effective_multiplier: EffectiveMultiplier1;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId1;
    source: Source2;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id9;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version7;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind5;
    note: Note;
    source: Source3;
    verified_at: VerifiedAt;
    version: Version6;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency2;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   *
   * This interface was referenced by `FileInputs1`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface AgentResult {
    artifact_ids: ArtifactIds;
    evidence_refs: EvidenceRefs;
    handled_failures: HandledFailures;
    status: Status3;
    structured_result: JsonValue;
    summary: Summary;
    unresolved: Unresolved;
    verification: Verification;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion1;
    task_id: TaskId5;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds1;
    handled_failures: HandledFailures1;
    summary: Summary1;
    unresolved: Unresolved1;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind7;
    session_id: SessionId1;
    workspace_id: WorkspaceId1;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface TaskTitles {
    /**
     * This interface was referenced by `TaskTitles`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface PageTaskSnapshot {
    items: Items7;
    next_cursor: NextCursor7;
    watermark: Watermark7;
  }
  export interface TaskSnapshot {
    binding: TaskExecutionBinding;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt1;
    executor_id: ExecutorId;
    id: Id11;
    kind: Kind9;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason2;
    result_version: ResultVersion3;
    run_id: RunId8;
    state: State3;
    version: Version9;
  }
  export interface TaskExecutionBinding {
    additional_result_inputs: AdditionalResultInputs;
    agent_work: AgentWork | null;
    config: ConfigSnapshot;
    delegation_depth: DelegationDepth;
    execution_session_id: ExecutionSessionId2;
    file_inputs: FileInputs1;
    input_artifacts: InputArtifacts;
    input_result: ResultInput | null;
    interaction_session_id: InteractionSessionId1;
    sources: SourceSelection;
  }
  export interface ResultInput {
    dependencies: Dependencies4;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId1;
    result_version: ResultVersion2;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId7;
    submitted_state: SubmittedState;
    task_id: TaskId6;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs: InputRefs;
    kind: Kind8;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface FileInputs1 {
    [k: string]: SelectedFileVersion;
  }
  export interface PageWaitRecord {
    items: Items8;
    next_cursor: NextCursor8;
    watermark: Watermark8;
  }
  export interface WaitRecord {
    continuation_id: ContinuationId;
    deadline_at: DeadlineAt2;
    id: Id12;
    owner_task_id: OwnerTaskId;
    result_version: ResultVersion4;
    run_id: RunId9;
    state: State4;
    target_task_id: TargetTaskId1;
    version: Version10;
  }

}
export type RunDetail = RunDetailSchema.RunDetail;

export namespace RunFeedbackSchema {
  export type ConnectionId = string;
  export type ActivityId = string | null;
  export type CompactedMessageCount = number;
  export type CompactionReason = string | null;
  export type CompactionState = 'none' | 'running' | 'committed' | 'blocked' | 'invalidated';
  export type OmittedGroupCount = number;
  export type OmittedMessageCount = number;
  export type State = ('prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain') | null;
  export type SummaryCount = number;
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id = string;
  export type Kind = 'model' | 'tool';
  export type Operation = string;
  export type RunId = string;
  export type AttemptId = string;
  export type CollectionError = string | null;
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type ExitCode = number | null;
  export type ExternalCosts = 'unknown';
  export type ActivityId1 = string;
  export type ContentHash1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id1 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;
  export type RelativePath = string;
  export type Outputs = ScriptArtifact[];
  export type ScriptRelativePath = string;
  export type SkillId = string;
  export type TerminationReason = 'exited' | 'cancelled' | 'timed_out';
  export type Truncated = boolean;
  export type State1 = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId1 = string;
  export type CacheReadReported = true | null;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version1 = number;
  export type Reason = string | null;
  export type RootTaskId = string;
  export type RunId1 = string;
  export type SessionId = string;
  export type State2 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version2 = number;
  export type WorkspaceId = string;

  export interface RunFeedback {
    connection_id: ConnectionId;
    context_usage: ContextUsageSummary | null;
    model_activity: ActivityView | null;
    reason: Reason;
    root_task_id: RootTaskId;
    run_id: RunId1;
    session_id: SessionId;
    state: State2;
    version: Version2;
    workspace_id: WorkspaceId;
  }
  export interface ContextUsageSummary {
    activity_id: ActivityId;
    compacted_message_count: CompactedMessageCount;
    compaction_reason: CompactionReason;
    compaction_state: CompactionState;
    omitted_group_count: OmittedGroupCount;
    omitted_message_count: OmittedMessageCount;
    reason_counts: ReasonCounts;
    state: State;
    summary_count: SummaryCount;
  }
  export interface ReasonCounts {
    [k: string]: number;
  }
  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id;
    kind: Kind;
    operation: Operation;
    run_id: RunId;
    script_execution: ScriptExecutionSummary | null;
    state: State1;
    task_id: TaskId1;
    usage: Usage | null;
    version: Version1;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。
   */
  export interface ScriptExecutionSummary {
    attempt_id: AttemptId;
    collection_error: CollectionError;
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    exit_code: ExitCode;
    external_costs: ExternalCosts;
    outputs: Outputs;
    script_relative_path: ScriptRelativePath;
    skill_id: SkillId;
    termination_reason: TerminationReason;
    truncated: Truncated;
  }
  export interface ScriptArtifact {
    artifact: ArtifactRef;
    relative_path: RelativePath;
  }
  export interface ArtifactRef {
    activity_id: ActivityId1;
    content_hash: ContentHash1;
    dependencies: Dependencies1;
    id: Id1;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface Usage {
    cache_read_reported?: CacheReadReported;
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }

}
export type RunFeedback = RunFeedbackSchema.RunFeedback;

export namespace RunFeedbackPageSchema {
  export type ConnectionId = string;
  export type ActivityId = string | null;
  export type CompactedMessageCount = number;
  export type CompactionReason = string | null;
  export type CompactionState = 'none' | 'running' | 'committed' | 'blocked' | 'invalidated';
  export type OmittedGroupCount = number;
  export type OmittedMessageCount = number;
  export type State = ('prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain') | null;
  export type SummaryCount = number;
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id = string;
  export type Kind = 'model' | 'tool';
  export type Operation = string;
  export type RunId = string;
  export type AttemptId = string;
  export type CollectionError = string | null;
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type ExitCode = number | null;
  export type ExternalCosts = 'unknown';
  export type ActivityId1 = string;
  export type ContentHash1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id1 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;
  export type RelativePath = string;
  export type Outputs = ScriptArtifact[];
  export type ScriptRelativePath = string;
  export type SkillId = string;
  export type TerminationReason = 'exited' | 'cancelled' | 'timed_out';
  export type Truncated = boolean;
  export type State1 = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId1 = string;
  export type CacheReadReported = true | null;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version1 = number;
  export type Reason = string | null;
  export type RootTaskId = string;
  export type RunId1 = string;
  export type SessionId = string;
  export type State2 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version2 = number;
  export type WorkspaceId = string;
  export type Items = RunFeedback[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface RunFeedbackPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface RunFeedback {
    connection_id: ConnectionId;
    context_usage: ContextUsageSummary | null;
    model_activity: ActivityView | null;
    reason: Reason;
    root_task_id: RootTaskId;
    run_id: RunId1;
    session_id: SessionId;
    state: State2;
    version: Version2;
    workspace_id: WorkspaceId;
  }
  export interface ContextUsageSummary {
    activity_id: ActivityId;
    compacted_message_count: CompactedMessageCount;
    compaction_reason: CompactionReason;
    compaction_state: CompactionState;
    omitted_group_count: OmittedGroupCount;
    omitted_message_count: OmittedMessageCount;
    reason_counts: ReasonCounts;
    state: State;
    summary_count: SummaryCount;
  }
  export interface ReasonCounts {
    [k: string]: number;
  }
  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id;
    kind: Kind;
    operation: Operation;
    run_id: RunId;
    script_execution: ScriptExecutionSummary | null;
    state: State1;
    task_id: TaskId1;
    usage: Usage | null;
    version: Version1;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。
   */
  export interface ScriptExecutionSummary {
    attempt_id: AttemptId;
    collection_error: CollectionError;
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    exit_code: ExitCode;
    external_costs: ExternalCosts;
    outputs: Outputs;
    script_relative_path: ScriptRelativePath;
    skill_id: SkillId;
    termination_reason: TerminationReason;
    truncated: Truncated;
  }
  export interface ScriptArtifact {
    artifact: ArtifactRef;
    relative_path: RelativePath;
  }
  export interface ArtifactRef {
    activity_id: ActivityId1;
    content_hash: ContentHash1;
    dependencies: Dependencies1;
    id: Id1;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface Usage {
    cache_read_reported?: CacheReadReported;
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }

}
export type RunFeedbackPage = RunFeedbackPageSchema.RunFeedbackPage;

export namespace RunPageSchema {
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type AttachedFileIds = string[] | null;
  export type BudgetGroupId = string;
  export type BudgetId = string;
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DeadlineAt = string;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type SourceVersion = string;
  export type FollowUpClosed = boolean;
  export type Id2 = string;
  export type InteractionSessionId = string | null;
  export type Kind1 = 'user' | 'managed' | 'follow_up' | 'maintenance';
  export type Output = AgentResult | RunOutput | null;
  export type ArtifactIds = string[];
  export type EvidenceRefs = string[];
  export type Reason = string;
  export type ResultVersion = number;
  export type TaskId = string;
  export type HandledFailures = FailureDisposition[];
  export type Status = 'completed' | 'partial' | 'failed';
  export type JsonValue = unknown;
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Verification = string[];
  export type ArtifactIds1 = string[];
  export type HandledFailures1 = FailureDisposition[];
  export type Summary1 = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved1 = string[];
  export type Reason1 = string | null;
  export type RootTaskId = string;
  export type ScopeDependencies = ScopeDependency[];
  export type ExcludedSourceIds = string[];
  export type Kind2 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type State =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version3 = number;
  export type VisionSourceRunId = string | null;
  export type WorkspaceId1 = string;
  export type YieldRequested = boolean;
  export type Items = RunSnapshot[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface RunPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface RunSnapshot {
    admission_generations: AdmissionGenerations;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    attached_file_ids?: AttachedFileIds;
    budget_group_id: BudgetGroupId;
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    follow_up_closed: FollowUpClosed;
    id: Id2;
    interaction_session_id: InteractionSessionId;
    kind: Kind1;
    output: Output;
    reason: Reason1;
    root_task_id: RootTaskId;
    scope_dependencies: ScopeDependencies;
    sources: SourceSelection;
    state: State;
    version: Version3;
    vision_source_run_id: VisionSourceRunId;
    workspace_id: WorkspaceId1;
    yield_requested: YieldRequested;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface AgentResult {
    artifact_ids: ArtifactIds;
    evidence_refs: EvidenceRefs;
    handled_failures: HandledFailures;
    status: Status;
    structured_result: JsonValue;
    summary: Summary;
    unresolved: Unresolved;
    verification: Verification;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion;
    task_id: TaskId;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds1;
    handled_failures: HandledFailures1;
    summary: Summary1;
    unresolved: Unresolved1;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind2;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type RunPage = RunPageSchema.RunPage;

export namespace RunSnapshotSchema {
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type AttachedFileIds = string[] | null;
  export type BudgetGroupId = string;
  export type BudgetId = string;
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DeadlineAt = string;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type SourceVersion = string;
  export type FollowUpClosed = boolean;
  export type Id2 = string;
  export type InteractionSessionId = string | null;
  export type Kind1 = 'user' | 'managed' | 'follow_up' | 'maintenance';
  export type Output = AgentResult | RunOutput | null;
  export type ArtifactIds = string[];
  export type EvidenceRefs = string[];
  export type Reason = string;
  export type ResultVersion = number;
  export type TaskId = string;
  export type HandledFailures = FailureDisposition[];
  export type Status = 'completed' | 'partial' | 'failed';
  export type JsonValue = unknown;
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Verification = string[];
  export type ArtifactIds1 = string[];
  export type HandledFailures1 = FailureDisposition[];
  export type Summary1 = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved1 = string[];
  export type Reason1 = string | null;
  export type RootTaskId = string;
  export type ScopeDependencies = ScopeDependency[];
  export type ExcludedSourceIds = string[];
  export type Kind2 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type State =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version3 = number;
  export type VisionSourceRunId = string | null;
  export type WorkspaceId1 = string;
  export type YieldRequested = boolean;

  export interface RunSnapshot {
    admission_generations: AdmissionGenerations;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    attached_file_ids?: AttachedFileIds;
    budget_group_id: BudgetGroupId;
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    follow_up_closed: FollowUpClosed;
    id: Id2;
    interaction_session_id: InteractionSessionId;
    kind: Kind1;
    output: Output;
    reason: Reason1;
    root_task_id: RootTaskId;
    scope_dependencies: ScopeDependencies;
    sources: SourceSelection;
    state: State;
    version: Version3;
    vision_source_run_id: VisionSourceRunId;
    workspace_id: WorkspaceId1;
    yield_requested: YieldRequested;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface AgentResult {
    artifact_ids: ArtifactIds;
    evidence_refs: EvidenceRefs;
    handled_failures: HandledFailures;
    status: Status;
    structured_result: JsonValue;
    summary: Summary;
    unresolved: Unresolved;
    verification: Verification;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion;
    task_id: TaskId;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds1;
    handled_failures: HandledFailures1;
    summary: Summary1;
    unresolved: Unresolved1;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind2;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type RunSnapshot = RunSnapshotSchema.RunSnapshot;

export namespace SaveAgentCommandSchema {
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SaveAgentCommand {
    data: AgentProfile;
    meta: CommandMeta;
  }
  export interface AgentProfile {
    allowed_tools?: AllowedTools;
    communication_style?: CommunicationStyle;
    default_model_profile_id?: DefaultModelProfileId;
    delegatable?: Delegatable;
    display_name?: DisplayName;
    icon_id?: IconId;
    id?: Id;
    instructions?: Instructions;
    skill_ids?: SkillIds;
    version?: Version;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SaveAgentCommand = SaveAgentCommandSchema.SaveAgentCommand;

export namespace SaveConnectionCommandSchema {
  export type DisplayName = string;
  export type Endpoint = string;
  export type Id = string;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type SecretRef = string | null;
  export type Version = number;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SaveConnectionCommand {
    data: ModelConnection;
    meta: CommandMeta;
  }
  export interface ModelConnection {
    display_name: DisplayName;
    endpoint: Endpoint;
    id?: Id;
    protocol: Protocol;
    provider_preset_id?: ProviderPresetId;
    secret_ref?: SecretRef;
    version?: Version;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SaveConnectionCommand = SaveConnectionCommandSchema.SaveConnectionCommand;

export namespace SaveExecutionEnvironmentCommandSchema {
  export type CwdMode = 'attempt' | 'package_copy';
  export type DependencyManifestPaths = string[] | null;
  export type Env = {
    [k: string]: string;
  } | null;
  export type ExecutablePath = string;
  export type Id = string;
  export type Kind = 'python' | 'node' | 'powershell' | 'bash';
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SaveExecutionEnvironmentCommand {
    data: SaveExecutionEnvironment;
    meta: CommandMeta;
  }
  export interface SaveExecutionEnvironment {
    cwd_mode?: CwdMode;
    dependency_manifest_paths?: DependencyManifestPaths;
    env?: Env;
    executable_path: ExecutablePath;
    id?: Id;
    kind: Kind;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SaveExecutionEnvironmentCommand = SaveExecutionEnvironmentCommandSchema.SaveExecutionEnvironmentCommand;

export namespace SaveMemoryPolicyCommandSchema {
  export type AutoOrganize = boolean;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelProfileId = string | null;
  export type ReadProfile = boolean;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Version = number;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SaveMemoryPolicyCommand {
    data: MemoryPolicy;
    meta: CommandMeta;
  }
  export interface MemoryPolicy {
    auto_organize?: AutoOrganize;
    maintenance_limits?: RunLimits;
    model_profile_id?: ModelProfileId;
    read_profile?: ReadProfile;
    scope: ScopeRef;
    version?: Version;
  }
  export interface RunLimits {
    deadline_seconds?: DeadlineSeconds;
    max_cost_units?: MaxCostUnits;
    max_delegation_depth?: MaxDelegationDepth;
    max_model_requests?: MaxModelRequests;
    max_parallel_agents?: MaxParallelAgents;
    max_steps?: MaxSteps;
    max_tasks?: MaxTasks;
    max_total_tokens?: MaxTotalTokens;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SaveMemoryPolicyCommand = SaveMemoryPolicyCommandSchema.SaveMemoryPolicyCommand;

export namespace SaveModelCommandSchema {
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ContextWindowTokens = number | null;
  export type DisplayName = string | null;
  export type Id = string;
  export type MaxOutputTokens = number;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = number | string | null;
  export type CacheWritePerMillion = number | string | null;
  export type Currency = 'USD';
  export type InputPerMillion = number | string | null;
  export type ModelId1 = string | null;
  export type Multiplier = number | string | null;
  export type OutputPerMillion = number | string | null;
  export type ProviderId = string | null;
  export type RequestTimeoutSeconds = number;
  export type Version = number;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SaveModelCommand {
    data: ModelProfile;
    meta: CommandMeta;
  }
  export interface ModelProfile {
    capabilities?: ModelCapabilities;
    connection_id: ConnectionId;
    context_window_tokens?: ContextWindowTokens;
    display_name?: DisplayName;
    id?: Id;
    max_output_tokens?: MaxOutputTokens;
    model_id: ModelId;
    openai_max_tokens_field?: OpenaiMaxTokensField;
    pricing?: ModelPricing;
    request_timeout_seconds?: RequestTimeoutSeconds;
    version?: Version;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output?: StructuredOutput;
    thinking?: Thinking;
    tools?: Tools;
    vision?: Vision;
  }
  export interface ModelPricing {
    cache_read_per_million?: CacheReadPerMillion;
    cache_write_per_million?: CacheWritePerMillion;
    currency?: Currency;
    input_per_million?: InputPerMillion;
    model_id?: ModelId1;
    multiplier?: Multiplier;
    output_per_million?: OutputPerMillion;
    provider_id?: ProviderId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SaveModelCommand = SaveModelCommandSchema.SaveModelCommand;

export namespace SaveSkillExecutionPermissionCommandSchema {
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type Status = 'active' | 'revoked';
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SaveSkillExecutionPermissionCommand {
    data: SkillExecutionPermission;
    meta: CommandMeta;
  }
  export interface SkillExecutionPermission {
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    id?: Id;
    revision?: Revision;
    scope: ScopeRef;
    skill_id: SkillId;
    status?: Status;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SaveSkillExecutionPermissionCommand = SaveSkillExecutionPermissionCommandSchema.SaveSkillExecutionPermissionCommand;

export namespace SaveSkillExportCommandSchema {
  export type ConfirmedTargetHash = string | null;
  export type ContentHash = string;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type TargetRef = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SaveSkillExportCommand {
    data: SaveSkillExport;
    meta: CommandMeta;
  }
  export interface SaveSkillExport {
    confirmed_target_hash?: ConfirmedTargetHash;
    content_hash: ContentHash;
    scope: ScopeRef;
    skill_id: SkillId;
    target_ref: TargetRef;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SaveSkillExportCommand = SaveSkillExportCommandSchema.SaveSkillExportCommand;

export namespace SaveTitlePolicyCommandSchema {
  export type ConnectionVersion = number;
  export type Endpoint = string;
  export type MaxCostUnits = string | null;
  export type MaxRequests = number;
  export type MaxTokens = number;
  export type ModelProfileId = string;
  export type ModelVersion = number;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SaveTitlePolicyCommand {
    data: SaveTitlePolicy;
    meta: CommandMeta;
  }
  export interface SaveTitlePolicy {
    binding: TitleModelBinding | null;
  }
  export interface TitleModelBinding {
    connection_version: ConnectionVersion;
    endpoint: Endpoint;
    max_cost_units?: MaxCostUnits;
    max_requests: MaxRequests;
    max_tokens: MaxTokens;
    model_profile_id: ModelProfileId;
    model_version: ModelVersion;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SaveTitlePolicyCommand = SaveTitlePolicyCommandSchema.SaveTitlePolicyCommand;

export namespace ScopeRefSchema {
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;

  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type ScopeRef = ScopeRefSchema.ScopeRef;

export namespace ScopeStateSchema {
  export type Epoch = number;
  export type Id = string;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type Status = 'active' | 'revoked' | 'deleted';

  export interface ScopeState {
    epoch: Epoch;
    id: Id;
    scope: ScopeRef;
    status: Status;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type ScopeState = ScopeStateSchema.ScopeState;

export namespace SessionSchema {
  export type AgentProfileId = string;
  export type Archived = boolean;
  export type AutomaticTitle = 'pending' | number | null;
  export type Id = string;
  export type Kind = 'interaction' | 'execution';
  export type Title = string;
  export type Version = number;
  export type WorkspaceId = string;

  export interface Session {
    agent_profile_id: AgentProfileId;
    archived: Archived;
    automatic_title?: AutomaticTitle;
    id: Id;
    kind: Kind;
    title: Title;
    version: Version;
    workspace_id: WorkspaceId;
  }

}
export type Session = SessionSchema.Session;

export namespace SessionContextSchema {
  export type CachedInputTokens = number | null;
  export type CalculatedUnits = string | null;
  export type Compaction = boolean;
  export type CostPending = true | null;
  export type FileChanged = boolean;
  export type Changed = boolean;
  export type End = number | null;
  export type LineCount = number | null;
  export type Name = string;
  export type Origin = ('attached' | 'inherited') | null;
  export type SizeBytes = number | null;
  export type Start = number | null;
  export type TotalChars = number | null;
  export type Files = ContextFile[];
  export type HiddenFileCount = number;
  export type Id = string;
  export type InputLimit = number | null;
  export type InputTokens = number | null;
  export type Kind = 'model' | 'inspect' | 'read';
  export type Model = string | null;
  export type OutputTokens = number | null;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type Items = ContextActivity[];
  export type NextCursor = string | null;
  export type Watermark = string;
  export type Files1 = ContextFile[];
  export type HiddenFileCount1 = number;
  export type ActivityId = string | null;
  export type CompactedMessageCount = number;
  export type CompactionReason = string | null;
  export type CompactionState = 'none' | 'running' | 'committed' | 'blocked' | 'invalidated';
  export type OmittedGroupCount = number;
  export type OmittedMessageCount = number;
  export type State1 = ('prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain') | null;
  export type SummaryCount = number;
  export type FileChanged1 = true | null;
  export type ReplacementFileIds = string[];
  export type RunId = string;
  export type SourceAttention = boolean;
  export type State2 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type UnitsPerCurrency = string;

  export interface SessionContext {
    activities: PageContextActivity;
    files: Files1;
    hidden_file_count: HiddenFileCount1;
    history: ContextUsageSummary | null;
    latest_request: ContextActivity | null;
    round: ContextRound | null;
    units_per_currency: UnitsPerCurrency;
  }
  export interface PageContextActivity {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface ContextActivity {
    cached_input_tokens: CachedInputTokens;
    calculated_units: CalculatedUnits;
    compaction: Compaction;
    cost_pending?: CostPending;
    file_changed: FileChanged;
    files: Files;
    hidden_file_count: HiddenFileCount;
    id: Id;
    input_limit: InputLimit;
    input_tokens: InputTokens;
    kind: Kind;
    model: Model;
    output_tokens: OutputTokens;
    state: State;
  }
  export interface ContextFile {
    changed: Changed;
    end: End;
    line_count: LineCount;
    name: Name;
    origin: Origin;
    size_bytes: SizeBytes;
    start: Start;
    total_chars: TotalChars;
  }
  export interface ContextUsageSummary {
    activity_id: ActivityId;
    compacted_message_count: CompactedMessageCount;
    compaction_reason: CompactionReason;
    compaction_state: CompactionState;
    omitted_group_count: OmittedGroupCount;
    omitted_message_count: OmittedMessageCount;
    reason_counts: ReasonCounts;
    state: State1;
    summary_count: SummaryCount;
  }
  export interface ReasonCounts {
    [k: string]: number;
  }
  export interface ContextRound {
    file_changed?: FileChanged1;
    replacement_file_ids?: ReplacementFileIds;
    run_id: RunId;
    source_attention: SourceAttention;
    state: State2;
  }

}
export type SessionContext = SessionContextSchema.SessionContext;

export namespace SessionContextUsageSchema {
  export type CacheReportedInputTokens = number;
  export type CacheReportedRequests = number;
  export type CachedInputTokens = number;
  export type CachedTokensWithReportedInput = number;
  export type CalculatedUnits = string;
  export type InputReportedRequests = number;
  export type InputTokens = number;
  export type OutputReportedRequests = number;
  export type OutputTokens = number;
  export type PendingCostRequests = number;
  export type Requests = number;
  export type UnitsPerCurrency = string;
  export type UnknownCostRequests = number;

  export interface SessionContextUsage {
    cache_reported_input_tokens: CacheReportedInputTokens;
    cache_reported_requests: CacheReportedRequests;
    cached_input_tokens: CachedInputTokens;
    cached_tokens_with_reported_input: CachedTokensWithReportedInput;
    calculated_units: CalculatedUnits;
    input_reported_requests: InputReportedRequests;
    input_tokens: InputTokens;
    output_reported_requests: OutputReportedRequests;
    output_tokens: OutputTokens;
    pending_cost_requests: PendingCostRequests;
    requests: Requests;
    units_per_currency: UnitsPerCurrency;
    unknown_cost_requests: UnknownCostRequests;
  }

}
export type SessionContextUsage = SessionContextUsageSchema.SessionContextUsage;

export namespace SessionInboxEntrySchema {
  export type AssistantName = string | null;
  export type Attempts = number;
  export type ExecutionSessionId = string;
  export type Id = string;
  export type InboxEntryId = string | null;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId = string;
  export type TargetTaskId = string;
  export type TaskId = string;
  export type Consumers = ResultConsumption[];
  export type DeliveryState = 'pending' | 'delivered' | 'failed' | 'invalidated';
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Id1 = string;
  export type LastError = string | null;
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId1 = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId1 = string;
  export type ResultVersion1 = number;
  export type SourceEventId = string;
  export type SourceValid = boolean;
  export type TargetSessionId = string;
  export type TaskName = string | null;
  export type Version = number;
  export type ViewedAt = string | null;

  export interface SessionInboxEntry {
    assistant_name?: AssistantName;
    attempts: Attempts;
    consumers: Consumers;
    delivery_state: DeliveryState;
    dependencies: Dependencies;
    id: Id1;
    last_error: LastError;
    result: TaskHandle;
    result_version: ResultVersion1;
    source_event_id: SourceEventId;
    source_valid: SourceValid;
    target_session_id: TargetSessionId;
    task_name?: TaskName;
    version: Version;
    viewed_at: ViewedAt;
  }
  export interface ResultConsumption {
    execution_session_id: ExecutionSessionId;
    id: Id;
    inbox_entry_id: InboxEntryId;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId;
    target_task_id: TargetTaskId;
    task_id: TaskId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId1;
    submitted_state: SubmittedState;
    task_id: TaskId1;
  }

}
export type SessionInboxEntry = SessionInboxEntrySchema.SessionInboxEntry;

export namespace SessionPageSchema {
  export type AgentProfileId = string;
  export type Archived = boolean;
  export type AutomaticTitle = 'pending' | number | null;
  export type Id = string;
  export type Kind = 'interaction' | 'execution';
  export type Title = string;
  export type Version = number;
  export type WorkspaceId = string;
  export type Items = Session[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface SessionPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface Session {
    agent_profile_id: AgentProfileId;
    archived: Archived;
    automatic_title?: AutomaticTitle;
    id: Id;
    kind: Kind;
    title: Title;
    version: Version;
    workspace_id: WorkspaceId;
  }

}
export type SessionPage = SessionPageSchema.SessionPage;

export namespace SessionResultPageSchema {
  export type AssistantName = string | null;
  export type Attempts = number;
  export type ExecutionSessionId = string;
  export type Id = string;
  export type InboxEntryId = string | null;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId = string;
  export type TargetTaskId = string;
  export type TaskId = string;
  export type Consumers = ResultConsumption[];
  export type DeliveryState = 'pending' | 'delivered' | 'failed' | 'invalidated';
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Id1 = string;
  export type LastError = string | null;
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId1 = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId1 = string;
  export type ResultVersion1 = number;
  export type SourceEventId = string;
  export type SourceValid = boolean;
  export type TargetSessionId = string;
  export type TaskName = string | null;
  export type Version = number;
  export type ViewedAt = string | null;
  export type Items = SessionInboxEntry[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface SessionResultPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface SessionInboxEntry {
    assistant_name?: AssistantName;
    attempts: Attempts;
    consumers: Consumers;
    delivery_state: DeliveryState;
    dependencies: Dependencies;
    id: Id1;
    last_error: LastError;
    result: TaskHandle;
    result_version: ResultVersion1;
    source_event_id: SourceEventId;
    source_valid: SourceValid;
    target_session_id: TargetSessionId;
    task_name?: TaskName;
    version: Version;
    viewed_at: ViewedAt;
  }
  export interface ResultConsumption {
    execution_session_id: ExecutionSessionId;
    id: Id;
    inbox_entry_id: InboxEntryId;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId;
    target_task_id: TargetTaskId;
    task_id: TaskId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId1;
    submitted_state: SubmittedState;
    task_id: TaskId1;
  }

}
export type SessionResultPage = SessionResultPageSchema.SessionResultPage;

export namespace SessionRunPageSchema {
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type AttachedFileIds = string[] | null;
  export type BudgetGroupId = string;
  export type BudgetId = string;
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DeadlineAt = string;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type SourceVersion = string;
  export type FollowUpClosed = boolean;
  export type Id2 = string;
  export type InteractionSessionId = string | null;
  export type Kind1 = 'user' | 'managed' | 'follow_up' | 'maintenance';
  export type Output = AgentResult | RunOutput | null;
  export type ArtifactIds = string[];
  export type EvidenceRefs = string[];
  export type Reason = string;
  export type ResultVersion = number;
  export type TaskId = string;
  export type HandledFailures = FailureDisposition[];
  export type Status = 'completed' | 'partial' | 'failed';
  export type JsonValue = unknown;
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Verification = string[];
  export type ArtifactIds1 = string[];
  export type HandledFailures1 = FailureDisposition[];
  export type Summary1 = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved1 = string[];
  export type Reason1 = string | null;
  export type RootTaskId = string;
  export type ScopeDependencies = ScopeDependency[];
  export type ExcludedSourceIds = string[];
  export type Kind2 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type State =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version3 = number;
  export type VisionSourceRunId = string | null;
  export type WorkspaceId1 = string;
  export type YieldRequested = boolean;
  export type Items = RunSnapshot[];
  export type EventId = string;
  export type ModelProfileId = string;
  export type ReasoningEffort1 = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type SessionId1 = string;
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface SessionRunPage {
    items: Items;
    last_model_use?: ChatModelUse | null;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface RunSnapshot {
    admission_generations: AdmissionGenerations;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    attached_file_ids?: AttachedFileIds;
    budget_group_id: BudgetGroupId;
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    follow_up_closed: FollowUpClosed;
    id: Id2;
    interaction_session_id: InteractionSessionId;
    kind: Kind1;
    output: Output;
    reason: Reason1;
    root_task_id: RootTaskId;
    scope_dependencies: ScopeDependencies;
    sources: SourceSelection;
    state: State;
    version: Version3;
    vision_source_run_id: VisionSourceRunId;
    workspace_id: WorkspaceId1;
    yield_requested: YieldRequested;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface AgentResult {
    artifact_ids: ArtifactIds;
    evidence_refs: EvidenceRefs;
    handled_failures: HandledFailures;
    status: Status;
    structured_result: JsonValue;
    summary: Summary;
    unresolved: Unresolved;
    verification: Verification;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion;
    task_id: TaskId;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds1;
    handled_failures: HandledFailures1;
    summary: Summary1;
    unresolved: Unresolved1;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind2;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface ChatModelUse {
    event_id: EventId;
    model_profile_id: ModelProfileId;
    reasoning_effort: ReasoningEffort1;
    session_id: SessionId1;
  }

}
export type SessionRunPage = SessionRunPageSchema.SessionRunPage;

export namespace SetWorkspaceDirectoryCommandSchema {
  export type ResourceId = string | null;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SetWorkspaceDirectoryCommand {
    data: SetWorkspaceDirectory;
    meta: CommandMeta;
  }
  export interface SetWorkspaceDirectory {
    resource_id: ResourceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SetWorkspaceDirectoryCommand = SetWorkspaceDirectoryCommandSchema.SetWorkspaceDirectoryCommand;

export namespace SkillBindingSchema {
  export type Enabled = boolean;
  export type EnvironmentId = string | null;
  export type EnvironmentRevision = number | null;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;

  export interface SkillBinding {
    enabled: Enabled;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    id: Id;
    revision: Revision;
    scope: ScopeRef;
    skill_id: SkillId;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type SkillBinding = SkillBindingSchema.SkillBinding;

export namespace SkillCandidateSchema {
  export type AllowedTools = string | null;
  export type BaseHash = string | null;
  export type Compatibility = string | null;
  export type ContentHash = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Description = string;
  export type DirectoryName = string;
  export type ContentHash1 = string;
  export type Path = string;
  export type SizeBytes = number;
  export type Files = SkillFile[];
  export type Id = string;
  export type License = string | null;
  export type Name = string;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type ActivityId = string | null;
  export type AttemptId = string | null;
  export type BaseHash1 = string | null;
  export type CommandId = string;
  export type Kind1 = 'external' | 'user_created' | 'user_edited' | 'generated';
  export type ResourceId = string | null;
  export type ResourceVersion = number | null;
  export type RunId = string | null;
  export type SourceVersion = string | null;
  export type TaskId = string | null;
  export type StagingRef = string;

  export interface SkillCandidate {
    allowed_tools: AllowedTools;
    base_hash: BaseHash;
    compatibility: Compatibility;
    content_hash: ContentHash;
    dependencies: Dependencies;
    description: Description;
    directory_name: DirectoryName;
    files: Files;
    id: Id;
    license: License;
    metadata: Metadata;
    name: Name;
    scope: ScopeRef;
    skill_id: SkillId;
    source: SkillSource;
    staging_ref: StagingRef;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface SkillFile {
    content_hash: ContentHash1;
    path: Path;
    size_bytes: SizeBytes;
  }
  export interface Metadata {
    [k: string]: string;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillSource {
    activity_id: ActivityId;
    attempt_id: AttemptId;
    base_hash: BaseHash1;
    command_id: CommandId;
    kind: Kind1;
    resource_id: ResourceId;
    resource_version: ResourceVersion;
    run_id: RunId;
    source_version: SourceVersion;
    task_id: TaskId;
  }

}
export type SkillCandidate = SkillCandidateSchema.SkillCandidate;

export namespace SkillCandidateDeletionSchema {
  export type Discarded = true;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type StagingRef = string;

  export interface SkillCandidateDeletion {
    discarded: Discarded;
    scope: ScopeRef;
    skill_id: SkillId;
    staging_ref: StagingRef;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type SkillCandidateDeletion = SkillCandidateDeletionSchema.SkillCandidateDeletion;

export namespace SkillExecutionPermissionSchema {
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type Status = 'active' | 'revoked';

  export interface SkillExecutionPermission {
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    id: Id;
    revision: Revision;
    scope: ScopeRef;
    skill_id: SkillId;
    status: Status;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type SkillExecutionPermission = SkillExecutionPermissionSchema.SkillExecutionPermission;

export namespace SkillExportReceiptSchema {
  export type BackupMatches = boolean | null;
  export type BackupPath = string | null;
  export type CleanupPending = boolean;
  export type CommandId = string;
  export type ContentHash = string;
  export type Disposition = 'pending' | 'restored' | 'finalized' | 'released';
  export type Reason = string | null;
  export type SkillId = string;
  export type StageMatches = boolean | null;
  export type StagePath = string;
  export type State = 'saved' | 'original' | 'needs_restore' | 'conflict';
  export type TargetIdentity = string | null;
  export type TargetMatches = 'published' | 'original' | 'missing' | 'other' | 'unknown';
  export type TargetPath = string;
  export type TargetRef = string;
  export type ZipHash = string;

  export interface SkillExportReceipt {
    backup_matches: BackupMatches;
    backup_path: BackupPath;
    cleanup_pending: CleanupPending;
    command_id: CommandId;
    content_hash: ContentHash;
    disposition: Disposition;
    reason: Reason;
    skill_id: SkillId;
    stage_matches: StageMatches;
    stage_path: StagePath;
    state: State;
    target_identity: TargetIdentity;
    target_matches: TargetMatches;
    target_path: TargetPath;
    target_ref: TargetRef;
    zip_hash: ZipHash;
  }

}
export type SkillExportReceipt = SkillExportReceiptSchema.SkillExportReceipt;

export namespace SkillExportReceiptListSchema {
  export type BackupMatches = boolean | null;
  export type BackupPath = string | null;
  export type CleanupPending = boolean;
  export type CommandId = string;
  export type ContentHash = string;
  export type Disposition = 'pending' | 'restored' | 'finalized' | 'released';
  export type Reason = string | null;
  export type SkillId = string;
  export type StageMatches = boolean | null;
  export type StagePath = string;
  export type State = 'saved' | 'original' | 'needs_restore' | 'conflict';
  export type TargetIdentity = string | null;
  export type TargetMatches = 'published' | 'original' | 'missing' | 'other' | 'unknown';
  export type TargetPath = string;
  export type TargetRef = string;
  export type ZipHash = string;
  export type SkillExportReceiptList = SkillExportReceipt[];

  export interface SkillExportReceipt {
    backup_matches: BackupMatches;
    backup_path: BackupPath;
    cleanup_pending: CleanupPending;
    command_id: CommandId;
    content_hash: ContentHash;
    disposition: Disposition;
    reason: Reason;
    skill_id: SkillId;
    stage_matches: StageMatches;
    stage_path: StagePath;
    state: State;
    target_identity: TargetIdentity;
    target_matches: TargetMatches;
    target_path: TargetPath;
    target_ref: TargetRef;
    zip_hash: ZipHash;
  }

}
export type SkillExportReceiptList = SkillExportReceiptListSchema.SkillExportReceiptList;

export namespace SkillFileSliceSchema {
  export type Content = string;
  export type ContentHash = string;
  export type Encoding = 'utf-8' | 'base64';
  export type End = number;
  export type FileHash = string;
  export type Path = string;
  export type SkillId = string;
  export type Start = number;
  export type Total = number;

  export interface SkillFileSlice {
    content: Content;
    content_hash: ContentHash;
    encoding: Encoding;
    end: End;
    file_hash: FileHash;
    path: Path;
    skill_id: SkillId;
    start: Start;
    total: Total;
  }

}
export type SkillFileSlice = SkillFileSliceSchema.SkillFileSlice;

export namespace SkillPageSchema {
  export type Enabled = boolean;
  export type EnvironmentId = string | null;
  export type EnvironmentRevision = number | null;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type Readiness = 'content_available' | 'source_unavailable';
  export type AllowedTools = string | null;
  export type Compatibility = string | null;
  export type ContentHash = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Description = string;
  export type DirectoryName = string;
  export type ContentHash1 = string;
  export type Path = string;
  export type SizeBytes = number;
  export type Files = SkillFile[];
  export type License = string | null;
  export type Name = string;
  export type SkillId1 = string;
  export type ActivityId = string | null;
  export type AttemptId = string | null;
  export type BaseHash = string | null;
  export type CommandId = string;
  export type Kind1 = 'external' | 'user_created' | 'user_edited' | 'generated';
  export type ResourceId = string | null;
  export type ResourceVersion = number | null;
  export type RunId = string | null;
  export type SourceVersion = string | null;
  export type TaskId = string | null;
  export type Items = SkillView[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface SkillPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface SkillView {
    binding: SkillBinding | null;
    readiness: Readiness;
    version: SkillVersion;
  }
  export interface SkillBinding {
    enabled: Enabled;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    id: Id;
    revision: Revision;
    scope: ScopeRef;
    skill_id: SkillId;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillVersion {
    allowed_tools: AllowedTools;
    compatibility: Compatibility;
    content_hash: ContentHash;
    dependencies: Dependencies;
    description: Description;
    directory_name: DirectoryName;
    files: Files;
    license: License;
    metadata: Metadata;
    name: Name;
    scope: ScopeRef;
    skill_id: SkillId1;
    source: SkillSource;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface SkillFile {
    content_hash: ContentHash1;
    path: Path;
    size_bytes: SizeBytes;
  }
  export interface Metadata {
    [k: string]: string;
  }
  export interface SkillSource {
    activity_id: ActivityId;
    attempt_id: AttemptId;
    base_hash: BaseHash;
    command_id: CommandId;
    kind: Kind1;
    resource_id: ResourceId;
    resource_version: ResourceVersion;
    run_id: RunId;
    source_version: SourceVersion;
    task_id: TaskId;
  }

}
export type SkillPage = SkillPageSchema.SkillPage;

export namespace SkillRecordSchema {
  export type CurrentHash = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type Status = 'active' | 'deleted';

  export interface SkillRecord {
    current_hash: CurrentHash;
    revision: Revision;
    scope: ScopeRef;
    skill_id: SkillId;
    status: Status;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type SkillRecord = SkillRecordSchema.SkillRecord;

export namespace SkillResolutionSchema {
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type ContentHash = string;
  export type Description = string;
  export type Name = string;
  export type SkillId = string;
  export type Entries = SkillSummary[];

  export interface SkillResolution {
    dependencies: Dependencies;
    entries: Entries;
    versions: Versions;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface SkillSummary {
    content_hash: ContentHash;
    description: Description;
    name: Name;
    skill_id: SkillId;
  }
  export interface Versions {
    /**
     * This interface was referenced by `Versions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type SkillResolution = SkillResolutionSchema.SkillResolution;

export namespace SkillScopeRequestSchema {
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;

  export interface SkillScopeRequest {
    scope: ScopeRef;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }

}
export type SkillScopeRequest = SkillScopeRequestSchema.SkillScopeRequest;

export namespace SkillScriptSettingsSchema {
  export type Enabled = boolean;
  export type EnvironmentId = string | null;
  export type EnvironmentRevision = number | null;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type ContentHash = string;
  export type ContentHash1 = string;
  export type EnvironmentId1 = string;
  export type EnvironmentRevision1 = number;
  export type Id1 = string;
  export type Revision1 = number;
  export type SkillId1 = string;
  export type Status = 'active' | 'revoked';
  export type Permissions = SkillExecutionPermission[];
  export type Scripts = string[];
  export type SkillId2 = string;

  export interface SkillScriptSettings {
    binding: SkillBinding | null;
    content_hash: ContentHash;
    permissions: Permissions;
    scope: ScopeRef;
    scripts: Scripts;
    skill_id: SkillId2;
  }
  export interface SkillBinding {
    enabled: Enabled;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    id: Id;
    revision: Revision;
    scope: ScopeRef;
    skill_id: SkillId;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermission {
    content_hash: ContentHash1;
    environment_id: EnvironmentId1;
    environment_revision: EnvironmentRevision1;
    id: Id1;
    revision: Revision1;
    scope: ScopeRef;
    skill_id: SkillId1;
    status: Status;
  }

}
export type SkillScriptSettings = SkillScriptSettingsSchema.SkillScriptSettings;

export namespace SkillSummarySchema {
  export type ContentHash = string;
  export type Description = string;
  export type Name = string;
  export type SkillId = string;

  export interface SkillSummary {
    content_hash: ContentHash;
    description: Description;
    name: Name;
    skill_id: SkillId;
  }

}
export type SkillSummary = SkillSummarySchema.SkillSummary;

export namespace SkillVersionSchema {
  export type AllowedTools = string | null;
  export type Compatibility = string | null;
  export type ContentHash = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Description = string;
  export type DirectoryName = string;
  export type ContentHash1 = string;
  export type Path = string;
  export type SizeBytes = number;
  export type Files = SkillFile[];
  export type License = string | null;
  export type Name = string;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type ActivityId = string | null;
  export type AttemptId = string | null;
  export type BaseHash = string | null;
  export type CommandId = string;
  export type Kind1 = 'external' | 'user_created' | 'user_edited' | 'generated';
  export type ResourceId = string | null;
  export type ResourceVersion = number | null;
  export type RunId = string | null;
  export type SourceVersion = string | null;
  export type TaskId = string | null;

  export interface SkillVersion {
    allowed_tools: AllowedTools;
    compatibility: Compatibility;
    content_hash: ContentHash;
    dependencies: Dependencies;
    description: Description;
    directory_name: DirectoryName;
    files: Files;
    license: License;
    metadata: Metadata;
    name: Name;
    scope: ScopeRef;
    skill_id: SkillId;
    source: SkillSource;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface SkillFile {
    content_hash: ContentHash1;
    path: Path;
    size_bytes: SizeBytes;
  }
  export interface Metadata {
    [k: string]: string;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillSource {
    activity_id: ActivityId;
    attempt_id: AttemptId;
    base_hash: BaseHash;
    command_id: CommandId;
    kind: Kind1;
    resource_id: ResourceId;
    resource_version: ResourceVersion;
    run_id: RunId;
    source_version: SourceVersion;
    task_id: TaskId;
  }

}
export type SkillVersion = SkillVersionSchema.SkillVersion;

export namespace SkillViewSchema {
  export type Enabled = boolean;
  export type EnvironmentId = string | null;
  export type EnvironmentRevision = number | null;
  export type Id = string;
  export type Revision = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string;
  export type Readiness = 'content_available' | 'source_unavailable';
  export type AllowedTools = string | null;
  export type Compatibility = string | null;
  export type ContentHash = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Description = string;
  export type DirectoryName = string;
  export type ContentHash1 = string;
  export type Path = string;
  export type SizeBytes = number;
  export type Files = SkillFile[];
  export type License = string | null;
  export type Name = string;
  export type SkillId1 = string;
  export type ActivityId = string | null;
  export type AttemptId = string | null;
  export type BaseHash = string | null;
  export type CommandId = string;
  export type Kind1 = 'external' | 'user_created' | 'user_edited' | 'generated';
  export type ResourceId = string | null;
  export type ResourceVersion = number | null;
  export type RunId = string | null;
  export type SourceVersion = string | null;
  export type TaskId = string | null;

  export interface SkillView {
    binding: SkillBinding | null;
    readiness: Readiness;
    version: SkillVersion;
  }
  export interface SkillBinding {
    enabled: Enabled;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    id: Id;
    revision: Revision;
    scope: ScopeRef;
    skill_id: SkillId;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillVersion {
    allowed_tools: AllowedTools;
    compatibility: Compatibility;
    content_hash: ContentHash;
    dependencies: Dependencies;
    description: Description;
    directory_name: DirectoryName;
    files: Files;
    license: License;
    metadata: Metadata;
    name: Name;
    scope: ScopeRef;
    skill_id: SkillId1;
    source: SkillSource;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface SkillFile {
    content_hash: ContentHash1;
    path: Path;
    size_bytes: SizeBytes;
  }
  export interface Metadata {
    [k: string]: string;
  }
  export interface SkillSource {
    activity_id: ActivityId;
    attempt_id: AttemptId;
    base_hash: BaseHash;
    command_id: CommandId;
    kind: Kind1;
    resource_id: ResourceId;
    resource_version: ResourceVersion;
    run_id: RunId;
    source_version: SourceVersion;
    task_id: TaskId;
  }

}
export type SkillView = SkillViewSchema.SkillView;

export namespace SourceSelectionSchema {
  export type ExcludedSourceIds = string[];
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];

  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type SourceSelection = SourceSelectionSchema.SourceSelection;

export namespace StageSkillCommandSchema {
  export type BaseHash = string | null;
  export type DirectoryName = string;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SkillId = string | null;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface StageSkillCommand {
    data: StageSkill;
    meta: CommandMeta;
  }
  export interface StageSkill {
    base_hash?: BaseHash;
    directory_name: DirectoryName;
    files: Files;
    scope: ScopeRef;
    skill_id?: SkillId;
  }
  export interface Files {
    [k: string]: string;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type StageSkillCommand = StageSkillCommandSchema.StageSkillCommand;

export namespace StartRunCommandSchema {
  export type AgentProfileId = string;
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type InheritSessionFiles = boolean;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelProfileId = string;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ModelVersion = number;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type SourceResult = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type Text = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface StartRunCommand {
    data: StartRequest;
    meta: CommandMeta;
  }
  export interface StartRequest {
    agent_profile_id: AgentProfileId;
    allow_follow_up?: AllowFollowUp;
    allow_managed?: AllowManaged;
    inherit_session_files?: InheritSessionFiles;
    limits?: RunLimits;
    model_profile_id: ModelProfileId;
    model_selection?: ModelSelection | null;
    reasoning_effort?: ReasoningEffort;
    session_file_adoptions?: SessionFileAdoptions;
    source_result?: SourceResult;
    sources?: SourceSelection;
    text: Text;
  }
  export interface RunLimits {
    deadline_seconds?: DeadlineSeconds;
    max_cost_units?: MaxCostUnits;
    max_delegation_depth?: MaxDelegationDepth;
    max_model_requests?: MaxModelRequests;
    max_parallel_agents?: MaxParallelAgents;
    max_steps?: MaxSteps;
    max_tasks?: MaxTasks;
    max_total_tokens?: MaxTotalTokens;
  }
  export interface ModelSelection {
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    model_version: ModelVersion;
  }
  export interface SessionFileAdoptions {
    /**
     * This interface was referenced by `SessionFileAdoptions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface SourceSelection {
    excluded_source_ids?: ExcludedSourceIds;
    memory_scopes?: MemoryScopes;
    resource_ids?: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions?: SkillVersions;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type StartRunCommand = StartRunCommandSchema.StartRunCommand;

export namespace SteeringCommandSchema {
  export type Text = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SteeringCommand {
    data: Steering;
    meta: CommandMeta;
  }
  export interface Steering {
    text: Text;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SteeringCommand = SteeringCommandSchema.SteeringCommand;

export namespace StopAllReceiptSchema {
  export type CancelledRunIds = string[];
  export type Generation = number;
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;

  export interface StopAllReceipt {
    cancelled_run_ids: CancelledRunIds;
    generation: Generation;
    scope: ScopeRef;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type StopAllReceipt = StopAllReceiptSchema.StopAllReceipt;

export namespace StreamEventSchema {
  export type StreamEvent = DurableEvent | DeltaEvent;
  export type Event =
    | WorkspaceEvent
    | SessionEvent
    | AgentEvent
    | ModelProfileEvent
    | ModelConnectionEvent
    | ExecutionEvent
    | PolicyEvent
    | LifecycleEvent
    | DeliveryEvent
    | AdmissionEvent
    | MemoryEvent
    | MemoryMaintenanceEvent
    | SkillEvent
    | EnvironmentEvent
    | McpEvent
    | TitlePolicyEvent;
  export type ActivityId = string | null;
  export type CausationId = string | null;
  export type CreatedAt = string;
  export type EventId = string;
  export type EventVersion = 1;
  export type Kind =
    'workspace.created' | 'workspace.default_created' | 'workspace.directory_changed' | 'workspace.renamed';
  export type DirectoryResourceId = string | null;
  export type Id = string;
  export type Name = string;
  export type Version = number;
  export type RunId = string | null;
  export type Seq = number | null;
  export type SessionId = string | null;
  export type TaskId = string | null;
  export type WorkspaceId = string | null;
  export type ActivityId1 = string | null;
  export type CausationId1 = string | null;
  export type CreatedAt1 = string;
  export type EventId1 = string;
  export type EventVersion1 = 1;
  export type Kind1 = 'session.created' | 'session.updated';
  export type AgentProfileId = string;
  export type Archived = boolean;
  export type AutomaticTitle = 'pending' | number | null;
  export type Id1 = string;
  export type Kind2 = 'interaction' | 'execution';
  export type Title = string;
  export type Version1 = number;
  export type WorkspaceId1 = string;
  export type RunId1 = string | null;
  export type Seq1 = number | null;
  export type SessionId1 = string | null;
  export type TaskId1 = string | null;
  export type WorkspaceId2 = string | null;
  export type ActivityId2 = string | null;
  export type CausationId2 = string | null;
  export type CreatedAt2 = string;
  export type EventId2 = string;
  export type EventVersion2 = 1;
  export type Kind3 = 'agent.saved';
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id2 = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version2 = number;
  export type SetDefault = boolean;
  export type RunId2 = string | null;
  export type Seq2 = number | null;
  export type SessionId2 = string | null;
  export type TaskId2 = string | null;
  export type WorkspaceId3 = string | null;
  export type ActivityId3 = string | null;
  export type CausationId3 = string | null;
  export type CreatedAt3 = string;
  export type EventId3 = string;
  export type EventVersion3 = 1;
  export type Kind4 = 'model.saved';
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ContextWindowTokens = number | null;
  export type DisplayName1 = string | null;
  export type Id3 = string;
  export type MaxOutputTokens = number;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type RequestTimeoutSeconds = number;
  export type Version3 = number;
  export type RunId3 = string | null;
  export type Seq3 = number | null;
  export type SessionId3 = string | null;
  export type TaskId3 = string | null;
  export type WorkspaceId4 = string | null;
  export type ActivityId4 = string | null;
  export type CausationId4 = string | null;
  export type CreatedAt4 = string;
  export type EventId4 = string;
  export type EventVersion4 = 1;
  export type Kind5 = 'connection.saved';
  export type DisplayName2 = string;
  export type Endpoint = string;
  export type Id4 = string;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type SecretRef = string | null;
  export type Version4 = number;
  export type RunId4 = string | null;
  export type Seq4 = number | null;
  export type SessionId4 = string | null;
  export type TaskId4 = string | null;
  export type WorkspaceId5 = string | null;
  export type ActivityId5 = string | null;
  export type CausationId5 = string | null;
  export type CreatedAt5 = string;
  export type EventId5 = string;
  export type EventVersion5 = 1;
  export type Kind6 =
    | 'run.started'
    | 'run.cancelled'
    | 'run.resumed'
    | 'run.steered'
    | 'task.stepped'
    | 'activity.prepared'
    | 'activity.dispatched'
    | 'activity.received'
    | 'budget.reserved'
    | 'budget.settled'
    | 'budget.allocated'
    | 'budget.counted'
    | 'budget.returned'
    | 'runtime.recovered'
    | 'artifact.published'
    | 'question.asked'
    | 'question.answered'
    | 'task.submitted'
    | 'task.cancelled'
    | 'task.consumed'
    | 'task.joined'
    | 'wait.registered'
    | 'wait.resolved'
    | 'follow_up.changed'
    | 'command.queued'
    | 'command.applied'
    | 'command.cancelled'
    | 'run.yielded'
    | 'naming.task_changed';
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id5 = string;
  export type Kind7 = 'model' | 'tool';
  export type Operation = string;
  export type RunId5 = string;
  export type AttemptId = string;
  export type CollectionError = string | null;
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type ExitCode = number | null;
  export type ExternalCosts = 'unknown';
  export type ActivityId6 = string;
  export type ContentHash1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id6 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId5 = string;
  export type Version5 = number;
  export type RelativePath = string;
  export type Outputs = ScriptArtifact[];
  export type ScriptRelativePath = string;
  export type SkillId = string;
  export type TerminationReason = 'exited' | 'cancelled' | 'timed_out';
  export type Truncated = boolean;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId6 = string;
  export type CacheReadReported = true | null;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version6 = number;
  export type Activities = ActivityView[];
  export type Artifacts = ArtifactRef[];
  export type Id7 = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelRequests = number;
  export type ReservedTokens = number;
  export type ReservedUnits = string;
  export type RunId6 = string;
  export type SpentUnits = string;
  export type Steps = number;
  export type TaskCount = number;
  export type TotalTokens = number;
  export type Version7 = number;
  export type Budgets = BudgetSnapshot[];
  export type EventId6 = string;
  export type ModelProfileId = string;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type SessionId5 = string;
  export type ExecutionSessionId = string;
  export type Id8 = string;
  export type InboxEntryId = string | null;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId7 = string;
  export type TargetTaskId = string;
  export type TaskId7 = string;
  export type Consumptions = ResultConsumption[];
  export type BudgetGroupId = string;
  export type Id9 = string;
  export type OriginRunId = string;
  export type PausedTaskIds = string[];
  export type PolicyVersion = number;
  export type Reason = string | null;
  export type RunId8 = string | null;
  export type SourceResult = string;
  export type Status1 = 'ready' | 'active' | 'paused' | 'closed';
  export type TargetSessionId = string;
  export type FollowUpIntents = FollowUpIntent[];
  export type ChildResultVersion = number;
  export type ChildTaskId = string;
  export type EventId7 = string;
  export type Id10 = string;
  export type RootTaskId = string;
  export type RunId9 = string;
  export type Joins = JoinFact[];
  export type MessageWatermark = string | null;
  export type ActivityId7 = string | null;
  export type Name1 = string;
  export type ReadGrantIds = string[];
  export type ResourceId = string;
  export type ResourceLineage = string[];
  export type Attachments = MessageAttachment[];
  export type DeliveryIds = string[];
  export type EventId8 = string;
  export type EventIndex = number;
  export type Id11 = string;
  export type Origin = 'conversation' | 'steering' | 'answer' | 'task_result' | 'background_report';
  export type Kind8 = 'text';
  export type Text = string;
  export type Kind9 = 'reasoning';
  export type Text1 = string;
  export type Arguments =
    | {
        [k: string]: JsonValue;
      }
    | string;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Kind10 = 'tool_call';
  export type Name2 = string;
  export type CallId1 = string;
  export type Error1 = string | null;
  export type Kind11 = 'tool_result';
  export type OriginMessageId = string | null;
  export type Parts = (TextPart | ReasoningPart | ToolCallPart | ToolResultPart)[];
  export type PrivateRef = string | null;
  export type Role = 'user' | 'assistant' | 'tool';
  export type RunId10 = string;
  export type SourceDependencies = ScopeDependency[];
  export type SourceValid = boolean | null;
  export type ToolOperation = string | null;
  export type Messages = MessageView[];
  export type CommandId = string;
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency1 = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source1 = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ConnectionId1 = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens1 = number;
  export type DisplayName3 = string | null;
  export type Endpoint1 = string;
  export type Id12 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens1 = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind12 = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source2 = string | null;
  export type VerifiedAt = string | null;
  export type Version8 = string | null;
  export type ModelId2 = string;
  export type OpenaiMaxTokensField1 = ('max_tokens' | 'max_completion_tokens') | null;
  export type Protocol1 = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId1 = string | null;
  export type ReasoningEffort1 = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds1 = number;
  export type SecretRef1 = string | null;
  export type Version9 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type CreatedSeq = number;
  export type DeadlineAt = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type SourceVersion = string;
  export type Dependencies2 = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId11 = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId8 = string;
  export type InboxEntryId1 = string;
  export type ResultVersion1 = number;
  export type SourceEventId = string;
  export type TargetSessionId1 = string;
  export type Reason1 = string | null;
  export type RunId12 = string | null;
  export type ScopeDependencies = ScopeDependency[];
  export type SessionId6 = string;
  export type AgentProfileId1 = string;
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type InheritSessionFiles = boolean;
  export type ModelProfileId1 = string;
  export type ConnectionId2 = string;
  export type ConnectionVersion1 = number;
  export type ModelVersion = number;
  export type ReasoningEffort2 = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type SessionId7 = string;
  export type SourceResult1 = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind13 = 'user_global' | 'workspace' | 'session';
  export type SessionId8 = string | null;
  export type WorkspaceId6 = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type Text2 = string;
  export type State1 = 'queued' | 'applied' | 'cancelled';
  export type PendingCommands = PendingUserCommand[];
  export type AnswerMessageId = string | null;
  export type CallId2 = string;
  export type Dependencies3 = ScopeDependency[];
  export type Id13 = string;
  export type MessageId = string;
  export type Question1 = string;
  export type RunId13 = string;
  export type Status2 = 'pending' | 'answered' | 'cancelled';
  export type TaskId9 = string;
  export type Version10 = number;
  export type Questions = Question[];
  export type AllowFollowUp1 = boolean;
  export type AllowManaged1 = boolean;
  export type AttachedFileIds = string[] | null;
  export type BudgetGroupId1 = string;
  export type BudgetId = string;
  export type DeadlineAt1 = string;
  export type ExecutionSessionId1 = string;
  export type FollowUpClosed = boolean;
  export type Id14 = string;
  export type InteractionSessionId = string | null;
  export type Kind14 = 'user' | 'managed' | 'follow_up' | 'maintenance';
  export type Output = AgentResult | RunOutput | null;
  export type ArtifactIds = string[];
  export type EvidenceRefs = string[];
  export type Reason2 = string;
  export type ResultVersion2 = number;
  export type TaskId10 = string;
  export type HandledFailures = FailureDisposition[];
  export type Status3 = 'completed' | 'partial' | 'failed';
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Verification = string[];
  export type ArtifactIds1 = string[];
  export type HandledFailures1 = FailureDisposition[];
  export type Summary1 = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved1 = string[];
  export type Reason3 = string | null;
  export type RootTaskId1 = string;
  export type ScopeDependencies1 = ScopeDependency[];
  export type State2 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version11 = number;
  export type VisionSourceRunId = string | null;
  export type WorkspaceId7 = string;
  export type YieldRequested = boolean;
  export type Runs = RunSnapshot[];
  export type AdditionalResultInputs = ResultInput[];
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind15 = 'agent';
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type DelegationDepth = number;
  export type ExecutionSessionId2 = string;
  export type InputArtifacts = ArtifactRef[];
  export type InteractionSessionId1 = string | null;
  export type CreatedSeq1 = number;
  export type DeadlineAt2 = string | null;
  export type ExecutorId = string;
  export type Id15 = string;
  export type Kind16 = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason4 = string | null;
  export type ResultVersion3 = number | null;
  export type RunId14 = string;
  export type State3 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version12 = number;
  export type Tasks = TaskSnapshot[];
  export type ContinuationId = string;
  export type DeadlineAt3 = string | null;
  export type Id16 = string;
  export type OwnerTaskId = string;
  export type ResultVersion4 = number | null;
  export type RunId15 = string;
  export type State4 = 'pending' | 'ready' | 'timeout' | 'cancelled';
  export type TargetTaskId1 = string;
  export type Version13 = number;
  export type Waits = WaitRecord[];
  export type RunId16 = string | null;
  export type Seq5 = number | null;
  export type SessionId9 = string | null;
  export type TaskId11 = string | null;
  export type WorkspaceId8 = string | null;
  export type ActivityId8 = string | null;
  export type CausationId6 = string | null;
  export type CreatedAt6 = string;
  export type EventId9 = string;
  export type EventVersion6 = 1;
  export type Kind17 =
    | 'resource.registered'
    | 'resource.updated'
    | 'grant.created'
    | 'grant.revoked'
    | 'approval.proposed'
    | 'approval.decided';
  export type ActivityId9 = string;
  export type ArgsHash = string;
  export type CallId3 = string;
  export type Dependencies4 = ScopeDependency[];
  export type ExpiresAt = string;
  export type ArtifactId = string;
  export type ArtifactVersion = number;
  export type TargetExists = boolean;
  export type TargetPath = string;
  export type Id17 = string;
  export type RunId17 = string;
  export type SessionId10 = string | null;
  export type Status4 = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
  export type Target = string | null;
  export type TaskId12 = string;
  export type ToolName = string;
  export type ToolVersion = string;
  export type Version14 = number;
  export type WorkspaceId9 = string;
  export type Approvals = Approval[];
  export type Destination1 = string | null;
  export type Epoch1 = number;
  export type Id18 = string;
  export type McpQueries = McpToolSnapshot[];
  export type MemoryScopes1 = ScopeRef[];
  /**
   * @minItems 1
   */
  export type Purposes = [
    'read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send',
    ...('read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send')[]
  ];
  export type ResourceIds1 = string[];
  export type Status5 = 'active' | 'revoked';
  export type Version15 = number;
  export type Grants = DataUseGrant[];
  export type Id19 = string;
  export type Kind18 = 'file' | 'directory' | 'export';
  export type Label = string;
  export type SourceVersion1 = string | null;
  export type Version16 = number;
  export type Resources = ResourceRef[];
  export type RunId18 = string | null;
  export type Seq6 = number | null;
  export type SessionId11 = string | null;
  export type TaskId13 = string | null;
  export type WorkspaceId10 = string | null;
  export type ActivityId10 = string | null;
  export type CausationId7 = string | null;
  export type CreatedAt7 = string;
  export type EventId10 = string;
  export type EventVersion7 = 1;
  export type Kind19 = 'scope.deleted' | 'scope.revoked' | 'accounting.settled';
  export type Epoch2 = number;
  export type Status6 = 'deleted';
  export type Deletions = DeletionReceipt[];
  export type Epoch3 = number;
  export type Id20 = string;
  export type Status7 = 'active' | 'revoked' | 'deleted';
  export type Scopes = ScopeState[];
  export type RunId19 = string | null;
  export type Seq7 = number | null;
  export type SessionId12 = string | null;
  export type TaskId14 = string | null;
  export type WorkspaceId11 = string | null;
  export type ActivityId11 = string | null;
  export type CausationId8 = string | null;
  export type CreatedAt8 = string;
  export type EventId11 = string;
  export type EventVersion8 = 1;
  export type Kind20 = 'delivery.changed';
  export type AssistantName = string | null;
  export type Attempts = number;
  export type Consumers = ResultConsumption[];
  export type DeliveryState = 'pending' | 'delivered' | 'failed' | 'invalidated';
  export type Dependencies5 = ScopeDependency[];
  export type Id21 = string;
  export type LastError = string | null;
  export type ResultVersion5 = number;
  export type SourceEventId1 = string;
  export type SourceValid1 = boolean;
  export type TargetSessionId2 = string;
  export type TaskName = string | null;
  export type Version17 = number;
  export type ViewedAt = string | null;
  export type Deliveries = SessionInboxEntry[];
  export type RunId20 = string | null;
  export type Seq8 = number | null;
  export type SessionId13 = string | null;
  export type TaskId15 = string | null;
  export type WorkspaceId12 = string | null;
  export type ActivityId12 = string | null;
  export type CausationId9 = string | null;
  export type CreatedAt9 = string;
  export type EventId12 = string;
  export type EventVersion9 = 1;
  export type Kind21 = 'admission.stopped';
  export type Generation = number;
  export type AdmissionFences = AdmissionFence[];
  export type RunId21 = string | null;
  export type Seq9 = number | null;
  export type SessionId14 = string | null;
  export type TaskId16 = string | null;
  export type WorkspaceId13 = string | null;
  export type ActivityId13 = string | null;
  export type CausationId10 = string | null;
  export type CreatedAt10 = string;
  export type EventId13 = string;
  export type EventVersion10 = 1;
  export type Kind22 = 'memory.changed' | 'memory.policy_changed';
  export type AutoOrganize = boolean;
  export type ModelProfileId2 = string | null;
  export type ReadProfile = boolean;
  export type Version18 = number;
  export type Policies = MemoryPolicy[];
  export type Id22 = string;
  export type Revision = number;
  export type Status8 = 'candidate' | 'confirmed' | 'rejected' | 'deleted';
  export type Records = MemoryNotice[];
  export type RunId22 = string | null;
  export type Seq10 = number | null;
  export type SessionId15 = string | null;
  export type TaskId17 = string | null;
  export type WorkspaceId14 = string | null;
  export type ActivityId14 = string | null;
  export type CausationId11 = string | null;
  export type CreatedAt11 = string;
  export type EventId14 = string;
  export type EventVersion11 = 1;
  export type Kind23 = 'memory.maintenance_changed';
  export type Id23 = string;
  export type PolicyVersion1 = number;
  export type Reason5 = string | null;
  export type EventId15 = string;
  export type RunId23 = string;
  export type RunId24 = string | null;
  export type Seq11 = number | null;
  export type SessionId16 = string | null;
  export type TaskId18 = string | null;
  export type WorkspaceId15 = string | null;
  export type ActivityId15 = string | null;
  export type CausationId12 = string | null;
  export type CreatedAt12 = string;
  export type EventId16 = string;
  export type EventVersion12 = 1;
  export type Kind24 = 'skill.changed';
  export type Revision1 = number;
  export type SkillId1 = string;
  export type Status9 = 'active' | 'deleted';
  export type RunId25 = string | null;
  export type Seq12 = number | null;
  export type SessionId17 = string | null;
  export type TaskId19 = string | null;
  export type WorkspaceId16 = string | null;
  export type ActivityId16 = string | null;
  export type CausationId13 = string | null;
  export type CreatedAt13 = string;
  export type EventId17 = string;
  export type EventVersion13 = 1;
  export type Kind25 = 'environment.changed';
  export type EnvironmentId1 = string;
  export type RunId26 = string | null;
  export type Seq13 = number | null;
  export type SessionId18 = string | null;
  export type TaskId20 = string | null;
  export type WorkspaceId17 = string | null;
  export type ActivityId17 = string | null;
  export type CausationId14 = string | null;
  export type CreatedAt14 = string;
  export type EventId18 = string;
  export type EventVersion14 = 1;
  export type Kind26 = 'mcp.changed';
  export type ConfigRevision1 = number;
  export type ServerId1 = string;
  export type RunId27 = string | null;
  export type Seq14 = number | null;
  export type SessionId19 = string | null;
  export type TaskId21 = string | null;
  export type WorkspaceId18 = string | null;
  export type ActivityId18 = string | null;
  export type CausationId15 = string | null;
  export type CreatedAt15 = string;
  export type EventId19 = string;
  export type EventVersion15 = 1;
  export type Kind27 = 'naming.policy_saved';
  export type ConnectionVersion2 = number;
  export type Endpoint2 = string;
  export type MaxCostUnits1 = string | null;
  export type MaxRequests = number;
  export type MaxTokens = number;
  export type ModelProfileId3 = string;
  export type ModelVersion1 = number;
  export type Version19 = number | null;
  export type WorkspaceId19 = string;
  export type RunId28 = string | null;
  export type Seq15 = number | null;
  export type SessionId20 = string | null;
  export type TaskId22 = string | null;
  export type WorkspaceId20 = string | null;
  export type EventId20 = string;
  export type Kind28 = 'durable';
  export type ActivityId19 = string;
  export type Index = number;
  export type Kind29 = 'delta' | 'reasoning_delta';
  export type Text3 = string;

  export interface DurableEvent {
    event: Event;
    event_id: EventId20;
    kind: Kind28;
  }
  export interface WorkspaceEvent {
    activity_id: ActivityId;
    causation_id: CausationId;
    created_at: CreatedAt;
    event_id: EventId;
    event_version: EventVersion;
    kind: Kind;
    payload: Workspace;
    run_id: RunId;
    seq: Seq;
    session_id: SessionId;
    task_id: TaskId;
    workspace_id: WorkspaceId;
  }
  export interface Workspace {
    directory_resource_id: DirectoryResourceId;
    id: Id;
    name: Name;
    version: Version;
  }
  export interface SessionEvent {
    activity_id: ActivityId1;
    causation_id: CausationId1;
    created_at: CreatedAt1;
    event_id: EventId1;
    event_version: EventVersion1;
    kind: Kind1;
    payload: Session;
    run_id: RunId1;
    seq: Seq1;
    session_id: SessionId1;
    task_id: TaskId1;
    workspace_id: WorkspaceId2;
  }
  export interface Session {
    agent_profile_id: AgentProfileId;
    archived: Archived;
    automatic_title?: AutomaticTitle;
    id: Id1;
    kind: Kind2;
    title: Title;
    version: Version1;
    workspace_id: WorkspaceId1;
  }
  export interface AgentEvent {
    activity_id: ActivityId2;
    causation_id: CausationId2;
    created_at: CreatedAt2;
    event_id: EventId2;
    event_version: EventVersion2;
    kind: Kind3;
    payload: AgentSaved;
    run_id: RunId2;
    seq: Seq2;
    session_id: SessionId2;
    task_id: TaskId2;
    workspace_id: WorkspaceId3;
  }
  export interface AgentSaved {
    profile: AgentProfile;
    set_default: SetDefault;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id2;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version2;
  }
  export interface ModelProfileEvent {
    activity_id: ActivityId3;
    causation_id: CausationId3;
    created_at: CreatedAt3;
    event_id: EventId3;
    event_version: EventVersion3;
    kind: Kind4;
    payload: ModelProfile;
    run_id: RunId3;
    seq: Seq3;
    session_id: SessionId3;
    task_id: TaskId3;
    workspace_id: WorkspaceId4;
  }
  export interface ModelProfile {
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    id: Id3;
    max_output_tokens: MaxOutputTokens;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    request_timeout_seconds: RequestTimeoutSeconds;
    version: Version3;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
    vision: Vision;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface ModelConnectionEvent {
    activity_id: ActivityId4;
    causation_id: CausationId4;
    created_at: CreatedAt4;
    event_id: EventId4;
    event_version: EventVersion4;
    kind: Kind5;
    payload: ModelConnection;
    run_id: RunId4;
    seq: Seq4;
    session_id: SessionId4;
    task_id: TaskId4;
    workspace_id: WorkspaceId5;
  }
  export interface ModelConnection {
    display_name: DisplayName2;
    endpoint: Endpoint;
    id: Id4;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    secret_ref: SecretRef;
    version: Version4;
  }
  export interface ExecutionEvent {
    activity_id: ActivityId5;
    causation_id: CausationId5;
    created_at: CreatedAt5;
    event_id: EventId5;
    event_version: EventVersion5;
    kind: Kind6;
    payload: PublicChange;
    run_id: RunId16;
    seq: Seq5;
    session_id: SessionId9;
    task_id: TaskId11;
    workspace_id: WorkspaceId8;
  }
  export interface PublicChange {
    activities: Activities;
    artifacts: Artifacts;
    budgets: Budgets;
    chat_model_use?: ChatModelUse | null;
    consumptions: Consumptions;
    follow_up_intents: FollowUpIntents;
    joins: Joins;
    message_watermark?: MessageWatermark;
    messages: Messages;
    pending_commands: PendingCommands;
    questions: Questions;
    runs: Runs;
    tasks: Tasks;
    waits: Waits;
  }
  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id5;
    kind: Kind7;
    operation: Operation;
    run_id: RunId5;
    script_execution: ScriptExecutionSummary | null;
    state: State;
    task_id: TaskId6;
    usage: Usage | null;
    version: Version6;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。
   */
  export interface ScriptExecutionSummary {
    attempt_id: AttemptId;
    collection_error: CollectionError;
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    exit_code: ExitCode;
    external_costs: ExternalCosts;
    outputs: Outputs;
    script_relative_path: ScriptRelativePath;
    skill_id: SkillId;
    termination_reason: TerminationReason;
    truncated: Truncated;
  }
  export interface ScriptArtifact {
    artifact: ArtifactRef;
    relative_path: RelativePath;
  }
  export interface ArtifactRef {
    activity_id: ActivityId6;
    content_hash: ContentHash1;
    dependencies: Dependencies1;
    id: Id6;
    media_type: MediaType;
    task_id: TaskId5;
    version: Version5;
  }
  export interface Usage {
    cache_read_reported?: CacheReadReported;
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }
  export interface BudgetSnapshot {
    id: Id7;
    limits: RunLimits;
    model_requests: ModelRequests;
    reserved_tokens: ReservedTokens;
    reserved_units: ReservedUnits;
    run_id: RunId6;
    spent_units: SpentUnits;
    steps: Steps;
    task_count: TaskCount;
    total_tokens: TotalTokens;
    version: Version7;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_delegation_depth: MaxDelegationDepth;
    max_model_requests: MaxModelRequests;
    max_parallel_agents: MaxParallelAgents;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
    max_total_tokens: MaxTotalTokens;
  }
  export interface ChatModelUse {
    event_id: EventId6;
    model_profile_id: ModelProfileId;
    reasoning_effort: ReasoningEffort;
    session_id: SessionId5;
  }
  export interface ResultConsumption {
    execution_session_id: ExecutionSessionId;
    id: Id8;
    inbox_entry_id: InboxEntryId;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId7;
    target_task_id: TargetTaskId;
    task_id: TaskId7;
  }
  export interface FollowUpIntent {
    budget_group_id: BudgetGroupId;
    id: Id9;
    origin_run_id: OriginRunId;
    paused_task_ids: PausedTaskIds;
    policy_version: PolicyVersion;
    reason: Reason;
    run_id: RunId8;
    source_result: SourceResult;
    status: Status1;
    target_session_id: TargetSessionId;
  }
  export interface JoinFact {
    child_result_version: ChildResultVersion;
    child_task_id: ChildTaskId;
    event_id: EventId7;
    id: Id10;
    root_task_id: RootTaskId;
    run_id: RunId9;
  }
  export interface MessageView {
    activity_id: ActivityId7;
    attachments?: Attachments;
    delivery_ids?: DeliveryIds;
    event_id: EventId8;
    event_index: EventIndex;
    id: Id11;
    origin: Origin;
    parts: Parts;
    private_ref: PrivateRef;
    role: Role;
    run_id: RunId10;
    source_dependencies: SourceDependencies;
    source_valid?: SourceValid;
    tool_operation?: ToolOperation;
  }
  export interface MessageAttachment {
    name: Name1;
    read_grant_ids: ReadGrantIds;
    resource_id: ResourceId;
    resource_lineage: ResourceLineage;
  }
  export interface TextPart {
    kind: Kind8;
    text: Text;
  }
  export interface ReasoningPart {
    kind: Kind9;
    text: Text1;
  }
  export interface ToolCallPart {
    arguments: Arguments;
    call_id: CallId;
    kind: Kind10;
    name: Name2;
  }
  export interface ToolResultPart {
    call_id: CallId1;
    error: Error1;
    kind: Kind11;
    origin_message_id: OriginMessageId;
    result: {
      [k: string]: unknown;
    };
  }
  export interface PendingUserCommand {
    admission_generations: AdmissionGenerations;
    command_id: CommandId;
    config: ConfigSnapshot;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    file_inputs: FileInputs;
    input_result: ResultInput | null;
    reason: Reason1;
    run_id: RunId12;
    scope_dependencies: ScopeDependencies;
    session_file_predecessors?: SessionFilePredecessors;
    session_id: SessionId6;
    start: StartRun;
    state: State1;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools1;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools1 {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency1;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source1;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId1;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens1;
    display_name: DisplayName3;
    endpoint: Endpoint1;
    id: Id12;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens1;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId2;
    openai_max_tokens_field: OpenaiMaxTokensField1;
    pricing: ModelPricing;
    protocol: Protocol1;
    provider_preset_id: ProviderPresetId1;
    reasoning_effort?: ReasoningEffort1;
    request_timeout_seconds: RequestTimeoutSeconds1;
    secret_ref: SecretRef1;
    version: Version9;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind12;
    note: Note;
    source: Source2;
    verified_at: VerifiedAt;
    version: Version8;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   *
   * This interface was referenced by `FileInputs1`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   *
   * This interface was referenced by `FileInputs2`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ResultInput {
    dependencies: Dependencies2;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId1;
    result_version: ResultVersion1;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId1;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId11;
    submitted_state: SubmittedState;
    task_id: TaskId8;
  }
  export interface SessionFilePredecessors {
    /**
     * This interface was referenced by `SessionFilePredecessors`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface StartRun {
    agent_profile_id: AgentProfileId1;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    inherit_session_files?: InheritSessionFiles;
    limits: RunLimits;
    model_profile_id: ModelProfileId1;
    model_selection?: ModelSelection | null;
    reasoning_effort?: ReasoningEffort2;
    session_file_adoptions?: SessionFileAdoptions;
    session_id: SessionId7;
    source_result: SourceResult1;
    sources: SourceSelection;
    text: Text2;
  }
  export interface ModelSelection {
    connection_id: ConnectionId2;
    connection_version: ConnectionVersion1;
    model_version: ModelVersion;
  }
  export interface SessionFileAdoptions {
    /**
     * This interface was referenced by `SessionFileAdoptions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind13;
    session_id: SessionId8;
    workspace_id: WorkspaceId6;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Question {
    answer_message_id: AnswerMessageId;
    answer_schema: AnswerSchema;
    call_id: CallId2;
    dependencies: Dependencies3;
    id: Id13;
    message_id: MessageId;
    question: Question1;
    run_id: RunId13;
    status: Status2;
    task_id: TaskId9;
    version: Version10;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface RunSnapshot {
    admission_generations: AdmissionGenerations1;
    allow_follow_up: AllowFollowUp1;
    allow_managed: AllowManaged1;
    attached_file_ids?: AttachedFileIds;
    budget_group_id: BudgetGroupId1;
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt1;
    execution_session_id: ExecutionSessionId1;
    file_inputs: FileInputs1;
    follow_up_closed: FollowUpClosed;
    id: Id14;
    interaction_session_id: InteractionSessionId;
    kind: Kind14;
    output: Output;
    reason: Reason3;
    root_task_id: RootTaskId1;
    scope_dependencies: ScopeDependencies1;
    sources: SourceSelection;
    state: State2;
    version: Version11;
    vision_source_run_id: VisionSourceRunId;
    workspace_id: WorkspaceId7;
    yield_requested: YieldRequested;
  }
  export interface AdmissionGenerations1 {
    /**
     * This interface was referenced by `AdmissionGenerations1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface FileInputs1 {
    [k: string]: SelectedFileVersion;
  }
  export interface AgentResult {
    artifact_ids: ArtifactIds;
    evidence_refs: EvidenceRefs;
    handled_failures: HandledFailures;
    status: Status3;
    structured_result: JsonValue;
    summary: Summary;
    unresolved: Unresolved;
    verification: Verification;
  }
  export interface FailureDisposition {
    reason: Reason2;
    result_version: ResultVersion2;
    task_id: TaskId10;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds1;
    handled_failures: HandledFailures1;
    summary: Summary1;
    unresolved: Unresolved1;
  }
  export interface TaskSnapshot {
    binding: TaskExecutionBinding;
    created_seq: CreatedSeq1;
    deadline_at: DeadlineAt2;
    executor_id: ExecutorId;
    id: Id15;
    kind: Kind16;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason4;
    result_version: ResultVersion3;
    run_id: RunId14;
    state: State3;
    version: Version12;
  }
  export interface TaskExecutionBinding {
    additional_result_inputs: AdditionalResultInputs;
    agent_work: AgentWork | null;
    config: ConfigSnapshot;
    delegation_depth: DelegationDepth;
    execution_session_id: ExecutionSessionId2;
    file_inputs: FileInputs2;
    input_artifacts: InputArtifacts;
    input_result: ResultInput | null;
    interaction_session_id: InteractionSessionId1;
    sources: SourceSelection;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs: InputRefs;
    kind: Kind15;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface FileInputs2 {
    [k: string]: SelectedFileVersion;
  }
  export interface WaitRecord {
    continuation_id: ContinuationId;
    deadline_at: DeadlineAt3;
    id: Id16;
    owner_task_id: OwnerTaskId;
    result_version: ResultVersion4;
    run_id: RunId15;
    state: State4;
    target_task_id: TargetTaskId1;
    version: Version13;
  }
  export interface PolicyEvent {
    activity_id: ActivityId8;
    causation_id: CausationId6;
    created_at: CreatedAt6;
    event_id: EventId9;
    event_version: EventVersion6;
    kind: Kind17;
    payload: PublicPolicyChange;
    run_id: RunId18;
    seq: Seq6;
    session_id: SessionId11;
    task_id: TaskId13;
    workspace_id: WorkspaceId10;
  }
  export interface PublicPolicyChange {
    approvals: Approvals;
    grants: Grants;
    resources: Resources;
  }
  export interface Approval {
    activity_id: ActivityId9;
    args_hash: ArgsHash;
    call_id: CallId3;
    dependencies: Dependencies4;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id17;
    mcp: McpToolSnapshot | null;
    parameters: Parameters;
    run_id: RunId17;
    session_id: SessionId10;
    status: Status4;
    target: Target;
    task_id: TaskId12;
    tool_name: ToolName;
    tool_version: ToolVersion;
    version: Version14;
    workspace_id: WorkspaceId9;
  }
  /**
   * 仅供本地审批展示的固定选择事实；不进入工具参数或模型消息。
   */
  export interface ExportApprovalPreview {
    artifact_id: ArtifactId;
    artifact_version: ArtifactVersion;
    target_exists: TargetExists;
    target_path: TargetPath;
  }
  export interface Parameters {
    [k: string]: JsonValue;
  }
  export interface DataUseGrant {
    destination: Destination1;
    epoch: Epoch1;
    id: Id18;
    mcp_queries: McpQueries;
    mcp_versions: McpVersions;
    memory_scopes: MemoryScopes1;
    purposes: Purposes;
    resource_ids: ResourceIds1;
    scope: ScopeRef;
    status: Status5;
    version: Version15;
  }
  export interface McpVersions {
    /**
     * This interface was referenced by `McpVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ResourceRef {
    id: Id19;
    kind: Kind18;
    label: Label;
    scope: ScopeRef;
    source_version: SourceVersion1;
    version: Version16;
  }
  export interface LifecycleEvent {
    activity_id: ActivityId10;
    causation_id: CausationId7;
    created_at: CreatedAt7;
    event_id: EventId10;
    event_version: EventVersion7;
    kind: Kind19;
    payload: PublicLifecycleChange;
    run_id: RunId19;
    seq: Seq7;
    session_id: SessionId12;
    task_id: TaskId14;
    workspace_id: WorkspaceId11;
  }
  export interface PublicLifecycleChange {
    deletions: Deletions;
    scopes: Scopes;
  }
  export interface DeletionReceipt {
    epoch: Epoch2;
    scope: ScopeRef;
    status: Status6;
  }
  export interface ScopeState {
    epoch: Epoch3;
    id: Id20;
    scope: ScopeRef;
    status: Status7;
  }
  export interface DeliveryEvent {
    activity_id: ActivityId11;
    causation_id: CausationId8;
    created_at: CreatedAt8;
    event_id: EventId11;
    event_version: EventVersion8;
    kind: Kind20;
    payload: DeliveryChange;
    run_id: RunId20;
    seq: Seq8;
    session_id: SessionId13;
    task_id: TaskId15;
    workspace_id: WorkspaceId12;
  }
  export interface DeliveryChange {
    deliveries: Deliveries;
  }
  export interface SessionInboxEntry {
    assistant_name?: AssistantName;
    attempts: Attempts;
    consumers: Consumers;
    delivery_state: DeliveryState;
    dependencies: Dependencies5;
    id: Id21;
    last_error: LastError;
    result: TaskHandle;
    result_version: ResultVersion5;
    source_event_id: SourceEventId1;
    source_valid: SourceValid1;
    target_session_id: TargetSessionId2;
    task_name?: TaskName;
    version: Version17;
    viewed_at: ViewedAt;
  }
  export interface AdmissionEvent {
    activity_id: ActivityId12;
    causation_id: CausationId9;
    created_at: CreatedAt9;
    event_id: EventId12;
    event_version: EventVersion9;
    kind: Kind21;
    payload: AdmissionChange;
    run_id: RunId21;
    seq: Seq9;
    session_id: SessionId14;
    task_id: TaskId16;
    workspace_id: WorkspaceId13;
  }
  export interface AdmissionChange {
    admission_fences: AdmissionFences;
  }
  export interface AdmissionFence {
    generation: Generation;
    scope: ScopeRef;
  }
  export interface MemoryEvent {
    activity_id: ActivityId13;
    causation_id: CausationId10;
    created_at: CreatedAt10;
    event_id: EventId13;
    event_version: EventVersion10;
    kind: Kind22;
    payload: MemoryChange;
    run_id: RunId22;
    seq: Seq10;
    session_id: SessionId15;
    task_id: TaskId17;
    workspace_id: WorkspaceId14;
  }
  /**
   * 事件仅用于失效通知；不复制可删除的事实正文。
   */
  export interface MemoryChange {
    policies: Policies;
    records: Records;
  }
  export interface MemoryPolicy {
    auto_organize: AutoOrganize;
    maintenance_limits: RunLimits;
    model_profile_id: ModelProfileId2;
    read_profile: ReadProfile;
    scope: ScopeRef;
    version: Version18;
  }
  export interface MemoryNotice {
    id: Id22;
    revision: Revision;
    scope: ScopeRef;
    status: Status8;
  }
  export interface MemoryMaintenanceEvent {
    activity_id: ActivityId14;
    causation_id: CausationId11;
    created_at: CreatedAt11;
    event_id: EventId14;
    event_version: EventVersion11;
    kind: Kind23;
    payload: MemoryMaintenanceNotice;
    run_id: RunId24;
    seq: Seq11;
    session_id: SessionId16;
    task_id: TaskId18;
    workspace_id: WorkspaceId15;
  }
  export interface MemoryMaintenanceNotice {
    id: Id23;
    policy_version: PolicyVersion1;
    reason: Reason5;
    scope: ScopeRef;
    source_boundary: MemorySourceBoundary;
    task: TaskHandle | null;
  }
  export interface MemorySourceBoundary {
    event_id: EventId15;
    run_id: RunId23;
  }
  export interface SkillEvent {
    activity_id: ActivityId15;
    causation_id: CausationId12;
    created_at: CreatedAt12;
    event_id: EventId16;
    event_version: EventVersion12;
    kind: Kind24;
    payload: SkillNotice;
    run_id: RunId25;
    seq: Seq12;
    session_id: SessionId17;
    task_id: TaskId19;
    workspace_id: WorkspaceId16;
  }
  export interface SkillNotice {
    revision: Revision1;
    scope: ScopeRef;
    skill_id: SkillId1;
    status: Status9;
  }
  export interface EnvironmentEvent {
    activity_id: ActivityId16;
    causation_id: CausationId13;
    created_at: CreatedAt13;
    event_id: EventId17;
    event_version: EventVersion13;
    kind: Kind25;
    payload: EnvironmentChanged;
    run_id: RunId26;
    seq: Seq13;
    session_id: SessionId18;
    task_id: TaskId20;
    workspace_id: WorkspaceId17;
  }
  /**
   * 全局失效只给读取者一个重新查询的定位，不广播执行配置。
   */
  export interface EnvironmentChanged {
    environment_id: EnvironmentId1;
  }
  export interface McpEvent {
    activity_id: ActivityId17;
    causation_id: CausationId14;
    created_at: CreatedAt14;
    event_id: EventId18;
    event_version: EventVersion14;
    kind: Kind26;
    payload: McpNotice;
    run_id: RunId27;
    seq: Seq14;
    session_id: SessionId19;
    task_id: TaskId21;
    workspace_id: WorkspaceId18;
  }
  export interface McpNotice {
    config_revision: ConfigRevision1;
    scope: ScopeRef;
    server_id: ServerId1;
  }
  export interface TitlePolicyEvent {
    activity_id: ActivityId18;
    causation_id: CausationId15;
    created_at: CreatedAt15;
    event_id: EventId19;
    event_version: EventVersion15;
    kind: Kind27;
    payload: TitlePolicy;
    run_id: RunId28;
    seq: Seq15;
    session_id: SessionId20;
    task_id: TaskId22;
    workspace_id: WorkspaceId20;
  }
  export interface TitlePolicy {
    binding: TitleModelBinding | null;
    version: Version19;
    workspace_id: WorkspaceId19;
  }
  export interface TitleModelBinding {
    connection_version: ConnectionVersion2;
    endpoint: Endpoint2;
    max_cost_units: MaxCostUnits1;
    max_requests: MaxRequests;
    max_tokens: MaxTokens;
    model_profile_id: ModelProfileId3;
    model_version: ModelVersion1;
  }
  export interface DeltaEvent {
    activity_id: ActivityId19;
    index: Index;
    kind: Kind29;
    text: Text3;
  }

}
export type StreamEvent = StreamEventSchema.StreamEvent;

export namespace SubmitMemoryMaintenanceCommandSchema {
  export type ConnectionVersion = number;
  export type Kind = 'new_budget';
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ModelProfileId = string;
  export type ModelVersion = number;
  export type Kind1 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type EventId = string;
  export type RunId = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SubmitMemoryMaintenanceCommand {
    data: MemoryMaintenanceRequest;
    meta: CommandMeta;
  }
  export interface MemoryMaintenanceRequest {
    budget_confirmation: MemoryMaintenanceBudgetConfirmation;
    scope: ScopeRef;
    source_boundary: MemorySourceBoundary;
  }
  export interface MemoryMaintenanceBudgetConfirmation {
    connection_version: ConnectionVersion;
    kind: Kind;
    limits: RunLimits;
    model_profile_id: ModelProfileId;
    model_version: ModelVersion;
  }
  export interface RunLimits {
    deadline_seconds?: DeadlineSeconds;
    max_cost_units?: MaxCostUnits;
    max_delegation_depth?: MaxDelegationDepth;
    max_model_requests?: MaxModelRequests;
    max_parallel_agents?: MaxParallelAgents;
    max_steps?: MaxSteps;
    max_tasks?: MaxTasks;
    max_total_tokens?: MaxTotalTokens;
  }
  export interface ScopeRef {
    kind: Kind1;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface MemorySourceBoundary {
    event_id: EventId;
    run_id: RunId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SubmitMemoryMaintenanceCommand = SubmitMemoryMaintenanceCommandSchema.SubmitMemoryMaintenanceCommand;

export namespace SubmitTaskCommandSchema {
  export type AllowedTools = string[];
  export type CompletionPolicy = 'notify_only' | 'follow_up' | 'notify_each';
  export type Lifetime = 'run_bound' | 'managed';
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxDelegationDepth = number;
  export type MaxModelRequests = number;
  export type MaxParallelAgents = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type MaxTotalTokens = number | null;
  export type ExcludedSourceIds = string[];
  export type Kind = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type WaitMode = 'wait' | 'background';
  export type Work = ToolWork | AgentWork;
  export type JsonValue = unknown;
  export type Kind1 = 'tool';
  export type Name = string;
  export type Version = string;
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind2 = 'agent';
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SubmitTaskCommand {
    data: SubmitTask;
    meta: CommandMeta;
  }
  export interface SubmitTask {
    allowed_tools?: AllowedTools;
    completion_policy?: CompletionPolicy;
    lifetime?: Lifetime;
    limits?: RunLimits;
    sources?: SourceSelection;
    wait_mode?: WaitMode;
    work: Work;
  }
  export interface RunLimits {
    deadline_seconds?: DeadlineSeconds;
    max_cost_units?: MaxCostUnits;
    max_delegation_depth?: MaxDelegationDepth;
    max_model_requests?: MaxModelRequests;
    max_parallel_agents?: MaxParallelAgents;
    max_steps?: MaxSteps;
    max_tasks?: MaxTasks;
    max_total_tokens?: MaxTotalTokens;
  }
  export interface SourceSelection {
    excluded_source_ids?: ExcludedSourceIds;
    memory_scopes?: MemoryScopes;
    resource_ids?: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions?: SkillVersions;
  }
  export interface ScopeRef {
    kind: Kind;
    session_id?: SessionId;
    workspace_id?: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface ToolWork {
    arguments: Arguments;
    kind?: Kind1;
    name: Name;
    version: Version;
  }
  export interface Arguments {
    [k: string]: JsonValue;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs?: InputRefs;
    kind?: Kind2;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type SubmitTaskCommand = SubmitTaskCommandSchema.SubmitTaskCommand;

export namespace TaskCenterItemSchema {
  export type DeliveryState = ('pending' | 'delivered' | 'failed' | 'invalidated') | null;
  export type OriginTaskId = string | null;
  export type PendingCount = number;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;
  export type InboxEntryId = string;
  export type ResultVersion = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;
  export type AdditionalResultInputs = ResultInput[];
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind = 'agent';
  export type JsonValue = unknown;
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind1 = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DelegationDepth = number;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type SourceVersion = string;
  export type ActivityId = string;
  export type ContentHash = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id2 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId1 = string;
  export type Version3 = number;
  export type InputArtifacts = ArtifactRef[];
  export type InteractionSessionId = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind2 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type CreatedSeq = number;
  export type DeadlineAt = string | null;
  export type ExecutorId = string;
  export type Id3 = string;
  export type Kind3 = 'agent' | 'tool';
  export type OriginTaskId1 = string | null;
  export type ParentTaskId = string | null;
  export type Reason = string | null;
  export type ResultVersion1 = number | null;
  export type RunId1 = string;
  export type State =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version4 = number;
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type AttachedFileIds = string[] | null;
  export type BudgetGroupId = string;
  export type BudgetId = string;
  export type DeadlineAt1 = string;
  export type ExecutionSessionId1 = string;
  export type FollowUpClosed = boolean;
  export type Id4 = string;
  export type InteractionSessionId1 = string | null;
  export type Kind4 = 'user' | 'managed' | 'follow_up' | 'maintenance';
  export type Output = AgentResult | RunOutput | null;
  export type ArtifactIds = string[];
  export type EvidenceRefs = string[];
  export type Reason1 = string;
  export type ResultVersion2 = number;
  export type TaskId2 = string;
  export type HandledFailures = FailureDisposition[];
  export type Status = 'completed' | 'partial' | 'failed';
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Verification = string[];
  export type ArtifactIds1 = string[];
  export type HandledFailures1 = FailureDisposition[];
  export type Summary1 = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved1 = string[];
  export type Reason2 = string | null;
  export type RootTaskId = string;
  export type ScopeDependencies = ScopeDependency[];
  export type State1 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version5 = number;
  export type VisionSourceRunId = string | null;
  export type WorkspaceId1 = string;
  export type YieldRequested = boolean;
  export type SessionTitle = string | null;
  export type SourceValid = boolean;
  export type TaskGoal = string | null;
  export type TaskTitle = string | null;

  export interface TaskCenterItem {
    delivery_state: DeliveryState;
    origin_task_id: OriginTaskId;
    pending_count: PendingCount;
    root: TaskSnapshot;
    run: RunSnapshot;
    session_title?: SessionTitle;
    source_valid?: SourceValid;
    task_goal?: TaskGoal;
    task_title?: TaskTitle;
  }
  export interface TaskSnapshot {
    binding: TaskExecutionBinding;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    executor_id: ExecutorId;
    id: Id3;
    kind: Kind3;
    origin_task_id: OriginTaskId1;
    parent_task_id: ParentTaskId;
    reason: Reason;
    result_version: ResultVersion1;
    run_id: RunId1;
    state: State;
    version: Version4;
  }
  export interface TaskExecutionBinding {
    additional_result_inputs: AdditionalResultInputs;
    agent_work: AgentWork | null;
    config: ConfigSnapshot;
    delegation_depth: DelegationDepth;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    input_artifacts: InputArtifacts;
    input_result: ResultInput | null;
    interaction_session_id: InteractionSessionId;
    sources: SourceSelection;
  }
  export interface ResultInput {
    dependencies: Dependencies;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId;
    result_version: ResultVersion;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs: InputRefs;
    kind: Kind;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind1;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   *
   * This interface was referenced by `FileInputs1`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash;
    dependencies: Dependencies1;
    id: Id2;
    media_type: MediaType;
    task_id: TaskId1;
    version: Version3;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind2;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface RunSnapshot {
    admission_generations: AdmissionGenerations;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    attached_file_ids?: AttachedFileIds;
    budget_group_id: BudgetGroupId;
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt1;
    execution_session_id: ExecutionSessionId1;
    file_inputs: FileInputs1;
    follow_up_closed: FollowUpClosed;
    id: Id4;
    interaction_session_id: InteractionSessionId1;
    kind: Kind4;
    output: Output;
    reason: Reason2;
    root_task_id: RootTaskId;
    scope_dependencies: ScopeDependencies;
    sources: SourceSelection;
    state: State1;
    version: Version5;
    vision_source_run_id: VisionSourceRunId;
    workspace_id: WorkspaceId1;
    yield_requested: YieldRequested;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface FileInputs1 {
    [k: string]: SelectedFileVersion;
  }
  export interface AgentResult {
    artifact_ids: ArtifactIds;
    evidence_refs: EvidenceRefs;
    handled_failures: HandledFailures;
    status: Status;
    structured_result: JsonValue;
    summary: Summary;
    unresolved: Unresolved;
    verification: Verification;
  }
  export interface FailureDisposition {
    reason: Reason1;
    result_version: ResultVersion2;
    task_id: TaskId2;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds1;
    handled_failures: HandledFailures1;
    summary: Summary1;
    unresolved: Unresolved1;
  }

}
export type TaskCenterItem = TaskCenterItemSchema.TaskCenterItem;

export namespace TaskCenterPageSchema {
  export type DeliveryState = ('pending' | 'delivered' | 'failed' | 'invalidated') | null;
  export type OriginTaskId = string | null;
  export type PendingCount = number;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;
  export type InboxEntryId = string;
  export type ResultVersion = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;
  export type AdditionalResultInputs = ResultInput[];
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind = 'agent';
  export type JsonValue = unknown;
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind1 = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DelegationDepth = number;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type SourceVersion = string;
  export type ActivityId = string;
  export type ContentHash = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id2 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId1 = string;
  export type Version3 = number;
  export type InputArtifacts = ArtifactRef[];
  export type InteractionSessionId = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind2 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type CreatedSeq = number;
  export type DeadlineAt = string | null;
  export type ExecutorId = string;
  export type Id3 = string;
  export type Kind3 = 'agent' | 'tool';
  export type OriginTaskId1 = string | null;
  export type ParentTaskId = string | null;
  export type Reason = string | null;
  export type ResultVersion1 = number | null;
  export type RunId1 = string;
  export type State =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version4 = number;
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type AttachedFileIds = string[] | null;
  export type BudgetGroupId = string;
  export type BudgetId = string;
  export type DeadlineAt1 = string;
  export type ExecutionSessionId1 = string;
  export type FollowUpClosed = boolean;
  export type Id4 = string;
  export type InteractionSessionId1 = string | null;
  export type Kind4 = 'user' | 'managed' | 'follow_up' | 'maintenance';
  export type Output = AgentResult | RunOutput | null;
  export type ArtifactIds = string[];
  export type EvidenceRefs = string[];
  export type Reason1 = string;
  export type ResultVersion2 = number;
  export type TaskId2 = string;
  export type HandledFailures = FailureDisposition[];
  export type Status = 'completed' | 'partial' | 'failed';
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Verification = string[];
  export type ArtifactIds1 = string[];
  export type HandledFailures1 = FailureDisposition[];
  export type Summary1 = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved1 = string[];
  export type Reason2 = string | null;
  export type RootTaskId = string;
  export type ScopeDependencies = ScopeDependency[];
  export type State1 =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version5 = number;
  export type VisionSourceRunId = string | null;
  export type WorkspaceId1 = string;
  export type YieldRequested = boolean;
  export type SessionTitle = string | null;
  export type SourceValid = boolean;
  export type TaskGoal = string | null;
  export type TaskTitle = string | null;
  export type Items = TaskCenterItem[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface TaskCenterPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface TaskCenterItem {
    delivery_state: DeliveryState;
    origin_task_id: OriginTaskId;
    pending_count: PendingCount;
    root: TaskSnapshot;
    run: RunSnapshot;
    session_title?: SessionTitle;
    source_valid?: SourceValid;
    task_goal?: TaskGoal;
    task_title?: TaskTitle;
  }
  export interface TaskSnapshot {
    binding: TaskExecutionBinding;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    executor_id: ExecutorId;
    id: Id3;
    kind: Kind3;
    origin_task_id: OriginTaskId1;
    parent_task_id: ParentTaskId;
    reason: Reason;
    result_version: ResultVersion1;
    run_id: RunId1;
    state: State;
    version: Version4;
  }
  export interface TaskExecutionBinding {
    additional_result_inputs: AdditionalResultInputs;
    agent_work: AgentWork | null;
    config: ConfigSnapshot;
    delegation_depth: DelegationDepth;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    input_artifacts: InputArtifacts;
    input_result: ResultInput | null;
    interaction_session_id: InteractionSessionId;
    sources: SourceSelection;
  }
  export interface ResultInput {
    dependencies: Dependencies;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId;
    result_version: ResultVersion;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs: InputRefs;
    kind: Kind;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind1;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   *
   * This interface was referenced by `FileInputs1`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash;
    dependencies: Dependencies1;
    id: Id2;
    media_type: MediaType;
    task_id: TaskId1;
    version: Version3;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind2;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface RunSnapshot {
    admission_generations: AdmissionGenerations;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    attached_file_ids?: AttachedFileIds;
    budget_group_id: BudgetGroupId;
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt1;
    execution_session_id: ExecutionSessionId1;
    file_inputs: FileInputs1;
    follow_up_closed: FollowUpClosed;
    id: Id4;
    interaction_session_id: InteractionSessionId1;
    kind: Kind4;
    output: Output;
    reason: Reason2;
    root_task_id: RootTaskId;
    scope_dependencies: ScopeDependencies;
    sources: SourceSelection;
    state: State1;
    version: Version5;
    vision_source_run_id: VisionSourceRunId;
    workspace_id: WorkspaceId1;
    yield_requested: YieldRequested;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface FileInputs1 {
    [k: string]: SelectedFileVersion;
  }
  export interface AgentResult {
    artifact_ids: ArtifactIds;
    evidence_refs: EvidenceRefs;
    handled_failures: HandledFailures;
    status: Status;
    structured_result: JsonValue;
    summary: Summary;
    unresolved: Unresolved;
    verification: Verification;
  }
  export interface FailureDisposition {
    reason: Reason1;
    result_version: ResultVersion2;
    task_id: TaskId2;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds1;
    handled_failures: HandledFailures1;
    summary: Summary1;
    unresolved: Unresolved1;
  }

}
export type TaskCenterPage = TaskCenterPageSchema.TaskCenterPage;

export namespace TaskExecutionBindingSchema {
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;
  export type InboxEntryId = string;
  export type ResultVersion = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;
  export type AdditionalResultInputs = ResultInput[];
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind = 'agent';
  export type JsonValue = unknown;
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind1 = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DelegationDepth = number;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type SourceVersion = string;
  export type ActivityId = string;
  export type ContentHash = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id2 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId1 = string;
  export type Version3 = number;
  export type InputArtifacts = ArtifactRef[];
  export type InteractionSessionId = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind2 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];

  export interface TaskExecutionBinding {
    additional_result_inputs: AdditionalResultInputs;
    agent_work: AgentWork | null;
    config: ConfigSnapshot;
    delegation_depth: DelegationDepth;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    input_artifacts: InputArtifacts;
    input_result: ResultInput | null;
    interaction_session_id: InteractionSessionId;
    sources: SourceSelection;
  }
  export interface ResultInput {
    dependencies: Dependencies;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId;
    result_version: ResultVersion;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs: InputRefs;
    kind: Kind;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind1;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash;
    dependencies: Dependencies1;
    id: Id2;
    media_type: MediaType;
    task_id: TaskId1;
    version: Version3;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind2;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type TaskExecutionBinding = TaskExecutionBindingSchema.TaskExecutionBinding;

export namespace TaskHandleSchema {
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;

  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }

}
export type TaskHandle = TaskHandleSchema.TaskHandle;

export namespace TaskPageSchema {
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;
  export type InboxEntryId = string;
  export type ResultVersion = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;
  export type AdditionalResultInputs = ResultInput[];
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind = 'agent';
  export type JsonValue = unknown;
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind1 = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DelegationDepth = number;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type SourceVersion = string;
  export type ActivityId = string;
  export type ContentHash = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id2 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId1 = string;
  export type Version3 = number;
  export type InputArtifacts = ArtifactRef[];
  export type InteractionSessionId = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind2 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type CreatedSeq = number;
  export type DeadlineAt = string | null;
  export type ExecutorId = string;
  export type Id3 = string;
  export type Kind3 = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason = string | null;
  export type ResultVersion1 = number | null;
  export type RunId1 = string;
  export type State =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version4 = number;
  export type Items = TaskSnapshot[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface TaskPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface TaskSnapshot {
    binding: TaskExecutionBinding;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    executor_id: ExecutorId;
    id: Id3;
    kind: Kind3;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason;
    result_version: ResultVersion1;
    run_id: RunId1;
    state: State;
    version: Version4;
  }
  export interface TaskExecutionBinding {
    additional_result_inputs: AdditionalResultInputs;
    agent_work: AgentWork | null;
    config: ConfigSnapshot;
    delegation_depth: DelegationDepth;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    input_artifacts: InputArtifacts;
    input_result: ResultInput | null;
    interaction_session_id: InteractionSessionId;
    sources: SourceSelection;
  }
  export interface ResultInput {
    dependencies: Dependencies;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId;
    result_version: ResultVersion;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs: InputRefs;
    kind: Kind;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind1;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash;
    dependencies: Dependencies1;
    id: Id2;
    media_type: MediaType;
    task_id: TaskId1;
    version: Version3;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind2;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type TaskPage = TaskPageSchema.TaskPage;

export namespace TaskResultSchema {
  export type ActivityId = string;
  export type ContentHash = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Id = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;
  export type Artifacts = ArtifactRef[];
  export type Dependencies1 = ScopeDependency[];
  export type Error = string | null;
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId1 = string;
  export type ResultVersion = number;
  export type State =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';

  export interface TaskResult {
    artifacts: Artifacts;
    dependencies: Dependencies1;
    error: Error;
    handle: TaskHandle;
    result: {
      [k: string]: unknown;
    };
    result_version: ResultVersion;
    state: State;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash;
    dependencies: Dependencies;
    id: Id;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId1;
  }

}
export type TaskResult = TaskResultSchema.TaskResult;

export namespace TaskSnapshotSchema {
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;
  export type InboxEntryId = string;
  export type ResultVersion = number;
  export type SourceEventId = string;
  export type TargetSessionId = string;
  export type AdditionalResultInputs = ResultInput[];
  export type Goal = string;
  export type InputRefs = string[];
  export type Kind = 'agent';
  export type JsonValue = unknown;
  export type ProfileId = string;
  export type SuccessCriteria = string[];
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind1 = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DelegationDepth = number;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type SourceVersion = string;
  export type ActivityId = string;
  export type ContentHash = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id2 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId1 = string;
  export type Version3 = number;
  export type InputArtifacts = ArtifactRef[];
  export type InteractionSessionId = string | null;
  export type ExcludedSourceIds = string[];
  export type Kind2 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type CreatedSeq = number;
  export type DeadlineAt = string | null;
  export type ExecutorId = string;
  export type Id3 = string;
  export type Kind3 = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason = string | null;
  export type ResultVersion1 = number | null;
  export type RunId1 = string;
  export type State =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version4 = number;

  export interface TaskSnapshot {
    binding: TaskExecutionBinding;
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    executor_id: ExecutorId;
    id: Id3;
    kind: Kind3;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason;
    result_version: ResultVersion1;
    run_id: RunId1;
    state: State;
    version: Version4;
  }
  export interface TaskExecutionBinding {
    additional_result_inputs: AdditionalResultInputs;
    agent_work: AgentWork | null;
    config: ConfigSnapshot;
    delegation_depth: DelegationDepth;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    input_artifacts: InputArtifacts;
    input_result: ResultInput | null;
    interaction_session_id: InteractionSessionId;
    sources: SourceSelection;
  }
  export interface ResultInput {
    dependencies: Dependencies;
    handle: TaskHandle;
    inbox_entry_id: InboxEntryId;
    result_version: ResultVersion;
    source_event_id: SourceEventId;
    target_session_id: TargetSessionId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }
  export interface AgentWork {
    goal: Goal;
    input_refs: InputRefs;
    kind: Kind;
    output_schema: OutputSchema;
    profile_id: ProfileId;
    success_criteria: SuccessCriteria;
  }
  export interface OutputSchema {
    [k: string]: JsonValue;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind1;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash;
    dependencies: Dependencies1;
    id: Id2;
    media_type: MediaType;
    task_id: TaskId1;
    version: Version3;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind2;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }

}
export type TaskSnapshot = TaskSnapshotSchema.TaskSnapshot;

export namespace TaskSubmissionSchema {
  export type ArgsHash = string;
  export type CommandId = string;
  export type CompletionPolicy = 'notify_only' | 'follow_up' | 'notify_each';
  export type Lifetime = 'run_bound' | 'managed';
  export type RunId = string;
  export type SubmittedState =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type TaskId = string;
  export type Lifetime1 = 'run_bound' | 'managed';
  export type OriginRunId = string;
  export type OriginTaskId = string;

  export interface TaskSubmission {
    args_hash: ArgsHash;
    command_id: CommandId;
    completion_policy: CompletionPolicy;
    handle: TaskHandle;
    lifetime: Lifetime1;
    origin_run_id: OriginRunId;
    origin_task_id: OriginTaskId;
  }
  export interface TaskHandle {
    lifetime: Lifetime;
    run_id: RunId;
    submitted_state: SubmittedState;
    task_id: TaskId;
  }

}
export type TaskSubmission = TaskSubmissionSchema.TaskSubmission;

export namespace TextSliceSchema {
  export type End = number;
  export type HasStructuredContent = true | null;
  export type SourceVersion = string;
  export type Start = number;
  export type Text = string;
  export type TotalChars = number;

  export interface TextSlice {
    end: End;
    has_structured_content?: HasStructuredContent;
    source_version: SourceVersion;
    start: Start;
    text: Text;
    total_chars: TotalChars;
  }

}
export type TextSlice = TextSliceSchema.TextSlice;

export namespace TitlePolicySchema {
  export type ConnectionVersion = number;
  export type Endpoint = string;
  export type MaxCostUnits = string | null;
  export type MaxRequests = number;
  export type MaxTokens = number;
  export type ModelProfileId = string;
  export type ModelVersion = number;
  export type Version = number | null;
  export type WorkspaceId = string;

  export interface TitlePolicy {
    binding: TitleModelBinding | null;
    version: Version;
    workspace_id: WorkspaceId;
  }
  export interface TitleModelBinding {
    connection_version: ConnectionVersion;
    endpoint: Endpoint;
    max_cost_units: MaxCostUnits;
    max_requests: MaxRequests;
    max_tokens: MaxTokens;
    model_profile_id: ModelProfileId;
    model_version: ModelVersion;
  }

}
export type TitlePolicy = TitlePolicySchema.TitlePolicy;

export namespace ToolSpecListSchema {
  export type BackgroundSupported = boolean;
  export type Cancellation = 'cooperative' | 'best_effort' | 'none';
  export type Description = string | null;
  export type JsonValue = unknown;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type ModelVisible = boolean;
  export type Name = string;
  export type RequiredPurposes = ('read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send')[];
  export type RequiresApproval = boolean;
  export type RetryClass = 'read_only' | 'idempotent' | 'never';
  export type Version = string;
  export type ToolSpecList = ToolSpec[];

  export interface ToolSpec {
    background_supported: BackgroundSupported;
    cancellation: Cancellation;
    description: Description;
    input_schema: InputSchema;
    mcp: McpToolSnapshot | null;
    model_visible: ModelVisible;
    name: Name;
    required_purposes: RequiredPurposes;
    requires_approval: RequiresApproval;
    result_schema: ResultSchema;
    retry_class: RetryClass;
    version: Version;
  }
  export interface InputSchema {
    [k: string]: JsonValue;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface ResultSchema {
    [k: string]: JsonValue;
  }

}
export type ToolSpecList = ToolSpecListSchema.ToolSpecList;

export namespace TracePageSchema {
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id = string;
  export type Kind = 'model' | 'tool';
  export type Operation = string;
  export type RunId = string;
  export type AttemptId = string;
  export type CollectionError = string | null;
  export type ContentHash = string;
  export type EnvironmentId = string;
  export type EnvironmentRevision = number;
  export type ExitCode = number | null;
  export type ExternalCosts = 'unknown';
  export type ActivityId = string;
  export type ContentHash1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id1 = string;
  export type MediaType =
    'text/plain' | 'text/markdown' | 'application/json' | 'application/octet-stream' | 'image/png' | 'image/jpeg';
  export type TaskId = string;
  export type Version = number;
  export type RelativePath = string;
  export type Outputs = ScriptArtifact[];
  export type ScriptRelativePath = string;
  export type SkillId = string;
  export type TerminationReason = 'exited' | 'cancelled' | 'timed_out';
  export type Truncated = boolean;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId1 = string;
  export type CacheReadReported = true | null;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version1 = number;
  export type Activities = ActivityView[];
  export type ActivityId1 = string | null;
  export type EventId = string;
  export type Kind1 = string;
  export type Seq = number | null;
  export type TaskId2 = string | null;
  export type Items = TraceItem[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface TracePage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface TraceItem {
    activities: Activities;
    activity_id: ActivityId1;
    event_id: EventId;
    kind: Kind1;
    seq: Seq;
    task_id: TaskId2;
  }
  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id;
    kind: Kind;
    operation: Operation;
    run_id: RunId;
    script_execution: ScriptExecutionSummary | null;
    state: State;
    task_id: TaskId1;
    usage: Usage | null;
    version: Version1;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  /**
   * 过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。
   */
  export interface ScriptExecutionSummary {
    attempt_id: AttemptId;
    collection_error: CollectionError;
    content_hash: ContentHash;
    environment_id: EnvironmentId;
    environment_revision: EnvironmentRevision;
    exit_code: ExitCode;
    external_costs: ExternalCosts;
    outputs: Outputs;
    script_relative_path: ScriptRelativePath;
    skill_id: SkillId;
    termination_reason: TerminationReason;
    truncated: Truncated;
  }
  export interface ScriptArtifact {
    artifact: ArtifactRef;
    relative_path: RelativePath;
  }
  export interface ArtifactRef {
    activity_id: ActivityId;
    content_hash: ContentHash1;
    dependencies: Dependencies1;
    id: Id1;
    media_type: MediaType;
    task_id: TaskId;
    version: Version;
  }
  export interface Usage {
    cache_read_reported?: CacheReadReported;
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }

}
export type TracePage = TracePageSchema.TracePage;

export namespace VisionContinueCommandSchema {
  export type ConnectionVersion = number;
  export type Endpoint = string;
  export type ModelProfileId = string;
  export type ModelProfileVersion = number;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface VisionContinueCommand {
    data: VisionContinue;
    meta: CommandMeta;
  }
  export interface VisionContinue {
    connection_version: ConnectionVersion;
    endpoint: Endpoint;
    model_profile_id: ModelProfileId;
    model_profile_version: ModelProfileVersion;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type VisionContinueCommand = VisionContinueCommandSchema.VisionContinueCommand;

export namespace WaitPageSchema {
  export type ContinuationId = string;
  export type DeadlineAt = string | null;
  export type Id = string;
  export type OwnerTaskId = string;
  export type ResultVersion = number | null;
  export type RunId = string;
  export type State = 'pending' | 'ready' | 'timeout' | 'cancelled';
  export type TargetTaskId = string;
  export type Version = number;
  export type Items = WaitRecord[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface WaitPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface WaitRecord {
    continuation_id: ContinuationId;
    deadline_at: DeadlineAt;
    id: Id;
    owner_task_id: OwnerTaskId;
    result_version: ResultVersion;
    run_id: RunId;
    state: State;
    target_task_id: TargetTaskId;
    version: Version;
  }

}
export type WaitPage = WaitPageSchema.WaitPage;

export namespace WaitRecordSchema {
  export type ContinuationId = string;
  export type DeadlineAt = string | null;
  export type Id = string;
  export type OwnerTaskId = string;
  export type ResultVersion = number | null;
  export type RunId = string;
  export type State = 'pending' | 'ready' | 'timeout' | 'cancelled';
  export type TargetTaskId = string;
  export type Version = number;

  export interface WaitRecord {
    continuation_id: ContinuationId;
    deadline_at: DeadlineAt;
    id: Id;
    owner_task_id: OwnerTaskId;
    result_version: ResultVersion;
    run_id: RunId;
    state: State;
    target_task_id: TargetTaskId;
    version: Version;
  }

}
export type WaitRecord = WaitRecordSchema.WaitRecord;

export namespace WorkspaceSchema {
  export type DirectoryResourceId = string | null;
  export type Id = string;
  export type Name = string;
  export type Version = number;

  export interface Workspace {
    directory_resource_id: DirectoryResourceId;
    id: Id;
    name: Name;
    version: Version;
  }

}
export type Workspace = WorkspaceSchema.Workspace;

export namespace WorkspaceDirectoryResultSchema {
  export type Id = string;
  export type Kind = 'file' | 'directory' | 'export';
  export type Label = string;
  export type Kind1 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SourceVersion = string | null;
  export type Version = number;
  export type DirectoryResourceId = string | null;
  export type Id1 = string;
  export type Name = string;
  export type Version1 = number;

  export interface WorkspaceDirectoryResult {
    directory: ResourceRef;
    workspace: Workspace;
  }
  export interface ResourceRef {
    id: Id;
    kind: Kind;
    label: Label;
    scope: ScopeRef;
    source_version: SourceVersion;
    version: Version;
  }
  export interface ScopeRef {
    kind: Kind1;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface Workspace {
    directory_resource_id: DirectoryResourceId;
    id: Id1;
    name: Name;
    version: Version1;
  }

}
export type WorkspaceDirectoryResult = WorkspaceDirectoryResultSchema.WorkspaceDirectoryResult;

export namespace WorkspaceDirectoryViewSchema {
  export type Reason = string | null;
  export type Id = string;
  export type Kind = 'file' | 'directory' | 'export';
  export type Label = string;
  export type Kind1 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type SourceVersion = string | null;
  export type Version = number;
  export type State = 'unlinked' | 'available' | 'unavailable';
  export type WorkspaceId1 = string;
  export type WorkspaceVersion = number;

  export interface WorkspaceDirectoryView {
    reason: Reason;
    resource: ResourceRef | null;
    state: State;
    workspace_id: WorkspaceId1;
    workspace_version: WorkspaceVersion;
  }
  export interface ResourceRef {
    id: Id;
    kind: Kind;
    label: Label;
    scope: ScopeRef;
    source_version: SourceVersion;
    version: Version;
  }
  export interface ScopeRef {
    kind: Kind1;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type WorkspaceDirectoryView = WorkspaceDirectoryViewSchema.WorkspaceDirectoryView;

export namespace WorkspacePageSchema {
  export type DirectoryResourceId = string | null;
  export type Id = string;
  export type Name = string;
  export type Version = number;
  export type Items = Workspace[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface WorkspacePage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface Workspace {
    directory_resource_id: DirectoryResourceId;
    id: Id;
    name: Name;
    version: Version;
  }

}
export type WorkspacePage = WorkspacePageSchema.WorkspacePage;

export namespace WorkspaceSnapshotSchema {
  export type AllowFollowUp = boolean;
  export type AllowManaged = boolean;
  export type AttachedFileIds = string[] | null;
  export type BudgetGroupId = string;
  export type BudgetId = string;
  export type ConfigSnapshot = ConfigSnapshot1 & ConfigSnapshot2;
  export type ConfigSnapshot1 =
    | {
        model_pricing?: {
          [k: string]: unknown;
        };
        pricing_unknown_reason?: null;
        [k: string]: unknown;
      }
    | {
        model_pricing?: null;
        pricing_unknown_reason?: string;
        [k: string]: unknown;
      };
  export type AllowedTools = string[];
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type Delegatable = boolean;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type SkillIds = string[];
  export type Version = number;
  export type AgentExecutorId = string;
  export type CatalogHash = string;
  export type ConfigRevision = number;
  export type Destination = string;
  export type OriginalName = string;
  export type ServerId = string;
  export type Assumptions = string[];
  export type CatalogVersion = string | null;
  export type Currency = 'USD';
  export type EffectiveMultiplier = string;
  export type Mode = 'catalog' | 'manual';
  export type Model = string;
  export type Provider = string | null;
  export type ResolvedAt = string;
  export type Base = string;
  export type Price = string;
  export type Start = number;
  export type Tiers = PriceTier[];
  export type SnapshotId = string;
  export type Source = string;
  export type Variants = PriceVariant[];
  export type CanonicalModelId = string | null;
  export type ReasoningEfforts = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[] | null;
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type Vision = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxInputTokens = number | null;
  export type MaxOutputTokens = number;
  export type MaxSupportedOutputTokens = number | null;
  export type Kind = 'user' | 'service' | 'observed' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source1 = string | null;
  export type VerifiedAt = string | null;
  export type Version1 = string | null;
  export type ModelId = string;
  export type OpenaiMaxTokensField = ('max_tokens' | 'max_completion_tokens') | null;
  export type CacheReadPerMillion = string | null;
  export type CacheWritePerMillion = string | null;
  export type Currency1 = 'USD';
  export type InputPerMillion = string | null;
  export type ModelId1 = string | null;
  export type Multiplier = string | null;
  export type OutputPerMillion = string | null;
  export type ProviderId = string | null;
  export type Protocol = 'openai_compatible' | 'openai_responses' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type ReasoningEffort = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type PricingUnknownReason1 = string | null;
  export type DeadlineAt = string;
  export type ExecutionSessionId = string;
  export type FileIdentity = string;
  export type InheritanceGrants = ScopeDependency[] | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type SourceVersion = string;
  export type FollowUpClosed = boolean;
  export type Id2 = string;
  export type InteractionSessionId = string | null;
  export type Kind1 = 'user' | 'managed' | 'follow_up' | 'maintenance';
  export type Output = AgentResult | RunOutput | null;
  export type ArtifactIds = string[];
  export type EvidenceRefs = string[];
  export type Reason = string;
  export type ResultVersion = number;
  export type TaskId = string;
  export type HandledFailures = FailureDisposition[];
  export type Status = 'completed' | 'partial' | 'failed';
  export type JsonValue = unknown;
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Verification = string[];
  export type ArtifactIds1 = string[];
  export type HandledFailures1 = FailureDisposition[];
  export type Summary1 = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved1 = string[];
  export type Reason1 = string | null;
  export type RootTaskId = string;
  export type ScopeDependencies = ScopeDependency[];
  export type ExcludedSourceIds = string[];
  export type Kind2 = 'user_global' | 'workspace' | 'session';
  export type SessionId = string | null;
  export type WorkspaceId = string | null;
  export type MemoryScopes = ScopeRef[];
  export type ResourceIds = string[];
  export type State =
    | 'queued'
    | 'running'
    | 'waiting_user'
    | 'waiting_approval'
    | 'waiting_children'
    | 'interrupted'
    | 'blocked_incompatible'
    | 'completed'
    | 'failed'
    | 'cancelled';
  export type Version3 = number;
  export type VisionSourceRunId = string | null;
  export type WorkspaceId1 = string;
  export type YieldRequested = boolean;
  export type Items = RunSnapshot[];
  export type NextCursor = string | null;
  export type Watermark = string;
  export type Destination1 = string | null;
  export type Epoch1 = number;
  export type Id3 = string;
  export type McpQueries = McpToolSnapshot[];
  export type MemoryScopes1 = ScopeRef[];
  /**
   * @minItems 1
   */
  export type Purposes = [
    'read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send',
    ...('read' | 'model_send' | 'export' | 'tool_send' | 'local_process_send')[]
  ];
  export type ResourceIds1 = string[];
  export type Status1 = 'active' | 'revoked';
  export type Version4 = number;
  export type Items1 = DataUseGrant[];
  export type NextCursor1 = string | null;
  export type Watermark1 = string;
  export type ActivityId = string;
  export type ArgsHash = string;
  export type CallId = string;
  export type Dependencies = ScopeDependency[];
  export type ExpiresAt = string;
  export type ArtifactId = string;
  export type ArtifactVersion = number;
  export type TargetExists = boolean;
  export type TargetPath = string;
  export type Id4 = string;
  export type RunId = string;
  export type SessionId1 = string | null;
  export type Status2 = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
  export type Target = string | null;
  export type TaskId1 = string;
  export type ToolName = string;
  export type ToolVersion = string;
  export type Version5 = number;
  export type WorkspaceId2 = string;
  export type Items2 = Approval[];
  export type NextCursor2 = string | null;
  export type Watermark2 = string;
  export type AnswerMessageId = string | null;
  export type CallId1 = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id5 = string;
  export type MessageId = string;
  export type Question1 = string;
  export type RunId1 = string;
  export type Status3 = 'pending' | 'answered' | 'cancelled';
  export type TaskId2 = string;
  export type Version6 = number;
  export type Items3 = Question[];
  export type NextCursor3 = string | null;
  export type Watermark3 = string;
  /**
   * @maxItems 10
   */
  export type RecentModelUses =
    | []
    | [ChatModelUse]
    | [ChatModelUse, ChatModelUse]
    | [ChatModelUse, ChatModelUse, ChatModelUse]
    | [ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse]
    | [ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse]
    | [ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse]
    | [ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse]
    | [ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse, ChatModelUse]
    | [
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse
      ]
    | [
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse,
        ChatModelUse
      ];
  export type EventId = string;
  export type ModelProfileId = string;
  export type ReasoningEffort1 = ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') | null;
  export type SessionId2 = string;
  export type Id6 = string;
  export type Kind3 = 'file' | 'directory' | 'export';
  export type Label = string;
  export type SourceVersion1 = string | null;
  export type Version7 = number;
  export type Items4 = ResourceRef[];
  export type NextCursor4 = string | null;
  export type Watermark4 = string;
  export type AgentProfileId = string;
  export type Archived = boolean;
  export type AutomaticTitle = 'pending' | number | null;
  export type Id7 = string;
  export type Kind4 = 'interaction' | 'execution';
  export type Title = string;
  export type Version8 = number;
  export type WorkspaceId3 = string;
  export type Items5 = Session[];
  export type NextCursor5 = string | null;
  export type Watermark5 = string;
  export type Watermark6 = string;
  export type DirectoryResourceId = string | null;
  export type Id8 = string;
  export type Name = string;
  export type Version9 = number;

  export interface WorkspaceSnapshot {
    active_runs: PageRunSnapshot;
    grants: PageDataUseGrant;
    pending_approvals: PageApproval;
    pending_questions: PageQuestion;
    recent_model_uses?: RecentModelUses;
    resources: PageResourceRef;
    sessions: PageSession;
    watermark: Watermark6;
    workspace: Workspace;
  }
  export interface PageRunSnapshot {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface RunSnapshot {
    admission_generations: AdmissionGenerations;
    allow_follow_up: AllowFollowUp;
    allow_managed: AllowManaged;
    attached_file_ids?: AttachedFileIds;
    budget_group_id: BudgetGroupId;
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    execution_session_id: ExecutionSessionId;
    file_inputs: FileInputs;
    follow_up_closed: FollowUpClosed;
    id: Id2;
    interaction_session_id: InteractionSessionId;
    kind: Kind1;
    output: Output;
    reason: Reason1;
    root_task_id: RootTaskId;
    scope_dependencies: ScopeDependencies;
    sources: SourceSelection;
    state: State;
    version: Version3;
    vision_source_run_id: VisionSourceRunId;
    workspace_id: WorkspaceId1;
    yield_requested: YieldRequested;
  }
  export interface AdmissionGenerations {
    /**
     * This interface was referenced by `AdmissionGenerations`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    members: Members;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason1;
  }
  export interface AgentProfile {
    allowed_tools: AllowedTools;
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    delegatable: Delegatable;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    skill_ids: SkillIds;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    mcp_tools: McpTools;
    plugins: Plugins;
    tools: Tools;
  }
  export interface McpTools {
    [k: string]: McpToolSnapshot;
  }
  export interface McpToolSnapshot {
    catalog_hash: CatalogHash;
    config_revision: ConfigRevision;
    destination: Destination;
    original_name: OriginalName;
    server_id: ServerId;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
  }
  export interface Members {
    [k: string]: ResolvedMember;
  }
  /**
   * This interface was referenced by `Members`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface ResolvedMember {
    agent_profile: AgentProfile;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
    skill_versions: SkillVersions;
    tools: Tools2;
  }
  export interface PricingSnapshot {
    assumptions: Assumptions;
    catalog_version: CatalogVersion;
    currency: Currency;
    effective_multiplier: EffectiveMultiplier;
    mode: Mode;
    model: Model;
    provider: Provider;
    resolved_at: ResolvedAt;
    rules: Rules;
    snapshot_id: SnapshotId;
    source: Source;
    variants: Variants;
  }
  export interface Rules {
    [k: string]: PriceRule;
  }
  export interface PriceRule {
    base: Base;
    tiers: Tiers;
  }
  export interface PriceTier {
    price: Price;
    start: Start;
  }
  export interface PriceVariant {
    rules: Rules1;
    when: When;
  }
  export interface Rules1 {
    [k: string]: PriceRule;
  }
  export interface When {
    [k: string]: string;
  }
  export interface ResolvedModelProfile {
    canonical_model_id: CanonicalModelId;
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_input_tokens: MaxInputTokens;
    max_output_tokens: MaxOutputTokens;
    max_supported_output_tokens: MaxSupportedOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    reasoning_effort?: ReasoningEffort;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    reasoning_efforts?: ReasoningEfforts;
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
    vision: Vision;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind;
    note: Note;
    source: Source1;
    verified_at: VerifiedAt;
    version: Version1;
  }
  export interface ModelPricing {
    cache_read_per_million: CacheReadPerMillion;
    cache_write_per_million: CacheWritePerMillion;
    currency: Currency1;
    input_per_million: InputPerMillion;
    model_id: ModelId1;
    multiplier: Multiplier;
    output_per_million: OutputPerMillion;
    provider_id: ProviderId;
  }
  export interface SkillVersions {
    /**
     * This interface was referenced by `SkillVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface Tools2 {
    [k: string]: string;
  }
  export interface FileInputs {
    [k: string]: SelectedFileVersion;
  }
  /**
   * 宿主接纳文件时固定的身份摘要与内容版本，不携带本机路径或字节。
   *
   * This interface was referenced by `FileInputs`'s JSON-Schema definition
   * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
   */
  export interface SelectedFileVersion {
    file_identity: FileIdentity;
    inheritance_grants?: InheritanceGrants;
    source_version: SourceVersion;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface AgentResult {
    artifact_ids: ArtifactIds;
    evidence_refs: EvidenceRefs;
    handled_failures: HandledFailures;
    status: Status;
    structured_result: JsonValue;
    summary: Summary;
    unresolved: Unresolved;
    verification: Verification;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion;
    task_id: TaskId;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds1;
    handled_failures: HandledFailures1;
    summary: Summary1;
    unresolved: Unresolved1;
  }
  export interface SourceSelection {
    excluded_source_ids: ExcludedSourceIds;
    memory_scopes: MemoryScopes;
    resource_ids: ResourceIds;
    skill_execution_permissions?: SkillExecutionPermissions;
    skill_versions: SkillVersions1;
  }
  export interface ScopeRef {
    kind: Kind2;
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface SkillExecutionPermissions {
    /**
     * This interface was referenced by `SkillExecutionPermissions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string | null;
  }
  export interface SkillVersions1 {
    /**
     * This interface was referenced by `SkillVersions1`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: string;
  }
  export interface PageDataUseGrant {
    items: Items1;
    next_cursor: NextCursor1;
    watermark: Watermark1;
  }
  export interface DataUseGrant {
    destination: Destination1;
    epoch: Epoch1;
    id: Id3;
    mcp_queries: McpQueries;
    mcp_versions: McpVersions;
    memory_scopes: MemoryScopes1;
    purposes: Purposes;
    resource_ids: ResourceIds1;
    scope: ScopeRef;
    status: Status1;
    version: Version4;
  }
  export interface McpVersions {
    /**
     * This interface was referenced by `McpVersions`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".
     */
    [k: string]: number;
  }
  export interface PageApproval {
    items: Items2;
    next_cursor: NextCursor2;
    watermark: Watermark2;
  }
  export interface Approval {
    activity_id: ActivityId;
    args_hash: ArgsHash;
    call_id: CallId;
    dependencies: Dependencies;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id4;
    mcp: McpToolSnapshot | null;
    parameters: Parameters;
    run_id: RunId;
    session_id: SessionId1;
    status: Status2;
    target: Target;
    task_id: TaskId1;
    tool_name: ToolName;
    tool_version: ToolVersion;
    version: Version5;
    workspace_id: WorkspaceId2;
  }
  /**
   * 仅供本地审批展示的固定选择事实；不进入工具参数或模型消息。
   */
  export interface ExportApprovalPreview {
    artifact_id: ArtifactId;
    artifact_version: ArtifactVersion;
    target_exists: TargetExists;
    target_path: TargetPath;
  }
  export interface Parameters {
    [k: string]: JsonValue;
  }
  export interface PageQuestion {
    items: Items3;
    next_cursor: NextCursor3;
    watermark: Watermark3;
  }
  export interface Question {
    answer_message_id: AnswerMessageId;
    answer_schema: AnswerSchema;
    call_id: CallId1;
    dependencies: Dependencies1;
    id: Id5;
    message_id: MessageId;
    question: Question1;
    run_id: RunId1;
    status: Status3;
    task_id: TaskId2;
    version: Version6;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface ChatModelUse {
    event_id: EventId;
    model_profile_id: ModelProfileId;
    reasoning_effort: ReasoningEffort1;
    session_id: SessionId2;
  }
  export interface PageResourceRef {
    items: Items4;
    next_cursor: NextCursor4;
    watermark: Watermark4;
  }
  export interface ResourceRef {
    id: Id6;
    kind: Kind3;
    label: Label;
    scope: ScopeRef;
    source_version: SourceVersion1;
    version: Version7;
  }
  export interface PageSession {
    items: Items5;
    next_cursor: NextCursor5;
    watermark: Watermark5;
  }
  export interface Session {
    agent_profile_id: AgentProfileId;
    archived: Archived;
    automatic_title?: AutomaticTitle;
    id: Id7;
    kind: Kind4;
    title: Title;
    version: Version8;
    workspace_id: WorkspaceId3;
  }
  export interface Workspace {
    directory_resource_id: DirectoryResourceId;
    id: Id8;
    name: Name;
    version: Version9;
  }

}
export type WorkspaceSnapshot = WorkspaceSnapshotSchema.WorkspaceSnapshot;
