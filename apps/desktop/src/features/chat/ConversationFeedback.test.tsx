import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { ModelMessage, PendingUserCommand, RunSnapshot } from '../../generated/contracts';
import { agent, connection, event, id, limits, model, page, pendingUserCommand, run, runDetailSummary, secondId } from '../../test/fixtures';
import { Conversation } from './Conversation';
import { Toaster } from '../../components/ui/sonner';
import { toast } from 'sonner';
import type { ActivityView } from '../../generated/contracts';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
afterEach(() => { toast.dismiss(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
const workspace = { id, version: 1, name: '反馈项目', directory_resource_id: null };
const session = { id, version: 1, workspace_id: id, title: '反馈会话', agent_profile_id: id, kind: 'interaction', archived: false };
function message(n: number, runId: string, text = `输入 ${n}`): ModelMessage {
  return { id: uuid(1000 + n), run_id: runId, role: 'user', parts: [{ kind: 'text', text }], origin: 'conversation',
    activity_id: null, private_ref: null, source_dependencies: [], event_id: String(100 + n), event_index: 0 };
}
function detail(value: RunSnapshot, messages: ModelMessage[] = []) {
  return { ...runDetailSummary, run: value, tasks: page([]), activities: page([]), messages: page(messages),
    artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
    budget: { id: value.budget_id, run_id: value.id, version: 1, limits, spent_units: '0', reserved_units: '0',
      model_requests: 0, task_count: 1, steps: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id };
}
function base(path: string, sessions = [session]): unknown {
  const target = sessions.find(item => path === `/sessions/${item.id}`);
  if (target) return target;
  if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return page([]);
  if (path.endsWith('/export-recovery')) return [];
  return { '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
    '/models': page([model]), '/model-connections': page([connection]),
    '/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page(sessions), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
    [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
    [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]),
      pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
  }[path];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('后台交付实时进入会话一次，保持正在输入的草稿和焦点', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const initial = { ...message(1, run.id, '我已安排后台处理'), role: 'assistant' as const };
  const final = { ...run, state: 'completed' as const,
    output: { summary: '我已安排后台处理', artifact_ids: [], unresolved: [], handled_failures: [] } };
  const report = { ...initial, id: uuid(678), event_id: '9007199254740994',
    origin: 'background_report' as const, parts: [{ kind: 'text' as const, text: '后台交付正文' }] };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    if (path.endsWith('/messages')) return Response.json(page([initial]));
    if (path.endsWith('/runs')) return Response.json(page([final]));
    if (path === `/runs/${run.id}`) return Response.json(detail(final, [initial]));
    return Response.json(base(path));
  });
  render(<Conversation client={client} compact />);
  await screen.findByText('我已安排后台处理');
  const composer = screen.getByLabelText('消息') as HTMLTextAreaElement;
  composer.focus();
  fireEvent.change(composer, { target: { value: '另外一件事的草稿' } });
  await waitFor(() => expect(stream).toBeDefined());
  await act(async () => {
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
      kind: 'durable', event_id: report.event_id, event: { ...event, kind: 'task.stepped',
        event_id: report.event_id, payload: { ...event.payload, messages: [report] } },
    })}\n\n`));
  });
  const article = await screen.findByRole('article', { name: '后台交付' });
  expect(within(article).getByText('后台交付正文')).toBeTruthy();
  expect(screen.getAllByText('我已安排后台处理')).toHaveLength(1);
  expect(screen.getAllByText('后台交付正文')).toHaveLength(1);
  expect(composer.value).toBe('另外一件事的草稿');
  expect(document.activeElement).toBe(composer);
});

it('105条乱序UUID历史：只在任务范围保留原连接失败，翻页和重开不向聊天补发错误', async () => {
  const runs = Array.from({ length: 105 }, (_, n): RunSnapshot => ({ ...run, id: uuid(200 + n), state: 'cancelled', reason: 'user_cancelled' }));
  const messages = [...runs].reverse().map((value, n) => message(n, value.id));
  const batches: string[][] = [], heavy: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/run-feedback')) {
      const ids = parsed.searchParams.getAll('run_id'); batches.push(ids);
      return Response.json(page(ids.map(run_id => ({ run_id, version: 1, workspace_id: id, session_id: id,
        connection_id: connection.id, root_task_id: run.root_task_id, state: 'cancelled', reason: 'user_cancelled', context_usage: null,
        model_activity: { id: uuid(900), version: 3, run_id, task_id: run.root_task_id, kind: 'model',
          operation: 'model.generate', state: 'uncertain', error: 'model_authentication_failed', usage: null,
          actual_units: null, dependencies: [], script_execution: null } }))));
    }
    if (path.endsWith('/messages')) return Response.json(parsed.searchParams.has('cursor')
      ? page(messages.slice(100)) : { ...page(messages.slice(0, 100)), next_cursor: 'tail' });
    if (path.endsWith('/runs')) return Response.json({ ...page(runs.slice(0, 100)), next_cursor: 'runs-tail' });
    if (path.startsWith('/runs/')) { heavy.push(path); return Response.json(detail(runs.find(item => path.endsWith(item.id))!)); }
    return Response.json(base(path));
  });
  const view = render(<Conversation client={client} />);
  const thread = await screen.findByRole('region', { name: '持久对话' });
  await waitFor(() => expect(batches.flat()).toHaveLength(100));
  expect(within(thread).queryByText(/拒绝了此前的请求/)).toBeNull();
  expect(within(thread).queryByRole('button', { name: '检查连接' })).toBeNull();
  fireEvent.click(document.querySelector('[data-conversation-panel="tasks"]')!);
  const task = await screen.findByRole('dialog', { name: '任务详情' });
  expect(await within(task).findByText(/拒绝了此前的请求/)).toBeTruthy();
  fireEvent.click(within(task).getByRole('button', { name: '检查连接' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('show_workbench', { target: { kind: 'connection', connection_id: connection.id } }));
  fireEvent.click(screen.getByRole('button', { name: '更多历史' }));
  await waitFor(() => expect(within(thread).getAllByRole('article', { name: '你的消息' })).toHaveLength(105));
  expect(within(thread).queryByText(/拒绝了此前的请求/)).toBeNull();
  expect(batches[0]).toContain(uuid(304));
  expect(Math.max(...batches.map(ids => ids.length))).toBeLessThanOrEqual(100);
  expect(new Set(heavy).size).toBeLessThanOrEqual(2);
  view.unmount();
  render(<Conversation client={client} />);
  const reopened = await screen.findByRole('region', { name: '持久对话' });
  await waitFor(() => expect(within(reopened).getAllByRole('article', { name: '你的消息' })).toHaveLength(100));
  expect(screen.queryByText(/拒绝了此前的请求/)).toBeNull();
});

it.each([false, true])('缺凭据异步失败保留输入并定位真实连接，较新编辑不会被覆盖 newDraft=%s', async newDraft => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const input = message(0, run.id, '保留本次输入');
  let current: RunSnapshot = { ...run, state: 'queued' };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    if (path.endsWith('/runs') && init.method === 'POST') return Response.json(current);
    if (path.endsWith('/runs')) return Response.json(page([]));
    if (path.endsWith('/messages')) return Response.json(page([]));
    if (path === `/runs/${run.id}`) return Response.json(detail(current, [input]));
    if (path.endsWith('/run-feedback')) return Response.json(page([{ run_id: run.id, version: current.version,
      workspace_id: id, session_id: id, root_task_id: run.root_task_id, connection_id: connection.id,
      state: current.state, reason: current.reason, model_activity: null, context_usage: null }]));
    return Response.json(base(path));
  });
  render(<Conversation client={client} compact />);
  await screen.findByRole('heading', { name: session.title });
  const composer = screen.getByLabelText('消息') as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: '保留本次输入' } });
  await waitFor(() => expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(screen.getByRole('button', { name: '发送' }).closest('form')!);
  await waitFor(() => expect(composer.value).toBe(''));
  if (newDraft) fireEvent.change(composer, { target: { value: '后来的新输入' } });
  current = { ...current, version: 2, state: 'failed', reason: 'credential_missing' };
  await act(async () => {
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'durable', event_id: '9007199254740994',
      event: { ...event, event_id: '9007199254740994', kind: 'task.stepped',
        payload: { ...event.payload, runs: [current] } } })}\n\n`));
  });
  await waitFor(() => expect(composer.value).toBe(newDraft ? '后来的新输入' : '保留本次输入'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('show_workbench', { target: { kind: 'connection', connection_id: connection.id } }));
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'credential_status')).toBe(false);
});

it.each([
  ['receipt', 'original'], ['refresh', 'original'],
  ['receipt', 'edited'], ['refresh', 'edited'],
  ['receipt', 'other-session'], ['refresh', 'other-session'],
] as const)('排队%s迟到：command.applied与缺凭据先到仍保留%s草稿，只定位一次且不重发', async (delay, draftCase) => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const late = deferred<Response>(), writes: { path: string; body: any }[] = [];
  const other = { ...session, id: secondId, title: '独立的另一会话' };
  let queued: PendingUserCommand | undefined, held = false;
  let summary: RunSnapshot = { ...run, kind: 'follow_up' };
  let current: RunSnapshot = { ...run, id: uuid(500), root_task_id: uuid(501), state: 'queued' };
  let mark = event.event_id;
  const markedPage = <T,>(items: T[]) => ({ ...page(items), watermark: mark });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v3', '');
    if (init.method === 'POST') {
      const body = JSON.parse(init.body as string); writes.push({ path, body });
      queued = { ...pendingUserCommand, command_id: body.meta.command_id,
        start: { ...pendingUserCommand.start, ...body.data, limits: { ...limits, ...body.data.limits } } };
      return delay === 'receipt' ? late.promise : Response.json(queued);
    }
    if (path.endsWith('/events')) return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    if (path.endsWith('/commands')) {
      if (path.includes(`/sessions/${secondId}/`)) return Response.json(markedPage([]));
      if (delay === 'refresh' && queued && !held) { held = true; return late.promise; }
      return Response.json(markedPage(queued ? [queued] : []));
    }
    if (path.endsWith('/messages')) return Response.json(markedPage([]));
    if (path.endsWith('/runs')) return Response.json(markedPage(path.includes(`/sessions/${id}/`) ? [summary] : []));
    if (path === `/runs/${run.id}`) return Response.json({ ...detail(summary), watermark: mark });
    if (path === `/runs/${current.id}`) return Response.json({ ...detail(current), watermark: mark });
    if (path.endsWith('/run-feedback')) return Response.json(markedPage(parsed.searchParams.getAll('run_id').map(run_id => ({
      run_id, version: current.version, workspace_id: id, session_id: id, connection_id: connection.id,
      root_task_id: current.root_task_id, state: current.state, reason: current.reason, model_activity: null, context_usage: null,
    }))));
    if (path.endsWith('/snapshot')) {
      const value = base(path) as object;
      return Response.json({ ...value, sessions: page([session, other]), active_runs: page([summary]) });
    }
    return Response.json(base(path, [session, other]));
  });
  async function publish(offset: number, kind: 'command.applied' | 'task.stepped') {
    mark = (BigInt(event.event_id) + BigInt(offset)).toString();
    await act(async () => {
      stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'durable', event_id: mark,
        event: { ...event, event_id: mark, run_id: current.id, kind,
          payload: { ...event.payload, runs: [summary, current], pending_commands: [queued],
            messages: kind === 'command.applied' ? [{ ...message(0, current.id, '原始排队输入'), event_id: mark }] : [] } },
      })}\n\n`));
    });
  }
  render(<Conversation client={client} compact />);
  await screen.findByRole('heading', { name: session.title });
  const input = screen.getByLabelText('消息') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '原始排队输入' } });
  fireEvent.click(screen.getByRole('button', { name: '运行配置' }));
  const configuration = within(screen.getByRole('dialog', { name: '运行配置' }));
  fireEvent.click(configuration.getByRole('checkbox', { name: '完成后自动总结' }));
  fireEvent.click(configuration.getByRole('button', { name: '关闭对话框' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '排队发送' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(writes).toHaveLength(1));
  if (delay === 'refresh') await waitFor(() => expect(held).toBe(true));
  if (draftCase === 'edited') fireEvent.change(input, { target: { value: '后来编辑的输入' } });
  if (draftCase === 'other-session') {
    fireEvent.click(await screen.findByRole('button', { name: other.title }));
    await screen.findByRole('heading', { name: other.title });
    fireEvent.change(input, { target: { value: '另一会话输入' } });
  }
  summary = { ...summary, version: 2, state: 'interrupted', reason: 'yield_to_user', yield_requested: true };
  const receipt = queued!;
  queued = { ...receipt, state: 'applied', run_id: current.id };
  await publish(1, 'command.applied');
  current = { ...current, version: 2, state: 'failed', reason: 'credential_missing' };
  await publish(2, 'task.stepped');
  if (draftCase !== 'other-session') {
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'show_workbench')).toHaveLength(1));
  }
  await act(async () => { late.resolve(Response.json(delay === 'receipt' ? receipt : markedPage([queued!]))); });
  if (draftCase === 'other-session') {
    await waitFor(() => expect((input.closest('form')!.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(false));
  } else await screen.findByText('操作已确认');
  if (draftCase === 'other-session') {
    expect(input.value).toBe('另一会话输入');
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: session.title }));
    await screen.findByRole('heading', { name: session.title });
  }
  expect(input.value).toBe(draftCase === 'edited' ? '后来编辑的输入' : '原始排队输入');
  fireEvent.click(screen.getByRole('button', { name: '运行配置' }));
  const reopened = within(screen.getByRole('dialog', { name: '运行配置' }));
  expect(reopened.getByRole('checkbox', { name: '完成后自动总结' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(reopened.getByRole('button', { name: '关闭对话框' }));
  await publish(3, 'task.stepped');
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'show_workbench')).toHaveLength(draftCase === 'other-session' ? 0 : 1);
  expect(writes.map(item => item.path)).toEqual([`/sessions/${id}/commands`]);
});

it('消息反馈读取失败可明确只读重试，重试期间锁定按钮，不重提命令或恢复Activity', async () => {
  const late = deferred<Response>(), requests: { path: string; method: string }[] = [];
  const stopped: RunSnapshot = { ...run, state: 'cancelled', reason: 'user_cancelled' };
  let reads = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    requests.push({ path, method: init.method ?? 'GET' });
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/run-feedback')) {
      if (++reads === 1) throw new TypeError('fixture temporarily offline');
      return late.promise;
    }
    if (path.endsWith('/messages')) return Response.json(page([message(0, run.id)]));
    if (path.endsWith('/runs')) return Response.json(page([stopped]));
    if (path === `/runs/${run.id}`) return Response.json(detail(stopped));
    return Response.json(base(path));
  });
  render(<Conversation client={client} compact />);
  await screen.findByRole('heading', { name: session.title });
  fireEvent.click(document.querySelector('[data-conversation-panel="tasks"]')!);
  const retry = await screen.findByRole('button', { name: '重新读取消息反馈' });
  fireEvent.change(screen.getByLabelText('消息'), { target: { value: '仍在编辑的草稿' } });
  expect(reads).toBe(1);
  fireEvent.click(retry); fireEvent.click(retry);
  await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(true));
  expect(reads).toBe(2);
  await act(async () => { late.resolve(Response.json(page([{ run_id: run.id, version: run.version, workspace_id: id,
    session_id: id, root_task_id: run.root_task_id, connection_id: connection.id, state: stopped.state, reason: stopped.reason, context_usage: null,
    model_activity: { id: uuid(800), version: 3, run_id: run.id, task_id: run.root_task_id, kind: 'model', operation: 'model.generate',
      state: 'uncertain', error: 'model_authentication_failed', usage: null, actual_units: null, dependencies: [], script_execution: null } }]))); });
  expect(await screen.findByText(/拒绝了此前的请求/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重新读取消息反馈' })).toBeNull();
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('仍在编辑的草稿');
  expect(requests.every(item => item.method === 'GET')).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
});

it('切会话后不显示前会话的读取重试，迟到的重试失败也不污染当前会话', async () => {
  const late = deferred<Response>();
  const other = { ...session, id: secondId, title: '无需重试的会话' };
  let reads = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/run-feedback')) {
      if (++reads === 1) throw new TypeError('fixture offline');
      return late.promise;
    }
    if (path.endsWith('/messages')) return Response.json(page(path.includes(`/sessions/${id}/`) ? [message(0, run.id)] : []));
    if (path.endsWith('/runs')) return Response.json(page([]));
    if (path.endsWith('/snapshot')) return Response.json({ ...base(path) as object, sessions: page([session, other]) });
    return Response.json(base(path, [session, other]));
  });
  render(<Conversation client={client} compact />);
  await screen.findByRole('heading', { name: session.title });
  fireEvent.click(document.querySelector('[data-conversation-panel="tasks"]')!);
  fireEvent.click(await screen.findByRole('button', { name: '重新读取消息反馈' }));
  await waitFor(() => expect(reads).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: '关闭详情' }));
  fireEvent.click(await screen.findByRole('button', { name: other.title }));
  await screen.findByRole('heading', { name: other.title });
  await act(async () => { late.resolve(Response.json({ error: { code: 'unavailable', safe_message: 'fixture offline', related_ids: [], retryable: true } }, { status: 503 })); });
  expect(screen.queryByRole('button', { name: '重新读取消息反馈' })).toBeNull();
  expect(screen.queryByText(/暂时无法读取本会话的消息反馈/)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it.each([false, true])('新认证错误只在前台右上角出现一次并定位失败连接，关闭后草稿仍在 compact=%s', async compact => {
  toast.dismiss();
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let current = { ...run };
  let activity: ActivityView = { id: uuid(700), run_id: run.id, task_id: run.root_task_id, version: 1,
    kind: 'model', operation: 'model.generate', state: 'dispatched', error: null, usage: null,
    actual_units: null, dependencies: [], script_execution: null };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    if (path.endsWith('/messages')) return Response.json(page([message(0, run.id, '问文档')]));
    if (path.endsWith('/runs')) return Response.json(page([current]));
    if (path.endsWith('/run-feedback')) return Response.json(page([]));
    if (path === `/runs/${run.id}`) return Response.json({ ...detail(current), activities: page([activity]) });
    return Response.json(base(path));
  });
  const view = render(<><Conversation client={client} compact={compact} /><Toaster /></>);
  await screen.findByRole('heading', { name: session.title });
  const input = screen.getByLabelText('消息') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '未发送的下一轮草稿' } });
  current = { ...current, version: 2, state: 'failed', reason: 'model_authentication_failed' };
  activity = { ...activity, version: 2, state: 'failed', error: 'model_authentication_failed' };
  async function publish(offset: number, activities = [activity]) {
    const mark = (BigInt(event.event_id) + BigInt(offset)).toString();
    await act(async () => { stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
      kind: 'durable', event_id: mark, event: { ...event, kind: 'activity.received', event_id: mark,
        payload: { ...event.payload, runs: [current], activities } },
    })}\n\n`)); });
  }
  await publish(1);
  const notification = await screen.findByText(/拒绝了此连接的凭据/, { selector: '[data-sonner-toast] [data-title]' });
  expect(notification.closest('[data-sonner-toaster]')?.getAttribute('data-y-position')).toBe('top');
  expect(notification.closest('[data-sonner-toaster]')?.getAttribute('data-x-position')).toBe('right');
  expect(notification.closest('[data-sonner-toast]')?.getAttribute('data-type')).toBe('error');
  fireEvent.click(within(notification.closest('li')!).getByRole('button', { name: '检查连接' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('show_workbench', { target: { kind: 'connection', connection_id: connection.id } }));
  await waitFor(() => expect(screen.queryAllByText(/拒绝了此连接的凭据/, { selector: '[data-sonner-toast] [data-title]' })).toHaveLength(0));
  await publish(2);
  await publish(3, []);
  expect(screen.queryAllByText(/拒绝了此连接的凭据/, { selector: '[data-sonner-toast] [data-title]' })).toHaveLength(0);
  expect(input.value).toBe('未发送的下一轮草稿');
  focus.mockReturnValue(false);
  activity = { ...activity, id: uuid(701) };
  await publish(4);
  expect(screen.queryAllByText(/拒绝了此连接的凭据/, { selector: '[data-sonner-toast] [data-title]' })).toHaveLength(0);
  focus.mockReturnValue(true);
  await publish(5);
  expect(screen.queryAllByText(/拒绝了此连接的凭据/, { selector: '[data-sonner-toast] [data-title]' })).toHaveLength(0);
  current = { ...current, version: 3, state: 'cancelled', reason: 'user_cancelled' };
  activity = { ...activity, id: uuid(702), error: 'cancelled' };
  await publish(6);
  expect(screen.queryByText('模型请求未完成，请查看任务。', { selector: '[data-sonner-toast] [data-title]' })).toBeNull();
  view.unmount();
  render(<><Conversation client={client} compact={compact} /><Toaster /></>);
  await screen.findByRole('heading', { name: session.title });
  expect(screen.queryAllByText(/拒绝了此连接的凭据/, { selector: '[data-sonner-toast] [data-title]' })).toHaveLength(0);
});

it('会话只显示同轮一次最终答复，重新挂载仍保留同文不同轮的两份答复', async () => {
  const output = { summary: '两轮相同的正式答复', artifact_ids: [], unresolved: [], handled_failures: [] };
  const first = { ...run, state: 'completed' as const, output }, second = { ...first, id: secondId };
  const messages: ModelMessage[] = [
    message(0, first.id, '第一轮'), { ...message(1, first.id, output.summary), role: 'assistant' },
    message(2, second.id, '第二轮'), { ...message(3, second.id, output.summary), role: 'assistant' },
  ];
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/messages')) return Response.json(page(messages));
    if (path.endsWith('/runs')) return Response.json(page([second, first]));
    if (path.endsWith('/run-feedback')) return Response.json(page([]));
    if (path.startsWith('/runs/')) return Response.json(detail(path.endsWith(first.id) ? first : second));
    return Response.json(base(path));
  });
  const view = render(<Conversation client={client} />);
  await waitFor(() => expect(screen.getAllByText(output.summary)).toHaveLength(2));
  expect(document.querySelector('.run-output')).toBeNull();
  view.unmount();
  render(<Conversation client={client} compact />);
  await waitFor(() => expect(screen.getAllByText(output.summary)).toHaveLength(2));
});
