import { invoke } from '@tauri-apps/api/core';
import type {
  AnswerCommand, ApprovalCommand, CommandMeta, CreateSessionCommand, CreateWorkspaceCommand,
  ExportCommand, GrantRequest, SaveAgentCommand, SaveConnectionCommand, SaveModelCommand, StartRunCommand, SteeringCommand,
  SetWorkspaceDirectoryCommand, StreamEvent, WorkspaceSnapshot,
} from '../generated/contracts';
import { laterCursor, readSse } from './events';
import { validate, type RootName } from './validation';

export interface RuntimeConnection { base_url: string; token: string; protocol_version: number }
export interface PageQuery { cursor?: string; limit?: number }
export interface ModelQuery extends PageQuery { connection_id?: string }
export interface ScopeQuery extends PageQuery { session_id?: string }
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
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
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
    if (connection.protocol_version !== 2) throw new Error('Runtime 协议版本不兼容');
    return new RuntimeClient(connection);
  }

  private responseError(status: number, body: unknown): never {
    const { error } = validate('ErrorEnvelope', body);
    throw new ApiError(status, error.code, error.safe_message);
  }

  private async request<N extends RootName>(path: string, root: N, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.connection.token}`);
    let response: Response, body: unknown;
    try {
      response = await fetch(this.connection.base_url + '/v2' + path, { ...init, headers });
      body = await response.json();
    } catch (error) {
      // 仅请求/响应读取的网络失败可重连；契约和消费者错误不进入此边界。
      if (error instanceof TypeError) throw new TransportError('Runtime 传输中断', { cause: error });
      throw error;
    }
    if (!response.ok) return this.responseError(response.status, body);
    return validate(root, body);
  }

  private async command<N extends RootName>(path: string, input: RootName, output: N, body: unknown, method = 'POST') {
    validate(input, body);
    return this.request(path, output, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  private page<N extends RootName>(path: string, root: N, page: PageQuery = {}) { return this.request(query(path, page), root); }

  health() { return this.request('/health', 'Health'); }
  navigation(page?: PageQuery) { return this.page('/navigation', 'NavigationView', page); }
  recentSessions(page?: PageQuery) { return this.page('/navigation/sessions', 'SessionPage', page); }
  globalTasks(page?: PageQuery) { return this.page('/tasks', 'RunPage', page); }
  inbox(page?: PageQuery) { return this.page('/inbox', 'InboxPage', page); }
  providerPresets() { return this.request('/provider-presets', 'ProviderPresetList'); }
  modelCandidates(provider_preset_id: string, search = '') { return this.request(query('/model-catalog', { provider_preset_id, query: search } as PageQuery), 'ModelCandidateList'); }
  modelResolution(id: string) { return this.request(`/models/${pathId(id)}/resolved`, 'ModelResolution'); }
  workspaceDirectory(id: string) { return this.request(`/workspaces/${pathId(id)}/directory`, 'WorkspaceDirectoryView'); }
  workspaces(page?: PageQuery) { return this.page('/workspaces', 'WorkspacePage', page); }
  profiles(page?: PageQuery) { return this.page('/profiles', 'AgentProfilePage', page); }
  models(page?: ModelQuery) { return this.page('/models', 'ModelProfilePage', page); }
  connections(page?: PageQuery) { return this.page('/model-connections', 'ModelConnectionPage', page); }
  modelConnection(id: string) { return this.request(`/model-connections/${pathId(id)}`, 'ModelConnection'); }
  sessions(workspace_id: string, page?: PageQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/sessions`, 'SessionPage', page); }
  resources(workspace_id: string, page?: ScopeQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/resources`, 'ResourcePage', page); }
  grants(workspace_id: string, page?: ScopeQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/grants`, 'GrantPage', page); }
  sessionRuns(session_id: string, page?: PageQuery) { return this.page(`/sessions/${pathId(session_id)}/runs`, 'RunPage', page); }
  session(session_id: string) { return this.request(`/sessions/${pathId(session_id)}`, 'Session'); }
  messages(session_id: string, page?: PageQuery) { return this.page(`/sessions/${pathId(session_id)}/messages`, 'MessagePage', page); }
  workspaceSnapshot(workspace_id: string, signal?: AbortSignal) { return this.request(`/workspaces/${pathId(workspace_id)}/snapshot`, 'WorkspaceSnapshot', { signal }); }
  activeRuns(workspace_id: string, page?: PageQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/runs`, 'RunPage', page); }
  pendingApprovals(workspace_id: string, page?: PageQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/approvals`, 'ApprovalPage', page); }
  pendingQuestions(workspace_id: string, page?: PageQuery) { return this.page(`/workspaces/${pathId(workspace_id)}/questions`, 'QuestionPage', page); }
  run(run_id: string, signal?: AbortSignal) { return this.request(`/runs/${pathId(run_id)}`, 'RunDetail', { signal }); }
  exportRecovery(run_id: string) { return this.request(`/runs/${pathId(run_id)}/export-recovery`, 'PublicationList'); }
  commandStatus(session_id: string, command_id: string) { return this.request(`/sessions/${pathId(session_id)}/commands/${pathId(command_id)}`, 'CommandStatus'); }
  tasks(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/tasks`, 'TaskPage', page); }
  task(task_id: string) { return this.request(`/tasks/${pathId(task_id)}`, 'TaskSnapshot'); }
  activities(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/activities`, 'ActivityPage', page); }
  artifacts(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/artifacts`, 'ArtifactPage', page); }
  waits(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/waits`, 'WaitPage', page); }
  consumptions(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/consumptions`, 'ConsumptionPage', page); }
  joins(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/joins`, 'JoinPage', page); }
  trace(run_id: string, page?: PageQuery) { return this.page(`/runs/${pathId(run_id)}/trace`, 'TracePage', page); }
  artifactContent(artifact_id: string, offset = 0) { return this.request(`/artifacts/${pathId(artifact_id)}/content?offset=${offset}`, 'TextSlice'); }
  createWorkspace(command: CreateWorkspaceCommand) { return this.command('/workspaces', 'CreateWorkspaceCommand', 'Workspace', command); }
  createSession(workspace_id: string, command: CreateSessionCommand) { return this.command(`/workspaces/${pathId(workspace_id)}/sessions`, 'CreateSessionCommand', 'Session', command); }
  saveAgent(id: string, command: SaveAgentCommand) { return this.command(`/profiles/${pathId(id)}`, 'SaveAgentCommand', 'AgentProfile', command, 'PUT'); }
  saveModel(id: string, command: SaveModelCommand) { return this.command(`/models/${pathId(id)}`, 'SaveModelCommand', 'ModelProfile', command, 'PUT'); }
  saveConnection(id: string, command: SaveConnectionCommand) { return this.command(`/model-connections/${pathId(id)}`, 'SaveConnectionCommand', 'ModelConnection', command, 'PUT'); }
  startRun(session_id: string, command: StartRunCommand) { return this.command(`/sessions/${pathId(session_id)}/runs`, 'StartRunCommand', 'RunSnapshot', command); }
  steer(run_id: string, command: SteeringCommand) { return this.command(`/runs/${pathId(run_id)}/steering`, 'SteeringCommand', 'MessageReceipt', command); }
  cancel(run_id: string, meta: CommandMeta) { return this.command(`/runs/${pathId(run_id)}/cancel`, 'CommandMeta', 'RunSnapshot', meta); }
  resume(run_id: string, meta: CommandMeta) { return this.command(`/runs/${pathId(run_id)}/resume`, 'CommandMeta', 'RunSnapshot', meta); }
  answer(question_id: string, command: AnswerCommand) { return this.command(`/questions/${pathId(question_id)}/answer`, 'AnswerCommand', 'RunSnapshot', command); }
  decide(approval_id: string, command: ApprovalCommand) { return this.command(`/approvals/${pathId(approval_id)}/decision`, 'ApprovalCommand', 'Approval', command); }
  grant(command: GrantRequest) { return this.command('/grants', 'GrantRequest', 'DataUseGrant', command); }
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
            response = await fetch(`${this.connection.base_url}/v2/workspaces/${pathId(workspace_id)}/events?after=${cursor}`, {
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
