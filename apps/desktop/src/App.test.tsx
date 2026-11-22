import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
import { Conversation } from './features/chat/Conversation';
import { RuntimeClient } from './api/client';
import { openComposerModelOption, selectComposerModel } from './test/composer-model';
import { agent, binding, connection, event, id, model, page, run, runDetailSummary, secondId, limits } from './test/fixtures';
import type { Approval, ModelMessage, Question, RunDetail, StreamEvent } from './generated/contracts';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'public-token', protocol_version: 4 });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const workspace = { id, version: 1, name: '工作区', directory_resource_id: null };
const session = { id, version: 1, workspace_id: id, title: '会话', agent_profile_id: id, kind: 'interaction' as const, archived: false };
const message = { id: secondId, run_id: id, role: 'assistant', parts: [{ kind: 'text', text: '持久历史' }], source_dependencies: [], activity_id: null, private_ref: null, origin: 'conversation', event_id: '9007199254740993', event_index: 0 };

function server(active = false, pending: { questions?: Question[]; approvals?: Approval[] } = {}) {
  const commands: { path: string; body: any }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v4', '');
    if (path.endsWith('/resource-coverage')) {
      const allowed = commands.some(command => command.path === '/grants');
      const ids = JSON.parse(init.body as string).resource_ids;
      return json({ allowed, destination: connection.endpoint, missing_read: allowed ? [] : ids,
        missing_model_send: allowed ? [] : ids });
    }
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return json(page([]));
    if (init.method === 'POST') {
      commands.push({ path, body: JSON.parse(init.body as string) });
      if (path.endsWith('/cancel')) return json({ ...run, version: 2, state: 'completed' });
      const body = JSON.parse(init.body as string);
      if (path === '/grants') return json({ ...body.data, memory_scopes: [], mcp_versions: {}, mcp_queries: [], id: secondId, version: 1, epoch: 1, status: 'active' });
      if (path.endsWith('/decision')) return json({ ...pending.approvals![0], version: 2, status: body.data.allow ? 'approved' : 'denied' });
      return json(run);
    }
    if (path === '/workspaces') return json(page([workspace]));
    if (path === '/profiles') return json(page([agent]));
    if (path === '/models') return json(page([model]));
    if (path === '/model-connections') return json(page([connection]));
    if (path.endsWith('/snapshot')) return json({ workspace, sessions: page([session]), active_runs: page(active ? [run] : []), pending_questions: page(pending.questions ?? []), pending_approvals: page(pending.approvals ?? []), resources: page([]), grants: page([]), watermark: event.event_id });
    if (path.endsWith('/sessions')) return json(page([session]));
    if (path === `/sessions/${id}/runs`) return json(page(active ? [run] : []));
    if (path.endsWith('/messages')) return json(page([message]));
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path === `/runs/${id}`) return json({ ...runDetailSummary, run: commands.some(c => c.path.endsWith('/cancel')) ? { ...run, version: 2, state: 'completed' } : run, tasks: page([]), activities: page([]), messages: page([message]), artifacts: page([]), questions: page((pending.questions ?? []).map(question => commands.some(command => command.path.endsWith('/answer')) ? { ...question, version: 2, status: 'answered' } : question)), approvals: page(pending.approvals ?? []), waits: page([]), consumptions: page([]), joins: page([]), budget: { id, version: 1, run_id: id, limits, spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id });
    throw new Error(`测试未定义路由 ${path}`);
  });
  return commands;
}

describe('最小产品对话', () => {
  it('启动恢复字号，其他窗口改字号时立即同步', () => {
    localStorage.setItem('flowmate:text-size', 'compact');
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
    const view = render(<App />);
    try {
      expect(document.documentElement.dataset.textSize).toBe('compact');
      fireEvent(window, new StorageEvent('storage', { key: 'flowmate:text-size', newValue: 'large' }));
      expect(document.documentElement.dataset.textSize).toBe('large');
    } finally {
      view.unmount();
      localStorage.removeItem('flowmate:text-size');
      delete document.documentElement.dataset.textSize;
      vi.mocked(invoke).mockReset();
    }
  });
  it('外观设置关闭时，工作台也应用已保存的主题并同步其他窗口的选择', () => {
    localStorage.setItem('flowmate:theme', 'dark');
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
    const view = render(<App />);
    try {
      expect(document.documentElement.dataset.theme).toBe('dark');
      fireEvent(window, new StorageEvent('storage', { key: 'flowmate:theme', newValue: 'light' }));
      expect(document.documentElement.dataset.theme).toBe('light');
    } finally {
      view.unmount();
      localStorage.removeItem('flowmate:theme');
      delete document.documentElement.dataset.theme;
      vi.mocked(invoke).mockReset();
    }
  });
  it('连接尚未同步时不从历史快照猜目的地，也不能授权发送资料', async () => {
    const commands = server();
    const previousFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => new URL(url).pathname.endsWith('/model-connections')
      ? json(page([])) : previousFetch(url, init));
    vi.mocked(invoke).mockResolvedValue({ resources: [{ id: secondId, version: 1, scope: { kind: 'session', workspace_id: id, session_id: id }, label: 'notes.md', kind: 'file', source_version: null }] });
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('持久历史');
    const option = await openComposerModelOption(user, model.id);
    expect(option.textContent).toMatch(/explicit-model.*连接尚未同步/);
    await user.click(option);
    await user.click(screen.getByRole('button', { name: '选择文本文件' }));
    await screen.findByText(/连接尚未同步，无法确认目的地/);
    await user.type(screen.getByLabelText('消息'), '整理附件');
    expect(screen.getByRole('button', { name: '发送' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: /授权读取并发送/ })).toBeNull();
    expect(commands).toHaveLength(0);
  });
  it('启动只查询产品事实、不运行 M0 diagnose；读取历史并由用户提交真实命令', async () => {
    const commands = server();
    vi.mocked(invoke).mockImplementation(async name => name === 'runtime_connection' ? client.connection : null);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('持久历史');
    expect(commands).toEqual([]);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('runtime_connection');
    await selectComposerModel(user, model.id);
    await user.type(screen.getByLabelText('消息'), '纯对话');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ path: `/sessions/${id}/runs`, body: { meta: { expected_version: null }, data: { agent_profile_id: id, model_profile_id: model.id, text: '纯对话', sources: { resource_ids: [] } } } });
  });
  it('终态取消使用服务 completed 回执，不把已完成任务显示为 cancelled', async () => {
    const commands = server(true);
    vi.mocked(invoke).mockImplementation(async name => name === 'runtime_connection' ? client.connection : null);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '停止当前运行' }));
    await screen.findByText('任务已完成', { exact: true });
    expect(screen.queryByRole('button', { name: '停止当前运行' })).toBeNull();
    const details = screen.getByRole('navigation', { name: '会话详情入口' });
    await user.click(within(details).getByRole('button', { name: '任务' }));
    const runs = within(await screen.findByRole('region', { name: '会话任务' }));
    expect(runs.getByRole('button', { name: /本次对话.*已完成/ })).toBeTruthy();
    expect(runs.queryByRole('button', { name: /已取消/ })).toBeNull();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ path: `/runs/${id}/cancel`, body: { expected_version: 1 } });
    expect(commands[0].body).not.toHaveProperty('data');
  });
  it('资料只由原生 Ref 选择，发送意图先授权读取和固定目的地再发送', async () => {
    const commands = server();
    vi.mocked(invoke).mockResolvedValue({ resources: [{ id: secondId, version: 1, scope: { kind: 'session', workspace_id: id, session_id: id }, label: 'notes.md', kind: 'file', source_version: null }] });
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('持久历史');
    await selectComposerModel(user, model.id);
    await user.click(screen.getByRole('button', { name: '选择文本文件' }));
    await screen.findByText('notes.md');
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('select_resources', { scope: { kind: 'session', workspace_id: id, session_id: id }, kind: 'file' });
    await user.type(screen.getByLabelText('消息'), '整理资料');
    await waitFor(() => expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/点击发送即同意本次读取/).textContent).toContain(connection.endpoint);
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[0]).toMatchObject({ path: '/grants', body: { data: { purposes: ['read', 'model_send'], destination: connection.endpoint, resource_ids: [secondId] } } });
    expect(commands[1]).toMatchObject({ path: `/sessions/${id}/runs`,
      body: { data: { model_profile_id: model.id, sources: { resource_ids: [secondId] } } } });
    expect(vi.mocked(invoke).mock.calls.some(([name]) => String(name).includes('credential'))).toBe(false);
  });
  it('持久问题呈现 answer_schema，并按问题版本提交字符串回答', async () => {
    const question: Question = { id: secondId, version: 1, run_id: id, task_id: id, call_id: 'ask-1', message_id: id, question: '希望整理哪个范围？', answer_schema: { type: 'string' }, status: 'pending', answer_message_id: null, dependencies: [] };
    const commands = server(true, { questions: [question] });
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText(question.question);
    await user.type(screen.getByLabelText('回答'), '范围 A');
    await user.click(screen.getByRole('button', { name: '提交回答' }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ path: `/questions/${secondId}/answer`, body: { meta: { expected_version: 1 }, data: { answer: '范围 A' } } });
  });
  it('待审批展示真实参数与目标，只提交本次版本决定，不直接执行工具', async () => {
    const approval: Approval = { mcp: null, id: secondId, version: 1, workspace_id: id, session_id: id, run_id: id, task_id: id, activity_id: id, call_id: 'call-1', tool_name: 'artifacts.export', tool_version: '1', args_hash: 'abc', target: secondId, export_preview: { target_path: 'C:\\Synthetic\\report.md', target_exists: false, artifact_id: id, artifact_version: 1 }, parameters: { target_ref: secondId }, dependencies: [], expires_at: '2026-11-07T13:00:00Z', status: 'pending' };
    const commands = server(true, { approvals: [approval] });
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await user.click(await screen.findByRole('button', { name: '查看审批' }));
    const review = within(await screen.findByRole('dialog', { name: '审批本次操作' }));
    expect(review.getByText(approval.export_preview!.target_path)).toBeTruthy();
    await user.click(review.getByRole('button', { name: '拒绝本次操作' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '拒绝本次操作' })).toBeNull());
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ path: `/approvals/${secondId}/decision`, body: { meta: { expected_version: 1 }, data: { allow: false } } });
  });
  it('真实 reducer 的实时 assistant 不显示在已提交 user 前，迟到查询也不覆盖会话顺序', async () => {
    const commands = server();
    const previousFetch = globalThis.fetch;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const userMessage: ModelMessage = { id: '00000000-0000-4000-8000-000000000003', run_id: id, role: 'user', parts: [{ kind: 'text', text: 'T7-CHAT plain conversation' }], source_dependencies: [], activity_id: null, private_ref: null, origin: 'conversation', event_id: '9007199254740994', event_index: 0 };
    const assistantMessage: ModelMessage = { ...userMessage, id: '00000000-0000-4000-8000-000000000004', role: 'assistant', parts: [{ kind: 'text', text: 'T7 conversation complete' }], event_id: '9007199254740995' };
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
      if (path.endsWith('/messages')) return json(page([]));
      if (path === `/v4/runs/${id}`) {
        const response = await previousFetch(url, init);
        const detail = await response.json();
        const empty = { ...page([]), watermark: '9007199254740994' };
        return json({ ...detail, tasks: empty, activities: empty, artifacts: empty, questions: empty, approvals: empty, waits: empty, consumptions: empty, joins: empty,
          messages: { ...page([userMessage]), watermark: '9007199254740994' }, watermark: '9007199254740994' });
      }
      return previousFetch(url, init);
    });
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('本机事件流已连接');
    await selectComposerModel(user, model.id);
    await user.type(screen.getByLabelText('消息'), 'T7-CHAT plain conversation');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('T7-CHAT plain conversation');
    expect(commands[0]).toMatchObject({ path: `/sessions/${id}/runs`, body: { data: { model_profile_id: model.id } } });
    await act(async () => {
      const value = { kind: 'durable', event_id: '9007199254740995', event: { ...event, event_id: '9007199254740995', seq: 2,
        payload: { runs: [], tasks: [], activities: [], budgets: [], messages: [assistantMessage], artifacts: [], questions: [], waits: [], consumptions: [], joins: [], pending_commands: [], follow_up_intents: [] } } };
      stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
    });
    await screen.findByText('T7 conversation complete');
    const conversation = screen.getByRole('region', { name: '持久对话' });
    expect([...conversation.querySelectorAll('.message .markdown-body p')].map(element => element.textContent)).toEqual(['T7-CHAT plain conversation', 'T7 conversation complete']);
  });
  it('历史分页、RunDetail 与实时消息合流共用持久位置，补页和重复事件都不跳序', async () => {
    server(true);
    const previousFetch = globalThis.fetch;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const currentUser: ModelMessage = { id: '00000000-0000-4000-8000-000000000003', run_id: id, role: 'user', parts: [{ kind: 'text', text: 'current-user' }], source_dependencies: [], activity_id: null, private_ref: null, origin: 'conversation', event_id: '9007199254740992', event_index: 0 };
    const currentAssistant: ModelMessage = { ...currentUser, id: '00000000-0000-4000-8000-000000000004', role: 'assistant', parts: [{ kind: 'text', text: 'current-assistant' }], event_id: '9007199254740995' };
    const olderUser: ModelMessage = { ...currentUser, id: '00000000-0000-4000-8000-000000000005', parts: [{ kind: 'text', text: 'older-user' }], event_id: '9007199254740990' };
    const olderAssistant: ModelMessage = { ...currentAssistant, id: '00000000-0000-4000-8000-000000000006', parts: [{ kind: 'text', text: 'older-assistant' }], event_id: '9007199254740991' };
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
      if (parsed.pathname.endsWith('/messages')) return json(parsed.searchParams.has('cursor')
        ? { ...page([currentUser]), watermark: '9007199254740994' }
        : { ...page([olderUser, olderAssistant]), next_cursor: 'page-2', watermark: '9007199254740994' });
      if (parsed.pathname === `/v4/runs/${id}`) {
        const detail = await (await previousFetch(url, init)).json();
        const empty = { ...page([]), watermark: '9007199254740994' };
        return json({ ...detail, tasks: empty, activities: empty, artifacts: empty, questions: empty, approvals: empty, waits: empty, consumptions: empty, joins: empty,
          messages: { ...page([currentUser]), watermark: '9007199254740994' }, watermark: '9007199254740994' });
      }
      return previousFetch(url, init);
    });
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('本机事件流已连接');
    await screen.findByText('older-user');
    const value = { kind: 'durable', event_id: '9007199254740995', event: { ...event, event_id: '9007199254740995', seq: 2,
      payload: { runs: [], tasks: [], activities: [], budgets: [], messages: [currentAssistant], artifacts: [], questions: [], waits: [], consumptions: [], joins: [], pending_commands: [], follow_up_intents: [] } } };
    await act(async () => { stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)); });
    await screen.findByText('current-assistant');
    const conversation = screen.getByRole('region', { name: '持久对话' });
    const expected = ['older-user', 'older-assistant', 'current-user', 'current-assistant'];
    expect([...conversation.querySelectorAll('.message .markdown-body p')].map(element => element.textContent)).toEqual(expected);
    await user.click(screen.getByRole('button', { name: '更多历史' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '更多历史' })).toBeNull());
    await act(async () => { stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)); });
    expect([...conversation.querySelectorAll('.message .markdown-body p')].map(element => element.textContent)).toEqual(expected);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function deletionServer(artifactEntry?: 'delivery' | 'tool') {
  const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
  const other = { ...session, id: uuid(100), title: '另一个会话' };
  const artifact = { id: uuid(101), version: 1, task_id: run.root_task_id, activity_id: uuid(102),
    content_hash: 'a'.repeat(64), dependencies: [], media_type: 'text/plain' as const };
  const messages: ModelMessage[] = [message as ModelMessage];
  if (artifactEntry === 'tool') {
    const call = { ...message, id: uuid(105), role: 'assistant' as const, origin: 'conversation' as const,
      parts: [{ kind: 'tool_call' as const, call_id: 'read', name: 'files.read_text', arguments: { resource_id: uuid(107) } }] };
    messages.unshift(call, { ...call, id: uuid(106), activity_id: artifact.activity_id, role: 'tool', event_index: 1,
      parts: [{ kind: 'tool_result', call_id: 'read', origin_message_id: call.id, error: null,
        result: { kind: 'artifact_preview', artifact_id: artifact.id, truncated: true, preview: '来源预览', total_chars: 24 } }] });
    messages[2] = { ...messages[2], event_index: 2 };
  }
  const approval: Approval = { mcp: null, id: uuid(103), version: 1, workspace_id: id, session_id: id, run_id: id,
    task_id: run.root_task_id, activity_id: artifact.activity_id, call_id: 'export-1', tool_name: 'deleted-export',
    tool_version: '1', args_hash: 'hash', target: 'private-target', export_preview: null, parameters: { text: 'deleted-approval-content' },
    dependencies: [], expires_at: '2026-11-07T13:00:00Z', status: 'pending' };
  const output = artifactEntry ? { summary: '持久历史', artifact_ids: artifactEntry === 'delivery' ? [artifact.id] : [],
    unresolved: [], handled_failures: [] } : run.output;
  const detail: RunDetail = { ...runDetailSummary, run: { ...run, state: 'completed', output }, tasks: page([{ id: run.root_task_id,
    version: 1, run_id: id, binding, parent_task_id: null, origin_task_id: null, kind: 'agent', executor_id: 'builtin.agent',
    state: 'completed', created_seq: 1, deadline_at: null, result_version: 1, reason: null }]),
    activities: page(artifactEntry ? [{ id: artifact.activity_id, run_id: run.id, task_id: artifact.task_id,
      kind: 'tool', version: 3, state: 'succeeded', operation: artifactEntry === 'tool' ? 'files.read_text' : 'artifacts.create_text',
      error: null, usage: null, actual_units: null, dependencies: [], script_execution: null }] : []),
    messages: page(messages), artifacts: page([artifact]), questions: page([]),
    approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]), budget: { id: run.budget_id,
      version: 1, run_id: id, limits, spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id };
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const requests: string[] = [];
  const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
  const data = (url: URL) => {
    const path = url.pathname.replace('/v4', '');
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return page([]);
    if (path === '/navigation') return { default_workspace_id: id, workspaces: { ...page([{ workspace, sessions: { ...page([session, other]), next_cursor: 'sessions-next' }, pending_count: 0 }]), next_cursor: 'workspaces-next' }, recent_sessions: page([]), pending_count: 0, watermark: event.event_id };
    if (path === `/sessions/${id}`) return session;
    if (path === `/sessions/${other.id}`) return other;
    if (path === '/workspaces') return { ...page([workspace]), next_cursor: 'workspaces-next' };
    if (path === '/profiles') return page([agent]);
    if (path === '/models') return page([model]);
    if (path === '/model-connections') return page([connection]);
    if (path.endsWith('/snapshot')) return { workspace, sessions: { ...page([session, other]), next_cursor: 'sessions-next' },
      active_runs: page([detail.run]), pending_questions: { ...page([]), next_cursor: 'questions-next' },
      pending_approvals: { ...page([]), next_cursor: 'approvals-next' }, resources: page([]), grants: page([]), watermark: event.event_id };
    if (path === `/runs/${id}`) return detail;
    if (path === `/sessions/${id}/runs`) return page([detail.run]);
    if (path === `/sessions/${other.id}/runs`) return page([]);
    if (path === `/sessions/${id}/messages`) return { ...page(messages), next_cursor: 'history-next' };
    if (path === `/sessions/${other.id}/messages`) return page([{ ...message, id: uuid(104), parts: [{ kind: 'text', text: '另一会话历史' }] }]);
    throw new Error(`测试未定义路由 ${path}`);
  };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    const key = (init.method ?? 'GET') + ' ' + parsed.pathname + parsed.search;
    requests.push(key);
    if (pending.has(key)) return pending.get(key)!.promise;
    if (parsed.pathname.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
    return json(data(parsed));
  });
  return { other, artifact, detail, approval, requests,
    hold(key: string) { const result = deferred<Response>(); pending.set(key, result); return result; },
    async deleted(session_id: string | null = id) {
      const scope = { kind: session_id === null ? 'workspace' as const : 'session' as const, workspace_id: id, session_id };
      const value: StreamEvent = { kind: 'durable', event_id: '9007199254740994', event: { ...event,
        kind: 'scope.deleted', event_id: '9007199254740994', session_id, run_id: null, seq: null,
        payload: { scopes: [{ id: session_id ?? id, scope, epoch: 2, status: 'deleted' }],
          deletions: [{ scope, epoch: 2, status: 'deleted' }] } } };
      await act(async () => { stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)); });
    },
  };
}

describe('删除与本地异步响应围栏', () => {
  it('已安装快照和SSE后删除当前session，迟到会话/审批分页不复活，另一session可继续使用', async () => {
    const fixture = deletionServer();
    const lateSessions = fixture.hold(`GET /v4/workspaces/${id}/sessions?cursor=sessions-next`);
    const lateApprovals = fixture.hold(`GET /v4/workspaces/${id}/approvals?cursor=approvals-next`);
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('本机事件流已连接');
    await user.click(await screen.findByRole('button', { name: '更多项目会话' }));
    await fixture.deleted();
    await act(async () => { lateSessions.resolve(json(page([session, fixture.other]))); });
    await waitFor(() => expect(screen.queryByRole('option', { name: '会话' })).toBeNull());
    await user.click(await screen.findByRole('button', { name: fixture.other.title }));
    await screen.findByText('另一会话历史');
    await user.click(screen.getByRole('button', { name: '更多审批' }));
    await act(async () => { lateApprovals.resolve(json(page([fixture.approval]))); });
    expect(screen.queryByText('deleted-approval-content', { exact: false })).toBeNull();
    expect(screen.queryByText('持久历史')).toBeNull();
    expect(screen.queryByRole('option', { name: '会话' })).toBeNull();
  });
  it.each(['delete', 'switch', 'roundtrip'] as const)('产物内容读取期间%s，迟到原文不能显示或在返回原会话时从缓存复活', async mode => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const fixture = deletionServer('tool');
    const request = `GET /v4/artifacts/${fixture.artifact.id}/content?offset=0`;
    const content = fixture.hold(request);
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('本机事件流已连接');
    const tool = (await screen.findByText('读取文本')).closest('details')!;
    expect(screen.queryByLabelText('本轮产物')).toBeNull();
    await user.click(within(tool).getByText('读取文本'));
    await user.click(within(tool).getByRole('button', { name: '阅读完整回执' }));
    const panel = within(await screen.findByRole('complementary', { name: '产物' }));
    expect(await panel.findByText('正在加载产物…')).toBeTruthy();
    await waitFor(() => expect(fixture.requests.filter(item => item === request)).toHaveLength(1));
    if (mode === 'delete') await fixture.deleted();
    else {
      await user.click(screen.getByRole('button', { name: fixture.other.title }));
      await screen.findByText('另一会话历史');
    }
    if (mode === 'roundtrip') {
      await user.click(screen.getByRole('button', { name: session.title }));
      await screen.findByText('持久历史');
    }
    const text = 'deleted-artifact-content';
    await act(async () => { content.resolve(json({ text, start: 0, end: text.length, total_chars: text.length, source_version: fixture.artifact.content_hash })); });
    await waitFor(() => expect(screen.queryByTitle('产物预览')).toBeNull());
    expect(screen.queryByRole('region', { name: '产物详情' })).toBeNull();
    if (mode === 'delete') {
      expect(screen.queryByText('读取文本')).toBeNull();
      expect(screen.queryByRole('button', { name: session.title })).toBeNull();
      await user.click(screen.getByRole('button', { name: fixture.other.title }));
      await screen.findByText('另一会话历史');
    }
    if (mode === 'switch') {
      await user.click(screen.getByRole('button', { name: session.title }));
      await screen.findByText('持久历史');
    }
    expect(screen.queryByTitle('产物预览')).toBeNull();
    expect(fixture.requests.filter(item => item === request)).toHaveLength(1);
  });
  it.each(['delete', 'switch', 'roundtrip'] as const)('原生选择未返回时%s，迟到资料Ref不进入其它会话或下一次会话', async mode => {
    const fixture = deletionServer();
    const selected = deferred<{ resources: unknown[] }>();
    vi.mocked(invoke).mockReturnValue(selected.promise);
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('本机事件流已连接');
    await user.click(screen.getByRole('button', { name: '选择文本文件' }));
    if (mode === 'delete') await fixture.deleted();
    else await user.click(screen.getByRole('button', { name: fixture.other.title }));
    if (mode === 'roundtrip') await user.click(screen.getByRole('button', { name: session.title }));
    await act(async () => { selected.resolve({ resources: [{ id: secondId, version: 1,
      scope: { kind: 'session', workspace_id: id, session_id: id }, label: 'deleted-selected-notes.md', kind: 'file', source_version: null }] }); });
    expect(screen.queryByText('deleted-selected-notes.md')).toBeNull();
    await user.click(screen.getByRole('button', { name: fixture.other.title }));
    await screen.findByText('另一会话历史');
    if (mode === 'switch') await user.click(screen.getByRole('button', { name: session.title }));
    expect(screen.queryByText('deleted-selected-notes.md')).toBeNull();
  });
  it('已显示的产物原文、选择资料与历史在删除后立即清理，已删除选择不保留', async () => {
    const fixture = deletionServer('delivery');
    const text = 'already-visible-content';
    fixture.hold(`GET /v4/artifacts/${fixture.artifact.id}/content?offset=0`).resolve(json({
      text, start: 0, end: text.length, total_chars: text.length, source_version: fixture.artifact.content_hash }));
    vi.mocked(invoke).mockResolvedValue({ resources: [{ id: secondId, version: 1,
      scope: { kind: 'session', workspace_id: id, session_id: id }, label: 'selected-original.md', kind: 'file', source_version: null }] });
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('本机事件流已连接');
    await user.click(screen.getByRole('button', { name: '选择文本文件' }));
    await screen.findByText('selected-original.md');
    const delivery = within(await screen.findByLabelText('本轮产物'));
    await user.click(await delivery.findByRole('button', { name: '文本产物 1' }));
    expect((await screen.findByTitle('产物预览')).getAttribute('srcdoc')).toContain(text);
    await fixture.deleted();
    await waitFor(() => expect(screen.queryByTitle('产物预览')).toBeNull());
    expect(screen.queryByText('selected-original.md')).toBeNull();
    expect(screen.queryByText('持久历史')).toBeNull();
    expect(screen.queryByLabelText('本轮产物')).toBeNull();
    expect(screen.queryByRole('heading', { name: session.title })).toBeNull();
  });
  it('删除工作区后迟到工作区分页不能恢复选项，本地资料/预览/会话选择一并清理', async () => {
    const fixture = deletionServer();
    const workspaces = fixture.hold('GET /v4/navigation?cursor=workspaces-next');
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('本机事件流已连接');
    await user.click(await screen.findByRole('button', { name: '更多项目' }));
    await fixture.deleted(null);
    await act(async () => { workspaces.resolve(json({ default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id })); });
    expect(screen.queryByRole('button', { name: workspace.name })).toBeNull();
    expect(screen.queryByRole('button', { name: session.title })).toBeNull();
    expect(screen.queryByText('持久历史')).toBeNull();
  });
  it('创建会话响应之前收到其删除事实，不恢复新会话或抢走当前会话选择', async () => {
    const fixture = deletionServer();
    const created = fixture.hold(`POST /v4/workspaces/${id}/sessions`);
    const deletedId = '00000000-0000-4000-8000-000000000110';
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('本机事件流已连接');
    await user.click(screen.getByRole('button', { name: '新建会话' }));
    await user.type(screen.getByLabelText('新会话标题'), 'deleted-created-session');
    await user.click(screen.getByRole('button', { name: '创建会话' }));
    await fixture.deleted(deletedId);
    await act(async () => { created.resolve(json({ ...session, id: deletedId, title: 'deleted-created-session' })); });
    expect(screen.queryByRole('option', { name: 'deleted-created-session' })).toBeNull();
    expect(screen.getByRole('heading', { name: session.title })).toBeTruthy();
    expect(screen.getByText('持久历史')).toBeDefined();
  });
  it.each(['questions', 'approvals', 'history'] as const)('请求%s补页期间删除当前会话，不安装旧页内容，另一session正常', async kind => {
    const fixture = deletionServer();
    const question: Question = { id: secondId, version: 1, run_id: id, task_id: run.root_task_id, call_id: 'ask',
      message_id: secondId, question: 'deleted-question-content', answer_schema: { type: 'string' }, status: 'pending',
      answer_message_id: null, dependencies: [] };
    const path = kind === 'history' ? `/v4/sessions/${id}/messages?cursor=history-next`
      : `/v4/workspaces/${id}/${kind}?cursor=${kind}-next`;
    const held = fixture.hold('GET ' + path);
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('本机事件流已连接');
    await user.click(await screen.findByRole('button', { name: kind === 'history' ? '更多历史' : kind === 'questions' ? '更多问题' : '更多审批' }));
    await fixture.deleted();
    await act(async () => { held.resolve(json(page<unknown>(kind === 'history' ? [{ ...message,
      parts: [{ kind: 'text', text: 'deleted-history-content' }] }] : kind === 'questions' ? [question] : [fixture.approval]))); });
    await screen.findByText('另一会话历史');
    expect(screen.queryByText('deleted-question-content')).toBeNull();
    expect(screen.queryByText('deleted-approval-content', { exact: false })).toBeNull();
    expect(screen.queryByText('deleted-history-content')).toBeNull();
  });
  it('审批decision响应迟到不能在删除后恢复私有参数', async () => {
    const fixture = deletionServer();
    fixture.detail.approvals.items = [fixture.approval];
    const decision = fixture.hold(`POST /v4/approvals/${fixture.approval.id}/decision`);
    const user = userEvent.setup();
    render(<Conversation client={client} />);
    await screen.findByText('本机事件流已连接');
    await user.click(await screen.findByRole('button', { name: '查看审批' }));
    const review = within(await screen.findByRole('dialog', { name: '审批本次操作' }));
    await user.click(review.getByRole('button', { name: '允许本次操作' }));
    await fixture.deleted();
    await act(async () => { decision.resolve(json({ ...fixture.approval, version: 2, status: 'approved' })); });
    await screen.findByText('另一会话历史');
    expect(screen.queryByText('deleted-export', { exact: false })).toBeNull();
    expect(screen.queryByText('deleted-approval-content', { exact: false })).toBeNull();
  });
});
