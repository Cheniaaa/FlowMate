import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModelMessage } from '../../generated/contracts';
import { RuntimeClient } from '../../api/client';
import { createRuntimeStore } from '../../state/runtime-store';
import { id, page, secondId } from '../../test/fixtures';
import { memory } from '../../test/memory-fixtures';
import MessageList from './MessageList';
afterEach(() => vi.unstubAllGlobals());
const call: ModelMessage = { id, role: 'assistant', origin: 'conversation', parts: [{ kind: 'tool_call', name: 'memory.propose',
  call_id: 'proposal', arguments: { text: memory.text, scope: memory.scope, kind: memory.kind, author_kind: 'user', evidence: memory.evidence } }],
  activity_id: null, run_id: id, source_dependencies: [], private_ref: null, event_id: '1', event_index: 0 };
const result: ModelMessage = { ...call, id: secondId, role: 'tool', parts: [{ kind: 'tool_result', origin_message_id: id, call_id: 'proposal',
  result: { id: memory.id, revision: 1, status: 'candidate' }, error: null }] };

it.each([false, true])('真实memory.propose成功回执配对读取当前候选，用展示revision只accept一次，纠正=%s', async correction => {
  let current = { ...memory, revision: 1, author_kind: 'user' as const, supersedes: correction ? id : null };
  const writes: any[] = [], reads: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), path = parsed.pathname; reads.push(path + parsed.search);
    if (init.method === 'POST') { const body = JSON.parse(String(init.body)); writes.push(body); current = { ...current, revision: 2, status: 'confirmed' }; return Response.json(current); }
    if (path.endsWith('/evidence')) return Response.json(page(current.evidence.map(evidence => ({ evidence, available: true, reason: null }))));
    if (current.status !== 'candidate') return Response.json({ error: { code: 'memory_candidate_resolved', safe_message: '候选已处理', retryable: false, related_ids: [] } }, { status: 409 });
    return Response.json(current);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 }), store = createRuntimeStore(client);
  const user = userEvent.setup();
  const source = structuredClone(call);
  if (correction) {
    const part = source.parts[0];
    if (part.kind === 'tool_call') Object.assign(part.arguments, { record_id: id, expected_revision: 1 });
  }
  render(<MessageList client={client} store={store} messages={[result, source]} assistantName="助理" />);
  await screen.findByText(memory.text);
  expect(reads).toContain(`/v3/memory/records/${memory.id}?receipt_message_id=${result.id}`);
  expect(screen.getByText('适用范围：个人')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
  await user.click(screen.getByRole('button', { name: correction ? '确认纠正' : '记住' }));
  await screen.findByText('已记住');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ data: { action: 'accept', scope: memory.scope }, meta: { expected_version: 1 } });
  expect(writes[0].data).not.toHaveProperty('text');
  expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
  expect(reads).toContain(`/v3/memory/records/${memory.id}/decisions?receipt_message_id=${result.id}`);
  expect(screen.queryByRole('button', { name: /^(记住|确认纠正)$/ })).toBeNull();
});

it('服务端拒绝伪配对时不退回无回执读取，不展示参数正文或接受按钮', async () => {
  const reads: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    reads.push(url);
    if (url.includes('/evidence')) return Response.json(page([]));
    return Response.json({ error: { code: 'memory_receipt_invalid', safe_message: '回执与原调用不匹配', related_ids: [], retryable: false } }, { status: 409 });
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  render(<MessageList client={client} store={createRuntimeStore(client)} messages={[call, result]} assistantName="助理" />);
  await screen.findByText(/回执与原调用不匹配/);
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.queryByRole('button', { name: '记住' })).toBeNull();
  expect(reads.filter(url => !url.includes('/evidence')).every(url => url.includes(`receipt_message_id=${result.id}`))).toBe(true);
});

it.each(['error', 'wrong-origin', 'wrong-call', 'ordinary', 'user-copy'] as const)('%s回执不误认候选，不从普通文本或错误结果读记录', async kind => {
  const reads: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { reads.push(url); throw new Error('不应查询'); });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  const part = result.parts[0] as Extract<ModelMessage['parts'][number], { kind: 'tool_result' }>;
  const changed: ModelMessage = kind === 'user-copy' ? { ...result, role: 'user', parts: [{ kind: 'text', text: JSON.stringify(part.result) }] }
    : { ...result, parts: [{ ...part, error: kind === 'error' ? 'denied' : null, origin_message_id: kind === 'wrong-origin' ? memory.id : id,
      call_id: kind === 'wrong-call' ? 'other' : 'proposal' }] };
  const source = kind === 'ordinary' ? { ...call, parts: [{ ...call.parts[0], name: 'notes.read' }] } as ModelMessage : call;
  render(<MessageList client={client} store={createRuntimeStore(client)} messages={[source, changed]} assistantName="助理" />);
  expect(screen.queryByRole('region', { name: '记忆审阅' })).toBeNull();
  expect(reads).toEqual([]);
});

it('另一窗拒绝/删除后聊天卡重读，不显示旧正文或仍可接受的按钮', async () => {
  let current = { ...memory, revision: 1, author_kind: 'user' as const };
  vi.stubGlobal('fetch', async (url: string) => url.endsWith('/evidence') ? Response.json(page(current.evidence.map(evidence => ({ evidence, available: true, reason: null }))))
    : current.status === 'candidate' ? Response.json(current) : Response.json({ error: {
      code: 'memory_candidate_resolved', safe_message: '候选已处理', retryable: false, related_ids: [],
    } }, { status: 409 }));
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 }), store = createRuntimeStore(client);
  render(<MessageList client={client} store={store} messages={[call, result]} assistantName="助理" />);
  await screen.findByText(memory.text);
  current = { ...current, revision: 2, status: 'rejected' };
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1,
    memoryNotices: { [memory.id]: { id: current.id, scope: current.scope, revision: current.revision, status: current.status } } })); });
  await screen.findByText('已拒绝');
  expect(screen.queryByRole('button', { name: '记住' })).toBeNull();
  current = { ...current, revision: 3, status: 'deleted', text: '', evidence: [], dependencies: [] };
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1,
    memoryNotices: { [memory.id]: { id: current.id, scope: current.scope, revision: current.revision, status: current.status } } })); });
  await screen.findByText('已删除');
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(document.body.textContent).not.toContain(memory.text);
});
