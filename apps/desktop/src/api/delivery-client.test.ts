import { afterEach, expect, it, vi } from 'vitest';
import { commandMeta, RuntimeClient } from './client';
import { binding, id, page, run, secondId } from '../test/fixtures';

afterEach(() => vi.unstubAllGlobals());
it('TaskCenterPage不是旧RunPage；查询和结果命令沿生成契约及原始CommandMeta', async () => {
  const seen: { path: string; body: unknown }[] = [];
  const entry = { id, version: 3, source_event_id: '9007199254740993', target_session_id: id,
    result: { run_id: id, task_id: secondId, lifetime: 'managed', submitted_state: 'completed' }, result_version: 1,
    delivery_state: 'delivered', viewed_at: null, dependencies: [], source_valid: true, consumers: [], attempts: 1, last_error: null };
  const root = { id: secondId, version: 1, run_id: id, binding, parent_task_id: null, origin_task_id: null, kind: 'agent',
    executor_id: 'builtin.agent', state: 'completed', created_seq: 1, deadline_at: null, result_version: 1, reason: null };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url); seen.push({ path: parsed.pathname + parsed.search, body: init.body ? JSON.parse(init.body as string) : null });
    if (parsed.pathname.endsWith('/tasks')) return Response.json(page([{ run, root, pending_count: 0, delivery_state: 'delivered', origin_task_id: null }]));
    if (parsed.pathname.endsWith('/results')) return Response.json(page([entry]));
    if (parsed.pathname.endsWith('/result')) return Response.json({ handle: entry.result, result_version: 1, state: 'completed', result: {}, artifacts: [], dependencies: [], error: null });
    return Response.json(entry);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
  expect((await client.globalTasks({ workspace_id: id, kind: 'managed', state: 'completed', limit: 50, cursor: 'opaque' })).items[0].root.id).toBe(secondId);
  await client.sessionResults(id, { limit: 50 });
  await client.taskResult(secondId);
  const meta = commandMeta(3);
  await client.viewResult(id, meta); await client.retryDelivery(id, meta);
  expect(seen).toEqual([
    { path: `/v4/tasks?workspace_id=${id}&kind=managed&state=completed&limit=50&cursor=opaque`, body: null },
    { path: `/v4/sessions/${id}/results?limit=50`, body: null },
    { path: `/v4/tasks/${secondId}/result`, body: null },
    { path: `/v4/results/${id}/view`, body: meta }, { path: `/v4/results/${id}/retry`, body: meta },
  ]);
});
