import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { grant, id, page, resource, secondId } from '../../test/fixtures';
import { otherSourceId, source, sourceId, sourcePage } from '../knowledge/knowledge-fixtures';
import ResourcePanel from './ResourcePanel';

afterEach(() => vi.unstubAllGlobals());
const runtime = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 });

it('单文件知识许可从后页读取名称，撤销确认重复相同来源范围而不扩大为项目', async () => {
  const reads: URL[] = [], revoke = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url); reads.push(parsed);
    if (parsed.pathname.endsWith('/resources')) return Response.json(page([]));
    if (parsed.pathname.endsWith('/grants')) return Response.json(page([{ ...grant, resource_ids: [],
      knowledge_source_ids: [otherSourceId], purposes: ['embedding_send'] }]));
    if (parsed.pathname.endsWith('/sources')) return Response.json(parsed.searchParams.has('cursor')
      ? sourcePage([{ ...source, id: otherSourceId, label: '指定说明.md' }])
      : { ...sourcePage([source]), next_cursor: 'names:next+/' });
    throw new Error(parsed.pathname);
  });
  const user = userEvent.setup();
  render(<ResourcePanel client={runtime()} workspaceId={id} sessionId={null} onRevoke={revoke} />);
  await screen.findByText('指定说明.md');
  const card = screen.getByText('指定说明.md').closest('article')!;
  expect(within(card).queryByText(/本项目全部资料/)).toBeNull();
  await user.click(within(card).getByRole('button', { name: '撤销这份授权并保留历史' }));
  const confirmation = card.querySelector('.inline-confirmation')! as HTMLElement;
  expect(within(confirmation).getByText('指定说明.md')).toBeTruthy();
  expect(revoke).not.toHaveBeenCalled();
  expect(reads.filter(url => url.pathname.endsWith('/sources')).map(url => url.searchParams.get('cursor')))
    .toEqual([null, 'names:next+/']);
  await user.click(within(confirmation).getByRole('button', { name: '确认撤销整份授权' }));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith(grant.id, expect.objectContaining({ expected_version: grant.version })));
  expect(document.body.textContent).not.toContain(otherSourceId);
});

it('整项目知识许可说明以后加入的资料，普通授权和整项目范围不额外取名称', async () => {
  const sourceReads: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/sources')) { sourceReads.push(path); throw new Error('不需要名称'); }
    return Response.json(path.endsWith('/resources') ? page([resource]) : page([grant, {
      ...grant, id: secondId, resource_ids: [], knowledge_scopes: [{ kind: 'workspace', workspace_id: id, session_id: null }],
    }]));
  });
  const user = userEvent.setup();
  render(<ResourcePanel client={runtime()} workspaceId={id} sessionId={null} onRevoke={vi.fn()} />);
  const summary = await screen.findByText('本项目全部资料（含以后加入）');
  const card = summary.closest('article')!;
  await user.click(within(card).getByRole('button', { name: '撤销这份授权并保留历史' }));
  expect(within(card.querySelector('.inline-confirmation')! as HTMLElement)
    .getByText('本项目全部资料（含以后加入）')).toBeTruthy();
  expect(sourceReads).toEqual([]);
});

it('多文件范围先显示数量和少量名称，用户展开后可核对完整文件清单', async () => {
  const sources = Array.from({ length: 6 }, (_, index) => ({
    ...source, id: `00000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`, label: `资料${index + 1}.md`,
  }));
  const cursors: (string | null)[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/resources')) return Response.json(page([]));
    if (parsed.pathname.endsWith('/grants')) return Response.json(page([{ ...grant, resource_ids: [],
      knowledge_source_ids: sources.map(item => item.id) }]));
    cursors.push(parsed.searchParams.get('cursor'));
    return Response.json(parsed.searchParams.has('cursor') ? { ...sourcePage(sources.slice(3)), next_cursor: 'unneeded' }
      : { ...sourcePage(sources.slice(0, 3)), next_cursor: 'more-names' });
  });
  const user = userEvent.setup();
  render(<ResourcePanel client={runtime()} workspaceId={id} sessionId={null} onRevoke={vi.fn()} />);
  await screen.findByText(/6 份资料/);
  expect(screen.queryByRole('list', { name: '授权资料清单' })).toBeNull();
  await user.click(screen.getByText('查看全部文件'));
  const list = screen.getByRole('list', { name: '授权资料清单' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(6);
  expect(within(list).getByText('资料6.md')).toBeTruthy();
  expect(cursors).toEqual([null, 'more-names']);
  expect(document.body.textContent).not.toContain(sourceId);
});
