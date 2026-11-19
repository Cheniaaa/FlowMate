import { act, render, screen, waitFor } from '@testing-library/react';
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

it.each([false, true])('注册后领取首次导航，跨workspace查询归属/拒绝旧页（启动快照在途=%s）', async early => {
  window.history.replaceState(null, '', '/');
  const registered = deferred<UnlistenFn>(); const unlisten = vi.fn();
  let wake!: EventCallback<null>;
  vi.mocked(listen).mockImplementation((_name, callback) => { wake = callback; return registered.promise; });
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
  await user.click(await screen.findByRole('button', { name: '更多会话' }));
  expect(listen).toHaveBeenCalledWith('workbench-navigation', expect.any(Function), { target: 'main' });
  if (early) {
    expect(invoke).toHaveBeenCalledWith('take_workbench_navigation');
    await act(async () => { releaseRun.resolve(); });
  } else {
    expect(invoke).not.toHaveBeenCalledWith('take_workbench_navigation');
    await act(async () => { registered.resolve(unlisten); });
  }
  await screen.findByRole('heading', { name: targetSession.title });
  await screen.findByRole('heading', { name: '任务详情' });
  expect((screen.getByLabelText('工作区') as HTMLSelectElement).value).toBe(secondId);
  expect((screen.getByLabelText('会话') as HTMLSelectElement).value).toBe(secondId);
  expect(requests).toContain(`/runs/${secondId}`);
  expect(requests).toContain(`/sessions/${secondId}`);
  expect(requests).toContain(`/workspaces/${secondId}/snapshot`);
  // 往返原workspace后ID再次相同，也不能接纳上一轮视图的旧分页。
  await user.selectOptions(screen.getByLabelText('工作区'), id);
  await screen.findByRole('heading', { name: firstSession.title });
  await act(async () => { latePage.resolve(json(page([{ ...firstSession, id: '00000000-0000-4000-8000-000000000099', title: '迟到旧页内容' }]))); });
  expect(screen.queryByRole('option', { name: '迟到旧页内容' })).toBeNull();
  expect(screen.getByRole('heading', { name: firstSession.title })).toBeTruthy();
  const reads = vi.mocked(invoke).mock.calls.filter(([name]) => name === 'take_workbench_navigation').length;
  await act(async () => { wake({ id: 1, event: 'workbench-navigation', payload: null }); });
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'take_workbench_navigation')).toHaveLength(reads + 1);
  view.unmount(); expect(unlisten).toHaveBeenCalledTimes(2);
});
