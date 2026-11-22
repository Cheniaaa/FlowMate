import { invoke } from '@tauri-apps/api/core';
import type {
  AnswerCommand, ApprovalCommand, CommandMeta, CreateSessionCommand, CreateWorkspaceCommand,
  ExportCommand, GrantRequest, SaveAgentCommand, SaveConnectionCommand, SaveModelCommand, StartRunCommand, SteeringCommand,
  ArchiveSessionCommand, RenameCommand, RunSnapshot, SetWorkspaceDirectoryCommand, StreamEvent, WorkspaceSnapshot,
  CreateMemoryCommand, MemoryDecisionCommand, MemoryGrantRequest, MemoryRecord, SaveMemoryPolicyCommand,
  SubmitMemoryMaintenanceCommand,
  SaveExecutionEnvironmentCommand,
  StageSkillCommand, ImportSkillCommand, PublishSkillCommand, BindSkillCommand, ResolveSkills,
  SaveSkillExportCommand, SkillScopeRequest,
  DiscardSkillCandidateCommand,
  SaveSkillExecutionPermissionCommand,
  ResourceCoverageRequest,
  VisionContinueCommand,
  SaveTitlePolicyCommand,
  KnowledgeImportCommand, KnowledgeCancelCommand, KnowledgeSourceActionCommand,
  SaveEmbeddingProfileCommand, SetProjectKnowledgeCommand,
} from '../generated/contracts';
import { laterCursor, readSse } from './events';
import { validate, type RootName } from './validation';

export interface RuntimeConnection { base_url: string; token: string; protocol_version: number }
export interface PageQuery { cursor?: string; limit?: number }
export interface ModelQuery extends PageQuery { connection_id?: string }
export interface ScopeQuery extends PageQuery { session_id?: string }
export interface TaskQuery extends PageQuery { workspace_id?: string; state?: RunSnapshot['state']; kind?: RunSnapshot['kind'] }
export interface MemoryQuery extends PageQuery { scope_kind: 'user_global' | 'workspace'; workspace_id?: string; status?: MemoryRecord['status'] }
interface EvidenceExcerptQuery extends PageQuery { expected_revision: number; offset: number; receipt_message_id?: string }
export interface StreamHandlers {
  snapshot: (snapshot: WorkspaceSnapshot) => void | Promise<void>;
  event: (event: StreamEvent) => void | Promise<void>;
  connection?: (state: 'connected' | 'reconnecting') => void | Promise<void>;
}
export const commandMeta = (expected_version: number | null = null): CommandMeta => ({ command_id: crypto.randomUUID(), expected_version });
const pathId = encodeURIComponent;
function query(path: string, parameters: PageQuery = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) if (value !== undefined) search.set(key, String(value));
  return path + (search.size ? `?${search}` : '');
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly relatedIds: readonly string[] = []) { super(message); }
}

class TransportError extends Error {}

function waitForReconnect(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export class RuntimeClient {
  constructor(readonly connection: RuntimeConnection) {}

  static async connect() {
    const connection = await invoke<RuntimeConnection>('runtime_connection');
    if (connection.protocol_version !== 4) throw new Error('Runtime 协议版本不兼容');
    return new RuntimeClient(connection);
  }

  private responseError(status: number, body: unknown): never {
    const { error } = validate('ErrorEnvelope', body);
    throw new ApiError(status, error.code, error.safe_message, error.related_ids ?? []);
  }

  protected async request<N extends RootName>(path: string, root: N, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.connection.token}`);
    let response: Response, body: unknown;
    try {
      response = await fetch(this.connection.base_url + '/v4' + path, { ...init, headers });
      body = await response.json();
    } catch (error) {
      // 仅请求/响应读取的网络失败可重连；契约和消费者错误不进入此边界。
      if (error instanceof TypeError) throw new TransportError('Runtime 传输中断', { cause: error });
      throw error;
    }
    if (!response.ok) return this.responseError(response.status, body);
    return validate(root, body);
  }

  protected async command<N extends RootName>(path: string, input: RootName, output: N, body: unknown, method = 'POST') {
    validate(input, body);
    return this.request(path, output, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  protected page<N extends RootName>(path: string, root: N, page: PageQuery = {}) { return this.request(query(path, page), root); }

  runFeedback(sessionId: string, runIds: string[]) {
    const parameters = new URLSearchParams(runIds.map(id => ['run_id', id]));
    return this.request(`/sessions/${pathId(sessionId)}/run-feedback?${parameters}`, 'RunFeedbackPage');
  }

  health() { return this.request('/health', 'Health'); }
  skills(parameters: PageQuery & { scope_kind: 'user_global' | 'workspace'; workspace_id?: string; query?: string }) {
    return this.page('/capabilities/skills', 'SkillPage', parameters);
  }
  skillRecord(id: string, parameters: { scope_kind: 'user_global' | 'workspace'; workspace_id?: string }) {
    return this.request(query(`/capabilities/skills/${pathId(id)}`, parameters as PageQuery), 'SkillRecord');
  }
  skillFile(id: string, hash: string, parameters: { scope_kind: 'user_global' | 'workspace'; workspace_id?: string; path?: string; offset?: number; limit?: number }) {
    return this.request(query(`/capabilities/skills/${pathId(id)}/versions/${pathId(hash)}/file`, parameters as PageQuery), 'SkillFileSlice');
  }
  stageSkill(command: StageSkillCommand) { return this.command('/capabilities/skill-candidates', 'StageSkillCommand', 'SkillCandidate', command); }
  skillCandidateFile(id: string, parameters: { scope_kind: 'user_global' | 'workspace'; workspace_id?: string; path?: string; offset?: number }) {
    return this.request(query(`/capabilities/skill-candidates/${pathId(id)}/file`, parameters as PageQuery), 'SkillFileSlice');
  }
  discardSkillCandidate(id: string, command: DiscardSkillCandidateCommand) { return this.command(`/capabilities/skill-candidates/${pathId(id)}/discard`, 'DiscardSkillCandidateCommand', 'SkillCandidateDeletion', command); }
  importSkill(command: ImportSkillCommand) { return this.command('/capabilities/skill-imports', 'ImportSkillCommand', 'SkillCandidate', command); }
  publishSkill(command: PublishSkillCommand) { return this.command('/capabilities/skills', 'PublishSkillCommand', 'SkillVersion', command); }
  bindSkill(command: BindSkillCommand) { return this.command('/capabilities/skill-bindings', 'BindSkillCommand', 'SkillBinding', command, 'PUT'); }
  skillScriptSettings(id: string, hash: string, parameters: { scope_kind: 'user_global' | 'workspace'; workspace_id?: string }) {
    return this.request(query(`/skills/${pathId(id)}/versions/${pathId(hash)}/script-settings`, parameters as PageQuery), 'SkillScriptSettings', { cache: 'no-store' });
  }
  saveSkillExecutionPermission(command: SaveSkillExecutionPermissionCommand) {
    return this.command('/skills/execution-permissions', 'SaveSkillExecutionPermissionCommand', 'SkillExecutionPermission', command, 'PUT');
  }
  revokeSkillExecutionPermission(id: string, meta: CommandMeta) {
    return this.command(`/skills/execution-permissions/${pathId(id)}/revoke`, 'CommandMeta', 'SkillExecutionPermission', meta);
  }
  resolveSkills(request: ResolveSkills) { return this.command('/capabilities/skills/resolve', 'ResolveSkills', 'SkillResolution', request); }
  skillExports(parameters: { scope_kind: 'user_global' | 'workspace'; workspace_id?: string; skill_id?: string }) {
    return this.request(query('/capabilities/skill-exports', parameters as PageQuery), 'SkillExportReceiptList');
  }
  skillExport(id: string, parameters: { scope_kind: 'user_global' | 'workspace'; workspace_id?: string }) {
    return this.request(query(`/capabilities/skill-exports/${pathId(id)}`, parameters as PageQuery), 'SkillExportReceipt');
  }
  saveSkillExport(command: SaveSkillExportCommand) { return this.command('/capabilities/skill-exports', 'SaveSkillExportCommand', 'SkillExportReceipt', command); }
  restoreSkillExport(id: string, request: SkillScopeRequest) { return this.command(`/capabilities/skill-exports/${pathId(id)}/restore`, 'SkillScopeRequest', 'SkillExportReceipt', request); }
  finalizeSkillExport(id: string, request: SkillScopeRequest) { return this.command(`/capabilities/skill-exports/${pathId(id)}/finalize`, 'SkillScopeRequest', 'SkillExportReceipt', request); }
  releaseSkillExport(id: string, request: SkillScopeRequest) { return this.command(`/capabilities/skill-exports/${pathId(id)}/release`, 'SkillScopeRequest', 'SkillExportReceipt', request); }
  navigation(page?: PageQuery) { return this.page('/navigation', 'NavigationView', page); }
  recentSessions(page?: PageQuery) { return this.page('/navigation/sessions', 'SessionPage', page); }
  globalTasks(page?: TaskQuery) { return this.page('/tasks', 'TaskCenterPage', page); }
  inbox(page?: PageQuery & { run_id?: string }) { return this.page('/inbox', 'InboxPage', page); }
  providerPresets() { return this.request('/provider-presets', 'ProviderPresetList'); }
  modelCandidates(provider_preset_id: string, search = '') { return this.request(query('/model-catalog', { provider_preset_id, query: search } as PageQuery), 'ModelCandidateList'); }
  modelResolution(id: string) { return this.request(`/models/${pathId(id)}/resolved`, 'ModelResolution'); }
  workspaceDirectory(id: string) { return this.request(`/workspaces/${pathId(id)}/directory`, 'WorkspaceDirectoryView'); }
  workspaces(page?: PageQuery) { return this.page('/workspaces', 'WorkspacePage', page); }
  profiles(page?: PageQuery) { return this.page('/profiles', 'AgentProfilePage', page); }
  defaultAgent() { return this.request('/profiles/default', 'AgentProfile'); }
  tools() { return this.request('/tools', 'ToolSpecList'); }
  executionEnvironments(page?: PageQuery) { return this.page('/settings/execution-environments', 'ExecutionEnvironmentPage', page); }
  discoverExecutionEnvironments(parameters?: { workspace_id?: string; kinds: string[] }) {
    const search = new URLSearchParams();
    if (parameters?.workspace_id) search.set('workspace_id', parameters.workspace_id);
    for (const kind of parameters?.kinds ?? []) search.append('kind', kind);
    return this.request('/settings/execution-environments/discover' + (search.size ? `?${search}` : ''),
      'ExecutionEnvironmentPage', { method: 'POST' });
  }
  executionEnvironment(id: string) { return this.request(`/settings/execution-environments/${pathId(id)}`, 'ExecutionEnvironmentView', { cache: 'no-store' }); }
  saveExecutionEnvironment(command: SaveExecutionEnvironmentCommand) { return this.command('/settings/execution-environments', 'SaveExecutionEnvironmentCommand', 'ExecutionEnvironmentView', command, 'PUT'); }
  probeExecutionEnvironment(id: string) { return this.request(`/settings/execution-environments/${pathId(id)}/probe`, 'ExecutionEnvironmentView', { method: 'POST' }); }
  executionEnvironmentCommandStatus(id: string) { return this.request(`/settings/execution-environments/commands/${pathId(id)}`, 'ExecutionEnvironmentCommandStatus', { cache: 'no-store' }); }
  models(page?: ModelQuery) { return this.page('/models', 'ModelProfilePage', page); }
  connections(page?: PageQuery) { return this.page('/model-connections', 'ModelConnectionPage', page); }
  modelConnection(id: string) { return this.request(`/model-connections/${pathId(id)}`, 'ModelConnection'); }
  discoverConnection(id: string) {
    return this.request(`/model-connections/${pathId(id)}/discover`, 'ModelDiscoveryResult', { method: 'POST', cache: 'no-store' });
  }
  sessions(workspace_id: string, page?: PageQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/sessions`, 'SessionPage', page); }
  resources(workspace_id: string, page?: ScopeQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/resources`, 'ResourcePage', page); }
  grants(workspace_id: string, page?: ScopeQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/grants`, 'GrantPage', page); }
  sessionRuns(session_id: string, page?: PageQuery) { return this.page(`/sessions/${pathId(session_id)}/runs`, 'SessionRunPage', page); }
  sessionContext(sessionId: string, cursor?: string) {
    return this.page(`/sessions/${pathId(sessionId)}/context`, 'SessionContext', { cursor });
  }
  sessionContextUsage(sessionId: string) {
    return this.request(`/sessions/${pathId(sessionId)}/context/usage`, 'SessionContextUsage');
  }
  pendingUserCommands(session_id: string, page?: PageQuery) { return this.page(`/sessions/${pathId(session_id)}/commands`, 'PendingUserCommandPage', page); }
  followUpIntents(session_id: string, page?: PageQuery) { return this.page(`/sessions/${pathId(session_id)}/follow-ups`, 'FollowUpIntentPage', page); }
  session(session_id: string) { return this.request(`/sessions/${pathId(session_id)}`, 'Session'); }
  sessionResults(session_id: string, page?: PageQuery) { return this.page(`/sessions/${pathId(session_id)}/results`, 'SessionResultPage', page); }
  sessionAdmission(session_id: string) { return this.request(`/sessions/${pathId(session_id)}/admission`, 'AdmissionFence'); }
  workspaceAdmission(workspace_id: string) { return this.request(`/workspaces/${pathId(workspace_id)}/admission`, 'AdmissionFence'); }
  messages(session_id: string, page?: PageQuery) { return this.page(`/sessions/${pathId(session_id)}/messages`, 'MessagePage', page); }
  workspaceSnapshot(workspace_id: string, signal?: AbortSignal) { return this.request(`/workspaces/${pathId(workspace_id)}/snapshot`, 'WorkspaceSnapshot', { signal }); }
  activeRuns(workspace_id: string, page?: PageQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/runs`, 'RunPage', page); }
  pendingApprovals(workspace_id: string, page?: PageQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/approvals`, 'ApprovalPage', page); }
  pendingQuestions(workspace_id: string, page?: PageQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/questions`, 'QuestionPage', page); }
  run(run_id: string, signal?: AbortSignal) { return this.request(`/runs/${pathId(run_id)}`, 'RunDetail', { signal }); }
  exportRecovery(run_id: string) { return this.request(`/runs/${pathId(run_id)}/export-recovery`, 'PublicationList'); }
  commandStatus(session_id: string, command_id: string) { return this.request(`/sessions/${pathId(session_id)}/commands/${pathId(command_id)}`, 'CommandStatus'); }
  workspaceCommandStatus(id: string, commandId: string) {
    return this.request(`/workspaces/${pathId(id)}/commands/${pathId(commandId)}`, 'CommandStatus', { cache: 'no-store' });
  }
  tasks(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/tasks`, 'TaskPage', page); }
  memberLanes(run_id: string) { return this.request(`/runs/${pathId(run_id)}/member-lanes`, 'MemberLaneList'); }
  runQuestions(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/questions`, 'QuestionPage', page); }
  task(task_id: string) { return this.request(`/tasks/${pathId(task_id)}`, 'TaskSnapshot'); }
  taskResult(task_id: string) { return this.request(`/tasks/${pathId(task_id)}/result`, 'TaskResult'); }
  activities(run_id: string, page?: PageQuery & { activity_id?: string }) { return this.page(`/runs/${pathId(run_id)}/activities`, 'ActivityPage', page); }
  artifacts(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/artifacts`, 'ArtifactPage', page); }
  waits(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/waits`, 'WaitPage', page); }
  consumptions(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/consumptions`, 'ConsumptionPage', page); }
  joins(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/joins`, 'JoinPage', page); }
  trace(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/trace`, 'TracePage', page); }
  sessionArtifact(sessionId: string, artifactId: string) {
    return this.request(`/sessions/${pathId(sessionId)}/artifacts/${pathId(artifactId)}`, 'ArtifactPage');
  }
  artifactContent(artifact_id: string, offset = 0, view: 'text' | 'structured' = 'text') {
    return this.request(`/artifacts/${pathId(artifact_id)}/content?offset=${offset}${view === 'structured' ? '&view=structured' : ''}`, 'TextSlice');
  }
  async artifactImage(artifact_id: string, signal?: AbortSignal) {
    const response = await fetch(`${this.connection.base_url}/v4/artifacts/${pathId(artifact_id)}/image`, {
      headers: { Authorization: `Bearer ${this.connection.token}` }, signal,
    });
    if (!response.ok) return this.responseError(response.status, await response.json());
    return response.blob();
  }
  knowledgeSources(id: string, page?: PageQuery) { return this.page(`/workspaces/${pathId(id)}/knowledge/sources`, 'KnowledgeSourcePage', page); }
  knowledgeJobs(id: string, page?: PageQuery) { return this.page(`/workspaces/${pathId(id)}/knowledge/jobs`, 'KnowledgeJobPage', page); }
  knowledgeJob(id: string) { return this.request(`/knowledge/jobs/${pathId(id)}`, 'KnowledgeJob', { cache: 'no-store' }); }
  importKnowledge(id: string, command: KnowledgeImportCommand) {
    return this.command(`/workspaces/${pathId(id)}/knowledge/imports`, 'KnowledgeImportCommand', 'KnowledgeImportReceipt', command);
  }
  cancelKnowledgeJob(id: string, command: KnowledgeCancelCommand) {
    return this.command(`/knowledge/jobs/${pathId(id)}/cancel`, 'KnowledgeCancelCommand', 'KnowledgeJob', command);
  }
  actOnKnowledgeSource(id: string, command: KnowledgeSourceActionCommand) {
    return this.command(`/knowledge/sources/${pathId(id)}/actions`, 'KnowledgeSourceActionCommand', 'KnowledgeSource', command);
  }
  knowledgeEvidence(id: string, evidenceId: string, parameters: { offset?: number; limit?: number } = {}) {
    return this.request(query(`/workspaces/${pathId(id)}/knowledge/evidence/${pathId(evidenceId)}`, parameters),
      'EvidencePage', { cache: 'no-store' });
  }
  knowledgeSettings(id: string) { return this.request(`/workspaces/${pathId(id)}/knowledge/settings`, 'KnowledgeSettings'); }
  embeddingProfiles(page?: PageQuery) { return this.page('/knowledge/embedding-profiles', 'EmbeddingProfilePage', page); }
  embeddingProfile(id: string, revision: number) {
    return this.request(query(`/knowledge/embedding-profiles/${pathId(id)}`, { revision } as PageQuery),
      'EmbeddingProfileView', { cache: 'no-store' });
  }
  saveEmbeddingProfile(id: string, command: SaveEmbeddingProfileCommand) {
    return this.command(`/knowledge/embedding-profiles/${pathId(id)}`, 'SaveEmbeddingProfileCommand', 'EmbeddingProfile', command, 'PUT');
  }
  setProjectKnowledge(id: string, command: SetProjectKnowledgeCommand) {
    return this.command(`/workspaces/${pathId(id)}/knowledge/settings`, 'SetProjectKnowledgeCommand', 'KnowledgeSettings', command, 'PUT');
  }
  memoryRecords(parameters: MemoryQuery & { profile_rules?: boolean; project_defaults?: boolean }) {
    return this.request(query('/memory/records', parameters), 'MemoryRecordPage', { cache: 'no-store' });
  }
  memoryRecord(id: string, receipt_message_id?: string) {
    return this.request(query(`/memory/records/${pathId(id)}`, { receipt_message_id } as PageQuery), 'MemoryRecord', { cache: 'no-store' });
  }
  memoryEvidence(id: string) { return this.request(`/memory/records/${pathId(id)}/evidence`, 'MemoryEvidencePage', { cache: 'no-store' }); }
  memoryEvidenceExcerpt(id: string, evidenceIndex: number, expected_revision: number, receipt_message_id?: string, offset = 0) {
    const parameters: EvidenceExcerptQuery = { expected_revision, offset, receipt_message_id };
    return this.request(query(`/memory/records/${pathId(id)}/evidence/${evidenceIndex}/excerpt`, parameters),
      'MemoryEvidenceExcerpt', { cache: 'no-store' });
  }
  memoryPolicy(parameters: MemoryQuery) { return this.request(query('/settings/memory', parameters), 'MemoryPolicy'); }
  memoryGrants(parameters: MemoryQuery) { return this.page('/memory/grants', 'GrantPage', parameters); }
  createMemory(command: CreateMemoryCommand) { return this.command('/memory/records', 'CreateMemoryCommand', 'MemoryRecord', command); }
  decideMemory(id: string, command: MemoryDecisionCommand, receipt_message_id?: string) {
    return this.command(query(`/memory/records/${pathId(id)}/decisions`, { receipt_message_id } as PageQuery), 'MemoryDecisionCommand', 'MemoryRecord', command);
  }
  saveMemoryPolicy(command: SaveMemoryPolicyCommand) { return this.command('/settings/memory', 'SaveMemoryPolicyCommand', 'MemoryPolicy', command, 'PUT'); }
  grantMemory(command: MemoryGrantRequest) { return this.command('/memory/grants', 'MemoryGrantRequest', 'DataUseGrant', command); }
  memorySourceBoundary(runId: string) { return this.request(`/memory/source-boundaries/${pathId(runId)}`, 'MemorySourceBoundary'); }
  memoryMaintenance(parameters: MemoryQuery) { return this.page('/memory/maintenance', 'MemoryMaintenancePage', parameters); }
  recordMaintenance(id: string, parameters?: PageQuery) { return this.page(`/memory/records/${pathId(id)}/maintenance`, 'MemoryMaintenancePage', parameters); }
  submitMemoryMaintenance(command: SubmitMemoryMaintenanceCommand) { return this.command('/memory/maintenance', 'SubmitMemoryMaintenanceCommand', 'TaskHandle', command); }
  createWorkspace(command: CreateWorkspaceCommand) { return this.command('/workspaces', 'CreateWorkspaceCommand', 'Workspace', command); }
  createSession(workspace_id: string, command: CreateSessionCommand) { return this.command(`/workspaces/${pathId(workspace_id)}/sessions`, 'CreateSessionCommand', 'Session', command); }
  renameSession(id: string, command: RenameCommand) { return this.command(`/sessions/${pathId(id)}/title`, 'RenameCommand', 'Session', command, 'PUT'); }
  renameWorkspace(id: string, command: RenameCommand) { return this.command(`/workspaces/${pathId(id)}/name`, 'RenameCommand', 'Workspace', command, 'PUT'); }
  titlePolicy(id: string) { return this.request(`/workspaces/${pathId(id)}/title-policy`, 'TitlePolicy'); }
  saveTitlePolicy(id: string, command: SaveTitlePolicyCommand) { return this.command(`/workspaces/${pathId(id)}/title-policy`, 'SaveTitlePolicyCommand', 'TitlePolicy', command, 'PUT'); }
  suggestProjectTitle(id: string, meta: CommandMeta) { return this.command(`/workspaces/${pathId(id)}/title-suggestion`, 'CommandMeta', 'RunSnapshot', meta); }
  saveAgent(id: string, command: SaveAgentCommand) { return this.command(`/profiles/${pathId(id)}`, 'SaveAgentCommand', 'AgentProfile', command, 'PUT'); }
  saveModel(id: string, command: SaveModelCommand) { return this.command(`/models/${pathId(id)}`, 'SaveModelCommand', 'ModelProfile', command, 'PUT'); }
  saveConnection(id: string, command: SaveConnectionCommand) { return this.command(`/model-connections/${pathId(id)}`, 'SaveConnectionCommand', 'ModelConnection', command, 'PUT'); }
  startRun(session_id: string, command: StartRunCommand, mcp_server_id?: string) { return this.command(query(`/sessions/${pathId(session_id)}/runs`, { mcp_server_id } as PageQuery), 'StartRunCommand', 'RunSnapshot', command); }
  enqueueUser(session_id: string, command: StartRunCommand, mcp_server_id?: string) { return this.command(query(`/sessions/${pathId(session_id)}/commands`, { mcp_server_id } as PageQuery), 'StartRunCommand', 'PendingUserCommand', command); }
  steer(run_id: string, command: SteeringCommand) { return this.command(`/runs/${pathId(run_id)}/steering`, 'SteeringCommand', 'MessageReceipt', command); }
  cancel(run_id: string, meta: CommandMeta) { return this.command(`/runs/${pathId(run_id)}/cancel`, 'CommandMeta', 'RunSnapshot', meta); }
  resume(run_id: string, meta: CommandMeta, retryReadonly = false) {
    return this.command(`/runs/${pathId(run_id)}/resume${retryReadonly ? '?retry_readonly=true' : ''}`, 'CommandMeta', 'RunSnapshot', meta);
  }
  continueVision(run_id: string, command: VisionContinueCommand) {
    return this.command(`/runs/${pathId(run_id)}/continue-vision`, 'VisionContinueCommand', 'RunSnapshot', command);
  }
  viewResult(id: string, meta: CommandMeta) { return this.command(`/results/${pathId(id)}/view`, 'CommandMeta', 'SessionInboxEntry', meta); }
  retryDelivery(id: string, meta: CommandMeta) { return this.command(`/results/${pathId(id)}/retry`, 'CommandMeta', 'SessionInboxEntry', meta); }
  archiveSession(id: string, command: ArchiveSessionCommand) { return this.command(`/sessions/${pathId(id)}/archive`, 'ArchiveSessionCommand', 'Session', command); }
  stopSession(id: string, meta: CommandMeta) { return this.command(`/sessions/${pathId(id)}/stop-all`, 'CommandMeta', 'StopAllReceipt', meta); }
  stopWorkspace(id: string, meta: CommandMeta) { return this.command(`/workspaces/${pathId(id)}/stop-all`, 'CommandMeta', 'StopAllReceipt', meta); }
  answer(question_id: string, command: AnswerCommand) { return this.command(`/questions/${pathId(question_id)}/answer`, 'AnswerCommand', 'RunSnapshot', command); }
  decide(approval_id: string, command: ApprovalCommand) { return this.command(`/approvals/${pathId(approval_id)}/decision`, 'ApprovalCommand', 'Approval', command); }
  grant(command: GrantRequest) { return this.command('/grants', 'GrantRequest', 'DataUseGrant', command); }
  resourceCoverage(session_id: string, request: ResourceCoverageRequest) {
    return this.command(`/sessions/${pathId(session_id)}/resource-coverage`,
      'ResourceCoverageRequest', 'ResourceCoverage', request);
  }
  revoke(grant_id: string, meta: CommandMeta) { return this.command(`/grants/${pathId(grant_id)}/revoke`, 'CommandMeta', 'ScopeState', meta); }
  restoreExport(id: string, meta: CommandMeta) { return this.command(`/export-recovery/${pathId(id)}/restore`, 'CommandMeta', 'PublicationView', meta); }
  releaseExport(id: string, meta: CommandMeta) { return this.command(`/export-recovery/${pathId(id)}/release`, 'CommandMeta', 'PublicationView', meta); }
  setWorkspaceDirectory(id: string, command: SetWorkspaceDirectoryCommand) { return this.command(`/workspaces/${pathId(id)}/directory`, 'SetWorkspaceDirectoryCommand', 'Workspace', command, 'PUT'); }
  deleteSession(session_id: string, meta: CommandMeta) { return this.command(`/sessions/${pathId(session_id)}`, 'CommandMeta', 'DeletionReceipt', meta, 'DELETE'); }
  deleteWorkspace(workspace_id: string, meta: CommandMeta) { return this.command(`/workspaces/${pathId(workspace_id)}`, 'CommandMeta', 'DeletionReceipt', meta, 'DELETE'); }
  exportArtifact(artifact_id: string, command: ExportCommand) { return this.command(`/artifacts/${pathId(artifact_id)}/export`, 'ExportCommand', 'RunSnapshot', command); }

  async watchWorkspace(workspace_id: string, after: string, handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
    let cursor = after;
    try {
      while (!signal.aborted) {
        try {
          let response: Response;
          try {
            response = await fetch(`${this.connection.base_url}/v4/workspaces/${pathId(workspace_id)}/events?after=${cursor}`, {
              headers: { Authorization: `Bearer ${this.connection.token}`, Accept: 'text/event-stream' }, signal,
            });
          } catch (error) {
            if (error instanceof TypeError) throw new TransportError('Runtime 传输中断', { cause: error });
            throw error;
          }
          if (response.status === 410) {
            const snapshot = await this.workspaceSnapshot(workspace_id, signal);
            if (signal.aborted) return;
            await handlers.snapshot(snapshot);
            cursor = snapshot.watermark;
            continue;
          }
          if (!response.ok) this.responseError(response.status, await response.json());
          if (!response.body) throw new Error('Runtime 事件流没有响应体');
          try { await handlers.connection?.('connected'); }
          catch (error) {
            const reader = response.body.getReader();
            const closed = reader.closed.catch(reason => reason);
            try { await reader.cancel(); }
            catch (cleanupError) {
              // 已 errored 的流会在 cancel 时重复拒绝同一错误，不能覆盖回调原异常。
              if (cleanupError !== await closed) throw cleanupError;
            } finally { reader.releaseLock(); }
            throw error;
          }
          if (signal.aborted) { await response.body.cancel(); return; }
          const reader = readSse(response.body, signal);
          try {
            while (!signal.aborted) {
              let next: IteratorResult<unknown>;
              try { next = await reader.next(); }
              catch (error) {
                if (signal.aborted) return;
                if (error instanceof TypeError) break;
                throw error;
              }
              if (next.done) break;
              const event = validate('StreamEvent', next.value);
              if (event.kind === 'durable' && event.event_id !== event.event.event_id) throw new Error('事件游标与持久事件不一致');
              await handlers.event(event);
              if (event.kind === 'durable') cursor = laterCursor(cursor, event.event_id);
            }
          } finally { await reader.return(undefined); }
        } catch (error) {
          if (signal.aborted) return;
          if (!(error instanceof TransportError)) throw error;
        }
        if (!signal.aborted) {
          await handlers.connection?.('reconnecting');
          await waitForReconnect(signal);
        }
      }
    } catch (error) { if (!signal.aborted) throw error; }
  }
}
