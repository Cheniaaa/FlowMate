import { afterEach, expect, it, vi } from 'vitest';
import { commandMeta, RuntimeClient } from './client';
import { emptyProjection, reduceStream } from './events';
import { validate } from './validation';
import { event, page } from '../test/fixtures';
import { maintenanceBudgetConfirmation, maintenanceNotice, maintenancePolicy, maintenanceTask, sourceBoundary } from '../test/maintenance-fixtures';
import { memory } from '../test/memory-fixtures';
afterEach(() => vi.unstubAllGlobals());

it('T7四根沿原HTTP边界，scope/page和记录关联各自绑定，边界Units不转Number', async () => {
  const requests: { url: URL; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url); requests.push({ url: parsed, init });
    return Response.json(init.method === 'POST' ? maintenanceTask
      : parsed.pathname.includes('/source-boundaries/') ? sourceBoundary : page([maintenanceNotice]));
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
  expect(await client.memorySourceBoundary(sourceBoundary.run_id)).toEqual(sourceBoundary);
  await client.memoryMaintenance({ scope_kind: 'user_global', limit: 10, cursor: 'opaque-next' });
  await client.recordMaintenance(memory.id, { limit: 10 });
  const command = { meta: commandMeta(maintenancePolicy.version), data: { scope: maintenancePolicy.scope, source_boundary: sourceBoundary,
    budget_confirmation: maintenanceBudgetConfirmation } };
  expect(await client.submitMemoryMaintenance(command)).toEqual(maintenanceTask);
  expect(requests[1].url.searchParams.get('scope_kind')).toBe('user_global');
  expect(requests[1].url.searchParams.get('cursor')).toBe('opaque-next');
  expect(requests[2].url.pathname).toBe(`/v4/memory/records/${memory.id}/maintenance`);
  expect(JSON.parse(String(requests[3].init.body))).toEqual(command);
});

it('个人维护事件只使维护查询失效，不持有正文或误用T6 payload，也不改聊天选择', () => {
  const wire = validate('StreamEvent', { kind: 'durable', event_id: event.event_id, event: { ...event,
    kind: 'memory.maintenance_changed', workspace_id: null, seq: null, run_id: null, payload: maintenanceNotice } });
  const before = emptyProjection(), after = reduceStream(before, wire);
  expect(after.maintenanceRevision).toBe(before.maintenanceRevision + 1);
  expect(after.memoryRevision).toBe(before.memoryRevision);
  expect(after.runs).toBe(before.runs);
  expect(JSON.stringify(after)).not.toContain(memory.text);
});
