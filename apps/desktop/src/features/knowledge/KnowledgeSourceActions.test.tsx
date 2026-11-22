import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { source } from './knowledge-fixtures';
import KnowledgeSourceActions from './KnowledgeSourceActions';
import KnowledgePage from './KnowledgePage';
import { id, page } from '../../test/fixtures';
import { otherSourceId, sourcePage } from './knowledge-fixtures';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
const runtime = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 });

it('移出使用当前 revision；清理失败显示停止事实，重试用新命令与最新 revision', async () => {
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    writes.push(JSON.parse(String(init.body)));
    return Response.json({ ...source, status: 'removed', revision: writes.length === 1 ? 3 : 5,
      cleanup_status: 'pending', cleanup_reason: null });
  });
  const changed = vi.fn(), client = runtime(), user = userEvent.setup();
  const view = render(<KnowledgeSourceActions client={client} source={source} onChanged={changed} onUpdate={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: '移出项目资料' }));
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(writes[0]).toMatchObject({ meta: { expected_version: source.revision }, data: { action: 'remove' } });
  view.rerender(<KnowledgeSourceActions client={client} source={{ ...source, revision: 4, status: 'removed',
    cleanup_status: 'failed', cleanup_reason: 'index_cleanup_failed' }} onChanged={changed} onUpdate={vi.fn()} />);
  expect(screen.getByText('已停止使用，清理未完成。')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '重试清理' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toMatchObject({ meta: { expected_version: 4 }, data: { action: 'remove' } });
  expect(writes[1].meta.command_id).not.toBe(writes[0].meta.command_id);
  expect(document.body.textContent).not.toMatch(/index_cleanup_failed|Lance|hash|generation/);
});

it('同名资料按简短位置及加入时间选择，隐私删除确认同一来源且只提交该 source', async () => {
  const first = { ...source, origin_hint: '设计文档', added_at: '2026-11-21T08:00:00Z', latest_job: null };
  const second = { ...source, id: otherSourceId, origin_hint: '会议文档', added_at: '2026-11-22T09:00:00Z', latest_job: null };
  const commands: { path: string; body: any }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      commands.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json({ ...source, id: otherSourceId, status: 'deleted', revision: 3 });
    }
    return Response.json(path.endsWith('/sources') ? sourcePage([first, second]) : page([]));
  });
  const user = userEvent.setup();
  render(<KnowledgePage client={runtime()} workspaceId={id} />);
  const row = await screen.findByRole('button', { name: /项目说明.md.*会议文档/ });
  expect(row.querySelector('time')?.dateTime).toBe('2026-11-22T09:00:00Z');
  expect(row.textContent).not.toMatch(/v1|00000000|[A-Z]:\\/);
  await user.click(row);
  await user.click(screen.getByText('操作与处理记录'));
  await user.click(screen.getByRole('button', { name: '隐私删除' }));
  const dialog = await screen.findByRole('dialog', { name: '隐私删除资料' });
  expect(within(dialog).getByText(/会议文档/)).toBeTruthy();
  expect(dialog.querySelector('time')?.dateTime).toBe('2026-11-22T09:00:00Z');
  expect(commands).toHaveLength(0);
  await user.click(within(dialog).getByRole('button', { name: '确认隐私删除' }));
  await waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toMatchObject({ path: `/v4/knowledge/sources/${otherSourceId}/actions`,
    body: { meta: { expected_version: source.revision }, data: { action: 'delete' } } });
});

it('隐私删除确认包含当前详情的简短位置和加入时间，不展示内部身份', async () => {
  const user = userEvent.setup();
  render(<KnowledgeSourceActions client={runtime()} source={source} originHint="会议文档"
    addedAt="2026-11-22T09:00:00Z" onChanged={vi.fn()} onUpdate={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: '隐私删除' }));
  const dialog = screen.getByRole('dialog', { name: '隐私删除资料' });
  expect(within(dialog).getByText(/会议文档/)).toBeTruthy();
  expect(dialog.querySelector('time')?.dateTime).toBe('2026-11-22T09:00:00Z');
  expect(dialog.textContent).not.toContain(source.id);
});

it('隐私删除只在说明原文件保留后明确确认一次，不能当普通移出', async () => {
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    writes.push(JSON.parse(String(init.body)));
    return Response.json({ ...source, status: 'deleted', revision: 3, cleanup_status: 'pending' });
  });
  const user = userEvent.setup();
  render(<KnowledgeSourceActions client={runtime()} source={source} onChanged={vi.fn()} onUpdate={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: '隐私删除' }));
  expect(writes).toHaveLength(0);
  expect(screen.getByText(/不会删除原文件/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '确认隐私删除' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data.action).toBe('delete');
});

it('存储暂忙的隐私清理显示未完成并可按最新状态明确重试', async () => {
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const command = JSON.parse(String(init.body)); writes.push(command);
    return Response.json({ ...source, status: 'deleted', revision: 8, cleanup_status: 'pending' });
  });
  render(<KnowledgeSourceActions client={runtime()} source={{ ...source, revision: 7, status: 'deleted',
    cleanup_status: 'failed', cleanup_reason: 'storage_checkpoint_pending' }} onChanged={vi.fn()} onUpdate={vi.fn()} />);
  const user = userEvent.setup();
  expect(screen.getByText('已停止使用，清理未完成。')).toBeTruthy();
  expect(screen.queryByText('已停止使用，后台正在清理。')).toBeNull();
  await user.click(screen.getByRole('button', { name: '重试清理' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ meta: { expected_version: 7 }, data: { action: 'delete' } });
});

it('来源动作 unknown 后重开重放同一命令及 source，不生成第二个动作', async () => {
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    writes.push(JSON.parse(String(init.body)));
    if (writes.length === 1) throw new TypeError('response lost');
    return Response.json({ ...source, revision: 3, status: 'removed', cleanup_status: 'pending' });
  });
  const client = runtime(), user = userEvent.setup(), changed = vi.fn();
  const view = render(<KnowledgeSourceActions client={client} source={source} onChanged={changed} onUpdate={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: '移出项目资料' }));
  await screen.findByText(/操作结果待核对/);
  view.unmount();
  render(<KnowledgeSourceActions client={client} source={{ ...source, revision: 3, status: 'removed' }} onChanged={changed} onUpdate={vi.fn()} />);
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});
