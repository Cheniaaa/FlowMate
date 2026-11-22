import { afterEach, expect, it, vi } from 'vitest';
import { commandMeta, RuntimeClient } from '../api/client';
import { createRuntimeStore } from './runtime-store';
import { id, page, secondId } from '../test/fixtures';
import type { SessionInboxEntry } from '../generated/contracts';

afterEach(() => vi.unstubAllGlobals());
const entry: SessionInboxEntry = { id, version: 4, target_session_id: id, source_event_id: '9007199254740993',
  result: { run_id: id, task_id: secondId, lifetime: 'managed', submitted_state: 'completed' }, result_version: 1,
  source_valid: true, delivery_state: 'failed', viewed_at: null, consumers: [], dependencies: [], attempts: 3, last_error: 'OSError' };
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });

it('workspace stop-all丢响应不走Session命令查询；核对原样重POST，不换generation/id', async () => {
  const writes: unknown[] = [], paths: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname; paths.push(path);
    if (init.method === 'POST') {
      writes.push(JSON.parse(init.body as string));
      if (writes.length === 1) throw new TypeError('lost');
      return Response.json({ generation: 8, scope: { kind: 'workspace', workspace_id: id, session_id: null }, cancelled_run_ids: [] });
    }
    return Response.json({ generation: 8, scope: { kind: 'workspace', workspace_id: id, session_id: null } });
  });
  const store = createRuntimeStore(client()), meta = commandMeta(7);
  expect((await store.dispatch({ type: 'stopWorkspace', args: [id, meta] })).status).toBe('unconfirmed');
  expect((await store.check(meta.command_id!, id)).status).toBe('confirmed');
  expect(writes).toEqual([meta, meta]);
  expect(paths.some(path => path.includes('/commands/'))).toBe(false);
  expect(store.getSnapshot().admissions[id].generation).toBe(8);
});

it('retry只重投；回执pending不能标成成功投递，同version当前来源查询覆盖旧回执', async () => {
  const writes: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') { writes.push(path); return Response.json({ ...entry, version: 5, delivery_state: 'pending', attempts: 0, last_error: null }); }
    return Response.json(page([{ ...entry, version: 5, delivery_state: 'pending', attempts: 0, last_error: null, source_valid: false }]));
  });
  const store = createRuntimeStore(client());
  await store.dispatch({ type: 'retryDelivery', args: [id, commandMeta(entry.version)] });
  expect(writes).toEqual([`/v4/results/${id}/retry`]);
  expect(store.getSnapshot().deliveries[id].delivery_state).toBe('pending');
  expect(store.getSnapshot().deliveries[id].source_valid).toBe(false);
});
