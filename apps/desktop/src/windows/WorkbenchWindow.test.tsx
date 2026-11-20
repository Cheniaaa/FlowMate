import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import WorkbenchWindow from './WorkbenchWindow';
import { RuntimeClient } from '../api/client';
import { agent, connection, event, id, limits, model, page, run, runDetailSummary, secondId } from '../test/fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); window.history.replaceState(null, '', '/'); });
const json = (value: unknown) => new Response(JSON.stringify(value));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('settings 先订阅再领取；打开/关闭保持 Conversation DOM 与草稿，焦点回原入口', async () => {
  const callbacks = new Map<string, EventCallback<null>>(); const order: string[] = [];
  vi.mocked(listen).mockImplementation(async (name, callback) => { order.push(name); callbacks.set(name, callback); return () => {}; });
  let section: { section: string; from_quick: boolean } | null = null;
  vi.mocked(invoke).mockImplementation(async name => { order.push(name); if (name === 'take_settings_navigation') { const value = section; section = null; return value; } return null; });
  const workspace = { id, version: 1, name: '项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '聊天', agent_profile_id: id, kind: 'interaction', archived: false };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return json(page([]));
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    const values: Record<string, unknown> = { '/v3/workspaces': page([workspace]), '/v3/profiles': page([agent]), '/v3/models': page([]), '/v3/model-connections': page([]), '/v3/provider-presets': [],
      '/v3/navigation': { default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/v3/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', reason: null, resource: null },
      [`/v3/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/v3/sessions/${id}/messages`]: page([]), [`/v3/sessions/${id}/runs`]: page([]) };
    return json(values[path]);
  });
  const user = userEvent.setup(); render(<WorkbenchWindow client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 })} />);
  await screen.findByRole('heading', { name: '聊天' });
  const input = screen.getByLabelText('消息'); await user.type(input, '保持草稿');
  const entry = screen.getByRole('button', { name: '模型设置' }); await user.click(entry);
  await screen.findByRole('dialog', { name: '设置' });
  expect(screen.getByLabelText('消息')).toBe(input);
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  expect((input as HTMLTextAreaElement).value).toBe('保持草稿'); expect(document.activeElement).toBe(entry);
  expect(order.indexOf('settings-navigation')).toBeLessThan(order.indexOf('take_settings_navigation'));
  section = { section: 'models', from_quick: true }; await act(async () => { callbacks.get('settings-navigation')!({ id: 1, event: 'settings-navigation', payload: null }); });
  expect(await screen.findByRole('dialog', { name: '设置' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '返回快捷小窗' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull());
  expect(invoke).toHaveBeenCalledWith('return_to_quick');
  expect((input as HTMLTextAreaElement).value).toBe('保持草稿');
});

it('消息连接入口及重复快捷窗导航均定位目标，取消及在途保存继续保护原密钥绑定', async () => {
  const callbacks = new Map<string, EventCallback<null>>();
  vi.mocked(listen).mockImplementation(async (name, callback) => { callbacks.set(name, callback); return () => {}; });
  let request: { target: { kind: 'connection'; connection_id: string }; from_quick: boolean } | null = null;
  async function locate(connection_id: string) {
    request = { target: { kind: 'connection', connection_id }, from_quick: true };
    callbacks.get('workbench-navigation')!({ id: 1, event: 'workbench-navigation', payload: null });
  }
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'take_workbench_navigation') { const target = request; request = null; return target; }
    if (name === 'take_settings_navigation') return null;
    if (name === 'show_workbench') { await locate((args as { target: { connection_id: string } }).target.connection_id); return; }
    return { configured: true };
  });
  const other = { ...connection, id: secondId, display_name: '连接 B' };
  const failed = { ...run, state: 'failed' as const, reason: 'model_permission_denied' };
  const workspace = { id, version: 1, name: '项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '聊天', agent_profile_id: id, kind: 'interaction', archived: false };
  const save = deferred<Response>();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (init.method === 'PUT') return save.promise;
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return json(page([]));
    if (path.endsWith('/export-recovery')) return json([]);
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([agent]), '/models': page([model]),
      '/model-connections': page([connection, other]), '/provider-presets': [],
      '/navigation': { default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]),
        pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/runs`]: page([failed]),
      [`/sessions/${id}/messages`]: page([{ id, run_id: run.id, role: 'user', origin: 'conversation', parts: [{ kind: 'text', text: '失败输入' }],
        activity_id: null, private_ref: null, source_dependencies: [], event_id: '1', event_index: 0 }]),
      [`/sessions/${id}/run-feedback`]: page([{ run_id: run.id, version: 1, workspace_id: id, session_id: id,
        root_task_id: run.root_task_id, connection_id: connection.id, state: failed.state, reason: failed.reason, model_activity: null }]),
      [`/runs/${id}`]: { ...runDetailSummary, run: failed, tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]),
        questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
        budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 1,
          task_count: 1, steps: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id } };
    return json(values[path]);
  });
  render(<WorkbenchWindow client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 })} />);
  fireEvent.click(await screen.findByRole('button', { name: '检查连接' }));
  await screen.findByDisplayValue(connection.display_name);
  fireEvent.change(screen.getByLabelText('编辑连接'), { target: { value: other.id } });
  await screen.findByDisplayValue(other.display_name);
  await act(() => locate(connection.id));
  await screen.findByDisplayValue(connection.display_name);
  fireEvent.change(screen.getByLabelText('API Key（仅保存到系统凭据）'), { target: { value: 'A-only-key' } });
  await act(() => locate(other.id));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  await act(() => locate(other.id));
  await screen.findByText('有未保存的设置');
  expect((screen.getByLabelText('API Key（仅保存到系统凭据）') as HTMLInputElement).value).toBe('A-only-key');
  fireEvent.click(screen.getByRole('button', { name: '保存后继续' }));
  await waitFor(() => expect((screen.getByLabelText('编辑连接') as HTMLSelectElement).disabled).toBe(true));
  await act(() => locate(other.id));
  expect((screen.getByLabelText('编辑连接') as HTMLSelectElement).value).toBe(connection.id);
  await act(async () => { save.resolve(json({ ...connection, version: 2, secret_ref: id })); });
  await screen.findByDisplayValue(other.display_name);
  expect(invoke).toHaveBeenCalledWith('save_credential', { binding: { kind: 'model', connection_id: connection.id, connection_version: 2,
    protocol: connection.protocol, endpoint: connection.endpoint, secret_ref: id }, value: 'A-only-key' });
  expect((screen.getByLabelText('API Key（仅保存到系统凭据）') as HTMLInputElement).value).toBe('');
});

it.each([false, true])('注册后领取首次导航，跨workspace查询归属/拒绝旧页（启动快照在途=%s）', async early => {
  window.history.replaceState(null, '', '/');
  const registered = deferred<UnlistenFn>(); const unlisten = vi.fn();
  let wake!: EventCallback<null>;
  vi.mocked(listen).mockImplementation((name, callback) => { if (name === 'workbench-navigation') wake = callback; return registered.promise; });
  let pendingId: string | null = secondId;
  vi.mocked(invoke).mockImplementation(async name => {
    if (name === 'runtime_connection') return { base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 };
    if (name === 'take_workbench_navigation') { const value = pendingId; pendingId = null; return value ? { target: { kind: 'run', run_id: value }, from_quick: true } : null; }
    if (name === 'take_settings_navigation') return null;
    throw new Error(`未定义原生命令 ${name}`);
  });
  const firstWorkspace = { id, version: 1, name: '首页工作区', directory_resource_id: null };
  const targetWorkspace = { id: secondId, version: 1, name: '真实归属工作区', directory_resource_id: null };
  const firstSession = { id, version: 1, workspace_id: id, title: '首页会话', agent_profile_id: id, kind: 'interaction', archived: false };
  const targetSession = { ...firstSession, id: secondId, workspace_id: secondId, title: '首页之外的真实会话' };
  const targetRun = { ...run, id: secondId, workspace_id: secondId, interaction_session_id: secondId, execution_session_id: secondId, state: 'completed', output: { summary: '目标任务摘要', artifact_ids: [], unresolved: [], handled_failures: [] } };
  const latePage = deferred<Response>(); const releaseRun = deferred<void>(); const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v3', ''); requests.push(path + parsed.search);
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return json(page([]));
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path === `/workspaces/${id}/sessions`) return latePage.promise;
    const watermark = path === `/workspaces/${secondId}/snapshot` ? '9007199254740994' : event.event_id;
    const snapshot = (workspace: typeof firstWorkspace, sessions: typeof firstSession[]) => ({ workspace, sessions: { ...page(sessions), next_cursor: workspace.id === id ? 'old-page' : null }, active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark });
     const values: Record<string, unknown> = { '/workspaces': page([firstWorkspace]), '/profiles': page([agent]), '/models': page([model]), '/model-connections': page([connection]),
       '/navigation': { default_workspace_id: id, workspaces: page([{ workspace: firstWorkspace, sessions: { ...page([firstSession]), next_cursor: 'old-page' }, pending_count: 0 }, { workspace: targetWorkspace, sessions: page([targetSession]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/snapshot`]: snapshot(firstWorkspace, [firstSession]),
      // 目标会话不在快照首页；必须安装session端点查询的真实归属。
      [`/workspaces/${secondId}/snapshot`]: snapshot(targetWorkspace, []),
      [`/sessions/${secondId}`]: targetSession, [`/sessions/${id}/runs`]: page([]), [`/sessions/${id}/messages`]: page([]),
      [`/sessions/${secondId}/runs`]: page([targetRun]), [`/sessions/${secondId}/messages`]: page([]),
      [`/runs/${secondId}`]: { ...runDetailSummary, run: targetRun, tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
        budget: { id: run.budget_id, run_id: secondId, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, task_count: 1, steps: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: requests.filter(value => value === `/runs/${secondId}`).length > 1 ? '9007199254740994' : event.event_id } };
    if (!(path in values)) throw new Error(`未定义HTTP ${path}`);
    if (early && path === `/runs/${secondId}` && requests.filter(value => value === path).length === 1) await releaseRun.promise;
    return json(values[path]);
  });
  if (early) registered.resolve(unlisten);
  const user = userEvent.setup(); const view = render(<App />);
  await user.click(await screen.findByRole('button', { name: '更多项目会话' }));
  expect(listen).toHaveBeenCalledWith('workbench-navigation', expect.any(Function), { target: 'main' });
  if (early) {
    expect(invoke).toHaveBeenCalledWith('take_workbench_navigation');
    await act(async () => { releaseRun.resolve(); });
  } else {
    expect(invoke).not.toHaveBeenCalledWith('take_workbench_navigation');
    await act(async () => { registered.resolve(unlisten); });
  }
  await screen.findByRole('heading', { name: '任务详情' });
  await user.click(screen.getByRole('button', { name: '关闭详情' }));
  await screen.findByRole('heading', { name: targetSession.title });
  expect(screen.getByRole('button', { name: targetSession.title }).getAttribute('aria-current')).toBe('page');
  expect(requests).toContain(`/runs/${secondId}`);
  expect(requests).toContain(`/sessions/${secondId}`);
  expect(requests).toContain(`/workspaces/${secondId}/snapshot`);
  // 往返原workspace后ID再次相同，也不能接纳上一轮视图的旧分页。
  await user.click(screen.getByRole('button', { name: firstWorkspace.name }));
  await screen.findByRole('heading', { name: firstSession.title });
  await act(async () => { latePage.resolve(json(page([{ ...firstSession, id: '00000000-0000-4000-8000-000000000099', title: '迟到旧页内容' }]))); });
  expect(screen.queryByRole('option', { name: '迟到旧页内容' })).toBeNull();
  expect(screen.getByRole('heading', { name: firstSession.title })).toBeTruthy();
  const reads = vi.mocked(invoke).mock.calls.filter(([name]) => name === 'take_workbench_navigation').length;
  await act(async () => { wake({ id: 1, event: 'workbench-navigation', payload: null }); });
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'take_workbench_navigation')).toHaveLength(reads + 1);
  view.unmount(); expect(unlisten).toHaveBeenCalledTimes(3);
});
