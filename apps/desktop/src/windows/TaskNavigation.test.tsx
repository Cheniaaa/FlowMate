import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../api/client';
import type { WorkbenchRequest } from '../api/windows';
import { agent, binding, connection, event, id, limits, model, page, run, runDetailSummary, secondId } from '../test/fixtures';
import WorkbenchWindow from './WorkbenchWindow';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

it.each(['task', 'managed-run', 'tasks', 'assistants', 'existing'] as const)('小窗请求%s复用主工作台，管理定位不改主窗草稿/目标；可返回原小窗', async kind => {
  const callbacks = new Map<string, EventCallback<null>>();
  vi.mocked(listen).mockImplementation(async (name, callback) => { callbacks.set(name, callback); return () => {}; });
  let request: WorkbenchRequest | null = null;
  vi.mocked(invoke).mockImplementation(async name => {
    if (name === 'take_workbench_navigation') { const current = request; request = null; return current; }
    return null;
  });
  const workspace = { id, version: 1, name: '当前项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, kind: 'interaction', archived: false, agent_profile_id: id, title: '当前对话' };
  const task = { id: secondId, version: 1, run_id: secondId, binding, parent_task_id: null, origin_task_id: null, kind: 'agent', executor_id: 'builtin.agent',
    state: 'completed', created_seq: 1, deadline_at: null, result_version: 1, reason: null };
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v3', ''); urls.push(path + parsed.search);
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return Response.json(page([]));
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]), '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', reason: null, resource: null },
      [`/sessions/${id}/messages`]: page([]), [`/sessions/${id}/runs`]: page([]),
      '/tasks': page([]), '/tools': [], [`/tasks/${secondId}`]: task, [`/sessions/${secondId}/results`]: page([]),
      [`/runs/${secondId}`]: { ...runDetailSummary, run: { ...run, id: secondId, workspace_id: secondId, interaction_session_id: secondId, kind: 'managed', state: 'completed' },
        tasks: page([task]), activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
        budget: { id: run.budget_id, run_id: secondId, version: 1, limits, spent_units: '0', reserved_units: '0', steps: 0, model_requests: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id },
    };
    if (!(path in values)) throw new Error(`未定义HTTP ${path}`);
    return Response.json(values[path]);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  const user = userEvent.setup(); render(<WorkbenchWindow client={client} />);
  await screen.findByRole('heading', { name: session.title });
  const input = screen.getByLabelText('消息'); await user.type(input, '主窗原草稿');
  request = { target: kind === 'task' ? { kind: 'task', task_id: secondId } : kind === 'managed-run' ? { kind: 'run', run_id: secondId } : kind === 'tasks' ? { kind: 'tasks', workspace_id: secondId } : kind === 'assistants' ? { kind: 'assistants' } : null, from_quick: true };
  await act(async () => { callbacks.get('workbench-navigation')!({ id: 1, event: 'workbench-navigation', payload: null }); });
  if (kind !== 'existing') await screen.findByRole('heading', { name: kind === 'assistants' ? '我的助理' : kind === 'tasks' ? '任务中心' : '任务详情' });
  if (kind === 'tasks') await waitFor(() => expect(urls).toContain(`/tasks?workspace_id=${secondId}&limit=50`));
  if (kind === 'assistants') await screen.findByLabelText('显示名称');
  expect((input as HTMLTextAreaElement).value).toBe('主窗原草稿');
  expect((screen.getByLabelText('会话') as HTMLSelectElement).value).toBe(id);
  if (kind === 'assistants') {
    await user.click(within(screen.getByRole('dialog', { name: '我的助理' })).getByRole('button', { name: '返回对话与草稿' }));
    await waitFor(() => expect(document.activeElement).toBe(input));
    await user.click(screen.getByTitle('我的助理'));
    await screen.findByLabelText('显示名称');
  }
  await user.click(kind === 'assistants' ? within(screen.getByRole('dialog', { name: '我的助理' })).getByRole('button', { name: '返回快捷小窗' }) : screen.getByRole('button', { name: '返回快捷小窗' }));
  expect(invoke).toHaveBeenCalledWith('return_to_quick');
  if (kind !== 'existing' && kind !== 'assistants') await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  expect(screen.getByLabelText('消息')).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe('主窗原草稿');
  if (kind === 'tasks') {
    await user.click(screen.getByTitle('任务'));
    await screen.findByRole('heading', { name: '任务中心' });
    await waitFor(() => expect(urls.filter(url => url.startsWith('/tasks?')).at(-1)).toBe(`/tasks?workspace_id=${id}&limit=50`));
  }
});
