import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import Composer from './Composer';

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
  expect(screen.getByText(/Enter 发送.*Shift\+Enter 换行/)).toBeTruthy();
});
