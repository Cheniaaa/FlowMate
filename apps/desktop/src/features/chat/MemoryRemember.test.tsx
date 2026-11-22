import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { ModelMessage } from '../../generated/contracts';
import { createRuntimeStore } from '../../state/runtime-store';
import { id, page, secondId } from '../../test/fixtures';
import { memory } from '../../test/memory-fixtures';
import MessageList from './MessageList';

afterEach(() => vi.unstubAllGlobals());

it.each([
  [{ outcome: 'existing', id: null, revision: null }, null, '相同记忆已经存在'],
  [{ reason: '本轮未保存记忆，剩余模型请求用于完成当前答复' }, 'memory_review_budget', '本轮未保存记忆，剩余模型请求用于完成当前答复'],
] as const)('显示记忆操作的实际结果', (result, error, feedback) => {
  const origin: ModelMessage = {
    id, role: 'assistant', origin: 'conversation', run_id: id, activity_id: null,
    event_id: '1', event_index: 0, source_dependencies: [], private_ref: null,
    parts: [{ kind: 'tool_call', name: 'memory.remember', arguments: {}, call_id: 'c1' }],
  };
  const receipt: ModelMessage = { ...origin, id: secondId, role: 'tool', parts: [{
    kind: 'tool_result', origin_message_id: id, call_id: 'c1', error, result,
  }] };
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
  render(<MessageList client={client} store={createRuntimeStore(client)} messages={[origin, receipt]} assistantName="助理" />);
  expect(screen.getByRole('status').textContent).toBe(feedback);
  expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
});

it('核对真实保存回执并按显示的修订撤销', async () => {
  const record = { ...memory, status: 'confirmed', revision: 2 };
  const writes: { path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    if (init.method === 'POST') {
      writes.push({ path: parsed.pathname + parsed.search, body: JSON.parse(String(init.body)) });
      return Response.json({ ...record, revision: 3 });
    }
    if (parsed.pathname.endsWith('/evidence')) return Response.json(page([]));
    expect(parsed.searchParams.get('receipt_message_id')).toBe(secondId);
    return Response.json(record);
  });
  const origin: ModelMessage = {
    id, role: 'assistant', origin: 'conversation', run_id: id, activity_id: null,
    event_id: '1', event_index: 0, source_dependencies: [], private_ref: null,
    parts: [{ kind: 'tool_call', name: 'memory.remember', arguments: { record_id: record.id }, call_id: 'c1' }],
  };
  const receipt: ModelMessage = { ...origin, id: secondId, role: 'tool', parts: [{
    kind: 'tool_result', origin_message_id: id, call_id: 'c1', error: null,
    result: { outcome: 'staged', id: record.id, revision: record.revision },
  }] };
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
  render(<MessageList client={client} store={createRuntimeStore(client)} messages={[origin, receipt]} assistantName="助理" />);
  await screen.findByText('已纠正记忆');
  await userEvent.click(screen.getByRole('button', { name: '撤销' }));
  await screen.findByText('已撤销记忆变更');
  expect(writes).toMatchObject([{ path: `/v4/memory/records/${record.id}/decisions?receipt_message_id=${secondId}`,
    body: { meta: { expected_version: 2 }, data: { action: 'undo', scope: record.scope } } }]);
});
