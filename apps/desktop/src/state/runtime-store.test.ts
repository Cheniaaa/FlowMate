import { describe, expect, it, vi, afterEach } from 'vitest';
import { ApiError, RuntimeClient, commandMeta } from '../api/client';
import { mergeRunDetail, mergeRunSnapshot } from '../api/events';
import { contextUsage, event, grant, id, limits, page, publication, resource, run, runDetailSummary, secondId } from '../test/fixtures';
import { createRuntimeStore, type UiCommand } from './runtime-store';
import type { RunDetail } from '../generated/contracts';

const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 });

it('撤销响应未确认时保留原归属，不因之后切换项目快照而改变命令说明', async () => {
  vi.stubGlobal('fetch', async () => { throw new TypeError('response lost'); });
  const store = createRuntimeStore(client()); store.update(state => ({ ...state, grants: { [grant.id]: grant } }));
  const meta = commandMeta(grant.version); await store.dispatch({ type: 'revoke', args: [grant.id, meta] });
  store.update(state => ({ ...state, grants: {} }));
  expect(store.getCommandsSnapshot()[0].scope).toEqual(grant.scope);
});
const detail = (value = run) => ({ ...runDetailSummary, run: value, tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
  budget: { id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, task_count: 1, steps: 0, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('RuntimeStore真实客户端边界', () => {
  it.each([
    ['event', 'fetch'], ['event', 'body'], ['reconnect', 'fetch'], ['reconnect', 'body'],
    ['event', 'fetch-and-stream'], ['reconnect', 'fetch-and-stream'],
  ] as const)('%s 摘要 %s 传输失败后按原游标恢复，补齐摘要并继续消费事件', async (trigger, failure) => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const cursor = (BigInt(event.event_id) + 1n).toString();
    const current = { ...run, version: 2 };
    const latest = { ...detail(current), watermark: cursor,
      cost_summary: { ...runDetailSummary.cost_summary, calculated_units: '2500000000' } };
    const wire = { kind: 'durable', event_id: cursor, event: { ...event, event_id: cursor,
      payload: { ...event.payload, runs: [current] } } };
    const urls: string[] = [], states: string[] = [], cancelled: number[] = [];
    let reads = 0, consumed = 0;
    let activeStream!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith(`/runs/${id}`)) {
        if (++reads === 1) {
          if (failure === 'fetch-and-stream') activeStream.error(new TypeError('synthetic SSE connection reset'));
          if (failure !== 'body') throw new TypeError('synthetic connection reset');
          return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('synthetic body reset')); } }));
        }
        return Response.json(latest);
      }
      if (url.includes('/events?')) {
        urls.push(url); const index = urls.length;
        return new Response(new ReadableStream({
          start(controller) {
            activeStream = controller;
            if (trigger === 'reconnect' && index === 1) controller.close();
            else controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`));
          },
          cancel() { cancelled.push(index); },
        }));
      }
      return Response.json({ workspace: { id, version: 1, name: '工作区', directory_resource_id: null },
        sessions: page([]), active_runs: page([run]), pending_questions: page([]), pending_approvals: page([]),
        resources: page([]), grants: page([]), watermark: event.event_id });
    });
    const store = createRuntimeStore(client());
    const result = store.loadWorkspace(id, {
      snapshot: () => { store.update(state => mergeRunDetail(state, detail())); },
      event: () => { consumed++; abort.abort(); },
      connection: state => { states.push(state); },
    }, abort.signal).then(() => undefined, error => error);
    try {
      await vi.advanceTimersByTimeAsync(3000);
      expect(await result).toBeUndefined();
      expect(consumed).toBe(1);
      expect(urls).toHaveLength(trigger === 'event' ? 2 : 3);
      expect(urls.every(url => url.endsWith(`after=${event.event_id}`))).toBe(true);
      expect(states).toContain('reconnecting');
      if (failure !== 'fetch-and-stream') expect(cancelled).toContain(trigger === 'event' ? 1 : 2);
      expect(store.getSnapshot().runSummaries[id]).toMatchObject({
        cost_summary: { calculated_units: '2500000000' }, watermark: cursor,
      });
    } finally { abort.abort(); }
  });

  it('摘要契约错误显式失败，不当作连接错误重试', async () => {
    const abort = new AbortController();
    let streams = 0;
    const wire = { kind: 'durable', event_id: event.event_id, event };
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith(`/runs/${id}`)) return Response.json({ invalid: true });
      if (url.includes('/events?')) { streams++; return new Response(`data: ${JSON.stringify(wire)}\n\n`); }
      return Response.json({ workspace: { id, version: 1, name: '工作区', directory_resource_id: null },
        sessions: page([]), active_runs: page([run]), pending_questions: page([]), pending_approvals: page([]),
        resources: page([]), grants: page([]), watermark: '0' });
    });
    try {
      await expect(createRuntimeStore(client()).loadWorkspace(id, { snapshot() {}, event() {} }, abort.signal)).rejects.toThrow();
      expect(streams).toBe(1);
    } finally { abort.abort(); }
  });

  it.each(['budget.settled', 'activity.received', 'activity.prepared'] as const)('%s 仅通过 SSE 刷新权威费用和上下文摘要', async kind => {
    const abort = new AbortController();
    const cursor = (BigInt(event.event_id) + 1n).toString();
    const currentRun = { ...run, version: 2, state: kind === 'activity.received' ? 'cancelled' as const : kind === 'budget.settled' ? 'completed' as const : 'running' as const };
    const latest: RunDetail = { ...detail(currentRun), watermark: cursor,
      cost_summary: { ...runDetailSummary.cost_summary, calculated_units: '2500000000', reserved_units: '17', unknown_request_count: 1 },
      context_usage: { ...contextUsage, activity_id: secondId, state: kind === 'activity.prepared' ? 'prepared' : 'succeeded', omitted_group_count: 1,
        omitted_message_count: 2, reason_counts: { outside_run_scope: 2 }, compaction_state: kind === 'activity.prepared' ? 'running' : 'committed',
        summary_count: kind === 'activity.prepared' ? 0 : 1, compacted_message_count: kind === 'activity.prepared' ? 0 : 2 } };
    const payload = { runs: [currentRun], tasks: [], activities: [], budgets: [{ ...latest.budget, version: 2, spent_units: '2500000000' }], messages: [], artifacts: [], questions: [], waits: [], consumptions: [], joins: [], pending_commands: [], follow_up_intents: [] };
    const wire = { kind: 'durable', event_id: cursor, event: { ...event, kind, event_id: cursor, payload } };
    let reads = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith(`/runs/${id}`)) { reads++; return Response.json(latest); }
      if (url.includes('/events?')) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`)); } }));
      return Response.json({ workspace: { id, version: 1, name: '工作区', directory_resource_id: null }, sessions: page([]), active_runs: page([run]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id });
    });
    const store = createRuntimeStore(client());
    await store.loadWorkspace(id, { snapshot: () => { store.update(state => mergeRunDetail(state, detail())); }, event: () => { abort.abort(); } }, abort.signal);
    expect(store.getSnapshot().runSummaries[id]).toMatchObject({ cost_summary: latest.cost_summary, context_usage: latest.context_usage, watermark: cursor });
    expect(reads).toBeGreaterThan(0);
  });

  it('普通 SSE 重连无新事件也重新读取已展示的终态摘要', async () => {
    const abort = new AbortController(); let connections = 0;
    const completed = { ...run, state: 'cancelled' as const };
    const latest = { ...detail(completed), cost_summary: { ...runDetailSummary.cost_summary, calculated_units: '9007199254740995' } };
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith(`/runs/${id}`)) return Response.json(latest);
      if (url.includes('/events?')) return new Response(new ReadableStream({ start(controller) { if (connections === 0) controller.close(); } }));
      return Response.json({ workspace: { id, version: 1, name: '工作区', directory_resource_id: null }, sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id });
    });
    const store = createRuntimeStore(client());
    await store.loadWorkspace(id, { snapshot: () => { store.update(state => mergeRunDetail(state, detail(completed))); }, event: () => {},
      connection: state => { if (state === 'connected' && ++connections === 2) abort.abort(); } }, abort.signal);
    expect(connections).toBe(2);
    expect(store.getSnapshot().runSummaries[id].cost_summary.calculated_units).toBe('9007199254740995');
  });

  it('POST 确认立即合并回执，GET 失败返回 confirmed/pending；重试只读不重 POST', async () => {
    const requests: string[] = [];
    let fail = true;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      requests.push(init.method ?? 'GET');
      if (init.method === 'POST') return Response.json(run);
      if (fail) throw new TypeError('offline');
      return Response.json(detail());
    });
    const store = createRuntimeStore(client()); const meta = commandMeta();
    const command: UiCommand = { type: 'startRun', args: [id, { meta, data: { agent_profile_id: id, model_profile_id: secondId, text: 'A' } }] };
    expect(await store.dispatch(command)).toEqual({ status: 'confirmed', sync: 'pending', commandId: meta.command_id });
    expect(store.getSnapshot().runs[id]).toEqual(run);
    expect(store.getCommandsSnapshot()[0].runId).toBe(id);
    fail = false;
    expect(await store.retry(meta.command_id!)).toEqual({ status: 'confirmed', sync: 'ready', commandId: meta.command_id });
    await store.dispatch(command);
    expect(requests).toEqual(['POST', 'GET', 'GET']);
  });

  it('响应丢失后保留冻结 payload；not_found 不证明未提交，显式核对 confirmed 后不重 POST', async () => {
    const bodies: unknown[] = []; let found = false;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') { bodies.push(JSON.parse(init.body as string)); throw new TypeError('response lost'); }
      if (url.includes('/commands/')) return Response.json(found ? { status: 'confirmed', result: run } : { status: 'not_found', result: null });
      return Response.json(detail());
    });
    const store = createRuntimeStore(client()); const meta = commandMeta();
    const command: UiCommand = { type: 'startRun', args: [id, { meta, data: { agent_profile_id: id, model_profile_id: secondId, text: 'A' } }] };
    const original = structuredClone(command);
    expect((await store.dispatch(command)).status).toBe('unconfirmed');
    command.args[1].data.text = 'B';
    await expect(store.dispatch(command)).rejects.toThrow('同一命令不能更改操作或参数');
    expect((await store.check(meta.command_id!, id)).status).toBe('unconfirmed');
    await store.retry(meta.command_id!);
    expect(bodies).toEqual([original.args[1], original.args[1]]);
    found = true;
    expect(await store.check(meta.command_id!, id)).toEqual({ status: 'confirmed', sync: 'ready', commandId: meta.command_id });
    expect(bodies).toHaveLength(2);
  });

  it.each(['cancel', 'answer', 'exportArtifact', 'revoke', 'restoreExport', 'releaseExport', 'setWorkspaceDirectory'] as const)(
    '%s 响应丢失及并发重复提交沿用同一 ID/冻结参数，确认后按归属刷新', async type => {
      const meta = commandMeta(1);
      const command = ({
        cancel: { type, args: [id, meta] },
        answer: { type, args: [secondId, { meta, data: { answer: 'answer' } }] },
        exportArtifact: { type, args: [secondId, { meta, data: { target_ref: resource.id } }] },
        revoke: { type, args: [grant.id, meta] },
        restoreExport: { type, args: [publication.id, meta] },
        releaseExport: { type, args: [publication.id, meta] },
        setWorkspaceDirectory: { type, args: [id, { meta, data: { resource_id: resource.id } }] },
      }[type]) as UiCommand;
      const bodies: unknown[] = []; const reads: string[] = [];
      const scope = { id: grant.id, scope: grant.scope, epoch: 2, status: 'revoked' };
      const response = type === 'revoke' ? scope : type === 'setWorkspaceDirectory' ? { id, version: 2, name: '项目', directory_resource_id: resource.id }
        : type === 'releaseExport' || type === 'restoreExport' ? { ...publication, version: 2, state: type === 'releaseExport' ? 'released' : 'restored' } : run;
      let finish!: () => void;
      vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
        if (init.method === 'POST' || init.method === 'PUT') {
          bodies.push(JSON.parse(init.body as string));
          if (bodies.length === 1) { await new Promise<void>(resolve => { finish = resolve; }); throw new TypeError('response lost'); }
          return Response.json(response);
        }
        reads.push(url);
        if (url.endsWith('/export-recovery')) return Response.json([publication]);
        if (url.includes('/grants')) return Response.json(page([{ ...grant, version: 2, epoch: 2, status: 'revoked' }]));
        if (url.endsWith('/snapshot')) return Response.json({ workspace: { id, version: 2, name: '项目', directory_resource_id: resource.id }, sessions: page([]), active_runs: page([]),
          pending_approvals: page([]), pending_questions: page([]), resources: page([]), grants: page([]), watermark: event.event_id });
        return Response.json(detail());
      });
      const store = createRuntimeStore(client());
      store.update(state => ({ ...mergeRunSnapshot(state, run), grants: { [grant.id]: grant }, publications: { [publication.id]: publication } }));
      const first = store.dispatch(command), duplicate = store.dispatch(structuredClone(command));
      expect(bodies).toHaveLength(1); finish();
      expect((await first).status).toBe('unconfirmed'); expect((await duplicate).status).toBe('unconfirmed');
      expect((await store.retry(meta.command_id!)).status).toBe('confirmed');
      expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
      expect(reads.some(url => type === 'setWorkspaceDirectory' ? url.endsWith('/snapshot') : type === 'revoke' ? url.includes('/grants') : url.includes(`/runs/${id}`))).toBe(true);
    });

  it('明确 HTTP 版本拒绝保持 ApiError，刷新事实但不换 expected_version 重发', async () => {
    let commands = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') { commands++; return Response.json({ error: { code: 'version_conflict', safe_message: '请重新决定', retryable: false, related_ids: [] } }, { status: 409 }); }
      return Response.json(detail({ ...run, version: 2, state: 'completed' }));
    });
    const store = createRuntimeStore(client()); store.update(state => mergeRunSnapshot(state, run));
    await expect(store.dispatch({ type: 'cancel', args: [id, commandMeta(1)] })).rejects.toBeInstanceOf(ApiError);
    expect(commands).toBe(1); expect(store.getSnapshot().runs[id].version).toBe(2);
  });
  it.each(['exportArtifact', 'deleteSession', 'deleteWorkspace'] as const)('%s 版本冲突刷新对应事实，不猜 Artifact 所属 Run 或重复提交', async type => {
    let writes = 0;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'POST' || init.method === 'DELETE') {
        writes++; return Response.json({ error: { code: 'version_conflict', safe_message: '请重新决定', retryable: false, related_ids: [] } }, { status: 409 });
      }
      if (url.endsWith(`/tasks/${secondId}`)) return Response.json({ id: secondId, version: 1, run_id: id, binding: { agent_work: null, input_artifacts: [], input_result: null, execution_session_id: run.execution_session_id, interaction_session_id: run.interaction_session_id, config: run.config, sources: run.sources, delegation_depth: 0 }, parent_task_id: null, origin_task_id: null,
        kind: 'agent', executor_id: 'builtin.agent', state: 'completed', created_seq: 1, deadline_at: null, result_version: 1, reason: null });
      if (url.endsWith(`/sessions/${id}`)) return Response.json({ id, version: 2, workspace_id: id, title: '更新会话', agent_profile_id: id, kind: 'interaction', archived: false });
      if (url.endsWith('/snapshot')) return Response.json({ workspace: { id, version: 2, name: '更新项目', directory_resource_id: null }, sessions: page([]),
        active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id });
      return Response.json(detail({ ...run, version: 2 }));
    });
    const store = createRuntimeStore(client());
    store.update(state => ({ ...mergeRunSnapshot(state, run), artifacts: { [secondId]: { id: secondId, version: 1, task_id: secondId, activity_id: id,
      content_hash: 'a'.repeat(64), dependencies: [], media_type: 'text/plain' } } }));
    const meta = commandMeta(1);
    const command: UiCommand = type === 'exportArtifact' ? { type, args: [secondId, { meta, data: { target_ref: resource.id } }] } : { type, args: [id, meta] };
    await expect(store.dispatch(command)).rejects.toMatchObject({ code: 'version_conflict' }); expect(writes).toBe(1);
    if (type === 'exportArtifact') expect(store.getSnapshot().runs[id].version).toBe(2);
    if (type === 'deleteSession') expect(store.getSnapshot().sessions[id].version).toBe(2);
    if (type === 'deleteWorkspace') expect(store.getSnapshot().workspaces[id].version).toBe(2);
  });
  it.each(['cancel', 'answer', 'exportArtifact', 'revoke', 'restoreExport', 'releaseExport', 'setWorkspaceDirectory'] as const)(
    '%s 确认后 refresh 失败保留 confirmed，不将重试查询变成重交命令', async type => {
      const meta = commandMeta(1);
      const command = ({
        cancel: { type, args: [id, meta] }, answer: { type, args: [secondId, { meta, data: { answer: 'answer' } }] },
        exportArtifact: { type, args: [secondId, { meta, data: { target_ref: resource.id } }] }, revoke: { type, args: [grant.id, meta] },
        restoreExport: { type, args: [publication.id, meta] }, releaseExport: { type, args: [publication.id, meta] },
        setWorkspaceDirectory: { type, args: [id, { meta, data: { resource_id: resource.id } }] },
      }[type]) as UiCommand;
      let writes = 0;
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
        if (init.method === 'POST' || init.method === 'PUT') {
          writes++;
          return Response.json(type === 'revoke' ? { id: grant.id, scope: grant.scope, epoch: 2, status: 'revoked' }
            : type === 'setWorkspaceDirectory' ? { id, version: 2, name: '项目', directory_resource_id: resource.id }
            : type === 'releaseExport' || type === 'restoreExport' ? { ...publication, version: 2, state: type === 'releaseExport' ? 'released' : 'restored' } : run);
        }
        throw new TypeError('refresh unavailable');
      });
      const store = createRuntimeStore(client());
      store.update(state => ({ ...mergeRunSnapshot(state, run), grants: { [grant.id]: grant }, publications: { [publication.id]: publication } }));
      const expected = { commandId: meta.command_id, status: 'confirmed', sync: 'pending' };
      expect(await store.dispatch(command)).toEqual(expected);
      expect(await store.retry(meta.command_id!)).toEqual(expected);
      expect(writes).toBe(1);
      if (type === 'revoke') expect(store.getSnapshot().scopes[grant.id].status).toBe('revoked');
      if (type === 'releaseExport') expect(store.getSnapshot().publications[publication.id].state).toBe('released');
      if (type === 'setWorkspaceDirectory') expect(store.getSnapshot().workspaces[id].version).toBe(2);
    });
  it('工作区快照与SSE共用投影，订阅退出后停止读取', async () => {
    const abort = new AbortController();
    const nextCursor = (BigInt(event.event_id) + 1n).toString();
    const wire = { kind: 'durable', event_id: nextCursor, event: { ...event, event_id: nextCursor, payload: { ...event.payload,
      runs: [{ ...run, version: 2, state: 'cancelled' }] } } };
    vi.stubGlobal('fetch', async (url: string) => url.endsWith(`/runs/${id}`) ? Response.json({ ...detail({ ...run, version: 2, state: 'cancelled' }), watermark: nextCursor }) : url.includes('/events?')
      ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`)); } }))
      : new Response(JSON.stringify({ workspace: { id, version: 1, name: '工作区', directory_resource_id: null }, sessions: page([]), active_runs: page([run]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id })));
    const store = createRuntimeStore(client());
    const seen: string[] = [];
    await store.loadWorkspace(id, { snapshot: () => { seen.push(store.getSnapshot().runs[id].state); },
      event: () => { seen.push(store.getSnapshot().runs[id].state); abort.abort(); } }, abort.signal);
    expect(seen).toEqual([run.state, 'cancelled']);
    expect(store.getSnapshot().cursor).toBe(nextCursor);
  });

  it('同command在途只提交一次，响应前不改终态，同响应合并不复制结果', async () => {
    let finish!: (value: Response) => void;
    let commands = 0;
    const response = new Promise<Response>(resolve => { finish = resolve; });
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
      if (init.method === 'POST') { commands++; return response; }
      return new Response(JSON.stringify(detail({ ...run, version: 2, state: 'cancelled' })));
    });
    const store = createRuntimeStore(client());
    store.update(state => mergeRunSnapshot(state, run));
    const command = { type: 'cancel' as const, args: [id, commandMeta(1)] as [string, ReturnType<typeof commandMeta>] };
    const first = store.dispatch(command);
    const second = store.dispatch(command);
    const pendingState = store.getSnapshot().runs[id].state;
    const inFlightCount = commands;
    finish(new Response(JSON.stringify({ ...run, version: 2, state: 'cancelled' })));
    await Promise.all([first, second]);
    expect(pendingState).toBe(run.state);
    expect(inFlightCount).toBe(1);
    expect(Object.values(store.getSnapshot().runs)).toHaveLength(1);
    expect(store.getSnapshot().runs[id].state).toBe('cancelled');
  });

  it('两个store同command只合并服务的同一运行身份，旧事件不能复活取消状态', async () => {
    const saved = { ...run, version: 2, state: 'cancelled' as const };
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => new Response(JSON.stringify(init.method === 'POST' ? saved : detail(saved))));
    const a = createRuntimeStore(client()), b = createRuntimeStore(client());
    const meta = commandMeta(1);
    await Promise.all([a.dispatch({ type: 'cancel', args: [id, meta] }), b.dispatch({ type: 'cancel', args: [id, meta] })]);
    for (const store of [a, b]) {
      store.update(state => mergeRunSnapshot(state, run));
      expect(Object.keys(store.getSnapshot().runs)).toEqual([id]);
      expect(store.getSnapshot().runs[id].state).toBe('cancelled');
    }
  });

  it('getSnapshot稳定到实际变化，退订后不再通知', () => {
    const store = createRuntimeStore(client());
    const initial = store.getSnapshot();
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    expect(store.getSnapshot()).toBe(initial);
    store.update(state => mergeRunSnapshot(state, run));
    expect(store.getSnapshot()).not.toBe(initial);
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.update(state => mergeRunSnapshot(state, { ...run, version: 2 }));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('图视图保留实际等待消费和join事实', () => {
    const store = createRuntimeStore(client());
    const value = detail();
    store.update(state => mergeRunDetail(state, { ...value,
      waits: page([{ id: 'wait', version: 1, run_id: id, owner_task_id: id, target_task_id: 'child', continuation_id: 'call', deadline_at: null, state: 'ready', result_version: 1 }]),
      consumptions: page([{ id: 'consume', run_id: id, task_id: id, execution_session_id: run.execution_session_id, target_task_id: 'child', result_version: 1, message_boundary: 4, inbox_entry_id: null }]),
      joins: page([{ id: 'join', run_id: id, root_task_id: id, child_task_id: 'child', child_result_version: 1, event_id: event.event_id }]) }));
    expect(Object.keys(store.getSnapshot().waits)).toEqual(['wait']);
    expect(Object.keys(store.getSnapshot().consumptions)).toEqual(['consume']);
    expect(Object.keys(store.getSnapshot().joins)).toEqual(['join']);
  });
});
