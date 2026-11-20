import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';
import QuickAssistant from './QuickAssistant';
import { RuntimeClient } from '../api/client';
import type { WorkbenchRequest } from '../api/windows';
import { agent, binding, connection, event, id, limits, model, page, run, runDetailSummary } from '../test/fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); localStorage.clear(); });

const workspace = { id, version: 1, name: '管理回焦项目', directory_resource_id: null };
const session = { id, version: 1, workspace_id: id, kind: 'interaction', archived: false, agent_profile_id: id, title: '管理回焦会话' };
const managed = { ...run, kind: 'managed', state: 'completed' };
const task = { id: run.root_task_id, run_id: id, version: 1, binding, parent_task_id: null, origin_task_id: null,
  kind: 'agent', executor_id: 'builtin.agent', state: 'completed', created_seq: 1, deadline_at: null, result_version: 1, reason: null };

function boundary() {
  const callbacks = new Map<string, EventCallback<null>>();
  let request: WorkbenchRequest | null = null;
  vi.mocked(listen).mockImplementation(async (name, callback) => { callbacks.set(name, callback); return () => {}; });
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'runtime_connection') return { base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 3 };
    if (name === 'show_workbench') { request = { target: (args as { target: WorkbenchRequest['target'] }).target, from_quick: true }; return; }
    if (name === 'take_workbench_navigation') { const next = request; request = null; return next; }
    if (name === 'window_settings') return { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
    return null;
  });
  vi.stubGlobal('fetch', async (input: string) => {
    const path = new URL(input).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/run-feedback') || path.endsWith('/results')) return Response.json(page([]));
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]), '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', reason: null, resource: null },
      [`/sessions/${id}`]: session, [`/sessions/${id}/messages`]: page([]), [`/sessions/${id}/runs`]: page([managed]),
      [`/tasks/${task.id}`]: task, '/tasks': page([{ run: managed, root: task, pending_count: 0, delivery_state: null, origin_task_id: null }]),
      '/tools': [],
      [`/runs/${id}`]: { ...runDetailSummary, run: managed, tasks: page([task]), activities: page([]), messages: page([]), artifacts: page([]),
        questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
        budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', steps: 0, model_requests: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id },
    };
    if (!(path in values)) throw new Error(`未定义合成 HTTP ${path}`);
    return Response.json(values[path]);
  });
  return {
    async deliver() { await act(async () => callbacks.get('workbench-navigation')!({ id: 1, event: 'workbench-navigation', payload: null })); },
    async navigate(target: WorkbenchRequest['target']) { request = { target, from_quick: true }; await this.deliver(); },
  };
}
const returnButton = () => screen.getByRole('button', { name: '返回对话与草稿' });
const taskEntry = () => within(document.querySelector<HTMLElement>('.conversation-header')!).getByRole('button', { name: '任务' });

it('quick 展开 managed Run 后显式返回本对话任务入口且保留主窗草稿', async () => {
  const native = boundary(), user = userEvent.setup(), main = render(<App />);
  const input = await within(main.container).findByLabelText('消息');
  await user.type(input, '主窗管理前的草稿');
  const quick = render(<QuickAssistant client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 3 })} />);
  await within(quick.container).findByRole('button', { name: '查看后台任务' });
  await user.click(within(quick.container).getByRole('button', { name: '展开工作台' }));
  quick.unmount();
  expect(document.activeElement).toBe(document.body);
  await native.deliver();
  await screen.findByRole('heading', { name: '任务详情' });
  expect(input.closest('[inert]')).not.toBeNull();
  await user.click(returnButton());
  expect(input.closest('[inert]')).toBeNull();
  expect(screen.queryByRole('region', { name: '任务管理页面' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(taskEntry());
  expect(input).toHaveProperty('value', '主窗管理前的草稿');
});

it('本地后台任务来源只在对话 inert 移除后恢复', async () => {
  boundary(); const user = userEvent.setup(); render(<App />);
  const trigger = await screen.findByRole('button', { name: '查看后台任务' });
  await user.click(trigger);
  await screen.findByRole('heading', { name: '任务详情' });
  const inertAtFocus: boolean[] = [];
  trigger.addEventListener('focus', () => inertAtFocus.push(!!trigger.closest('[inert]')));
  await user.click(returnButton());
  expect(document.activeElement).toBe(trigger);
  expect(inertAtFocus).toEqual([false]);
});

it('本地任务中心经详情和返回中心后仍回本次侧栏来源', async () => {
  boundary(); const user = userEvent.setup(); render(<App />);
  await screen.findByRole('heading', { name: session.title });
  const trigger = screen.getByTitle('任务');
  await user.click(trigger);
  await user.click(await screen.findByRole('button', { name: '查看任务详情' }));
  await screen.findByRole('heading', { name: '任务详情' });
  await user.click(screen.getByRole('button', { name: '返回任务中心' }));
  await user.click(returnButton());
  expect(document.activeElement).toBe(trigger);
});

it.each(['tasks', 'task', 'run'] as const)('外部 %s 新入口没有本地来源时不复用前次任务中心来源', async kind => {
  const native = boundary(), user = userEvent.setup(); render(<App />);
  await screen.findByRole('heading', { name: session.title });
  await user.click(screen.getByTitle('任务'));
  await user.click(returnButton());
  await user.click(screen.getByRole('heading', { name: session.title }));
  expect(document.activeElement).toBe(document.body);
  await native.navigate(kind === 'tasks' ? { kind, workspace_id: id } : kind === 'task' ? { kind, task_id: task.id } : { kind, run_id: id });
  await screen.findByRole('region', { name: '任务管理页面' });
  await user.click(returnButton());
  expect(document.activeElement).toBe(taskEntry());
});

it('外部 managed 导航保留本次真实输入来源，并在移除 inert 后返回', async () => {
  const native = boundary(), user = userEvent.setup(); render(<App />);
  const input = await screen.findByLabelText('消息');
  await user.type(input, '输入来源草稿');
  await user.tab(); await user.click(input);
  await native.navigate({ kind: 'run', run_id: id });
  await screen.findByRole('heading', { name: '任务详情' });
  const inertAtFocus: boolean[] = [];
  input.addEventListener('focus', () => inertAtFocus.push(!!input.closest('[inert]')));
  await user.click(returnButton());
  expect(document.activeElement).toBe(input);
  expect(inertAtFocus).toEqual([false]);
  expect(input).toHaveProperty('value', '输入来源草稿');
});

it('显式返回时新页面已经取得焦点，不回抢旧来源', async () => {
  boundary(); const user = userEvent.setup(); render(<App />);
  const trigger = await screen.findByRole('button', { name: '查看后台任务' });
  await user.click(trigger);
  await screen.findByRole('heading', { name: '任务详情' });
  const close = returnButton();
  await user.click(screen.getByTitle('设置'));
  const settings = await screen.findByRole('dialog', { name: '设置' });
  const target = within(settings).getByRole('button', { name: '完成' });
  act(() => target.focus());
  // 固定新页接管与已排队的显式关闭同批提交；不以此操作补跨窗失败用例的焦点。
  fireEvent.click(close);
  expect(document.activeElement).toBe(target);
  expect(screen.queryByRole('region', { name: '任务管理页面' })).toBeNull();
});
