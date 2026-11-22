import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../api/client';
import { agent, connection, event, id, model, modelResolution, page, secondId } from '../test/fixtures';
import { maintenanceDetail, maintenanceNotice, maintenancePolicy, maintenanceRun, maintenanceTask, sourceBoundary, sourceItem } from '../test/maintenance-fixtures';
import WorkbenchWindow from './WorkbenchWindow';
import type { RunDetail } from '../generated/contracts';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('任务中心真实来源进入整理，任务详情/取消和原待办恢复绑定真实维护Run，原聊天草稿不动', { timeout: 15_000 }, async () => {
  vi.mocked(invoke).mockImplementation(async name => name === 'take_workbench_navigation' || name === 'take_settings_navigation' ? null : undefined);
  vi.mocked(listen).mockResolvedValue(() => {});
  const writes: { path: string; body: any }[] = [];
  let detail: RunDetail = { ...maintenanceDetail, run: { ...maintenanceRun, state: 'interrupted' } };
  const workspace = { id, version: 1, name: '来源项目', directory_resource_id: null };
  const session = { id, workspace_id: id, version: 1, title: '保持原对话', kind: 'interaction', archived: false, agent_profile_id: id };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push({ path, body });
      if (path === '/memory/maintenance') return Response.json(maintenanceTask);
      if (path.endsWith('/resume')) detail = { ...detail, run: { ...detail.run, version: 8, state: 'running' } };
      if (path.endsWith('/cancel')) detail = { ...detail, run: { ...detail.run, version: 9, state: 'cancelled' } };
      return Response.json(detail.run);
    }
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/messages') || path.endsWith('/runs') || path.endsWith('/results')) return Response.json(page([]));
    if (path.endsWith('/export-recovery')) return Response.json([]);
    if (path === '/memory/records') return Response.json(page([]));
    if (path === '/tasks') return Response.json(page([sourceItem]));
    if (path === '/settings/memory') return Response.json(maintenancePolicy);
    if (path === `/models/${model.id}/resolved`) return Response.json(modelResolution);
    if (path === '/memory/maintenance') return Response.json(page([maintenanceNotice]));
    if (path === `/memory/source-boundaries/${sourceItem.run.id}`) return Response.json(sourceBoundary);
    if (path === `/tasks/${maintenanceTask.task_id}`) return Response.json(maintenanceDetail.tasks.items[0]);
    if (path === `/runs/${maintenanceRun.id}`) return Response.json(detail);
    if (path === '/inbox') return Response.json(page([{ id: maintenanceTask.task_id, kind: 'blocked', reason: 'grant_required',
      version: 7, workspace_id: id, session_id: null, run_id: maintenanceRun.id, task_id: maintenanceTask.task_id,
      allowed_actions: [{ kind: 'resume', target_id: maintenanceRun.id, expected_version: 7 }] }]));
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]), '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 1, watermark: event.event_id },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]),
        resources: page([]), grants: page([]), watermark: event.event_id },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
    };
    if (!(path in values)) throw new Error(`未定义 ${path}`);
    return Response.json(values[path]);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 }), user = userEvent.setup();
  render(<WorkbenchWindow client={client} />);
  await screen.findByRole('heading', { name: '保持原对话' });
  const input = screen.getByLabelText('消息'); await user.type(input, '整理期间保留的新目标');
  await user.click(within(screen.getByRole('complementary', { name: '项目导航' })).getByTitle('任务'));
  await user.click(await screen.findByRole('button', { name: '整理此运行的记忆' }));
  await screen.findByRole('dialog', { name: '整理记忆' });
  expect((screen.getByLabelText('整理来源运行') as HTMLSelectElement).value).toBe(sourceItem.run.id);
  await user.click(screen.getByRole('button', { name: '整理记忆' }));
  await user.click(await screen.findByRole('button', { name: '确认提交整理任务' }));
  await user.click(await screen.findByRole('button', { name: '打开已提交的维护任务' }));
  const task = await screen.findByRole('region', { name: '任务详情' });
  expect(task.textContent).toContain('记忆整理');
  await user.click(screen.getByTitle('待办'));
  await user.click(await screen.findByRole('button', { name: '恢复本任务中的条件等待' }));
  await waitFor(() => expect(writes.some(request => request.path === `/runs/${maintenanceRun.id}/resume`)).toBe(true));
  expect(writes.find(request => request.path.endsWith('/resume'))?.body.expected_version).toBe(7);
  await user.keyboard('{Escape}');
  await user.click(within(task).getByRole('button', { name: '刷新详情' }));
  await user.click(within(task).getByRole('button', { name: '停止记忆整理' }));
  await waitFor(() => expect(writes.some(request => request.path === `/runs/${maintenanceRun.id}/cancel`)).toBe(true));
  expect(writes.find(request => request.path.endsWith('/cancel'))?.body.expected_version).toBe(8);
  expect((input as HTMLTextAreaElement).value).toBe('整理期间保留的新目标');
  expect(writes.filter(request => request.path === '/memory/maintenance')).toHaveLength(1);
  expect(writes.find(request => request.path === '/memory/maintenance')?.body.data.budget_confirmation)
    .toMatchObject({ kind: 'new_budget', model_profile_id: model.id, model_version: model.version,
      connection_version: connection.version, limits: maintenancePolicy.maintenance_limits });
});
