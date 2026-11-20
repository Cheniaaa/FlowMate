import { describe, expect, it } from 'vitest';
import { applyDeletion, emptyProjection, mergeApprovals, mergeGrants, mergeMessages, mergeQuestions, mergeResources, mergeRunDetail, mergeRunFeedback, mergeRunSnapshot, mergeSessions, mergeWorkspaces, orderedMessageIds, readSse, reduceStream, resetWorkspace } from './events';
import type { ModelMessage, StreamEvent, RunDetail, RunSnapshot, WorkspaceSnapshot } from '../generated/contracts';
import { connection, contextUsage, event as publicEvent, grant, limits, page, resource, run as fullRun, runDetailSummary } from '../test/fixtures';

const id = '00000000-0000-4000-8000-000000000001';
const activityId = '00000000-0000-4000-8000-000000000002';
const run = (version: number, state: RunSnapshot['state'] = 'running'): RunSnapshot => ({ ...fullRun, id, version, state, sources: { ...fullRun.sources, resource_ids: [id] }, scope_dependencies: [{ scope_id: id, epoch: 1 }] });
const activity = (version = 1, state = 'dispatched') => ({ id: activityId, version, run_id: id, state, dependencies: [{ scope_id: id, epoch: 1 }] });
function durable(cursor: string, payload: object, kind = 'task.stepped'): StreamEvent {
  payload = kind === 'grant.revoked' ? { resources: [], grants: [], approvals: [], ...payload }
    : { runs: [], tasks: [], activities: [], budgets: [], messages: [], artifacts: [], questions: [], waits: [], consumptions: [], joins: [], pending_commands: [], follow_up_intents: [], ...payload };
  return { kind: 'durable', event_id: cursor, event: { kind, event_id: cursor, payload, run_id: id } } as StreamEvent;
}
const delta = (index: number, text: string): StreamEvent => ({ kind: 'delta', activity_id: activityId, index, text });
function started() { return reduceStream(emptyProjection(), durable('9007199254740993', { runs: [run(3)], activities: [activity()] })); }

it('消息反馈查询不推进事件游标；较新事件淘汰旧反馈，迟到查询及删除后查询不能复活事实', () => {
  const feedback = { run_id: id, version: 3, workspace_id: fullRun.workspace_id, session_id: fullRun.interaction_session_id!,
    root_task_id: fullRun.root_task_id, connection_id: connection.id, state: 'interrupted' as const, reason: 'uncertain_activity', model_activity: null };
  const first = { ...page([feedback]), watermark: '9007199254740994' };
  let state = mergeRunFeedback(started(), first);
  expect(state.cursor).toBe('9007199254740993');
  expect(state.runFeedback[id].reason).toBe('uncertain_activity');
  state = reduceStream(state, durable('9007199254740995', { activities: [{ ...activity(2), kind: 'model', error: 'model_timeout', task_id: fullRun.root_task_id }] }));
  expect(state.runFeedback[id]).toBeUndefined();
  expect(mergeRunFeedback(state, first).runFeedback[id]).toBeUndefined();
  state = mergeRunFeedback(state, { ...first, watermark: '9007199254740995' });
  expect(state.runFeedback[id]).toBeTruthy();
  state = applyDeletion(state, { scope: { kind: 'session', workspace_id: fullRun.workspace_id, session_id: fullRun.interaction_session_id }, status: 'deleted', epoch: 2 });
  expect(mergeRunFeedback(state, { ...first, watermark: '9007199254740996' }).runFeedback[id]).toBeUndefined();
});

it('reasoning 与正文预览独立索引，持久消息提交及撤销共用出队围栏', () => {
  let state = reduceStream(started(), delta(0, '正文'));
  state = reduceStream(state, { kind: 'reasoning_delta', activity_id: activityId, index: 0, text: '推理' });
  expect(state.previews[activityId]).toEqual({ 0: '正文' });
  expect(state.reasoningPreviews[activityId]).toEqual({ 0: '推理' });
  state = reduceStream(state, durable('9007199254740994', { messages: [{ id, run_id: id, role: 'assistant', activity_id: activityId, parts: [{ kind: 'reasoning', text: '推理' }], source_dependencies: [], event_id: '9007199254740994', event_index: 0, origin: 'conversation', private_ref: null }] }));
  expect(state.reasoningPreviews[activityId]).toBeUndefined();
  expect(reduceStream(state, { kind: 'reasoning_delta', activity_id: activityId, index: 1, text: '迟到' })).toBe(state);
});

describe('资源和完整授权的快照恢复', () => {
  const snapshot = (resources = [resource], grants = [grant]): WorkspaceSnapshot => ({ workspace: { id, version: 1, name: '工作区', directory_resource_id: null },
    sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]),
    resources: page(resources), grants: page(grants), watermark: '20' });

  it('新投影从 snapshot 恢复共享授权，保留完整资源/用途而不是拆分', () => {
    const other = { ...resource, id: activityId, label: '另一个资料.md' };
    const shared = { ...grant, resource_ids: [resource.id, other.id] as [string, string] };
    const state = resetWorkspace(emptyProjection(), snapshot([resource, other], [shared]));
    expect(Object.values(state.resources)).toEqual([resource, other]);
    expect(Object.values(state.grants)).toEqual([shared]);
    expect(state.grants[shared.id].purposes).toEqual(['read', 'model_send']);
  });

  it('重建合并已有较新版本和已加载尾页，revoked 不能由旧快照复活，跨工作区不混合', () => {
    const tail = { ...resource, id: activityId, label: '已加载尾页' };
    const foreign = { ...resource, id: '00000000-0000-4000-8000-000000000013', scope: { kind: 'workspace' as const, workspace_id: activityId, session_id: null } };
    const revoked = { ...grant, version: 2, epoch: 2, status: 'revoked' as const };
    let state = mergeResources(emptyProjection(), [{ ...resource, version: 2, label: '新名称' }, tail, foreign]);
    state = mergeGrants(state, [revoked]);
    state = resetWorkspace(state, snapshot());
    expect(state.resources[resource.id].version).toBe(2);
    expect(state.resources[tail.id]).toEqual(tail);
    expect(state.resources[foreign.id]).toBeUndefined();
    expect(state.grants[grant.id]).toEqual(revoked);
  });

  it('snapshot 及迟到分页均不能越过 session/workspace 删除围栏，共享资源不随单 session 删除', () => {
    const scoped = { ...resource, id: activityId, scope: { kind: 'session' as const, workspace_id: id, session_id: activityId } };
    const scopedGrant = { ...grant, id: activityId, scope: scoped.scope, resource_ids: [scoped.id] as [string] };
    let state = applyDeletion(emptyProjection(), { scope: scoped.scope, epoch: 2, status: 'deleted' });
    state = resetWorkspace(state, snapshot([resource, scoped], [grant, scopedGrant]));
    state = mergeGrants(mergeResources(state, [scoped]), [scopedGrant]);
    expect(Object.values(state.resources)).toEqual([resource]);
    expect(Object.values(state.grants)).toEqual([grant]);
    state = applyDeletion(state, { scope: resource.scope, epoch: 3, status: 'deleted' });
    expect(resetWorkspace(state, snapshot()).resources).toEqual({});
    expect(mergeGrants(mergeResources(state, [resource]), [grant]).grants).toEqual({});
  });
});

describe('持久投影与暂态预览', () => {
  it('消费默认项目和目录关联事件，按 ID/version 保留 nullable 关联，不按名称认领', () => {
    const value = { id, version: 1, name: '日常', directory_resource_id: null };
    const saved = (kind: 'workspace.default_created' | 'workspace.directory_changed', version: number, position: string): StreamEvent => ({ kind: 'durable', event_id: position,
      event: { ...publicEvent, kind, event_id: position, run_id: null, session_id: null,
        payload: { ...value, version, directory_resource_id: version === 1 ? null : resource.id } } });
    let state = reduceStream(emptyProjection(), saved('workspace.default_created', 1, '20'));
    state = reduceStream(state, saved('workspace.directory_changed', 2, '21'));
    state = reduceStream(state, saved('workspace.directory_changed', 1, '22'));
    expect(Object.values(state.workspaces)).toEqual([{ ...value, version: 2, directory_resource_id: resource.id }]);
  });
  it('connection.saved 按版本合并，切工作区不丢全局连接', () => {
    const saved = (version: number): StreamEvent => ({ kind: 'durable', event_id: String(version),
      event: { ...publicEvent, kind: 'connection.saved', event_id: String(version), workspace_id: null,
        session_id: null, run_id: null, payload: { ...connection, version } } });
    let state = reduceStream(emptyProjection(), saved(2));
    state = reduceStream(state, saved(1));
    const snapshot: WorkspaceSnapshot = { workspace: { id, version: 1, name: '切换后的工作区', directory_resource_id: null },
      sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: '3' };
    expect(resetWorkspace(state, snapshot).connections[connection.id].version).toBe(2);
  });
  it('用 BigInt 水位与实体版本处理重复及乱序，而非按到达覆盖', () => {
    let state = started();
    state = reduceStream(state, durable('9007199254740992', { runs: [run(2, 'queued')] }));
    state = reduceStream(state, durable('9007199254740994', { runs: [run(4, 'completed')], messages: [{ id, activity_id: activityId, parts: [{ kind: 'text', text: '最终' }] }] }));
    state = reduceStream(state, durable('9007199254740994', { runs: [run(4, 'completed')], messages: [{ id, activity_id: activityId, parts: [{ kind: 'text', text: '最终' }] }] }));
    state = reduceStream(state, durable('9007199254740995', { runs: [run(3)] }));
    expect(state.runs[id].version).toBe(4);
    expect(state.runs[id].state).toBe('completed');
    expect(Object.keys(state.messages)).toEqual([id]);
    expect(state.cursor).toBe('9007199254740995');
  });
  it('delta 不推进游标，按 index 去重排序，持久消息替换预览', () => {
    let state = started();
    state = reduceStream(state, delta(1, 'B'));
    state = reduceStream(state, delta(0, 'A'));
    state = reduceStream(state, delta(0, 'A'));
    expect(Object.values(state.previews[activityId]).join('')).toBe('AB');
    expect(state.cursor).toBe('9007199254740993');
    state = reduceStream(state, durable('9007199254740994', { messages: [{ id, activity_id: activityId }] }));
    expect(state.previews[activityId]).toBeUndefined();
    expect(reduceStream(state, delta(2, 'late')).previews[activityId]).toBeUndefined();
  });
  it.each(['cancelled', 'completed', 'failed'] as const)('终态 %s 清理且围栏迟到 delta，旧版本不能复活', terminal => {
    let state = reduceStream(started(), delta(0, '旧文本'));
    expect(state.previews[activityId]).toEqual({ 0: '旧文本' });
    state = reduceStream(state, durable('9007199254740994', { runs: [run(4, terminal)] }, 'run.cancelled'));
    state = reduceStream(state, durable('9007199254740993', { runs: [run(3)] }));
    expect(reduceStream(state, delta(1, '迟到')).previews).toEqual({});
  });
  it('撤权清除受影响预览，保留用户历史，拒绝旧 activity delta', () => {
    let state = reduceStream(started(), delta(0, '旧文本'));
    expect(state.previews[activityId]).toEqual({ 0: '旧文本' });
    state = reduceStream(state, durable('9007199254740994', { grants: [{ id, version: 2, epoch: 2, status: 'revoked', scope: { kind: 'session', workspace_id: id, session_id: id }, resource_ids: [id] }] }, 'grant.revoked'));
    expect(reduceStream(state, delta(1, '迟到')).previews).toEqual({});
  });
  it('撤权后迟到的旧 Activity 不能绕过围栏；新授权的 Activity 不被旧 grant 永久封锁', () => {
    let state = reduceStream(emptyProjection(), durable('10', { runs: [run(3)] }));
    state = reduceStream(state, durable('12', { grants: [{ id, version: 2, epoch: 2, status: 'revoked', scope: { kind: 'session', workspace_id: id, session_id: id }, resource_ids: [id] }] }, 'grant.revoked'));
    state = reduceStream(state, durable('11', { activities: [activity()] }));
    expect(reduceStream(state, delta(0, 'late')).previews).toEqual({});
    const nextId = '00000000-0000-4000-8000-000000000003';
    state = reduceStream(state, durable('13', { activities: [{ ...activity(), id: nextId, dependencies: [] }] }));
    state = reduceStream(state, { kind: 'delta', activity_id: nextId, index: 0, text: 'new' });
    expect(state.previews[nextId]).toEqual({ 0: 'new' });
    state = reduceStream(state, durable('12', { grants: [{ id, version: 2, epoch: 2, status: 'revoked', scope: { kind: 'session', workspace_id: id, session_id: id }, resource_ids: [id] }] }, 'grant.revoked'));
    expect(state.previews[nextId]).toEqual({ 0: 'new' });
  });
  it('快照 reset 丢弃旧预览；迟到 RunDetail 不能覆盖更高版本', () => {
    const page = (items: unknown[]) => ({ items, next_cursor: null, watermark: '9007199254740994' });
    const snapshot = { workspace: { id, version: 1 }, sessions: page([]), active_runs: page([run(4, 'cancelled')]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: '9007199254740994' } as unknown as WorkspaceSnapshot;
    let state = resetWorkspace(emptyProjection(), snapshot);
    state = mergeRunDetail(state, { run: run(3), tasks: page([]), activities: page([activity()]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), budget: { id, version: 1 }, watermark: '9007199254740993' } as unknown as RunDetail);
    expect(state.cursor).toBe('9007199254740994');
    expect(state.runs[id].version).toBe(4);
    expect(reduceStream(state, delta(0, '旧')).previews).toEqual({});
  });
  it('active-only 快照已不含终态 Run 时，低于快照水位的查询/事件也不能重建旧预览', () => {
    const page = (items: unknown[]) => ({ items, next_cursor: null, watermark: '20' });
    const snapshot = { workspace: { id, version: 1 }, sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: '20' } as unknown as WorkspaceSnapshot;
    let state = resetWorkspace(emptyProjection(), snapshot);
    state = mergeRunDetail(state, { run: run(3), tasks: page([]), activities: page([activity()]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), budget: { id, version: 1 }, watermark: '19' } as unknown as RunDetail);
    state = reduceStream(state, durable('19', { runs: [run(3)], activities: [activity()] }));
    expect(state.runs).toEqual({});
    expect(reduceStream(state, delta(0, 'late')).previews).toEqual({});
  });
});

describe('RunDetail 权威摘要与乱序查询', () => {
  const detail = (watermark: string, version = 1): RunDetail => ({ ...runDetailSummary, run: { ...fullRun, version },
    tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]),
    consumptions: page([]), joins: page([]), budget: { id: fullRun.budget_id, version, run_id: id, limits, spent_units: '0', reserved_units: '0',
      model_requests: 1, steps: 1, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark });
  it('直接保留完整成本与最近 manifest 摘要，不从空的消息/Activity 首页推断费用或容量', () => {
    const current: RunDetail = { ...detail('30', 2), cost_summary: { ...runDetailSummary.cost_summary,
      calculated_units: '9007199254740993', unknown_request_count: 8, pending_request_count: 3 },
      context_usage: { ...contextUsage, activity_id: activityId, state: 'dispatched', omitted_group_count: 5, omitted_message_count: 12,
        reason_counts: { outside_run_scope: 2, capacity: 3 }, compaction_state: 'committed', summary_count: 2, compacted_message_count: 20 } };
    let state = mergeRunDetail(emptyProjection(), current);
    state = mergeRunDetail(state, detail('29', 2));
    state = mergeRunDetail(state, detail('30', 1));
    expect(state.runSummaries[id].cost_summary).toEqual(current.cost_summary);
    expect(state.runSummaries[id].context_usage).toEqual(current.context_usage);
    expect(state.cursor).toBe('0');
    state = applyDeletion(state, { scope: { kind: 'session', workspace_id: id, session_id: id }, epoch: 2, status: 'deleted' });
    expect(state.runSummaries[id]).toBeUndefined();
  });
});

describe('删除scope不可复活围栏', () => {
  const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
  function detail(suffix: number, workspace_id = id): RunDetail {
    const run = { ...fullRun, id: uuid(suffix), workspace_id, interaction_session_id: uuid(suffix + 1), execution_session_id: uuid(suffix + 1),
      root_task_id: uuid(suffix + 2), budget_id: uuid(suffix + 3), state: 'running' as const };
    const activity = { id: uuid(suffix + 4), version: 1, run_id: run.id, task_id: run.root_task_id,
      kind: 'model', operation: 'model', state: 'dispatched', error: null, usage: null, actual_units: null, dependencies: [] };
    const message = { id: uuid(suffix + 5), role: 'user', parts: [{ kind: 'text', text: `scope-content-${suffix}` }],
      activity_id: null, run_id: id, source_dependencies: [], private_ref: null, origin: 'conversation', event_id: '11', event_index: 0 };
    return { ...runDetailSummary, run, tasks: page([{ id: run.root_task_id, version: 1, run_id: run.id, kind: 'agent',
      executor_id: 'builtin.agent', state: 'running', created_seq: 1, parent_task_id: null, origin_task_id: null,
      deadline_at: null, result_version: null, reason: null }]), activities: page([activity]), messages: page([message]),
      artifacts: page([{ id: uuid(suffix + 6), version: 1, task_id: run.root_task_id, activity_id: activity.id,
        content_hash: 'a'.repeat(64), dependencies: [], media_type: 'text/plain' }]),
      questions: page([{ id: uuid(suffix + 7), version: 1, run_id: run.id, task_id: run.root_task_id }]),
      approvals: page([{ id: uuid(suffix + 8), version: 1, run_id: run.id, workspace_id, session_id: run.interaction_session_id! }]),
      waits: page([]), consumptions: page([]), joins: page([]),
      budget: { id: run.budget_id, version: 1, run_id: run.id, limits, spent_units: '0', reserved_units: '0',
        model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: '11' } as unknown as RunDetail;
  }
  function snapshot(details: RunDetail[], watermark = '10'): WorkspaceSnapshot {
    return { workspace: { id: details[0].run.workspace_id, version: 1, name: '工作区', directory_resource_id: null },
      sessions: page(details.map(({ run }) => ({ id: run.interaction_session_id!, version: 1, workspace_id: run.workspace_id,
        title: '会话', agent_profile_id: id, kind: 'interaction' as const, archived: false }))), active_runs: page(details.map(item => item.run)),
      pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark };
  }
  function lifecycle(scope: { workspace_id: string; session_id: string | null }, epoch = 2,
                     kind: 'scope.deleted' | 'scope.revoked' = 'scope.deleted'): StreamEvent {
    const status = kind === 'scope.deleted' ? 'deleted' : 'revoked';
    return { kind: 'durable', event_id: '20', event: { ...publicEvent, kind, event_id: '20', workspace_id: scope.workspace_id,
      session_id: scope.session_id, run_id: null, seq: null, payload: {
        scopes: [{ id: scope.session_id ?? scope.workspace_id, scope: { ...scope, kind: scope.session_id === null ? 'workspace' : 'session' }, epoch, status }],
        deletions: status === 'deleted' ? [{ scope: { ...scope, kind: scope.session_id === null ? 'workspace' : 'session' }, epoch, status }] : [],
      } } };
  }
  function late(details: RunDetail): StreamEvent {
    return { kind: 'durable', event_id: '21', event: { ...publicEvent, kind: 'task.stepped', event_id: '21',
      workspace_id: details.run.workspace_id, session_id: details.run.interaction_session_id!, run_id: details.run.id,
      payload: { runs: [{ ...details.run, version: 99 }], tasks: details.tasks.items, activities: details.activities.items,
        messages: details.messages.items, artifacts: details.artifacts.items, questions: details.questions.items,
        budgets: [details.budget], waits: [], consumptions: [], joins: [], pending_commands: [], follow_up_intents: [] } } };
  }
  function installed(details: RunDetail[]) {
    return details.reduce(mergeRunDetail, resetWorkspace(emptyProjection(), snapshot(details)));
  }
  it('删除一个session清空内容、预览及历史归属索引，另一session完整保留', () => {
    const first = detail(100), other = detail(200);
    let state = installed([first, other]);
    for (const item of [first, other]) state = reduceStream(state, { kind: 'delta',
      activity_id: item.activities.items[0].id, index: 0, text: '预览' });
    state = reduceStream(state, lifecycle({ workspace_id: id, session_id: first.run.interaction_session_id! }));
    for (const [kind, removed, kept] of [
      ['runs', first.run.id, other.run.id], ['tasks', first.run.root_task_id, other.run.root_task_id],
      ['activities', first.activities.items[0].id, other.activities.items[0].id], ['budgets', first.budget.id, other.budget.id],
      ['messages', first.messages.items[0].id, other.messages.items[0].id], ['artifacts', first.artifacts.items[0].id, other.artifacts.items[0].id],
      ['questions', first.questions.items[0].id, other.questions.items[0].id], ['approvals', first.approvals.items[0].id, other.approvals.items[0].id],
    ] as const) {
      expect(state[kind][removed]).toBeUndefined();
      expect(state[kind][kept]).toBeDefined();
    }
    expect(state.sessions[first.run.interaction_session_id!]).toBeUndefined();
    expect(state.messageSessions[first.messages.items[0].id]).toBeUndefined();
    expect(state.entityScopes[first.messages.items[0].id]).toBeUndefined();
    expect(state.fencedActivities[first.activities.items[0].id]).toBeUndefined();
    expect(state.previews[first.activities.items[0].id]).toBeUndefined();
    expect(state.previews[other.activities.items[0].id]).toEqual({ 0: '预览' });
    expect(state.deletedSessions[first.run.interaction_session_id!]).toBe(2);
  });
  it('更高event/version的迟到durable、RunDetail、RunSnapshot及消息也不能重建已删session', () => {
    const first = detail(100);
    let state = reduceStream(installed([first]), lifecycle({ workspace_id: id, session_id: first.run.interaction_session_id! }));
    state = reduceStream(state, late(first));
    state = mergeRunDetail(state, { ...first, watermark: '99' });
    state = mergeRunSnapshot(state, { ...first.run, version: 100 });
    state = mergeMessages(state, first.run.interaction_session_id!, first.messages.items);
    state = reduceStream(state, { kind: 'delta', activity_id: first.activities.items[0].id, index: 1, text: '迟到' });
    expect(state.runs).toEqual({});
    expect(state.messages).toEqual({});
    expect(state.activities).toEqual({});
    expect(state.previews).toEqual({});
    expect(state.cursor).toBe('21');
  });
  it('resetWorkspace保留删除tombstone，旧快照及随后消息不能恢复已删session', () => {
    const first = detail(100), other = detail(200);
    let state = reduceStream(installed([first, other]), lifecycle({ workspace_id: id, session_id: first.run.interaction_session_id! }));
    state = resetWorkspace(state, snapshot([first, other], '99'));
    state = mergeMessages(state, first.run.interaction_session_id!, first.messages.items);
    expect(state.sessions[first.run.interaction_session_id!]).toBeUndefined();
    expect(state.runs[first.run.id]).toBeUndefined();
    expect(state.messages).toEqual({});
    expect(state.runs[other.run.id]).toBeDefined();
    expect(state.deletedSessions[first.run.interaction_session_id!]).toBe(2);
  });
  it('workspace删除在跨workspace重置后仍围栏旧快照，而不删除另一workspace', () => {
    const first = detail(100), other = detail(200, uuid(900));
    let state = installed([first]);
    state = mergeRunDetail(state, other);
    state = reduceStream(state, lifecycle({ workspace_id: id, session_id: null }));
    expect(state.runs[first.run.id]).toBeUndefined();
    expect(state.runs[other.run.id]).toBeDefined();
    state = resetWorkspace(state, snapshot([other], '21'));
    state = resetWorkspace(state, snapshot([first], '99'));
    state = mergeMessages(state, first.run.interaction_session_id!, first.messages.items);
    expect(state.runs[other.run.id]).toBeDefined();
    expect(state.workspaces[id]).toBeUndefined();
    expect(state.messages[first.messages.items[0].id]).toBeUndefined();
    expect(state.deletedWorkspaces[id]).toBe(2);
  });
  it('首个Run前删除的scope仍能拒绝迟到实体，重复旧epoch不降低tombstone', () => {
    const first = detail(100), scope = { workspace_id: id, session_id: first.run.interaction_session_id! };
    let state = reduceStream(emptyProjection(), lifecycle(scope, 3));
    state = reduceStream(state, lifecycle(scope, 2));
    state = reduceStream(state, late(first));
    state = mergeMessages(state, first.run.interaction_session_id!, first.messages.items);
    expect(state.deletedSessions[first.run.interaction_session_id!]).toBe(3);
    expect(state.runs).toEqual({});
    expect(state.messages).toEqual({});
  });
  it('scope.revoked只清除受影响预览，用户历史保留', () => {
    const first = detail(100);
    let state = reduceStream(installed([first]), { kind: 'delta', activity_id: first.activities.items[0].id, index: 0, text: '预览' });
    state = reduceStream(state, lifecycle({ workspace_id: id, session_id: first.run.interaction_session_id! }, 2, 'scope.revoked'));
    expect(state.messages[first.messages.items[0].id]).toBeDefined();
    expect(state.runs[first.run.id]).toBeDefined();
    expect(state.previews).toEqual({});
    expect(reduceStream(state, { kind: 'delta', activity_id: first.activities.items[0].id, index: 1, text: '迟到' }).previews).toEqual({});
  });
  it('归属索引只保留scope身份，不复制运行配置或内容', () => {
    const first = detail(100);
    const state = installed([first]);
    expect(state.entityScopes[first.run.id]).toEqual({ workspace_id: id, session_id: first.run.interaction_session_id! });
    expect(state.entityScopes[first.messages.items[0].id]).toEqual({ workspace_id: id, session_id: first.run.interaction_session_id! });
  });
  it('其它workspace快照水位已经越过删除事件时仍记录tombstone，拒绝旧workspace快照', () => {
    const first = detail(100), other = detail(200, uuid(900));
    let state = resetWorkspace(emptyProjection(), snapshot([other], '100'));
    state = reduceStream(state, lifecycle({ workspace_id: id, session_id: null }));
    state = resetWorkspace(state, snapshot([first], '19'));
    expect(state.deletedWorkspaces[id]).toBe(2);
    expect(state.workspaces[id]).toBeUndefined();
    expect(state.runs[other.run.id]).toBeDefined();
  });
  it('只有Activity先于Run到达时，也按事件归属清除已删除scope的孤立实体', () => {
    const first = detail(100);
    const event = late(first);
    if (event.kind !== 'durable' || !('runs' in event.event.payload)) throw new Error('测试事件类别错误');
    event.event.payload.runs = [];
    let state = reduceStream(emptyProjection(), event);
    state = reduceStream(state, lifecycle({ workspace_id: id, session_id: first.run.interaction_session_id! }));
    expect(state.activities).toEqual({});
    expect(state.artifacts).toEqual({});
    expect(state.entityScopes).toEqual({});
  });
  it('迟到Snapshot中缺少Run归属的待办不重建；随后活跃scope的真实RunDetail仍可补齐', () => {
    const first = detail(100), other = detail(200);
    let state = reduceStream(emptyProjection(), lifecycle({ workspace_id: id, session_id: first.run.interaction_session_id! }));
    const stale = snapshot([first, other], '19');
    stale.active_runs.items = [];
    stale.pending_questions.items = [first.questions.items[0], other.questions.items[0]];
    state = resetWorkspace(state, stale);
    expect(state.questions).toEqual({});
    state = mergeRunDetail(state, { ...other, watermark: '21' });
    expect(state.questions[other.questions.items[0].id]).toBeDefined();
    expect(state.questions[first.questions.items[0].id]).toBeUndefined();
  });
  it('页面/创建/decision/grant响应共用scope合并边界，不能在删除后重建实体', () => {
    const first = detail(100), other = detail(200);
    let state = reduceStream(installed([first, other]), lifecycle({ workspace_id: id, session_id: first.run.interaction_session_id! }));
    state = mergeSessions(state, snapshot([first, other]).sessions.items);
    state = mergeQuestions(state, [...first.questions.items, ...other.questions.items]);
    state = mergeApprovals(state, [...first.approvals.items, ...other.approvals.items]);
    const resources = [first, other].map(item => ({ id: item.run.interaction_session_id!, version: 1,
      scope: { kind: 'session' as const, workspace_id: id, session_id: item.run.interaction_session_id! }, label: '资料', kind: 'file' as const, source_version: null }));
    state = mergeResources(state, resources);
    state = mergeGrants(state, resources.map(resource => ({ id: resource.id, version: 1, epoch: 1, status: 'active' as const,
      scope: resource.scope, resource_ids: [resource.id] as [string], memory_scopes: [], mcp_versions: {}, mcp_queries: [], purposes: ['read'], destination: null })));
    for (const kind of ['sessions', 'resources', 'grants'] as const) {
      expect(state[kind][first.run.interaction_session_id!]).toBeUndefined();
      expect(state[kind][other.run.interaction_session_id!]).toBeDefined();
    }
    expect(state.questions[first.questions.items[0].id]).toBeUndefined();
    expect(state.approvals[first.approvals.items[0].id]).toBeUndefined();
    expect(state.questions[other.questions.items[0].id]).toBeDefined();
    expect(state.approvals[other.approvals.items[0].id]).toBeDefined();
    state = reduceStream(state, lifecycle({ workspace_id: id, session_id: null }));
    state = mergeWorkspaces(state, [{ id, version: 100, name: '迟到工作区', directory_resource_id: null }]);
    state = mergeSessions(state, snapshot([first, other]).sessions.items);
    expect(state.workspaces[id]).toBeUndefined();
    expect(state.sessions).toEqual({});
  });
});

describe('fetch SSE parser', () => {
  it('解析任意 UTF-8/CRLF 分片、多行 data 与注释，不信任 SSE id 推进游标', async () => {
    const bytes = new TextEncoder().encode(': heartbeat\r\nid: 99\r\ndata: {"kind":"delta",\r\ndata: "text":"中文"}\r\n\r\ndata: {"n":2}\n\n');
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    const result = [];
    for await (const event of readSse(body, new AbortController().signal)) result.push(event);
    expect(result).toEqual([{ kind: 'delta', text: '中文' }, { n: 2 }]);
  });
  it('AbortSignal 取消待读流，不把断线当作重新提交命令', async () => {
    let cancelled = false;
    const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const reading = readSse(body, abort.signal).next();
    abort.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
  });
  it('处理 CR 行终止符及 EOF，不发布缺少空行的未完成帧', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"n":1}\r\rdata: {"n":2}\n')); controller.close(); } });
    const result = [];
    for await (const event of readSse(body, new AbortController().signal)) result.push(event);
    expect(result).toEqual([{ n: 1 }]);
    const finalCR = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"n":3}\r\r')); controller.close(); } });
    const end = [];
    for await (const event of readSse(finalCR, new AbortController().signal)) end.push(event);
    expect(end).toEqual([{ n: 3 }]);
  });
});

describe('会话消息的服务端顺序', () => {
  const historyProjection = () => ({ ...emptyProjection(), sessions: { [id]: {
    id, version: 1, workspace_id: id, title: '会话', agent_profile_id: id, kind: 'interaction' as const, archived: false,
  } } });
  const message = (suffix: number, role: ModelMessage['role'], event_id: string, event_index: number): ModelMessage => ({
    id: `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`, role, parts: [{ kind: 'text', text: `${role}-${suffix}` }],
    activity_id: null, run_id: id, source_dependencies: [], private_ref: null, origin: 'conversation', event_id, event_index,
  });
  const olderUser = message(3, 'user', '9007199254740990', 0);
  const olderAssistant = message(4, 'assistant', '9007199254740991', 0);
  const currentUser = message(5, 'user', '9007199254740993', 0);
  const currentAssistant = message(6, 'assistant', '9007199254740994', 0);
  function messagesEvent(event_id: string, seq: number, messages: ModelMessage[]): StreamEvent {
    return { kind: 'durable', event_id, event: { ...publicEvent, kind: 'task.stepped', event_id, seq,
      payload: { runs: [], tasks: [], activities: [], budgets: [], messages, artifacts: [], questions: [], waits: [], consumptions: [], joins: [], pending_commands: [], follow_up_intents: [] } } };
  }
  function detail(messages: ModelMessage[], watermark: string): RunDetail {
    const empty = { ...page([]), watermark };
    return { ...runDetailSummary, run: fullRun, tasks: empty, activities: empty, messages: { ...page(messages), watermark }, artifacts: empty, questions: empty, approvals: empty, waits: empty, consumptions: empty, joins: empty,
      budget: { id, version: 1, run_id: id, limits, spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark };
  }
  it('正常 user → assistant 的提交不因 object spread 反序', () => {
    let state = reduceStream(emptyProjection(), messagesEvent('9007199254740993', 1, [currentUser]));
    state = reduceStream(state, messagesEvent('9007199254740994', 2, [currentAssistant]));
    expect(orderedMessageIds(state, id)).toEqual([currentUser.id, currentAssistant.id]);
  });
  it('乱序 durable 与重复投递仍按服务顺序，而不是到达顺序', () => {
    let state = reduceStream(emptyProjection(), messagesEvent('9007199254740995', 3, [currentUser, currentAssistant]));
    state = reduceStream(state, messagesEvent('9007199254740993', 1, [olderUser]));
    state = reduceStream(state, messagesEvent('9007199254740994', 2, [olderAssistant]));
    state = reduceStream(state, messagesEvent('9007199254740995', 3, [currentUser, currentAssistant]));
    expect(orderedMessageIds(state, id)).toEqual([olderUser.id, olderAssistant.id, currentUser.id, currentAssistant.id]);
  });
  it('有序历史分页与实时消息接缝保序，旧 RunDetail/重复查询不能把当前 Run 移到历史前', () => {
    let state = mergeMessages(historyProjection(), id, [olderUser]);
    state = reduceStream(state, messagesEvent('9007199254740995', 3, [currentAssistant]));
    state = reduceStream(state, messagesEvent('9007199254740994', 2, [currentUser]));
    state = mergeMessages(state, id, [olderAssistant, currentUser]);
    state = mergeRunDetail(state, detail([currentUser], '9007199254740994'));
    state = mergeMessages(state, id, [olderUser]);
    expect(orderedMessageIds(state, id)).toEqual([olderUser.id, olderAssistant.id, currentUser.id, currentAssistant.id]);
  });
  it('同一事件内按 event_index 排序；无交集查询的读水位不能冒充消息创建位置', () => {
    const first = message(7, 'assistant', '9007199254740995', 0);
    const second = message(8, 'tool', '9007199254740995', 1);
    let state = mergeMessages(historyProjection(), id, [second]);
    state = mergeRunDetail(state, detail([first], '9007199254740999'));
    state = mergeMessages(state, id, [olderUser, olderAssistant]);
    state = mergeMessages(state, id, [second]);
    expect(orderedMessageIds(state, id)).toEqual([olderUser.id, olderAssistant.id, first.id, second.id]);
  });
});
