import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { id, secondId } from '../../test/fixtures';
import { evidence, evidenceId, source, sourcePage } from './knowledge-fixtures';
import EvidenceReader from './EvidenceReader';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });

it.each([1000, 520])('citation_opens_exact_version_in_both_widths：%s 宽原文分页保留历史身份与行定位，关闭回焦', async width => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const reads: URL[] = [], close = vi.fn();
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url); reads.push(parsed);
    if (parsed.pathname.endsWith('/sources')) return Response.json(sourcePage([source]));
    return Response.json(parsed.searchParams.get('offset') === '52'
      ? { ...evidence, offset: 52, next_offset: null, text: '第二段原文' } : evidence);
  });
  const trigger = document.createElement('button'); trigger.textContent = '打开引用'; document.body.append(trigger); trigger.focus();
  const view = render(<EvidenceReader client={client()} workspaceId={id} evidenceId={evidenceId} onClose={close} />);
  await screen.findByText('项目说明.md');
  expect(screen.getByText('答复引用时的内容，当前已有更新')).toBeTruthy();
  expect(screen.queryByText(/当前已有 v2/)).toBeNull();
  expect(screen.getByText(/第 18–20 行/)).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
  expect(document.querySelector('script')).toBeNull();
  expect(document.body.textContent).not.toMatch(/chunk-internal|parser-internal|generation|[a-f0-9]{64}/);
   const user = userEvent.setup();
  await user.click(screen.getByText('引用详情'));
  expect(screen.getByText(/引用版本 1/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '下一段原文' }));
  await screen.findByText('第二段原文');
  const evidenceReads = reads.filter(url => url.pathname.includes('/evidence/'));
  expect(evidenceReads.map(url => [url.pathname, url.searchParams.get('offset')])).toEqual([
    [`/v4/workspaces/${id}/knowledge/evidence/${evidenceId}`, '0'],
    [`/v4/workspaces/${id}/knowledge/evidence/${evidenceId}`, '52'],
  ]);
  await user.click(screen.getByRole('button', { name: '关闭原文' }));
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

it('切换 Evidence 立即屏蔽旧正文，迟到响应不能覆盖新引用', async () => {
  let reply!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { reply = resolve; });
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/sources')) return Response.json(sourcePage([source]));
    if (url.includes(evidenceId)) return pending;
    return Response.json({ ...evidence, evidence: { ...evidence.evidence, id: secondId }, text: '新引用原文' });
  });
  const runtime = client(), props = { client: runtime, workspaceId: id, onClose: vi.fn() };
  const view = render(<EvidenceReader {...props} evidenceId={evidenceId} />);
  view.rerender(<EvidenceReader {...props} evidenceId={secondId} />);
  await screen.findByText('新引用原文');
  reply(Response.json(evidence));
  await waitFor(() => expect(screen.queryByText(/第一段原文/)).toBeNull());
});

it('来源通知重新核对期间立即隐藏旧原文，撤权后不会继续显示原文', async () => {
  let denied = false, release!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/sources')) return Response.json(sourcePage([source]));
    return denied ? pending : Response.json(evidence);
  });
  const runtime = client(), props = { client: runtime, workspaceId: id, evidenceId, onClose: vi.fn() };
  const view = render(<EvidenceReader {...props} refreshKey="1" />);
  await screen.findByText(/第一段原文/);
  denied = true;
  view.rerender(<EvidenceReader {...props} refreshKey="2" />);
  expect(screen.queryByText(/第一段原文/)).toBeNull();
  release(Response.json({ error: { code: 'scope_revoked', safe_message: '资料已撤权，原文不可用',
    retryable: false, related_ids: [] } }, { status: 403 }));
  await screen.findByRole('alert');
  expect(screen.queryByText(/第一段原文/)).toBeNull();
});

it('原文读回后来源列表已撤权时，不展示在途旧正文', async () => {
  vi.stubGlobal('fetch', async (url: string) => url.includes('/sources')
    ? Response.json(sourcePage([{ ...source, revision: 3, status: 'revoked' }])) : Response.json(evidence));
  render(<EvidenceReader client={client()} workspaceId={id} evidenceId={evidenceId} onClose={vi.fn()} />);
  await screen.findByRole('alert');
  expect(screen.queryByText(/第一段原文/)).toBeNull();
});

it('移出后的合法历史引用使用 API 已核验的快照，注明历史状态；撤权/删除仍拒绝', async () => {
  vi.stubGlobal('fetch', async (url: string) => url.includes('/sources')
    ? Response.json(sourcePage([{ ...source, revision: 3, status: 'removed' }])) : Response.json(evidence));
  render(<EvidenceReader client={client()} workspaceId={id} evidenceId={evidenceId} onClose={vi.fn()} />);
  await screen.findByText(/第一段原文/);
  expect(screen.getByText('资料已移出项目，当前查看答复所引的历史原文。')).toBeTruthy();
});
