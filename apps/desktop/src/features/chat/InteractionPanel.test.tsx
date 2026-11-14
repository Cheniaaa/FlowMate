import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import InteractionPanel from './InteractionPanel';
it('收起不卸载答案，不使用 modal，也不抢输入焦点', async () => {
  function Host() {
    const [collapsed, setCollapsed] = useState(false);
    return <><input aria-label="普通草稿" /><InteractionPanel item={{ kind: 'question', id: 'q', title: '回答问题' }} collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)}><input aria-label="答案" /></InteractionPanel></>;
  }
  const user = userEvent.setup(); render(<Host />);
  await user.type(screen.getByLabelText('答案'), '保留'); await user.click(screen.getByRole('button', { name: '收起待办' }));
  await user.click(screen.getByRole('button', { name: '展开待办' }));
  expect((screen.getByLabelText('答案') as HTMLInputElement).value).toBe('保留');
  expect(document.querySelector('dialog')).toBeNull();
});
it('Escape 只收起当前待办，不回答/拒绝，焦点回到收起入口', async () => {
  function Host() { const [collapsed, setCollapsed] = useState(false); return <InteractionPanel item={{ kind: 'question', id: 'q', title: '问题' }} collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)}><input aria-label="回答" /></InteractionPanel>; }
  const user = userEvent.setup(); render(<Host />); await user.type(screen.getByLabelText('回答'), '暂存'); await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '展开待办' }));
  await user.click(screen.getByRole('button', { name: '展开待办' })); expect((screen.getByLabelText('回答') as HTMLInputElement).value).toBe('暂存');
});
