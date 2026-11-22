import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { InboxPage } from '../../generated/contracts';
import { id, secondId } from '../../test/fixtures';
import { PendingActionList } from './Inbox';

const taskA = '00000000-0000-4000-8000-000000000011';
const taskB = '00000000-0000-4000-8000-000000000012';
function item(kind: InboxPage['items'][number]['kind'], other: boolean): InboxPage['items'][number] {
  const owner = { id: other ? secondId : id, workspace_id: other ? secondId : id, session_id: other ? secondId : id, run_id: other ? secondId : id };
  const task_id = other ? taskB : taskA;
  if (kind === 'question') return { ...owner, kind, question: { id: owner.id, run_id: owner.run_id, task_id, version: 3, call_id: 'ask', message_id: owner.id,
    question: '确认范围', answer_schema: { type: 'string' }, status: 'pending', answer_message_id: null, dependencies: [] } };
  if (kind === 'approval') return { ...owner, kind, approval: { ...owner, task_id, activity_id: owner.id, call_id: 'export', args_hash: 'abc', version: 4,
    tool_name: 'artifacts.export', tool_version: '1', mcp: null, parameters: {}, target: null, dependencies: [], status: 'pending', export_preview: null, expires_at: '2026-11-17T13:00:00Z' } };
  return { ...owner, kind, task_id, version: 5, reason: '同一个原因', allowed_actions: [{ kind: 'cancel_run', target_id: owner.run_id, expected_version: 7 }] };
}

it.each(['question', 'approval', 'recovery', 'blocked', 'delivery_failed'] as const)('%s 跨项目同文案按真实名称区分，点击绑定原目标', async kind => {
  const first = { ...item(kind, false), workspace_name: '项目甲', session_title: '会话甲', task_goal: '核对甲的发票' };
  const second = { ...item(kind, true), workspace_name: '项目乙', session_title: '会话乙', task_goal: '核对乙的发票' };
  const onOpen = vi.fn(), onAction = vi.fn();
  render(<PendingActionList items={[first, second]} workspaceNames={{ [id]: '过时的项目名称' }} onOpen={onOpen} onAction={onAction} />);
  const cards = screen.getAllByRole('article');
  expect(cards).toHaveLength(2);
  for (const [index, workspace, task] of [[0, id, taskA], [1, secondId, taskB]] as const) {
    expect(cards[index].textContent).not.toContain(workspace);
    expect(cards[index].textContent).not.toContain(task);
  }
  expect(within(cards[0]).getByText('项目甲')).toBeTruthy();
  expect(within(cards[1]).getByText('项目乙')).toBeTruthy();
  expect(within(cards[1]).getByText('会话乙')).toBeTruthy();
  expect(within(cards[1]).getByText('核对乙的发票')).toBeTruthy();
  const user = userEvent.setup();
  await user.click(within(cards[1]).getByRole('button'));
  if (second.kind === 'question' || second.kind === 'approval') {
    expect(onOpen).toHaveBeenCalledWith(second);
    expect(onAction).not.toHaveBeenCalled();
  } else {
    expect(onAction).toHaveBeenCalledWith(second, { kind: 'cancel_run', target_id: secondId, expected_version: 7 });
    expect(onOpen).not.toHaveBeenCalled();
  }
});

it('归属名称缺失时保留可行动的问题，不展示内部 ID 或借用其他项目名称', () => {
  const unknown = item('question', true), fetch = vi.spyOn(globalThis, 'fetch');
  render(<PendingActionList items={[unknown]} workspaceNames={{ [id]: '唯一已知项目' }} onOpen={vi.fn()} onAction={vi.fn()} />);
  expect(screen.getByRole('button', { name: '确认范围' })).toBeTruthy();
  expect(screen.queryByText(secondId)).toBeNull();
  expect(screen.queryByText(taskB)).toBeNull();
  expect(screen.queryByText('唯一已知项目')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});

it('条件待办解释授权原因，恢复仍使用原目标和版本', async () => {
  const action = { kind: 'resume' as const, target_id: secondId, expected_version: 21 };
  const pending = { id, kind: 'blocked' as const, workspace_id: id, session_id: id, run_id: secondId, task_id: taskA, version: 7,
    reason: 'context_authorization_required', allowed_actions: [action] };
  const onAction = vi.fn();
  render(<PendingActionList items={[pending]} onOpen={vi.fn()} onAction={onAction} />);
  expect(screen.getByText('请检查本次任务需要的资料及发送授权。')).toBeTruthy();
  expect(screen.queryByText(/context_authorization_required/)).toBeNull();
  expect(screen.getByText(/符合条件的等待成员/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: '恢复本任务中的条件等待' }));
  expect(onAction).toHaveBeenCalledWith(pending, { kind: 'resume', target_id: secondId, expected_version: 21 });
});
