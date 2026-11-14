import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, RuntimeClient } from '../../api/client';
import { grant, resource, page, id, secondId } from '../../test/fixtures';
import ResourcePanel from './ResourcePanel';
afterEach(() => vi.unstubAllGlobals());
it('显示整份 grant 全部资源和用途；取消不撤销，撤销不隐私删除', async () => {
  const other = { ...resource, id: secondId, label: '第二份资料' };
  vi.stubGlobal('fetch', async (url: string) => Response.json(new URL(url).pathname.endsWith('/resources') ? page([resource, other]) : page([{ ...grant, resource_ids: [resource.id, secondId] }])));
  const revoke = vi.fn().mockResolvedValue(undefined); const user = userEvent.setup();
  render(<ResourcePanel client={new RuntimeClient({ base_url: 'http://127.0.0.1:1234', token: 'test', protocol_version: 2 })} workspaceId={id} sessionId={null} onRevoke={revoke} />);
  await screen.findByText('第二份资料'); expect(screen.getByText('读取 · 发送至模型')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '撤销这份授权并保留历史' }));
  expect(screen.getByText(/此授权的全部/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '取消撤销' })); expect(revoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '撤销这份授权并保留历史' }));
  await user.click(screen.getByRole('button', { name: '确认撤销整份授权' }));
  expect(revoke).toHaveBeenCalledWith(grant.id, expect.objectContaining({ expected_version: grant.version }));
  expect(screen.queryByRole('button', { name: /删除/ })).toBeNull();
});
it('外窗撤销的持久通知触发重读，旧授权不能继续显示可撤销', async () => {
  let revoked = false;
  vi.stubGlobal('fetch', async (url: string) => Response.json(new URL(url).pathname.endsWith('/resources') ? page([resource]) : page([{ ...grant, ...(revoked ? { version: 2, epoch: 2, status: 'revoked' } : {}) }])));
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1234', token: 'test', protocol_version: 2 });
  const view = render(<ResourcePanel client={client} workspaceId={id} sessionId={null} onRevoke={async () => {}} refreshKey="1" />);
  await screen.findByText(/整个项目.*有效/); revoked = true;
  view.rerender(<ResourcePanel client={client} workspaceId={id} sessionId={null} onRevoke={async () => {}} refreshKey="2" />);
  await screen.findByText(/已撤销/);
  expect((screen.getByRole('button', { name: '撤销这份授权并保留历史' }) as HTMLButtonElement).disabled).toBe(true);
});
it('同一事件批次重复确认不会生成两条撤销命令', async () => {
  vi.stubGlobal('fetch', async (url: string) => Response.json(new URL(url).pathname.endsWith('/resources') ? page([resource]) : page([grant])));
  const revoke = vi.fn().mockImplementation(() => new Promise(() => {})); const user = userEvent.setup();
  render(<ResourcePanel client={new RuntimeClient({ base_url: 'http://127.0.0.1:1234', token: 'test', protocol_version: 2 })} workspaceId={id} sessionId={null} onRevoke={revoke} />);
  await user.click(await screen.findByRole('button', { name: '撤销这份授权并保留历史' }));
  const confirm = screen.getByRole('button', { name: '确认撤销整份授权' });
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm); }); expect(revoke).toHaveBeenCalledOnce();
});
it('版本冲突重读授权事实并保留原因，不自动换版本重复提交', async () => {
  let revoked = false;
  vi.stubGlobal('fetch', async (url: string) => Response.json(new URL(url).pathname.endsWith('/resources') ? page([resource]) : page([{ ...grant, ...(revoked ? { version: 2, epoch: 2, status: 'revoked' } : {}) }])));
  const revoke = vi.fn(async () => { revoked = true; throw new ApiError(409, 'version_conflict', '授权已改变，请重新决定'); });
  const user = userEvent.setup(); render(<ResourcePanel client={new RuntimeClient({ base_url: 'http://127.0.0.1:1234', token: 'test', protocol_version: 2 })} workspaceId={id} sessionId={null} onRevoke={revoke} />);
  await user.click(await screen.findByRole('button', { name: '撤销这份授权并保留历史' })); await user.click(screen.getByRole('button', { name: '确认撤销整份授权' }));
  await screen.findByText(/已撤销/); expect(screen.getByRole('alert').textContent).toContain('重新决定'); expect(revoke).toHaveBeenCalledOnce();
});
