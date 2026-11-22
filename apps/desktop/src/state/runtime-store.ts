import { ApiError, type RuntimeClient, type StreamHandlers } from '../api/client';
import { applyDeletion, emptyProjection, mergeAdmissions, mergeApprovals, mergeFollowUpIntents, mergeGrants, mergeMemoryNotices, mergePendingUserCommands, mergePublications, mergeQuestions, mergeResources, mergeResultPage, mergeRunDetail, mergeRunSnapshot, mergeScopeStates, mergeSessions, mergeWorkspaces, reduceStream, resetWorkspace, type Projection } from '../api/events';
import { validate } from '../api/validation';
import { memoryQuery } from '../api/memory';
import type { CommandMeta, ResourceRef, TaskHandle } from '../generated/contracts';

type CommandName = 'createSession' | 'startRun' | 'continueVision' | 'enqueueUser' | 'steer' | 'cancel' | 'resume' | 'answer' | 'decide' | 'grant' | 'revoke' | 'exportArtifact' | 'restoreExport' | 'releaseExport' | 'setWorkspaceDirectory' | 'deleteSession' | 'deleteWorkspace' | 'viewResult' | 'retryDelivery' | 'archiveSession' | 'stopSession' | 'stopWorkspace'
  | 'createMemory' | 'decideMemory' | 'saveMemoryPolicy' | 'grantMemory' | 'submitMemoryMaintenance';
export type UiCommand = { [K in CommandName]: { type: K; args: Parameters<RuntimeClient[K]> } }[CommandName];
export function uiCommandId(command: UiCommand): string {
  const body = (command.type === 'decideMemory' || command.type === 'startRun' || command.type === 'enqueueUser' || command.type === 'resume'
    ? command.args[1] : command.args[command.args.length - 1]) as CommandMeta | { meta: CommandMeta };
  return ('meta' in body ? body.meta : body).command_id!;
}
export interface CommandOutcome { status: 'confirmed' | 'unconfirmed'; sync: 'ready' | 'pending'; commandId: string; task?: TaskHandle; runId?: string; sessionId?: string }
export interface PendingCommand extends CommandOutcome { type: CommandName; busy: boolean; error: string; runId?: string; targetId?: string; scope?: ResourceRef['scope'] }
interface CommandEntry {
  command: UiCommand; encoded: string; outcome: CommandOutcome; error: string;
  operation?: Promise<CommandOutcome>; refresh?: () => Promise<void>;
  runId?: string;
  scope?: ResourceRef['scope'];
  memoryGrant?: boolean;
}

export function createRuntimeStore(client: RuntimeClient) {
  let snapshot = emptyProjection();
  const listeners = new Set<() => void>();
  const pending = new Map<string, CommandEntry>();
  const workSessions = new Set<string>();
  const resultDepths = new Map<string, number>();
  const resultReads = new Map<string, Promise<void>>();
  let commands: PendingCommand[] = [];
  function publishCommands() {
    commands = [...pending.values()].filter(entry => entry.outcome.status === 'unconfirmed' || entry.outcome.sync === 'pending')
      .map(entry => ({ ...entry.outcome, type: entry.command.type, busy: !!entry.operation, error: entry.error, runId: entry.runId, targetId: typeof entry.command.args[0] === 'string' ? entry.command.args[0] : undefined, scope: entry.scope }));
    for (const listener of listeners) listener();
  }
  function update(change: (state: Projection) => Projection) {
    const next = change(snapshot);
    if (next !== snapshot) { snapshot = next; for (const listener of listeners) listener(); }
    return snapshot;
  }
  async function refreshRun(id: string, signal?: AbortSignal, questionId?: string) {
    const detail = await client.run(id, signal);
    if (signal?.aborted) return;
    update(state => mergeRunDetail(state, detail));
    // Question可从全局待办尾页定位，答复/冲突后也必须读到原对象的当前事实。
    let cursor = detail.questions.items.some(item => item.id === questionId) ? null : detail.questions.next_cursor;
    while (questionId && cursor) {
      const page = await client.runQuestions(id, { cursor, limit: 100 });
      update(state => mergeQuestions(state, page.items));
      if (page.items.some(item => item.id === questionId)) break;
      cursor = page.next_cursor;
    }
  }
  function refreshResults(sessionId: string, cursor?: string): Promise<void> {
    async function read() {
      if (cursor) {
        // 用户请求“下一页”；排队期间首页可能换了上界，执行时取当前末页游标。
        const next = snapshot.resultPages[sessionId]?.next_cursor;
        if (!next) return;
        const page = await client.sessionResults(sessionId, { limit: 50, cursor: next });
        resultDepths.set(sessionId, (resultDepths.get(sessionId) ?? 1) + 1);
        update(state => mergeResultPage(state, sessionId, page, true));
        return;
      }
      // 深度在轮到本次读取时确定，前一续页已安装的记录不能被迟到首页截短。
      const depth = resultDepths.get(sessionId) ?? 1;
      const pages = [await client.sessionResults(sessionId, { limit: 50 })];
      while (pages.length < depth && pages.at(-1)!.next_cursor) {
        pages.push(await client.sessionResults(sessionId, { limit: 50, cursor: pages.at(-1)!.next_cursor! }));
      }
      resultDepths.set(sessionId, pages.length);
      const watermark = pages.reduce((mark, page) => BigInt(page.watermark) < BigInt(mark) ? page.watermark : mark, pages[0].watermark);
      update(state => mergeResultPage(state, sessionId, { items: [...new Map(pages.flatMap(page => page.items).map(entry => [entry.id, entry])).values()],
        next_cursor: pages.at(-1)!.next_cursor, watermark }));
    }
    const previous = resultReads.get(sessionId);
    // 两个调用者仍各自收到错误；前一次失败不阻塞之后的显式读取。
    const operation = previous ? previous.then(read, read) : read();
    resultReads.set(sessionId, operation);
    const clear = () => {
      if (resultReads.get(sessionId) === operation) resultReads.delete(sessionId);
    };
    void operation.then(clear, clear);
    return operation;
  }
  async function refreshPendingCommands(sessionId: string) {
    let cursor: string | undefined;
    do {
      const page = await client.pendingUserCommands(sessionId, { limit: 50, cursor });
      update(state => mergePendingUserCommands(state, page.items, page.watermark));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
  async function refreshFollowUps(sessionId: string) {
    let cursor: string | undefined;
    do {
      const page = await client.followUpIntents(sessionId, { limit: 50, cursor });
      update(state => mergeFollowUpIntents(state, page.items, page.watermark));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
  async function refreshSessionWork(sessionId: string) {
    workSessions.add(sessionId);
    await Promise.all([refreshPendingCommands(sessionId), refreshFollowUps(sessionId)]);
  }
  async function refreshRecovery(id: string) {
    const publications = await client.exportRecovery(id);
    update(state => mergePublications(state, publications));
  }
  async function refreshGrants(scope: ResourceRef['scope'], memory = false) {
    let cursor: string | undefined;
    do {
      const page = memory ? await client.memoryGrants({ ...memoryQuery(scope), cursor })
        : await client.grants(scope.workspace_id!, { ...(scope.session_id !== null ? { session_id: scope.session_id } : {}), cursor });
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
      case 'createSession': return client.createSession(...command.args);
      case 'submitMemoryMaintenance': return client.submitMemoryMaintenance(...command.args);
      case 'createMemory': return client.createMemory(...command.args);
      case 'decideMemory': return client.decideMemory(...command.args);
      case 'saveMemoryPolicy': return client.saveMemoryPolicy(...command.args);
      case 'grantMemory': return client.grantMemory(...command.args);
      case 'startRun': return client.startRun(...command.args);
      case 'continueVision': return client.continueVision(...command.args);
      case 'enqueueUser': return client.enqueueUser(...command.args);
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
      case 'viewResult': return client.viewResult(...command.args);
      case 'retryDelivery': return client.retryDelivery(...command.args);
      case 'archiveSession': return client.archiveSession(...command.args);
      case 'stopSession': return client.stopSession(...command.args);
      case 'stopWorkspace': return client.stopWorkspace(...command.args);
    }
  }
  function accept(entry: CommandEntry, raw: unknown): () => Promise<void> {
    const command = entry.command;
    switch (command.type) {
      case 'createSession': {
        const session = validate('Session', raw);
        entry.outcome = { ...entry.outcome, sessionId: session.id };
        update(state => mergeSessions(state, [session]));
        return async () => {};
      }
      case 'submitMemoryMaintenance': {
        const task = validate('TaskHandle', raw);
        entry.runId = task.run_id; entry.outcome = { ...entry.outcome, task };
        update(state => ({ ...state, maintenanceRevision: state.maintenanceRevision + 1 }));
        return () => refreshRun(task.run_id);
      }
      case 'createMemory': case 'decideMemory': {
        const record = validate('MemoryRecord', raw);
        update(state => mergeMemoryNotices(state, [record]));
        // 回执已确认决定；界面按原查询（含聊天回执约束）重读，不能无约束补读正文。
        return async () => {};
      }
      case 'saveMemoryPolicy': {
        const policy = validate('MemoryPolicy', raw);
        update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 }));
        return async () => { await client.memoryPolicy(memoryQuery(policy.scope)); };
      }
      case 'grantMemory': {
        const grant = validate('DataUseGrant', raw);
        update(state => ({ ...mergeGrants(state, [grant]), memoryRevision: state.memoryRevision + 1 }));
        return () => refreshGrants(grant.scope, true);
      }
      case 'enqueueUser': {
        const receipt = validate('PendingUserCommand', raw);
        // POST去重回执可能仍是queued；不能盖过先到的应用/取消事件。
        update(state => mergePendingUserCommands(state, [receipt], '0'));
        return async () => {
          await refreshPendingCommands(receipt.session_id);
          const current = snapshot.pendingUserCommands[receipt.command_id];
          if (current?.run_id) { entry.runId = current.run_id; await refreshRun(current.run_id); }
        };
      }
      case 'viewResult': case 'retryDelivery': {
        const delivery = validate('SessionInboxEntry', raw);
        // 回执确认命令；来源/消费者仍须以当前查询为准。
        return () => refreshResults(delivery.target_session_id);
      }
      case 'archiveSession': {
        const session = validate('Session', raw);
        update(state => mergeSessions(state, [session]));
        return async () => {
          const current = await client.session(session.id);
          update(state => mergeSessions(state, [current]));
          await refreshResults(session.id);
        };
      }
      case 'stopSession': case 'stopWorkspace': {
        const receipt = validate('StopAllReceipt', raw);
        update(state => mergeAdmissions(state, [{ scope: receipt.scope, generation: receipt.generation }]));
        return async () => {
          await Promise.all(receipt.cancelled_run_ids.map(id => refreshRun(id)));
          const fence = command.type === 'stopSession' ? await client.sessionAdmission(command.args[0]) : await client.workspaceAdmission(command.args[0]);
          update(state => mergeAdmissions(state, [fence]));
        };
      }
      case 'startRun': case 'continueVision': case 'cancel': case 'resume': case 'answer': case 'exportArtifact': {
        const run = validate('RunSnapshot', raw);
        entry.runId = run.id;
        update(state => mergeRunSnapshot(state, run));
        return async () => {
          await refreshRun(run.id, undefined, command.type === 'answer' ? command.args[0] : undefined);
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
        update(state => ({ ...mergeScopeStates(state, [scope]), memoryRevision: state.memoryRevision + 1 }));
        return async () => {
          await refreshGrants(scope.scope, entry.memoryGrant);
          await Promise.all(Object.values(snapshot.runs).filter(run => run.workspace_id === scope.scope.workspace_id
            && (scope.scope.session_id === null || run.interaction_session_id === scope.scope.session_id)).map(run => refreshRun(run.id)));
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
      case 'submitMemoryMaintenance': update(state => ({ ...state, memoryRevision: state.memoryRevision + 1, maintenanceRevision: state.maintenanceRevision + 1 })); break;
      case 'decideMemory': update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); break;
      case 'saveMemoryPolicy': update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); break;
      case 'cancel': case 'resume': case 'steer': case 'continueVision': await refreshRun(command.args[0]); break;
      case 'answer': await refreshRun(snapshot.questions[command.args[0]].run_id, undefined, command.args[0]); break;
      case 'decide': await refreshRun(snapshot.approvals[command.args[0]].run_id); break;
      case 'exportArtifact': {
        const task = await client.task(snapshot.artifacts[command.args[0]].task_id);
        await refreshRun(task.run_id); break;
      }
      case 'restoreExport': case 'releaseExport': await refreshRecovery(snapshot.publications[command.args[0]].run_id); break;
       case 'revoke': await refreshGrants(snapshot.grants[command.args[0]].scope, snapshot.grants[command.args[0]].memory_scopes.length > 0); break;
      case 'setWorkspaceDirectory': case 'deleteWorkspace': await refreshWorkspace(command.args[0]); break;
      case 'viewResult': case 'retryDelivery': {
        const delivery = snapshot.deliveries[command.args[0]];
        // 全局待办可在结果页尚未打开时重投；其列表刷新由待办组件负责。
        if (delivery) await refreshResults(delivery.target_session_id);
        break;
      }
      case 'stopSession': case 'stopWorkspace': {
        const fence = command.type === 'stopSession' ? await client.sessionAdmission(command.args[0]) : await client.workspaceAdmission(command.args[0]);
        update(state => mergeAdmissions(state, [fence])); break;
      }
      case 'deleteSession': case 'archiveSession': {
        const session = await client.session(command.args[0]);
        update(state => mergeSessions(state, [session])); break;
      }
    }
  }
  async function synchronize(entry: CommandEntry): Promise<CommandOutcome> {
    entry.error = '';
    try { await entry.refresh!(); entry.outcome = { ...entry.outcome, sync: 'ready' }; }
    catch (error) { entry.error = error instanceof ApiError ? `${error.code}: ${error.message}` : '状态同步失败，请重试查询'; }
    entry.outcome = { ...entry.outcome, runId: entry.runId };
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
        if (error.code === 'version_conflict'
            || (entry.command.type === 'decideMemory' && error.code === 'memory_source_invalid')) {
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
    refreshResults,
    refreshSessionWork,
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
          if (event.kind === 'durable' && ['command.queued', 'command.applied', 'command.cancelled', 'follow_up.changed', 'run.yielded',
            'session.updated', 'admission.stopped', 'scope.revoked', 'grant.revoked'].includes(event.event.kind)) {
            const sessionId = event.event.session_id;
            const affected = [...workSessions].filter(id => !snapshot.deletedSessions[id]
              && (sessionId ? id === sessionId : snapshot.sessions[id]?.workspace_id === event.event.workspace_id));
            await Promise.all(affected.map(id => refreshSessionWork(id)));
          }
          if (event.kind === 'durable' && ['delivery.changed', 'task.consumed', 'session.updated', 'scope.revoked', 'grant.revoked'].includes(event.event.kind)) {
            const sessionId = event.event.session_id;
            const affected = Object.keys(snapshot.resultPages).filter(id => !snapshot.deletedSessions[id]
              && (sessionId ? id === sessionId : snapshot.sessions[id]?.workspace_id === event.event.workspace_id));
            await Promise.all(affected.map(id => refreshResults(id)));
          }
          if (event.kind === 'durable' && 'runs' in event.event.payload
            && !snapshot.deletedWorkspaces[event.event.workspace_id!] && !snapshot.deletedSessions[event.event.session_id!]) {
            const payload = event.event.payload;
            const referenced = new Set([...payload.pending_commands.map(command => command.run_id), ...payload.follow_up_intents.map(intent => intent.run_id)]);
            const affected = new Set([event.event.run_id, ...payload.runs.map(run => run.id),
              ...payload.pending_commands.map(command => command.run_id), ...payload.follow_up_intents.map(intent => intent.run_id),
              ...payload.tasks.map(task => task.run_id), ...payload.activities.map(activity => activity.run_id),
              ...payload.budgets.map(budget => budget.run_id)]);
            // 费用/最近请求摘要只从权威查询取得；不从局部Activity页重算。
            await Promise.all([...affected].filter((runId): runId is string => !!runId && (!!snapshot.runs[runId] || referenced.has(runId)))
              .map(runId => refreshRun(runId, signal)));
          }
          if (event.kind === 'durable' && event.event.kind === 'accounting.settled' && event.event.run_id) {
            // 退休回执只有 Run 身份；费用仍读权威详情，不依赖公开载荷携带预算。
            const runId = event.event.run_id, run = snapshot.runs[runId], summary = snapshot.runSummaries[runId];
            const workspaceId = run?.workspace_id ?? summary?.workspace_id;
            const sessionId = run?.interaction_session_id ?? summary?.session_id;
            if (workspaceId && !snapshot.deletedWorkspaces[workspaceId] && (!sessionId || !snapshot.deletedSessions[sessionId])) {
              await refreshRun(runId, signal);
            }
          }
          if (!signal.aborted) await handlers.event(event);
        },
        connection: async state => {
          if (signal.aborted) return;
          if (state === 'connected') {
            if (connected) await Promise.all([
              ...Object.entries(snapshot.runSummaries).filter(([, summary]) => summary.workspace_id === id).map(([runId]) => refreshRun(runId, signal)),
              ...[...workSessions].filter(sessionId => !snapshot.deletedSessions[sessionId] && snapshot.sessions[sessionId]?.workspace_id === id).map(refreshSessionWork),
            ]);
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
        // workspace命令无Session核对入口；原样重发取得持久去重回执。
        if (['createSession', 'stopWorkspace', 'createMemory', 'decideMemory', 'saveMemoryPolicy', 'grantMemory', 'submitMemoryMaintenance'].includes(entry.command.type)) return submit(entry);
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
      if (command.type === 'revoke' && snapshot.grants[command.args[0]]) {
        entry.scope = { ...snapshot.grants[command.args[0]].scope };
        entry.memoryGrant = snapshot.grants[command.args[0]].memory_scopes.length > 0;
      }
      pending.set(commandId, entry);
      return operate(entry, () => submit(entry));
    },
  };
}

export type RuntimeStore = ReturnType<typeof createRuntimeStore>;
