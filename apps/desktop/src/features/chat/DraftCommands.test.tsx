import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { agent, connection, event, grant, id, limits, model, page, pendingUserCommand, resource, run, runDetailSummary, secondId } from '../../test/fixtures';
import { createDraftStore } from '../../state/draft-store';
import { Conversation } from './Conversation';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
// jsdom 未实现原生 dialog 方法；这里只模拟可见性，不替代真实 WebView 焦点验收。
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
  close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 });
const session = { id, version: 1, workspace_id: id, title: '会话 A', agent_profile_id: id, kind: 'interaction', archived: false };
const otherSession = { ...session, id: secondId, title: '会话 B' };
const task = { id: run.root_task_id, version: 1, run_id: id, binding: { agent_work: null, input_artifacts: [], input_result: null, execution_session_id: run.execution_session_id, interaction_session_id: run.interaction_session_id, config: run.config, sources: run.sources, delegation_depth: 0 }, parent_task_id: null, origin_task_id: null, kind: 'agent',
  executor_id: 'builtin.agent', state: 'running', created_seq: 1, deadline_at: null, result_version: null, reason: null };
const question = { id: secondId, version: 1, run_id: id, task_id: task.id, call_id: 'ask', message_id: id,
  question: '请确认范围', answer_schema: { type: 'string' }, status: 'pending', answer_message_id: null, dependencies: [] };
const json = (value: unknown) => Response.json(value);
function server(active: 'agent' | 'tool' | 'follow_up' | null = null, questions = false) {
  const activeRun = active === 'follow_up' ? { ...run, kind: 'follow_up', allow_follow_up: true } : run;
  const requests: { path: string; method: string; body: any }[] = [];
  const workspace = { id, version: 1, name: '项目 A', directory_resource_id: null };
  vi.mocked(invoke).mockImplementation(async name => name === 'select_resources' ? { resources: [resource] } : undefined);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', ''), method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body as string) : null; requests.push({ path, method, body });
    if (method === 'POST') return json(path.endsWith('/steering') ? { message_id: id, run_id: id, version: 2 } : path.endsWith('/commands') ? pendingUserCommand : run);
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return json(page([]));
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path === '/navigation') return json({ default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path.endsWith('/export-recovery')) return json([]);
    if (path.endsWith('/directory')) return json({ workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null });
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model, { ...model, id, model_id: 'another-model' }]), '/model-connections': page([connection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session, otherSession]), active_runs: page(active ? [activeRun] : []),
        pending_questions: page(questions ? [question] : []), pending_approvals: page([]), resources: page([resource]), grants: page([grant]), watermark: event.event_id },
      [`/sessions/${id}/messages`]: page([]), [`/sessions/${secondId}/messages`]: page([]),
      [`/sessions/${id}/runs`]: page(active ? [activeRun] : []), [`/sessions/${secondId}/runs`]: page([]),
      [`/runs/${id}`]: { ...runDetailSummary, run: activeRun, tasks: page([{ ...task, kind: active === 'tool' ? 'tool' : 'agent', executor_id: active === 'tool' ? 'builtin.tool' : 'builtin.agent' }]),
        activities: page([]), messages: page([]), artifacts: page([]), questions: page(questions ? [question] : []), approvals: page([]),
        waits: page([]), consumptions: page([]), joins: page([]), budget: { id: run.budget_id, run_id: id, version: 1, limits,
          spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id } };
    if (!(path in values)) throw new Error(`测试未定义 ${path}`);
    return json(values[path]);
  });
  return requests;
}

it.each([false, true])('发送会话草稿中固定的 Skill 版本，排队=%s', async queued => {
  const requests = server(queued ? 'follow_up' : null);
  const drafts = createDraftStore(), key = { workspaceId: id, sessionId: id };
  const selected = { [secondId]: 'a'.repeat(64) };
  const user = userEvent.setup();
  render(<Conversation client={client} draftStore={drafts} />);
  await screen.findByRole('heading', { name: session.title });
  act(() => { drafts.update(key, { skillVersions: selected }); });
  await user.type(screen.getByLabelText('消息'), '用选定版本整理发布说明');
  await user.click(screen.getByRole('button', { name: queued ? '排队发送' : '发送' }));
  const path = `/sessions/${id}/${queued ? 'commands' : 'runs'}`;
  await waitFor(() => expect(requests.find(item => item.method === 'POST' && item.path === path)?.body.data.sources.skill_versions).toEqual(selected));
  await waitFor(() => expect(drafts.read(key).skillVersions).toEqual({}));
});

it('待办收起/重开保留回答，后台到达不抢普通草稿焦点；composer 独立于消息滚动区', async () => {
  server('agent', true); const user = userEvent.setup(); render(<Conversation client={client} />);
  await user.type(await screen.findByLabelText('回答'), '暂存答案');
  await user.click(screen.getByRole('button', { name: '收起待办' }));
  await user.type(screen.getByLabelText('消息'), '普通草稿');
  expect(document.activeElement).toBe(screen.getByLabelText('消息'));
  await user.click(screen.getByRole('button', { name: '展开待办' }));
  expect((screen.getByLabelText('回答') as HTMLTextAreaElement).value).toBe('暂存答案');
  expect(screen.getByRole('region', { name: '持久对话' }).contains(screen.getByLabelText('消息'))).toBe(false);
  expect(document.querySelector('.composer-wrap .interaction-panel')).toBeTruthy();
});
it('quick 从待办定位可直接回答，不在小窗展开复杂任务图或强制打开主窗', async () => {
  server('agent', true); const user = userEvent.setup(); render(<Conversation client={client} compact />);
  await user.click(await screen.findByRole('button', { name: `定位运行 ${id}` }));
  expect(screen.getByLabelText('回答')).toBeTruthy(); expect(document.querySelector('.task-graph')).toBeNull();
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'show_workbench')).toBe(false);
});

it('A 提交期间编辑新 B、切换会话往返恢复文字/附件/模型，旧响应不清新输入', async () => {
  server(); const previous = globalThis.fetch;
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => init.method === 'POST'
    ? new Promise<Response>(resolve => { finish = resolve; }) : previous(url, init));
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.selectOptions(screen.getByLabelText('模型'), id);
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await user.type(screen.getByLabelText('消息'), 'A');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await user.clear(screen.getByLabelText('消息')); await user.type(screen.getByLabelText('消息'), '新 B');
  await user.selectOptions(screen.getByLabelText('会话'), secondId);
  await user.type(screen.getByLabelText('消息'), '另一个会话草稿');
  await act(async () => { finish(json(run)); });
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('另一个会话草稿');
  await user.selectOptions(screen.getByLabelText('会话'), id);
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('新 B');
  expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe(id);
  expect(screen.getByText(resource.label)).toBeTruthy();
});

it('跨项目返回恢复草稿 ID；附件尚未同步齐不能把已加载子集显示为全部已授权', async () => {
  server(); const previous = globalThis.fetch;
  const extra = { ...resource, id: '00000000-0000-4000-8000-000000000015', label: '尾页资料' };
  vi.mocked(invoke).mockResolvedValue({ resources: [resource, extra] });
  const other = { id: secondId, version: 1, name: '项目 B', directory_resource_id: null };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v3/workspaces') return json(page([{ id, version: 1, name: '项目 A', directory_resource_id: null }, other]));
    if (path === `/v3/workspaces/${secondId}/snapshot`) return json({ workspace: other, sessions: page([{ ...otherSession, workspace_id: secondId }]),
      active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id });
    if (path === `/v3/workspaces/${id}/snapshot`) {
      const value = await (await previous(url, init)).json();
      return json({ ...value, sessions: page([session]), resources: { ...page([resource]), next_cursor: 'remaining-resources' } });
    }
    return previous(url, init);
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), '项目 A 草稿'); await user.selectOptions(screen.getByLabelText('模型'), id);
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await user.selectOptions(screen.getByLabelText('工作区'), secondId);
  await screen.findByRole('heading', { name: otherSession.title }); await user.type(screen.getByLabelText('消息'), '项目 B 草稿');
  await user.selectOptions(screen.getByLabelText('工作区'), id);
  await screen.findByRole('heading', { name: session.title });
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('项目 A 草稿');
  expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe(id);
  expect(screen.getByText(`资料尚未同步 · ${extra.id}`)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '当前范围已授权' })).toBeNull();
  expect(screen.getByRole('button', { name: '授权状态同步中' })).toBeTruthy();
});

it('POST 成功 GET 失败显示已提交详情同步中，显式重试只 GET，不再次创建 Run', async () => {
  const requests = server(); const previous = globalThis.fetch; let fail = true;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (new URL(url).pathname === `/v3/runs/${id}` && fail) throw new TypeError('offline');
    return previous(url, init);
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), 'A'); await user.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText('已提交，详情同步中');
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('');
  fail = false; await user.click(screen.getByRole('button', { name: '重试状态同步' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重试状态同步' })).toBeNull());
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
});

it('提交响应丢失保留命令身份，not_found 仍待确认；显式原命令重试不清后来编辑的 B', async () => {
  server(); const previous = globalThis.fetch; const bodies: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') { bodies.push(JSON.parse(init.body as string)); if (bodies.length === 1) throw new TypeError('lost'); return json(run); }
    if (url.includes('/commands/')) return json({ status: 'not_found', result: null });
    return previous(url, init);
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), 'A'); await user.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText('提交状态待确认');
  await user.clear(screen.getByLabelText('消息')); await user.type(screen.getByLabelText('消息'), 'B');
  await user.click(screen.getByRole('button', { name: '核对提交状态' }));
  await screen.findByText(/未查到记录，不证明未提交/);
  await user.click(screen.getByRole('button', { name: '使用原命令重试' }));
  await waitFor(() => expect(bodies).toHaveLength(2)); expect(bodies[1]).toEqual(bodies[0]);
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('B');
});

it('ToolRun 不显示 steering，保留草稿并说明导出结束后发送，不抢输入焦点', async () => {
  const requests = server('tool'); const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  const input = screen.getByLabelText('消息'); await user.type(input, '等待导出完成后的新要求');
  await screen.findByText('导出结束后可发送；也可另开会话');
  expect(screen.queryByRole('button', { name: '补充指令' })).toBeNull();
  expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.activeElement).toBe(input);
  fireEvent.submit(input.closest('form')!);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(0);
});

it('Question 答案按 ID/version 与普通草稿分离，切会话往返不丢回答', async () => {
  server('agent', true); const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByText(question.question);
  await user.type(screen.getByLabelText('回答'), '问题草稿'); await user.type(screen.getByLabelText('消息'), '普通草稿');
  await user.selectOptions(screen.getByLabelText('会话'), secondId);
  await user.type(screen.getByLabelText('消息'), 'B 草稿');
  await user.selectOptions(screen.getByLabelText('会话'), id);
  expect((screen.getByLabelText('回答') as HTMLTextAreaElement).value).toBe('问题草稿');
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('普通草稿');
});

it('另一窗回答同 Question 后保留本窗未提交答案和普通输入，不抢焦点或自动回答', async () => {
  const requests = server('agent', true); const previous = globalThis.fetch;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => url.includes('/events?')
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } })) : previous(url, init));
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByText(question.question);
  await user.type(screen.getByLabelText('回答'), '本窗尚未提交的答案');
  const input = screen.getByLabelText('消息'); await user.type(input, '正在输入');
  const position = (BigInt(event.event_id) + 1n).toString();
  await act(async () => { stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'durable', event_id: position,
    event: { ...event, event_id: position, kind: 'question.answered', payload: { ...event.payload,
      questions: [{ ...question, version: 2, status: 'answered', answer_message_id: id }] } } })}\n\n`)); });
  await screen.findByText(/问题已处理，未提交的回答已保留：本窗尚未提交的答案/);
  expect((input as HTMLTextAreaElement).value).toBe('正在输入'); expect(document.activeElement).toBe(input);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(0);
});

it('导出用途授权待确认时切换会话，后续冻结导出仍归属原会话，核对不串路由', async () => {
  server(); const previous = globalThis.fetch;
  const artifact = { id: secondId, version: 1, task_id: task.id, activity_id: id, content_hash: 'a'.repeat(64), dependencies: [], media_type: 'text/plain' };
  const commands: { path: string; body: any }[] = []; const checks: string[] = [];
  vi.mocked(invoke).mockResolvedValue({ resources: [{ ...resource, scope: { kind: 'session', workspace_id: id, session_id: id } }] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      commands.push({ path, body: JSON.parse(init.body as string) });
      if (path.endsWith('/grants') && commands.length > 1) return json({ ...grant, scope: { kind: 'session', workspace_id: id, session_id: id } });
      throw new TypeError('response lost');
    }
    if (path.includes('/commands/')) { checks.push(path); return json({ status: 'not_found', result: null }); }
    if (path.endsWith('/grants')) return json(page([]));
    if (path.endsWith(`/sessions/${id}/runs`)) return json(page([{ ...run, state: 'completed' }]));
    if (path === `/v3/runs/${id}`) {
      const detail = await (await previous(url, init)).json();
      return json({ ...detail, run: { ...run, state: 'completed' }, artifacts: page([artifact]) });
    }
    if (path.endsWith(`/artifacts/${secondId}/content`)) return json({ text: '产物', start: 0, end: 2, total_chars: 2, source_version: 'v1' });
    return previous(url, init);
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await user.click(await screen.findByRole('button', { name: `预览产物 ${secondId}` }));
  await user.click(await screen.findByRole('button', { name: '导出产物' }));
  expect(screen.queryByRole('button', { name: '确认导出到此文件' })).toBeNull();
  await screen.findByText('提交状态待确认');
  await user.selectOptions(screen.getByLabelText('会话'), secondId);
  await user.click(screen.getByRole('button', { name: '使用原命令重试' }));
  await waitFor(() => expect(commands).toHaveLength(3));
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[2].path).toBe(`/v3/artifacts/${artifact.id}/export`);
  await user.click(screen.getByRole('button', { name: '核对提交状态' }));
  expect(checks[0]).toContain(`/v3/sessions/${id}/commands/`);
});

it('两个窗口各自保留草稿，不逐字同步，也不写 localStorage', async () => {
  server(); const write = vi.spyOn(Storage.prototype, 'setItem'); const user = userEvent.setup();
  const a = render(<Conversation client={client} />), b = render(<Conversation client={client} />);
  const first = within(a.container), second = within(b.container);
  await first.findByRole('heading', { name: session.title }); await second.findByRole('heading', { name: session.title });
  const firstInput = a.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  const secondInput = b.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  await user.type(firstInput, '窗口 A'); await user.type(secondInput, '窗口 B');
  expect(firstInput.value).toBe('窗口 A'); expect(secondInput.value).toBe('窗口 B');
  expect(write).not.toHaveBeenCalled(); write.mockRestore();
});

it('本次后台授权进入真实startRun且ack后重置，不成为下次全局默认', async () => {
  const requests = server(); const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.click(screen.getByLabelText('运行配置'));
  await user.click(screen.getByLabelText('允许本次转为独立后台任务'));
  await user.type(screen.getByLabelText('消息'), '允许这次后台处理');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(requests.some(request => request.method === 'POST')).toBe(true));
  expect(requests.find(request => request.method === 'POST')!.body.data.allow_managed).toBe(true);
  await waitFor(() => expect((screen.getByLabelText('允许本次转为独立后台任务') as HTMLInputElement).checked).toBe(false));
});

it('managed不成为当前推进者；后台问答不切会话/模型/来源/草稿，确认后返回原输入', async () => {
  const requests = server('agent', true), previous = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const response = await previous(url, init);
    if (new URL(url).pathname.endsWith('/events')) return response;
    const value = await response.json();
    function managed(value: any): any {
      if (Array.isArray(value)) return value.map(managed);
      if (!value || typeof value !== 'object') return value;
      const next = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, managed(child)]));
      if ('root_task_id' in value) return { ...next, kind: 'managed', execution_session_id: secondId, state: 'waiting_user' };
      return next;
    }
    return json(managed(value));
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByLabelText('后台任务条');
  expect(screen.queryByLabelText('回答')).toBeNull();
  const input = screen.getByLabelText('消息'); await user.type(input, '另一个目标的草稿');
  await user.selectOptions(screen.getByLabelText('模型'), id);
  expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('button', { name: '补充指令' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '回答后台问题' }));
  await user.type(await screen.findByLabelText('回答'), '仅供后台使用的答案');
  await user.click(screen.getByRole('button', { name: '提交回答' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '返回原页与草稿' })).toBeNull());
  expect((input as HTMLTextAreaElement).value).toBe('另一个目标的草稿');
  expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe(id);
  expect((screen.getByLabelText('会话') as HTMLSelectElement).value).toBe(session.id);
  expect(requests.filter(request => request.method === 'POST').map(request => request.path)).toEqual([`/questions/${question.id}/answer`]);
});

it('全局待办定位RunDetail首页外Question，仍使用原Question版本，不错答当前目标', async () => {
  const requests = server('agent'), previous = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (new URL(url).pathname === '/v3/inbox') return json(page([{ id: question.id, kind: 'question', workspace_id: id, session_id: id, run_id: id, question: { ...question, version: 5 } }]));
    if (new URL(url).pathname === `/v3/runs/${id}/questions`) return json(page([{ ...question, version: 6, status: 'answered', answer_message_id: id }]));
    if (new URL(url).pathname === `/v3/runs/${id}`) {
      const detail = await (await previous(url, init)).json();
      return json({ ...detail, questions: { ...page([]), next_cursor: 'question-tail' } });
    }
    return previous(url, init);
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), '原输入草稿');
  await user.click(screen.getByTitle('待办'));
  await user.click(await screen.findByRole('button', { name: question.question }));
  await user.type(await screen.findByLabelText('回答'), '首页外问题的答案');
  await user.click(screen.getByRole('button', { name: '提交回答' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '返回原页与草稿' })).toBeNull());
  const answer = requests.find(request => request.path === `/questions/${question.id}/answer`);
  expect(answer?.body.meta.expected_version).toBe(5);
  expect(screen.queryByLabelText('回答')).toBeNull();
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('原输入草稿');
});
