import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, RuntimeClient } from './client';
import { invoke } from '@tauri-apps/api/core';
import { event, grant, id, page, publication, resource, run, secondId } from '../test/fixtures';

const connection = { base_url: 'http://127.0.0.1:54321', token: 'public-test-token', protocol_version: 2 };
const meta = { command_id: id, expected_version: null };
const client = () => new RuntimeClient(connection);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('真实 HTTP wire 边界', () => {
  it('恢复/释放、命令核对和目录关联使用独立生成契约，不发送本机路径', async () => {
    const requests: { url: string; method: string; body?: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      requests.push({ url, method: init.method ?? 'GET', ...(init.body ? { body: JSON.parse(init.body as string) } : {}) });
      if (url.endsWith('/export-recovery')) return json([publication]);
      if (url.includes('/commands/')) return json({ status: 'confirmed', result: run });
      if (url.endsWith('/directory')) return json({ id, version: 2, name: '项目', directory_resource_id: resource.id });
      return json(publication);
    });
    expect(await client().exportRecovery(id)).toEqual([publication]);
    await client().restoreExport(publication.id, meta); await client().releaseExport(publication.id, meta);
    expect((await client().commandStatus(id, meta.command_id)).status).toBe('confirmed');
    await client().setWorkspaceDirectory(id, { meta, data: { resource_id: resource.id } });
    expect(requests).toEqual([
      { url: `${connection.base_url}/v2/runs/${id}/export-recovery`, method: 'GET' },
      { url: `${connection.base_url}/v2/export-recovery/${publication.id}/restore`, method: 'POST', body: meta },
      { url: `${connection.base_url}/v2/export-recovery/${publication.id}/release`, method: 'POST', body: meta },
      { url: `${connection.base_url}/v2/sessions/${id}/commands/${meta.command_id}`, method: 'GET' },
      { url: `${connection.base_url}/v2/workspaces/${id}/directory`, method: 'PUT', body: { meta, data: { resource_id: resource.id } } },
    ]);
  });
  it.each(['resources', 'grants'] as const)('%s keyset 查询保留 session 范围、全状态及 opaque cursor；省略 session 查询工作区全部', async kind => {
    const requests: { url: string; token: string | null }[] = [];
    const items = kind === 'resources' ? [resource] : [grant, { ...grant, id: secondId, version: 2, epoch: 2, status: 'revoked' }];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      requests.push({ url, token: new Headers(init.headers).get('Authorization') });
      return json({ items, next_cursor: 'fresh', watermark: event.event_id });
    });
    expect((await client()[kind](id)).items).toEqual(items);
    expect((await client()[kind](id, { session_id: secondId, cursor: 'stale', limit: 7 })).next_cursor).toBe('fresh');
    expect(requests).toEqual([
      { url: `${connection.base_url}/v2/workspaces/${id}/${kind}`, token: 'Bearer public-test-token' },
      { url: `${connection.base_url}/v2/workspaces/${id}/${kind}?session_id=${secondId}&cursor=stale&limit=7`, token: 'Bearer public-test-token' },
    ]);
  });
  it('WebView 握手只接受协议 2', async () => {
    vi.mocked(invoke).mockResolvedValue({ ...connection, protocol_version: 2 });
    expect((await RuntimeClient.connect()).connection.protocol_version).toBe(2);
    vi.mocked(invoke).mockResolvedValue({ ...connection, protocol_version: 1 });
    await expect(RuntimeClient.connect()).rejects.toThrow('Runtime 协议版本不兼容');
  });
  it('连接列表、详情和保存使用 v2 独立契约，模型 keyset 分页保留连接筛选', async () => {
    const saved = { id, version: 1, display_name: '共享连接', protocol: 'openai_compatible' as const, endpoint: 'https://example.invalid/v1', secret_ref: null, provider_preset_id: null };
    const requests: { url: string; body?: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      requests.push({ url, ...(init.body ? { body: JSON.parse(init.body as string) } : {}) });
      return json(url.includes('/models') ? page([]) : url.endsWith(`/model-connections/${id}`) ? saved : page([saved]));
    });
    await client().connections();
    await client().modelConnection(id);
    await client().saveConnection(id, { meta, data: saved });
    await client().models({ connection_id: id, cursor: 'old', limit: 5 });
    expect(requests.map(value => value.url)).toEqual([
      `${connection.base_url}/v2/model-connections`, `${connection.base_url}/v2/model-connections/${id}`,
      `${connection.base_url}/v2/model-connections/${id}`, `${connection.base_url}/v2/models?connection_id=${id}&cursor=old&limit=5`,
    ]);
    expect(requests[2].body).toEqual({ meta, data: saved });
  });
  it('使用 /v2、Bearer 及生成命令 envelope，cancel 仅发送 CommandMeta 并返回权威 completed', async () => {
    const requests: { url: string; body: unknown; token: string | null }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(init.body as string), token: new Headers(init.headers).get('Authorization') });
      return json({ ...run, state: 'completed' });
    });
    const command = { meta, data: { agent_profile_id: id, model_profile_id: id, text: 'hi' } };
    await client().startRun(id, command);
    expect(await client().cancel(id, { ...meta, expected_version: 1 })).toMatchObject({ state: 'completed' });
    expect(requests).toEqual([
      { url: `${connection.base_url}/v2/sessions/${id}/runs`, body: command, token: 'Bearer public-test-token' },
      { url: `${connection.base_url}/v2/runs/${id}/cancel`, body: { ...meta, expected_version: 1 }, token: 'Bearer public-test-token' },
    ]);
  });
  it('集合以 Page 校验，不接受数组或新增字段，并仅暴露安全错误信息', async () => {
    vi.stubGlobal('fetch', async () => json([{ id, version: 1, name: 'test' }]));
    await expect(client().workspaces()).rejects.toThrow();
    vi.stubGlobal('fetch', async () => json({ error: { code: 'version_conflict', safe_message: '请重新读取', retryable: false, related_ids: [] } }, 409));
    await expect(client().workspaces()).rejects.toMatchObject({ status: 409, message: '请重新读取' });
  });
  it('命令非法字段在发送前拒绝，错误不回显秘密输入', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => { calls++; return json(run); });
    const invalid = { meta, data: { agent_profile_id: id, model_profile_id: id, text: 'hi', api_key: 'public-test-key-not-a-secret' } };
    await expect(client().startRun(id, invalid)).rejects.not.toThrow('public-test-key-not-a-secret');
    expect(calls).toBe(0);
  });
  it('工作区分页只使用服务端 opaque cursor；导出返回待审批 Run 而非伪造写入成功', async () => {
    const requests: { url: string; method: string; body?: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, method: init.method ?? 'GET', ...(init.body ? { body: JSON.parse(init.body as string) } : {}) });
      if (init.method === 'POST') return json({ ...run, state: 'waiting_approval' }, 202);
      return json(page([]));
    });
    await client().activeRuns(id, { cursor: 'opaque-page', limit: 10 });
    await client().pendingApprovals(id, { cursor: 'opaque-page' });
    await client().pendingQuestions(id, { cursor: 'opaque-page' });
    const result = await client().exportArtifact(id, { meta: { ...meta, expected_version: 1 }, data: { target_ref: id } });
    expect(result.state).toBe('waiting_approval');
    expect(result).not.toHaveProperty('content_hash');
    expect(requests.map(request => request.url)).toEqual([
      `${connection.base_url}/v2/workspaces/${id}/runs?cursor=opaque-page&limit=10`,
      `${connection.base_url}/v2/workspaces/${id}/approvals?cursor=opaque-page`,
      `${connection.base_url}/v2/workspaces/${id}/questions?cursor=opaque-page`,
      `${connection.base_url}/v2/artifacts/${id}/export`,
    ]);
    expect(requests[3].body).toEqual({ meta: { ...meta, expected_version: 1 }, data: { target_ref: id } });
  });
});

describe('稳定 keyset 分页', () => {
  it.each(['messages', 'tasks', 'trace'] as const)('%s 沿服务端游标读取，不因水位变化重取首页', async kind => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requests.push(url);
      return json({ ...page([]), next_cursor: 'fresh-page', watermark: '9007199254740994' });
    });
    const result = await client()[kind](id, { cursor: 'stale-page', limit: 20 });
    expect(result.next_cursor).toBe('fresh-page');
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]).search).toBe('?cursor=stale-page&limit=20');
  });
  it.each([['snapshot_required', 410, 1], ['forbidden', 403, 1]] as const)(
    '%s 失败不进行无界重试', async (code, status, count) => {
      let calls = 0;
      vi.stubGlobal('fetch', async () => { calls++; return json({ error: {
        code, safe_message: '读取失败', retryable: false, related_ids: [],
      } }, status); });
      await expect(client().messages(id, { cursor: 'old' })).rejects.toMatchObject({ code });
      expect(calls).toBe(count);
    });
});

describe('SSE 恢复', () => {
  it.each(['event', 'connection'] as const)('%s 消费者错误遇同时断流仍保留原异常，不被清理覆盖或重试', async phase => {
    const original = new TypeError('consumer failed');
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let reads = 0;
    vi.stubGlobal('fetch', async () => {
      reads++;
      return new Response(new ReadableStream({ start(controller) {
        stream = controller;
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'durable', event_id: event.event_id, event })}\n\n`));
      } }));
    });
    const fail = () => { stream.error(new TypeError('synthetic SSE connection reset')); throw original; };
    await expect(client().watchWorkspace(id, '0', {
      snapshot() {},
      event: () => { if (phase === 'event') fail(); },
      connection: state => { if (phase === 'connection' && state === 'connected') fail(); },
    }, new AbortController().signal)).rejects.toBe(original);
    expect(reads).toBe(1);
  });

  it('410 先 reset 快照，从快照水位重连；delta 不推进游标；断流不重交命令', async () => {
    const abort = new AbortController();
    const requests: { url: string; method: string; token: string | null }[] = [];
    const received: unknown[] = [];
    let streams = 0;
    const snapshot = { workspace: { id, version: 1, name: 'test', directory_resource_id: null }, sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: '9007199254740993' };
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, method: init.method ?? 'GET', token: new Headers(init.headers).get('Authorization') });
      if (url.includes('/snapshot')) return json(snapshot);
      streams++;
      if (streams === 1) return json({ error: { code: 'snapshot_required', safe_message: '重新读取快照', retryable: false, related_ids: [] } }, 410);
      const frames = [{ kind: 'delta', activity_id: id, index: 0, text: 'temp' }, { kind: 'durable', event_id: event.event_id, event }];
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frames.map(value => `data: ${JSON.stringify(value)}\n\n`).join(''))); controller.close(); } }));
    });
    await client().watchWorkspace(id, '0', {
      snapshot: (value: unknown) => { received.push(value); },
      event: (value: { kind: string }) => { received.push(value); if (value.kind === 'durable') abort.abort(); },
    }, abort.signal);
    expect(received).toEqual([snapshot, { kind: 'delta', activity_id: id, index: 0, text: 'temp' }, { kind: 'durable', event_id: event.event_id, event }]);
    expect(requests.map(value => value.url)).toEqual([
      `${connection.base_url}/v2/workspaces/${id}/events?after=0`, `${connection.base_url}/v2/workspaces/${id}/snapshot`,
      `${connection.base_url}/v2/workspaces/${id}/events?after=9007199254740993`,
    ]);
    expect(requests.every(value => value.method === 'GET' && value.token === 'Bearer public-test-token')).toBe(true);
  });
  it('非 410 的 HTTP 拒绝不静默重试', async () => {
    let requests = 0;
    vi.stubGlobal('fetch', async () => { requests++; return json({ error: { code: 'forbidden', safe_message: '无权限', retryable: false, related_ids: [] } }, 403); });
    await expect(client().watchWorkspace(id, '0', { snapshot() {}, event() {} }, new AbortController().signal)).rejects.toBeInstanceOf(ApiError);
    expect(requests).toBe(1);
  });
  it('EOF 重连只使用已处理 durable 水位，不使用 delta index 或 SSE id', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      if (urls.length === 2) abort.abort();
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`id: 999999999999999999999\ndata: ${JSON.stringify({ kind: 'durable', event_id: event.event_id, event })}\n\ndata: ${JSON.stringify({ kind: 'delta', activity_id: id, index: 100, text: 'temp' })}\n\n`));
        controller.close();
      } }));
    });
    const watching = client().watchWorkspace(id, '0', { snapshot() {}, event() {} }, abort.signal);
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(1000);
    await watching;
    expect(urls[1]).toContain('after=9007199254740993');
  });
  it('消费者 TypeError 显式失败，不伪装成网络错误重试', async () => {
    const abort = new AbortController();
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response(`data: ${JSON.stringify({ kind: 'durable', event_id: event.event_id, event })}\n\n`);
    });
    await expect(client().watchWorkspace(id, '0', { snapshot() {}, event() { throw new TypeError('consumer failed'); }, connection(state) { if (state === 'reconnecting') abort.abort(); } }, abort.signal)).rejects.toThrow('consumer failed');
    expect(calls).toBe(1);
  });
});
