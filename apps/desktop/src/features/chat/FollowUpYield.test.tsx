import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { expectComposerModel, selectComposerModel } from '../../test/composer-model';
import type { ModelMessage, PendingUserCommand, RunSnapshot, TaskResult } from '../../generated/contracts';
import { agent, binding, connection, event, followUpIntent, grant, id, limits, model, page, pendingUserCommand, resource, resultEntry, run, runDetailSummary, secondId } from '../../test/fixtures';
import { Conversation } from './Conversation';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
const session = { id, version: 1, workspace_id: id, title: '总结中的会话', agent_profile_id: id, kind: 'interaction', archived: false };
const other = { ...session, id: secondId, title: '另一个会话' };
function server(initial: RunSnapshot | null = { ...run, kind: 'follow_up', version: 5 }, messages: ModelMessage[] = []) {
  const requests: { path: string; body: any; method: string }[] = [];
  const coverageChecks: { path: string; method: string; body: unknown }[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let current = initial, commands: PendingUserCommand[] = [], intents = initial?.kind === 'follow_up' ? [followUpIntent] : [];
  let lost = false, defer: ((receipt: Response) => void) | undefined;
  let hold = false;
  const workspace = { id, version: 1, name: '项目', directory_resource_id: null };
  vi.mocked(invoke).mockResolvedValue({ resources: [resource] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', ''), method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (path.endsWith('/resource-coverage')) {
      coverageChecks.push({ path, method, body });
      return Response.json({ allowed: true, destination: connection.endpoint, missing_read: [], missing_model_send: [] });
    }
    requests.push({ path, body, method });
    if (method === 'POST') {
      if (path.endsWith('/commands')) {
        const receipt = { ...pendingUserCommand, command_id: body.meta.command_id,
          start: { ...pendingUserCommand.start, ...body.data, limits: { ...limits, ...body.data.limits } }, config: { ...run.config, model_profile: { ...run.config.model_profile, id: body.data.model_profile_id } } };
        commands = [receipt];
        if (lost) { lost = false; throw new TypeError('response lost'); }
        if (hold) return new Promise<Response>(resolve => { defer = resolve; });
        return Response.json(receipt);
      }
      if (path.endsWith('/steering')) return Response.json({ message_id: secondId, run_id: current!.id, version: current!.version + 1 });
      if (path.endsWith('/runs')) { current = { ...run, id: secondId, root_task_id: secondId, budget_group_id: secondId }; return Response.json(current); }
      throw new Error(`未定义POST ${path}`);
    }
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); } }));
    if (path.endsWith('/commands')) return Response.json(page(path.includes(`/sessions/${id}/`) ? commands : []));
    if (path.includes('/commands/')) return Response.json({ status: 'confirmed', result: commands[0] });
    if (path.endsWith('/follow-ups')) return Response.json(page(path.includes(`/sessions/${id}/`) ? intents : []));
    if (path.endsWith('/results')) return Response.json(page([resultEntry]));
    if (path.endsWith('/export-recovery')) return Response.json([]);
    if (path.endsWith('/messages')) return Response.json(page(messages));
    if (path.endsWith('/runs')) return Response.json(page(path.includes(`/sessions/${id}/`) && current ? [current] : []));
    if (path.startsWith('/runs/')) return Response.json({ ...runDetailSummary, run: current!,
      tasks: page([{ id: current!.root_task_id, version: 1, run_id: current!.id, parent_task_id: null, origin_task_id: null,
        kind: 'agent', executor_id: 'builtin.agent', binding, created_seq: 1, deadline_at: null, result_version: null, reason: null, state: 'running' }]),
      budget: { id: current!.budget_id, run_id: current!.id, version: 1, limits, spent_units: '0', reserved_units: '0',
        model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 },
      activities: page([]), messages: page(messages), artifacts: page([]), questions: page([]), approvals: page([]),
      waits: page([]), consumptions: page([]), joins: page([]), watermark: (BigInt(event.event_id) + 50n).toString() });
    if (path === '/navigation') return Response.json({ default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session, other]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path === `/sessions/${id}`) return Response.json(session);
    if (path === `/sessions/${secondId}`) return Response.json(other);
    if (path.endsWith('/directory')) return Response.json({ workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null });
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model, { ...model, id, model_id: 'new-model' }]), '/model-connections': page([connection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session, other]), active_runs: page(current ? [current] : []),
        pending_questions: page([]), pending_approvals: page([]), resources: page([resource]), grants: page([grant]), watermark: event.event_id } };
    if (!(path in values)) throw new Error(`未定义GET ${path}`);
    return Response.json(values[path]);
  });
  return {
    requests, coverageChecks, lose: () => { lost = true; }, hold: () => { hold = true; },
    release: () => { defer!(Response.json(commands[0])); },
    async change(next: RunSnapshot, state: PendingUserCommand['state'], offset: number) {
      current = next; commands = commands.map(command => ({ ...command, state, run_id: state === 'applied' ? next.id : null,
        reason: state === 'cancelled' ? 'deadline_exceeded' : null }));
      intents = intents.map(intent => ({ ...intent, status: next.reason === 'yield_to_user' ? 'paused' : 'active', reason: next.reason }));
      const position = (BigInt(event.event_id) + BigInt(offset)).toString();
      await act(async () => { for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
        kind: 'durable', event_id: position, event: { ...event, kind: `command.${state}`, event_id: position, run_id: null,
          payload: { ...event.payload, runs: [next], pending_commands: commands, follow_up_intents: intents } },
      })}\n\n`)); });
    },
  };
}

it('自动总结许可默认关闭，与独立后台许可分别提交并在同revision确认后重置', async () => {
  const api = server(null), user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  const trigger = screen.getByRole('button', { name: '运行配置' });
  await user.click(trigger);
  const dialog = within(await screen.findByRole('dialog', { name: '运行配置' }));
  await user.click(dialog.getByRole('checkbox', { name: '完成后自动总结', checked: false }));
  expect(dialog.getByRole('checkbox', { name: '完成后自动总结', checked: true })).toBeTruthy();
  expect(dialog.getByRole('checkbox', { name: '允许本次转为独立后台任务', checked: false })).toBeTruthy();
  await user.click(dialog.getByRole('button', { name: '关闭对话框' }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await user.type(screen.getByLabelText('消息'), '本次允许总结');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe(''));
  const write = api.requests.find(request => request.method === 'POST')!;
  expect(write.path).toBe(`/sessions/${id}/runs`);
  expect(write.body.data).toMatchObject({ allow_follow_up: true, allow_managed: false, source_result: null });
  await user.click(trigger);
  const reopened = within(await screen.findByRole('dialog', { name: '运行配置' }));
  expect(reopened.getByRole('checkbox', { name: '完成后自动总结', checked: false })).toBeTruthy();
});

it('follow_up默认新目标排队，模型/来源/许可/限额独立；明确修改总结才带原Run版本steer', async () => {
  const api = server(), user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await selectComposerModel(user, id);
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  expect(invoke).toHaveBeenCalledWith('select_resources', { scope: { kind: 'session', workspace_id: id, session_id: id }, kind: 'file' });
  const trigger = screen.getByRole('button', { name: '运行配置' });
  await user.click(trigger);
  const dialog = within(await screen.findByRole('dialog', { name: '运行配置' }));
  await user.click(dialog.getByRole('checkbox', { name: '完成后自动总结', checked: false }));
  await user.click(dialog.getByText('本次限额', { selector: 'summary' }));
  await user.type(dialog.getByRole('spinbutton', { name: '模型请求上限' }), '3');
  await user.click(dialog.getByRole('button', { name: '关闭对话框' }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await user.type(screen.getByLabelText('消息'), '新目标');
  await user.click(screen.getByRole('button', { name: '排队发送' }));
  await screen.findByText('已排队，输入已保存，尚未开始执行');
  expect(api.coverageChecks.at(-1)).toEqual({ path: `/sessions/${id}/resource-coverage`, method: 'POST',
    body: { resource_ids: [resource.id], model_profile_id: id } });
  expect(api.requests.filter(request => request.method === 'POST')).toMatchObject([{ path: `/sessions/${id}/commands`,
    body: { data: { model_profile_id: id, text: '新目标', allow_follow_up: true, allow_managed: false,
      sources: { resource_ids: [resource.id], memory_scopes: [] }, limits: { max_model_requests: 3 } } } }]);
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('');
  await user.click(screen.getByRole('radio', { name: '修改这个总结', checked: false }));
  expect(screen.getByRole('radio', { name: '修改这个总结', checked: true })).toBeTruthy();
  await user.type(screen.getByLabelText('消息'), '请总结得更简洁');
  await user.click(screen.getByRole('button', { name: '补充指令' }));
  const writes = api.requests.filter(request => request.method === 'POST');
  expect(writes.map(request => request.path)).toEqual([`/sessions/${id}/commands`, `/runs/${id}/steering`]);
  expect(writes[1].body.meta.expected_version).toBe(5);
  expect(writes[1].body.data).toEqual({ text: '请总结得更简洁' });
});

it('队列响应丢失核对不重交，另一窗新草稿与本窗后来revision均不被applied/cancelled清空', async () => {
  const api = server(), user = userEvent.setup(); api.lose();
  const a = render(<Conversation client={client} />), b = render(<Conversation client={client} compact />);
  const first = within(a.container), second = within(b.container);
  await first.findByRole('heading', { name: session.title }); await second.findByRole('heading', { name: session.title });
  const inputA = a.container.querySelector<HTMLTextAreaElement>('#message-input')!, inputB = b.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  await user.type(inputA, 'A'); await user.click(first.getByRole('button', { name: '排队发送' }));
  await first.findByText('提交状态待确认');
  expect(inputA.value).toBe('A');
  await user.clear(inputA); await user.type(inputA, '后来编辑');
  await user.type(inputB, '小窗草稿'); await selectComposerModel(user, id, second);
  await user.click(first.getByRole('button', { name: '核对提交状态' }));
  await first.findByText('已排队，输入已保存，尚未开始执行');
  expect(inputA.value).toBe('后来编辑'); expect(inputB.value).toBe('小窗草稿');
  const paused: RunSnapshot = { ...run, kind: 'follow_up', version: 6, state: 'interrupted', reason: 'yield_to_user', yield_requested: true };
  await api.change(paused, 'cancelled', 1);
  await first.findByText(/输入已取消：deadline_exceeded/);
  await second.findByText(/输入已取消：deadline_exceeded/);
  expect(inputA.value).toBe('后来编辑'); expect(inputB.value).toBe('小窗草稿');
  await expectComposerModel(user, model.id, first);
  await expectComposerModel(user, id, second);
  expect(first.queryByLabelText('修改这个总结')).toBeNull();
  expect(first.getByRole('button', { name: '发送' })).toBeTruthy();
  const writes = api.requests.filter(request => request.method === 'POST');
  expect(writes).toMatchObject([{ path: `/sessions/${id}/commands`,
    body: { data: { text: 'A', model_profile_id: model.id } } }]);
  const commandId = writes[0].body.meta.command_id;
  expect(api.requests.filter(request => request.path.includes('/commands/'))).toMatchObject([
    { method: 'GET', path: `/sessions/${id}/commands/${commandId}` },
  ]);
});

it('已经接收但随后取消的排队模型不会进入项目最近使用', async () => {
  const api = server(), user = userEvent.setup();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await selectComposerModel(user, id);
  fireEvent.change(screen.getByLabelText('消息'), { target: { value: '尚未运行的队列输入' } });
  await user.click(screen.getByRole('button', { name: '排队发送' }));
  await screen.findByText('已排队，输入已保存，尚未开始执行');
  await api.change({ ...run, kind: 'follow_up', version: 6, state: 'interrupted', reason: 'yield_to_user' }, 'cancelled', 1);
  await screen.findByText(/输入已取消：deadline_exceeded/);
  await user.click(screen.getByRole('button', { name: other.title }));
  await screen.findByRole('heading', { name: other.title });
  await user.click(screen.getByRole('button', { name: '选择模型' }));
  expect(screen.queryByRole('group', { name: '最近使用' })).toBeNull();
});

it('队列接收迟到只确认原草稿revision，切会话返回保持独立配置；让出/恢复仍展示原总结Run', async () => {
  const api = server(), user = userEvent.setup(); api.hold(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), '旧草稿');
  await user.click(screen.getByRole('button', { name: '排队发送' }));
  fireEvent.change(screen.getByLabelText('消息'), { target: { value: '后来草稿' } });
  await user.click(screen.getByRole('button', { name: other.title }));
  await user.type(screen.getByLabelText('消息'), '另一会话');
  await act(async () => { api.release(); });
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('另一会话');
  await user.click(screen.getByRole('button', { name: session.title }));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('后来草稿');
  await api.change({ ...run, kind: 'follow_up', version: 6, yield_requested: true }, 'queued', 1);
  await screen.findByText('正在让出，等待安全边界');
  await api.change({ ...run, kind: 'follow_up', version: 7, state: 'interrupted', reason: 'yield_to_user', yield_requested: true }, 'applied', 2);
  await screen.findByText('已让出，等待会话空闲后继续原总结');
  expect(screen.getAllByLabelText('自动总结条')).toHaveLength(1);
  await api.change({ ...run, kind: 'follow_up', version: 8 }, 'applied', 3);
  await screen.findByText('正在自动总结');
  expect(screen.getAllByLabelText('自动总结条')).toHaveLength(1);
});

it.each([false, true])('显式结果总结绑定Inbox引用，以本次配置发新用户命令，follow_up期间排队=%s', async automatic => {
  const api = server(automatic ? { ...run, kind: 'follow_up' } : null), user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), '请列出关键结论');
  await selectComposerModel(user, id);
  await user.click(screen.getByRole('button', { name: /^结果/ }));
  await user.click(await screen.findByRole('button', { name: '在会话中总结' }));
  expect(api.requests.filter(request => request.method === 'POST')).toHaveLength(0);
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('请列出关键结论');
  await user.click(screen.getByRole('button', { name: automatic ? '排队发送' : '发送' }));
  const write = api.requests.find(request => request.method === 'POST')!;
  expect(write.path).toBe(automatic ? `/sessions/${id}/commands` : `/sessions/${id}/runs`);
  expect(write.body.data).toMatchObject({ text: '请列出关键结论', model_profile_id: id, source_result: resultEntry.id });
  expect(api.requests.some(request => request.path.endsWith('/view') || request.path.endsWith('/retry') || request.path.endsWith('/resume'))).toBe(false);
});

it('普通user运行仍steer，不出现总结输入模式，也不将许可或新配置写入旧Run', async () => {
  const api = server(run), user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('button', { name: '停止当前运行' });
  expect(screen.queryByLabelText('修改这个总结')).toBeNull();
  expect(screen.getByRole('button', { name: '选择模型' })).toHaveProperty('disabled', true);
  await user.type(screen.getByLabelText('消息'), '普通补充');
  await user.click(screen.getByRole('button', { name: '补充指令' }));
  expect(api.requests.find(request => request.method === 'POST')).toMatchObject({ path: `/runs/${id}/steering`,
    body: { data: { text: '普通补充' }, meta: { expected_version: 1 } } });
});

it('总结让出后曾选的修改模式失效，同Run恢复时新输入仍默认排队', async () => {
  const api = server(), user = userEvent.setup(); render(<Conversation client={client} />);
  await user.click(await screen.findByLabelText('修改这个总结'));
  await user.type(screen.getByLabelText('消息'), '未发送的输入');
  await api.change({ ...run, kind: 'follow_up', version: 6, state: 'interrupted', reason: 'yield_to_user', yield_requested: true }, 'queued', 1);
  await screen.findByText('已让出，等待会话空闲后继续原总结');
  await api.change({ ...run, kind: 'follow_up', version: 7 }, 'queued', 2);
  expect(screen.getByRole('radio', { name: '新目标（默认排队）', checked: true })).toBeTruthy();
  expect(screen.getByRole('button', { name: '排队发送' })).toBeTruthy();
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('未发送的输入');
});

it.each([
  ['user', false], ['follow_up', false], ['user', true], ['follow_up', true],
] as const)('%s总结的上下文输入仅显示交付标记；compact=%s 经收件箱查当前授权详情', async (kind, compact) => {
  const context: TaskResult = { handle: resultEntry.result, result_version: resultEntry.result_version, state: 'completed',
    result: { summary: '上下文旧正文，不应直接显示', structured_result: { internal: 'context-only-body' } },
    dependencies: [{ scope_id: '00000000-0000-4000-8000-000000000041', epoch: 1 }], artifacts: [], error: null };
  const original = '{"origin":"task_result","result":{"summary":"用户自己输入的JSON"}}';
  const messages: ModelMessage[] = [
    { id: '00000000-0000-4000-8000-000000000042', role: 'user', origin: 'conversation', parts: [{ kind: 'text', text: original }],
      run_id: run.id, activity_id: null, private_ref: null, source_dependencies: [], event_id: event.event_id, event_index: 0 },
    { id: '00000000-0000-4000-8000-000000000043', role: 'user', origin: 'task_result', parts: [{ kind: 'text', text: JSON.stringify(context) }],
      run_id: run.id, activity_id: null, private_ref: '00000000-0000-4000-8000-000000000045', source_dependencies: context.dependencies, event_id: event.event_id, event_index: 1 },
    { id: '00000000-0000-4000-8000-000000000044', role: 'assistant', origin: 'conversation', parts: [{ kind: 'text', text: '最终助理总结，保留正常呈现' }],
      run_id: run.id, activity_id: null, private_ref: null, source_dependencies: [], event_id: event.event_id, event_index: 2 },
  ];
  const frozen = JSON.stringify(messages);
  const api = server({ ...run, kind, state: 'completed' }, messages), previous = globalThis.fetch;
  let valid = true;
  const detailRequests: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/results')) return Response.json(page([{ ...resultEntry, source_valid: valid }]));
    if (path === `/v3/results/${resultEntry.id}/view`) {
      detailRequests.push('view');
      return Response.json({ ...resultEntry, viewed_at: '2026-11-18T12:00:00Z' });
    }
    if (path === `/v3/tasks/${resultEntry.result.task_id}/result`) {
      detailRequests.push('result');
      return Response.json({ ...context, result: { status: 'completed', summary: '授权查询后的交付详情', structured_result: {},
        unresolved: [], artifact_ids: [], evidence_refs: [], verification: [], handled_failures: [] } });
    }
    return previous(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={client} compact={compact} />);
  await screen.findByText('最终助理总结，保留正常呈现');
  const history = screen.getByRole('region', { name: '持久对话' });
  expect(within(history).getByText(original)).toBeTruthy();
  expect(history.textContent).not.toMatch(/上下文旧正文|context-only-body|00000000-0000-4000-8000-00000000004[15]/);
  expect(history.querySelectorAll('.message--user')).toHaveLength(1);
  expect(within(history).getByText(/已接收任务交付/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: '结果收件箱' })).toBeNull();
  await user.click(within(history).getByRole('button', { name: '打开结果收件箱' }));
  await screen.findByRole('region', { name: '结果收件箱' });
  expect(screen.getByRole('dialog', { name: '后台交付结果' }).contains(document.activeElement)).toBe(true);
  expect(detailRequests).toEqual([]);
  expect(api.requests.filter(request => request.method === 'POST')).toEqual([]);
  await user.click(await screen.findByRole('button', { name: '查看结果' }));
  await screen.findByText('授权查询后的交付详情');
  expect(detailRequests).toEqual(['view', 'result']);
  expect(history.textContent).not.toMatch(/上下文旧正文|context-only-body|00000000-0000-4000-8000-00000000004[15]/);
  valid = false;
  await user.click(screen.getByRole('button', { name: '刷新结果' }));
  await screen.findByText('来源已失效，正文不可用');
  expect(screen.queryByText('授权查询后的交付详情')).toBeNull();
  expect(history.textContent).not.toMatch(/上下文旧正文|context-only-body|00000000-0000-4000-8000-00000000004[15]/);
  expect(detailRequests).toEqual(['view', 'result']);
  expect(JSON.stringify(messages)).toBe(frozen);
});
