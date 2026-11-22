import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import Settings from '../features/settings/Settings';
import { RuntimeClient } from '../api/client';
import type { PendingCounts } from '../api/windows';
import type { Approval, ModelMessage, Question, RunDetail, RunSnapshot, StreamEvent } from '../generated/contracts';
import { expectComposerModel } from '../test/composer-model';
import { agent, connection, event, id, limits, model, page, run, runDetailSummary, secondId } from '../test/fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); window.history.replaceState(null, '', '/'); });
const json = (value: unknown) => new Response(JSON.stringify(value));
const connectionInfo = { base_url: 'http://127.0.0.1:54321', token: 'test-runtime-token', protocol_version: 4 };
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const settings = { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
const workspace = { id, version: 1, name: '工作笔记', directory_resource_id: null };
const session = { id, version: 1, workspace_id: id, title: '原有会话', agent_profile_id: id, kind: 'interaction', archived: false };
const profile = { ...agent, display_name: '笔记助理', default_model_profile_id: model.id };
const noPending = { pending_questions: 0, pending_approvals: 0, pending_actions: 0, unviewed_results: 0 };
const petName = 'FlowMate 折纸鸟，切换快捷小窗';

function boundary(label = 'quick') {
  window.history.replaceState(null, '', `/?window=${label}`);
  const handlers = new Map<string, EventCallback<any>>();
  const unlisten = vi.fn();
  vi.mocked(listen).mockImplementation(async (name, callback) => { handlers.set(name, callback); return unlisten; });
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'runtime_connection') return { base_url: 'http://127.0.0.1:54321', token: 'test-runtime-token', protocol_version: 4 };
    if (name === 'window_settings') return settings;
    if (name === 'pending_counts' || name === 'take_workbench_navigation' || name === 'take_settings_navigation') return null;
    if (name === 'select_resources') return { resources: [{ id: secondId, version: 1, scope: (args as any).scope, label: 'notes.md', kind: 'file', source_version: null }] };
    return undefined;
  });
  return { handlers, unlisten };
}

function businessServer() {
  const commands: { path: string; body: any }[] = [];
  const requests: string[] = [];
  let state: RunSnapshot | undefined;
  let savedGrant: unknown;
  let createdSession = session;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const approval: Approval = { mcp: null, id: uuid(10), version: 1, workspace_id: id, session_id: id, run_id: id,
    task_id: run.root_task_id, activity_id: uuid(11), call_id: 'write', tool_name: 'artifacts.export', tool_version: '1',
    args_hash: 'hash', target: secondId, export_preview: { target_path: 'C:\\Synthetic\\report.md', target_exists: false, artifact_id: id, artifact_version: 1 }, parameters: { target_ref: secondId }, dependencies: [], expires_at: '2026-11-07T13:00:00Z', status: 'pending' };
  const question: Question = { id: uuid(12), version: 1, run_id: id, task_id: run.root_task_id, call_id: 'ask', message_id: uuid(13),
    question: '报告采用哪个范围？', answer_schema: { type: 'string' }, status: 'pending', answer_message_id: null, dependencies: [] };
  const artifact = { id: uuid(14), version: 1, task_id: run.root_task_id, activity_id: uuid(11), content_hash: 'a'.repeat(64), dependencies: [], media_type: 'text/markdown' };
  const message: ModelMessage = { id: uuid(15), role: 'assistant', parts: [{ kind: 'text', text: '已经完成笔记报告。' }],
    source_dependencies: [], run_id: run.id, activity_id: null, private_ref: null, origin: 'conversation', event_id: event.event_id, event_index: 0 };
  function detail(): RunDetail {
    return { ...runDetailSummary, run: state!, tasks: page([]), activities: page([]), messages: page(state?.state === 'completed' ? [message] : []),
      artifacts: page(state?.state === 'completed' ? [artifact] : []) as RunDetail['artifacts'],
      questions: page(state?.state === 'waiting_user' ? [question] : state?.state === 'completed' ? [{ ...question, version: 2, status: 'answered', answer_message_id: uuid(18) }] : []), approvals: page(state?.state === 'waiting_approval' ? [approval] : []),
      waits: page([]), consumptions: page([]), joins: page([]), watermark: event.event_id,
      budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 1, steps: 1, task_count: 1, total_tokens: 0, reserved_tokens: 0 } };
  }
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v4', ''); requests.push(path);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-runtime-token');
    if (path.endsWith('/resource-coverage')) {
      const allowed = commands.some(command => command.path === '/grants');
      const ids = JSON.parse(init.body as string).resource_ids;
      return json({ allowed, destination: connection.endpoint, missing_read: allowed ? [] : ids,
        missing_model_send: allowed ? [] : ids });
    }
    if (init.method === 'POST') {
      const body = JSON.parse(init.body as string); commands.push({ path, body });
      if (path === '/grants') {
        savedGrant = { ...body.data, memory_scopes: [], mcp_versions: {}, mcp_queries: [],
          id: uuid(16), version: 1, epoch: 1, status: 'active' };
        return json(savedGrant);
      }
      if (path.endsWith('/sessions')) { createdSession = { ...session, id: uuid(17), title: body.data.title }; return json(createdSession); }
      if (path.endsWith('/runs')) { approval.session_id = createdSession.id; state = { ...run, interaction_session_id: createdSession.id, execution_session_id: createdSession.id, state: 'waiting_approval', config: { ...run.config, agent_profile: profile } }; return json(state); }
      if (path.endsWith('/decision')) return json({ ...approval, version: 2, status: 'approved' });
      if (path.endsWith('/answer')) { state = { ...state!, version: 3, state: 'completed', output: { summary: '笔记报告已交付', artifact_ids: [artifact.id], unresolved: [], handled_failures: [] } }; return json(state); }
      throw new Error(`未定义命令 ${path}`);
    }
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/results')) return json(page([]));
    if (path === `/workspaces/${id}/grants`) return json(page(savedGrant ? [savedGrant] : []));
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([profile]), '/models': page([model]), '/model-connections': page([connection]),
      '/capabilities/mcp': page([]),
      '/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([createdSession]), pending_count: 0 }]),
        recent_sessions: page([createdSession]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([createdSession]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/messages`]: page([]), [`/sessions/${id}/runs`]: page(state ? [state] : []),
      [`/sessions/${createdSession.id}/messages`]: page([]), [`/sessions/${createdSession.id}/runs`]: page(state ? [state] : []),
      [`/runs/${id}`]: state ? detail() : undefined,
      [`/artifacts/${artifact.id}/content`]: { text: '# 真实产物内容', start: 0, end: 8, total_chars: 8, source_version: 'v1' } };
    if (!(path in values)) throw new Error(`未定义查询 ${path}`);
    return json(values[path]);
  });
  return { commands, requests, artifact, async ask() {
    state = { ...state!, version: 2, state: 'waiting_user' };
    const value: StreamEvent = { kind: 'durable', event_id: '9007199254740994', event: { ...event, session_id: createdSession.id, kind: 'question.asked', event_id: '9007199254740994', seq: 2,
      payload: { runs: [state], tasks: [], activities: [], budgets: [], messages: [], artifacts: [], questions: [question], waits: [], consumptions: [], joins: [], pending_commands: [], follow_up_intents: [] } } };
    await act(async () => { stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)); });
  } };
}

// 覆盖建会话、资料授权、运行、审批、问答与产物预览，完整交互使用单例时间预算。
it('test_quick_completes_without_opening_main', { timeout: 15_000 }, async () => {
  boundary(); const server = businessServer(); const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: profile.display_name });
  expect(document.querySelector('.workbench--compact')).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: '项目导航' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '打开项目导航' }));
  const navigation = screen.getByRole('dialog', { name: '项目导航' });
  await user.click(within(navigation).getByRole('button', { name: '新建会话' }));
  await user.type(screen.getByLabelText('新会话标题'), '小窗独立任务');
  await user.click(screen.getByRole('button', { name: '创建会话' }));
  await screen.findByRole('heading', { name: '小窗独立任务' });
  await user.type(screen.getByLabelText('消息'), '整理选中的笔记');
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await screen.findByText('notes.md');
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: '发送' }).disabled).toBe(false));
  expect(screen.getByText(/点击发送即同意本次读取/).textContent).toContain(connection.endpoint);
  expect(screen.queryByRole('button', { name: /授权读取并发送/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: '发送' }));
  await user.click(await screen.findByRole('button', { name: '查看审批' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '允许本次操作' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '允许本次操作' })).toBeNull());
  await server.ask();
  await user.type(await screen.findByLabelText('回答'), '全部笔记');
  await user.click(screen.getByRole('button', { name: '提交回答' }));
  await screen.findByText('已经完成笔记报告。');
  expect(screen.queryByLabelText('回答')).toBeNull();
  expect(screen.getAllByText('笔记报告已交付')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: '产物' }));
  await user.click(screen.getByRole('button', { name: 'Markdown 文档 1' }));
  expect((await screen.findByTitle('产物预览')).getAttribute('srcdoc')).toContain('真实产物内容');
  expect(screen.getByTitle('产物预览').getAttribute('sandbox')).toBe('');
  expect(server.commands.map(command => command.path)).toEqual([`/workspaces/${id}/sessions`, '/grants', `/sessions/${uuid(17)}/runs`, `/approvals/${uuid(10)}/decision`, `/questions/${uuid(12)}/answer`]);
  expect(server.commands[2].body.data).toMatchObject({ agent_profile_id: profile.id, model_profile_id: model.id, text: '整理选中的笔记', sources: { resource_ids: [secondId] } });
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'show_workbench')).toBe(false);
});

it('quick展开只传当前Run ID，展开和显式隐藏均保留本WebView草稿', async () => {
  boundary(); const server = businessServer(); const user = userEvent.setup(); render(<App />);
  await screen.findByRole('heading', { name: profile.display_name });
  await user.type(screen.getByLabelText('消息'), '启动一个真实命令');
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: '发送' }).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByRole('button', { name: '查看审批' });
  expect(server.commands.map(command => command.path)).toEqual([`/sessions/${id}/runs`]);
  await user.type(screen.getByLabelText('消息'), '下次补充草稿');
  await user.click(screen.getByRole('button', { name: '展开工作台' }));
  expect(invoke).toHaveBeenCalledWith('show_workbench', { target: { kind: 'run', run_id: id } });
  await user.click(screen.getByRole('button', { name: '隐藏快捷小窗' }));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('下次补充草稿');
});

it('quick在开启原生选择器前等待form-active宿主确认，取消选择后释放保留', async () => {
  boundary(); businessServer(); const user = userEvent.setup();
  let acknowledge!: () => void;
  const retained = new Promise<void>(resolve => { acknowledge = resolve; });
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'set_quick_form_active' && (args as any).active) return retained;
    if (name === 'select_resources') return { resources: [] };
    return original(name, args);
  });
  render(<App />); await screen.findByText('本机事件流已连接');
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  expect(invoke).toHaveBeenCalledWith('set_quick_form_active', { active: true });
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'select_resources')).toBe(false);
  await act(async () => { acknowledge(); });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('select_resources', { scope: { kind: 'session', workspace_id: id, session_id: id }, kind: 'file' }));
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'set_quick_form_active').at(-1)?.[1]).toEqual({ active: false }));
});
it('quick 打开模型设置先保留原小窗，section 必填且不在 quick 挂载凭据表单', async () => {
  boundary(); businessServer(); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (name, args) => name === 'set_quick_form_active' && (args as any).active ? held : original(name, args));
  const user = userEvent.setup(); render(<App />); await screen.findByRole('heading', { name: profile.display_name });
  const input = screen.getByLabelText<HTMLTextAreaElement>('消息');
  await user.click(screen.getByRole('button', { name: '运行配置' }));
  const settingsDialog = screen.getByRole('dialog', { name: '运行配置' });
  await user.click(within(settingsDialog).getByRole('button', { name: '模型设置' }));
  expect(invoke).toHaveBeenCalledWith('set_quick_form_active', { active: true });
  expect(invoke).not.toHaveBeenCalledWith('open_settings', expect.anything());
  await act(async () => release()); await waitFor(() => expect(invoke).toHaveBeenCalledWith('open_settings', { section: 'models' }));
  expect(screen.getByLabelText('消息')).toBe(input); expect(document.querySelector('.settings-shell')).toBeNull();
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name.includes('credential'))).toBe(false);
});
it('quick 新项目表单也参与原生 form-active 保留，不只保留聊天草稿', async () => {
  boundary(); businessServer(); const user = userEvent.setup(); render(<App />);
  await screen.findByRole('heading', { name: profile.display_name }); await user.click(screen.getByRole('button', { name: '打开项目导航' }));
  await user.click(screen.getByRole('button', { name: '新建项目' })); await user.type(screen.getByLabelText('项目名称'), '待创建项目');
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_quick_form_active', { active: true }));
});

it.each(['main', 'quick'])('%s入口展示真实Profile、默认模型并保留未提交草稿', async label => {
  boundary(label); businessServer(); const user = userEvent.setup(); render(<App />);
  await screen.findByRole('heading', { name: profile.display_name });
  await expectComposerModel(user, model.id);
  await user.type(screen.getByLabelText('消息'), '尚未提交的草稿');
  if (label === 'quick') {
    await user.click(screen.getByRole('button', { name: '隐藏快捷小窗' }));
    expect(invoke).toHaveBeenCalledWith('toggle_quick');
    expect(invoke).toHaveBeenCalledWith('set_quick_form_active', { active: true });
  }
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('尚未提交的草稿');
});

it('ball只读取Rust聚合，注册后读取初值且迟到初值不能覆盖事件，不连接Runtime', async () => {
  const native = boundary('ball'); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(name => name === 'pending_counts' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(undefined));
  const view = render(<App />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('pending_counts'));
  const pet = screen.getByRole('button', { name: petName });
  expect(screen.getAllByRole('button')).toEqual([pet]);
  expect(pet.getAttribute('data-pose')).toBe('syncing');
  expect(screen.getByRole('status').textContent).toBe('待办同步中');
  expect(listen).toHaveBeenCalledWith('pending-counts', expect.any(Function), { target: 'ball' });
  await act(async () => { native.handlers.get('pending-counts')!({ event: 'pending-counts', id: 1, payload: { pending_questions: 2, pending_approvals: 1, pending_actions: 4, unviewed_results: 2 } }); finish(null); });
  expect(pet.getAttribute('data-pose')).toBe('attention');
  expect(pet.getAttribute('title')).toContain('4 项待处理 · 2 项未查看');
  expect(pet.getAttribute('aria-describedby')).toContain(screen.getByRole('status').id);
  expect(invoke).not.toHaveBeenCalledWith('runtime_connection'); expect(fetch).not.toHaveBeenCalled();
  view.unmount(); expect(native.unlisten).toHaveBeenCalledOnce();
});

it('原生设置回显真实快捷键冲突且不声称保存成功，pin/ball使用冻结参数', async () => {
  boundary('main'); businessServer(); const user = userEvent.setup();
  const defaultInvoke = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'set_shortcut') throw '快捷键已被其他应用占用';
    if (name === 'set_quick_pinned') return { ...settings, quick_pinned: (args as any).pinned };
    if (name === 'set_ball_enabled') return { ...settings, ball_enabled: (args as any).enabled };
    return defaultInvoke(name, args);
  });
  render(<Settings client={new RuntimeClient(connectionInfo)} section="windows" />);
  await user.type(await screen.findByLabelText('全局快捷键'), 'Control+Shift+Space');
  await user.click(screen.getByRole('button', { name: '保存快捷键' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '快捷键已被其他应用占用');
  expect(invoke).toHaveBeenCalledWith('set_shortcut', { chord: 'Control+Shift+Space' });
  expect(screen.queryByText('快捷键已保存')).toBeNull();
  await user.click(screen.getByLabelText('快捷小窗置顶'));
  expect(invoke).toHaveBeenCalledWith('set_quick_pinned', { pinned: true });
  await user.click(screen.getByLabelText('启用桌面折纸鸟'));
  expect(invoke).toHaveBeenCalledWith('set_ball_enabled', { enabled: true });
  expect(listen).toHaveBeenCalledWith('window-settings-changed', expect.any(Function), { target: 'main' });
});

it('设置显示启动恢复冲突，事件更新真实配置，留空可注销快捷键', async () => {
  const native = boundary('main'); businessServer(); const user = userEvent.setup();
  const original = vi.mocked(invoke).getMockImplementation()!;
  let current = { ...settings, shortcut: 'Control+Space', shortcut_error: '启动恢复失败：组合键被占用' };
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'window_settings') return current;
    if (name === 'set_shortcut') return { ...settings, shortcut_error: null };
    return original(name, args);
  });
  render(<Settings client={new RuntimeClient(connectionInfo)} section="windows" />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '启动恢复失败：组合键被占用');
  current = { ...current, quick_pinned: true, shortcut: 'Control+Shift+Space' };
  await act(async () => { native.handlers.get('window-settings-changed')!({ id: 1, event: 'window-settings-changed', payload: null }); });
  expect(screen.getByRole('checkbox', { name: '快捷小窗置顶' }).getAttribute('aria-checked')).toBe('true');
  expect((screen.getByLabelText('全局快捷键') as HTMLInputElement).value).toBe('Control+Shift+Space');
  await user.clear(screen.getByLabelText('全局快捷键'));
  await user.click(screen.getByRole('button', { name: '保存快捷键' }));
  expect(invoke).toHaveBeenCalledWith('set_shortcut', { chord: null });
  expect(await screen.findByText('快捷键已停用')).toBeTruthy();
});

it('ball监听异步注册时卸载，注册完成立即unlisten且不再读取初值', async () => {
  boundary('ball'); let registered!: (remove: () => void) => void; const remove = vi.fn();
  vi.mocked(listen).mockImplementation(() => new Promise(resolve => { registered = resolve; }));
  const view = render(<App />); view.unmount();
  await act(async () => { registered(remove); });
  expect(remove).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
});

it('ball从折纸鸟开始拖动，6px后仅交给原生移动，短按切换快捷窗', async () => {
  boundary('ball');
  const user = userEvent.setup(); render(<App />);
  const pet = screen.getByRole<HTMLButtonElement>('button', { name: petName });
  pet.setPointerCapture = vi.fn();
  await user.pointer([{ keys: '[MouseRight>]', target: pet }, { keys: '[/MouseRight]', target: pet }]);
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'start_ball_drag')).toBe(false);
  await user.pointer([{ keys: '[MouseLeft>]', target: pet, coords: { clientX: 40, clientY: 40 } },
    { target: pet, coords: { clientX: 45, clientY: 40 } }]);
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'start_ball_drag')).toBe(false);
  await user.pointer([{ target: pet, coords: { clientX: 46, clientY: 40 } },
    { target: pet, coords: { clientX: 55, clientY: 40 } }, { keys: '[/MouseLeft]', target: pet }]);
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'start_ball_drag')).toEqual([['start_ball_drag']]);
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'toggle_quick')).toBe(false);
  await user.pointer([{ keys: '[MouseLeft>]', target: pet, coords: { clientX: 40, clientY: 40 } },
    { target: pet, coords: { clientX: 43, clientY: 42 } }, { keys: '[/MouseLeft]', target: pet }]);
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'toggle_quick')).toEqual([['toggle_quick']]);
});

it('ball原生拖动失败显示宿主错误且不降级为切换quick', async () => {
  boundary('ball'); const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'start_ball_drag') throw 'ball_drag_failed';
    return original(name, args);
  });
  const user = userEvent.setup(); render(<App />);
  const pet = screen.getByRole<HTMLButtonElement>('button', { name: petName });
  pet.setPointerCapture = vi.fn();
  await user.pointer([{ keys: '[MouseLeft>]', target: pet, coords: { clientX: 20, clientY: 20 } },
    { target: pet, coords: { clientX: 28, clientY: 20 } }, { keys: '[/MouseLeft]', target: pet }]);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '无法移动折纸鸟，请重试。');
  expect(pet.getAttribute('title')).toContain('无法移动折纸鸟');
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'toggle_quick')).toBe(false);
});

it('ball如实更换收翅、衔信和展翅姿势，数量更新不重复触发同一姿势动画', async () => {
  const native = boundary('ball');
  vi.mocked(invoke).mockResolvedValue(null);
  render(<App />);
  const pet = screen.getByRole('button', { name: petName });
  const update = (payload: PendingCounts | null) => act(async () => {
    native.handlers.get('pending-counts')!({ event: 'pending-counts', id: 1, payload });
  });
  const art = () => pet.querySelector('.desktop-pet__art');
  expect(pet.getAttribute('data-pose')).toBe('syncing');
  await update(noPending);
  expect(pet.getAttribute('data-pose')).toBe('idle');
  const resting = art();
  await update({ ...noPending, unviewed_results: 1 });
  expect(pet.getAttribute('data-pose')).toBe('mail');
  const messenger = art();
  expect(messenger).not.toBe(resting);
  expect(pet.querySelector('.desktop-pet__letter')).toBeTruthy();
  await update({ ...noPending, unviewed_results: 2 });
  expect(art()).toBe(messenger);
  await update({ ...noPending, pending_actions: 1, unviewed_results: 2 });
  expect(pet.getAttribute('data-pose')).toBe('attention');
  expect(pet.querySelector('.desktop-pet__letter')).toBeNull();
  await update({ ...noPending, unviewed_results: 2 });
  expect(pet.getAttribute('data-pose')).toBe('mail');
  await update(noPending);
  expect(pet.getAttribute('data-pose')).toBe('idle');
  await update(null);
  expect(pet.getAttribute('data-pose')).toBe('syncing');
  expect(screen.getByRole('status').textContent).toBe('待办同步中');
});

it('ball取消指针输入后忽略这次点击，显式键盘激活仍可切换', async () => {
  boundary('ball'); render(<App />);
  const pet = screen.getByRole<HTMLButtonElement>('button', { name: petName });
  pet.setPointerCapture = vi.fn();
  const user = userEvent.setup();
  await user.pointer([{ keys: '[MouseLeft>]', target: pet, coords: { clientX: 30, clientY: 30 } }]);
  fireEvent.pointerCancel(pet, { pointerId: 1 });
  await user.pointer([{ keys: '[/MouseLeft]', target: pet }]);
  expect(invoke).not.toHaveBeenCalledWith('toggle_quick');
  pet.focus();
  await user.keyboard('{Enter}');
  expect(invoke).toHaveBeenCalledWith('toggle_quick');
});

it('quick从宿主接收同一真实聚合，并保留展开工作台入口', async () => {
  const native = boundary(); businessServer(); render(<App />);
  await screen.findByRole('heading', { name: profile.display_name });
  expect(screen.queryByText(/未查看结果 \d/)).toBeNull();
  await act(async () => {
    native.handlers.get('pending-counts')!({ event: 'pending-counts', id: 1,
      payload: { ...noPending, pending_actions: 2, unviewed_results: 3 } });
  });
  expect(await screen.findByText('待办 2 · 未查看结果 3')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: '展开工作台' }));
  expect(invoke).toHaveBeenCalledWith('show_workbench', { target: null });
});
