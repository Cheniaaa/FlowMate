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
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId = string;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version = number;
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
    state: State;
    task_id: TaskId;
    usage: Usage | null;
    version: Version;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface Usage {
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
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId = string;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version = number;

  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id;
    kind: Kind;
    operation: Operation;
    run_id: RunId;
    state: State;
    task_id: TaskId;
    usage: Usage | null;
    version: Version;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface Usage {
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

export namespace AgentProfileSchema {
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type Version = number;

  export interface AgentProfile {
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    version: Version;
  }

}
export type AgentProfile = AgentProfileSchema.AgentProfile;

export namespace AgentProfilePageSchema {
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
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
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    version: Version;
  }

}
export type AgentProfilePage = AgentProfilePageSchema.AgentProfilePage;

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
  export type JsonValue = unknown;
  export type RunId = string;
  export type SessionId = string;
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
  export type JsonValue = unknown;
  export type RunId = string;
  export type SessionId = string;
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
  export interface Parameters {
    [k: string]: JsonValue;
  }

}
export type ApprovalPage = ApprovalPageSchema.ApprovalPage;

export namespace ArtifactPageSchema {
  export type ActivityId = string;
  export type ContentHash = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Id = string;
  export type MediaType = 'text/plain' | 'text/markdown';
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
  export type MediaType = 'text/plain' | 'text/markdown';
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

export namespace BudgetSnapshotSchema {
  export type Id = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxModelRequests = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type ModelRequests = number;
  export type ReservedUnits = string;
  export type RunId = string;
  export type SpentUnits = string;
  export type Steps = number;
  export type TaskCount = number;
  export type Version = number;

  export interface BudgetSnapshot {
    id: Id;
    limits: RunLimits;
    model_requests: ModelRequests;
    reserved_units: ReservedUnits;
    run_id: RunId;
    spent_units: SpentUnits;
    steps: Steps;
    task_count: TaskCount;
    version: Version;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_model_requests: MaxModelRequests;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
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
  export type Id = string;
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
    id: Id;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId;
    target_task_id: TargetTaskId;
    task_id: TaskId;
  }

}
export type ConsumptionPage = ConsumptionPageSchema.ConsumptionPage;

export namespace ContextUsageSummarySchema {
  export type ActivityId = string;
  export type OmittedGroupCount = number;
  export type OmittedMessageCount = number;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';

  export interface ContextUsageSummary {
    activity_id: ActivityId;
    omitted_group_count: OmittedGroupCount;
    omitted_message_count: OmittedMessageCount;
    reason_counts: ReasonCounts;
    state: State;
  }
  export interface ReasonCounts {
    [k: string]: number;
  }

}
export type ContextUsageSummary = ContextUsageSummarySchema.ContextUsageSummary;

export namespace CreateSessionCommandSchema {
  export type Title = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface CreateSessionCommand {
    data: CreateSession;
    meta: CommandMeta;
  }
  export interface CreateSession {
    title: Title;
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
  /**
   * @minItems 1
   */
  export type Purposes = ['read' | 'model_send' | 'export', ...('read' | 'model_send' | 'export')[]];
  /**
   * @minItems 1
   */
  export type ResourceIds = [string, ...string[]];
  export type SessionId = string | null;
  export type WorkspaceId = string;
  export type Status = 'active' | 'revoked';
  export type Version = number;

  export interface DataUseGrant {
    destination: Destination;
    epoch: Epoch;
    id: Id;
    purposes: Purposes;
    resource_ids: ResourceIds;
    scope: ScopeRef;
    status: Status;
    version: Version;
  }
  export interface ScopeRef {
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type DataUseGrant = DataUseGrantSchema.DataUseGrant;

export namespace DeletionReceiptSchema {
  export type Epoch = number;
  export type SessionId = string | null;
  export type WorkspaceId = string;
  export type Status = 'deleted';

  export interface DeletionReceipt {
    epoch: Epoch;
    scope: ScopeRef;
    status: Status;
  }
  export interface ScopeRef {
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type DeletionReceipt = DeletionReceiptSchema.DeletionReceipt;

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

export namespace GrantPageSchema {
  export type Destination = string | null;
  export type Epoch = number;
  export type Id = string;
  /**
   * @minItems 1
   */
  export type Purposes = ['read' | 'model_send' | 'export', ...('read' | 'model_send' | 'export')[]];
  /**
   * @minItems 1
   */
  export type ResourceIds = [string, ...string[]];
  export type SessionId = string | null;
  export type WorkspaceId = string;
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
    purposes: Purposes;
    resource_ids: ResourceIds;
    scope: ScopeRef;
    status: Status;
    version: Version;
  }
  export interface ScopeRef {
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type GrantPage = GrantPageSchema.GrantPage;

export namespace GrantRequestSchema {
  export type Destination = string | null;
  /**
   * @minItems 1
   */
  export type Purposes = ['read' | 'model_send' | 'export', ...('read' | 'model_send' | 'export')[]];
  /**
   * @minItems 1
   */
  export type ResourceIds = [string, ...string[]];
  export type SessionId = string | null;
  export type WorkspaceId = string;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface GrantRequest {
    data: GrantCommand;
    meta: CommandMeta;
  }
  export interface GrantCommand {
    destination?: Destination;
    purposes: Purposes;
    resource_ids: ResourceIds;
    scope: ScopeRef;
  }
  export interface ScopeRef {
    session_id?: SessionId;
    workspace_id: WorkspaceId;
  }
  export interface CommandMeta {
    command_id?: CommandId;
    expected_version?: ExpectedVersion;
  }

}
export type GrantRequest = GrantRequestSchema.GrantRequest;

export namespace HealthSchema {
  export type ApiVersion = 2;
  export type RuntimeVersion = string;
  export type SchemaVersion = 2;

  export interface Health {
    api_version: ApiVersion;
    runtime_version: RuntimeVersion;
    schema_version: SchemaVersion;
  }

}
export type Health = HealthSchema.Health;

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
  export type SessionId = string;
  export type WorkspaceId = string;
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
  export type RunId2 = string;
  export type SessionId1 = string;
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
  export type SessionId2 = string;
  export type WorkspaceId2 = string;
  export type Items = (InboxQuestion | InboxApproval)[];
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
    workspace_id: WorkspaceId;
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
    workspace_id: WorkspaceId2;
  }
  export interface Approval {
    activity_id: ActivityId;
    args_hash: ArgsHash;
    call_id: CallId1;
    dependencies: Dependencies1;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id2;
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
  export interface Parameters {
    [k: string]: JsonValue;
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

export namespace MessagePageSchema {
  export type ActivityId = string | null;
  export type EventId = string;
  export type EventIndex = number;
  export type Id = string;
  export type Origin = 'conversation' | 'steering' | 'answer' | 'task_result';
  export type Kind = 'text';
  export type Text = string;
  export type Kind1 = 'reasoning';
  export type Text1 = string;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Kind2 = 'tool_call';
  export type Name = string;
  export type CallId1 = string;
  export type Error = string | null;
  export type Kind3 = 'tool_result';
  export type OriginMessageId = string | null;
  export type Parts = (TextPart | ReasoningPart | ToolCallPart | ToolResultPart)[];
  export type PrivateRef = string | null;
  export type Role = 'user' | 'assistant' | 'tool';
  export type Epoch = number;
  export type ScopeId = string;
  export type SourceDependencies = ScopeDependency[];
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
    event_id: EventId;
    event_index: EventIndex;
    id: Id;
    origin: Origin;
    parts: Parts;
    private_ref: PrivateRef;
    role: Role;
    source_dependencies: SourceDependencies;
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
    name: Name;
  }
  export interface Arguments {
    [k: string]: JsonValue;
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
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type ContextWindowTokens = number | null;
  export type DisplayName = string | null;
  export type Kind = 'user' | 'catalog' | 'application' | 'unknown';
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
    metadata_sources: MetadataSources;
    model_id: ModelId;
    provider_preset_id: ProviderPresetId;
  }
  export interface ModelCapabilities {
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
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
  export type Protocol = 'openai_compatible' | 'anthropic';
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
  export type Protocol = 'openai_compatible' | 'anthropic';
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

export namespace ModelMessageSchema {
  export type ActivityId = string | null;
  export type EventId = string;
  export type EventIndex = number;
  export type Id = string;
  export type Origin = 'conversation' | 'steering' | 'answer' | 'task_result';
  export type Kind = 'text';
  export type Text = string;
  export type Kind1 = 'reasoning';
  export type Text1 = string;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Kind2 = 'tool_call';
  export type Name = string;
  export type CallId1 = string;
  export type Error = string | null;
  export type Kind3 = 'tool_result';
  export type OriginMessageId = string | null;
  export type Parts = (TextPart | ReasoningPart | ToolCallPart | ToolResultPart)[];
  export type PrivateRef = string | null;
  export type Role = 'user' | 'assistant' | 'tool';
  export type Epoch = number;
  export type ScopeId = string;
  export type SourceDependencies = ScopeDependency[];

  export interface ModelMessage {
    activity_id: ActivityId;
    event_id: EventId;
    event_index: EventIndex;
    id: Id;
    origin: Origin;
    parts: Parts;
    private_ref: PrivateRef;
    role: Role;
    source_dependencies: SourceDependencies;
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
    name: Name;
  }
  export interface Arguments {
    [k: string]: JsonValue;
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
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
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
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
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
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
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
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
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
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number | null;
  export type DisplayName = string | null;
  export type Endpoint = string;
  export type Id = string;
  export type MaxOutputTokens = number;
  export type Kind = 'user' | 'catalog' | 'application' | 'unknown';
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
  export type Protocol = 'openai_compatible' | 'anthropic';
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
    max_output_tokens: MaxOutputTokens;
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
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
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
  export type Id = string;
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
    id: Id;
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

export namespace ProviderPresetListSchema {
  export type AuthMode = 'api_key';
  export type DefaultEndpoint = string;
  export type DisplayName = string;
  export type Id = string;
  export type Protocol = 'openai_compatible' | 'anthropic';
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
    | LifecycleEvent;
  export type ActivityId = string | null;
  export type CausationId = string | null;
  export type CreatedAt = string;
  export type EventId = string;
  export type EventVersion = 1;
  export type Kind = 'workspace.created' | 'workspace.default_created' | 'workspace.directory_changed';
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
  export type Kind1 = 'session.created';
  export type AgentProfileId = string;
  export type Id1 = string;
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
  export type Kind2 = 'agent.saved';
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type DisplayName = string;
  export type IconId = string;
  export type Id2 = string;
  export type Instructions = string;
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
  export type Kind3 = 'model.saved';
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
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
  export type Kind4 = 'connection.saved';
  export type DisplayName2 = string;
  export type Endpoint = string;
  export type Id4 = string;
  export type Protocol = 'openai_compatible' | 'anthropic';
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
  export type Kind5 =
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
    | 'runtime.recovered'
    | 'artifact.published'
    | 'question.asked'
    | 'question.answered'
    | 'task.submitted'
    | 'task.cancelled'
    | 'task.consumed'
    | 'task.joined'
    | 'wait.registered'
    | 'wait.resolved';
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id5 = string;
  export type Kind6 = 'model' | 'tool';
  export type Operation = string;
  export type RunId5 = string;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId5 = string;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version5 = number;
  export type Activities = ActivityView[];
  export type ActivityId6 = string;
  export type ContentHash = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id6 = string;
  export type MediaType = 'text/plain' | 'text/markdown';
  export type TaskId6 = string;
  export type Version6 = number;
  export type Artifacts = ArtifactRef[];
  export type Id7 = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxModelRequests = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type ModelRequests = number;
  export type ReservedUnits = string;
  export type RunId6 = string;
  export type SpentUnits = string;
  export type Steps = number;
  export type TaskCount = number;
  export type Version7 = number;
  export type Budgets = BudgetSnapshot[];
  export type Id8 = string;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId7 = string;
  export type TargetTaskId = string;
  export type TaskId7 = string;
  export type Consumptions = ResultConsumption[];
  export type ChildResultVersion = number;
  export type ChildTaskId = string;
  export type EventId6 = string;
  export type Id9 = string;
  export type RootTaskId = string;
  export type RunId8 = string;
  export type Joins = JoinFact[];
  export type ActivityId7 = string | null;
  export type EventId7 = string;
  export type EventIndex = number;
  export type Id10 = string;
  export type Origin = 'conversation' | 'steering' | 'answer' | 'task_result';
  export type Kind7 = 'text';
  export type Text = string;
  export type Kind8 = 'reasoning';
  export type Text1 = string;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Kind9 = 'tool_call';
  export type Name1 = string;
  export type CallId1 = string;
  export type Error1 = string | null;
  export type Kind10 = 'tool_result';
  export type OriginMessageId = string | null;
  export type Parts = (TextPart | ReasoningPart | ToolCallPart | ToolResultPart)[];
  export type PrivateRef = string | null;
  export type Role = 'user' | 'assistant' | 'tool';
  export type SourceDependencies = ScopeDependency[];
  export type Messages = MessageView[];
  export type AnswerMessageId = string | null;
  export type CallId2 = string;
  export type Dependencies2 = ScopeDependency[];
  export type Id11 = string;
  export type MessageId = string;
  export type Question1 = string;
  export type RunId9 = string;
  export type Status1 = 'pending' | 'answered' | 'cancelled';
  export type TaskId8 = string;
  export type Version8 = number;
  export type Questions = Question[];
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
  export type AgentExecutorId = string;
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
  export type ConnectionId1 = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens1 = number;
  export type DisplayName3 = string | null;
  export type Endpoint1 = string;
  export type Id12 = string;
  export type MaxOutputTokens1 = number;
  export type Kind11 = 'user' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source2 = string | null;
  export type VerifiedAt = string | null;
  export type Version9 = string | null;
  export type ModelId2 = string;
  export type OpenaiMaxTokensField1 = ('max_tokens' | 'max_completion_tokens') | null;
  export type Protocol1 = 'openai_compatible' | 'anthropic';
  export type ProviderPresetId1 = string | null;
  export type RequestTimeoutSeconds1 = number;
  export type SecretRef1 = string | null;
  export type Version10 = number;
  export type PricingUnknownReason = string | null;
  export type DeadlineAt = string;
  export type Id13 = string;
  export type ArtifactIds = string[];
  export type Reason = string;
  export type ResultVersion1 = number;
  export type TaskId9 = string;
  export type HandledFailures = FailureDisposition[];
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Reason1 = string | null;
  export type ResourceIds = string[];
  export type RootTaskId1 = string;
  export type ScopeDependencies = ScopeDependency[];
  export type SessionId5 = string;
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
  export type Version11 = number;
  export type WorkspaceId6 = string;
  export type Runs = RunSnapshot[];
  export type CreatedSeq = number;
  export type DeadlineAt1 = string | null;
  export type ExecutorId = string;
  export type Id14 = string;
  export type Kind12 = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason2 = string | null;
  export type ResultVersion2 = number | null;
  export type RunId10 = string;
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
  export type Version12 = number;
  export type Tasks = TaskSnapshot[];
  export type ContinuationId = string;
  export type DeadlineAt2 = string | null;
  export type Id15 = string;
  export type OwnerTaskId = string;
  export type ResultVersion3 = number | null;
  export type RunId11 = string;
  export type State3 = 'pending' | 'ready' | 'timeout' | 'cancelled';
  export type TargetTaskId1 = string;
  export type Version13 = number;
  export type Waits = WaitRecord[];
  export type RunId12 = string | null;
  export type Seq5 = number | null;
  export type SessionId6 = string | null;
  export type TaskId10 = string | null;
  export type WorkspaceId7 = string | null;
  export type ActivityId8 = string | null;
  export type CausationId6 = string | null;
  export type CreatedAt6 = string;
  export type EventId8 = string;
  export type EventVersion6 = 1;
  export type Kind13 =
    | 'resource.registered'
    | 'resource.updated'
    | 'grant.created'
    | 'grant.revoked'
    | 'approval.proposed'
    | 'approval.decided';
  export type ActivityId9 = string;
  export type ArgsHash = string;
  export type CallId3 = string;
  export type Dependencies3 = ScopeDependency[];
  export type ExpiresAt = string;
  export type ArtifactId = string;
  export type ArtifactVersion = number;
  export type TargetExists = boolean;
  export type TargetPath = string;
  export type Id16 = string;
  export type RunId13 = string;
  export type SessionId7 = string;
  export type Status2 = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
  export type Target = string | null;
  export type TaskId11 = string;
  export type ToolName = string;
  export type ToolVersion = string;
  export type Version14 = number;
  export type WorkspaceId8 = string;
  export type Approvals = Approval[];
  export type Destination = string | null;
  export type Epoch1 = number;
  export type Id17 = string;
  /**
   * @minItems 1
   */
  export type Purposes = ['read' | 'model_send' | 'export', ...('read' | 'model_send' | 'export')[]];
  /**
   * @minItems 1
   */
  export type ResourceIds1 = [string, ...string[]];
  export type SessionId8 = string | null;
  export type WorkspaceId9 = string;
  export type Status3 = 'active' | 'revoked';
  export type Version15 = number;
  export type Grants = DataUseGrant[];
  export type Id18 = string;
  export type Kind14 = 'file' | 'directory' | 'export';
  export type Label = string;
  export type SourceVersion = string | null;
  export type Version16 = number;
  export type Resources = ResourceRef[];
  export type RunId14 = string | null;
  export type Seq6 = number | null;
  export type SessionId9 = string | null;
  export type TaskId12 = string | null;
  export type WorkspaceId10 = string | null;
  export type ActivityId10 = string | null;
  export type CausationId7 = string | null;
  export type CreatedAt7 = string;
  export type EventId9 = string;
  export type EventVersion7 = 1;
  export type Kind15 = 'scope.deleted' | 'scope.revoked' | 'accounting.settled';
  export type Epoch2 = number;
  export type Status4 = 'deleted';
  export type Deletions = DeletionReceipt[];
  export type Epoch3 = number;
  export type Id19 = string;
  export type Status5 = 'active' | 'revoked' | 'deleted';
  export type Scopes = ScopeState[];
  export type RunId15 = string | null;
  export type Seq7 = number | null;
  export type SessionId10 = string | null;
  export type TaskId13 = string | null;
  export type WorkspaceId11 = string | null;

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
    id: Id1;
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
    kind: Kind2;
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
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id2;
    instructions: Instructions;
    version: Version2;
  }
  export interface ModelProfileEvent {
    activity_id: ActivityId3;
    causation_id: CausationId3;
    created_at: CreatedAt3;
    event_id: EventId3;
    event_version: EventVersion3;
    kind: Kind3;
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
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
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
    kind: Kind4;
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
    kind: Kind5;
    payload: PublicChange;
    run_id: RunId12;
    seq: Seq5;
    session_id: SessionId6;
    task_id: TaskId10;
    workspace_id: WorkspaceId7;
  }
  export interface PublicChange {
    activities: Activities;
    artifacts: Artifacts;
    budgets: Budgets;
    consumptions: Consumptions;
    joins: Joins;
    messages: Messages;
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
    kind: Kind6;
    operation: Operation;
    run_id: RunId5;
    state: State;
    task_id: TaskId5;
    usage: Usage | null;
    version: Version5;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface Usage {
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }
  export interface ArtifactRef {
    activity_id: ActivityId6;
    content_hash: ContentHash;
    dependencies: Dependencies1;
    id: Id6;
    media_type: MediaType;
    task_id: TaskId6;
    version: Version6;
  }
  export interface BudgetSnapshot {
    id: Id7;
    limits: RunLimits;
    model_requests: ModelRequests;
    reserved_units: ReservedUnits;
    run_id: RunId6;
    spent_units: SpentUnits;
    steps: Steps;
    task_count: TaskCount;
    version: Version7;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_model_requests: MaxModelRequests;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
  }
  export interface ResultConsumption {
    id: Id8;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId7;
    target_task_id: TargetTaskId;
    task_id: TaskId7;
  }
  export interface JoinFact {
    child_result_version: ChildResultVersion;
    child_task_id: ChildTaskId;
    event_id: EventId6;
    id: Id9;
    root_task_id: RootTaskId;
    run_id: RunId8;
  }
  export interface MessageView {
    activity_id: ActivityId7;
    event_id: EventId7;
    event_index: EventIndex;
    id: Id10;
    origin: Origin;
    parts: Parts;
    private_ref: PrivateRef;
    role: Role;
    source_dependencies: SourceDependencies;
  }
  export interface TextPart {
    kind: Kind7;
    text: Text;
  }
  export interface ReasoningPart {
    kind: Kind8;
    text: Text1;
  }
  export interface ToolCallPart {
    arguments: Arguments;
    call_id: CallId;
    kind: Kind9;
    name: Name1;
  }
  export interface Arguments {
    [k: string]: JsonValue;
  }
  export interface ToolResultPart {
    call_id: CallId1;
    error: Error1;
    kind: Kind10;
    origin_message_id: OriginMessageId;
    result: {
      [k: string]: unknown;
    };
  }
  export interface Question {
    answer_message_id: AnswerMessageId;
    answer_schema: AnswerSchema;
    call_id: CallId2;
    dependencies: Dependencies2;
    id: Id11;
    message_id: MessageId;
    question: Question1;
    run_id: RunId9;
    status: Status1;
    task_id: TaskId8;
    version: Version8;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface RunSnapshot {
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    id: Id13;
    output: RunOutput | null;
    reason: Reason1;
    resource_ids: ResourceIds;
    root_task_id: RootTaskId1;
    scope_dependencies: ScopeDependencies;
    session_id: SessionId5;
    state: State1;
    version: Version11;
    workspace_id: WorkspaceId6;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    plugins: Plugins;
    tools: Tools1;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools1 {
    [k: string]: string;
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
    capabilities: ModelCapabilities;
    connection_id: ConnectionId1;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens1;
    display_name: DisplayName3;
    endpoint: Endpoint1;
    id: Id12;
    max_output_tokens: MaxOutputTokens1;
    metadata_sources: MetadataSources;
    model_id: ModelId2;
    openai_max_tokens_field: OpenaiMaxTokensField1;
    pricing: ModelPricing;
    protocol: Protocol1;
    provider_preset_id: ProviderPresetId1;
    request_timeout_seconds: RequestTimeoutSeconds1;
    secret_ref: SecretRef1;
    version: Version10;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind11;
    note: Note;
    source: Source2;
    verified_at: VerifiedAt;
    version: Version9;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds;
    handled_failures: HandledFailures;
    summary: Summary;
    unresolved: Unresolved;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion1;
    task_id: TaskId9;
  }
  export interface TaskSnapshot {
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt1;
    executor_id: ExecutorId;
    id: Id14;
    kind: Kind12;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason2;
    result_version: ResultVersion2;
    run_id: RunId10;
    state: State2;
    version: Version12;
  }
  export interface WaitRecord {
    continuation_id: ContinuationId;
    deadline_at: DeadlineAt2;
    id: Id15;
    owner_task_id: OwnerTaskId;
    result_version: ResultVersion3;
    run_id: RunId11;
    state: State3;
    target_task_id: TargetTaskId1;
    version: Version13;
  }
  export interface PolicyEvent {
    activity_id: ActivityId8;
    causation_id: CausationId6;
    created_at: CreatedAt6;
    event_id: EventId8;
    event_version: EventVersion6;
    kind: Kind13;
    payload: PublicPolicyChange;
    run_id: RunId14;
    seq: Seq6;
    session_id: SessionId9;
    task_id: TaskId12;
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
    dependencies: Dependencies3;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id16;
    parameters: Parameters;
    run_id: RunId13;
    session_id: SessionId7;
    status: Status2;
    target: Target;
    task_id: TaskId11;
    tool_name: ToolName;
    tool_version: ToolVersion;
    version: Version14;
    workspace_id: WorkspaceId8;
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
    destination: Destination;
    epoch: Epoch1;
    id: Id17;
    purposes: Purposes;
    resource_ids: ResourceIds1;
    scope: ScopeRef;
    status: Status3;
    version: Version15;
  }
  export interface ScopeRef {
    session_id: SessionId8;
    workspace_id: WorkspaceId9;
  }
  export interface ResourceRef {
    id: Id18;
    kind: Kind14;
    label: Label;
    scope: ScopeRef;
    source_version: SourceVersion;
    version: Version16;
  }
  export interface LifecycleEvent {
    activity_id: ActivityId10;
    causation_id: CausationId7;
    created_at: CreatedAt7;
    event_id: EventId9;
    event_version: EventVersion7;
    kind: Kind15;
    payload: PublicLifecycleChange;
    run_id: RunId15;
    seq: Seq7;
    session_id: SessionId10;
    task_id: TaskId13;
    workspace_id: WorkspaceId11;
  }
  export interface PublicLifecycleChange {
    deletions: Deletions;
    scopes: Scopes;
  }
  export interface DeletionReceipt {
    epoch: Epoch2;
    scope: ScopeRef;
    status: Status4;
  }
  export interface ScopeState {
    epoch: Epoch3;
    id: Id19;
    scope: ScopeRef;
    status: Status5;
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

export namespace ResourcePageSchema {
  export type Id = string;
  export type Kind = 'file' | 'directory' | 'export';
  export type Label = string;
  export type SessionId = string | null;
  export type WorkspaceId = string;
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
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type ResourcePage = ResourcePageSchema.ResourcePage;

export namespace ResourceRefSchema {
  export type Id = string;
  export type Kind = 'file' | 'directory' | 'export';
  export type Label = string;
  export type SessionId = string | null;
  export type WorkspaceId = string;
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
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type ResourceRef = ResourceRefSchema.ResourceRef;

export namespace ResultConsumptionSchema {
  export type Id = string;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId = string;
  export type TargetTaskId = string;
  export type TaskId = string;

  export interface ResultConsumption {
    id: Id;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId;
    target_task_id: TargetTaskId;
    task_id: TaskId;
  }

}
export type ResultConsumption = ResultConsumptionSchema.ResultConsumption;

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
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId = string;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version = number;
  export type Items = ActivityView[];
  export type NextCursor = string | null;
  export type Watermark = string;
  export type ActivityId = string;
  export type ArgsHash = string;
  export type CallId = string;
  export type Dependencies1 = ScopeDependency[];
  export type ExpiresAt = string;
  export type ArtifactId = string;
  export type ArtifactVersion = number;
  export type TargetExists = boolean;
  export type TargetPath = string;
  export type Id1 = string;
  export type JsonValue = unknown;
  export type RunId1 = string;
  export type SessionId = string;
  export type Status1 = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
  export type Target = string | null;
  export type TaskId1 = string;
  export type ToolName = string;
  export type ToolVersion = string;
  export type Version1 = number;
  export type WorkspaceId = string;
  export type Items1 = Approval[];
  export type NextCursor1 = string | null;
  export type Watermark1 = string;
  export type ActivityId1 = string;
  export type ContentHash = string;
  export type Dependencies2 = ScopeDependency[];
  export type Id2 = string;
  export type MediaType = 'text/plain' | 'text/markdown';
  export type TaskId2 = string;
  export type Version2 = number;
  export type Items2 = ArtifactRef[];
  export type NextCursor2 = string | null;
  export type Watermark2 = string;
  export type Id3 = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxModelRequests = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type ModelRequests = number;
  export type ReservedUnits = string;
  export type RunId2 = string;
  export type SpentUnits = string;
  export type Steps = number;
  export type TaskCount = number;
  export type Version3 = number;
  export type Id4 = string;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId3 = string;
  export type TargetTaskId = string;
  export type TaskId3 = string;
  export type Items3 = ResultConsumption[];
  export type NextCursor3 = string | null;
  export type Watermark3 = string;
  export type ActivityId2 = string;
  export type OmittedGroupCount = number;
  export type OmittedMessageCount = number;
  export type State1 = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
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
  export type EventId1 = string;
  export type EventIndex = number;
  export type Id6 = string;
  export type Origin = 'conversation' | 'steering' | 'answer' | 'task_result';
  export type Kind1 = 'text';
  export type Text = string;
  export type Kind2 = 'reasoning';
  export type Text1 = string;
  export type CallId1 = string;
  export type Kind3 = 'tool_call';
  export type Name = string;
  export type CallId2 = string;
  export type Error1 = string | null;
  export type Kind4 = 'tool_result';
  export type OriginMessageId = string | null;
  export type Parts = (TextPart | ReasoningPart | ToolCallPart | ToolResultPart)[];
  export type PrivateRef = string | null;
  export type Role = 'user' | 'assistant' | 'tool';
  export type SourceDependencies = ScopeDependency[];
  export type Items5 = MessageView[];
  export type NextCursor5 = string | null;
  export type Watermark5 = string;
  export type AnswerMessageId = string | null;
  export type CallId3 = string;
  export type Dependencies3 = ScopeDependency[];
  export type Id7 = string;
  export type MessageId = string;
  export type Question1 = string;
  export type RunId5 = string;
  export type Status2 = 'pending' | 'answered' | 'cancelled';
  export type TaskId4 = string;
  export type Version4 = number;
  export type Items6 = Question[];
  export type NextCursor6 = string | null;
  export type Watermark6 = string;
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
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type DisplayName = string;
  export type IconId = string;
  export type Id8 = string;
  export type Instructions = string;
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
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id9 = string;
  export type MaxOutputTokens = number;
  export type Kind5 = 'user' | 'catalog' | 'application' | 'unknown';
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
  export type Protocol = 'openai_compatible' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version7 = number;
  export type PricingUnknownReason = string | null;
  export type DeadlineAt = string;
  export type Id10 = string;
  export type ArtifactIds = string[];
  export type Reason = string;
  export type ResultVersion1 = number;
  export type TaskId5 = string;
  export type HandledFailures = FailureDisposition[];
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Reason1 = string | null;
  export type ResourceIds = string[];
  export type RootTaskId1 = string;
  export type ScopeDependencies = ScopeDependency[];
  export type SessionId1 = string;
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
  export type WorkspaceId1 = string;
  export type CreatedSeq = number;
  export type DeadlineAt1 = string | null;
  export type ExecutorId = string;
  export type Id11 = string;
  export type Kind6 = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason2 = string | null;
  export type ResultVersion2 = number | null;
  export type RunId6 = string;
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
  export type ResultVersion3 = number | null;
  export type RunId7 = string;
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
    joins: PageJoinFact;
    messages: PageMessageView;
    questions: PageQuestion;
    run: RunSnapshot;
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
    state: State;
    task_id: TaskId;
    usage: Usage | null;
    version: Version;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface Usage {
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
    activity_id: ActivityId;
    args_hash: ArgsHash;
    call_id: CallId;
    dependencies: Dependencies1;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id1;
    parameters: Parameters;
    run_id: RunId1;
    session_id: SessionId;
    status: Status1;
    target: Target;
    task_id: TaskId1;
    tool_name: ToolName;
    tool_version: ToolVersion;
    version: Version1;
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
  export interface Parameters {
    [k: string]: JsonValue;
  }
  export interface PageArtifactRef {
    items: Items2;
    next_cursor: NextCursor2;
    watermark: Watermark2;
  }
  export interface ArtifactRef {
    activity_id: ActivityId1;
    content_hash: ContentHash;
    dependencies: Dependencies2;
    id: Id2;
    media_type: MediaType;
    task_id: TaskId2;
    version: Version2;
  }
  export interface BudgetSnapshot {
    id: Id3;
    limits: RunLimits;
    model_requests: ModelRequests;
    reserved_units: ReservedUnits;
    run_id: RunId2;
    spent_units: SpentUnits;
    steps: Steps;
    task_count: TaskCount;
    version: Version3;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_model_requests: MaxModelRequests;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
  }
  export interface PageResultConsumption {
    items: Items3;
    next_cursor: NextCursor3;
    watermark: Watermark3;
  }
  export interface ResultConsumption {
    id: Id4;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId3;
    target_task_id: TargetTaskId;
    task_id: TaskId3;
  }
  export interface ContextUsageSummary {
    activity_id: ActivityId2;
    omitted_group_count: OmittedGroupCount;
    omitted_message_count: OmittedMessageCount;
    reason_counts: ReasonCounts;
    state: State1;
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
    event_id: EventId1;
    event_index: EventIndex;
    id: Id6;
    origin: Origin;
    parts: Parts;
    private_ref: PrivateRef;
    role: Role;
    source_dependencies: SourceDependencies;
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
    name: Name;
  }
  export interface Arguments {
    [k: string]: JsonValue;
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
    run_id: RunId5;
    status: Status2;
    task_id: TaskId4;
    version: Version4;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface RunSnapshot {
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    id: Id10;
    output: RunOutput | null;
    reason: Reason1;
    resource_ids: ResourceIds;
    root_task_id: RootTaskId1;
    scope_dependencies: ScopeDependencies;
    session_id: SessionId1;
    state: State2;
    version: Version8;
    workspace_id: WorkspaceId1;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
  }
  export interface AgentProfile {
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id8;
    instructions: Instructions;
    version: Version5;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    plugins: Plugins;
    tools: Tools;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
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
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id9;
    max_output_tokens: MaxOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version7;
  }
  export interface ModelCapabilities {
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
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
  export interface RunOutput {
    artifact_ids: ArtifactIds;
    handled_failures: HandledFailures;
    summary: Summary;
    unresolved: Unresolved;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion1;
    task_id: TaskId5;
  }
  export interface PageTaskSnapshot {
    items: Items7;
    next_cursor: NextCursor7;
    watermark: Watermark7;
  }
  export interface TaskSnapshot {
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt1;
    executor_id: ExecutorId;
    id: Id11;
    kind: Kind6;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason2;
    result_version: ResultVersion2;
    run_id: RunId6;
    state: State3;
    version: Version9;
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
    result_version: ResultVersion3;
    run_id: RunId7;
    state: State4;
    target_task_id: TargetTaskId1;
    version: Version10;
  }

}
export type RunDetail = RunDetailSchema.RunDetail;

export namespace RunPageSchema {
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
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type Version = number;
  export type AgentExecutorId = string;
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
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxOutputTokens = number;
  export type Kind = 'user' | 'catalog' | 'application' | 'unknown';
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
  export type Protocol = 'openai_compatible' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type DeadlineAt = string;
  export type Id2 = string;
  export type ArtifactIds = string[];
  export type Reason = string;
  export type ResultVersion = number;
  export type TaskId = string;
  export type HandledFailures = FailureDisposition[];
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Reason1 = string | null;
  export type ResourceIds = string[];
  export type RootTaskId = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type ScopeDependencies = ScopeDependency[];
  export type SessionId = string;
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
  export type WorkspaceId = string;
  export type Items = RunSnapshot[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface RunPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface RunSnapshot {
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    id: Id2;
    output: RunOutput | null;
    reason: Reason1;
    resource_ids: ResourceIds;
    root_task_id: RootTaskId;
    scope_dependencies: ScopeDependencies;
    session_id: SessionId;
    state: State;
    version: Version3;
    workspace_id: WorkspaceId;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
  }
  export interface AgentProfile {
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    plugins: Plugins;
    tools: Tools;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
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
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_output_tokens: MaxOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
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
  export interface RunOutput {
    artifact_ids: ArtifactIds;
    handled_failures: HandledFailures;
    summary: Summary;
    unresolved: Unresolved;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion;
    task_id: TaskId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }

}
export type RunPage = RunPageSchema.RunPage;

export namespace RunSnapshotSchema {
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
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type Version = number;
  export type AgentExecutorId = string;
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
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxOutputTokens = number;
  export type Kind = 'user' | 'catalog' | 'application' | 'unknown';
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
  export type Protocol = 'openai_compatible' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type DeadlineAt = string;
  export type Id2 = string;
  export type ArtifactIds = string[];
  export type Reason = string;
  export type ResultVersion = number;
  export type TaskId = string;
  export type HandledFailures = FailureDisposition[];
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Reason1 = string | null;
  export type ResourceIds = string[];
  export type RootTaskId = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type ScopeDependencies = ScopeDependency[];
  export type SessionId = string;
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
  export type WorkspaceId = string;

  export interface RunSnapshot {
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    id: Id2;
    output: RunOutput | null;
    reason: Reason1;
    resource_ids: ResourceIds;
    root_task_id: RootTaskId;
    scope_dependencies: ScopeDependencies;
    session_id: SessionId;
    state: State;
    version: Version3;
    workspace_id: WorkspaceId;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
  }
  export interface AgentProfile {
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    plugins: Plugins;
    tools: Tools;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
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
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_output_tokens: MaxOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
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
  export interface RunOutput {
    artifact_ids: ArtifactIds;
    handled_failures: HandledFailures;
    summary: Summary;
    unresolved: Unresolved;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion;
    task_id: TaskId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }

}
export type RunSnapshot = RunSnapshotSchema.RunSnapshot;

export namespace SaveAgentCommandSchema {
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type Version = number;
  export type CommandId = string;
  export type ExpectedVersion = number | null;

  export interface SaveAgentCommand {
    data: AgentProfile;
    meta: CommandMeta;
  }
  export interface AgentProfile {
    communication_style?: CommunicationStyle;
    default_model_profile_id?: DefaultModelProfileId;
    display_name?: DisplayName;
    icon_id?: IconId;
    id?: Id;
    instructions?: Instructions;
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
  export type Protocol = 'openai_compatible' | 'anthropic';
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

export namespace SaveModelCommandSchema {
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
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
    structured_output?: StructuredOutput;
    thinking?: Thinking;
    tools?: Tools;
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

export namespace ScopeStateSchema {
  export type Epoch = number;
  export type Id = string;
  export type SessionId = string | null;
  export type WorkspaceId = string;
  export type Status = 'active' | 'revoked' | 'deleted';

  export interface ScopeState {
    epoch: Epoch;
    id: Id;
    scope: ScopeRef;
    status: Status;
  }
  export interface ScopeRef {
    session_id: SessionId;
    workspace_id: WorkspaceId;
  }

}
export type ScopeState = ScopeStateSchema.ScopeState;

export namespace SessionSchema {
  export type AgentProfileId = string;
  export type Id = string;
  export type Title = string;
  export type Version = number;
  export type WorkspaceId = string;

  export interface Session {
    agent_profile_id: AgentProfileId;
    id: Id;
    title: Title;
    version: Version;
    workspace_id: WorkspaceId;
  }

}
export type Session = SessionSchema.Session;

export namespace SessionPageSchema {
  export type AgentProfileId = string;
  export type Id = string;
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
    id: Id;
    title: Title;
    version: Version;
    workspace_id: WorkspaceId;
  }

}
export type SessionPage = SessionPageSchema.SessionPage;

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

export namespace StartRunCommandSchema {
  export type AgentProfileId = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxModelRequests = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type ModelProfileId = string;
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
    limits?: RunLimits;
    model_profile_id: ModelProfileId;
    resource_ids?: ResourceIds;
    text: Text;
  }
  export interface RunLimits {
    deadline_seconds?: DeadlineSeconds;
    max_cost_units?: MaxCostUnits;
    max_model_requests?: MaxModelRequests;
    max_steps?: MaxSteps;
    max_tasks?: MaxTasks;
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
    | LifecycleEvent;
  export type ActivityId = string | null;
  export type CausationId = string | null;
  export type CreatedAt = string;
  export type EventId = string;
  export type EventVersion = 1;
  export type Kind = 'workspace.created' | 'workspace.default_created' | 'workspace.directory_changed';
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
  export type Kind1 = 'session.created';
  export type AgentProfileId = string;
  export type Id1 = string;
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
  export type Kind2 = 'agent.saved';
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type DisplayName = string;
  export type IconId = string;
  export type Id2 = string;
  export type Instructions = string;
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
  export type Kind3 = 'model.saved';
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools = boolean | null;
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
  export type Kind4 = 'connection.saved';
  export type DisplayName2 = string;
  export type Endpoint = string;
  export type Id4 = string;
  export type Protocol = 'openai_compatible' | 'anthropic';
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
  export type Kind5 =
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
    | 'runtime.recovered'
    | 'artifact.published'
    | 'question.asked'
    | 'question.answered'
    | 'task.submitted'
    | 'task.cancelled'
    | 'task.consumed'
    | 'task.joined'
    | 'wait.registered'
    | 'wait.resolved';
  export type ActualUnits = string | null;
  export type Epoch = number;
  export type ScopeId = string;
  export type Dependencies = ScopeDependency[];
  export type Error = string | null;
  export type Id5 = string;
  export type Kind6 = 'model' | 'tool';
  export type Operation = string;
  export type RunId5 = string;
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId5 = string;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version5 = number;
  export type Activities = ActivityView[];
  export type ActivityId6 = string;
  export type ContentHash = string;
  export type Dependencies1 = ScopeDependency[];
  export type Id6 = string;
  export type MediaType = 'text/plain' | 'text/markdown';
  export type TaskId6 = string;
  export type Version6 = number;
  export type Artifacts = ArtifactRef[];
  export type Id7 = string;
  export type DeadlineSeconds = number;
  export type MaxCostUnits = string | null;
  export type MaxModelRequests = number;
  export type MaxSteps = number;
  export type MaxTasks = number;
  export type ModelRequests = number;
  export type ReservedUnits = string;
  export type RunId6 = string;
  export type SpentUnits = string;
  export type Steps = number;
  export type TaskCount = number;
  export type Version7 = number;
  export type Budgets = BudgetSnapshot[];
  export type Id8 = string;
  export type MessageBoundary = number;
  export type ResultVersion = number;
  export type RunId7 = string;
  export type TargetTaskId = string;
  export type TaskId7 = string;
  export type Consumptions = ResultConsumption[];
  export type ChildResultVersion = number;
  export type ChildTaskId = string;
  export type EventId6 = string;
  export type Id9 = string;
  export type RootTaskId = string;
  export type RunId8 = string;
  export type Joins = JoinFact[];
  export type ActivityId7 = string | null;
  export type EventId7 = string;
  export type EventIndex = number;
  export type Id10 = string;
  export type Origin = 'conversation' | 'steering' | 'answer' | 'task_result';
  export type Kind7 = 'text';
  export type Text = string;
  export type Kind8 = 'reasoning';
  export type Text1 = string;
  export type JsonValue = unknown;
  export type CallId = string;
  export type Kind9 = 'tool_call';
  export type Name1 = string;
  export type CallId1 = string;
  export type Error1 = string | null;
  export type Kind10 = 'tool_result';
  export type OriginMessageId = string | null;
  export type Parts = (TextPart | ReasoningPart | ToolCallPart | ToolResultPart)[];
  export type PrivateRef = string | null;
  export type Role = 'user' | 'assistant' | 'tool';
  export type SourceDependencies = ScopeDependency[];
  export type Messages = MessageView[];
  export type AnswerMessageId = string | null;
  export type CallId2 = string;
  export type Dependencies2 = ScopeDependency[];
  export type Id11 = string;
  export type MessageId = string;
  export type Question1 = string;
  export type RunId9 = string;
  export type Status1 = 'pending' | 'answered' | 'cancelled';
  export type TaskId8 = string;
  export type Version8 = number;
  export type Questions = Question[];
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
  export type AgentExecutorId = string;
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
  export type ConnectionId1 = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens1 = number;
  export type DisplayName3 = string | null;
  export type Endpoint1 = string;
  export type Id12 = string;
  export type MaxOutputTokens1 = number;
  export type Kind11 = 'user' | 'catalog' | 'application' | 'unknown';
  export type Note = string | null;
  export type Source2 = string | null;
  export type VerifiedAt = string | null;
  export type Version9 = string | null;
  export type ModelId2 = string;
  export type OpenaiMaxTokensField1 = ('max_tokens' | 'max_completion_tokens') | null;
  export type Protocol1 = 'openai_compatible' | 'anthropic';
  export type ProviderPresetId1 = string | null;
  export type RequestTimeoutSeconds1 = number;
  export type SecretRef1 = string | null;
  export type Version10 = number;
  export type PricingUnknownReason = string | null;
  export type DeadlineAt = string;
  export type Id13 = string;
  export type ArtifactIds = string[];
  export type Reason = string;
  export type ResultVersion1 = number;
  export type TaskId9 = string;
  export type HandledFailures = FailureDisposition[];
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Reason1 = string | null;
  export type ResourceIds = string[];
  export type RootTaskId1 = string;
  export type ScopeDependencies = ScopeDependency[];
  export type SessionId5 = string;
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
  export type Version11 = number;
  export type WorkspaceId6 = string;
  export type Runs = RunSnapshot[];
  export type CreatedSeq = number;
  export type DeadlineAt1 = string | null;
  export type ExecutorId = string;
  export type Id14 = string;
  export type Kind12 = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason2 = string | null;
  export type ResultVersion2 = number | null;
  export type RunId10 = string;
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
  export type Version12 = number;
  export type Tasks = TaskSnapshot[];
  export type ContinuationId = string;
  export type DeadlineAt2 = string | null;
  export type Id15 = string;
  export type OwnerTaskId = string;
  export type ResultVersion3 = number | null;
  export type RunId11 = string;
  export type State3 = 'pending' | 'ready' | 'timeout' | 'cancelled';
  export type TargetTaskId1 = string;
  export type Version13 = number;
  export type Waits = WaitRecord[];
  export type RunId12 = string | null;
  export type Seq5 = number | null;
  export type SessionId6 = string | null;
  export type TaskId10 = string | null;
  export type WorkspaceId7 = string | null;
  export type ActivityId8 = string | null;
  export type CausationId6 = string | null;
  export type CreatedAt6 = string;
  export type EventId8 = string;
  export type EventVersion6 = 1;
  export type Kind13 =
    | 'resource.registered'
    | 'resource.updated'
    | 'grant.created'
    | 'grant.revoked'
    | 'approval.proposed'
    | 'approval.decided';
  export type ActivityId9 = string;
  export type ArgsHash = string;
  export type CallId3 = string;
  export type Dependencies3 = ScopeDependency[];
  export type ExpiresAt = string;
  export type ArtifactId = string;
  export type ArtifactVersion = number;
  export type TargetExists = boolean;
  export type TargetPath = string;
  export type Id16 = string;
  export type RunId13 = string;
  export type SessionId7 = string;
  export type Status2 = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
  export type Target = string | null;
  export type TaskId11 = string;
  export type ToolName = string;
  export type ToolVersion = string;
  export type Version14 = number;
  export type WorkspaceId8 = string;
  export type Approvals = Approval[];
  export type Destination = string | null;
  export type Epoch1 = number;
  export type Id17 = string;
  /**
   * @minItems 1
   */
  export type Purposes = ['read' | 'model_send' | 'export', ...('read' | 'model_send' | 'export')[]];
  /**
   * @minItems 1
   */
  export type ResourceIds1 = [string, ...string[]];
  export type SessionId8 = string | null;
  export type WorkspaceId9 = string;
  export type Status3 = 'active' | 'revoked';
  export type Version15 = number;
  export type Grants = DataUseGrant[];
  export type Id18 = string;
  export type Kind14 = 'file' | 'directory' | 'export';
  export type Label = string;
  export type SourceVersion = string | null;
  export type Version16 = number;
  export type Resources = ResourceRef[];
  export type RunId14 = string | null;
  export type Seq6 = number | null;
  export type SessionId9 = string | null;
  export type TaskId12 = string | null;
  export type WorkspaceId10 = string | null;
  export type ActivityId10 = string | null;
  export type CausationId7 = string | null;
  export type CreatedAt7 = string;
  export type EventId9 = string;
  export type EventVersion7 = 1;
  export type Kind15 = 'scope.deleted' | 'scope.revoked' | 'accounting.settled';
  export type Epoch2 = number;
  export type Status4 = 'deleted';
  export type Deletions = DeletionReceipt[];
  export type Epoch3 = number;
  export type Id19 = string;
  export type Status5 = 'active' | 'revoked' | 'deleted';
  export type Scopes = ScopeState[];
  export type RunId15 = string | null;
  export type Seq7 = number | null;
  export type SessionId10 = string | null;
  export type TaskId13 = string | null;
  export type WorkspaceId11 = string | null;
  export type EventId10 = string;
  export type Kind16 = 'durable';
  export type ActivityId11 = string;
  export type Index = number;
  export type Kind17 = 'delta' | 'reasoning_delta';
  export type Text2 = string;

  export interface DurableEvent {
    event: Event;
    event_id: EventId10;
    kind: Kind16;
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
    id: Id1;
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
    kind: Kind2;
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
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id2;
    instructions: Instructions;
    version: Version2;
  }
  export interface ModelProfileEvent {
    activity_id: ActivityId3;
    causation_id: CausationId3;
    created_at: CreatedAt3;
    event_id: EventId3;
    event_version: EventVersion3;
    kind: Kind3;
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
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools;
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
    kind: Kind4;
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
    kind: Kind5;
    payload: PublicChange;
    run_id: RunId12;
    seq: Seq5;
    session_id: SessionId6;
    task_id: TaskId10;
    workspace_id: WorkspaceId7;
  }
  export interface PublicChange {
    activities: Activities;
    artifacts: Artifacts;
    budgets: Budgets;
    consumptions: Consumptions;
    joins: Joins;
    messages: Messages;
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
    kind: Kind6;
    operation: Operation;
    run_id: RunId5;
    state: State;
    task_id: TaskId5;
    usage: Usage | null;
    version: Version5;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface Usage {
    cache_write_1h_tokens: CacheWrite1HTokens;
    cache_write_tokens: CacheWriteTokens;
    cached_input_tokens: CachedInputTokens;
    input_tokens: InputTokens;
    output_tokens: OutputTokens;
    source: Source;
    status: Status;
  }
  export interface ArtifactRef {
    activity_id: ActivityId6;
    content_hash: ContentHash;
    dependencies: Dependencies1;
    id: Id6;
    media_type: MediaType;
    task_id: TaskId6;
    version: Version6;
  }
  export interface BudgetSnapshot {
    id: Id7;
    limits: RunLimits;
    model_requests: ModelRequests;
    reserved_units: ReservedUnits;
    run_id: RunId6;
    spent_units: SpentUnits;
    steps: Steps;
    task_count: TaskCount;
    version: Version7;
  }
  export interface RunLimits {
    deadline_seconds: DeadlineSeconds;
    max_cost_units: MaxCostUnits;
    max_model_requests: MaxModelRequests;
    max_steps: MaxSteps;
    max_tasks: MaxTasks;
  }
  export interface ResultConsumption {
    id: Id8;
    message_boundary: MessageBoundary;
    result_version: ResultVersion;
    run_id: RunId7;
    target_task_id: TargetTaskId;
    task_id: TaskId7;
  }
  export interface JoinFact {
    child_result_version: ChildResultVersion;
    child_task_id: ChildTaskId;
    event_id: EventId6;
    id: Id9;
    root_task_id: RootTaskId;
    run_id: RunId8;
  }
  export interface MessageView {
    activity_id: ActivityId7;
    event_id: EventId7;
    event_index: EventIndex;
    id: Id10;
    origin: Origin;
    parts: Parts;
    private_ref: PrivateRef;
    role: Role;
    source_dependencies: SourceDependencies;
  }
  export interface TextPart {
    kind: Kind7;
    text: Text;
  }
  export interface ReasoningPart {
    kind: Kind8;
    text: Text1;
  }
  export interface ToolCallPart {
    arguments: Arguments;
    call_id: CallId;
    kind: Kind9;
    name: Name1;
  }
  export interface Arguments {
    [k: string]: JsonValue;
  }
  export interface ToolResultPart {
    call_id: CallId1;
    error: Error1;
    kind: Kind10;
    origin_message_id: OriginMessageId;
    result: {
      [k: string]: unknown;
    };
  }
  export interface Question {
    answer_message_id: AnswerMessageId;
    answer_schema: AnswerSchema;
    call_id: CallId2;
    dependencies: Dependencies2;
    id: Id11;
    message_id: MessageId;
    question: Question1;
    run_id: RunId9;
    status: Status1;
    task_id: TaskId8;
    version: Version8;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface RunSnapshot {
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    id: Id13;
    output: RunOutput | null;
    reason: Reason1;
    resource_ids: ResourceIds;
    root_task_id: RootTaskId1;
    scope_dependencies: ScopeDependencies;
    session_id: SessionId5;
    state: State1;
    version: Version11;
    workspace_id: WorkspaceId6;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    plugins: Plugins;
    tools: Tools1;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools1 {
    [k: string]: string;
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
    capabilities: ModelCapabilities;
    connection_id: ConnectionId1;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens1;
    display_name: DisplayName3;
    endpoint: Endpoint1;
    id: Id12;
    max_output_tokens: MaxOutputTokens1;
    metadata_sources: MetadataSources;
    model_id: ModelId2;
    openai_max_tokens_field: OpenaiMaxTokensField1;
    pricing: ModelPricing;
    protocol: Protocol1;
    provider_preset_id: ProviderPresetId1;
    request_timeout_seconds: RequestTimeoutSeconds1;
    secret_ref: SecretRef1;
    version: Version10;
  }
  export interface MetadataSources {
    [k: string]: MetadataSource;
  }
  export interface MetadataSource {
    kind: Kind11;
    note: Note;
    source: Source2;
    verified_at: VerifiedAt;
    version: Version9;
  }
  export interface RunOutput {
    artifact_ids: ArtifactIds;
    handled_failures: HandledFailures;
    summary: Summary;
    unresolved: Unresolved;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion1;
    task_id: TaskId9;
  }
  export interface TaskSnapshot {
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt1;
    executor_id: ExecutorId;
    id: Id14;
    kind: Kind12;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason2;
    result_version: ResultVersion2;
    run_id: RunId10;
    state: State2;
    version: Version12;
  }
  export interface WaitRecord {
    continuation_id: ContinuationId;
    deadline_at: DeadlineAt2;
    id: Id15;
    owner_task_id: OwnerTaskId;
    result_version: ResultVersion3;
    run_id: RunId11;
    state: State3;
    target_task_id: TargetTaskId1;
    version: Version13;
  }
  export interface PolicyEvent {
    activity_id: ActivityId8;
    causation_id: CausationId6;
    created_at: CreatedAt6;
    event_id: EventId8;
    event_version: EventVersion6;
    kind: Kind13;
    payload: PublicPolicyChange;
    run_id: RunId14;
    seq: Seq6;
    session_id: SessionId9;
    task_id: TaskId12;
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
    dependencies: Dependencies3;
    expires_at: ExpiresAt;
    export_preview: ExportApprovalPreview | null;
    id: Id16;
    parameters: Parameters;
    run_id: RunId13;
    session_id: SessionId7;
    status: Status2;
    target: Target;
    task_id: TaskId11;
    tool_name: ToolName;
    tool_version: ToolVersion;
    version: Version14;
    workspace_id: WorkspaceId8;
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
    destination: Destination;
    epoch: Epoch1;
    id: Id17;
    purposes: Purposes;
    resource_ids: ResourceIds1;
    scope: ScopeRef;
    status: Status3;
    version: Version15;
  }
  export interface ScopeRef {
    session_id: SessionId8;
    workspace_id: WorkspaceId9;
  }
  export interface ResourceRef {
    id: Id18;
    kind: Kind14;
    label: Label;
    scope: ScopeRef;
    source_version: SourceVersion;
    version: Version16;
  }
  export interface LifecycleEvent {
    activity_id: ActivityId10;
    causation_id: CausationId7;
    created_at: CreatedAt7;
    event_id: EventId9;
    event_version: EventVersion7;
    kind: Kind15;
    payload: PublicLifecycleChange;
    run_id: RunId15;
    seq: Seq7;
    session_id: SessionId10;
    task_id: TaskId13;
    workspace_id: WorkspaceId11;
  }
  export interface PublicLifecycleChange {
    deletions: Deletions;
    scopes: Scopes;
  }
  export interface DeletionReceipt {
    epoch: Epoch2;
    scope: ScopeRef;
    status: Status4;
  }
  export interface ScopeState {
    epoch: Epoch3;
    id: Id19;
    scope: ScopeRef;
    status: Status5;
  }
  export interface DeltaEvent {
    activity_id: ActivityId11;
    index: Index;
    kind: Kind17;
    text: Text2;
  }

}
export type StreamEvent = StreamEventSchema.StreamEvent;

export namespace TaskHandleSchema {
  export type Lifetime = 'run_bound';
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
  export type CreatedSeq = number;
  export type DeadlineAt = string | null;
  export type ExecutorId = string;
  export type Id = string;
  export type Kind = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason = string | null;
  export type ResultVersion = number | null;
  export type RunId = string;
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
  export type Version = number;
  export type Items = TaskSnapshot[];
  export type NextCursor = string | null;
  export type Watermark = string;

  export interface TaskPage {
    items: Items;
    next_cursor: NextCursor;
    watermark: Watermark;
  }
  export interface TaskSnapshot {
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    executor_id: ExecutorId;
    id: Id;
    kind: Kind;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason;
    result_version: ResultVersion;
    run_id: RunId;
    state: State;
    version: Version;
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
  export type MediaType = 'text/plain' | 'text/markdown';
  export type TaskId = string;
  export type Version = number;
  export type Artifacts = ArtifactRef[];
  export type Dependencies1 = ScopeDependency[];
  export type Error = string | null;
  export type Lifetime = 'run_bound';
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
  export type CreatedSeq = number;
  export type DeadlineAt = string | null;
  export type ExecutorId = string;
  export type Id = string;
  export type Kind = 'agent' | 'tool';
  export type OriginTaskId = string | null;
  export type ParentTaskId = string | null;
  export type Reason = string | null;
  export type ResultVersion = number | null;
  export type RunId = string;
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
  export type Version = number;

  export interface TaskSnapshot {
    created_seq: CreatedSeq;
    deadline_at: DeadlineAt;
    executor_id: ExecutorId;
    id: Id;
    kind: Kind;
    origin_task_id: OriginTaskId;
    parent_task_id: ParentTaskId;
    reason: Reason;
    result_version: ResultVersion;
    run_id: RunId;
    state: State;
    version: Version;
  }

}
export type TaskSnapshot = TaskSnapshotSchema.TaskSnapshot;

export namespace TextSliceSchema {
  export type End = number;
  export type SourceVersion = string;
  export type Start = number;
  export type Text = string;
  export type TotalChars = number;

  export interface TextSlice {
    end: End;
    source_version: SourceVersion;
    start: Start;
    text: Text;
    total_chars: TotalChars;
  }

}
export type TextSlice = TextSliceSchema.TextSlice;

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
  export type State = 'prepared' | 'dispatched' | 'succeeded' | 'failed' | 'uncertain';
  export type TaskId = string;
  export type CacheWrite1HTokens = number | null;
  export type CacheWriteTokens = number | null;
  export type CachedInputTokens = number | null;
  export type InputTokens = number | null;
  export type OutputTokens = number | null;
  export type Source = string | null;
  export type Status = 'unknown' | 'known';
  export type Version = number;
  export type Activities = ActivityView[];
  export type ActivityId = string | null;
  export type EventId = string;
  export type Kind1 = string;
  export type Seq = number | null;
  export type TaskId1 = string | null;
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
    activity_id: ActivityId;
    event_id: EventId;
    kind: Kind1;
    seq: Seq;
    task_id: TaskId1;
  }
  export interface ActivityView {
    actual_units: ActualUnits;
    dependencies: Dependencies;
    error: Error;
    id: Id;
    kind: Kind;
    operation: Operation;
    run_id: RunId;
    state: State;
    task_id: TaskId;
    usage: Usage | null;
    version: Version;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface Usage {
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
  export type SessionId = string | null;
  export type WorkspaceId = string;
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
  export type SessionId = string | null;
  export type WorkspaceId = string;
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
  export type CommunicationStyle = string;
  export type DefaultModelProfileId = string | null;
  export type DisplayName = string;
  export type IconId = string;
  export type Id = string;
  export type Instructions = string;
  export type Version = number;
  export type AgentExecutorId = string;
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
  export type StructuredOutput = boolean | null;
  export type Thinking = boolean | null;
  export type Tools1 = boolean | null;
  export type ConnectionId = string;
  export type ConnectionVersion = number;
  export type ContextWindowTokens = number;
  export type DisplayName1 = string | null;
  export type Endpoint = string;
  export type Id1 = string;
  export type MaxOutputTokens = number;
  export type Kind = 'user' | 'catalog' | 'application' | 'unknown';
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
  export type Protocol = 'openai_compatible' | 'anthropic';
  export type ProviderPresetId = string | null;
  export type RequestTimeoutSeconds = number;
  export type SecretRef = string | null;
  export type Version2 = number;
  export type PricingUnknownReason = string | null;
  export type DeadlineAt = string;
  export type Id2 = string;
  export type ArtifactIds = string[];
  export type Reason = string;
  export type ResultVersion = number;
  export type TaskId = string;
  export type HandledFailures = FailureDisposition[];
  export type Summary = string;
  /**
   * 尚未满足的任务要求；非空时不能完成Run。用户要求在交付物中保留的业务待确认事项（如未确定日期）应写入summary或Artifact，不属于未完成要求。任务要求均已满足时传空列表。
   */
  export type Unresolved = string[];
  export type Reason1 = string | null;
  export type ResourceIds = string[];
  export type RootTaskId = string;
  export type Epoch = number;
  export type ScopeId = string;
  export type ScopeDependencies = ScopeDependency[];
  export type SessionId = string;
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
  export type WorkspaceId = string;
  export type Items = RunSnapshot[];
  export type NextCursor = string | null;
  export type Watermark = string;
  export type Destination = string | null;
  export type Epoch1 = number;
  export type Id3 = string;
  /**
   * @minItems 1
   */
  export type Purposes = ['read' | 'model_send' | 'export', ...('read' | 'model_send' | 'export')[]];
  /**
   * @minItems 1
   */
  export type ResourceIds1 = [string, ...string[]];
  export type SessionId1 = string | null;
  export type WorkspaceId1 = string;
  export type Status = 'active' | 'revoked';
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
  export type JsonValue = unknown;
  export type RunId = string;
  export type SessionId2 = string;
  export type Status1 = 'pending' | 'approved' | 'denied' | 'superseded' | 'expired';
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
  export type Status2 = 'pending' | 'answered' | 'cancelled';
  export type TaskId2 = string;
  export type Version6 = number;
  export type Items3 = Question[];
  export type NextCursor3 = string | null;
  export type Watermark3 = string;
  export type Id6 = string;
  export type Kind1 = 'file' | 'directory' | 'export';
  export type Label = string;
  export type SourceVersion = string | null;
  export type Version7 = number;
  export type Items4 = ResourceRef[];
  export type NextCursor4 = string | null;
  export type Watermark4 = string;
  export type AgentProfileId = string;
  export type Id7 = string;
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
    budget_id: BudgetId;
    config: ConfigSnapshot;
    deadline_at: DeadlineAt;
    id: Id2;
    output: RunOutput | null;
    reason: Reason1;
    resource_ids: ResourceIds;
    root_task_id: RootTaskId;
    scope_dependencies: ScopeDependencies;
    session_id: SessionId;
    state: State;
    version: Version3;
    workspace_id: WorkspaceId;
  }
  export interface ConfigSnapshot2 {
    agent_profile: AgentProfile;
    catalog: CatalogVersions;
    model_pricing: PricingSnapshot | null;
    model_profile: ResolvedModelProfile;
    pricing_unknown_reason: PricingUnknownReason;
  }
  export interface AgentProfile {
    communication_style: CommunicationStyle;
    default_model_profile_id: DefaultModelProfileId;
    display_name: DisplayName;
    icon_id: IconId;
    id: Id;
    instructions: Instructions;
    version: Version;
  }
  export interface CatalogVersions {
    agent_executor_id: AgentExecutorId;
    plugins: Plugins;
    tools: Tools;
  }
  export interface Plugins {
    [k: string]: string;
  }
  export interface Tools {
    [k: string]: string;
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
    capabilities: ModelCapabilities;
    connection_id: ConnectionId;
    connection_version: ConnectionVersion;
    context_window_tokens: ContextWindowTokens;
    display_name: DisplayName1;
    endpoint: Endpoint;
    id: Id1;
    max_output_tokens: MaxOutputTokens;
    metadata_sources: MetadataSources;
    model_id: ModelId;
    openai_max_tokens_field: OpenaiMaxTokensField;
    pricing: ModelPricing;
    protocol: Protocol;
    provider_preset_id: ProviderPresetId;
    request_timeout_seconds: RequestTimeoutSeconds;
    secret_ref: SecretRef;
    version: Version2;
  }
  export interface ModelCapabilities {
    structured_output: StructuredOutput;
    thinking: Thinking;
    tools: Tools1;
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
  export interface RunOutput {
    artifact_ids: ArtifactIds;
    handled_failures: HandledFailures;
    summary: Summary;
    unresolved: Unresolved;
  }
  export interface FailureDisposition {
    reason: Reason;
    result_version: ResultVersion;
    task_id: TaskId;
  }
  export interface ScopeDependency {
    epoch: Epoch;
    scope_id: ScopeId;
  }
  export interface PageDataUseGrant {
    items: Items1;
    next_cursor: NextCursor1;
    watermark: Watermark1;
  }
  export interface DataUseGrant {
    destination: Destination;
    epoch: Epoch1;
    id: Id3;
    purposes: Purposes;
    resource_ids: ResourceIds1;
    scope: ScopeRef;
    status: Status;
    version: Version4;
  }
  export interface ScopeRef {
    session_id: SessionId1;
    workspace_id: WorkspaceId1;
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
    parameters: Parameters;
    run_id: RunId;
    session_id: SessionId2;
    status: Status1;
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
    status: Status2;
    task_id: TaskId2;
    version: Version6;
  }
  export interface AnswerSchema {
    [k: string]: JsonValue;
  }
  export interface PageResourceRef {
    items: Items4;
    next_cursor: NextCursor4;
    watermark: Watermark4;
  }
  export interface ResourceRef {
    id: Id6;
    kind: Kind1;
    label: Label;
    scope: ScopeRef;
    source_version: SourceVersion;
    version: Version7;
  }
  export interface PageSession {
    items: Items5;
    next_cursor: NextCursor5;
    watermark: Watermark5;
  }
  export interface Session {
    agent_profile_id: AgentProfileId;
    id: Id7;
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
