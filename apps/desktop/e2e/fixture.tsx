import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import App from '../src/App';
import { agent, binding, connection, event, grant, id, limits, model, page, resource, run, runDetailSummary, secondId } from '../src/test/fixtures';
import type { DataUseGrant, ModelMessage, RunSnapshot, Session, Workspace } from '../src/generated/contracts';
import type { WorkbenchRequest } from '../src/api/windows';

// 仅由验收页面载入。所有业务调用留在内存，未定义的路由立即失败。
let sequence = 100;
const uuid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
const workspaces: Workspace[] = [{ id, name: '合成验收项目', version: 1, directory_resource_id: null }];
const sessions: Session[] = [{ id, workspace_id: id, title: '合成会话', version: 1, agent_profile_id: id, kind: 'interaction', archived: false }];
sessions.push({ ...sessions[0], id: secondId, title: '合成对照会话' });
const messages: ModelMessage[] = [];
let current: RunSnapshot | undefined;
const runs = new Map<string, RunSnapshot>();
const grants: DataUseGrant[] = [];
let navigation: WorkbenchRequest | null = null;
let watermark = BigInt(event.event_id);
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
const requests: { path: string; method: string; body: unknown }[] = [];
const nativeRequests: { command: string; args: unknown }[] = [];
const unexpectedRequests: string[] = [];
const profile = { ...agent, display_name: '日常助理', default_model_profile_id: model.id };
const detail = (value: RunSnapshot) => ({ ...runDetailSummary, run: value, tasks: page([{ id: value.root_task_id, run_id: value.id, version: 1,
  binding: { ...binding, config: value.config, execution_session_id: value.execution_session_id, interaction_session_id: value.interaction_session_id }, parent_task_id: null, origin_task_id: null, kind: 'agent', executor_id: 'builtin.agent',
  state: value.state, created_seq: 1, deadline_at: null, result_version: null, reason: null }]), activities: page([]), messages: page(messages.filter(message => message.run_id === value.id)),
  artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
  budget: { id: value.budget_id, run_id: value.id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0,
    task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: String(watermark) });

mockIPC(async (command, args) => {
  nativeRequests.push({ command, args });
  const payload = args as Record<string, unknown> | undefined;
  if (command === 'runtime_connection') return { base_url: 'http://synthetic.invalid', token: 'synthetic-token', protocol_version: 3 };
  if (command === 'take_settings_navigation') return null;
  if (command === 'take_workbench_navigation') { const target = navigation; navigation = null; return target; }
  if (command === 'show_workbench') {
    await (window as Window & { acknowledgeWorkbench?: () => Promise<void> }).acknowledgeWorkbench?.();
    navigation = { target: payload?.target as WorkbenchRequest['target'], from_quick: false };
    return emit('workbench-navigation', null);
  }
  if (command === 'select_resources') return { resources: [{ ...resource, scope: payload?.scope }] };
  if (command === 'pending_counts') return { pending_actions: 0, pending_questions: 0, pending_approvals: 0, unviewed_results: 0 };
  if (command === 'window_settings') return { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
  if (command === 'set_quick_form_active' || command === 'toggle_quick') return;
  if (command === 'set_quick_pinned') return { quick_pinned: payload?.pinned, ball_enabled: false, shortcut: null, shortcut_error: null };
  if (command === 'credential_status') return { configured: false };
  unexpectedRequests.push(command);
  throw new Error(`未定义的原生测试命令：${command}`);
}, { shouldMockEvents: true });
const originalFetch = window.fetch;
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.origin !== 'http://synthetic.invalid') return originalFetch(input, init);
  const path = url.pathname.replace('/v3', '');
  const body = init.body ? JSON.parse(String(init.body)) : null;
  requests.push({ path, method: init.method ?? 'GET', body });
  if (path.endsWith('/events')) {
    let active: ReadableStreamDefaultController<Uint8Array>;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { active = controller; streams.add(controller); }, cancel() { streams.delete(active); } }));
  }
  if (init.method === 'POST') {
    if (path.endsWith('/resource-coverage')) {
      const allowed = grants.some(item => item.scope.session_id === path.split('/')[2]
        && item.destination === connection.endpoint && body.resource_ids.every((id: string) => item.resource_ids.includes(id)));
      return Response.json({ allowed, destination: connection.endpoint,
        missing_read: allowed ? [] : body.resource_ids, missing_model_send: allowed ? [] : body.resource_ids });
    }
    if (path === '/grants') { const value = { ...grant, ...body.data, id: uuid() }; grants.push(value); return Response.json(value); }
    if (path === '/workspaces') { const value = { id: uuid(), version: 1, name: body.data.name, directory_resource_id: null }; workspaces.push(value); return Response.json(value); }
    if (path.endsWith('/sessions')) { const value: Session = { ...sessions[0], id: uuid(), workspace_id: path.split('/')[2], title: body.data.title }; sessions.push(value); return Response.json(value); }
    if (path.endsWith('/runs')) {
      const sessionId = path.split('/')[2];
      current = { ...run, id: uuid(), interaction_session_id: sessionId, execution_session_id: sessionId, workspace_id: sessions.find(session => session.id === sessionId)!.workspace_id,
        config: { ...run.config, agent_profile: profile }, sources: body.data.sources, state: 'running' };
      runs.set(current.id, current);
      messages.push({ id: uuid(), run_id: current.id, activity_id: null, event_id: String(++watermark), event_index: 0, role: 'user', origin: 'conversation',
        parts: [{ kind: 'text', text: body.data.text }], private_ref: null, source_dependencies: [] });
      return Response.json(current);
    }
    if (path.endsWith('/cancel')) { current = { ...runs.get(path.split('/')[2])!, state: 'cancelled', reason: 'user_cancelled', version: runs.get(path.split('/')[2])!.version + 1 }; runs.set(current.id, current); return Response.json(current); }
    unexpectedRequests.push(path);
    throw new Error(`未定义的写入路由：${path}`);
  }
  if (path === '/navigation') return Response.json({ default_workspace_id: id, workspaces: page(workspaces.map(workspace => ({
    workspace, sessions: page(sessions.filter(session => session.workspace_id === workspace.id)), pending_count: 0 }))), recent_sessions: page([]), pending_count: 0, watermark: String(watermark) });
  if (path === '/workspaces') return Response.json(page(workspaces));
  if (path === '/profiles') return Response.json(page([{ ...profile, id: secondId, display_name: '排序靠前的成员' }, profile]));
  if (path === '/models') return Response.json(url.searchParams.get('cursor') === 'synthetic-model-tail'
    ? page([model]) : { ...page([]), next_cursor: 'synthetic-model-tail' });
  if (path === `/models/${model.id}/resolved`) return Response.json({
    ...run.config.model_profile, model_pricing: null, pricing_unknown_reason: '合成价格未知', blockers: [],
  });
  if (path === '/model-connections') return Response.json(page([connection]));
  if (path === '/provider-presets') return Response.json([]);
  if (path.endsWith('/grants')) return Response.json({ ...page(grants.filter(item => item.scope.workspace_id === path.split('/')[2]
    && (!url.searchParams.has('session_id') || item.scope.session_id === url.searchParams.get('session_id')))), watermark: String(watermark) });
  if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/results')) return Response.json(page([]));
  if (path.endsWith('/directory')) return Response.json({ workspace_id: path.split('/')[2], workspace_version: 1, state: 'unlinked', reason: null, resource: null });
  if (path.endsWith('/snapshot')) return Response.json({ workspace: workspaces.find(workspace => workspace.id === path.split('/')[2]),
    sessions: page(sessions.filter(session => session.workspace_id === path.split('/')[2])), active_runs: page(current && current.state === 'running' ? [current] : []),
    pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: String(watermark) });
  if (/^\/sessions\/[^/]+$/.test(path)) return Response.json(sessions.find(session => session.id === path.split('/')[2]));
  if (path.endsWith('/run-feedback')) return Response.json({ ...page(url.searchParams.getAll('run_id').map(id => runs.get(id)!).map(value => ({
    run_id: value.id, version: value.version, workspace_id: value.workspace_id,
    session_id: value.interaction_session_id, root_task_id: value.root_task_id,
    connection_id: value.config.model_profile.connection_id, state: value.state, reason: value.reason, model_activity: null,
  }))), watermark: String(watermark) });
  if (path.endsWith('/messages')) return Response.json(page(messages.filter(message => runs.get(message.run_id)!.interaction_session_id === path.split('/')[2])));
  if (path.endsWith('/export-recovery')) return Response.json([]);
  if (path.startsWith('/sessions/') && path.endsWith('/runs')) return Response.json(page([...runs.values()].filter(value => value.interaction_session_id === path.split('/')[2])));
  if (path.startsWith('/runs/')) return Response.json(detail(runs.get(path.split('/')[2])!));
  unexpectedRequests.push(path);
  throw new Error(`未定义的读取路由：${path}`);
};
Object.assign(window, { syntheticUi: { requests, nativeRequests, unexpectedRequests, complete() {
  current = { ...current!, state: 'completed', version: current!.version + 1 };
  runs.set(current.id, current);
  const message: ModelMessage = { id: uuid(), run_id: current.id, activity_id: null, event_id: String(++watermark), event_index: 0, role: 'assistant', origin: 'conversation',
    parts: [{ kind: 'text', text: '合成验收已完成，可以继续下一步。' }], private_ref: null, source_dependencies: [] };
  messages.push(message);
  const wire = { kind: 'durable', event_id: String(watermark), event: { ...event, event_id: String(watermark), kind: 'task.stepped', run_id: current.id,
    session_id: current.interaction_session_id, workspace_id: current.workspace_id, payload: { ...event.payload, runs: [current], messages: [message] } } };
  for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`));
}, fail(reason: string) {
  current = { ...current!, state: 'failed', reason, version: current!.version + 1 };
  runs.set(current.id, current);
  const wire = { kind: 'durable', event_id: String(++watermark), event: { ...event, event_id: String(watermark), kind: 'task.stepped', run_id: current.id,
    session_id: current.interaction_session_id, workspace_id: current.workspace_id, payload: { ...event.payload, runs: [current] } } };
  for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`));
} } });
createRoot(document.getElementById('root')!).render(<App />);
