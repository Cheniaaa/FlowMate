import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { MemoryEvidenceExcerpt, MemoryEvidencePage, MemoryRecord } from '../../generated/contracts';
import { createRuntimeStore } from '../../state/runtime-store';
import { page } from '../../test/fixtures';
import { memory } from '../../test/memory-fixtures';
import MemoryEvidenceReader from './MemoryEvidenceReader';

afterEach(() => vi.unstubAllGlobals());
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
const items: MemoryEvidencePage['items'] = memory.evidence.map(evidence => ({ evidence, available: true, reason: null }));
const quote = '真实用户原话：<script>这是一段数据，不执行。</script>';
function excerpt(record: MemoryRecord = memory, text = quote): MemoryEvidenceExcerpt {
  return { record_id: record.id, record_revision: record.revision, evidence: record.evidence[0],
    source_label: '对话「普通来源」', reason: null,
    excerpt: { text, start: 0, end: text.length, total_chars: text.length, source_version: record.evidence[0].source_version } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}
function server(read: (url: URL) => Promise<Response> = async () => Response.json(excerpt())) {
  const reads: { url: URL; init: RequestInit }[] = [];
  let available = true, resolved = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url); reads.push({ url: parsed, init });
    if (parsed.pathname.endsWith('/excerpt')) return read(parsed);
    if (parsed.pathname.endsWith('/evidence')) return Response.json(page(items.map(item => ({
      ...item, available, reason: available ? null : 'scope_revoked',
    }))));
    if (resolved) return Response.json({ error: { code: 'memory_candidate_resolved', safe_message: '候选已处理',
      retryable: false, related_ids: [] } }, { status: 409 });
    return Response.json(memory);
  });
  return { reads, revoke: () => { available = false; }, resolve: () => { resolved = true; } };
}

it('仅用户展开后读取有界原话，显示可读作者、出处和定位，原文按文本转义', async () => {
  const api = server(), runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  const { container } = render(<MemoryEvidenceReader client={runtime} store={store} record={memory} items={items} />);
  await act(async () => {});
  expect(api.reads).toHaveLength(0);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  expect(await screen.findByText(quote)).toBeTruthy();
  expect(screen.getByText('用户原话')).toBeTruthy();
  expect(screen.getByText('对话「普通来源」')).toBeTruthy();
  expect(screen.getByText('消息第 1 段')).toBeTruthy();
  expect(screen.queryByText(memory.evidence[0].source_id)).toBeNull();
  expect(screen.queryByText(memory.evidence[0].locator)).toBeNull();
  expect(container.querySelector('script')).toBeNull();
  expect(api.reads[0].url.searchParams.get('expected_revision')).toBe('3');
  expect(api.reads[0].init.cache).toBe('no-store');
});

it('聊天阅读始终绑定原 receipt；已处理候选的复核立即移除旧正文', async () => {
  const api = server(), runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  render(<MemoryEvidenceReader client={runtime} store={store} record={memory} items={items} receiptMessageId="real-receipt" />);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText(quote);
  expect(api.reads[0].url.searchParams.get('receipt_message_id')).toBe('real-receipt');
  api.resolve();
  await act(async () => { fireEvent(window, new Event('focus')); });
  await waitFor(() => expect(screen.queryByText(quote)).toBeNull());
});

it('来源事件立即隐藏已展开原文，新的不可用响应不保留旧内容', async () => {
  const waiting = deferred<Response>();
  let count = 0;
  server(async () => ++count === 1 ? Response.json(excerpt()) : waiting.promise);
  const runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  render(<MemoryEvidenceReader client={runtime} store={store} record={memory} items={items} />);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText(quote);
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1, cursor: '1' })); });
  expect(screen.queryByText(quote)).toBeNull();
  await act(async () => { waiting.resolve(Response.json({ ...excerpt(), excerpt: null, reason: 'source_unavailable' })); });
  await screen.findByText(/来源已撤销、删除或修订/);
  expect(screen.queryByText(quote)).toBeNull();
});

it('另一项目撤权即使没有本窗SSE，也在已展开阅读器聚焦复核时清除旧正文', async () => {
  const api = server(), runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  render(<MemoryEvidenceReader client={runtime} store={store} record={memory} items={items} />);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText(quote);
  api.revoke();
  await act(async () => { fireEvent(window, new Event('focus')); });
  await waitFor(() => expect(screen.queryByText(quote)).toBeNull());
  expect(api.reads.filter(item => item.url.pathname.endsWith('/excerpt'))).toHaveLength(1);
});

it('记录修订切换后的迟到原文不能覆盖新响应', async () => {
  const old = deferred<Response>(), current = deferred<Response>();
  server(url => url.searchParams.get('expected_revision') === '3' ? old.promise : current.promise);
  const runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  const next = { ...memory, revision: 4 };
  const view = render(<MemoryEvidenceReader client={runtime} store={store} record={memory} items={items} />);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  view.rerender(<MemoryEvidenceReader client={runtime} store={store} record={next} items={items} />);
  await act(async () => { current.resolve(Response.json(excerpt(next, '当前修订原话'))); });
  await screen.findByText('当前修订原话');
  await act(async () => { old.resolve(Response.json(excerpt(memory, '迟到旧原话'))); });
  expect(screen.queryByText('迟到旧原话')).toBeNull();
  expect(screen.getByText('当前修订原话')).toBeTruthy();
});

it('私有或内部依据只显示清楚的来源说明，不以指针代替可阅读原文', async () => {
  server(async () => Response.json({ ...excerpt(), source_label: '任务内部消息来源',
    excerpt: null, reason: 'source_not_public' }));
  const runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  render(<MemoryEvidenceReader client={runtime} store={store} record={memory} items={items} />);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText(/仅可在原任务查看已公开的交付或授权/);
  expect(screen.queryByText(quote)).toBeNull();
});

it('没有SSE和聚焦事件时也复核已展开原文，失效后不会自动重新请求正文', async () => {
  const api = server(), runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  render(<MemoryEvidenceReader client={runtime} store={store} record={memory} items={items} />);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText(quote);
  api.revoke();
  await screen.findByText(/依据已失效或记忆已改变/, {}, { timeout: 6500 });
  expect(screen.queryByText(quote)).toBeNull();
  expect(api.reads.filter(item => item.url.pathname.endsWith('/excerpt'))).toHaveLength(1);
}, 10000);

it('下一段使用返回的边界读取，切换期间不残留上一段正文', async () => {
  const full = '第一段依据' + 'a'.repeat(2000 - '第一段依据'.length) + '下一段依据' + 'b'.repeat(100 - '下一段依据'.length);
  const api = server(async url => {
    const offset = Number(url.searchParams.get('offset'));
    return Response.json({ ...excerpt(), excerpt: {
      text: full.slice(offset, offset + 2000), start: offset, end: offset === 0 ? 2000 : 2100,
      total_chars: 2100, source_version: memory.evidence[0].source_version,
    } });
  });
  const runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  render(<MemoryEvidenceReader client={runtime} store={store} record={memory} items={items} />);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText(/^第一段依据/);
  const next = screen.getByRole('button', { name: '查看下一段依据' });
  next.focus();
  await user.keyboard('{Enter}');
  await screen.findByText(/^下一段依据/);
  const heading = screen.getByRole('heading', { name: '对话「普通来源」' });
  expect(document.activeElement).toBe(heading);
  expect(screen.queryByText(/^第一段依据/)).toBeNull();
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  await screen.findByText(/^下一段依据/);
  expect(document.activeElement).toBe(heading);
  expect(api.reads.filter(item => item.url.pathname.endsWith('/excerpt'))
    .map(item => item.url.searchParams.get('offset'))).toEqual(['0', '2000', '2000']);
});

it('仅依据可用性变化也立刻隐藏原文，不依赖记录修订或全局事件', async () => {
  server();
  const runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  const view = render(<MemoryEvidenceReader client={runtime} store={store} record={memory} items={items} />);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText(quote);
  view.rerender(<MemoryEvidenceReader client={runtime} store={store} record={memory}
    items={items.map(item => ({ ...item, available: false, reason: 'scope_revoked' }))} />);
  expect(screen.queryByText(quote)).toBeNull();
  expect(screen.getByText(/来源已失效/)).toBeTruthy();
});
