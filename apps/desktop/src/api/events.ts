import type {
  ActivityView, AgentProfile, Approval, ArtifactRef, BudgetSnapshot, DataUseGrant,
  ModelConnection, ModelMessage, ModelProfile, PublicEvent, Question, ResourceRef, RunDetail, RunSnapshot,
  ScopeState, Session, StreamEvent, TaskSnapshot, Workspace, WorkspaceSnapshot, MemoryRecord,
  WaitRecord, ResultConsumption, JoinFact, DeletionReceipt, PublicationView, SessionInboxEntry, SessionResultPage, AdmissionFence, PendingUserCommand, FollowUpIntent,
} from '../generated/contracts';

type Entities<T> = Record<string, T>;
type Scope = { workspace_id: string | null; session_id: string | null };
type RunSummary = Pick<RunDetail, 'cost_summary' | 'context_usage' | 'watermark'> & { version: number; workspace_id: string; session_id: string | null };
export interface Projection {
  mcpRevision: number;
  mcpWatermark: string;
  skillsRevision: number;
  skillsWatermark: string;
  environmentsRevision: number;
  environmentsWatermark: string;
  memoryRevision: number;
  maintenanceRevision: number;
  memoryNotices: Entities<Pick<MemoryRecord, 'id' | 'scope' | 'revision' | 'status'>>;
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
  deliveries: Entities<SessionInboxEntry>;
  resultPages: Record<string, { ids: string[]; next_cursor: string | null; watermark: string }>;
  deliveryWatermarks: Record<string, string>;
  admissions: Record<string, AdmissionFence>;
  pendingUserCommands: Entities<PendingUserCommand>;
  commandWatermarks: Record<string, string>;
  followUpIntents: Entities<FollowUpIntent>;
  followUpWatermarks: Record<string, string>;
}

export const terminal = (state: RunSnapshot['state'] | undefined) => state !== undefined && ['completed', 'failed', 'cancelled'].includes(state);
export const laterCursor = (a: string, b: string) => BigInt(a) > BigInt(b) ? a : b;

export function emptyProjection(): Projection {
  return { mcpRevision: 0, mcpWatermark: '0', skillsRevision: 0, skillsWatermark: '0', environmentsRevision: 0, environmentsWatermark: '0', memoryRevision: 0, maintenanceRevision: 0, memoryNotices: {}, cursor: '0', snapshotWatermark: '0', workspaces: {}, sessions: {}, profiles: {}, models: {}, connections: {}, runs: {}, runSummaries: {}, tasks: {},
    activities: {}, budgets: {}, messages: {}, messageSessions: {}, artifacts: {}, questions: {}, approvals: {},
    resources: {}, grants: {}, publications: {}, previews: {}, reasoningPreviews: {}, fencedActivities: {}, scopes: {},
    deletedWorkspaces: {}, deletedSessions: {}, entityScopes: {}, waits: {}, consumptions: {}, joins: {},
    deliveries: {}, resultPages: {}, deliveryWatermarks: {}, admissions: {},
    pendingUserCommands: {}, commandWatermarks: {}, followUpIntents: {}, followUpWatermarks: {} };
}

export function mergePendingUserCommands(state: Projection, commands: readonly PendingUserCommand[], watermark: string): Projection {
  let pendingUserCommands = state.pendingUserCommands, commandWatermarks = state.commandWatermarks, entityScopes = state.entityScopes;
  for (const command of commands) {
    if (state.deletedSessions[command.session_id] || BigInt(commandWatermarks[command.command_id] ?? '0') > BigInt(watermark)) continue;
    const previous = pendingUserCommands[command.command_id];
    if (!previous || previous.state !== command.state || previous.run_id !== command.run_id || previous.reason !== command.reason) {
      if (pendingUserCommands === state.pendingUserCommands) pendingUserCommands = { ...pendingUserCommands };
      pendingUserCommands[command.command_id] = command;
    }
    if (commandWatermarks[command.command_id] !== watermark) {
      if (commandWatermarks === state.commandWatermarks) commandWatermarks = { ...commandWatermarks };
      commandWatermarks[command.command_id] = watermark;
    }
    const session = state.sessions[command.session_id];
    if (session && !entityScopes[command.command_id]) {
      if (entityScopes === state.entityScopes) entityScopes = { ...entityScopes };
      entityScopes[command.command_id] = { workspace_id: session.workspace_id, session_id: session.id };
    }
  }
  return pendingUserCommands === state.pendingUserCommands && commandWatermarks === state.commandWatermarks && entityScopes === state.entityScopes
    ? state : { ...state, pendingUserCommands, commandWatermarks, entityScopes };
}

export function mergeFollowUpIntents(state: Projection, intents: readonly FollowUpIntent[], watermark: string): Projection {
  let followUpIntents = state.followUpIntents, followUpWatermarks = state.followUpWatermarks, entityScopes = state.entityScopes;
  for (const intent of intents) {
    if (state.deletedSessions[intent.target_session_id] || BigInt(followUpWatermarks[intent.id] ?? '0') > BigInt(watermark)) continue;
    const previous = followUpIntents[intent.id];
    if (!previous || previous.status !== intent.status || previous.run_id !== intent.run_id || previous.reason !== intent.reason
      || previous.paused_task_ids.length !== intent.paused_task_ids.length || previous.paused_task_ids.some((id, index) => id !== intent.paused_task_ids[index])) {
      if (followUpIntents === state.followUpIntents) followUpIntents = { ...followUpIntents };
      followUpIntents[intent.id] = intent;
    }
    if (followUpWatermarks[intent.id] !== watermark) {
      if (followUpWatermarks === state.followUpWatermarks) followUpWatermarks = { ...followUpWatermarks };
      followUpWatermarks[intent.id] = watermark;
    }
    const session = state.sessions[intent.target_session_id];
    if (session && !entityScopes[intent.id]) {
      if (entityScopes === state.entityScopes) entityScopes = { ...entityScopes };
      entityScopes[intent.id] = { workspace_id: session.workspace_id, session_id: session.id };
    }
  }
  return followUpIntents === state.followUpIntents && followUpWatermarks === state.followUpWatermarks && entityScopes === state.entityScopes
    ? state : { ...state, followUpIntents, followUpWatermarks, entityScopes };
}

export function mergeDeliveries(state: Projection, entries: readonly SessionInboxEntry[], watermark: string): Projection {
  let deliveries = state.deliveries, deliveryWatermarks = state.deliveryWatermarks, entityScopes = state.entityScopes;
  for (const entry of entries) {
    if (state.deletedSessions[entry.target_session_id]) continue;
    const previous = deliveries[entry.id];
    if (previous && (previous.version > entry.version || BigInt(deliveryWatermarks[entry.id]) > BigInt(watermark))) continue;
    // 持久字段由version标识；source_valid与不可变消费记录集合则在同version下派生。
    // 同事实查询/双订阅重放必须保留条目及集合引用，不使已显示的正文失效。
    const consumerIds = new Set(previous?.consumers.map(consumer => consumer.id));
    const unchanged = previous?.version === entry.version && previous.source_valid === entry.source_valid
      && previous.consumers.length === entry.consumers.length && entry.consumers.every(consumer => consumerIds.has(consumer.id));
    if (!unchanged) {
      if (deliveries === state.deliveries) deliveries = { ...deliveries };
      deliveries[entry.id] = entry;
    }
    if (deliveryWatermarks[entry.id] !== watermark) {
      if (deliveryWatermarks === state.deliveryWatermarks) deliveryWatermarks = { ...deliveryWatermarks };
      deliveryWatermarks[entry.id] = watermark;
    }
    const workspaceId = state.sessions[entry.target_session_id]?.workspace_id ?? state.runs[entry.result.run_id]?.workspace_id;
    const owner = entityScopes[entry.id];
    if (workspaceId && (owner?.workspace_id !== workspaceId || owner.session_id !== entry.target_session_id)) {
      if (entityScopes === state.entityScopes) entityScopes = { ...entityScopes };
      entityScopes[entry.id] = { workspace_id: workspaceId, session_id: entry.target_session_id };
    }
  }
  if (deliveries === state.deliveries && deliveryWatermarks === state.deliveryWatermarks && entityScopes === state.entityScopes) return state;
  return { ...state, deliveries, deliveryWatermarks, entityScopes };
}

export function mergeResultPage(state: Projection, sessionId: string, page: SessionResultPage, append = false): Projection {
  if (state.deletedSessions[sessionId] || BigInt(page.watermark) < BigInt(state.resultPages[sessionId]?.watermark ?? '0')) return state;
  const next = mergeDeliveries(state, page.items, page.watermark);
  const previous = state.resultPages[sessionId];
  const ids = [...new Set([...(append ? previous?.ids ?? [] : []), ...page.items.map(entry => entry.id)])];
  if (previous?.watermark === page.watermark && previous.next_cursor === page.next_cursor
    && previous.ids.length === ids.length && previous.ids.every((id, index) => id === ids[index])) return next;
  return { ...next, resultPages: { ...next.resultPages, [sessionId]: {
    ids, next_cursor: page.next_cursor, watermark: page.watermark,
  } } };
}

export function mergeAdmissions(state: Projection, fences: readonly AdmissionFence[]): Projection {
  const admissions = { ...state.admissions };
  for (const fence of fences) {
    if (scopeDeleted(state, fence.scope)) continue;
    const id = fence.scope.session_id ?? fence.scope.workspace_id!;
    if (!admissions[id] || admissions[id].generation < fence.generation) admissions[id] = fence;
  }
  return { ...state, admissions };
}

function contains(scope: Scope, target: Scope): boolean {
  return scope.workspace_id === target.workspace_id && (!scope.session_id || scope.session_id === target.session_id);
}

function runScope(run: RunSnapshot): Scope {
  return { workspace_id: run.workspace_id, session_id: run.interaction_session_id };
}

export function scopeDeleted(state: Projection, scope: Scope): boolean {
  return (scope.workspace_id !== null && Object.hasOwn(state.deletedWorkspaces, scope.workspace_id))
    || (scope.session_id !== null && Object.hasOwn(state.deletedSessions, scope.session_id));
}

export function mergeWorkspaces(state: Projection, workspaces: readonly Workspace[]): Projection {
  return { ...state, workspaces: mergeVersioned(state.workspaces,
    workspaces.filter(workspace => !scopeDeleted(state, { workspace_id: workspace.id, session_id: null }))) };
}

export function mergeSessions(state: Projection, sessions: readonly Session[]): Projection {
  const accepted = sessions.filter(session => session.kind === 'interaction' && !scopeDeleted(state, { workspace_id: session.workspace_id, session_id: session.id }));
  return { ...state, sessions: mergeVersioned(state.sessions, accepted), entityScopes: { ...state.entityScopes,
    ...Object.fromEntries(accepted.map(session => [session.id, { workspace_id: session.workspace_id, session_id: session.id }])) } };
}

export function mergeQuestions(state: Projection, questions: readonly Question[]): Projection {
  const accepted = questions.filter(question => state.runs[question.run_id] && !scopeDeleted(state, { workspace_id: state.runs[question.run_id].workspace_id, session_id: state.runs[question.run_id].interaction_session_id }));
  return { ...state, questions: mergeVersioned(state.questions, accepted), entityScopes: { ...state.entityScopes,
    ...Object.fromEntries(accepted.map(question => {
      const run = state.runs[question.run_id];
      return [question.id, { workspace_id: run.workspace_id, session_id: run.interaction_session_id }];
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
      if (run && contains(grant.scope, runScope(run))) next.fencedActivities[activity.id] = true;
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
  if (scope.workspace_id === null) return state;
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
    deliveries: Object.fromEntries(Object.entries(state.deliveries).filter(([id, entry]) => !affected(id) && !deletedSessions[entry.target_session_id])),
    resultPages: Object.fromEntries(Object.entries(state.resultPages).filter(([id]) => !deletedSessions[id])),
    admissions: Object.fromEntries(Object.entries(state.admissions).filter(([, fence]) => !contains(scope, fence.scope))),
    pendingUserCommands: Object.fromEntries(Object.entries(state.pendingUserCommands).filter(([id, command]) => !affected(id) && !deletedSessions[command.session_id])),
    commandWatermarks: Object.fromEntries(Object.entries(state.commandWatermarks).filter(([id]) => !state.pendingUserCommands[id] || !deletedSessions[state.pendingUserCommands[id].session_id])),
    followUpIntents: Object.fromEntries(Object.entries(state.followUpIntents).filter(([id, intent]) => !affected(id) && !deletedSessions[intent.target_session_id])),
    followUpWatermarks: Object.fromEntries(Object.entries(state.followUpWatermarks).filter(([id]) => !state.followUpIntents[id] || !deletedSessions[state.followUpIntents[id].target_session_id])),
    previews: Object.fromEntries(Object.entries(state.previews).filter(([id]) => Object.hasOwn(activities, id))),
    reasoningPreviews: Object.fromEntries(Object.entries(state.reasoningPreviews).filter(([id]) => Object.hasOwn(activities, id))),
    fencedActivities: Object.fromEntries(Object.entries(state.fencedActivities).filter(([id]) => !affected(id))),
    entityScopes: Object.fromEntries(Object.entries(state.entityScopes).filter(([, owner]) => !contains(scope, owner))),
  };
}

export function applyDeletion(state: Projection, receipt: DeletionReceipt): Projection {
  return { ...eraseScope(state, receipt.scope, receipt.epoch), memoryRevision: state.memoryRevision + 1 };
}

export function mergeVersioned<T extends { id: string; version: number }>(current: Entities<T>, incoming: readonly T[]): Entities<T> {
  const result = { ...current };
  for (const entity of incoming) {
    if (!result[entity.id] || result[entity.id].version < entity.version) result[entity.id] = entity;
  }
  return result;
}

export function mergeMemoryNotices(state: Projection, records: readonly Projection['memoryNotices'][string][]): Projection {
  const memoryNotices = { ...state.memoryNotices };
  for (const { id, scope, revision, status } of records) {
    if (!memoryNotices[id] || memoryNotices[id].revision < revision) memoryNotices[id] = { id, scope, revision, status };
  }
  return { ...state, memoryNotices, memoryRevision: state.memoryRevision + 1 };
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
    const next = fence({ ...state,
      entityScopes: ownership(state, scope, [...payload.runs, ...payload.tasks, ...payload.activities,
         ...payload.budgets, ...payload.messages, ...payload.artifacts, ...payload.questions,
         ...payload.waits, ...payload.consumptions, ...payload.joins, ...payload.follow_up_intents,
         ...payload.pending_commands.map(command => ({ id: command.command_id }))]),
      runs: mergeVersioned(state.runs, payload.runs), tasks: mergeVersioned(state.tasks, payload.tasks),
      activities: mergeVersioned(state.activities, payload.activities), budgets: mergeVersioned(state.budgets, payload.budgets),
      messages: { ...Object.fromEntries(payload.messages.map(message => [message.id, message])), ...state.messages },
      messageSessions: { ...state.messageSessions, ...Object.fromEntries(payload.messages.map(message => [message.id, event.session_id!])) },
      artifacts: mergeVersioned(state.artifacts, payload.artifacts), questions: mergeVersioned(state.questions, payload.questions),
      waits: mergeVersioned(state.waits, payload.waits),
      consumptions: { ...state.consumptions, ...Object.fromEntries(payload.consumptions.map(item => [item.id, item])) },
      joins: { ...state.joins, ...Object.fromEntries(payload.joins.map(item => [item.id, item])) },
    });
    return mergeFollowUpIntents(mergePendingUserCommands(next, payload.pending_commands, event.event_id), payload.follow_up_intents, event.event_id);
  }
  if ('grants' in payload) {
    return mergeGrants(mergeApprovals(mergeResources(state, payload.resources), payload.approvals), payload.grants);
  }
  switch (event.kind) {
    case 'mcp.changed': return BigInt(event.event_id) <= BigInt(state.mcpWatermark) ? state
      : { ...state, mcpRevision: state.mcpRevision + 1, mcpWatermark: event.event_id };
    case 'skill.changed': return BigInt(event.event_id) <= BigInt(state.skillsWatermark) ? state
      : { ...state, skillsRevision: state.skillsRevision + 1, skillsWatermark: event.event_id };
    case 'environment.changed': return BigInt(event.event_id) <= BigInt(state.environmentsWatermark) ? state
      : { ...state, environmentsRevision: state.environmentsRevision + 1, environmentsWatermark: event.event_id };
    case 'memory.maintenance_changed': return { ...state, maintenanceRevision: state.maintenanceRevision + 1 };
    case 'memory.changed': case 'memory.policy_changed': return mergeMemoryNotices(state, event.payload.records);
    case 'delivery.changed': return mergeDeliveries(state, event.payload.deliveries, event.event_id);
    case 'admission.stopped': return mergeAdmissions(state, event.payload.admission_fences);
    case 'workspace.created': case 'workspace.default_created': case 'workspace.directory_changed': return mergeWorkspaces(state, [event.payload]);
    case 'session.created': case 'session.updated': return mergeSessions(state, [event.payload]);
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
    let next = mergeEvent(state, event.event);
    if (['scope.deleted', 'scope.revoked', 'grant.revoked', 'grant.created'].includes(event.event.kind)) next = { ...next, memoryRevision: next.memoryRevision + 1 };
    const cursor = laterCursor(next.cursor, event.event_id);
    return cursor === next.cursor ? next : { ...next, cursor };
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
    mcpRevision: state.mcpRevision + 1,
    mcpWatermark: state.mcpWatermark,
    environmentsRevision: state.environmentsRevision + 1,
    environmentsWatermark: state.environmentsWatermark,
    skillsRevision: state.skillsRevision + 1,
    skillsWatermark: state.skillsWatermark,
    memoryRevision: state.memoryRevision + 1,
    maintenanceRevision: state.maintenanceRevision + 1,
    memoryNotices: state.memoryNotices,
    deliveries: state.deliveries, deliveryWatermarks: state.deliveryWatermarks, resultPages: state.resultPages, admissions: state.admissions,
    pendingUserCommands: state.pendingUserCommands, commandWatermarks: state.commandWatermarks,
    followUpIntents: state.followUpIntents, followUpWatermarks: state.followUpWatermarks,
    scopes: state.scopes, deletedWorkspaces: state.deletedWorkspaces, deletedSessions: state.deletedSessions,
    profiles: state.profiles, models: state.models, connections: state.connections, fencedActivities: state.fencedActivities,
    resources: Object.fromEntries(Object.entries(state.resources).filter(([, resource]) => resource.scope.workspace_id === snapshot.workspace.id)),
    grants: Object.fromEntries(Object.entries(state.grants).filter(([, grant]) => grant.scope.workspace_id === snapshot.workspace.id)),
    publications: Object.fromEntries(Object.entries(state.publications).filter(([, publication]) => publication.workspace_id === snapshot.workspace.id)),
    runSummaries: Object.fromEntries(Object.entries(state.runSummaries).filter(([, summary]) => summary.workspace_id === snapshot.workspace.id)),
    entityScopes: Object.fromEntries(Object.entries(state.entityScopes).filter(([id]) => state.fencedActivities[id] || state.pendingUserCommands[id] || state.followUpIntents[id])),
    workspaces: { ...state.workspaces, [snapshot.workspace.id]: snapshot.workspace },
    sessions: mergeVersioned({}, snapshot.sessions.items), runs: mergeVersioned({}, snapshot.active_runs.items),
    questions: {}, approvals: mergeVersioned({}, snapshot.pending_approvals.items) });
  next = mergeGrants(mergeResources(next, snapshot.resources.items), snapshot.grants.items);
  for (const session of snapshot.sessions.items) next.entityScopes[session.id] = { workspace_id: session.workspace_id, session_id: session.id };
  for (const run of snapshot.active_runs.items) next.entityScopes[run.id] = { workspace_id: run.workspace_id, session_id: run.interaction_session_id };
  for (const question of snapshot.pending_questions.items) {
    const run = next.runs[question.run_id];
    // 待办页可能超出active_runs首页；归属未知时等对应RunDetail，不能按工作区猜session。
    if (run) {
      next.questions = mergeVersioned(next.questions, [question]);
      next.entityScopes[question.id] = { workspace_id: run.workspace_id, session_id: run.interaction_session_id };
    }
  }
  for (const approval of snapshot.pending_approvals.items) next.entityScopes[approval.id] = {
    workspace_id: approval.workspace_id, session_id: approval.session_id };
  for (const [session_id, epoch] of Object.entries(state.deletedSessions)) next = eraseScope(next,
    { workspace_id: snapshot.workspace.id, session_id }, epoch);
  return next;
}

export function mergeRunDetail(state: Projection, detail: RunDetail): Projection {
  if (scopeDeleted(state, runScope(detail.run))) return state;
  if (BigInt(detail.watermark) < BigInt(state.snapshotWatermark)) return state;
  const previous = state.runSummaries[detail.run.id];
  const acceptSummary = (!previous || BigInt(detail.watermark) >= BigInt(previous.watermark))
    && (!state.runs[detail.run.id] || detail.run.version >= state.runs[detail.run.id].version);
  // 查询水位不能推进 SSE 游标，否则会跳过该水位之前尚未处理的工作区事件。
  return fence({ ...state, entityScopes: ownership(state, runScope(detail.run), [detail.run, ...detail.tasks.items,
    ...detail.activities.items, detail.budget, ...detail.messages.items, ...detail.artifacts.items,
    ...detail.questions.items, ...detail.approvals.items, ...detail.waits.items, ...detail.consumptions.items, ...detail.joins.items]),
    runs: mergeVersioned(state.runs, [detail.run]), tasks: mergeVersioned(state.tasks, detail.tasks.items),
    runSummaries: acceptSummary ? { ...state.runSummaries, [detail.run.id]: { cost_summary: detail.cost_summary, context_usage: detail.context_usage,
      watermark: detail.watermark, version: detail.run.version, workspace_id: detail.run.workspace_id, session_id: detail.run.interaction_session_id } } : state.runSummaries,
    activities: mergeVersioned(state.activities, detail.activities.items), budgets: mergeVersioned(state.budgets, [detail.budget]),
    messages: { ...Object.fromEntries(detail.messages.items.map(message => [message.id, message])), ...state.messages },
    messageSessions: { ...state.messageSessions, ...Object.fromEntries(detail.messages.items.map(message => [message.id, detail.run.interaction_session_id!])) },
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
  if (!run || scopeDeleted(state, runScope(run)) || BigInt(input.page.watermark) < BigInt(state.snapshotWatermark)) return state;
  const next = { ...state, entityScopes: ownership(state, runScope(run), input.page.items) };
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
  if (scopeDeleted(state, runScope(run))) return state;
  return fence({ ...state, entityScopes: ownership(state, runScope(run), [run]), runs: mergeVersioned(state.runs, [run]) });
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
