import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import Composer from './Composer';
import ThemeToggle from '../../components/ThemeToggle';

function Input({ sent, disabled = false, initial = '待发送内容' }: { sent: (value: string) => void; disabled?: boolean; initial?: string }) {
  const [value, change] = useState(initial);
  return <Composer value={value} onChange={change} onSubmit={event => { event.preventDefault(); sent(value); }} disabled={disabled} steering={false} />;
}

it('Enter使用同一表单提交一次，Shift+Enter保留换行', async () => {
  const sent = vi.fn(); const user = userEvent.setup(); render(<Input sent={sent} />);
  await user.click(screen.getByLabelText('消息'));
  await user.keyboard('{Shift>}{Enter}{/Shift}后续行');
  expect(sent).not.toHaveBeenCalled();
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('待发送内容\n后续行');
  await user.keyboard('{Enter}');
  expect(sent.mock.calls).toEqual([['待发送内容\n后续行']]);
});

it('模拟composition和isComposing/229的Enter不发送，组合结束后的独立Enter可发送', () => {
  const sent = vi.fn(); render(<Input sent={sent} initial="中文" />); const input = screen.getByLabelText('消息');
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  expect(sent).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(sent.mock.calls).toEqual([['中文']]);
});

it.each([{ disabled: true, initial: '有效草稿' }, { disabled: false, initial: '  \n' }])('不可发送状态不因Enter绕过按钮限制 $disabled', ({ disabled, initial }) => {
  const sent = vi.fn(); render(<Input sent={sent} disabled={disabled} initial={initial} />);
  fireEvent.keyDown(screen.getByLabelText('消息'), { key: 'Enter' });
  expect(sent).not.toHaveBeenCalled();
});

it('长按和其它修饰键不重复提交，按钮仍沿原路径发送', async () => {
  const sent = vi.fn(); const user = userEvent.setup(); render(<Input sent={sent} />); const input = screen.getByLabelText('消息');
  for (const extra of [{ repeat: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) fireEvent.keyDown(input, { key: 'Enter', ...extra });
  expect(sent).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '发送' }));
  expect(sent.mock.calls).toEqual([['待发送内容']]);
  expect(input.title).toMatch(/Enter 发送.*Shift\+Enter 换行/);
});

it('运行中停止是输入区主操作，有补充草稿时并列显示次级补充且停止不清空草稿', () => {
  const stop = vi.fn();
  const view = render(<Composer value="" onChange={() => {}} onSubmit={() => {}} disabled steering onStop={stop} />);
  expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '停止当前运行' }));
  expect(stop).toHaveBeenCalledTimes(1);
  view.rerender(<Composer value="仍在编辑的补充" onChange={() => {}} onSubmit={() => {}} disabled={false} steering onStop={stop} />);
  expect(screen.getByRole('button', { name: '补充指令' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '停止当前运行' }));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('仍在编辑的补充');
});

it('外观选择应用到共享主题并保存，按钮随选择更新', async () => {
  localStorage.removeItem('flowmate:theme');
  const view = render(<ThemeToggle />);
  try {
    fireEvent.click(screen.getByRole('button', { name: '切换到深色' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('flowmate:theme')).toBe('dark');
    expect(await screen.findByRole('button', { name: '切换到浅色' })).toBeTruthy();
  } finally {
    view.unmount(); localStorage.removeItem('flowmate:theme'); delete document.documentElement.dataset.theme;
  }
});
