import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { SessionContext } from '../../generated/contracts';
import { id, page, secondId } from '../../test/fixtures';
import ContextPanel from './ContextPanel';

afterEach(() => vi.unstubAllGlobals());
const context: SessionContext = {
  round: { run_id: id, state: 'completed', source_attention: false },
  files: [], hidden_file_count: 0, history: null, latest_request: null, activities: page([]), units_per_currency: '1000000000',
  knowledge: [{ evidence_id: secondId, name: '项目说明.md', start_line: 18, end_line: 20, historical: true }],
  hidden_knowledge_count: 1,
};
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });

it('真实生成契约的上下文只显示已使用资料摘要，按Evidence打开，不预取正文', async () => {
  const reads: string[] = [], open = vi.fn();
  vi.stubGlobal('fetch', async (url: string) => { reads.push(new URL(url).pathname); return Response.json(context); });
  render(<ContextPanel client={client()} sessionId={id} revision="1" accountingRevision="1" authorization="1"
    onInspect={vi.fn()} onResources={vi.fn()} onUseFileVersion={vi.fn()} fileSelectionDisabled={false} onOpenEvidence={open} />);
  const knowledge = within(await screen.findByRole('region', { name: '已用于模型的项目资料' }));
  expect(await knowledge.findByText('项目说明.md')).toBeTruthy();
  expect(knowledge.getByText(/18–20 行/)).toBeTruthy();
  expect(knowledge.getByText('历史原文')).toBeTruthy();
  expect(knowledge.getByText('1 项资料已不可用。')).toBeTruthy();
  await userEvent.click(knowledge.getByRole('button', { name: '打开 项目说明.md' }));
  expect(open).toHaveBeenCalledExactlyOnceWith(secondId);
  expect(reads).toEqual([`/v4/sessions/${id}/context`]);
  expect(knowledge.queryByText(secondId)).toBeNull();
  expect(screen.queryByText('本轮没有固定文件。')).toBeNull();
  expect(screen.queryByText('当前记录无文件检查或读取。')).toBeNull();
});

it('完全没有资料来源时只保留一个必要空态', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ ...context, knowledge: [], hidden_knowledge_count: 0 }));
  render(<ContextPanel client={client()} sessionId={id} revision="1" accountingRevision="1" authorization="1"
    onInspect={vi.fn()} onResources={vi.fn()} onUseFileVersion={vi.fn()} fileSelectionDisabled={false} />);
  const sources = within(await screen.findByRole('region', { name: '本轮来源' }));
  expect(await sources.findByText('本轮尚无已使用的资料。')).toBeTruthy();
  expect(sources.queryByText('本轮没有固定文件。')).toBeNull();
  expect(sources.queryByText('当前记录无文件检查或读取。')).toBeNull();
  expect(sources.queryByText('本轮尚未向模型提供项目资料。')).toBeNull();
});

it('权限或知识通知变化即遮去旧摘要，最新投影返回前不保留文件名', async () => {
  let resolve!: (value: Response) => void, calls = 0;
  vi.stubGlobal('fetch', async () => ++calls === 1 ? Response.json(context) : new Promise<Response>(done => { resolve = done; }));
  const runtime = client();
  const content = (authorization: string) => <ContextPanel client={runtime} sessionId={id} revision="1" accountingRevision="1"
    authorization={authorization} onInspect={vi.fn()} onResources={vi.fn()} onUseFileVersion={vi.fn()}
    fileSelectionDisabled={false} onOpenEvidence={vi.fn()} />;
  const view = render(content('before'));
  await screen.findByText('项目说明.md');
  view.rerender(content('after'));
  expect(screen.queryByText('项目说明.md')).toBeNull();
  await waitFor(() => expect(resolve).toBeDefined());
  await act(async () => resolve(Response.json({ ...context, knowledge: [], hidden_knowledge_count: 1 })));
  await screen.findByText('1 项资料已不可用。');
  expect(screen.queryByText('项目说明.md')).toBeNull();
});
