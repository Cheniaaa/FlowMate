import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { publication } from '../../test/fixtures';
import RecoveryPanel from './RecoveryPanel';
it('release 必须 inline 明确确认；取消不发命令，未确认不伪称释放成功', async () => {
  const command = vi.fn().mockResolvedValue({ status: 'unconfirmed', sync: 'pending', commandId: 'c' }); const user = userEvent.setup();
  render(<RecoveryPanel publications={[publication]} busy={false} onCommand={command} />);
  await user.click(screen.getByRole('button', { name: '放弃自动恢复，保留外部文件' }));
  expect(screen.getByText(/外部目标和备份/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '取消放弃' })); expect(command).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '放弃自动恢复，保留外部文件' }));
  await user.click(screen.getByRole('button', { name: '确认放弃自动恢复' }));
  expect(command).toHaveBeenCalledWith('releaseExport', publication);
  expect(await screen.findByText(/提交状态待确认/)).toBeTruthy(); expect(screen.queryByText('已放弃自动恢复')).toBeNull();
});
