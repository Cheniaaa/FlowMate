import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { binding, id, page, run, secondId } from '../../test/fixtures';
import TaskCenter from './TaskCenter';

afterEach(() => vi.restoreAllMocks());
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
