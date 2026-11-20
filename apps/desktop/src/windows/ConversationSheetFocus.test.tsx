import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import QuickAssistant from './QuickAssistant';
import { RuntimeClient } from '../api/client';
import type { WorkbenchRequest } from '../api/windows';
import { agent, binding, connection, event, id, limits, model, page, resultEntry, run, runDetailSummary } from '../test/fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

const workspace = { id, version: 1, name: '回焦项目', directory_resource_id: null };
const session = { id, version: 1, workspace_id: id, kind: 'interaction', archived: false, agent_profile_id: id, title: '回焦会话' };
const currentRun = { ...run, state: 'completed' };
function boundary(override: (path: string) => unknown = () => undefined) {
  const callbacks = new Map<string, EventCallback<null>>();
  let request: WorkbenchRequest | null = null;
  vi.mocked(listen).mockImplementation(async (name, callback) => { callbacks.set(name, callback); return () => {}; });
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'runtime_connection') return { base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 3 };
    if (name === 'show_workbench') { request = { target: (args as { target: WorkbenchRequest['target'] }).target, from_quick: true }; return; }
    if (name === 'take_workbench_navigation') { const next = request; request = null; return next; }
    if (name === 'window_settings') return { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
    if (name === 'pending_counts') return null;
    return null;
  });
  vi.stubGlobal('fetch', async (input: string) => {
    const path = new URL(input).pathname.replace('/v3', '');
    const value = await override(path);
    if (value !== undefined) return Response.json(value);
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/run-feedback')) return Response.json(page([]));
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]), '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', reason: null, resource: null },
      [`/sessions/${id}`]: session, [`/sessions/${id}/messages`]: page([]), [`/sessions/${id}/runs`]: page([currentRun]),
      [`/sessions/${id}/results`]: page([resultEntry]), [`/results/${resultEntry.id}/view`]: resultEntry,
      '/provider-presets': [], '/tools': [],
      [`/runs/${id}`]: { ...runDetailSummary, run: currentRun, tasks: page([{ id: run.root_task_id, run_id: id, version: 1, binding,
        parent_task_id: null, origin_task_id: null, kind: 'agent', executor_id: 'builtin.agent', state: 'completed',
        created_seq: 1, deadline_at: null, result_version: 1, reason: null }]), activities: page([]), messages: page([]), artifacts: page([]),
        questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
        budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', steps: 0, model_requests: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id },
    };
    if (!(path in values)) throw new Error(`未定义合成 HTTP ${path}`);
    return Response.json(values[path]);
  });
  return {
    async deliver() { await act(async () => callbacks.get('workbench-navigation')!({ id: 1, event: 'workbench-navigation', payload: null })); },
    async navigate() { request = { target: { kind: 'run', run_id: id }, from_quick: true }; await this.deliver(); },
  };
}

it.each(['关闭', 'Escape'])('快捷窗展开用户 Run 后主窗%s任务 Sheet 回任务入口且保留草稿', async close => {
  const native = boundary(), user = userEvent.setup();
  const main = render(<App />);
  const input = await within(main.container).findByLabelText('消息');
  await user.type(input, '主窗保留的草稿');
  // 两个窗口组件只共享 HTTP/Tauri 边界。移除快捷窗的 DOM，模拟来源不在主窗 document。
  const quick = render(<QuickAssistant client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 3 })} />);
  await within(quick.container).findByRole('heading', { name: session.title });
  await waitFor(() => expect(within(quick.container).getAllByText('已完成').length).toBeGreaterThan(0));
  await user.click(within(quick.container).getByRole('button', { name: '展开工作台' }));
  quick.unmount();
  expect(document.activeElement).toBe(document.body);
  await native.deliver();
  const dialog = await screen.findByRole('dialog', { name: '任务详情' });
  expect(within(dialog).getByText(id)).toBeTruthy();
  if (close === 'Escape') await user.keyboard('{Escape}');
  else await user.click(within(dialog).getByRole('button', { name: '关闭详情' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(within(main.container).getByRole('button', { name: '任务' })));
  expect(input).toHaveProperty('value', '主窗保留的草稿');
});

it.each(['任务', '产物'])('本地%s来源在 Sheet 关闭后仍恢复', async name => {
  boundary(); const user = userEvent.setup(); render(<App />);
  await screen.findByRole('heading', { name: session.title });
  const trigger = screen.getByRole('button', { name });
  await user.click(trigger);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('程序化任务 Sheet 保留有效本地主窗输入来源', async () => {
  const native = boundary(), user = userEvent.setup(); render(<App />);
  const input = await screen.findByLabelText('消息');
  await user.type(input, '原输入来源');
  await user.tab();
  await user.click(input);
  await native.navigate();
  await screen.findByRole('dialog', { name: '任务详情' });
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input).toHaveProperty('value', '原输入来源');
});

it('任务 Sheet 被新设置页接管时不把焦点抢回任务来源', async () => {
  boundary(); const user = userEvent.setup(); render(<App />);
  await screen.findByRole('heading', { name: session.title });
  await user.click(screen.getByRole('button', { name: '任务' }));
  await screen.findByRole('dialog', { name: '任务详情' });
  // 宿主收到公开设置导航后，新页面自己取得焦点；旧 Sheet 延迟回焦不可覆盖它。
  const callback = vi.mocked(listen).mock.calls.find(([name]) => name === 'settings-navigation')![1];
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((name, args, options) => name === 'take_settings_navigation'
    ? Promise.resolve({ section: 'models', from_quick: true }) : original(name, args, options));
  await act(async () => callback({ id: 2, event: 'settings-navigation', payload: null }));
  const settings = await screen.findByRole('dialog', { name: '设置' });
  const target = within(settings).getByRole('button', { name: '完成' });
  act(() => target.focus());
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '任务详情' })).toBeNull());
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(document.activeElement).toBe(target);
});

it('关闭任务 Sheet 后输入已接管时，延迟回焦不覆盖新目标', async () => {
  boundary(); const user = userEvent.setup(); render(<App />);
  const input = await screen.findByLabelText('消息');
  await user.click(screen.getByRole('button', { name: '任务' }));
  const dialog = await screen.findByRole('dialog', { name: '任务详情' });
  vi.useFakeTimers();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  // 固定关闭回调尚未执行、新输入已获焦的时序，不用此操作补跨窗回归的焦点。
  act(() => input.focus());
  await act(async () => { vi.runOnlyPendingTimers(); });
  vi.useRealTimers();
  expect(document.activeElement).toBe(input);
});

it.each(['main', 'quick'])('O1 %s 结果预览在途/完成保持查看按钮焦点，Esc 回原结果入口且保留草稿', async label => {
  window.history.replaceState(null, '', `/?window=${label}`);
  let resolve!: (value: unknown) => void;
  const reply = new Promise(done => { resolve = done; });
  boundary(path => path === `/tasks/${run.root_task_id}/result` ? reply : undefined);
  const user = userEvent.setup(); render(<App />);
  const input = await screen.findByLabelText('消息');
  await user.type(input, '结果预览原草稿');
  const trigger = screen.getByRole('button', { name: /^结果/ });
  await user.click(trigger);
  const view = await screen.findByRole('button', { name: '查看结果' });
  act(() => view.focus());
  await user.keyboard('{Enter}');
  await waitFor(() => expect(view.getAttribute('aria-disabled')).toBe('true'));
  expect(document.activeElement).toBe(view);
  await act(async () => resolve({ handle: resultEntry.result, result_version: resultEntry.result_version, state: 'completed',
    error: null, artifacts: [], dependencies: [], result: { summary: 'O1 合成结果正文' } }));
  await screen.findByText(/O1 合成结果正文/);
  expect(document.activeElement).toBe(view);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(input).toHaveProperty('value', '结果预览原草稿');
});

it('结果总结关闭 Sheet 后输入焦点与主窗草稿保持', async () => {
  boundary(); const user = userEvent.setup(); render(<App />);
  const input = await screen.findByLabelText('消息');
  await user.type(input, '总结前的草稿');
  await user.click(screen.getByRole('button', { name: /^结果/ }));
  await user.click(await screen.findByRole('button', { name: '在会话中总结' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input).toHaveProperty('value', '总结前的草稿');
});
