import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { RunDetail, RunSnapshot, TaskSnapshot } from '../../generated/contracts';
import { createRuntimeStore } from '../../state/runtime-store';
import { binding, id, limits, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import TaskCenter from './TaskCenter';
import TaskDetail from './TaskDetail';

afterEach(() => vi.restoreAllMocks());

const knowledge: RunSnapshot = { ...run, kind: 'knowledge', interaction_session_id: null,
  config: { kind: 'deterministic', catalog: run.config.catalog } };
const root: TaskSnapshot = { id: secondId, run_id: id, version: 1, kind: 'tool', executor_id: 'knowledge.import',
  binding: { ...binding, config: knowledge.config, interaction_session_id: null }, parent_task_id: null,
  origin_task_id: null, state: 'running', created_seq: 1, deadline_at: null, result_version: null, reason: null };

it('无生成模型的资料处理可筛选和打开详情，不提供记忆整理入口', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 4 });
  vi.spyOn(client, 'globalTasks').mockResolvedValue(page([{ run: knowledge, root, pending_count: 0,
    delivery_state: null, origin_task_id: null }]));
  vi.spyOn(client, 'watchWorkspace').mockImplementation(async () => {});
  const open = vi.fn();
  render(<TaskCenter client={client} workspaceId={id} workspaces={[]} onOpen={open} onOrganize={vi.fn()} />);
  const record = (await screen.findByRole('heading', { name: '资料处理' })).closest('article')!;
  expect(within(record).queryByText(/负责人|模型|价格未知/)).toBeNull();
  expect(within(record).queryByRole('button', { name: /整理/ })).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText('任务类型'), 'knowledge');
  await userEvent.click(await screen.findByRole('button', { name: '查看任务详情' }));
  expect(open.mock.calls).toEqual([[id]]);
});

it('资料处理详情可查看确定性根任务并停止，不呈现生成模型或未知生成价格', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 4 });
  const detail: RunDetail = { ...runDetailSummary, run: knowledge, tasks: page([root]),
    activities: page([]), artifacts: page([]), messages: page([]), questions: page([]), approvals: page([]),
    waits: page([]), consumptions: page([]), joins: page([]), watermark: '9007199254740993',
    budget: { id, run_id: id, version: 1, limits, steps: 0, model_requests: 0, task_count: 1,
      total_tokens: 0, reserved_tokens: 0, spent_units: '0', reserved_units: '0' } };
  vi.spyOn(client, 'run').mockResolvedValue(detail);
  vi.spyOn(client, 'watchWorkspace').mockImplementation(async () => {});
  const command = vi.fn().mockResolvedValue({ status: 'confirmed', sync: 'ready', commandId: id });
  render(<TaskDetail client={client} store={createRuntimeStore(client)} runId={id} onCommand={command}
    onQuestion={vi.fn()} onOpen={vi.fn()} />);
  await screen.findByRole('heading', { name: '资料处理' });
  expect(screen.queryByText(/负责人|模型：|单价未知|价格未知/)).toBeNull();
  expect(screen.queryByRole('button', { name: '成员泳道' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '任务列表' }));
  await userEvent.click(screen.getByRole('button', { name: /工具任务/ }));
  const selected = screen.getByRole('region', { name: '所选步骤' });
  expect(within(selected).queryByText(/负责人|模型/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '停止资料处理' }));
  expect(command).toHaveBeenCalledWith({ type: 'cancel', args: [id, expect.objectContaining({ expected_version: 1 })] },
    { workspaceId: id, sessionId: '' });
});
