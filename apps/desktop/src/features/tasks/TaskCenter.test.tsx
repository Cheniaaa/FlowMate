import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { binding, id, page, run, secondId } from '../../test/fixtures';
import TaskCenter from './TaskCenter';

afterEach(() => vi.restoreAllMocks());
it('按目标、交付摘要和任务类别显示记录，负责人和会话随原条目', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  const root = { id: secondId, run_id: id, version: 1, binding, kind: 'agent' as const, parent_task_id: null, origin_task_id: null,
    executor_id: 'builtin.agent', state: 'running' as const, created_seq: 1, deadline_at: null, result_version: null, reason: null };
  const item = { run, root, pending_count: 0, delivery_state: null, origin_task_id: null };
  vi.spyOn(client, 'globalTasks').mockResolvedValue(page([
    { ...item, task_goal: '评估离线可用性', session_title: '发布准备' },
    { ...item, run: { ...run, id: secondId, output: { summary: '整理发布说明', artifact_ids: [], unresolved: [], handled_failures: [] } } },
    { ...item, run: { ...run, id: '00000000-0000-4000-8000-000000000010', kind: 'managed' } },
  ]));
  vi.spyOn(client, 'watchWorkspace').mockImplementation(async () => {});
  const open = vi.fn();
  render(<TaskCenter client={client} workspaceId={id} workspaces={[]} onOpen={open} />);
  const record = (await screen.findByRole('heading', { name: '评估离线可用性' })).closest('article')!;
  expect(within(record).getByText(/FlowMate/)).toBeTruthy();
  expect(within(record).getByText(/发布准备/)).toBeTruthy();
  expect(within(record).getByText(/运行中/)).toBeTruthy();
  expect(screen.getByRole('heading', { name: '整理发布说明' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: /独立后台.*FlowMate/ })).toBeTruthy();
  expect(screen.queryByText(/00000000/)).toBeNull();
  await userEvent.click(within(record).getByRole('button', { name: '查看任务详情' }));
  expect(open.mock.calls).toEqual([[id]]);
});
it('真实聚合项、项目/状态/类型过滤和有界分页；过滤改变不复用cursor', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  const root = { id: secondId, run_id: id, version: 1, binding, kind: 'agent' as const, parent_task_id: null, origin_task_id: null,
    executor_id: 'builtin.agent', state: 'running' as const, created_seq: 1, deadline_at: null, result_version: null, reason: null };
  const query = vi.spyOn(client, 'globalTasks').mockResolvedValue({ ...page([{ run, root, pending_count: 2, delivery_state: null, origin_task_id: null }]), next_cursor: 'page-two' });
  vi.spyOn(client, 'watchWorkspace').mockImplementation(async () => {});
  render(<TaskCenter client={client} workspaceId={id} workspaces={[{ id, name: '测试项目', version: 1, directory_resource_id: null }, { id: secondId, name: '另一个项目', version: 1, directory_resource_id: null }]} onOpen={vi.fn()} />);
  await screen.findByText('待处理 2');
  await userEvent.click(screen.getByRole('button', { name: '更多任务' }));
  expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'page-two', limit: 50 }));
  await userEvent.selectOptions(screen.getByLabelText('任务类型'), 'managed');
  await waitFor(() => expect(query).toHaveBeenLastCalledWith({ workspace_id: id, kind: 'managed', limit: 50 }));
  await userEvent.selectOptions(screen.getByLabelText('任务范围'), '');
  await waitFor(() => expect(query).toHaveBeenLastCalledWith({ kind: 'managed', limit: 50 }));
  await waitFor(() => expect(client.watchWorkspace).toHaveBeenCalledWith(secondId, '9007199254740993', expect.any(Object), expect.any(AbortSignal)));
});
