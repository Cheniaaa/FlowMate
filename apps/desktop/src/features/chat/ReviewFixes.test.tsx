import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { RuntimeClient } from '../../api/client';
import { expectComposerModel } from '../../test/composer-model';
import { agent, binding, connection, event, grant, id, limits, model, page, resultEntry, run, runDetailSummary, secondId } from '../../test/fixtures';
import type { ModelMessage, ModelProfilePage, RunDetail, RunSnapshot, SessionResultPage, StreamEvent, TaskResult } from '../../generated/contracts';
import type { SettingsNavigation, WorkbenchRequest } from '../../api/windows';
import { Conversation } from './Conversation';
import WorkbenchWindow from '../../windows/WorkbenchWindow';
import TaskDetail from '../tasks/TaskDetail';
import { createRuntimeStore } from '../../state/runtime-store';
import App from '../../App';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks(); localStorage.clear(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const runtime = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 });
const workspace = { id, version: 1, name: '复核项目', directory_resource_id: null };
const session = { id, version: 1, workspace_id: id, title: '复核会话', agent_profile_id: id, kind: 'interaction' as const, archived: false };
const snapshot = { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([grant]), watermark: event.event_id };
const taskDetail: RunDetail = { ...runDetailSummary, run: { ...run, kind: 'managed', state: 'completed' }, tasks: page([]), activities: page([]), artifacts: page([]),
  messages: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
  budget: { id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id };
function shellServer(override: (path: string, parsed: URL, init: RequestInit) => unknown | Promise<unknown>) {
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const callbacks = new Map<string, EventCallback<null>>();
  let request: WorkbenchRequest | null = null;
  let settingsRequest: SettingsNavigation | null = null;
  vi.mocked(invoke).mockImplementation(async name => {
    if (name === 'runtime_connection') return { base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 };
    if (name === 'take_workbench_navigation') { const target = request; request = null; return target; }
    if (name === 'take_settings_navigation') { const target = settingsRequest; settingsRequest = null; return target; }
    if (name === 'pending_counts') return null;
    return { configured: true };
  });
  vi.mocked(listen).mockImplementation(async (name, callback) => { callbacks.set(name, callback); return () => {}; });
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const parsed = new URL(input), path = parsed.pathname.replace('/v4', '');
    const value = await override(path, parsed, init);
    if (value !== undefined) return value instanceof Response ? value : Response.json(value);
    if (path.endsWith('/events')) {
      let active: ReadableStreamDefaultController<Uint8Array>;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { active = controller; streams.add(controller); }, cancel() { streams.delete(active); } }));
    }
    if (path === '/navigation') return Response.json({ default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path === '/workspaces') return Response.json(page([workspace]));
    if (path === '/profiles') return Response.json(page([{ ...agent, default_model_profile_id: model.id }]));
    if (path === '/models') return Response.json(page([model]));
    if (path === '/model-connections') return Response.json(page([connection]));
    if (path === '/provider-presets' || path === '/tools' || path.endsWith('/export-recovery')) return Response.json([]);
    if (path.endsWith('/snapshot')) return Response.json(snapshot);
    if (path.endsWith('/directory')) return Response.json({ workspace_id: id, workspace_version: 1, state: 'unlinked', reason: null, resource: null });
    if (path === `/sessions/${id}`) return Response.json(session);
    if (path === `/runs/${id}`) return Response.json(taskDetail);
    if (path.endsWith('/run-feedback')) return Response.json(page([]));
    if (path === '/tasks' || path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/messages') || path.endsWith('/runs') || path.endsWith('/results')) return Response.json(page([]));
    throw new Error(`未定义的合成路由 ${path}`);
  });
  return {
    async emit(wire: StreamEvent) { await act(async () => { for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`)); }); },
    async navigate(target: WorkbenchRequest['target']) { request = { target, from_quick: true }; await act(async () => callbacks.get('workbench-navigation')!({ id: 1, event: 'workbench-navigation', payload: null })); },
    async settings(section: SettingsNavigation['section']) { settingsRequest = { section, from_quick: true }; await act(async () => callbacks.get('settings-navigation')!({ id: 1, event: 'settings-navigation', payload: null })); },
  };
}
const scopeEvent = (scopeId: string, position: number): StreamEvent => ({ kind: 'durable', event_id: String(BigInt(event.event_id) + BigInt(position)),
  event: { ...event, kind: 'scope.revoked', event_id: String(BigInt(event.event_id) + BigInt(position)),
    payload: { scopes: [{ id: scopeId, epoch: 2, status: 'revoked', scope: { kind: 'session', workspace_id: id, session_id: id } }], deletions: [] } } });
const pagedTask = (index: number, owner = id) => ({
  id: `00000000-0000-4000-8000-${String((owner === id ? 1000 : 2000) + index).padStart(12, '0')}`, version: 1, run_id: owner, binding,
  parent_task_id: index === 1 ? null : owner === id ? '00000000-0000-4000-8000-000000001001' : '00000000-0000-4000-8000-000000002001',
  origin_task_id: null, kind: 'agent' as const, executor_id: 'builtin.agent',
  state: 'completed' as const, created_seq: index, deadline_at: null, result_version: 1, reason: null,
});
const pagedTasks = (first: number, last: number, next: string | null, watermark: string, owner = id) => ({
  ...page(Array.from({ length: last - first + 1 }, (_, offset) => pagedTask(first + offset, owner))), next_cursor: next, watermark,
});
const globalSettings = () => within(screen.getByRole('complementary', { name: '项目导航' }))
  .getByRole('button', { name: '设置' });

it.each([false, true])('缺凭据自动设置完成后回有效控件，保留后续手动导航焦点=%s', async manual => {
  let current: RunSnapshot = { ...run, state: 'queued' };
  const message: ModelMessage = { id, run_id: run.id, role: 'user', origin: 'conversation', activity_id: null,
    parts: [{ kind: 'text', text: '缺凭据原输入' }], private_ref: null, source_dependencies: [], event_id: event.event_id, event_index: 0 };
  const server = shellServer((path, _parsed, init) => {
    if (path === `/sessions/${id}/runs` && init.method === 'POST') return current;
    if (path === `/runs/${run.id}`) return { ...taskDetail, run: current, messages: page([message]) };
    if (path.endsWith('/run-feedback')) return page([{ run_id: current.id, version: current.version,
      workspace_id: id, session_id: id, root_task_id: current.root_task_id, connection_id: connection.id,
      state: current.state, reason: current.reason, model_activity: null, context_usage: null }]);
  });
  const native = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((name, args, options) => name === 'show_workbench'
    ? server.navigate((args as { target: WorkbenchRequest['target'] }).target) : native(name, args, options));
  const user = userEvent.setup();
  render(<WorkbenchWindow client={runtime()} />);
  const input = await screen.findByLabelText('消息');
  await user.type(input, '缺凭据原输入');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(input).toHaveProperty('value', ''));
  const navigation = screen.getByRole('button', { name: '刷新导航' });
  if (manual) await user.click(navigation);
  current = { ...current, state: 'failed', reason: 'credential_missing', version: 2 };
  await server.emit({ kind: 'durable', event_id: String(BigInt(event.event_id) + 1n),
    event: { ...event, event_id: String(BigInt(event.event_id) + 1n), payload: { ...event.payload, runs: [current] } } });
  await screen.findByRole('dialog', { name: '设置' });
  await user.click(screen.getByRole('button', { name: '完成' }));
  await waitFor(() => expect(document.activeElement).toBe(manual ? navigation : input));
  expect(input).toHaveProperty('value', '缺凭据原输入');
});

it.each([false, true])('正常结果抽屉收到相关撤权立即屏蔽正文且迟到响应不重现，在途读取=%s', async inFlight => {
  const body = deferred<TaskResult>(), started = deferred<void>();
  const entry = { ...resultEntry, dependencies: [{ scope_id: grant.id, epoch: 1 }] };
  let revoked = false;
  const server = shellServer((path) => {
    if (path.endsWith('/results')) {
      if (revoked) throw new TypeError('合成权威刷新失败');
      return page([entry]);
    }
    if (path.endsWith('/view')) return entry;
    if (path.endsWith('/result')) {
      started.resolve();
      return body.promise;
    }
  });
  render(<Conversation client={runtime()} />);
  await screen.findByRole('heading', { name: session.title });
  await userEvent.click(screen.getByRole('button', { name: /^结果/ }));
  await userEvent.click(await screen.findByRole('button', { name: '查看结果' }));
  await started.promise;
  const result: TaskResult = { handle: entry.result, result_version: entry.result_version, state: 'completed', error: null, artifacts: [], dependencies: entry.dependencies, result: { summary: '相关来源的私有正文' } };
  if (!inFlight) { await act(async () => body.resolve(result)); await screen.findByText(/相关来源的私有正文/); }
  // 无关撤权不能打断阅读；真正相关的依赖 epoch 才是立即屏蔽依据。
  await server.emit(scopeEvent(secondId, 1));
  if (!inFlight) expect(screen.getByText(/相关来源的私有正文/)).toBeTruthy();
  revoked = true;
  await server.emit(scopeEvent(grant.id, 2));
  expect(screen.queryByText(/相关来源的私有正文/)).toBeNull();
  if (inFlight) await act(async () => body.resolve(result));
  expect(screen.queryByText(/相关来源的私有正文/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '刷新结果' }));
  await screen.findByRole('alert');
  expect(screen.queryByText(/相关来源的私有正文/)).toBeNull();
});

it.each(['tasks', 'assistants', 'memory', 'capabilities'] as const)('主窗dirty设置保护快捷窗%s跳转，继续编辑和保存后继续均保持原聊天草稿', async kind => {
  const saved = deferred<Response>();
  const server = shellServer((path, _parsed, init) => init.method === 'PUT' && path.startsWith('/model-connections/') ? saved.promise : undefined);
  render(<WorkbenchWindow client={runtime()} />);
  await userEvent.type(await screen.findByLabelText('消息'), '原聊天草稿');
  await userEvent.click(globalSettings());
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await userEvent.type(screen.getByLabelText('连接名称'), '-未保存');
  const target: WorkbenchRequest['target'] = kind === 'tasks' ? { kind, workspace_id: id } : { kind };
  await server.navigate(target);
  expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy();
  await userEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect((screen.getByLabelText('连接名称') as HTMLInputElement).value).toContain('未保存');
  await server.navigate(target);
  await userEvent.click(screen.getByRole('button', { name: '保存后继续' }));
  expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy();
  await act(async () => saved.resolve(Response.json({ ...connection, display_name: `${connection.display_name}-未保存`, version: 2 })));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull());
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('原聊天草稿');
});

it('保存中的主窗设置排队保留快捷窗导航，直到原保存回执到达', async () => {
  const saved = deferred<Response>();
  const server = shellServer((path, _parsed, init) => init.method === 'PUT' && path.startsWith('/model-connections/') ? saved.promise : undefined);
  render(<WorkbenchWindow client={runtime()} />);
  await screen.findByRole('heading', { name: session.title });
  await userEvent.click(globalSettings());
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await userEvent.click(screen.getByRole('button', { name: '保存连接' }));
  await server.navigate({ kind: 'tasks', workspace_id: id });
  expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy();
  expect((screen.getByRole('button', { name: '保存连接' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => saved.resolve(Response.json({ ...connection, version: 2 })));
  expect(await screen.findByRole('heading', { name: '任务中心' })).toBeTruthy();
});

it.each(['继续编辑', 'Escape'])('正常主窗%s取消外部目标后，关闭重开不重放；再次同目标仍保护新编辑', async cancel => {
  const server = shellServer(() => undefined), user = userEvent.setup();
  render(<WorkbenchWindow client={runtime()} />);
  await screen.findByRole('heading', { name: session.title });
  const configuration = screen.getByRole('button', { name: '运行配置' });
  await user.click(configuration);
  const runSettings = await screen.findByRole('dialog', { name: '运行配置' });
  await user.click(within(runSettings).getByRole('button', { name: '模型设置' }));
  expect(screen.queryByRole('dialog', { name: '运行配置' })).toBeNull();
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.type(screen.getByLabelText('连接名称'), '-第一次编辑');
  await server.navigate({ kind: 'tasks', workspace_id: id });
  await screen.findByRole('button', { name: '继续编辑' });
  if (cancel === 'Escape') await user.keyboard('{Escape}');
  else await user.click(screen.getByRole('button', { name: cancel }));
  await user.click(screen.getByRole('button', { name: '取消编辑' }));
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  await waitFor(() => expect(document.activeElement).toBe(configuration));
  await user.click(globalSettings());
  expect(await screen.findByRole('dialog', { name: '设置' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '任务中心' })).toBeNull();
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.type(screen.getByLabelText('连接名称'), '-后续编辑');
  await server.navigate({ kind: 'tasks', workspace_id: id });
  expect(screen.getByLabelText('连接名称')).toHaveProperty('value', `${connection.display_name}-后续编辑`);
  await user.click(await screen.findByRole('button', { name: '放弃更改' }));
  expect(await screen.findByRole('heading', { name: '任务中心' })).toBeTruthy();
});

it.each(['管理页', '设置分类'])('正常主窗保存后继续等待密钥期间，新%s目标取代旧continuation且不改原密钥绑定', async destination => {
  const saved = deferred<Response>(), credential = deferred<void>();
  const server = shellServer((path, _parsed, init) => init.method === 'PUT' && path.startsWith('/model-connections/') ? saved.promise : undefined);
  const native = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((name, args, options) => name === 'save_credential' ? credential.promise : native(name, args, options));
  const user = userEvent.setup();
  render(<WorkbenchWindow client={runtime()} />);
  await user.type(await screen.findByLabelText('消息'), '竞争期间保留的聊天草稿');
  await user.click(globalSettings());
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'synthetic-new-key');
  await server.navigate({ kind: 'tasks', workspace_id: id });
  await user.click(await screen.findByRole('button', { name: '保存后继续' }));
  await act(async () => saved.resolve(Response.json({ ...connection, version: 2 })));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_credential', expect.objectContaining({
    binding: expect.objectContaining({ connection_id: connection.id, connection_version: 2 }), value: 'synthetic-new-key',
  })));
  if (destination === '管理页') await server.navigate({ kind: 'assistants' });
  else await server.settings('assistant');
  expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy();
  await act(async () => credential.resolve());
  expect(await screen.findByRole('heading', { name: destination === '管理页' ? '我的助理' : '主助理设置' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '任务中心' })).toBeNull();
  expect(screen.getByLabelText('消息')).toHaveProperty('value', '竞争期间保留的聊天草稿');
});

it.each(['连接→管理页', '管理页→连接', '连接→设置分类', '设置分类→连接'] as const)('连接及通用导航共用请求槽：%s，原密钥完成后只安装最新目标', async order => {
  const saved = deferred<Response>(), credential = deferred<void>();
  const other = { ...connection, id: secondId, display_name: '连接 B' };
  const server = shellServer((path, _parsed, init) => {
    if (path === '/model-connections') return page([connection, other]);
    if (init.method === 'PUT' && path.startsWith('/model-connections/')) return saved.promise;
  });
  const native = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((name, args, options) => name === 'save_credential' ? credential.promise : native(name, args, options));
  const user = userEvent.setup();
  render(<WorkbenchWindow client={runtime()} />);
  await user.type(await screen.findByLabelText('消息'), '连接竞争原草稿');
  await server.navigate({ kind: 'connection', connection_id: connection.id });
  await user.type(await screen.findByLabelText('API Key（仅保存到系统凭据）'), 'synthetic-original-key');
  const targets = order.split('→');
  async function navigate(kind: string) {
    if (kind === '连接') await server.navigate({ kind: 'connection', connection_id: other.id });
    else if (kind === '管理页') await server.navigate({ kind: 'assistants' });
    else await server.settings('assistant');
  }
  await navigate(targets[0]);
  await user.click(await screen.findByRole('button', { name: '保存后继续' }));
  await act(async () => saved.resolve(Response.json({ ...connection, version: 2, secret_ref: id })));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_credential', expect.objectContaining({
    binding: expect.objectContaining({ connection_id: connection.id, connection_version: 2, secret_ref: id }), value: 'synthetic-original-key',
  })));
  await navigate(targets[1]);
  expect(screen.getByLabelText('编辑连接')).toHaveProperty('value', connection.id);
  await act(async () => credential.resolve());
  if (targets[1] === '连接') await screen.findByDisplayValue(other.display_name);
  else await screen.findByRole('heading', { name: targets[1] === '管理页' ? '我的助理' : '主助理设置' });
  expect(screen.queryByRole('button', { name: '继续编辑' })).toBeNull();
  expect(screen.getByLabelText('消息')).toHaveProperty('value', '连接竞争原草稿');
});

it('正常主窗取消同分类定位后再次定位仍询问，保存后的新编辑继续受保护', async () => {
  const server = shellServer((path, _parsed, init) => init.method === 'PUT' && path.startsWith('/model-connections/')
    ? { ...connection, version: 2 } : undefined), user = userEvent.setup();
  render(<WorkbenchWindow client={runtime()} />);
  await screen.findByRole('heading', { name: session.title });
  await user.click(globalSettings());
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.type(screen.getByLabelText('连接名称'), '-原编辑');
  await server.settings('models');
  await user.click(await screen.findByRole('button', { name: '继续编辑' }));
  await server.settings('models');
  await user.click(await screen.findByRole('button', { name: '保存后继续' }));
  await screen.findByText('连接已保存；仅对新运行生效');
  await user.type(screen.getByLabelText('连接名称'), '-后续编辑');
  await server.navigate({ kind: 'tasks', workspace_id: id });
  expect(await screen.findByRole('button', { name: '继续编辑' })).toBeTruthy();
  expect(screen.getByLabelText('连接名称')).toHaveProperty('value', `${connection.display_name}-后续编辑`);
  expect(screen.queryByRole('heading', { name: '任务中心' })).toBeNull();
});

it.each([
  [false, '刷新先发'], [false, '续页先发'], [true, '刷新先发'], [true, '续页先发'],
] as const)('正常结果抽屉compact=%s，%s并发后保持51条并沿新上界继续读取', async (compact, order) => {
  const head = deferred<SessionResultPage>(), tail = deferred<SessionResultPage>();
  const headStarted = deferred<void>(), tailStarted = deferred<void>();
  const entries = Array.from({ length: 52 }, (_, index) => ({ ...resultEntry,
    id: `00000000-0000-4000-8000-${String(400 + index).padStart(12, '0')}` }));
  const freshWatermark = String(BigInt(event.event_id) + 1n);
  let refreshing = false;
  const server = shellServer((path, parsed) => {
    if (!path.endsWith('/results')) return;
    const cursor = parsed.searchParams.get('cursor');
    if (cursor === 'old-tail') { tailStarted.resolve(); return tail.promise; }
    if (cursor === 'new-tail') return { ...page([entries[50]]), next_cursor: 'new-more', watermark: freshWatermark };
    if (cursor === 'new-more') return { ...page([entries[51]]), watermark: freshWatermark };
    if (refreshing) { headStarted.resolve(); return head.promise; }
    return { ...page(entries.slice(0, 50)), next_cursor: 'old-tail' };
  }), user = userEvent.setup();
  render(<Conversation client={runtime()} compact={compact} />);
  await screen.findByRole('heading', { name: session.title });
  await user.click(screen.getByRole('button', { name: /^结果/ }));
  await screen.findByRole('button', { name: '更多结果' });
  expect(screen.getAllByRole('button', { name: '查看结果' })).toHaveLength(50);
  if (order === '刷新先发') {
    refreshing = true;
    await server.emit(scopeEvent(secondId, 1));
    await headStarted.promise;
    await user.click(screen.getByRole('button', { name: '更多结果' }));
  } else {
    await user.click(screen.getByRole('button', { name: '更多结果' }));
    await tailStarted.promise;
    refreshing = true;
    await server.emit(scopeEvent(secondId, 1));
  }
  await act(async () => tail.resolve(page([entries[50]])));
  await act(async () => head.resolve({ ...page(entries.slice(0, 50)), next_cursor: 'new-tail', watermark: freshWatermark }));
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新结果' })).toHaveProperty('disabled', false));
  expect(screen.getAllByRole('button', { name: '查看结果' })).toHaveLength(51);
  await user.click(screen.getByRole('button', { name: '更多结果' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: '查看结果' })).toHaveLength(52));
});

it('结果刷新沿新首页上界串行读回原深度，新页尾继续可达新增结果', async () => {
  let fresh = false;
  const entries = Array.from({ length: 4 }, (_, index) => ({ ...resultEntry, id: `00000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}` }));
  shellServer((path, parsed) => {
    if (!path.endsWith('/results')) return;
    const cursor = parsed.searchParams.get('cursor');
    const routes = fresh
      ? { first: { ...page([entries[0]]), next_cursor: 'new-tail' }, 'new-tail': { ...page([entries[1]]), next_cursor: 'new-more' }, 'new-more': page([entries[3]]), 'old-tail': page([entries[1]]) }
      : { first: { ...page([entries[0]]), next_cursor: 'old-tail' }, 'old-tail': page([entries[1]]) };
    return routes[(cursor ?? 'first') as keyof typeof routes];
  });
  render(<Conversation client={runtime()} />);
  await screen.findByRole('heading', { name: session.title });
  await userEvent.click(screen.getByRole('button', { name: /^结果/ }));
  await userEvent.click(await screen.findByRole('button', { name: '更多结果' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: '查看结果' })).toHaveLength(2));
  fresh = true;
  await userEvent.click(screen.getByRole('button', { name: '刷新结果' }));
  await userEvent.click(await screen.findByRole('button', { name: '更多结果' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: '查看结果' })).toHaveLength(3));
});

it.each(['tasks', 'trace'] as const)('%s刷新沿新上界回读已读深度，后来的记录仍能从更多入口到达', async kind => {
  const client = runtime();
  let fresh = false;
  const root = { id, version: 1, run_id: id, binding, parent_task_id: null, origin_task_id: null, kind: 'agent' as const,
    executor_id: 'builtin.agent', state: 'completed' as const, created_seq: 1, deadline_at: null, result_version: 1, reason: null };
  const item = (index: number) => ({ ...root, id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, '0')}`, created_seq: index, binding: { ...binding, agent_work: { kind: 'agent' as const, profile_id: id, goal: '合成目标', input_refs: [], success_criteria: ['有交付'], output_schema: {} },
    config: { ...binding.config, agent_profile: { ...agent, display_name: `成员${index}` } } } });
  const trace = (index: number) => ({ event_id: String(index), seq: index, kind: `合成事件${index}`, task_id: null, activity_id: null, activities: [] });
  shellServer((path, parsed) => {
    if (path === `/runs/${id}`) return { ...taskDetail, tasks: { ...page([item(1)]), next_cursor: fresh ? 'new-tail' : 'old-tail' } };
    if (!path.endsWith(`/${kind}`)) return;
    const cursor = parsed.searchParams.get('cursor');
    const makePage = (index: number, next: string | null) => ({ ...(kind === 'tasks' ? page([item(index)]) : page([trace(index)])), next_cursor: next });
    if (!cursor) return makePage(1, fresh ? 'new-tail' : 'old-tail');
    if (cursor === 'old-tail') return makePage(2, null);
    if (cursor === 'new-tail') return makePage(2, 'new-more');
    if (cursor === 'new-more') return makePage(3, null);
  });
  render(<TaskDetail client={client} store={createRuntimeStore(client)} runId={id} onCommand={vi.fn()} onOpen={vi.fn()} onQuestion={vi.fn()} />);
  await screen.findByRole('heading', { name: '任务详情' });
  await userEvent.click(screen.getByRole('button', { name: kind === 'tasks' ? '任务列表' : '原始 Trace' }));
  await userEvent.click(await screen.findByRole('button', { name: kind === 'tasks' ? '更多 tasks' : '加载更多事件' }));
  fresh = true;
  await userEvent.click(screen.getByRole('button', { name: '刷新详情' }));
  await userEvent.click(await screen.findByRole('button', { name: kind === 'tasks' ? '更多 tasks' : '加载更多事件' }));
  await screen.findByText(kind === 'tasks' ? '任务 · 成员 · 成员3' : '合成事件3');
});

it.each([
  ['续页先发', '同水位'], ['续页先发', '更高水位'], ['刷新先发', '同水位'], ['刷新先发', '更高水位'],
] as const)('正常 App 任务列表%s，旧上界尾页在%s读取后不丢深度或新任务入口', async (order, mark) => {
  const tailRead = deferred<void>(), headRead = deferred<void>(), tailStarted = deferred<void>(), headStarted = deferred<void>();
  const freshMark = String(BigInt(event.event_id) + 1n), laterMark = String(BigInt(freshMark) + 1n);
  let dbWatermark = event.event_id;
  let fresh = false;
  const requests: (string | null)[] = [];
  const server = shellServer(async (path, parsed) => {
    if (path === `/tasks/${pagedTask(1).id}`) return pagedTask(1);
    if (path === `/runs/${id}`) {
      const refreshing = fresh;
      if (refreshing) { requests.push(null); headStarted.resolve(); await headRead.promise; }
      const watermark = dbWatermark;
      return { ...taskDetail, run: { ...taskDetail.run, root_task_id: pagedTask(1).id },
        tasks: pagedTasks(1, 100, refreshing ? 'new-tasks' : 'old-tasks', watermark), watermark };
    }
    if (path === `/runs/${id}/tasks`) {
      expect(parsed.searchParams.get('limit')).toBe('50');
      const cursor = parsed.searchParams.get('cursor'); requests.push(cursor);
      if (cursor === 'old-tasks') {
        tailStarted.resolve(); await tailRead.promise;
        // cursor 的 upper 固定为 101；晚开始的读取可以带新 DB 水位。
        if (fresh && mark === '更高水位') dbWatermark = laterMark;
        return pagedTasks(101, 101, null, dbWatermark);
      }
      if (cursor === 'new-tasks') return pagedTasks(101, 150, 'new-tasks-more', dbWatermark);
      if (cursor === 'new-tasks-more') return pagedTasks(151, 152, null, dbWatermark);
      throw new Error(`未定义任务游标 ${cursor}`);
    }
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: session.title });
  await server.navigate({ kind: 'task', task_id: pagedTask(1).id });
  await user.click(await screen.findByRole('button', { name: '任务列表' }));
  const list = screen.getByRole('region', { name: '任务列表' });
  await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(100));
  async function refresh() {
    fresh = true;
    dbWatermark = freshMark;
    await server.emit({ kind: 'durable', event_id: freshMark, event: { ...event, kind: 'task.stepped', event_id: freshMark,
      payload: { ...event.payload, tasks: [pagedTask(152)], runs: [{ ...taskDetail.run, root_task_id: pagedTask(1).id }] } } });
  }
  if (order === '续页先发') {
    await user.click(screen.getByRole('button', { name: '更多 tasks' }));
    await tailStarted.promise;
    await refresh();
  } else {
    await refresh();
    await headStarted.promise;
    await user.click(screen.getByRole('button', { name: '更多 tasks' }));
  }
  await act(async () => headRead.resolve());
  await act(async () => tailRead.resolve());
  await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(150));
  expect(requests.filter(cursor => cursor === 'old-tasks')).toHaveLength(order === '续页先发' ? 1 : 0);
  await user.click(screen.getByRole('button', { name: '刷新详情' }));
  await waitFor(() => expect(requests.filter(cursor => cursor === 'new-tasks')).toHaveLength(2));
  expect(within(list).getAllByRole('button')).toHaveLength(150);
  await user.click(screen.getByRole('button', { name: '更多 tasks' }));
  await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(152));
  expect(screen.queryByRole('button', { name: '更多 tasks' })).toBeNull();
  expect(requests.at(-1)).toBe('new-tasks-more');
});

it('正常 App 各集合保留各自深度，重复续页只读取一次；普通事件不混入未读取的产物尾页', async () => {
  const tail = deferred<void>(), started = deferred<void>();
  const cursors: string[] = [];
  const artifacts = Array.from({ length: 101 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(3001 + index).padStart(12, '0')}`, version: 1, task_id: pagedTask(1).id,
    activity_id: secondId, content_hash: 'a'.repeat(64), media_type: 'application/octet-stream' as const, dependencies: [],
  }));
  let fresh = false;
  let dbWatermark = event.event_id;
  const server = shellServer(async (path, parsed) => {
    if (path === `/tasks/${pagedTask(1).id}`) return pagedTask(1);
    if (path === `/runs/${id}`) return { ...taskDetail, run: { ...taskDetail.run, root_task_id: pagedTask(1).id },
      tasks: pagedTasks(1, 100, fresh ? 'new-tasks' : 'old-tasks', dbWatermark),
      artifacts: { ...page(artifacts.slice(0, 100)), next_cursor: fresh ? 'new-artifacts' : 'old-artifacts', watermark: dbWatermark },
      watermark: dbWatermark };
    if (path === `/runs/${id}/tasks`) {
      const cursor = parsed.searchParams.get('cursor')!; cursors.push(cursor);
      if (cursor === 'old-tasks') { started.resolve(); await tail.promise; }
      return pagedTasks(101, 150, null, dbWatermark);
    }
    if (path === `/runs/${id}/artifacts`) {
      cursors.push(parsed.searchParams.get('cursor')!);
      return { ...page(artifacts.slice(100)), watermark: dbWatermark };
    }
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: session.title });
  await server.navigate({ kind: 'task', task_id: pagedTask(1).id });
  await user.click(await screen.findByRole('button', { name: '任务列表' }));
  const list = screen.getByRole('region', { name: '任务列表' });
  const more = screen.getByRole('button', { name: '更多 tasks' });
  act(() => { fireEvent.click(more); fireEvent.click(more); });
  await started.promise;
  await act(async () => tail.resolve());
  await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(150));
  expect(cursors).toEqual(['old-tasks']);
  fresh = true;
  dbWatermark = String(BigInt(event.event_id) + 1n);
  await server.emit({ kind: 'durable', event_id: String(BigInt(event.event_id) + 1n),
    event: { ...event, kind: 'task.stepped', event_id: String(BigInt(event.event_id) + 1n), payload: { ...event.payload } } });
  await waitFor(() => expect(cursors).toEqual(['old-tasks', 'new-tasks']));
  expect(screen.getAllByRole('button', { name: /^查看二进制文件 / })).toHaveLength(100);
  await user.click(screen.getByRole('button', { name: '更多 artifacts' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^查看二进制文件 / })).toHaveLength(101));
  expect(cursors).toEqual(['old-tasks', 'new-tasks', 'new-artifacts']);
  expect(within(list).getAllByRole('button')).toHaveLength(150);
});

it.each(['续页', '刷新'] as const)('正常 App 切换 Run 隔离集合的在途%s及排队刷新，返回原任务重置深度', async pending => {
  const reply = deferred<void>(), started = deferred<void>();
  let paused = false;
  const reads: string[] = [];
  const server = shellServer(async (path, parsed) => {
    for (const owner of [id, secondId]) {
      if (path === `/tasks/${pagedTask(1, owner).id}`) return pagedTask(1, owner);
      if (path === `/runs/${owner}`) {
        reads.push(`head:${owner}`);
        if (owner === id && paused && pending === '刷新') { started.resolve(); await reply.promise; }
        return { ...taskDetail, run: { ...taskDetail.run, id: owner, root_task_id: pagedTask(1, owner).id },
          tasks: pagedTasks(1, owner === id ? 100 : 2, owner === id ? 'a-tail' : null, event.event_id, owner) };
      }
    }
    if (path === `/runs/${id}/tasks`) {
      reads.push(parsed.searchParams.get('cursor')!);
      if (paused) { started.resolve(); await reply.promise; }
      return pagedTasks(101, 101, null, event.event_id);
    }
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: session.title });
  await server.navigate({ kind: 'task', task_id: pagedTask(1).id });
  await user.click(await screen.findByRole('button', { name: '任务列表' }));
  const list = screen.getByRole('region', { name: '任务列表' });
  if (pending === '刷新') {
    await user.click(screen.getByRole('button', { name: '更多 tasks' }));
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(101));
  }
  paused = true;
  await user.click(screen.getByRole('button', { name: pending === '续页' ? '更多 tasks' : '刷新详情' }));
  await started.promise;
  await user.click(screen.getByRole('button', { name: '刷新详情' }));
  const heads = reads.filter(value => value === `head:${id}`).length;
  await server.navigate({ kind: 'task', task_id: pagedTask(1, secondId).id });
  await user.click(await screen.findByRole('button', { name: '任务列表' }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: '任务列表' })).getAllByRole('button')).toHaveLength(2));
  await act(async () => reply.resolve());
  expect(reads.filter(value => value === `head:${id}`)).toHaveLength(heads);
  expect(screen.queryByRole('button', { name: '更多 tasks' })).toBeNull();
  paused = false;
  await server.navigate({ kind: 'task', task_id: pagedTask(1).id });
  await user.click(await screen.findByRole('button', { name: '任务列表' }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: '任务列表' })).getAllByRole('button')).toHaveLength(100));
  expect(screen.getByRole('button', { name: '更多 tasks' })).toHaveProperty('disabled', false);
});

it.each([false, true])('默认模型自动加载续页并报告在途状态，尊重用户显式选择=%s', async selected => {
  const tail = deferred<ModelProfilePage>(), started = deferred<void>();
  shellServer((path, parsed) => {
    if (path !== '/models') return;
    if (parsed.searchParams.get('cursor')) { started.resolve(); return tail.promise; }
    return { ...page([{ ...model, id, model_id: 'other-model' }]), next_cursor: 'model-tail' };
  });
  render(<Conversation client={runtime()} />);
  await screen.findByRole('heading', { name: session.title });
  await screen.findByText('正在加载默认模型…');
  await started.promise;
  const user = userEvent.setup();
  if (selected) {
    await user.click(screen.getByRole('button', { name: '选择模型' }));
    const options = within(screen.getByRole('listbox', { name: '可用模型' })).getAllByRole('option');
    await user.click(options.find(option => option.dataset.modelId === id)!);
  }
  await act(async () => tail.resolve(page([model])));
  await expectComposerModel(user, selected ? id : model.id);
});

it('默认模型续页加载失败显示字段错误，可从同一入口重试', async () => {
  let fail = true;
  shellServer((path, parsed) => {
    if (path !== '/models') return;
    if (parsed.searchParams.get('cursor')) { if (fail) throw new TypeError('合成续页失败'); return page([model]); }
    return { ...page([]), next_cursor: 'model-tail' };
  });
  render(<Conversation client={runtime()} />);
  await screen.findByText(/默认模型加载失败/);
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: '重试加载默认模型' }));
  await expectComposerModel(userEvent.setup(), model.id);
});

it.each(['全局', '项目'] as const)('快捷窗%s新建会话取消后焦点回到仍存在的导航按钮', async origin => {
  shellServer(() => undefined);
  render(<Conversation compact client={runtime()} />);
  await screen.findByRole('heading', { name: session.title });
  await userEvent.click(screen.getByRole('button', { name: '打开项目导航' }));
  if (origin === '全局') await userEvent.click(screen.getByRole('button', { name: '新建会话' }));
  else {
    const actions = screen.getByRole('button', { name: `项目「${workspace.name}」的更多操作` });
    actions.focus();
    await userEvent.keyboard('{Enter}');
    const createSession = await screen.findByRole('menuitem', { name: '在此项目新建会话' });
    await waitFor(() => expect(document.activeElement).toBe(createSession));
    await userEvent.keyboard('{Enter}');
  }
  await userEvent.click(within(screen.getByRole('dialog', { name: '新建会话' })).getByRole('button', { name: '取消' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开项目导航' })));
});
