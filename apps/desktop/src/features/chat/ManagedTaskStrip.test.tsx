import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { followUpIntent, run } from '../../test/fixtures';
import ManagedTaskStrip from './ManagedTaskStrip';

it('只展示真实managed事实；运行中紧凑，停止藏在更多，不占用新输入', async () => {
  const onStop = vi.fn(), onOpen = vi.fn();
  const view = render(<ManagedTaskStrip runs={[run]} onOpen={onOpen} onStop={onStop} />);
  expect(screen.queryByLabelText('后台任务条')).toBeNull();
  view.rerender(<ManagedTaskStrip runs={[{ ...run, kind: 'managed' }]} onOpen={onOpen} onStop={onStop} />);
  expect(screen.getByLabelText('后台任务条')).toBeTruthy();
  expect(screen.getByRole('button', { name: '停止该后台' }).closest('details')?.open).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: '查看后台任务' }));
  expect(onOpen).toHaveBeenCalledWith(run.id);
});

it('unknown/正常等待保持真实暂停与核对状态，不显示正在总结或提供自行恢复', () => {
  render(<ManagedTaskStrip runs={[{ ...run, kind: 'follow_up', state: 'interrupted', reason: 'activity_uncertain' }]}
    intents={[{ ...followUpIntent, status: 'paused', reason: 'activity_uncertain' }]} onOpen={() => {}} onStop={() => {}} />);
  expect(screen.queryByText('正在自动总结')).toBeNull();
  expect(screen.getByText('自动总结已暂停，请核对待办')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /恢复/ })).toBeNull();
});
