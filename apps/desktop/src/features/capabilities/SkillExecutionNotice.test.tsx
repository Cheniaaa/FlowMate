import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup } from '@testing-library/react';
import ToolCard from '../chat/ToolCard';
import { openSettings } from '../../api/windows';

vi.mock('../../api/windows', () => ({ openSettings: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([
  ['environment_interpreter_missing', '缺少此入口需要的解释器，请重新检测或选择已安装环境。'],
  ['script_dependency_missing', '解释器可用，脚本缺少依赖。请修复当前环境的依赖后从此任务继续。'],
] as const)('脚本错误 %s 提供可读原因和原任务环境入口', async (error, text) => {
  render(<ToolCard part={{ kind: 'tool_result', call_id: 'script', origin_message_id: null,
    result: {}, error }} />);
  expect(screen.getByText(text)).toBeTruthy();
  await userEvent.click(screen.getByText('工具结果 · 无来源关联'));
  await userEvent.click(screen.getByRole('button', { name: '查看运行环境' }));
  expect(openSettings).toHaveBeenCalledWith('environments');
});

it('输入变化引导重新选择文件', () => {
  render(<ToolCard part={{ kind: 'tool_result', call_id: 'script', origin_message_id: null,
    result: {}, error: 'script_input_changed' }} />);
  expect(screen.getByText('发送后输入文件已改变，请重新选择文件后继续当前任务。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看运行环境' })).toBeNull();
});
