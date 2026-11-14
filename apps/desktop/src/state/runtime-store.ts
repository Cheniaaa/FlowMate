import { ApiError, type RuntimeClient, type StreamHandlers } from '../api/client';
import { applyDeletion, emptyProjection, mergeApprovals, mergeGrants, mergePublications, mergeResources, mergeRunDetail, mergeRunSnapshot, mergeScopeStates, mergeSessions, mergeWorkspaces, reduceStream, resetWorkspace, type Projection } from '../api/events';
import { validate } from '../api/validation';
import type { CommandMeta, ResourceRef } from '../generated/contracts';

type CommandName = 'startRun' | 'steer' | 'cancel' | 'resume' | 'answer' | 'decide' | 'grant' | 'revoke' | 'exportArtifact' | 'restoreExport' | 'releaseExport' | 'setWorkspaceDirectory' | 'deleteSession' | 'deleteWorkspace';
export type UiCommand = { [K in CommandName]: { type: K; args: Parameters<RuntimeClient[K]> } }[CommandName];
export function uiCommandId(command: UiCommand): string {
  const body = command.args[command.args.length - 1] as CommandMeta | { meta: CommandMeta };
  return ('meta' in body ? body.meta : body).command_id!;
}
export interface CommandOutcome { status: 'confirmed' | 'unconfirmed'; sync: 'ready' | 'pending'; commandId: string }
export interface PendingCommand extends CommandOutcome { type: CommandName; busy: boolean; error: string; runId?: string; scope?: ResourceRef['scope'] }
interface CommandEntry {
  command: UiCommand; encoded: string; outcome: CommandOutcome; error: string;
  operation?: Promise<CommandOutcome>; refresh?: () => Promise<void>;
  runId?: string;
  scope?: ResourceRef['scope'];
}

export function createRuntimeStore(client: RuntimeClient) {
  let snapshot = emptyProjection();
  const listeners = new Set<() => void>();
  const pending = new Map<string, CommandEntry>();
  let commands: PendingCommand[] = [];
  function publishCommands() {
    commands = [...pending.values()].filter(entry => entry.outcome.status === 'unconfirmed' || entry.outcome.sync === 'pending')
      .map(entry => ({ ...entry.outcome, type: entry.command.type, busy: !!entry.operation, error: entry.error, runId: entry.runId, scope: entry.scope }));
    for (const listener of listeners) listener();
  }
  function update(change: (state: Projection) => Projection) {
    const next = change(snapshot);
    if (next !== snapshot) { snapshot = next; for (const listener of listeners) listener(); }
    return snapshot;
  }
  async function refreshRun(id: string, signal?: AbortSignal) {
    const detail = await client.run(id, signal);
    if (!signal?.aborted) update(state => mergeRunDetail(state, detail));
  }
  async function refreshRecovery(id: string) {
    const publications = await client.exportRecovery(id);
    update(state => mergePublications(state, publications));
  }
  async function refreshGrants(scope: ResourceRef['scope']) {
    let cursor: string | undefined;
    do {
      const page = await client.grants(scope.workspace_id, { ...(scope.session_id !== null ? { session_id: scope.session_id } : {}), cursor });
      update(state => mergeGrants(state, page.items));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
  async function refreshWorkspace(id: string) {
    const value = await client.workspaceSnapshot(id);
    // 查询其它归属不能切换当前工作区，或清掉用户已经加载的尾页。
    update(state => mergeGrants(mergeResources(mergeWorkspaces(state, [value.workspace]), value.resources.items), value.grants.items));
  }
  function send(command: UiCommand): Promise<unknown> {
    switch (command.type) {
      case 'startRun': return client.startRun(...command.args);
      case 'cancel': return client.cancel(...command.args);
      case 'resume': return client.resume(...command.args);
      case 'answer': return client.answer(...command.args);
      case 'exportArtifact': return client.exportArtifact(...command.args);
      case 'steer': return client.steer(...command.args);
      case 'decide': return client.decide(...command.args);
      case 'grant': return client.grant(...command.args);
      case 'revoke': return client.revoke(...command.args);
      case 'restoreExport': return client.restoreExport(...command.args);
      case 'releaseExport': return client.releaseExport(...command.args);
      case 'setWorkspaceDirectory': return client.setWorkspaceDirectory(...command.args);
      case 'deleteSession': return client.deleteSession(...command.args);
      case 'deleteWorkspace': return client.deleteWorkspace(...command.args);
    }
  }
  function accept(entry: CommandEntry, raw: unknown): () => Promise<void> {
    const command = entry.command;
    switch (command.type) {
      case 'startRun': case 'cancel': case 'resume': case 'answer': case 'exportArtifact': {
        const run = validate('RunSnapshot', raw);
        entry.runId = run.id;
        update(state => mergeRunSnapshot(state, run));
        return async () => {
          await refreshRun(run.id);
          if (command.type === 'exportArtifact' || Object.values(snapshot.publications).some(item => item.run_id === run.id)) await refreshRecovery(run.id);
        };
      }
      case 'steer': {
        const receipt = validate('MessageReceipt', raw);
        entry.runId = receipt.run_id;
        return () => refreshRun(receipt.run_id);
      }
      case 'decide': {
        const approval = validate('Approval', raw);
        entry.runId = approval.run_id;
        update(state => mergeApprovals(state, [approval]));
        return () => refreshRun(approval.run_id);
      }
      case 'grant': {
        const grant = validate('DataUseGrant', raw);
        update(state => mergeGrants(state, [grant]));
        return () => refreshGrants(grant.scope);
      }
      case 'revoke': {
        const scope = validate('ScopeState', raw);
        update(state => mergeScopeStates(state, [scope]));
        return async () => {
          await refreshGrants(scope.scope);
          await Promise.all(Object.values(snapshot.runs).filter(run => run.workspace_id === scope.scope.workspace_id
            && (scope.scope.session_id === null || run.session_id === scope.scope.session_id)).map(run => refreshRun(run.id)));
        };
      }
      case 'restoreExport': case 'releaseExport': {
        const publication = validate('PublicationView', raw);
        entry.runId = publication.run_id;
        update(state => mergePublications(state, [publication]));
        return async () => { await refreshRecovery(publication.run_id); await refreshRun(publication.run_id); };
      }
      case 'setWorkspaceDirectory': {
        const workspace = validate('Workspace', raw);
        update(state => mergeWorkspaces(state, [workspace]));
        return () => refreshWorkspace(workspace.id);
      }
      case 'deleteSession': case 'deleteWorkspace': {
        const receipt = validate('DeletionReceipt', raw);
        update(state => applyDeletion(state, receipt));
        return async () => {};
      }
    }
  }
  async function refreshConflict(command: UiCommand) {
    switch (command.type) {
      case 'cancel': case 'resume': case 'steer': await refreshRun(command.args[0]); break;
      case 'answer': await refreshRun(snapshot.questions[command.args[0]].run_id); break;
      case 'decide': await refreshRun(snapshot.approvals[command.args[0]].run_id); break;
      case 'exportArtifact': {
        const task = await client.task(snapshot.artifacts[command.args[0]].task_id);
        await refreshRun(task.run_id); break;
      }
      case 'restoreExport': case 'releaseExport': await refreshRecovery(snapshot.publications[command.args[0]].run_id); break;
      case 'revoke': await refreshGrants(snapshot.grants[command.args[0]].scope); break;
      case 'setWorkspaceDirectory': case 'deleteWorkspace': await refreshWorkspace(command.args[0]); break;
      case 'deleteSession': {
        const session = await client.session(command.args[0]);
        update(state => mergeSessions(state, [session])); break;
      }
    }
  }
  async function synchronize(entry: CommandEntry): Promise<CommandOutcome> {
    entry.error = '';
    try { await entry.refresh!(); entry.outcome = { ...entry.outcome, sync: 'ready' }; }
    catch (error) { entry.error = error instanceof ApiError ? `${error.code}: ${error.message}` : '状态同步失败，请重试查询'; }
    return entry.outcome;
  }
  function operate(entry: CommandEntry, action: () => Promise<CommandOutcome>): Promise<CommandOutcome> {
    if (entry.operation) return entry.operation;
    entry.operation = action().finally(() => { entry.operation = undefined; publishCommands(); });
    publishCommands();
    return entry.operation;
  }
  async function submit(entry: CommandEntry): Promise<CommandOutcome> {
    let raw: unknown;
    try { raw = await send(entry.command); }
    catch (error) {
      if (error instanceof ApiError) {
        pending.delete(entry.outcome.commandId);
        if (error.code === 'version_conflict') {
          try { await refreshConflict(entry.command); }
          catch { error.message += '；当前状态未同步，请刷新后重新决定'; }
        }
        throw error;
      }
      entry.error = '提交响应未确认；未查到记录也不证明未提交';
      return entry.outcome;
    }
    entry.refresh = accept(entry, raw);
    entry.outcome = { ...entry.outcome, status: 'confirmed', sync: 'pending' };
    publishCommands();
    return synchronize(entry);
  }
  return {
    getSnapshot: () => snapshot,
    getCommandsSnapshot: () => commands,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update,
    async loadWorkspace(id: string, handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
      let connected = false;
      const install: StreamHandlers['snapshot'] = async value => {
        if (signal.aborted) return;
        update(state => resetWorkspace(state, value));
        await handlers.snapshot(value);
      };
      const initial = await client.workspaceSnapshot(id, signal);
      if (signal.aborted) return;
      const loading = install(initial);
      await Promise.all([loading, client.watchWorkspace(id, initial.watermark, {
        snapshot: install,
        event: async event => {
          if (signal.aborted) return;
          update(state => reduceStream(state, event));
          if (event.kind === 'durable' && 'runs' in event.event.payload) {
            const payload = event.event.payload;
            const affected = new Set([event.event.run_id, ...payload.runs.map(run => run.id),
              ...payload.tasks.map(task => task.run_id), ...payload.activities.map(activity => activity.run_id),
              ...payload.budgets.map(budget => budget.run_id)]);
            // 费用/最近请求摘要只从权威查询取得；不从局部Activity页重算。
            await Promise.all([...affected].filter((runId): runId is string => !!runId && !!snapshot.runs[runId])
              .map(runId => refreshRun(runId, signal)));
          }
          if (!signal.aborted) await handlers.event(event);
        },
        connection: async state => {
          if (signal.aborted) return;
          if (state === 'connected') {
            if (connected) await Promise.all(Object.entries(snapshot.runSummaries)
              .filter(([, summary]) => summary.workspace_id === id).map(([runId]) => refreshRun(runId, signal)));
            connected = true;
          }
          if (!signal.aborted) await handlers.connection?.(state);
        },
      }, signal)]);
    },
    retry(commandId: string): Promise<CommandOutcome> {
      const entry = pending.get(commandId)!;
      return operate(entry, () => entry.outcome.status === 'confirmed' ? synchronize(entry) : submit(entry));
    },
    check(commandId: string, sessionId: string): Promise<CommandOutcome> {
      const entry = pending.get(commandId)!;
      return operate(entry, async () => {
        if (entry.outcome.status === 'confirmed') return synchronize(entry);
        const result = await client.commandStatus(sessionId, commandId);
        if (result.status === 'not_found') { entry.error = '未查到记录，不证明未提交；可使用原命令重试'; return entry.outcome; }
        entry.refresh = accept(entry, result.result);
        entry.outcome = { ...entry.outcome, status: 'confirmed', sync: 'pending' };
        publishCommands();
        return synchronize(entry);
      });
    },
    dispatch(command: UiCommand): Promise<CommandOutcome> {
      const commandId = uiCommandId(command);
      const encoded = JSON.stringify(command);
      const existing = pending.get(commandId);
      if (existing) return existing.encoded === encoded ? existing.operation ?? Promise.resolve(existing.outcome) : Promise.reject(new Error('同一命令不能更改操作或参数'));
      // 仅保留窗口内冻结的 JSON 参数，调用方之后的编辑不能改写待确认请求。
      const entry: CommandEntry = { command: JSON.parse(encoded), encoded, error: '', outcome: { status: 'unconfirmed', sync: 'pending', commandId } };
      if (command.type === 'revoke' && snapshot.grants[command.args[0]]) entry.scope = { ...snapshot.grants[command.args[0]].scope };
      pending.set(commandId, entry);
      return operate(entry, () => submit(entry));
    },
  };
}

export type RuntimeStore = ReturnType<typeof createRuntimeStore>;
