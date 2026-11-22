import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient, commandMeta } from '../../api/client';
import type { Approval } from '../../generated/contracts';
import { agent, connection, event, id, limits, model, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import ApprovalCard from './ApprovalCard';
import { Conversation } from './Conversation';
import { Inbox } from '../notifications/Inbox';

const taskDetailsEntry = () => within(screen.getByRole('navigation', { name: '会话详情入口' })).getByRole('button', { name: '任务' });

afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('只在工具行打开回执，答复后只显示正式文件一次（产物待补页=%s）', async cold => {
  const uid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
  const workspace = { id, version: 1, name: '交付测试', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '报告会话', agent_profile_id: id, kind: 'interaction', archived: false };
  const ref = (suffix: number, source: number) => ({ id: uid(suffix), version: 1, content_hash: 'a'.repeat(64),
    task_id: run.root_task_id, activity_id: uid(source), dependencies: [], media_type: 'text/plain' });
  const receipt = ref(301, 311), file = ref(302, 312);
  const completed = { ...run, state: 'completed', output: {
    summary: '正式正文', artifact_ids: [file.id], unresolved: [], handled_failures: [],
  } };
  const messages = [
    { id: uid(321), role: 'assistant', parts: [{ kind: 'tool_call', call_id: 'query', name: 'files.read_text', arguments: {} }] },
    { id: uid(322), role: 'tool', activity_id: receipt.activity_id, parts: [{ kind: 'tool_result', call_id: 'query',
      origin_message_id: uid(321), error: null, result: { artifact_id: receipt.id, truncated: true, preview: '正文预览', total_chars: 64 } }] },
    { id: uid(323), role: 'assistant', parts: [{ kind: 'text', text: '正式正文' }] },
  ].map((message, index) => ({ activity_id: null, event_id: String(index + 1), event_index: 0, run_id: run.id,
    origin: 'conversation', private_ref: null, source_dependencies: [], ...message }));
  const activity = { id: file.activity_id, run_id: run.id, task_id: run.root_task_id, kind: 'tool', version: 3,
    operation: 'skills.run_script', state: 'succeeded', usage: null, actual_units: null, dependencies: [], error: null,
    script_execution: { skill_id: id, content_hash: 'a'.repeat(64), script_relative_path: 'scripts/report.py',
      environment_id: id, environment_revision: 1, attempt_id: uid(331), exit_code: 0, termination_reason: 'exited', truncated: false,
      collection_error: null, external_costs: 'unknown',
      outputs: [{ relative_path: 'report.txt', artifact: file }] } };
  const detail = { ...runDetailSummary, run: completed, tasks: page([]), activities: page(cold ? [] : [activity]),
    messages: page(messages), artifacts: page(cold ? [] : [receipt, file]), questions: page([]), approvals: page([]),
    waits: page([]), consumptions: page([]), joins: page([]), budget: { id: run.budget_id, run_id: id, version: 1,
      limits, spent_units: '0', reserved_units: '0', model_requests: 1, task_count: 1, steps: 3,
      total_tokens: 0, reserved_tokens: 0 }, watermark: '3' };
  const text = '2026-11-21\n\n- 第一项\n\n```python\nprint("report")\n```';
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/export-recovery')) return Response.json([]);
    if (path.endsWith('/content')) return Response.json({ text, start: 0, end: text.length, total_chars: text.length, source_version: receipt.content_hash });
    if (path === `/sessions/${id}/artifacts/${file.id}`) return Response.json(page([file]));
    if (path === `/sessions/${id}/artifacts/${receipt.id}`) return Response.json(page([receipt]));
    if (['/commands', '/follow-ups', '/results', '/run-feedback'].some(suffix => path.endsWith(suffix))) return Response.json(page([]));
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([agent]), '/models': page([model]), '/model-connections': page([connection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]),
        pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: '1' },
      [`/sessions/${id}/runs`]: page([completed]), [`/sessions/${id}/messages`]: page(messages), [`/runs/${id}`]: detail };
    return Response.json(values[path] ?? {});
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 })} />);
  const deliveryLabel = cold ? '交付文件 1' : 'report.txt';
  const delivery = await screen.findByRole('button', { name: deliveryLabel });
  expect(within(screen.getByLabelText('本轮产物')).getAllByRole('button')).toEqual([delivery]);
  if (cold) {
    await user.click(delivery);
    expect(await screen.findByTitle('产物预览')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '关闭详情' }));
  }
  const tool = (await screen.findByText('读取文本')).closest('details')!;
  await user.click(within(tool).getByText('读取文本'));
  await user.click(within(tool).getByRole('button', { name: '阅读完整回执' }));
  const preview = await screen.findByTitle('产物预览') as HTMLIFrameElement;
  expect(new DOMParser().parseFromString(preview.srcdoc, 'text/html').querySelector('pre')?.textContent).toBe(text);
});

it('冷重开后，两个交付轮次均可打开同一个跨轮发布的文件', async () => {
  const workspace = { id, version: 1, name: '跨轮项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '跨轮历史', agent_profile_id: id, kind: 'interaction', archived: false };
  const artifactId = '00000000-0000-4000-8000-000000000361';
  const firstRun = { ...run, state: 'completed', output: {
    summary: '第一份正式答复', artifact_ids: [artifactId, artifactId], handled_failures: [], unresolved: [],
  } };
  const laterRun = { ...firstRun, id: secondId, output: { ...firstRun.output, summary: '第二份正式答复', artifact_ids: [artifactId] } };
  const body = '跨轮文件原文\n\n第二段';
  const fetches: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', '');
    fetches.push(path);
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/export-recovery')) return Response.json([]);
    if (path === `/sessions/${id}/artifacts/${artifactId}`) return Response.json(page([{
      id: artifactId, task_id: run.root_task_id, activity_id: '00000000-0000-4000-8000-000000000362',
      media_type: 'text/plain', content_hash: 'a'.repeat(64), version: 1, dependencies: [],
    }]));
    if (path === `/artifacts/${artifactId}/content`) return Response.json({
      text: body, start: 0, end: body.length, total_chars: body.length, source_version: 'a'.repeat(64),
    });
    if (['/messages', '/commands', '/follow-ups', '/results', '/run-feedback'].some(suffix => path.endsWith(suffix))) return Response.json(page([]));
    if (path === `/runs/${laterRun.id}`) return Response.json({
      ...runDetailSummary, run: laterRun, tasks: page([]), activities: page([]), messages: page([]),
      artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
      budget: { id: run.budget_id, run_id: laterRun.id, version: 1, limits, spent_units: '0', reserved_units: '0',
        model_requests: 1, task_count: 1, steps: 3, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id,
    });
    const routes: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([agent]), '/models': page([model]), '/model-connections': page([connection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]),
        resources: page([]), grants: page([]), watermark: event.event_id }, [`/sessions/${id}/runs`]: page([firstRun, laterRun]) };
    return Response.json(routes[path] ?? {});
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 })} />);
  await screen.findByText('第二份正式答复');
  const tails = screen.getAllByLabelText('本轮产物');
  expect(tails).toHaveLength(2);
  for (const tail of [...tails].reverse()) {
    const links = within(tail).getAllByRole('button');
    expect(links).toHaveLength(1);
    await user.click(links[0]);
    expect((await screen.findByTitle('产物预览')).getAttribute('srcdoc')).toContain('跨轮文件原文');
    await user.click(screen.getByRole('button', { name: '关闭详情' }));
  }
  expect(fetches.filter(path => path === `/sessions/${id}/artifacts/${artifactId}`)).toHaveLength(1);
});

it.each([false, true])('导出审批显示可信路径、产物版本和明确创建/覆盖事实 existing=%s', existing => {
  const approval: Approval = { mcp: null, id: secondId, version: 1, workspace_id: id, session_id: id, run_id: id, task_id: id, activity_id: id,
    call_id: 'call', tool_name: 'artifacts.export', tool_version: '1', args_hash: 'abc', target: secondId,
    export_preview: { target_path: 'C:\\Synthetic\\真实审批目标.md', target_exists: existing, artifact_id: id, artifact_version: 3 },
    parameters: { target_ref: secondId }, dependencies: [], expires_at: '2026-11-07T13:00:00Z', status: 'pending' };
  render(<ApprovalCard approval={approval} busy={false} onDecision={async () => {}} />);
  expect(screen.getByText('C:\\Synthetic\\真实审批目标.md')).toBeTruthy();
  expect(screen.getByText(existing ? '覆盖已核验的现有文件' : '创建新文件')).toBeTruthy();
  expect(screen.getByText('产物版本：3')).toBeTruthy();
});

it('审批卡的连续点击只发送一次真实HTTP决定，响应前两种操作均锁定', async () => {
  const approval: Approval = { mcp: null, id: secondId, version: 1, workspace_id: id, session_id: id, run_id: id, task_id: id, activity_id: id,
    call_id: 'call', tool_name: 'artifacts.export', tool_version: '1', args_hash: 'abc', target: secondId, parameters: { target_ref: secondId },
    export_preview: { target_path: 'C:\\Synthetic\\report.md', target_exists: false, artifact_id: id, artifact_version: 1 },
    dependencies: [], expires_at: '2026-11-07T13:00:00Z', status: 'pending' };
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 });
  const bodies: unknown[] = [];
  let resolve!: (response: Response) => void;
  const response = new Promise<Response>(done => { resolve = done; });
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(init.body as string)); return (await response).clone(); });
  render(<ApprovalCard approval={approval} busy={false} onDecision={async allow => {
    await client.decide(approval.id, { meta: commandMeta(approval.version), data: { allow } });
  }} />);
  const allow = screen.getByRole('button', { name: '允许本次操作' });
  act(() => { fireEvent.click(allow); fireEvent.click(allow); });
  const count = bodies.length;
  const locked = (screen.getByRole('button', { name: '拒绝本次操作' }) as HTMLButtonElement).disabled;
  await act(async () => { resolve(new Response(JSON.stringify({ ...approval, version: 2, status: 'approved' }))); });
  await waitFor(() => expect((allow as HTMLButtonElement).disabled).toBe(false));
  expect(count).toBe(1);
  expect(locked).toBe(true);
});

it('没有活跃Run时仍可从持久历史定位完成任务，并显示实际join与子Task', async () => {
  const completed = { ...run, state: 'completed' as const };
  const childId = '00000000-0000-4000-8000-000000000091';
  const task = { id: run.root_task_id, version: 1, run_id: id, binding: { agent_work: null, input_artifacts: [], input_result: null, additional_result_inputs: [], file_inputs: {}, execution_session_id: run.execution_session_id, interaction_session_id: run.interaction_session_id, config: run.config, sources: run.sources, delegation_depth: 0 }, parent_task_id: null, origin_task_id: null, kind: 'agent' as const,
    executor_id: 'builtin.agent', state: 'completed' as const, created_seq: 1, deadline_at: null, result_version: 1, reason: null };
  const session = { id, version: 1, workspace_id: id, title: '历史会话', agent_profile_id: agent.id, kind: 'interaction', archived: false };
  const workspace = { id, version: 1, name: '项目笔记', directory_resource_id: null };
  const detail = { ...runDetailSummary, run: completed, tasks: page([task, { ...task, id: childId, parent_task_id: task.id, kind: 'tool', executor_id: 'builtin.tool', created_seq: 3 }]),
    activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]),
    joins: page([{ id: '00000000-0000-4000-8000-000000000099', run_id: id, root_task_id: task.id, child_task_id: childId, child_result_version: 1, event_id: event.event_id }]),
    budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 1, task_count: 2, steps: 3, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return Response.json(page([]));
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([agent]), '/models': page([model]), '/model-connections': page([connection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/runs`]: page([completed]), [`/sessions/${id}/messages`]: page([]), [`/runs/${id}`]: detail };
    return new Response(JSON.stringify(values[path]));
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 })} />);
  await user.click(taskDetailsEntry());
  await user.click(await screen.findByRole('button', { name: /本次对话.*已完成/ }));
  const node = await screen.findByRole('button', { name: /任务.*工具任务/ });
  expect(node.getAttribute('data-entity-id')).toBe(childId);
  expect(document.querySelectorAll('.graph-edge--join')).toHaveLength(1);
  await user.click(node);
  expect(screen.getByRole('region', { name: '所选步骤' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: `Task ${childId}` })).toBeNull();
});

it('待办归属Run尚未补页时不可导航到不存在的投影', async () => {
  const question = { id: secondId, version: 1, run_id: id, task_id: id, call_id: 'ask', message_id: id, question: '等待补页',
    answer_schema: { type: 'string' }, status: 'pending' as const, answer_message_id: null, dependencies: [] };
  const onSelect = vi.fn();
  const user = userEvent.setup();
  const otherRun = { ...run, id: secondId };
  const { rerender } = render(<Inbox questions={[question]} approvals={[]} runs={[otherRun]} onSelect={onSelect} />);
  const pending = () => screen.getByRole<HTMLButtonElement>('button', { name: '定位运行：等待补页' });
  expect(pending().disabled).toBe(true);
  await user.click(pending());
  expect(onSelect).not.toHaveBeenCalled();
  rerender(<Inbox questions={[question]} approvals={[]} runs={[otherRun, run]} onSelect={onSelect} />);
  expect(pending().disabled).toBe(false);
  await user.click(pending());
  expect(onSelect.mock.calls).toEqual([[run.id]]);
});

it('更多审批补齐首页之外的Run和Session，能定位到真实审批', async () => {
  const workspace = { id, version: 1, name: '项目笔记', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '当前会话', agent_profile_id: agent.id, kind: 'interaction', archived: false };
  const other = { ...session, id: secondId, title: '分页之外的待审批会话' };
  const waiting = { ...run, id: secondId, interaction_session_id: secondId, execution_session_id: secondId, state: 'waiting_approval' as const };
  const approval: Approval = { mcp: null, id: secondId, version: 1, workspace_id: id, session_id: secondId, run_id: secondId,
    task_id: id, activity_id: id, call_id: 'export', tool_name: 'artifacts.export', tool_version: '1', args_hash: 'abc',
    target: secondId, export_preview: { target_path: 'C:\\Synthetic\\report.md', target_exists: false, artifact_id: id, artifact_version: 1 },
    parameters: { target_ref: secondId }, dependencies: [], expires_at: '2026-11-07T13:00:00Z', status: 'pending' };
  const detail = { ...runDetailSummary, run: waiting, tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]), questions: page([]),
    approvals: page([approval]), waits: page([]), consumptions: page([]), joins: page([]),
    budget: { id: run.budget_id, run_id: secondId, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, task_count: 1, steps: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id };
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([agent]), '/models': page([model]), '/model-connections': page([connection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]),
        pending_approvals: { ...page([]), next_cursor: 'approvals-next' }, resources: page([]), grants: page([]), watermark: event.event_id },
       '/inbox': page([{ id: approval.id, kind: 'approval', workspace_id: id, session_id: secondId, run_id: secondId, approval }]),
       [`/workspaces/${id}/approvals`]: page([approval]), [`/sessions/${id}/runs`]: page([]), [`/sessions/${id}/messages`]: page([]),
      [`/runs/${secondId}`]: detail, [`/sessions/${secondId}`]: other, [`/sessions/${secondId}/runs`]: page([waiting]), [`/sessions/${secondId}/messages`]: page([]) };
    return new Response(JSON.stringify(values[path]));
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 })} />);
  await user.click(await screen.findByRole('button', { name: '更多审批' }));
  await user.click(screen.getByRole('button', { name: /待办/ }));
  const navigate = await screen.findByRole('button', { name: /审批/ });
  await user.click(navigate);
  expect(await screen.findByText('仅处理原后台任务；当前会话、草稿和本次配置不变。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '允许本次操作' })).toBeTruthy();
});

it('Trace补页返回时已切换Run，不把旧事件并入新运行', async () => {
  const completed = { ...run, state: 'completed' as const, output: { summary: '第一项历史', artifact_ids: [], unresolved: [], handled_failures: [] } };
  const next = { ...completed, id: secondId, root_task_id: secondId, output: { ...completed.output, summary: '第二项历史' } };
  const session = { id, version: 1, workspace_id: id, title: '历史会话', agent_profile_id: agent.id, kind: 'interaction', archived: false };
  const workspace = { id, version: 1, name: '项目笔记', directory_resource_id: null };
  const detail = (value: typeof completed) => ({ ...runDetailSummary, run: value, tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
    budget: { id: run.budget_id, run_id: value.id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, task_count: 1, steps: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id });
  const traceItem = (position: string, kind: string) => ({ event_id: position, seq: 1, kind, task_id: null, activity_id: null, activities: [] });
  let finish!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => { finish = resolve; });
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path === `/runs/${id}/trace` && parsed.search) return delayed;
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([agent]), '/models': page([model]), '/model-connections': page([connection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/runs`]: page([completed, next]), [`/sessions/${id}/messages`]: page([]), [`/runs/${id}`]: detail(completed), [`/runs/${secondId}`]: detail(next),
      [`/runs/${id}/trace`]: { ...page([traceItem('101', 'run.started')]), next_cursor: 'first-next' }, [`/runs/${secondId}/trace`]: page([traceItem('201', 'task.joined')]) };
    return new Response(JSON.stringify(values[path]));
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 })} />);
  await user.click(taskDetailsEntry());
  await user.click(await screen.findByRole('button', { name: /第一项历史/ }));
  await user.click(screen.getByRole('button', { name: '查看 Trace' }));
  await user.click(await screen.findByRole('button', { name: '加载更多事件' }));
  await user.click(screen.getByRole('button', { name: '关闭详情' }));
  await user.click(taskDetailsEntry());
  await user.click(screen.getByRole('button', { name: /第二项历史/ }));
  await user.click(screen.getByRole('button', { name: '查看 Trace' }));
  await screen.findByText('task.joined');
  await act(async () => { finish(new Response(JSON.stringify(page([traceItem('102', 'task.cancelled')])))); });
  expect(screen.queryByText('task.cancelled')).toBeNull();
  expect(screen.getByText('task.joined')).toBeTruthy();
});

it.each(['history', 'trace'])('%s keyset 续页在无关写入后保留已加载尾页，重复项按身份合并', async kind => {
  const completed = { ...run, state: 'completed' as const };
  const session = { id, version: 1, workspace_id: id, title: '分页恢复', agent_profile_id: agent.id, kind: 'interaction', archived: false };
  const workspace = { id, version: 1, name: '分页测试', directory_resource_id: null };
  const detail = { ...runDetailSummary, run: completed, tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]),
    questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
    budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, task_count: 1, steps: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id };
  const traceItem = { event_id: '101', seq: 1, kind: 'run.started', task_id: null, activity_id: null, activities: [] };
  const target = kind === 'history' ? `/sessions/${id}/messages` : `/runs/${id}/trace`;
  let changed = false;
  const cursors: (string | null)[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path === target) {
      const cursor = parsed.searchParams.get('cursor'); cursors.push(cursor);
      return new Response(JSON.stringify({ ...page(kind === 'trace' ? [changed ? { ...traceItem, event_id: '102', kind: 'task.stepped' } : traceItem] : []),
        next_cursor: cursor === 'fresh' ? null : changed ? 'fresh' : 'stale',
        watermark: changed ? '9007199254740994' : event.event_id }));
    }
    if (path === '/navigation') return Response.json({ default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path.endsWith('/directory')) return Response.json({ workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null });
    if (path.endsWith('/export-recovery')) return Response.json([]);
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([agent]), '/models': page([model]), '/model-connections': page([connection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/runs`]: page([completed]), [`/sessions/${id}/messages`]: page([]), [`/runs/${id}`]: detail };
    return new Response(JSON.stringify(values[path]));
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 })} />);
  await screen.findByRole('heading', { name: session.title });
  if (kind === 'trace') { await user.click(taskDetailsEntry()); await user.click(screen.getByRole('button', { name: '查看 Trace' })); }
  const button = await screen.findByRole('button', { name: kind === 'trace' ? '加载更多事件' : '更多历史' });
  changed = true;
  await user.click(button);
  await waitFor(() => expect(cursors.at(-1)).toBe('stale'));
  if (kind === 'trace') expect(screen.getAllByText('运行开始')).toHaveLength(1);
  await user.click(button);
  await waitFor(() => expect(cursors.at(-1)).toBe('fresh'));
  if (kind === 'trace') expect(screen.getAllByText('任务进度')).toHaveLength(1);
  expect(screen.queryByRole('alert')).toBeNull();
});
