import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { Conversation } from '../chat/Conversation';
import { id, secondId, page, agent, connection, event, limits, model, run, runDetailSummary } from '../../test/fixtures';
import type { SessionInboxEntry } from '../../generated/contracts';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it('启动默认项目来自 navigation 身份，不把工作区首页第一项当日常', async () => {
  const other = { id, version: 1, name: '先创建的其它项目', directory_resource_id: null };
  const daily = { ...other, id: secondId, name: '改过名字的默认项目' };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/navigation')) return Response.json({ default_workspace_id: secondId, workspaces: page([{ workspace: daily, sessions: page([]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path.endsWith('/workspaces')) return Response.json(page([other, daily]));
    if (path.endsWith('/profiles')) return Response.json(page([agent]));
    if (path.endsWith('/directory')) return Response.json({ workspace_id: path.includes(secondId) ? secondId : id, workspace_version: 1, state: 'unlinked', resource: null, reason: null });
    if (path.endsWith('/snapshot')) { const workspace = path.includes(secondId) ? daily : other; return Response.json({ workspace, sessions: page([{ id: workspace.id, version: 1, workspace_id: workspace.id, title: workspace.id === secondId ? '默认会话' : '其它会话', agent_profile_id: id, kind: 'interaction', archived: false }]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id }); }
    return Response.json(page([]));
  });
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 })} />);
  await screen.findByRole('heading', { name: '默认会话' });
  expect((screen.getByLabelText('工作区') as HTMLSelectElement).value).toBe(secondId);
});

it('真实重投命令及delivery.changed后导航待办自动4→3，不手刷、不切当前会话或清草稿/模型', async () => {
  const workspace = { id, version: 1, name: '重投项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '保留当前对话', agent_profile_id: id, kind: 'interaction', archived: false };
  const managed = { ...run, kind: 'managed', state: 'completed', execution_session_id: secondId };
  let entry: SessionInboxEntry = { id: secondId, version: 4, source_event_id: event.event_id, target_session_id: id,
    result: { run_id: run.id, task_id: run.root_task_id, lifetime: 'managed', submitted_state: 'completed' }, result_version: 1,
    delivery_state: 'failed', source_valid: true, consumers: [], dependencies: [], viewed_at: null, attempts: 3, last_error: 'OSError' };
  let pendingCount = 4;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const writes: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return Response.json(page([]));
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
    if (init.method === 'POST' && path === `/results/${entry.id}/retry`) {
      writes.push(path); entry = { ...entry, version: 5, delivery_state: 'pending', attempts: 0, last_error: null };
      return Response.json(entry);
    }
    const values: Record<string, unknown> = {
      '/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: pendingCount }]),
        recent_sessions: page([session]), pending_count: pendingCount, watermark: pendingCount === 4 ? event.event_id : (BigInt(event.event_id) + 1n).toString() },
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]), '/models': page([model]), '/model-connections': page([connection]),
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]),
        resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/messages`]: page([]), [`/sessions/${id}/runs`]: page([managed]), [`/sessions/${id}/results`]: { ...page([entry]), watermark: pendingCount === 4 ? event.event_id : (BigInt(event.event_id) + 1n).toString() },
      [`/runs/${id}/export-recovery`]: [],
      [`/runs/${id}`]: { ...runDetailSummary, run: managed, tasks: page([]), activities: page([]), artifacts: page([]), messages: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
        budget: { id: run.budget_id, run_id: run.id, version: 1, limits, steps: 0, model_requests: 0, task_count: 1, spent_units: '0', reserved_units: '0', total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id },
    };
    if (!(path in values)) throw new Error(`未定义HTTP ${path}`);
    return Response.json(values[path]);
  });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 })} />);
  await screen.findByRole('heading', { name: session.title });
  await screen.findByRole('button', { name: /待办 4/ });
  const input = screen.getByLabelText('消息');
  await user.type(input, '重投期间保留草稿');
  await user.click(screen.getByText('后台交付结果'));
  await user.click(await screen.findByRole('button', { name: '重新投递' }));
  await screen.findByRole('heading', { name: '等待投递' });
  entry = { ...entry, version: 6, delivery_state: 'delivered', attempts: 1 };
  pendingCount = 3;
  const position = (BigInt(event.event_id) + 1n).toString();
  input.focus();
  await act(async () => { stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'durable', event_id: position,
    event: { ...event, kind: 'delivery.changed', event_id: position, payload: { deliveries: [entry] } } })}\n\n`)); });
  await screen.findByRole('heading', { name: '已送达' });
  await screen.findByRole('button', { name: /待办 3/ });
  await waitFor(() => expect(screen.getByRole('button', { name: /重投项目3/ })).toBeTruthy());
  expect((screen.getByLabelText('会话') as HTMLSelectElement).value).toBe(id);
  expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe(model.id);
  expect((input as HTMLTextAreaElement).value).toBe('重投期间保留草稿');
  expect(document.activeElement).toBe(input);
  expect(writes).toEqual([`/results/${entry.id}/retry`]);
});
