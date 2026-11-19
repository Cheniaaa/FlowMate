import { afterEach, expect, it, vi } from 'vitest';
import { commandMeta, RuntimeClient } from '../api/client';
import { createRuntimeStore } from './runtime-store';
import { mergeSessions } from '../api/events';
import { event, followUpIntent, id, page, pendingUserCommand, run, runDetailSummary, limits, secondId } from '../test/fixtures';
import type { FollowUpIntent, PendingUserCommand } from '../generated/contracts';

afterEach(() => vi.unstubAllGlobals());
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
const detail = { ...runDetailSummary, run, budget: { id: run.budget_id, run_id: run.id, version: 1, limits,
  spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 },
  tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]),
  waits: page([]), consumptions: page([]), joins: page([]), watermark: event.event_id };

it('enqueue丢响应后按原command_id核对当前applied，冻结参数并按真实Run查询同步', async () => {
  const requests: { path: string; body: any }[] = [];
  const meta = commandMeta(), { session_id: _, ...data } = pendingUserCommand.start;
  const receipt = { ...pendingUserCommand, command_id: meta.command_id!, state: 'applied', run_id: run.id };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname; requests.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
    if (init.method === 'POST') throw new TypeError('lost');
    if (path.includes('/commands/')) return Response.json({ status: 'confirmed', result: receipt });
    if (path.endsWith('/commands')) return Response.json(page([receipt]));
    if (path.endsWith('/follow-ups')) return Response.json(page([]));
    if (path === `/v3/runs/${id}`) return Response.json(detail);
    throw new Error(`未定义 ${path}`);
  });
  const store = createRuntimeStore(client());
  expect((await store.dispatch({ type: 'enqueueUser', args: [id, { meta, data }] })).status).toBe('unconfirmed');
  data.text = '后来的编辑';
  expect((await store.check(meta.command_id!, id)).status).toBe('confirmed');
  expect(store.getSnapshot().pendingUserCommands[meta.command_id!].state).toBe('applied');
  expect(store.getSnapshot().runs[id].budget_group_id).toBe(run.budget_group_id);
  expect(requests.filter(request => request.body)).toHaveLength(1);
  expect(requests[0].path).toBe(`/v3/sessions/${id}/commands`);
  expect(requests[0].body.data.text).toBe('新的用户目标');
  expect(requests.some(request => request.path.endsWith(`/commands/${meta.command_id}`))).toBe(true);
});

it('接收queued只确认持久保存；查询按opaque cursor读取所有页，不把查询水位推进SSE游标', async () => {
  const meta = commandMeta(), { session_id: _, ...data } = pendingUserCommand.start;
  const receipt = { ...pendingUserCommand, command_id: meta.command_id! };
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const value = new URL(url); paths.push(value.pathname + value.search);
    if (init.method === 'POST') return Response.json(receipt);
    if (value.pathname.endsWith('/commands')) return Response.json(value.searchParams.has('cursor') ? page([receipt])
      : { ...page([]), next_cursor: 'opaque+cursor' });
    throw new Error(`未定义 ${url}`);
  });
  const store = createRuntimeStore(client());
  expect(await store.dispatch({ type: 'enqueueUser', args: [id, { meta, data }] })).toEqual({ status: 'confirmed', sync: 'ready', commandId: meta.command_id });
  expect(store.getSnapshot().pendingUserCommands[meta.command_id!].state).toBe('queued');
  expect(store.getSnapshot().runs).toEqual({});
  expect(store.getSnapshot().cursor).toBe('0');
  expect(paths.some(path => path.includes('cursor=opaque%2Bcursor'))).toBe(true);
});

it('没有run_id或Run载荷的applied事件也查询真实新Run；重连重读当前队列和意图', async () => {
  const runtime = client(), store = createRuntimeStore(runtime);
  const session = { id, workspace_id: id, version: 1, title: '会话', kind: 'interaction' as const, archived: false, agent_profile_id: id };
  const snapshot = { workspace: { id, version: 1, name: '项目', directory_resource_id: null },
    sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]),
    resources: page([]), grants: page([]), watermark: event.event_id };
  const current = { ...pendingUserCommand, state: 'applied' as const, run_id: id };
  let values: PendingUserCommand[] = [pendingUserCommand], intents: FollowUpIntent[] = [followUpIntent];
  let watermark = event.event_id;
  vi.spyOn(runtime, 'workspaceSnapshot').mockResolvedValue(snapshot);
  vi.spyOn(runtime, 'pendingUserCommands').mockImplementation(async () => ({ ...page(values), watermark }));
  vi.spyOn(runtime, 'followUpIntents').mockImplementation(async () => ({ ...page(intents), watermark }));
  vi.spyOn(runtime, 'run').mockResolvedValue(detail);
  store.update(state => mergeSessions(state, [session]));
  await store.refreshSessionWork(id);
  vi.spyOn(runtime, 'watchWorkspace').mockImplementation(async (_id, _after, handlers) => {
    await handlers.connection?.('connected');
    values = [current];
    const position = (BigInt(event.event_id) + 1n).toString();
    await handlers.event({ kind: 'durable', event_id: position, event: { ...event, kind: 'command.applied', run_id: null,
      event_id: position, payload: { ...event.payload, runs: [], pending_commands: [current] } } });
    expect(store.getSnapshot().runs[id]?.kind).toBe('user');
    await handlers.connection?.('reconnecting');
    values = [current, { ...pendingUserCommand, command_id: secondId, state: 'cancelled', reason: 'session_archived' }];
    intents = [{ ...followUpIntent, status: 'closed', reason: 'session_archived' }];
    watermark = (BigInt(position) + 1n).toString();
    await handlers.connection?.('connected');
  });
  await store.loadWorkspace(id, { snapshot: () => {}, event: () => {} }, new AbortController().signal);
  expect(store.getSnapshot().pendingUserCommands[pendingUserCommand.command_id].state).toBe('applied');
  expect(store.getSnapshot().pendingUserCommands[secondId].reason).toBe('session_archived');
  expect(store.getSnapshot().followUpIntents[followUpIntent.id].status).toBe('closed');
});
