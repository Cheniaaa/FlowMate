import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { pendingUserCommand, run, secondId } from '../../test/fixtures';
import PendingUserCommands from './PendingUserCommands';

it('按created_seq而不是服务分页顺序展示；applied仅展示真实Run状态，cancelled保留原因', () => {
  render(<PendingUserCommands commands={[
    { ...pendingUserCommand, command_id: secondId, created_seq: 9, state: 'cancelled', reason: 'source_invalid' },
    { ...pendingUserCommand, created_seq: 2, state: 'applied', run_id: run.id },
  ]} runs={{ [run.id]: { ...run, state: 'waiting_user' } }} onOpen={() => {}} />);
  const entries = screen.getAllByRole('article');
  expect(within(entries[0]).getByText('输入已应用，已创建独立用户任务')).toBeTruthy();
  expect(within(entries[0]).getByText('等待回答')).toBeTruthy();
  expect(within(entries[1]).getByText('输入已取消：source_invalid')).toBeTruthy();
});
