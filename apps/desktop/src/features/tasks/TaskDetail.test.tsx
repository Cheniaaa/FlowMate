import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { createRuntimeStore } from '../../state/runtime-store';
import { event, id, limits, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import type { ActivityView, ArtifactRef, MemberLane, RunDetail, SessionInboxEntry, StreamEvent } from '../../generated/contracts';
import type { StreamHandlers } from '../../api/client';
import { binding } from '../../test/fixtures';
import TaskDetail from './TaskDetail';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('独立任务详情负责预算、范围、原始Trace，写命令核对绑定真实归属不改当前会话', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  vi.spyOn(client, 'run').mockResolvedValue({ ...runDetailSummary, run: { ...run, kind: 'managed', workspace_id: secondId, interaction_session_id: secondId },
    tasks: page([]), activities: page([]), artifacts: page([]), messages: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
    budget: { id, run_id: id, version: 1, limits, steps: 1, model_requests: 1, task_count: 1, total_tokens: 0, reserved_tokens: 0, spent_units: '0', reserved_units: '0' }, watermark: '9007199254740993' });
  vi.spyOn(client, 'watchWorkspace').mockImplementation(async () => {});
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([]));
  const trace = vi.spyOn(client, 'trace').mockResolvedValue(page([]));
  const command = vi.fn().mockResolvedValue({ status: 'unconfirmed', sync: 'pending', commandId: id });
  render(<TaskDetail client={client} store={createRuntimeStore(client)} runId={id} onCommand={command} onQuestion={vi.fn()} onOpen={vi.fn()} />);
  await screen.findByLabelText('运行预算');
  await userEvent.click(screen.getByRole('button', { name: '原始 Trace' }));
  expect(trace).toHaveBeenCalledWith(id, { limit: 50 });
  await userEvent.click(screen.getByRole('button', { name: '停止该后台' }));
  expect(command).toHaveBeenCalledWith({ type: 'cancel', args: [id, expect.objectContaining({ expected_version: run.version })] }, { workspaceId: secondId, sessionId: secondId });
});

function barrier<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const delivered: SessionInboxEntry = { id: '00000000-0000-4000-8000-000000000010', version: 3, source_event_id: event.event_id, target_session_id: id,
  result: { run_id: id, task_id: secondId, lifetime: 'managed', submitted_state: 'completed' }, result_version: 1,
  delivery_state: 'delivered', viewed_at: null, dependencies: [], attempts: 1, last_error: null, source_valid: true, consumers: [] };
const detail: RunDetail = { ...runDetailSummary, run: { ...run, kind: 'managed', state: 'completed' },
  tasks: page([]), activities: page([]), artifacts: page([]), messages: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
  budget: { id, run_id: id, version: 1, limits, steps: 1, model_requests: 1, task_count: 1, total_tokens: 0, reserved_tokens: 0, spent_units: '0', reserved_units: '0' }, watermark: event.event_id };

it('任务列表选择具名脚本步骤，从固定输出路径预览其 artifact ID', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  const activityId = '00000000-0000-4000-8000-000000000015';
  const artifact: ArtifactRef = { id: '00000000-0000-4000-8000-000000000020', version: 1, task_id: secondId, activity_id: activityId,
    content_hash: 'b'.repeat(64), media_type: 'text/plain', dependencies: [] };
  const other = { ...artifact, id: '00000000-0000-4000-8000-000000000021' };
  const activity: ActivityView = { id: activityId, version: 1, run_id: id, task_id: secondId, kind: 'tool', operation: 'skills.run_script',
    state: 'succeeded', error: null, usage: null, actual_units: null, dependencies: [],
    script_execution: { skill_id: id, content_hash: 'a'.repeat(64), script_relative_path: 'scripts/weekly.py', environment_id: id,
      environment_revision: 1, attempt_id: id, exit_code: 0, termination_reason: 'exited', truncated: false,
      outputs: [{ relative_path: '检查清单.txt', artifact }, { relative_path: '简报.txt', artifact: other }], collection_error: null, external_costs: 'unknown' } };
  vi.spyOn(client, 'run').mockResolvedValue({ ...detail, activities: page([activity]), artifacts: page([other, artifact]),
    tasks: page([{ id: secondId, run_id: id, version: 1, binding, kind: 'agent', parent_task_id: null, origin_task_id: null,
      executor_id: 'builtin.agent', state: 'completed', created_seq: 1, deadline_at: null, result_version: 1, reason: null }]) });
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([]));
  vi.spyOn(client, 'watchWorkspace').mockImplementation(async () => {});
  const content = vi.spyOn(client, 'artifactContent').mockResolvedValue({ text: '所选检查清单', start: 0, end: 6, total_chars: 6, source_version: 'v1' });
  render(<TaskDetail client={client} store={createRuntimeStore(client)} runId={id} onCommand={vi.fn()} onQuestion={vi.fn()} onOpen={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: '任务列表' }));
  await userEvent.click(screen.getByRole('button', { name: /过程.*执行 Skill 脚本/ }));
  const step = screen.getByRole('region', { name: '所选步骤' });
  expect(within(step).getByText(/负责人.*FlowMate/)).toBeTruthy();
  expect(within(step).getByText('scripts/weekly.py')).toBeTruthy();
  expect(step.textContent).not.toContain(artifact.id);
  await userEvent.click(within(step).getByRole('button', { name: '检查清单.txt' }));
  expect((await screen.findByTitle('产物预览')).getAttribute('srcdoc')).toContain('所选检查清单');
  expect(content.mock.calls).toEqual([[artifact.id, 0, 'text']]);
  expect(within(screen.getByRole('region', { name: '产物详情' })).getByRole('heading', { name: '检查清单.txt' })).toBeTruthy();
});

it('真实view命令/SSE交叠保留同身份ResultInbox挂载，命令后正文可见且用户页签选择保留', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  const store = createRuntimeStore(client);
  const postStarted = barrier<void>(), postReply = barrier<void>(), refreshStarted = barrier<void>(), refreshReply = barrier<void>();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let reads = 0, resultCalls = 0;
  const artifact = { id: '00000000-0000-4000-8000-000000000020', version: 1, task_id: secondId, activity_id: id,
    content_hash: 'b'.repeat(64), media_type: 'text/plain', dependencies: [] };
  const position = (BigInt(event.event_id) + 1n).toString();
  const viewed = { ...delivered, version: 4, viewed_at: '2026-11-17T01:00:00Z' };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
    if (path === `/results/${delivered.id}/view`) { postStarted.resolve(); await postReply.promise; return Response.json(viewed); }
    if (path === `/sessions/${id}/results`) return Response.json({ ...page([reads > 1 ? viewed : delivered]), watermark: reads > 1 ? position : event.event_id });
    if (path === `/tasks/${secondId}/result`) { resultCalls++; return Response.json({ handle: viewed.result, result_version: 1, state: 'completed',
      result: { summary: '交叠后仍可见的交付正文' }, artifacts: [], dependencies: [], error: null }); }
    if (path === `/artifacts/${artifact.id}/content`) return Response.json({ text: '选中产物', start: 0, end: 4, total_chars: 4, source_version: 'v1' });
    if (path === `/runs/${id}`) {
      if (++reads > 1) { refreshStarted.resolve(); await refreshReply.promise; }
      return Response.json({ ...detail, artifacts: page([artifact]), watermark: reads > 1 ? position : event.event_id });
    }
    throw new Error(`未定义HTTP ${path}`);
  });
  render(<TaskDetail client={client} store={store} runId={id} onCommand={command => store.dispatch(command)} onQuestion={vi.fn()} onOpen={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: '查看文本产物 1' }));
  const artifactPreview = await screen.findByTitle('产物预览');
  await userEvent.click(await screen.findByRole('button', { name: '任务列表' }));
  const inbox = await screen.findByRole('region', { name: '结果收件箱' });
  await userEvent.click(await screen.findByRole('button', { name: '查看结果' }));
  await postStarted.promise;
  await act(async () => { stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'durable', event_id: position,
    event: { ...event, kind: 'delivery.changed', event_id: position, payload: { deliveries: [viewed] } } } satisfies StreamEvent)}\n\n`)); });
  await refreshStarted.promise;
  expect(inbox.isConnected).toBe(true);
  expect(screen.getByRole('button', { name: '任务列表' }).getAttribute('aria-pressed')).toBe('true');
  await act(async () => { refreshReply.resolve(); postReply.resolve(); });
  expect(await screen.findByText(/交叠后仍可见的交付正文/)).toBeTruthy();
  expect(screen.getByRole('region', { name: '结果收件箱' })).toBe(inbox);
  expect(screen.getByTitle('产物预览')).toBe(artifactPreview);
  expect(resultCalls).toBe(1);
});

it.each(['run', 'client'] as const)('%s身份切换在layout提交前隔离旧详情/选择，旧查询迟到不能重现', async change => {
  const first = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'one', protocol_version: 3 });
  const second = new RuntimeClient({ ...first.connection, token: 'two' });
  const nextReply = barrier<RunDetail>();
  const oldReply = barrier<RunDetail>();
  let initialReads = 0;
  vi.spyOn(first, 'run').mockImplementation(async runId => runId === id ? ++initialReads === 1 ? detail : oldReply.promise : nextReply.promise);
  vi.spyOn(second, 'run').mockReturnValue(nextReply.promise);
  for (const client of [first, second]) {
    vi.spyOn(client, 'watchWorkspace').mockImplementation(async () => {});
    vi.spyOn(client, 'sessionResults').mockResolvedValue(page([]));
  }
  const props = { client: first, store: createRuntimeStore(first), runId: id, onCommand: vi.fn(), onQuestion: vi.fn(), onOpen: vi.fn() };
  const { useLayoutEffect } = await import('react');
  const committed: string[] = [];
  function Host({ client, runId }: { client: RuntimeClient; runId: string }) {
    useLayoutEffect(() => { committed.push(document.body.textContent ?? ''); });
    return <TaskDetail {...props} client={client} runId={runId} />;
  }
  const view = render(<Host client={first} runId={id} />);
  await screen.findByLabelText('运行预算');
  await userEvent.click(screen.getByRole('button', { name: '任务列表' }));
  await userEvent.click(screen.getByRole('button', { name: '刷新详情' }));
  await waitFor(() => expect(initialReads).toBe(2));
  committed.length = 0;
  view.rerender(<Host client={change === 'client' ? second : first} runId={change === 'run' ? secondId : id} />);
  expect(committed[0]).not.toContain('共享预算组');
  expect(screen.queryByLabelText('运行预算')).toBeNull();
  await act(async () => { nextReply.resolve({ ...detail, run: { ...detail.run, id: change === 'run' ? secondId : id } }); });
  await screen.findByLabelText('运行预算');
  expect(screen.getByRole('button', { name: '任务图' }).getAttribute('aria-pressed')).toBe('true');
  await act(async () => { oldReply.resolve({ ...detail, run: { ...detail.run, reason: '迟到旧任务详情' } }); });
  expect(screen.queryByText('迟到旧任务详情')).toBeNull();
});

it.each(['scope.revoked', 'scope.deleted'] as const)('%s保持详情外壳但清除来源正文；迟到结果/产物响应和旧分页不重现', async kind => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  const store = createRuntimeStore(client);
  const resultStarted = barrier<void>(), resultReply = barrier<void>(), artifactStarted = barrier<void>(), artifactReply = barrier<void>();
  const refreshStarted = barrier<void>(), refreshReply = barrier<void>(), pageStarted = barrier<void>(), pageReply = barrier<void>();
  const artifact = { id: '00000000-0000-4000-8000-000000000020', version: 1, task_id: secondId, activity_id: id,
    content_hash: 'a'.repeat(64), media_type: 'text/plain', dependencies: [] };
  let reads = 0;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const position = (BigInt(event.event_id) + 1n).toString();
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
    if (path === `/sessions/${id}/results`) return Response.json(page([delivered]));
    if (path === `/tasks/${secondId}/result`) {
      resultStarted.resolve(); await resultReply.promise;
      return Response.json({ handle: delivered.result, result_version: 1, state: 'completed', result: { summary: '迟到结果正文' }, artifacts: [], dependencies: [], error: null });
    }
    if (path === `/artifacts/${artifact.id}/content`) {
      artifactStarted.resolve(); await artifactReply.promise;
      return Response.json({ text: '迟到产物正文', start: 0, end: 6, total_chars: 6, source_version: 'v1' });
    }
    if (path === `/runs/${id}/artifacts`) {
      pageStarted.resolve(); await pageReply.promise; return Response.json(page([artifact]));
    }
    if (path === `/runs/${id}`) {
      if (++reads > 1) { refreshStarted.resolve(); await refreshReply.promise; }
      return Response.json(reads === 1 ? { ...detail, artifacts: { ...page([artifact]), next_cursor: 'old-artifact-tail' } } : { ...detail, watermark: position });
    }
    throw new Error(`未定义HTTP ${path}`);
  });
  render(<TaskDetail client={client} store={store} runId={id} onCommand={async () => ({ status: 'confirmed', sync: 'ready', commandId: id })} onQuestion={vi.fn()} onOpen={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: '查看文本产物 1' }));
  await artifactStarted.promise;
  await userEvent.click(await screen.findByRole('button', { name: '查看结果' }));
  await resultStarted.promise;
  await userEvent.click(screen.getByRole('button', { name: '更多 artifacts' }));
  await pageStarted.promise;
  const scope = { kind: 'session' as const, workspace_id: id, session_id: id };
  const status = kind === 'scope.deleted' ? 'deleted' : 'revoked';
  const wire: StreamEvent = { kind: 'durable', event_id: position, event: { ...event, kind, event_id: position,
    payload: { scopes: [{ id, scope, epoch: 2, status }], deletions: status === 'deleted' ? [{ scope, epoch: 2, status }] : [] } } };
  await act(async () => { stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`)); });
  expect(screen.queryByTitle('产物预览')).toBeNull();
  // 详情刷新与续页已串行；来源围栏须先屏蔽旧正文，再放行在途尾页。
  await act(async () => { resultReply.resolve(); artifactReply.resolve(); pageReply.resolve(); });
  await refreshStarted.promise;
  await act(async () => { refreshReply.resolve(); });
  await waitFor(() => expect(screen.queryByRole('button', { name: '更多 artifacts' })).toBeNull());
  expect(screen.queryByText(/迟到结果正文/)).toBeNull();
  expect(screen.queryByTitle('产物预览')).toBeNull();
  expect(screen.queryByRole('button', { name: '查看文本产物 1' })).toBeNull();
  expect(screen.getByRole('heading', { name: '任务详情' })).toBeTruthy();
});

it.each(['shared', 'detail'] as const)('双真实SSE订阅%s先处理；同delivery迟到重放不清预览，新同version消费/来源事实仍生效', async first => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  const store = createRuntimeStore(client), sharedAbort = new AbortController();
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const sharedHandled = barrier<void>(), postStarted = barrier<void>(), postReply = barrier<void>();
  const runQuery = vi.spyOn(client, 'run');
  let entry = delivered, watermark = event.event_id, resultCalls = 0, viewCalls = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller); } }));
    if (path === `/workspaces/${id}/snapshot`) return Response.json({
      workspace: { id, version: 1, name: '双订阅项目', directory_resource_id: null },
      sessions: page([{ id, version: 1, workspace_id: id, title: '当前对话', agent_profile_id: id, kind: 'interaction', archived: false }]),
      active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark,
    });
    if (path === `/results/${entry.id}/view` && init.method === 'POST') {
      viewCalls++;
      entry = { ...entry, version: entry.version + 1, viewed_at: '2026-11-17T01:00:00Z' };
      if (viewCalls === 1) { postStarted.resolve(); await postReply.promise; }
      return Response.json(entry);
    }
    if (path === `/sessions/${id}/results`) return Response.json({ ...page([entry]), watermark });
    if (path === `/runs/${id}`) return Response.json({ ...detail, watermark });
    if (path === `/tasks/${secondId}/result`) {
      resultCalls++;
      return Response.json({ handle: entry.result, result_version: 1, state: 'completed',
        result: { summary: '双订阅后仍可见正文' }, artifacts: [], dependencies: [], error: null });
    }
    throw new Error(`未定义HTTP ${path}`);
  });
  const loading = store.loadWorkspace(id, { snapshot: () => {}, event: () => { sharedHandled.resolve(); } }, sharedAbort.signal);
  await waitFor(() => expect(controllers).toHaveLength(1));
  const view = render(<TaskDetail client={client} store={store} runId={id} onCommand={command => store.dispatch(command)} onQuestion={vi.fn()} onOpen={vi.fn()} />);
  try {
    await userEvent.click(await screen.findByRole('button', { name: '查看结果' }));
    await postStarted.promise;
    await waitFor(() => expect(controllers).toHaveLength(2));
    const inbox = screen.getByRole('region', { name: '结果收件箱' });
    watermark = (BigInt(event.event_id) + 1n).toString();
    // 同一真实查看事实分别由两路已解析SSE到达；命令响应仍暂停。
    entry = { ...entry, version: 4, viewed_at: '2026-11-17T01:00:00Z' };
    const wire: StreamEvent = { kind: 'durable', event_id: watermark, event: { ...event, kind: 'delivery.changed', event_id: watermark, payload: { deliveries: [entry] } } };
    const send = (stream: number, value: StreamEvent) => controllers[stream].enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
    await act(async () => { send(first === 'shared' ? 0 : 1, wire); });
    if (first === 'shared') await sharedHandled.promise;
    else {
      await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(2));
      await act(async () => { await runQuery.mock.results[1].value; });
    }
    await act(async () => { postReply.resolve(); });
    await screen.findByText(/双订阅后仍可见正文/);
    const beforeReplay = store.getSnapshot();
    const reads = runQuery.mock.calls.length;
    await act(async () => { send(first === 'shared' ? 1 : 0, wire); });
    if (first === 'detail') await sharedHandled.promise;
    else {
      await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(reads + 1));
      await act(async () => { await runQuery.mock.results[reads].value; });
    }
    expect(screen.getByRole('region', { name: '结果收件箱' })).toBe(inbox);
    expect(store.getSnapshot().cursor).toBe(beforeReplay.cursor);
    expect(screen.queryByText(/双订阅后仍可见正文/)).not.toBeNull();
    expect(resultCalls).toBe(1);

    const consumption = { id: secondId, run_id: id, task_id: id, execution_session_id: id, target_task_id: secondId, result_version: 1, message_boundary: 2, inbox_entry_id: entry.id };
    const version = entry.version;
    entry = { ...entry, consumers: [consumption] };
    watermark = (BigInt(watermark) + 1n).toString();
    await act(async () => { send(0, { kind: 'durable', event_id: watermark, event: { ...event, kind: 'delivery.changed', event_id: watermark, payload: { deliveries: [entry] } } }); });
    await screen.findByText(/模型消费记录 1/);
    expect(store.getSnapshot().deliveries[entry.id].version).toBe(version);
    // 消费记录变化没有撤销正文来源，保留正在阅读的内容。
    expect(screen.queryByText(/双订阅后仍可见正文/)).not.toBeNull();
    const viewedVersion = entry.version;
    entry = { ...entry, source_valid: false };
    watermark = (BigInt(watermark) + 1n).toString();
    await act(async () => { send(1, { kind: 'durable', event_id: watermark, event: { ...event, kind: 'delivery.changed', event_id: watermark, payload: { deliveries: [entry] } } }); });
    await screen.findByText('来源已失效，正文不可用');
    expect(store.getSnapshot().deliveries[entry.id].version).toBe(viewedVersion);
    expect(screen.queryByText(/双订阅后仍可见正文/)).toBeNull();
    expect(viewCalls).toBe(1);
  } finally {
    view.unmount();
    sharedAbort.abort();
    await loading;
  }
});

it('任务详情泳道查询随真实成员事件刷新，固定两成员/工具归属/部分结果；来源失效隔离迟到正文', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  const store = createRuntimeStore(client);
  let handlers!: StreamHandlers;
  const child: MemberLane = { profile: { ...binding.config.agent_profile, display_name: '研究成员' }, handoffs: [], activities: [],
    task: { id: secondId, version: 1, run_id: id, kind: 'agent', executor_id: 'builtin.agent', parent_task_id: id, origin_task_id: id, created_seq: 2, state: 'waiting_user',
      result_version: null, reason: 'context_authorization_required', deadline_at: null, binding: { ...binding, agent_work: { kind: 'agent', profile_id: id, goal: '研究', input_refs: [], output_schema: {}, success_criteria: ['有依据'] } } } };
  const root: MemberLane = { ...child, profile: { ...child.profile, display_name: '实际根成员' }, task: { ...child.task, id, parent_task_id: null, created_seq: 1, binding, reason: null, state: 'running' } };
  let lanes = [root, child];
  const requests: string[] = [];
  let bodyReply!: (value: Response) => void;
  vi.spyOn(client, 'watchWorkspace').mockImplementation(async (_id, _after, value) => { handlers = value; });
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', ''); requests.push(path);
    if (path.endsWith('/member-lanes')) return Response.json(lanes);
    if (path.endsWith('/results')) return Response.json(page([]));
    if (path.endsWith('/result')) return new Promise<Response>(resolve => { bodyReply = resolve; });
    return Response.json(detail);
  });
  render(<TaskDetail client={client} store={store} runId={id} onCommand={command => store.dispatch(command)} onQuestion={vi.fn()} onOpen={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: '成员泳道' }));
  await screen.findByText('研究成员');
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.getByText('需要核对资料及发送授权。')).toBeTruthy();
  lanes = [root, { ...child, task: { ...child.task, version: 2, state: 'completed', result_version: 1, reason: null } }];
  const position = (BigInt(event.event_id) + 1n).toString();
  await act(async () => { await handlers.event({ kind: 'durable', event_id: position, event: { ...event, kind: 'task.stepped', event_id: position,
    payload: { tasks: [lanes[1].task], runs: [], activities: [], artifacts: [], messages: [], questions: [], budgets: [], waits: [], consumptions: [], joins: [], pending_commands: [], follow_up_intents: [] } } }); });
  await waitFor(() => expect(screen.queryByText('需要核对资料及发送授权。')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: '查看研究成员的任务' }));
  await waitFor(() => expect(bodyReply).toBeTypeOf('function'));
  const sourcePosition = (BigInt(position) + 1n).toString();
  await act(async () => { await handlers.event({ kind: 'durable', event_id: sourcePosition, event: { ...event, kind: 'scope.revoked', event_id: sourcePosition,
    payload: { scopes: [{ id, epoch: 2, status: 'revoked', scope: { kind: 'session', workspace_id: id, session_id: id } }], deletions: [] } } }); });
  await act(async () => { bodyReply(Response.json({ handle: { task_id: secondId, run_id: id, lifetime: 'run_bound', submitted_state: 'completed' }, result_version: 1, state: 'completed', error: null, artifacts: [], dependencies: [],
    result: { status: 'partial', summary: '不应复现的迟到成员正文', structured_result: {}, unresolved: ['仍有缺口'], artifact_ids: [], evidence_refs: [], verification: [], handled_failures: [] } })); });
  expect(screen.queryByText('不应复现的迟到成员正文')).toBeNull();
  expect(requests.filter(path => path.endsWith('/member-lanes')).length).toBeGreaterThan(1);
  expect(requests.some(path => path.includes('/messages'))).toBe(false);
});
