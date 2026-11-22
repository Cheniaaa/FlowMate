import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import App from '../../App';
import { agent, binding, connection, event, id, limits, model, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import type { RunDetail, TracePage } from '../../generated/contracts';
import type { WorkbenchRequest } from '../../api/windows';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const workspace = { id, version: 1, name: 'Trace 分页项目', directory_resource_id: null };
const session = { id, version: 1, workspace_id: id, title: 'Trace 分页会话', agent_profile_id: id, kind: 'interaction', archived: false };
const taskIds: Record<string, string> = { [id]: '00000000-0000-4000-8000-000000000030', [secondId]: '00000000-0000-4000-8000-000000000031' };
const freshWatermark = String(BigInt(event.event_id) + 1n);
const traceRows = (first: number, last: number, owner = 'A') => Array.from({ length: last - first + 1 }, (_, offset) => ({
  event_id: String(BigInt(event.event_id) - 102n + BigInt(first + offset)), seq: first + offset,
  kind: `${owner}事件${first + offset}`, task_id: null, activity_id: null, activities: [],
}));
const tracePage = (first: number, last: number, next: string | null, fresh = false, owner = 'A'): TracePage => ({
  ...page(traceRows(first, last, owner)), next_cursor: next, watermark: fresh ? freshWatermark : event.event_id,
});

function server(readTrace: (runId: string, cursor: string | null) => TracePage | Promise<TracePage>) {
  const callbacks = new Map<string, EventCallback<null>>();
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const requests: { runId: string; cursor: string | null }[] = [];
  let navigation: WorkbenchRequest | null = null;
  const root = (runId: string) => ({ id: taskIds[runId], version: 1, run_id: runId, binding,
    parent_task_id: null, origin_task_id: null, kind: 'agent' as const, executor_id: 'builtin.agent',
    state: 'completed' as const, created_seq: 1, deadline_at: null, result_version: 1, reason: null });
  const detail = (runId: string): RunDetail => ({
    ...runDetailSummary, run: { ...run, id: runId, root_task_id: taskIds[runId], kind: 'managed', state: 'completed' },
    tasks: page([root(runId)]), activities: page([]), messages: page([]), artifacts: page([]), questions: page([]),
    approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
    budget: { id: run.budget_id, run_id: runId, version: 1, limits, spent_units: '0', reserved_units: '0',
      model_requests: 0, task_count: 1, steps: 0, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id,
  });
  vi.mocked(listen).mockImplementation(async (name, callback) => { callbacks.set(name, callback); return () => {}; });
  vi.mocked(invoke).mockImplementation(async name => {
    if (name === 'runtime_connection') return { base_url: 'http://127.0.0.1:54321', token: 'synthetic-trace', protocol_version: 4 };
    if (name === 'take_workbench_navigation') { const value = navigation; navigation = null; return value; }
    if (name === 'take_settings_navigation' || name === 'pending_counts') return null;
    throw new Error(`未定义合成 IPC ${name}`);
  });
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input), path = url.pathname.replace('/v4', '');
    const trace = path.match(/^\/runs\/([^/]+)\/trace$/);
    if (trace) {
      const cursor = url.searchParams.get('cursor'); requests.push({ runId: trace[1], cursor });
      expect(url.searchParams.get('limit')).toBe('50');
      return Response.json(await readTrace(trace[1], cursor));
    }
    if (path.endsWith('/events')) {
      let active: ReadableStreamDefaultController<Uint8Array>;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { active = controller; streams.add(controller); }, cancel() { streams.delete(active); } }));
    }
    if (path === '/navigation') return Response.json({ default_workspace_id: id,
      workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path === '/workspaces') return Response.json(page([workspace]));
    if (path === '/profiles') return Response.json(page([{ ...agent, default_model_profile_id: model.id }]));
    if (path === '/models') return Response.json(page([model]));
    if (path === '/model-connections') return Response.json(page([connection]));
    if (path.endsWith('/snapshot')) return Response.json({ workspace, sessions: page([session]), active_runs: page([]),
      pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id });
    if (path.endsWith('/directory')) return Response.json({ workspace_id: id, workspace_version: 1, state: 'unlinked', reason: null, resource: null });
    if (path === `/sessions/${id}`) return Response.json(session);
    const task = Object.entries(taskIds).find(([, taskId]) => path === `/tasks/${taskId}`);
    if (task) return Response.json(root(task[0]));
    const runMatch = path.match(/^\/runs\/([^/]+)$/);
    if (runMatch) return Response.json(detail(runMatch[1]));
    if (path.endsWith('/export-recovery')) return Response.json([]);
    if (['/commands', '/follow-ups', '/messages', '/runs', '/results', '/run-feedback'].some(suffix => path.endsWith(suffix))) return Response.json(page([]));
    throw new Error(`未定义合成 HTTP ${path}`);
  });
  return {
    requests,
    async navigate(runId: string) {
      navigation = { target: { kind: 'task', task_id: taskIds[runId] }, from_quick: false };
      await act(async () => callbacks.get('workbench-navigation')!({ id: 1, event: 'workbench-navigation', payload: null }));
      await screen.findByRole('heading', { name: '任务详情' });
    },
    async refreshEvent() {
      const wire = { kind: 'durable', event_id: freshWatermark, event: { ...event, kind: 'task.stepped', event_id: freshWatermark,
        payload: { ...event.payload, runs: [detail(id).run] } } };
      await act(async () => { for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`)); });
    },
  };
}

it.each([
  ['续页先发', '按钮'], ['刷新先发', '按钮'], ['续页先发', '事件'], ['刷新先发', '事件'],
] as const)('正常 App Trace：%s/%s，旧响应不丢新上界，恢复已读深度后第52及102条可达', async (order, trigger) => {
  const oldTail = deferred<TracePage>(), freshHead = deferred<TracePage>();
  const headStarted = deferred<void>(), tailStarted = deferred<void>();
  let fresh = false;
  const fixture = server((_runId, cursor) => {
    if (cursor === 'old-tail') { tailStarted.resolve(); return oldTail.promise; }
    if (cursor === 'new-tail') return tracePage(51, 100, 'new-more', true);
    if (cursor === 'new-more') return tracePage(101, 102, null, true);
    if (fresh) { headStarted.resolve(); return freshHead.promise; }
    return tracePage(1, 50, 'old-tail');
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: session.title });
  await fixture.navigate(id);
  await user.click(screen.getByRole('button', { name: '原始 Trace' }));
  const trace = await screen.findByRole('region', { name: '公开事件' });
  await waitFor(() => expect(within(trace).getAllByRole('article')).toHaveLength(50));
  async function refresh() {
    fresh = true;
    if (trigger === '按钮') await user.click(screen.getByRole('button', { name: '刷新详情' }));
    else await fixture.refreshEvent();
  }
  if (order === '续页先发') {
    await user.click(screen.getByRole('button', { name: '加载更多事件' }));
    await tailStarted.promise;
    await refresh();
  } else {
    await refresh();
    await headStarted.promise;
    await user.click(screen.getByRole('button', { name: '加载更多事件' }));
  }
  // 新首页先就绪，旧上界的尾页随后到达。串行实现可以延后发起新首页。
  await act(async () => freshHead.resolve(tracePage(1, 50, 'new-tail', true)));
  await act(async () => oldTail.resolve(tracePage(51, 51, null)));
  await within(trace).findByText('A事件52');
  await waitFor(() => expect(within(trace).getAllByRole('article')).toHaveLength(100));
  expect(fixture.requests.filter(request => request.cursor === 'old-tail')).toHaveLength(order === '续页先发' ? 1 : 0);
  expect(screen.getByRole('button', { name: '加载更多事件' })).toHaveProperty('disabled', false);
  await user.click(screen.getByRole('button', { name: '刷新详情' }));
  await waitFor(() => expect(fixture.requests.filter(request => request.cursor === 'new-tail')).toHaveLength(2));
  expect(within(trace).getAllByRole('article')).toHaveLength(100);
  await user.click(screen.getByRole('button', { name: '加载更多事件' }));
  await within(trace).findByText('A事件102');
  expect(within(trace).getAllByRole('article')).toHaveLength(102);
  expect(screen.queryByRole('button', { name: '加载更多事件' })).toBeNull();
  expect(fixture.requests.at(-1)?.cursor).toBe('new-more');
});

it.each(['续页', '刷新'] as const)('正常 App 切换后台任务时隔离原 Run 在途%s、排队刷新及已读深度', async pending => {
  const oldReply = deferred<TracePage>(), oldStarted = deferred<void>();
  let stale = false;
  const fixture = server((runId, cursor) => {
    if (runId === secondId) return cursor === 'b-tail' ? tracePage(51, 51, null, false, 'B') : tracePage(1, 50, 'b-tail', false, 'B');
    if (stale && (pending === '续页' ? cursor === 'old-tail' : !cursor)) { oldStarted.resolve(); return oldReply.promise; }
    return cursor ? tracePage(51, 51, null) : tracePage(1, 50, 'old-tail');
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: session.title });
  await fixture.navigate(id);
  await user.click(screen.getByRole('button', { name: '原始 Trace' }));
  await screen.findByText('A事件50');
  if (pending === '刷新') {
    await user.click(screen.getByRole('button', { name: '加载更多事件' }));
    await screen.findByText('A事件51');
  }
  stale = true;
  await user.click(screen.getByRole('button', { name: pending === '续页' ? '加载更多事件' : '刷新详情' }));
  await oldStarted.promise;
  await user.click(screen.getByRole('button', { name: '刷新详情' }));
  const oldHeadCount = fixture.requests.filter(request => request.runId === id && !request.cursor).length;
  await fixture.navigate(secondId);
  await user.click(screen.getByRole('button', { name: '原始 Trace' }));
  await screen.findByText('B事件50');
  await user.click(screen.getByRole('button', { name: '加载更多事件' }));
  await screen.findByText('B事件51');
  await act(async () => oldReply.resolve(tracePage(51, 51, 'stale-only-cursor')));
  expect(screen.queryByText('A事件51')).toBeNull();
  expect(screen.queryByRole('button', { name: '加载更多事件' })).toBeNull();
  expect(fixture.requests.filter(request => request.runId === id && !request.cursor)).toHaveLength(oldHeadCount);
  stale = false;
  await fixture.navigate(id);
  await user.click(screen.getByRole('button', { name: '原始 Trace' }));
  await screen.findByText('A事件50');
  expect(screen.queryByText('A事件51')).toBeNull();
  expect(screen.getByRole('button', { name: '加载更多事件' })).toHaveProperty('disabled', false);
});
