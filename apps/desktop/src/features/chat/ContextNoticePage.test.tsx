import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { ContextUsageSummary, MemberLane, ModelMessage, PublicEvent, RunDetail, SessionContextSchema } from '../../generated/contracts';
import { agent, binding, connection, contextUsage, event, grant, id, limits, model, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import { Conversation } from './Conversation';
import { invoke } from '@tauri-apps/api/core';
import { evidence, evidenceId, source } from '../knowledge/knowledge-fixtures';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function contextResponse(usage: ContextUsageSummary, runId = id) {
  return { round: { run_id: runId, state: 'completed', source_attention: false },
    files: [], hidden_file_count: 0, history: usage, latest_request: null, activities: page([]), units_per_currency: '1000000',
    knowledge: [], hidden_knowledge_count: 0 };
}

const sessionUsage = {
  requests: 0, input_tokens: 0, output_tokens: 0, input_reported_requests: 0, output_reported_requests: 0,
  cached_input_tokens: 0, cache_reported_requests: 0, cache_reported_input_tokens: 0,
  cached_tokens_with_reported_input: 0, calculated_units: '0', unknown_cost_requests: 0, pending_cost_requests: 0,
  units_per_currency: '1000000',
  embedding_requests: 0, embedding_input_tokens: 0, embedding_input_reported_requests: 0,
  embedding_calculated_units: '0', embedding_unknown_cost_requests: 0, embedding_pending_cost_requests: 0,
};

const contextFile = (name: string): SessionContextSchema.ContextFile => ({
  name, origin: 'attached', changed: false, size_bytes: null, line_count: null, start: null, end: null, total_chars: null,
});

it.each([520, 1000])('%s宽上下文资料打开受控原文，关闭返回同一资料按钮并保留草稿', async width => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: width >= Number(query.match(/min-width: (\d+)/)?.[1] ?? 0),
    media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => true }));
  server(contextUsage, 'completed');
  const base = fetch, reads: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname; reads.push(path);
    if (path.endsWith('/context')) return Response.json({ ...contextResponse(contextUsage),
      knowledge: [{ evidence_id: evidenceId, name: source.label, start_line: 18, end_line: 20, historical: true }] });
    if (path.includes('/knowledge/evidence/')) return Response.json(evidence);
    if (path.endsWith('/knowledge/sources')) return Response.json(page([{ ...source,
      latest_job: null, origin_hint: null, added_at: null }]));
    return base(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
  await screen.findByRole('heading', { name: '原上下文目标' });
  await user.type(screen.getByRole('textbox', { name: '消息' }), '阅读资料时保留的草稿');
  await user.click(screen.getByRole('button', { name: '上下文' }));
  const trigger = await screen.findByRole('button', { name: '打开 项目说明.md' });
  expect(reads.filter(path => path.includes('/knowledge/evidence/'))).toHaveLength(0);
  await user.click(trigger);
  const reader = await screen.findByRole('region', { name: '引用原文' });
  await within(reader).findByRole('heading', { name: source.label });
  expect(screen.getAllByRole('button', { name: /^关闭(?:原文|详情)$/ })).toHaveLength(1);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.getByRole('region', { name: '上下文详情' })).toBeTruthy();
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('阅读资料时保留的草稿');
});

it.each([520, 1000])('%s宽任务中心成员原文关闭后保留泳道选中与原引用焦点', async width => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: width >= Number(query.match(/min-width: (\d+)/)?.[1] ?? 0),
    media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => true }));
  server(contextUsage, 'completed');
  const base = fetch;
  let resultReads = 0;
  const lane: MemberLane = { profile: { ...agent, display_name: '资料成员' }, activities: [], handoffs: [],
    task: { id: secondId, version: 2, run_id: id, kind: 'agent', executor_id: 'builtin.agent', parent_task_id: id,
      origin_task_id: id, created_seq: 2, state: 'completed', result_version: 1, reason: null, deadline_at: null,
      binding: { ...binding, agent_work: { kind: 'agent', profile_id: id, goal: '查证', input_refs: [], output_schema: {}, success_criteria: [] } } } };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith(`/tasks/${secondId}`)) return Response.json(lane.task);
    if (path.endsWith('/member-lanes')) return Response.json([lane]);
    if (path.endsWith(`/tasks/${secondId}/result`)) {
      resultReads++;
      return Response.json({ handle: { task_id: secondId, run_id: id, lifetime: 'run_bound', submitted_state: 'completed' },
        result_version: 1, state: 'completed', artifacts: [], dependencies: [], error: null,
        result: { status: 'completed', summary: '真实成员引用[1]。', artifact_ids: [], unresolved: [], handled_failures: [],
          citations: [{ marker: 1, evidence_id: evidenceId }], evidence_refs: [], verification: [], structured_result: null } });
    }
    if (path.includes('/knowledge/evidence/')) return Response.json(evidence);
    if (path.endsWith('/knowledge/sources')) return Response.json(page([{ ...source, latest_job: null, origin_hint: null, added_at: null }]));
    return base(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })}
    navigation={{ target: { kind: 'task', task_id: secondId }, sequence: 1 }} />);
  await user.click(await screen.findByRole('button', { name: '成员泳道' }));
  await user.click(await screen.findByRole('button', { name: '查看资料成员的任务' }));
  const citation = await screen.findByRole('button', { name: '查看引用 1' });
  await user.click(citation);
  const reader = await screen.findByRole('region', { name: '引用原文' });
  await within(reader).findByRole('heading', { name: source.label });
  await user.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toBe(citation));
  expect(screen.getByRole('button', { name: '成员泳道' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('region', { name: '成员结果预览' })).toBeTruthy();
  expect(resultReads).toBe(1);
});

it('本项目知识通知重新投影上下文摘要，刷新完成前即遮去旧名称', async () => {
  server(contextUsage, 'completed');
  const base = fetch;
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let contextReads = 0, reply!: (value: Response) => void;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(stream) { streams.push(stream); } }));
    if (path.endsWith('/context')) {
      if (++contextReads === 1) return Response.json({ ...contextResponse(contextUsage),
        knowledge: [{ evidence_id: evidenceId, name: source.label, start_line: 18, end_line: 20, historical: false }] });
      return new Promise<Response>(resolve => { reply = resolve; });
    }
    return base(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
  await screen.findByRole('heading', { name: '原上下文目标' });
  await user.click(screen.getByRole('button', { name: '上下文' }));
  await screen.findByText(source.label);
  async function notify(workspace_id: string, step: number) {
    const event_id = String(BigInt(event.event_id) + BigInt(step));
    const fact: PublicEvent = { ...event, kind: 'knowledge.changed', workspace_id, session_id: null, run_id: null, seq: null,
      event_id, payload: { workspace_id, source_revisions: { [source.id]: step }, job_revisions: {},
        settings_revision: null, profile_revisions: {} } };
    await act(async () => { for (const stream of streams) stream.enqueue(new TextEncoder().encode(
      `data: ${JSON.stringify({ kind: 'durable', event_id, event: fact })}\n\n`)); });
  }
  await notify(id, 1);
  expect(screen.queryByText(source.label)).toBeNull();
  await waitFor(() => expect(contextReads).toBe(2));
  await act(async () => reply(Response.json({ ...contextResponse(contextUsage), hidden_knowledge_count: 1 })));
  await screen.findByText('1 项资料已不可用。');
  expect(screen.queryByText(source.label)).toBeNull();
});

it('无需先打开上下文，整轮正式引用共用一次已有摘要查询，不预取正文', async () => {
  server(contextUsage, 'completed');
  const base = fetch, reads: string[] = [];
  const completed = { ...run, state: 'completed', output: { summary: '两个依据[1]和[2]。',
    citations: [{ marker: 1, evidence_id: evidenceId }, { marker: 2, evidence_id: evidenceId }],
    artifact_ids: [], unresolved: [], handled_failures: [] } };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname; reads.push(path);
    if (path.endsWith(`/sessions/${id}/runs`)) return Response.json(page([completed]));
    if (path.endsWith(`/workspaces/${id}/snapshot`)) {
      const snapshot = await (await base(url, init)).json();
      return Response.json({ ...snapshot, active_runs: page([completed]) });
    }
    if (path.endsWith('/context')) return Response.json({ ...contextResponse(contextUsage),
      knowledge: [{ evidence_id: evidenceId, name: source.label, start_line: 18, end_line: 20, historical: true }] });
    return base(url, init);
  });
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
  await screen.findByRole('button', { name: '查看引用 1 · 项目说明.md · 18–20 行 · 历史原文' });
  expect(screen.getByRole('button', { name: '查看引用 2 · 项目说明.md · 18–20 行 · 历史原文' })).toBeTruthy();
  expect(reads.filter(path => path.endsWith('/context'))).toHaveLength(1);
  expect(reads.filter(path => path.includes('/knowledge/evidence/') || path.endsWith('/knowledge/sources'))).toHaveLength(0);
  expect(screen.queryByRole('region', { name: '上下文详情' })).toBeNull();
});

async function deliver(stream: ReadableStreamDefaultController<Uint8Array>, fact: PublicEvent) {
  await act(async () => {
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'durable', event_id: fact.event_id, event: fact })}\n\n`));
  });
}

function server(usage: ContextUsageSummary, runState?: 'completed') {
  const reads: string[] = [];
  const state = runState ?? (usage.compaction_state === 'blocked' ? 'waiting_user' as const : 'running' as const);
  const currentRun = { ...run, state, reason: usage.compaction_reason };
  const root = { id: run.root_task_id, version: 1, run_id: id, kind: 'agent' as const, executor_id: 'builtin.agent',
    parent_task_id: null, origin_task_id: null, created_seq: 1, deadline_at: null, result_version: null, reason: usage.compaction_reason,
    state, binding: { agent_work: null, input_artifacts: [], input_result: null, additional_result_inputs: [], file_inputs: {}, config: run.config,
      sources: run.sources, execution_session_id: id, interaction_session_id: id, delegation_depth: 0 } };
  const detail: RunDetail = { ...runDetailSummary, run: currentRun, context_usage: usage, tasks: page([root]), activities: page([]), messages: page([]),
    artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
    budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', steps: 0, model_requests: 0,
      task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id };
  const workspace = { id, version: 1, name: '上下文项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '原上下文目标', agent_profile_id: id, kind: 'interaction', archived: false };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v4', ''); reads.push(path);
    if (init.method && init.method !== 'GET') throw new Error('查看状态不应重交、恢复或授权');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/context')) return Response.json(contextResponse(usage));
    if (path.endsWith('/context/usage')) return Response.json(sessionUsage);
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/messages') || path.endsWith('/results')) return Response.json(page([]));
    if (path.endsWith('/export-recovery')) return Response.json([]);
    if (path === `/runs/${id}`) return Response.json(detail);
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]), '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      '/tasks': page([]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([currentRun]), pending_questions: page([]), pending_approvals: page([]),
        resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/runs`]: page([currentRun]),
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
    };
    if (!(path in values)) throw new Error(`未定义 ${path}`);
    return Response.json(values[path]);
  });
  return reads;
}

it.each([
  ['running', '正在压缩上下文', null],
  ['committed', '已采用上下文摘要', null],
  ['blocked', '上下文压缩受阻', 'context_limit'],
  ['invalidated', '上下文压缩已失效', 'source_changed'],
] as const)('真实RunDetail的%s经RuntimeClient/Store到页面，父级不屏蔽零省略', async (compaction_state, title, compaction_reason) => {
  const reads = server({ ...contextUsage, activity_id: compaction_state === 'running' ? secondId : null,
    state: compaction_state === 'running' ? 'prepared' : null, compaction_state, compaction_reason,
    summary_count: compaction_state === 'committed' ? 1 : 0, compacted_message_count: compaction_state === 'committed' ? 20 : 0 });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
  await screen.findByRole('heading', { name: '原上下文目标' });
  await user.click(await screen.findByRole('button', { name: '上下文' }));
  const notice = await screen.findByRole('complementary', { name: '历史使用说明' });
  expect(notice.closest('.conversation-detail-sheet, .conversation-details')).toBeTruthy();
  expect(within(notice).getByText(title)).toBeTruthy();
  expect(reads).toContain(`/runs/${id}`);
  expect(document.querySelectorAll('.context-notice')).toHaveLength(1);
  expect(screen.queryByRole('alert')).toBeNull();
  if (compaction_state === 'blocked') {
    await user.click(within(notice).getByText(title));
    await user.click(within(notice).getByRole('button', { name: '查看原运行与待办' }));
    const detail = within(await screen.findByRole('region', { name: '任务详情' }));
    expect(detail.getByText(/负责人 FlowMate/)).toBeTruthy();
    expect(detail.queryByText(id)).toBeNull();
  }
});

it('小窗同样显示零省略/无Activity阻塞，既有Task导航使用RunDetail真实根任务，原输入保留', async () => {
  server({ ...contextUsage, compaction_state: 'blocked', compaction_reason: 'context_authorization_required' });
  const user = userEvent.setup();
  render(<Conversation compact client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
  const notice = await screen.findByRole('complementary', { name: '历史使用说明' });
  const input = screen.getByLabelText('消息'); await user.type(input, '保留的原对话输入');
  await user.click(within(notice).getByText('上下文压缩受阻'));
  expect(within(notice).getByText('需要核对原资料范围、来源有效性及模型目的地授权。')).toBeTruthy();
  await user.click(within(notice).getByRole('button', { name: '查看原运行与待办' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('show_workbench', { target: { kind: 'task', task_id: run.root_task_id } }));
  expect((input as HTMLTextAreaElement).value).toBe('保留的原对话输入');
});

it.each([false, true])('重开和分页保留历史消息，面板只展示当前轮详情，首批含两轮=%s', async paged => {
  const earlier = { ...run, id: secondId, state: 'completed' as const };
  const latest = { ...run, state: 'completed' as const };
  const summary = { ...contextUsage, activity_id: secondId, state: 'succeeded' as const,
    omitted_group_count: 1, omitted_message_count: 4, reason_counts: { outside_run_scope: 4 } };
  const messages = [earlier, latest].flatMap((value, index) => (['user', 'assistant'] as const).map((role, offset): ModelMessage => ({
    id: `00000000-0000-4000-8000-00000000001${index * 2 + offset}`, run_id: value.id, role, origin: 'conversation',
    parts: [{ kind: 'text', text: `轮次${index + 1} ${role}` }], activity_id: null, private_ref: null, source_dependencies: [],
    event_id: String(10 + index * 2 + offset), event_index: 0,
  })));
  const reads = server(contextUsage);
  const base = fetch;
  const batches: string[][] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v4', '');
    if (path.endsWith('/context')) return Response.json(contextResponse(summary));
    if (path.endsWith('/messages')) return Response.json(parsed.searchParams.has('cursor') ? page(messages.slice(0, 2))
      : paged ? { ...page(messages.slice(2)), next_cursor: 'older' } : page(messages));
    if (path.endsWith('/runs')) return Response.json(paged ? { ...page([latest]), next_cursor: 'other-runs' } : page([earlier, latest]));
    if (path.endsWith('/run-feedback')) {
      const ids = parsed.searchParams.getAll('run_id'); batches.push(ids);
      return Response.json(page(ids.map(run_id => ({ run_id, version: run.version, workspace_id: id, session_id: id,
        root_task_id: run.root_task_id, connection_id: connection.id, state: 'completed', reason: null, model_activity: null,
        context_usage: run_id === earlier.id ? summary : null }))));
    }
    return base(url, init);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
  const view = render(<Conversation client={client} />);
  async function verifyHistory() {
    const thread = within(await screen.findByRole('region', { name: '持久对话' }));
    await thread.findByText('轮次2 assistant');
    if (paged) {
      expect(thread.queryByText('轮次1 user')).toBeNull();
      fireEvent.click(thread.getByRole('button', { name: '更多历史' }));
    }
    expect(await thread.findByText('轮次1 assistant')).toBeTruthy();
    expect(thread.getByText('轮次1 user')).toBeTruthy();
    expect(thread.getByText('轮次2 user')).toBeTruthy();
    expect(thread.queryByText('4 条历史消息不在本轮资料范围')).toBeNull();
    const user = userEvent.setup();
    const reply = within(thread.getAllByRole('article', { name: /的回复/ })[0]);
    expect(reply.queryByRole('button', { name: '回复更多操作' })).toBeNull();
    const entry = screen.getByRole('button', { name: '上下文' });
    await user.click(entry);
    const notice = await screen.findByText('4 条历史消息不在本轮资料范围');
    expect(notice.closest('details')?.open).toBe(false);
    expect(screen.queryByRole('group', { name: '选择轮次' })).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(entry));
  }
  await verifyHistory();
  view.unmount();
  render(<Conversation client={client} />);
  await verifyHistory();
  expect(batches.some(batch => batch.includes(earlier.id))).toBe(true);
  expect(reads).not.toContain(`/runs/${earlier.id}`);
});

it('撤权刷新同版本历史说明，立即遮去答复和正式输出，冷重开后仍保护正文', async () => {
  const committed: ContextUsageSummary = { ...contextUsage, compaction_state: 'committed', summary_count: 1, compacted_message_count: 8 };
  const invalidated: ContextUsageSummary = { ...contextUsage, compaction_state: 'invalidated', compaction_reason: 'source_changed' };
  const dependencies = [{ scope_id: grant.id, epoch: grant.epoch }];
  const prompt = '仍可查看的原始问题';
  const original = '受保护的历史答复';
  const output = '受保护的正式输出';
  const earlier = { ...run, id: secondId, state: 'completed' as const, scope_dependencies: dependencies,
    output: { summary: output, artifact_ids: [], unresolved: [], handled_failures: [] } };
  const latest = { ...run, state: 'completed' as const };
  const message: ModelMessage = { id: '00000000-0000-4000-8000-000000000040', run_id: earlier.id, origin: 'conversation',
    role: 'assistant', parts: [{ kind: 'text', text: original }], source_dependencies: dependencies, source_valid: true,
    event_id: '10', event_index: 0, activity_id: null, private_ref: null };
  const question: ModelMessage = { id: '00000000-0000-4000-8000-000000000041', run_id: earlier.id, origin: 'conversation',
    role: 'user', parts: [{ kind: 'text', text: prompt }], source_dependencies: [],
    event_id: '9', event_index: 0, activity_id: null, private_ref: null };
  const reads = server(contextUsage);
  const base = fetch;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let mark = event.event_id;
  const revoked = { ...grant, status: 'revoked' as const, version: 2, epoch: 2 };
  let releaseFeedback!: () => void;
  const feedbackReady = new Promise<void>(resolve => { releaseFeedback = resolve; });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/v4', '');
    const isRevoked = mark !== event.event_id;
    if (path.endsWith('/context')) {
      if (isRevoked) await feedbackReady;
      const current = contextResponse(isRevoked ? invalidated : committed, earlier.id);
      return Response.json({ ...current, files: isRevoked ? [] : [{ name: '受保护的文件名', changed: false, origin: 'attached',
        size_bytes: null, line_count: null, start: null, end: null, total_chars: null }],
        activities: { ...current.activities, watermark: mark } });
    }
    if (path.endsWith('/events')) return new Response(new ReadableStream({ start(value) { stream = value; } }));
    // 消息保留原发布位置，查询页水位和授权状态取当前快照。
    if (path.endsWith('/messages')) return Response.json({ ...page([
      question, isRevoked ? { ...message, source_valid: false, parts: [] } : message,
    ]), watermark: mark });
    if (path.endsWith('/runs')) return Response.json({
      ...page([isRevoked ? { ...earlier, output: null } : earlier, latest]), watermark: mark,
    });
    if (path.endsWith('/run-feedback')) {
      if (isRevoked) await feedbackReady;
      return Response.json({ ...page([{ run_id: earlier.id, version: earlier.version,
        workspace_id: id, session_id: id, root_task_id: earlier.root_task_id, connection_id: connection.id, state: earlier.state,
        reason: null, model_activity: null, context_usage: isRevoked ? invalidated : committed }]), watermark: mark });
    }
    if (path.endsWith('/snapshot')) return Response.json({ ...await (await base(url, init)).json(), active_runs: page([]),
      grants: page([isRevoked ? revoked : grant]), watermark: mark });
    return base(url, init);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
  const view = render(<Conversation client={client} />);
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: '原上下文目标' });
  expect(screen.getByText(prompt)).toBeTruthy();
  expect(screen.getByText(original)).toBeTruthy();
  expect(screen.getByText(output)).toBeTruthy();
  await user.click(await screen.findByRole('button', { name: '上下文' }));
  expect(await screen.findByText('已采用上下文摘要')).toBeTruthy();
  expect(screen.getByText('受保护的文件名')).toBeTruthy();
  mark = (BigInt(event.event_id) + 1n).toString();
  await act(async () => {
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'durable', event_id: mark,
      event: { ...event, kind: 'grant.revoked', event_id: mark, seq: null, run_id: null, session_id: null,
        payload: { resources: [], grants: [revoked], approvals: [] } },
    })}\n\n`));
  });
  expect(screen.queryByText('已采用上下文摘要')).toBeNull();
  expect(screen.queryByText('受保护的文件名')).toBeNull();
  expect(screen.getByText('历史消息 · 来源已失效')).toBeTruthy();
  expect(screen.getByText(prompt)).toBeTruthy();
  expect(screen.queryByText(original)).toBeNull();
  expect(screen.queryByRole('article', { name: '正式答复' })).toBeNull();
  releaseFeedback();
  expect(await screen.findByText('上下文压缩已失效')).toBeTruthy();
  view.unmount();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: '原上下文目标' });
  await user.click(await screen.findByRole('button', { name: '上下文' }));
  expect(await screen.findByText('上下文压缩已失效')).toBeTruthy();
  expect(screen.getByText('历史消息 · 来源已失效')).toBeTruthy();
  expect(screen.getByText(prompt)).toBeTruthy();
  expect(screen.queryByText(original)).toBeNull();
  expect(screen.queryByText(output)).toBeNull();
  expect(reads).not.toContain(`/runs/${earlier.id}`);
});

it('新回复到达时自动跟随当前轮', async () => {
  server(contextUsage);
  const base = fetch;
  const newId = '00000000-0000-4000-8000-000000000061';
  const newEventId = (BigInt(event.event_id) + 1n).toString();
  const newest = { ...run, id: newId, state: 'completed' as const };
  const reply: ModelMessage = {
    id: '00000000-0000-4000-8000-000000000062', run_id: newId, origin: 'conversation', role: 'assistant',
    parts: [{ kind: 'text', text: '新回复已到达' }], source_dependencies: [], private_ref: null, activity_id: null,
    event_id: newEventId, event_index: 0,
  };
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let arrived = false;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const request = new URL(url);
    if (request.pathname.endsWith('/events')) return new Response(new ReadableStream({ start(value) { stream = value; } }));
    if (!request.pathname.endsWith('/context')) return base(url, init);
    const selected = arrived ? newId : id;
    const data = contextResponse(contextUsage, selected);
    return Response.json({ ...data, files: [contextFile(arrived ? '当前轮新文件' : '前一轮文件')],
      activities: { ...data.activities, watermark: arrived ? newEventId : event.event_id } });
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
  await screen.findByRole('heading', { name: '原上下文目标' });
  await user.click(screen.getByRole('button', { name: '上下文' }));
  await screen.findByText('前一轮文件');
  arrived = true;
  await deliver(stream, { ...event, event_id: newEventId, run_id: newId,
    payload: { ...event.payload, runs: [newest], messages: [reply] } });
  expect(await screen.findByText('当前轮新文件')).toBeTruthy();
  expect(screen.getByText('新回复已到达')).toBeTruthy();
  expect(screen.queryByText('前一轮文件')).toBeNull();
  expect(screen.queryByRole('button', { name: '跟随最新' })).toBeNull();
});

it('分页期间新回复和撤权一同到达，迟到的旧分页无法恢复文件名', async () => {
  server(contextUsage);
  const base = fetch;
  const newEventId = (BigInt(event.event_id) + 1n).toString();
  const replyEventId = (BigInt(newEventId) + 1n).toString();
  const nextRound = { ...run, id: '00000000-0000-4000-8000-000000000065', state: 'completed' as const };
  const reply: ModelMessage = {
    id: '00000000-0000-4000-8000-000000000066', run_id: nextRound.id, origin: 'conversation', role: 'assistant',
    parts: [{ kind: 'text', text: '新轮答复' }], source_dependencies: [], private_ref: null, activity_id: null,
    event_id: replyEventId, event_index: 0,
  };
  const revoked = { ...grant, status: 'revoked' as const, version: 2, epoch: 2 };
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let releasePage!: () => void;
  let pageRequested = false;
  let revokedNow = false;
  const waitForPage = new Promise<void>(resolve => { releasePage = resolve; });
  const later: SessionContextSchema.ContextActivity = {
    id: secondId, kind: 'read', state: 'succeeded', model: null, compaction: false, input_tokens: null,
    output_tokens: null, cached_input_tokens: null, input_limit: null, calculated_units: null,
    files: [contextFile('旧页文件名')], hidden_file_count: 0, file_changed: false,
  };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const request = new URL(url);
    if (request.pathname.endsWith('/events')) return new Response(new ReadableStream({ start(value) { stream = value; } }));
    if (request.pathname.endsWith('/snapshot')) return Response.json({
      ...await (await base(url, init)).json(), grants: page([revokedNow ? revoked : grant]),
    });
    if (!request.pathname.endsWith('/context')) return base(url, init);
    const current = contextResponse(contextUsage);
    if (request.searchParams.has('cursor')) {
      pageRequested = true;
      await waitForPage;
      return Response.json({ ...current, activities: page([later]) });
    }
    return Response.json(revokedNow ? { ...contextResponse(contextUsage, nextRound.id),
      files: [contextFile('新轮公开文件')], activities: { ...page([]), watermark: replyEventId } } :
      { ...current, files: [contextFile('首页文件名')], activities: { ...page([]), next_cursor: 'older' } });
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
  await screen.findByRole('heading', { name: '原上下文目标' });
  await user.click(screen.getByRole('button', { name: '上下文' }));
  await screen.findByText('首页文件名');
  await user.click(screen.getByRole('button', { name: '更多本轮记录' }));
  await waitFor(() => expect(pageRequested).toBe(true));
  revokedNow = true;
  await act(async () => {
    const facts: PublicEvent[] = [
      { ...event, kind: 'grant.revoked', event_id: newEventId, seq: null, run_id: null, session_id: null,
        payload: { grants: [revoked], resources: [], approvals: [] } },
      { ...event, event_id: replyEventId, run_id: nextRound.id,
        payload: { ...event.payload, runs: [nextRound], messages: [reply] } },
    ];
    stream.enqueue(new TextEncoder().encode(facts.map(fact =>
      `data: ${JSON.stringify({ kind: 'durable', event_id: fact.event_id, event: fact })}\n\n`).join('')));
  });
  expect(screen.queryByText('首页文件名')).toBeNull();
  await screen.findByText('新轮公开文件');
  expect(screen.getByText('新轮答复')).toBeTruthy();
  await act(async () => releasePage());
  expect(screen.queryByText('首页文件名')).toBeNull();
  expect(screen.queryByText('旧页文件名')).toBeNull();
});

it('文件变化可打开原生选择入口，终态费用和用量都显示未确认', async () => {
  server(contextUsage, 'completed');
  const base = fetch;
  const request: SessionContextSchema.ContextActivity = {
    id: secondId, kind: 'model', state: 'dispatched', model: '测试模型', compaction: false, input_tokens: null,
    output_tokens: null, cached_input_tokens: null, input_limit: 12976, calculated_units: null,
    files: [], hidden_file_count: 0, file_changed: false,
  };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/context/usage')) return Response.json({ ...sessionUsage, requests: 1, unknown_cost_requests: 1 });
    if (!path.endsWith('/context')) return base(url, init);
    const data = contextResponse(contextUsage);
    return Response.json({ ...data, round: { ...data.round, state: 'cancelled', file_changed: true },
      files: [{ ...contextFile('历史纪要.txt'), changed: true }], activities: page([request]) });
  });
  vi.mocked(invoke).mockResolvedValueOnce({ resources: [] });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
  await screen.findByRole('heading', { name: '原上下文目标' });
  await user.click(screen.getByRole('button', { name: '上下文' }));
  const panel = within(await screen.findByRole('region', { name: '上下文详情' }));
  await user.click(await panel.findByText(/^模型请求/, { selector: 'summary' }));
  const modelRequest = panel.getByText('第 1 次请求').closest('li')!;
  expect(within(modelRequest).getByText('未确认')).toBeTruthy();
  expect(within(modelRequest).queryByText(/等待/)).toBeNull();
  await user.click(panel.getByText(/^会话用量与费用/, { selector: 'summary' }));
  expect(await panel.findByText('1 次费用未确认')).toBeTruthy();
  await user.click(panel.getByRole('button', { name: '重新选择以使用新版' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('select_resources', {
    scope: { kind: 'session', workspace_id: id, session_id: id }, kind: 'file',
  }));
});

it.each([[0, '0%'], [20, '25%'], [null, '无缓存读数']] as const)(
  '默认显示跨页的最新请求与缓存读数 %s，展开会话用量才发累计查询', async (cached, label) => {
    const reads = server(contextUsage, 'completed');
    const base = fetch;
    const latest: SessionContextSchema.ContextActivity = {
      id: secondId, kind: 'model', state: 'succeeded', model: '测试模型', compaction: false, input_tokens: 80,
      output_tokens: 12, cached_input_tokens: cached, input_limit: 160, calculated_units: '90000',
      files: [], hidden_file_count: 0, file_changed: false,
    };
    const earlier = { ...latest, id, input_tokens: 40 };
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const request = new URL(url);
      if (!request.pathname.endsWith('/context')) return base(url, init);
      const cursor = request.searchParams.get('cursor');
      return Response.json({ ...contextResponse(contextUsage), latest_request: latest,
        activities: { ...page([cursor ? latest : earlier]), next_cursor: cursor ? null : 'next' } });
    });
    const user = userEvent.setup();
    render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
    await screen.findByRole('heading', { name: '原上下文目标' });
    await user.click(screen.getByRole('button', { name: '上下文' }));
    const section = within(await screen.findByRole('region', { name: '最近一次模型请求' }));
    expect(section.getByText('80 tokens')).toBeTruthy();
    expect(section.getByText('12 tokens')).toBeTruthy();
    expect(section.getByText('80 / 160 tokens')).toBeTruthy();
    expect(section.getByText('50%')).toBeTruthy();
    expect(section.getByText(label)).toBeTruthy();
    const usagePath = `/sessions/${id}/context/usage`;
    expect(reads).not.toContain(usagePath);
    await user.click(screen.getByText(/^模型请求/, { selector: 'summary' }));
    await user.click(screen.getByRole('button', { name: '更多本轮记录' }));
    await screen.findByText('第 2 次请求');
    expect(reads).not.toContain(usagePath);
    await user.click(screen.getByText(/^会话用量与费用/, { selector: 'summary' }));
    await screen.findByText('已计算总费用');
    expect(reads.filter(path => path === usagePath)).toHaveLength(1);
  },
);

it('展开期间保留会话累计快照，折叠后再次展开会读取新值', async () => {
  server(contextUsage, 'completed');
  const base = fetch;
  let calls = 0;
  let activeStream!: ReadableStreamDefaultController<Uint8Array>;
  let revision = event.event_id;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith('/events')) {
      return new Response(new ReadableStream({ start(value) { activeStream = value; } }));
    }
    if (pathname.endsWith('/context/usage')) {
      calls++;
      return Response.json({ ...sessionUsage, requests: 1, calculated_units: calls === 1 ? '10000' : '20000' });
    }
    if (pathname.endsWith('/context')) {
      const current = contextResponse(contextUsage);
      return Response.json({ ...current,
        files: [contextFile(revision === event.event_id ? '当前资料' : '当前资料已更新')],
        activities: { ...current.activities, watermark: revision } });
    }
    return base(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
  await screen.findByRole('heading', { name: '原上下文目标' });
  await user.click(screen.getByRole('button', { name: '上下文' }));
  await screen.findByText('当前资料');
  const disclosure = screen.getByText('会话用量与费用', { selector: 'summary' });
  await user.click(disclosure);
  await screen.findByText('$0.01');
  revision = (BigInt(event.event_id) + 1n).toString();
  await deliver(activeStream, { ...event, kind: 'task.stepped', event_id: revision, seq: 2,
    payload: { ...event.payload, runs: [], messages: [] } });
  await screen.findByText('当前资料已更新');
  expect(screen.getByText('$0.01')).toBeTruthy();
  expect(calls).toBe(1);
  await user.click(disclosure);
  await waitFor(() => expect(screen.queryByText('$0.01')).toBeNull());
  await user.click(disclosure);
  await screen.findByText('$0.02');
  expect(calls).toBe(2);
});

it('无正文晚结算只刷新当前所属会话的上下文与已展开累计用量，不相关 Run 保持快照', async () => {
  server(contextUsage, 'completed');
  const base = fetch, reads: string[] = [];
  const otherRun = { ...run, id: secondId, interaction_session_id: secondId, execution_session_id: secondId };
  let activeStream!: ReadableStreamDefaultController<Uint8Array>;
  let settled = false;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url); reads.push(pathname);
    if (pathname.endsWith('/events')) return new Response(new ReadableStream({ start(value) { activeStream = value; } }));
    if (pathname.endsWith('/snapshot')) {
      const snapshot = await (await base(url, init)).json();
      return Response.json({ ...snapshot, active_runs: page([...snapshot.active_runs.items, otherRun]) });
    }
    if (pathname.endsWith(`/runs/${secondId}`)) return Response.json({ ...runDetailSummary, run: otherRun,
      tasks: page([]), activities: page([]), artifacts: page([]), messages: page([]), questions: page([]),
      approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
      budget: { id: secondId, run_id: secondId, version: 2, limits, spent_units: '0', reserved_units: '0',
        model_requests: 0, task_count: 1, steps: 0, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id });
    if (pathname.endsWith('/context/usage')) return Response.json({ ...sessionUsage, requests: 1,
      calculated_units: settled ? '20000' : '10000' });
    return base(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} />);
  await screen.findByRole('heading', { name: '原上下文目标' });
  await user.click(screen.getByRole('button', { name: '上下文' }));
  await screen.findByText('本轮尚无已使用的资料。');
  await user.click(screen.getByText('会话用量与费用', { selector: 'summary' }));
  await screen.findByText('$0.01');
  const before = reads.filter(path => path.endsWith('/context')).length;
  const notice = (runId: string, step: bigint): PublicEvent => ({ ...event, kind: 'accounting.settled',
    event_id: (BigInt(event.event_id) + step).toString(), workspace_id: null, session_id: null, run_id: runId,
    payload: { scopes: [], deletions: [] } });
  await deliver(activeStream, notice(secondId, 1n));
  expect(reads.filter(path => path.endsWith('/context'))).toHaveLength(before);
  expect(reads.filter(path => path.endsWith('/context/usage'))).toHaveLength(1);
  settled = true;
  await deliver(activeStream, notice(id, 2n));
  await screen.findByText('$0.02');
  expect(reads.filter(path => path.endsWith('/context'))).toHaveLength(before + 1);
  expect(reads.filter(path => path.endsWith('/context/usage'))).toHaveLength(2);
});
