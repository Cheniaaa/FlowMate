import { afterEach, expect, it, vi } from 'vitest';
import { commandMeta, RuntimeClient } from '../api/client';
import { createRuntimeStore } from './runtime-store';
import { maintenanceBudgetConfirmation, maintenanceDetail, maintenancePolicy, maintenanceTask, sourceBoundary } from '../test/maintenance-fixtures';
afterEach(() => vi.unstubAllGlobals());

it('显式整理沿原命令冻结/重试；返回真实TaskHandle，详情查询失败不重交POST', async () => {
  const writes: any[] = [];
  let lose = true, offline = true;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') { writes.push(JSON.parse(String(init.body))); if (lose) { lose = false; throw new TypeError('lost'); } return Response.json(maintenanceTask); }
    if (offline) throw new TypeError('offline');
    return Response.json(maintenanceDetail);
  });
  const store = createRuntimeStore(new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 }));
  const command = { meta: commandMeta(5), data: { scope: maintenancePolicy.scope, source_boundary: sourceBoundary,
    budget_confirmation: maintenanceBudgetConfirmation } };
  const first = await store.dispatch({ type: 'submitMemoryMaintenance', args: [command] });
  expect(first.status).toBe('unconfirmed');
  command.data.source_boundary = { ...sourceBoundary, event_id: '9007199254741999' };
  command.data.budget_confirmation = { ...maintenanceBudgetConfirmation, model_version: 99,
    limits: { ...maintenancePolicy.maintenance_limits, deadline_seconds: 1 } };
  const second = await store.retry(first.commandId);
  expect(second).toMatchObject({ status: 'confirmed', sync: 'pending', task: maintenanceTask });
  expect(writes[1]).toEqual(writes[0]);
  offline = false; await store.retry(first.commandId);
  expect(writes).toHaveLength(2);
  expect(store.getSnapshot().runs[maintenanceTask.run_id].kind).toBe('maintenance');
});
