import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { id, page } from '../../test/fixtures';
import { skillReceipt } from '../../test/skill-fixtures';
import CapabilityLibrary from './CapabilityLibrary';

afterEach(() => vi.unstubAllGlobals());
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
const receipt = { ...skillReceipt, state: 'needs_restore', target_matches: 'missing',
  backup_path: 'C:\\Synthetic\\.owned.backup', backup_matches: true, stage_matches: true,
  cleanup_pending: true, disposition: 'pending' };

it('即使原Skill已删除，能力库保存记录仍可显式恢复/完成清理再重试删除', async () => {
  const writes: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      writes.push(path);
      return Response.json({ ...receipt, state: 'original', target_matches: 'original',
        disposition: path.endsWith('/finalize') ? 'restored' : 'pending',
        cleanup_pending: !path.endsWith('/finalize'), backup_matches: false });
    }
    if (path.endsWith('/skills')) return Response.json(page([]));
    if (path.endsWith('/skill-exports')) return Response.json([receipt]);
    throw new Error(`恢复不应读取已删原包 ${path}`);
  });
  const user = userEvent.setup();
  render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: '保存记录与恢复' }));
  await screen.findByText('保存中断，原文件待恢复');
  expect(writes).toEqual([]);
  await user.click(screen.getByRole('button', { name: '恢复原文件' }));
  await screen.findByText('原文件完整，未确认保存新版本');
  await user.click(screen.getByRole('button', { name: '完成处置并清理所属临时文件' }));
  await screen.findByText('已处置；可返回重试删除');
  expect(writes).toEqual([`/v3/capabilities/skill-exports/${id}/restore`, `/v3/capabilities/skill-exports/${id}/finalize`]);
});

it('放弃恢复要求显式确认，回执处置后不再提供恢复或清理', async () => {
  const writes: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      writes.push(path); return Response.json({ ...receipt, state: 'conflict', disposition: 'released' });
    }
    if (path.endsWith('/skills')) return Response.json(page([]));
    return Response.json([{ ...receipt, state: 'conflict' }]);
  });
  const user = userEvent.setup();
  render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: '保存记录与恢复' }));
  await user.click(await screen.findByRole('button', { name: '放弃自动恢复' }));
  expect(writes).toEqual([]);
  expect(screen.getByText(/外部目标、暂存和备份都会保留/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '确认放弃恢复并保留外部文件' }));
  await screen.findByText('已放弃自动恢复；外部文件保留');
  expect(screen.queryByRole('button', { name: '恢复原文件' })).toBeNull();
  expect(writes).toEqual([`/v3/capabilities/skill-exports/${id}/release`]);
});

it('跨窗失效重查期间保留正在操作的恢复入口', async () => {
  let reads = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    if (new URL(url).pathname.endsWith('/skills')) return Response.json(page([]));
    if (++reads > 1) return new Promise<Response>(() => {});
    return Response.json([receipt]);
  });
  const runtime = client();
  const view = render(<CapabilityLibrary client={runtime} workspaceId={id} initialRecovery refreshKey={0} onClose={() => {}} />);
  await screen.findByRole('button', { name: '恢复原文件' });
  view.rerender(<CapabilityLibrary client={runtime} workspaceId={id} initialRecovery refreshKey={1} onClose={() => {}} />);
  expect(screen.getByRole('button', { name: '恢复原文件' })).toBeTruthy();
});
