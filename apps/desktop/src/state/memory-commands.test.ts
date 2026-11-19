import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, commandMeta, RuntimeClient } from '../api/client';
import { memory } from '../test/memory-fixtures';
import { id } from '../test/fixtures';
import { createRuntimeStore } from './runtime-store';
afterEach(() => vi.unstubAllGlobals());

it('聊天决定丢响应后只以原命令和原回执重试，投影仅保留无正文状态', async () => {
  const writes: { url: string; body: any }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    writes.push({ url, body: JSON.parse(String(init.body)) });
    if (writes.length === 1) throw new TypeError('response lost');
    return Response.json({ ...memory, status: 'confirmed', revision: 4 });
  });
  const store = createRuntimeStore(new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 }));
  const meta = commandMeta(memory.revision);
  const first = await store.dispatch({ type: 'decideMemory', args: [memory.id, { meta, data: { action: 'accept', scope: memory.scope } }, id] });
  expect(first.status).toBe('unconfirmed');
  expect(store.getCommandsSnapshot()).toHaveLength(1);
  const second = await store.retry(meta.command_id!);
  expect(second).toMatchObject({ status: 'confirmed', sync: 'ready' });
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  expect(writes[1].url).toContain(`receipt_message_id=${id}`);
  expect(store.getSnapshot().memoryNotices[memory.id]).toMatchObject({ status: 'confirmed', revision: 4 });
  expect(JSON.stringify(store.getSnapshot())).not.toContain(memory.text);
  expect(store.getCommandsSnapshot()).toEqual([]);
});
