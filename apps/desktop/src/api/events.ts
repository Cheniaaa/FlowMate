import type {
  ActivityView, AgentProfile, Approval, ArtifactRef, BudgetSnapshot, DataUseGrant,
  ModelConnection, ModelMessage, ModelProfile, PublicEvent, Question, ResourceRef, RunDetail, RunSnapshot,
  ScopeState, Session, StreamEvent, TaskSnapshot, Workspace, WorkspaceSnapshot,
  WaitRecord, ResultConsumption, JoinFact, DeletionReceipt, PublicationView,
} from '../generated/contracts';

type Entities<T> = Record<string, T>;
type Scope = ResourceRef['scope'];
type RunSummary = Pick<RunDetail, 'cost_summary' | 'context_usage' | 'watermark'> & { version: number; workspace_id: string; session_id: string };
export interface Projection {
  cursor: string;
  snapshotWatermark: string;
  workspaces: Entities<Workspace>;
  sessions: Entities<Session>;
  profiles: Entities<AgentProfile>;
  models: Entities<ModelProfile>;
  connections: Entities<ModelConnection>;
  runs: Entities<RunSnapshot>;
  runSummaries: Entities<RunSummary>;
  tasks: Entities<TaskSnapshot>;
  activities: Entities<ActivityView>;
  budgets: Entities<BudgetSnapshot>;
  messages: Entities<ModelMessage>;
  messageSessions: Record<string, string>;
  artifacts: Entities<ArtifactRef>;
  questions: Entities<Question>;
  approvals: Entities<Approval>;
  resources: Entities<ResourceRef>;
  grants: Entities<DataUseGrant>;
  publications: Entities<PublicationView>;
  previews: Record<string, Record<number, string>>;
  reasoningPreviews: Record<string, Record<number, string>>;
  fencedActivities: Record<string, true>;
  scopes: Entities<ScopeState>;
  deletedWorkspaces: Record<string, number>;
  deletedSessions: Record<string, number>;
  entityScopes: Record<string, Scope>;
  waits: Entities<WaitRecord>;
  consumptions: Entities<ResultConsumption>;
  joins: Entities<JoinFact>;
}

export const terminal = (state: RunSnapshot['state'] | undefined) => state !== undefined && ['completed', 'failed', 'cancelled'].includes(state);
export const laterCursor = (a: string, b: string) => BigInt(a) > BigInt(b) ? a : b;

export function emptyProjection(): Projection {
  return { cursor: '0', snapshotWatermark: '0', workspaces: {}, sessions: {}, profiles: {}, models: {}, connections: {}, runs: {}, runSummaries: {}, tasks: {},
    activities: {}, budgets: {}, messages: {}, messageSessions: {}, artifacts: {}, questions: {}, approvals: {},
    resources: {}, grants: {}, publications: {}, previews: {}, reasoningPreviews: {}, fencedActivities: {}, scopes: {},
    deletedWorkspaces: {}, deletedSessions: {}, entityScopes: {}, waits: {}, consumptions: {}, joins: {} };
}

function contains(scope: Scope, target: Scope): boolean {
  return scope.workspace_id === target.workspace_id && (!scope.session_id || scope.session_id === target.session_id);
}

export function scopeDeleted(state: Projection, scope: Scope): boolean {
  return Object.hasOwn(state.deletedWorkspaces, scope.workspace_id)
    || (scope.session_id !== null && Object.hasOwn(state.deletedSessions, scope.session_id));
}

export function mergeWorkspaces(state: Projection, workspaces: readonly Workspace[]): Projection {
  return { ...state, workspaces: mergeVersioned(state.workspaces,
    workspaces.filter(workspace => !scopeDeleted(state, { workspace_id: workspace.id, session_id: null }))) };
}

export function mergeSessions(state: Projection, sessions: readonly Session[]): Projection {
  const accepted = sessions.filter(session => !scopeDeleted(state, { workspace_id: session.workspace_id, session_id: session.id }));
  return { ...state, sessions: mergeVersioned(state.sessions, accepted), entityScopes: { ...state.entityScopes,
    ...Object.fromEntries(accepted.map(session => [session.id, { workspace_id: session.workspace_id, session_id: session.id }])) } };
}

export function mergeQuestions(state: Projection, questions: readonly Question[]): Projection {
  const accepted = questions.filter(question => state.runs[question.run_id] && !scopeDeleted(state, state.runs[question.run_id]));
  return { ...state, questions: mergeVersioned(state.questions, accepted), entityScopes: { ...state.entityScopes,
    ...Object.fromEntries(accepted.map(question => {
      const run = state.runs[question.run_id];
      return [question.id, { workspace_id: run.workspace_id, session_id: run.session_id }];
    })) } };
}

export function mergeApprovals(state: Projection, approvals: readonly Approval[]): Projection {
  const accepted = approvals.filter(approval => !scopeDeleted(state, approval));
  return { ...state, approvals: mergeVersioned(state.approvals, accepted), entityScopes: { ...state.entityScopes,
    ...Object.fromEntries(accepted.map(approval => [approval.id, { workspace_id: approval.workspace_id, session_id: approval.session_id }])) } };
}

export function mergeResources(state: Projection, resources: readonly ResourceRef[]): Projection {
  return { ...state, resources: mergeVersioned(state.resources, resources.filter(resource => !scopeDeleted(state, resource.scope))) };
}

export function mergeGrants(state: Projection, grants: readonly DataUseGrant[]): Projection {
  const accepted = grants.filter(grant => !scopeDeleted(state, grant.scope));
  const next = { ...state, grants: mergeVersioned(state.grants, accepted), fencedActivities: { ...state.fencedActivities } };
  for (const grant of accepted) {
    if (grant.status !== 'revoked' || state.grants[grant.id]?.version >= grant.version) continue;
    for (const activity of Object.values(state.activities)) {
      const run = state.runs[activity.run_id];
      if (run && contains(grant.scope, run)) next.fencedActivities[activity.id] = true;
    }
  }
  return fence(next);
}

export function mergePublications(state: Projection, publications: readonly PublicationView[]): Projection {
  return { ...state, publications: mergeVersioned(state.publications, publications.filter(item => !scopeDeleted(state, item))) };
}

function ownership(state: Projection, scope: Scope, entities: readonly { id: string }[]): Record<string, Scope> {
  const owner = { workspace_id: scope.workspace_id, session_id: scope.session_id };
  return { ...state.entityScopes, ...Object.fromEntries(entities.map(entity => [entity.id, owner])) };
}

function eraseScope(state: Projection, scope: Scope, epoch: number): Projection {
  const deletedSessions = { ...state.deletedSessions };
  if (scope.session_id) deletedSessions[scope.session_id] = Math.max(epoch, deletedSessions[scope.session_id] ?? 0);
  else {
    for (const owner of [...Object.values(state.entityScopes), ...Object.values(state.sessions).map(session => ({
      workspace_id: session.workspace_id, session_id: session.id }))]) {
      if (contains(scope, owner) && owner.session_id) deletedSessions[owner.session_id] = Math.max(epoch, deletedSessions[owner.session_id] ?? 0);
    }
  }
  const affected = (id: string) => state.entityScopes[id] && contains(scope, state.entityScopes[id]);
  const retain = <T,>(entities: Entities<T>) => Object.fromEntries(Object.entries(entities).filter(([id]) => !affected(id)));
  const messages = retain(state.messages);
  const activities = retain(state.activities);
  return { ...state, deletedSessions,
    deletedWorkspaces: scope.session_id ? state.deletedWorkspaces : {
      ...state.deletedWorkspaces, [scope.workspace_id]: Math.max(epoch, state.deletedWorkspaces[scope.workspace_id] ?? 0) },
    workspaces: Object.fromEntries(Object.entries(state.workspaces).filter(([id]) => scope.session_id || id !== scope.workspace_id)),
    sessions: Object.fromEntries(Object.entries(state.sessions).filter(([, session]) => !contains(scope, {
      workspace_id: session.workspace_id, session_id: session.id }))),
    runs: retain(state.runs), tasks: retain(state.tasks), activities, budgets: retain(state.budgets), messages,
    runSummaries: Object.fromEntries(Object.entries(state.runSummaries).filter(([, summary]) => !contains(scope, summary))),
    messageSessions: Object.fromEntries(Object.entries(state.messageSessions).filter(([id]) => Object.hasOwn(messages, id))),
    artifacts: retain(state.artifacts), questions: retain(state.questions),
    waits: retain(state.waits), consumptions: retain(state.consumptions), joins: retain(state.joins),
    approvals: Object.fromEntries(Object.entries(state.approvals).filter(([id, approval]) => !affected(id) && !contains(scope, approval))),
    resources: Object.fromEntries(Object.entries(state.resources).filter(([, resource]) => !contains(scope, resource.scope))),
    grants: Object.fromEntries(Object.entries(state.grants).filter(([, grant]) => !contains(scope, grant.scope))),
    publications: Object.fromEntries(Object.entries(state.publications).filter(([, publication]) => !contains(scope, publication))),
    previews: Object.fromEntries(Object.entries(state.previews).filter(([id]) => Object.hasOwn(activities, id))),
    reasoningPreviews: Object.fromEntries(Object.entries(state.reasoningPreviews).filter(([id]) => Object.hasOwn(activities, id))),
    fencedActivities: Object.fromEntries(Object.entries(state.fencedActivities).filter(([id]) => !affected(id))),
    entityScopes: Object.fromEntries(Object.entries(state.entityScopes).filter(([, owner]) => !contains(scope, owner))),
  };
}

export function applyDeletion(state: Projection, receipt: DeletionReceipt): Projection {
  return eraseScope(state, receipt.scope, receipt.epoch);
}

export function mergeVersioned<T extends { id: string; version: number }>(current: Entities<T>, incoming: readonly T[]): Entities<T> {
  const result = { ...current };
  for (const entity of incoming) {
    if (!result[entity.id] || result[entity.id].version < entity.version) result[entity.id] = entity;
  }
  return result;
}

function fence(state: Projection): Projection {
  const previews = { ...state.previews };
  const reasoningPreviews = { ...state.reasoningPreviews };
  const fencedActivities = { ...state.fencedActivities };
  for (const activity of Object.values(state.activities)) {
    if (terminal(state.runs[activity.run_id]?.state) || !['prepared', 'dispatched'].includes(activity.state)
      || activity.dependencies.some(dependency => state.grants[dependency.scope_id]?.status === 'revoked'
        && dependency.epoch < state.grants[dependency.scope_id].epoch
        || state.scopes[dependency.scope_id]?.status === 'revoked' && dependency.epoch < state.scopes[dependency.scope_id].epoch)) {
      fencedActivities[activity.id] = true;
    }
  }
  for (const message of Object.values(state.messages)) {
    if (message.activity_id) fencedActivities[message.activity_id] = true;
  }
  for (const id of Object.keys(fencedActivities)) { delete previews[id]; delete reasoningPreviews[id]; }
  return { ...state, previews, reasoningPreviews, fencedActivities };
}

export function mergeScopeStates(state: Projection, scopes: readonly ScopeState[], deletions: readonly DeletionReceipt[] = []): Projection {
    let next = { ...state, scopes: { ...state.scopes }, fencedActivities: { ...state.fencedActivities } };
    for (const scope of scopes) {
      const previous = next.scopes[scope.id];
      if (previous && previous.epoch >= scope.epoch) continue;
      next.scopes[scope.id] = scope;
      if (scope.status === 'revoked') {
        for (const activity of Object.values(next.activities)) {
          const owner = next.entityScopes[activity.id];
          if (owner && contains(scope.scope, owner)) next.fencedActivities[activity.id] = true;
        }
      }
      if (scope.status === 'deleted') next = eraseScope(next, scope.scope, scope.epoch);
    }
    for (const deletion of deletions) next = eraseScope(next, deletion.scope, deletion.epoch);
    return fence(next);
}

function mergeEvent(state: Projection, event: PublicEvent): Projection {
  const payload = event.payload;
  if ('scopes' in payload) return mergeScopeStates(state, payload.scopes, payload.deletions);
  if (event.workspace_id && scopeDeleted(state, { workspace_id: event.workspace_id, session_id: event.session_id })) return state;
  if ('runs' in payload) {
    const scope = { workspace_id: event.workspace_id!, session_id: event.session_id };
    return fence({ ...state,
      entityScopes: ownership(state, scope, [...payload.runs, ...payload.tasks, ...payload.activities,
        ...payload.budgets, ...payload.messages, ...payload.artifacts, ...payload.questions,
        ...payload.waits, ...payload.consumptions, ...payload.joins]),
      runs: mergeVersioned(state.runs, payload.runs), tasks: mergeVersioned(state.tasks, payload.tasks),
      activities: mergeVersioned(state.activities, payload.activities), budgets: mergeVersioned(state.budgets, payload.budgets),
      messages: { ...Object.fromEntries(payload.messages.map(message => [message.id, message])), ...state.messages },
      messageSessions: { ...state.messageSessions, ...Object.fromEntries(payload.messages.map(message => [message.id, event.session_id!])) },
      artifacts: mergeVersioned(state.artifacts, payload.artifacts), questions: mergeVersioned(state.questions, payload.questions),
      waits: mergeVersioned(state.waits, payload.waits),
      consumptions: { ...state.consumptions, ...Object.fromEntries(payload.consumptions.map(item => [item.id, item])) },
      joins: { ...state.joins, ...Object.fromEntries(payload.joins.map(item => [item.id, item])) },
    });
  }
  if ('grants' in payload) {
    return mergeGrants(mergeApprovals(mergeResources(state, payload.resources), payload.approvals), payload.grants);
  }
  switch (event.kind) {
    case 'workspace.created': case 'workspace.default_created': case 'workspace.directory_changed': return mergeWorkspaces(state, [event.payload]);
    case 'session.created': return mergeSessions(state, [event.payload]);
    case 'agent.saved': return { ...state, profiles: mergeVersioned(state.profiles, [event.payload.profile]) };
    case 'model.saved': return { ...state, models: mergeVersioned(state.models, [event.payload]) };
    case 'connection.saved': return { ...state, connections: mergeVersioned(state.connections, [event.payload]) };
    default: throw new Error('Runtime 事件类别与公开载荷不一致');
  }
}

export function reduceStream(state: Projection, event: StreamEvent): Projection {
  if (event.kind === 'durable') {
    // 删除是永久围栏；跨工作区快照的全局水位不能使迟到删除事实失效。
    if (BigInt(event.event_id) <= BigInt(state.snapshotWatermark) && event.event.kind !== 'scope.deleted') return state;
    return { ...mergeEvent(state, event.event), cursor: laterCursor(state.cursor, event.event_id) };
  }
  const activity = state.activities[event.activity_id];
  if (!activity || state.fencedActivities[event.activity_id] || terminal(state.runs[activity.run_id]?.state)) return state;
  const channel = event.kind === 'reasoning_delta' ? 'reasoningPreviews' : 'previews';
  const chunks = state[channel][event.activity_id] ?? {};
  if (Object.hasOwn(chunks, event.index)) return state;
  return { ...state, [channel]: { ...state[channel], [event.activity_id]: { ...chunks, [event.index]: event.text } } };
}

export function resetWorkspace(state: Projection, snapshot: WorkspaceSnapshot): Projection {
  if (scopeDeleted(state, { workspace_id: snapshot.workspace.id, session_id: null })) return state;
  let next = fence({ ...emptyProjection(), cursor: snapshot.watermark, snapshotWatermark: snapshot.watermark,
    scopes: state.scopes, deletedWorkspaces: state.deletedWorkspaces, deletedSessions: state.deletedSessions,
    profiles: state.profiles, models: state.models, connections: state.connections, fencedActivities: state.fencedActivities,
    resources: Object.fromEntries(Object.entries(state.resources).filter(([, resource]) => resource.scope.workspace_id === snapshot.workspace.id)),
    grants: Object.fromEntries(Object.entries(state.grants).filter(([, grant]) => grant.scope.workspace_id === snapshot.workspace.id)),
    publications: Object.fromEntries(Object.entries(state.publications).filter(([, publication]) => publication.workspace_id === snapshot.workspace.id)),
    runSummaries: Object.fromEntries(Object.entries(state.runSummaries).filter(([, summary]) => summary.workspace_id === snapshot.workspace.id)),
    entityScopes: Object.fromEntries(Object.entries(state.entityScopes).filter(([id]) => state.fencedActivities[id])),
    workspaces: { ...state.workspaces, [snapshot.workspace.id]: snapshot.workspace },
    sessions: mergeVersioned({}, snapshot.sessions.items), runs: mergeVersioned({}, snapshot.active_runs.items),
    questions: {}, approvals: mergeVersioned({}, snapshot.pending_approvals.items) });
  next = mergeGrants(mergeResources(next, snapshot.resources.items), snapshot.grants.items);
  for (const session of snapshot.sessions.items) next.entityScopes[session.id] = { workspace_id: session.workspace_id, session_id: session.id };
  for (const run of snapshot.active_runs.items) next.entityScopes[run.id] = { workspace_id: run.workspace_id, session_id: run.session_id };
  for (const question of snapshot.pending_questions.items) {
    const run = next.runs[question.run_id];
    // 待办页可能超出active_runs首页；归属未知时等对应RunDetail，不能按工作区猜session。
    if (run) {
      next.questions = mergeVersioned(next.questions, [question]);
      next.entityScopes[question.id] = { workspace_id: run.workspace_id, session_id: run.session_id };
    }
  }
  for (const approval of snapshot.pending_approvals.items) next.entityScopes[approval.id] = {
    workspace_id: approval.workspace_id, session_id: approval.session_id };
  for (const [session_id, epoch] of Object.entries(state.deletedSessions)) next = eraseScope(next,
    { workspace_id: snapshot.workspace.id, session_id }, epoch);
  return next;
}

export function mergeRunDetail(state: Projection, detail: RunDetail): Projection {
  if (scopeDeleted(state, detail.run)) return state;
  if (BigInt(detail.watermark) < BigInt(state.snapshotWatermark)) return state;
  const previous = state.runSummaries[detail.run.id];
  const acceptSummary = (!previous || BigInt(detail.watermark) >= BigInt(previous.watermark))
    && (!state.runs[detail.run.id] || detail.run.version >= state.runs[detail.run.id].version);
  // 查询水位不能推进 SSE 游标，否则会跳过该水位之前尚未处理的工作区事件。
  return fence({ ...state, entityScopes: ownership(state, detail.run, [detail.run, ...detail.tasks.items,
    ...detail.activities.items, detail.budget, ...detail.messages.items, ...detail.artifacts.items,
    ...detail.questions.items, ...detail.approvals.items, ...detail.waits.items, ...detail.consumptions.items, ...detail.joins.items]),
    runs: mergeVersioned(state.runs, [detail.run]), tasks: mergeVersioned(state.tasks, detail.tasks.items),
    runSummaries: acceptSummary ? { ...state.runSummaries, [detail.run.id]: { cost_summary: detail.cost_summary, context_usage: detail.context_usage,
      watermark: detail.watermark, version: detail.run.version, workspace_id: detail.run.workspace_id, session_id: detail.run.session_id } } : state.runSummaries,
    activities: mergeVersioned(state.activities, detail.activities.items), budgets: mergeVersioned(state.budgets, [detail.budget]),
    messages: { ...Object.fromEntries(detail.messages.items.map(message => [message.id, message])), ...state.messages },
    messageSessions: { ...state.messageSessions, ...Object.fromEntries(detail.messages.items.map(message => [message.id, detail.run.session_id])) },
    artifacts: mergeVersioned(state.artifacts, detail.artifacts.items), questions: mergeVersioned(state.questions, detail.questions.items),
    approvals: mergeVersioned(state.approvals, detail.approvals.items), waits: mergeVersioned(state.waits, detail.waits.items),
    consumptions: { ...state.consumptions, ...Object.fromEntries(detail.consumptions.items.map(item => [item.id, item])) },
    joins: { ...state.joins, ...Object.fromEntries(detail.joins.items.map(item => [item.id, item])) } });
}

export type RunPageInput = { [K in 'tasks' | 'activities' | 'artifacts' | 'waits' | 'consumptions' | 'joins']: {
  kind: K; page: RunDetail[K];
} }['tasks' | 'activities' | 'artifacts' | 'waits' | 'consumptions' | 'joins'];

export function mergeRunPage(state: Projection, runId: string, input: RunPageInput): Projection {
  const run = state.runs[runId];
  if (!run || scopeDeleted(state, run) || BigInt(input.page.watermark) < BigInt(state.snapshotWatermark)) return state;
  const next = { ...state, entityScopes: ownership(state, run, input.page.items) };
  switch (input.kind) {
    case 'tasks': return { ...next, tasks: mergeVersioned(state.tasks, input.page.items) };
    case 'activities': return fence({ ...next, activities: mergeVersioned(state.activities, input.page.items) });
    case 'artifacts': return { ...next, artifacts: mergeVersioned(state.artifacts, input.page.items) };
    case 'waits': return { ...next, waits: mergeVersioned(state.waits, input.page.items) };
    case 'consumptions': return { ...next, consumptions: { ...state.consumptions, ...Object.fromEntries(input.page.items.map(item => [item.id, item])) } };
    case 'joins': return { ...next, joins: { ...state.joins, ...Object.fromEntries(input.page.items.map(item => [item.id, item])) } };
  }
}

export function mergeRunSnapshot(state: Projection, run: RunSnapshot): Projection {
  if (scopeDeleted(state, run)) return state;
  return fence({ ...state, entityScopes: ownership(state, run, [run]), runs: mergeVersioned(state.runs, [run]) });
}

export function mergeMessages(state: Projection, session_id: string, messages: readonly ModelMessage[]): Projection {
  const session = state.sessions[session_id];
  if (!session || scopeDeleted(state, { workspace_id: session.workspace_id, session_id })) return state;
  return fence({ ...state, entityScopes: ownership(state, { workspace_id: session.workspace_id, session_id }, messages),
    messages: { ...Object.fromEntries(messages.map(message => [message.id, message])), ...state.messages },
    messageSessions: { ...state.messageSessions, ...Object.fromEntries(messages.map(message => [message.id, session_id])) } });
}

export function orderedMessageIds(state: Projection, session_id: string): string[] {
  // 字典只负责按 ID 去重；查询、分页与事件共用消息的持久发布位置。
  return Object.values(state.messages)
    .filter(message => state.messageSessions[message.id] === session_id)
    .sort((left, right) => {
      const eventOrder = BigInt(left.event_id) - BigInt(right.event_id);
      return eventOrder === 0n ? left.event_index - right.event_index : eventOrder < 0n ? -1 : 1;
    })
    .map(message => message.id);
}

export async function* readSse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const closed = reader.closed.catch(error => error);
  const decoder = new TextDecoder();
  let cancellation: Promise<void> | undefined;
  const abort = () => { cancellation = reader.cancel(); };
  signal.addEventListener('abort', abort, { once: true });
  let buffer = '';
  let data: string[] = [];
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let match: RegExpExecArray | null;
      const lineBreak = chunk.done ? /\r\n|\r|\n/ : /\r\n|\r(?!$)|\n/;
      while ((match = lineBreak.exec(buffer))) {
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (!line) {
          if (data.length) yield JSON.parse(data.join('\n'));
          data = [];
        } else if (line === 'data' || line.startsWith('data:')) {
          data.push(line === 'data' ? '' : line.slice(5).replace(/^ /, ''));
        }
      }
      if (chunk.done) break;
    }
  } finally {
    signal.removeEventListener('abort', abort);
    try { await (cancellation ?? reader.cancel()); }
    catch (error) {
      // 只消除源流错误在清理时的重复抛出，保留读取/消费者的原始失败。
      if (error !== await closed) throw error;
    }
    finally { reader.releaseLock(); }
  }
}
