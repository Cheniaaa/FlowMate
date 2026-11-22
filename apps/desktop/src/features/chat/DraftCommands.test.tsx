import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { agent, connection, event, grant, id, limits, model, modelResolution, page, pendingUserCommand, resource, run, runDetailSummary, secondId } from '../../test/fixtures';
import { createDraftStore } from '../../state/draft-store';
import type { SkillView } from '../../generated/contracts';
import { expectComposerModel, selectComposerModel } from '../../test/composer-model';
import { Conversation } from './Conversation';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
// jsdom 未实现原生 dialog 方法；这里只模拟可见性，不替代真实 WebView 焦点验收。
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
  close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 3 });
const session = { id, version: 1, workspace_id: id, title: '会话 A', agent_profile_id: id, kind: 'interaction', archived: false };
const otherSession = { ...session, id: secondId, title: '会话 B' };
const draftScope = { kind: 'workspace' as const, workspace_id: id, session_id: null };
const draftFile = { ...resource, id: '00000000-0000-4000-8000-000000000019', label: '项目原附件.txt', scope: draftScope };
const skillHash = 'a'.repeat(64);
const draftSkill: SkillView = {
  version: { skill_id: secondId, content_hash: skillHash, directory_name: 'release-note', name: 'release-note',
    description: '整理真实发布说明', metadata: {}, license: null, compatibility: null, allowed_tools: null, files: [],
    source: { kind: 'user_created', command_id: id, base_hash: null, resource_id: null, resource_version: null,
      source_version: null, run_id: null, task_id: null, activity_id: null, attempt_id: null }, scope: draftScope, dependencies: [] },
  binding: { id, skill_id: secondId, scope: draftScope, enabled: true, environment_id: null, environment_revision: null, revision: 1 },
  readiness: 'content_available',
};
const task = { id: run.root_task_id, version: 1, run_id: id, binding: { agent_work: null, input_artifacts: [], input_result: null, additional_result_inputs: [], file_inputs: {}, execution_session_id: run.execution_session_id, interaction_session_id: run.interaction_session_id, config: run.config, sources: run.sources, delegation_depth: 0 }, parent_task_id: null, origin_task_id: null, kind: 'agent',
  executor_id: 'builtin.agent', state: 'running', created_seq: 1, deadline_at: null, result_version: null, reason: null };
const question = { id: secondId, version: 1, run_id: id, task_id: task.id, call_id: 'ask', message_id: id,
  question: '请确认范围', answer_schema: { type: 'string' }, status: 'pending', answer_message_id: null, dependencies: [] };
const json = (value: unknown) => Response.json(value);
const modelUse = (eventId: string, sessionId: string, modelId: string) => ({
  event_id: eventId, session_id: sessionId, model_profile_id: modelId, reasoning_effort: null,
});
function server(active: 'agent' | 'tool' | 'follow_up' | null = null, questions = false) {
  const activeRun = active === 'follow_up' ? { ...run, kind: 'follow_up', allow_follow_up: true } : run;
  const requests: { path: string; method: string; body: any }[] = [];
  const workspace = { id, version: 1, name: '项目 A', directory_resource_id: null };
  vi.mocked(invoke).mockImplementation(async name => name === 'select_resources' ? { resources: [resource] } : undefined);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', ''), method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body as string) : null;
    if (path.endsWith('/resource-coverage')) return json({ allowed: true, destination: connection.endpoint, missing_read: [], missing_model_send: [] });
    requests.push({ path, method, body });
    if (method === 'POST') return json(path.endsWith('/steering') ? { message_id: id, run_id: id, version: 2 } : path.endsWith('/commands') ? pendingUserCommand : run);
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return json(page([]));
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path === '/navigation') return json({ default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session, otherSession]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path === `/sessions/${id}`) return json(session);
    if (path === `/sessions/${secondId}`) return json(otherSession);
    if (path.endsWith('/export-recovery')) return json([]);
    if (path.endsWith('/directory')) return json({ workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null });
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model, { ...model, id, model_id: 'another-model' }]), '/model-connections': page([connection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session, otherSession]), active_runs: page(active ? [activeRun] : []),
        pending_questions: page(questions ? [question] : []), pending_approvals: page([]), resources: page([resource]), grants: page([grant]), watermark: event.event_id },
      [`/sessions/${id}/messages`]: page([]), [`/sessions/${secondId}/messages`]: page([]),
      [`/sessions/${id}/runs`]: page(active ? [activeRun] : []), [`/sessions/${secondId}/runs`]: page([]),
      [`/runs/${id}`]: { ...runDetailSummary, run: activeRun, tasks: page([{ ...task, kind: active === 'tool' ? 'tool' : 'agent', executor_id: active === 'tool' ? 'builtin.tool' : 'builtin.agent' }]),
        activities: page([]), messages: page([]), artifacts: page([]), questions: page(questions ? [question] : []), approvals: page([]),
        waits: page([]), consumptions: page([]), joins: page([]), budget: { id: run.budget_id, run_id: id, version: 1, limits,
          spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id } };
    if (!(path in values)) throw new Error(`测试未定义 ${path}`);
    return json(values[path]);
  });
  return requests;
}

it.each([false, true])('发送会话草稿中固定的 Skill 版本和许可选择，排队=%s', async queued => {
  const requests = server(queued ? 'follow_up' : null);
  const drafts = createDraftStore(), key = { workspaceId: id, sessionId: id };
  const selected = { [secondId]: 'a'.repeat(64), [id]: 'b'.repeat(64) };
  const permissions = { [secondId]: id, [id]: null };
  const user = userEvent.setup();
  render(<Conversation client={client} draftStore={drafts} />);
  await screen.findByRole('heading', { name: session.title });
  act(() => { drafts.update(key, { skillVersions: selected, skillExecutionPermissions: permissions }); });
  await user.type(screen.getByLabelText('消息'), '用选定版本整理发布说明');
  await user.click(screen.getByRole('button', { name: queued ? '排队发送' : '发送' }));
  const path = `/sessions/${id}/${queued ? 'commands' : 'runs'}`;
  await waitFor(() => expect(requests.find(item => item.method === 'POST' && item.path === path)?.body.data.sources)
    .toMatchObject({ skill_versions: selected, skill_execution_permissions: permissions }));
  await waitFor(() => expect(drafts.read(key)).toMatchObject({ skillVersions: {}, skillExecutionPermissions: {} }));
});

it('切换同名模型连接后只发送新模型支持的强度，队列保留确切模型与档位', async () => {
  const requests = server('follow_up');
  const previous = globalThis.fetch;
  const relay = { ...connection, id, display_name: '备用连接', endpoint: 'https://alternative.invalid/v1' };
  const primary = { ...model, capabilities: { ...model.capabilities, reasoning_efforts: ['high'] } };
  const other = { ...primary, id, connection_id: relay.id, capabilities: { ...model.capabilities, reasoning_efforts: ['low'] } };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v3/models') return json(page([primary, other]));
    if (path === '/v3/model-connections') return json(page([connection, relay]));
    if (path === `/v3/models/${model.id}/resolved`) return json({ ...modelResolution, ...primary });
    if (path === `/v3/models/${id}/resolved`) return json({ ...modelResolution, ...other, endpoint: relay.endpoint });
    return previous(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  await user.click(await screen.findByRole('button', { name: '思考强度' }));
  await user.click(await screen.findByRole('menuitemradio', { name: '高' }));
  await selectComposerModel(user, other.id);
  await user.click(await screen.findByRole('button', { name: '思考强度' }));
  expect(screen.queryByRole('menuitemradio', { name: '高' })).toBeNull();
  await user.click(await screen.findByRole('menuitemradio', { name: '低' }));
  fireEvent.change(screen.getByLabelText('消息'), { target: { value: '排入新目标' } });
  await user.click(screen.getByRole('button', { name: '排队发送' }));
  await waitFor(() => expect(requests.find(item => item.method === 'POST' && item.path === `/sessions/${id}/commands`)?.body.data)
    .toMatchObject({ model_profile_id: other.id, reasoning_effort: 'low' }));
});

it('已存在会话恢复最近一轮人工发送的模型，自动总结不覆盖它', async () => {
  server();
  const previous = globalThis.fetch;
  const historicalRunId = '00000000-0000-4000-8000-000000000033';
  const humanRun = {
    ...run, id: historicalRunId, state: 'completed', config: {
      ...run.config, model_profile: { ...run.config.model_profile, id, model_id: 'another-model' },
    },
  };
  const followUpRun = { ...run, id: secondId, state: 'completed', kind: 'follow_up' };
  const earlierRun = { ...run, state: 'completed' };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    if (init.method !== 'POST' && parsed.pathname === `/v3/sessions/${id}/runs`) {
      return json({ ...page([earlierRun, followUpRun]), last_model_use: modelUse('9007199254740992', id, humanRun.config.model_profile.id) });
    }
    return previous(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), '继续之前的任务');
  const requests: Array<{ data: { model_profile_id: string } }> = [];
  const read = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST' && new URL(url).pathname === `/v3/sessions/${id}/runs`) {
      requests.push(JSON.parse(String(init.body)));
    }
    return read(url, init);
  });
  const send = screen.getByRole('button', { name: '发送' });
  await waitFor(() => expect(send).toHaveProperty('disabled', false));
  await user.click(send);
  await waitFor(() => expect(requests[0]?.data.model_profile_id).toBe(id));
});

it.each(['accepted', 'project-grant-already-covers', 'send-rejected', 'create-response-lost', 'create-timeout', 'grant-response-lost', 'send-response-lost', 'after-model-setup', 'changed-file-text-only'] as const)('项目首发保留附件、Skill 与原命令：%s', async mode => {
  server();
  const previous = globalThis.fetch;
  const firstSession = { ...otherSession, title: '新会话' };
  const chosenModel = { ...model, id, model_id: 'another-model', capabilities: { ...model.capabilities, reasoning_efforts: ['high'] } };
  const sessionPath = `/workspaces/${id}/sessions`;
  const sendPath = `/sessions/${firstSession.id}/runs`;
  const writes: { path: string; body: any }[] = [];
  let grantReceipt: Record<string, unknown> | undefined;
  let cancelPicker = true;
  let created = false;
  let configured = mode !== 'after-model-setup';
  const createUnconfirmed = mode === 'create-response-lost' || mode === 'create-timeout';
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name !== 'select_resources') return;
    expect(args).toEqual({ scope: draftScope, kind: 'file' });
    return { resources: cancelPicker ? [] : [draftFile] };
  });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path === '/capabilities/skills') return json(page([draftSkill]));
    if (path === '/capabilities/skill-exports') return json([]);
    if (path.endsWith('/file')) return json({ skill_id: secondId, content_hash: skillHash, path: 'SKILL.md',
      file_hash: skillHash, encoding: 'utf-8', content: '正文', start: 0, end: 2, total: 2 });
    if (path === '/capabilities/skills/resolve') {
      expect(JSON.parse(String(init.body))).toEqual({ scope: draftScope, versions: { [secondId]: skillHash } });
      return json({ versions: { [secondId]: skillHash }, dependencies: [],
        entries: [{ skill_id: secondId, content_hash: skillHash, name: 'release-note', description: '整理真实发布说明' }] });
    }
    if (path.endsWith('/resource-coverage')) {
      expect(path).toBe(`/sessions/${firstSession.id}/resource-coverage`);
      expect(JSON.parse(String(init.body))).toEqual({ resource_ids: [draftFile.id], model_profile_id: id });
      const allowed = !!grantReceipt || mode === 'project-grant-already-covers';
      const missing = allowed ? [] : [draftFile.id];
      return json({ allowed, destination: connection.endpoint, missing_read: missing, missing_model_send: missing });
    }
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      writes.push({ path, body });
      if (path === sessionPath) {
        created = true;
        if (mode === 'create-response-lost' && writes.length === 1) throw new TypeError('synthetic network loss');
        if (mode === 'create-timeout' && writes.length === 1) throw new DOMException('synthetic timeout', 'TimeoutError');
        return json(firstSession);
      }
      if (path === '/grants') {
        grantReceipt = { ...grant, ...body.data };
        if (mode === 'grant-response-lost') throw new TypeError('synthetic grant response loss');
        return json(grantReceipt);
      }
      if (path === sendPath) {
        if (writes.filter(write => write.path === sendPath).length === 1) {
          if (mode === 'send-rejected') {
            return Response.json({ error: { code: 'model_rejected', safe_message: '模型请求尚未接收', retryable: false, related_ids: [] } }, { status: 409 });
          }
          if (mode === 'send-response-lost') throw new TypeError('synthetic run response loss');
          if (mode === 'changed-file-text-only') return Response.json({ error: { code: 'file_source_changed',
            safe_message: '附件内容已改变', retryable: false, related_ids: [draftFile.id] } }, { status: 409 });
        }
        return json({ ...run, state: 'completed', interaction_session_id: firstSession.id, execution_session_id: firstSession.id });
      }
    }
    if (path.startsWith(`/sessions/${firstSession.id}/commands/`)) {
      const grantCommand = writes.find(write => write.path === '/grants');
      return json(path.endsWith(grantCommand?.body.meta.command_id)
        ? { status: 'confirmed', result: grantReceipt } : { status: 'not_found', result: null });
    }
    if (path === `/workspaces/${id}/grants`) return json(page(grantReceipt ? [grantReceipt] : []));
    if (path === '/profiles/default') return json({ ...agent, default_model_profile_id: model.id });
    if (path === '/models') return json(page(configured ? [model, chosenModel] : []));
    if (path === `/models/${id}/resolved`) return json({ ...modelResolution, ...chosenModel });
    if (path === `/workspaces/${id}/snapshot`) {
      const value = await (await previous(url, init)).json();
      return json({ ...value, sessions: page(created ? [firstSession] : []) });
    }
    return previous(url, init);
  });
  const drafts = createDraftStore();
  const user = userEvent.setup();
  render(<Conversation client={client} draftStore={drafts} />);
  await screen.findByRole('heading', { name: 'FlowMate' });
  const picker = screen.getByRole('button', { name: '选择文本文件' });
  await waitFor(() => expect(picker).toHaveProperty('disabled', false));
  await user.click(picker);
  expect(screen.queryByRole('list', { name: '本次附件' })).toBeNull();
  expect(drafts.read({ workspaceId: id, sessionId: '' }).revision).toBe(0);
  cancelPicker = false;
  await user.click(picker);
  await screen.findByRole('button', { name: `移除附件「${draftFile.label}」` });
  expect(screen.queryByRole('button', { name: /授权读取并发送|当前范围已授权/ })).toBeNull();
  expect(screen.getByRole('button', { name: '选择目录' })).toHaveProperty('disabled', true);
  const skills = screen.getByRole('button', { name: '选择 Skill' });
  await user.click(skills);
  await user.click(await screen.findByRole('button', { name: '返回对话与草稿' }));
  await waitFor(() => expect(document.activeElement).toBe(skills));
  await user.click(skills);
  await user.click(await screen.findByRole('button', { name: '用于本次草稿' }));
  await screen.findByRole('button', { name: '移除 Skill release-note' });
  expect(document.activeElement).toBe(skills);
  if (!configured) {
    await screen.findByRole('button', { name: '配置模型' });
    fireEvent.change(screen.getByLabelText('消息'), { target: { value: '第一次在这个项目发送' } });
    expect(screen.getByRole('button', { name: '发送' })).toHaveProperty('disabled', true);
    fireEvent.submit(screen.getByLabelText('消息').closest('form')!);
    expect(writes).toEqual([]);
    configured = true;
    await act(async () => window.dispatchEvent(new Event('flowmate:settings-changed')));
    expect(screen.getByLabelText('消息')).toHaveProperty('value', '第一次在这个项目发送');
    expect(screen.getByRole('button', { name: `移除附件「${draftFile.label}」` })).toBeTruthy();
    expect(screen.getByRole('button', { name: '移除 Skill release-note' })).toBeTruthy();
  }
  await selectComposerModel(user, id);
  const effort = await screen.findByRole('button', { name: '思考强度' });
  await user.click(effort);
  await user.click(await screen.findByRole('menuitemradio', { name: '高' }));
  if (mode !== 'after-model-setup') fireEvent.change(screen.getByLabelText('消息'), { target: { value: '第一次在这个项目发送' } });
  expect(writes).toEqual([]);
  const submit = async () => {
    const button = await screen.findByRole('button', { name: '发送' });
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    await user.click(button);
  };
  await submit();
  if (mode === 'send-response-lost') {
    await screen.findByText('提交状态待确认');
    await user.click(screen.getByRole('button', { name: '核对提交状态' }));
    await user.click(await screen.findByRole('button', { name: '使用原命令重试' }));
  } else if (createUnconfirmed) {
    await screen.findByText('提交状态待确认');
    expect(screen.getByRole('button', { name: '发送' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('消息'), { target: { value: '后来录入的新目标' } });
    await user.click(screen.getByRole('button', { name: '使用原命令重试' }));
  } else if (mode === 'grant-response-lost') {
    await screen.findByText('提交状态待确认');
    expect(writes.map(write => write.path)).toEqual([sessionPath, '/grants']);
    await user.click(screen.getByRole('button', { name: '核对提交状态' }));
  } else if (mode === 'changed-file-text-only') {
    const decision = await screen.findByRole('region', { name: '处理会话文件' });
    expect(within(decision).getByText(draftFile.label)).toBeTruthy();
    await user.click(within(decision).getByRole('button', { name: '仅发送本条文字' }));
  } else if (mode === 'send-rejected') {
    await screen.findByRole('heading', { name: firstSession.title });
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(screen.getByLabelText('消息')).toHaveProperty('value', '第一次在这个项目发送');
    await submit();
  }
  const starts = () => writes.filter(write => write.path === sendPath);
  await waitFor(() => expect(starts()).toHaveLength(['send-rejected', 'send-response-lost', 'changed-file-text-only'].includes(mode) ? 2 : 1));
  expect(starts().map(write => write.body.data)).toEqual(starts().map((_, index) => expect.objectContaining({
    text: '第一次在这个项目发送', model_profile_id: id, reasoning_effort: 'high', agent_profile_id: firstSession.agent_profile_id,
    model_selection: { model_version: chosenModel.version, connection_id: connection.id, connection_version: connection.version },
    ...(mode === 'changed-file-text-only' && index === 1
      ? { inherit_session_files: false, sources: expect.objectContaining({ resource_ids: [], skill_versions: {} }) }
      : { sources: expect.objectContaining({ resource_ids: [draftFile.id], skill_versions: { [secondId]: skillHash } }) }),
  })));
  const creates = writes.filter(write => write.path === sessionPath);
  expect(creates).toHaveLength(createUnconfirmed ? 2 : 1);
  if (createUnconfirmed) expect(creates[1].body.meta.command_id).toBe(creates[0].body.meta.command_id);
  if (mode === 'send-response-lost') expect(starts()[1].body).toEqual(starts()[0].body);
  const grants = writes.filter(write => write.path === '/grants');
  expect(grants).toHaveLength(1);
  expect(grants[0].body.data).toMatchObject({ scope: { kind: 'session', workspace_id: id, session_id: firstSession.id },
    resource_ids: [draftFile.id], destination: connection.endpoint, purposes: ['read', 'model_send'] });
  await waitFor(() => expect(drafts.read({ workspaceId: id, sessionId: firstSession.id }).text)
    .toBe(createUnconfirmed ? '后来录入的新目标' : ''));
});

it.each(['text', 'recipient', 'replacement', 'adopt-pin', 'adopt-pin-changed'] as const)('会话文件接纳拒绝后，明确决定才重新发送：%s', async choice => {
  server();
  const previous = globalThis.fetch;
  const commands: { path: string; body: any }[] = [];
  let authorized: string[] = [];
  let picked = false;
  const visiblePin = 'b'.repeat(64);
  const adoptPin = choice === 'adopt-pin' || choice === 'adopt-pin-changed';
  const oldRun = { ...run, state: 'completed', attached_file_ids: [resource.id],
    file_inputs: { [resource.id]: { source_version: visiblePin, file_identity: 'c'.repeat(64) } } };
  const replacement = { ...resource, id: draftFile.id, label: '最新版.txt' };
  vi.mocked(invoke).mockImplementation(async name => name === 'select_resources'
    ? { resources: picked ? [replacement] : [] } : undefined);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (adoptPin && path === `/sessions/${id}/messages`) return json(page([{
      id, run_id: run.id, role: 'user', origin: 'conversation', event_id: '1', event_index: 0, activity_id: null,
      private_ref: null, source_dependencies: [], parts: [{ kind: 'text', text: '原文件目标' }],
      attachments: [{ resource_id: resource.id, name: resource.label, resource_lineage: [resource.id], read_grant_ids: [grant.id] }],
    }]));
    if (adoptPin && path === `/sessions/${id}/runs` && init.method !== 'POST') return json(page([oldRun]));
    if (adoptPin && path === `/workspaces/${id}/snapshot`) {
      const snapshot = await (await previous(url, init)).json();
      return json({ ...snapshot, resources: page([{ ...resource, source_version: 'd'.repeat(64) }]) });
    }
    if (path.endsWith('/resource-coverage')) {
      const ids: string[] = JSON.parse(String(init.body)).resource_ids;
      const missing = ids.filter(id => !authorized.includes(id));
      return json({ allowed: !missing.length, destination: connection.endpoint, missing_read: missing, missing_model_send: missing });
    }
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      commands.push({ path, body });
      if (path === '/grants') {
        authorized = body.data.resource_ids;
        return json({ ...grant, ...body.data });
      }
      if (commands.length === 1) return Response.json({ error: {
        code: choice === 'replacement' ? 'file_source_changed' : 'session_file_recipient_changed',
        safe_message: '会话文件需要处理', retryable: false, related_ids: [resource.id],
      } }, { status: 409 });
      if (choice === 'adopt-pin-changed' && body.data.session_file_adoptions) return Response.json({ error: {
        code: 'file_source_changed', safe_message: '原版本已改变', retryable: false, related_ids: [resource.id],
      } }, { status: 409 });
      return json({ ...run, state: 'completed' });
    }
    if (path === `/workspaces/${id}/grants`) return json(page([]));
    return previous(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), '继续整理会话文件');
  const send = screen.getByRole('button', { name: '发送' });
  await waitFor(() => expect(send).toHaveProperty('disabled', false));
  await user.click(send);
  const panel = await screen.findByRole('region', { name: '处理会话文件' });
  if (!adoptPin) expect(within(panel).queryByText(resource.label)).toBeNull();
  expect(commands).toHaveLength(1);
  expect(commands[0].body.data).not.toHaveProperty('inherit_session_files');
  expect(send).toHaveProperty('disabled', true);
  if (choice === 'text') {
    await user.click(within(panel).getByRole('button', { name: '仅发送本条文字' }));
  } else if (adoptPin) {
    expect(within(panel).getByText(visiblePin.slice(0, 12), { exact: false })).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: '向此接收方使用原文件版本' }));
    await waitFor(() => expect(commands.at(-1)?.body.data).toMatchObject({
      inherit_session_files: false, session_file_adoptions: { [resource.id]: visiblePin },
      sources: { resource_ids: [resource.id] },
      model_selection: { model_version: model.version, connection_id: connection.id, connection_version: connection.version },
    }));
    if (choice === 'adopt-pin-changed') {
      expect(await within(panel).findByRole('button', { name: '重新选择以使用新版' })).toBeTruthy();
      expect(screen.getByLabelText('消息')).toHaveProperty('value', '继续整理会话文件');
      return;
    }
  } else {
    if (choice === 'recipient') expect(within(panel).getByText(connection.endpoint, { exact: false })).toBeTruthy();
    const reselect = within(panel).getByRole('button', { name: choice === 'recipient' ? '重新选择要发送的文件' : '重新选择以使用新版' });
    await user.click(reselect);
    expect(panel.isConnected).toBe(true);
    expect(commands).toHaveLength(1);
    picked = true;
    await user.click(reselect);
    await screen.findByRole('button', { name: `移除附件「${replacement.label}」` });
    expect(commands).toHaveLength(1);
    await waitFor(() => expect(send).toHaveProperty('disabled', false));
    await user.click(send);
  }
  await waitFor(() => expect(screen.getByLabelText('消息')).toHaveProperty('value', ''));
  const final = commands.at(-1)!.body.data;
  expect(final.text).toBe('继续整理会话文件');
  expect(commands.map(item => item.path)).toEqual(choice === 'text'
    ? [`/sessions/${id}/runs`, `/sessions/${id}/runs`]
    : [`/sessions/${id}/runs`, '/grants', `/sessions/${id}/runs`]);
  const ids = choice === 'text' ? [] : [adoptPin ? resource.id : replacement.id];
  expect(final.sources.resource_ids).toEqual(ids);
  if (choice === 'text') expect(final.inherit_session_files).toBe(false);
  else expect(commands[1].body.data).toMatchObject({ resource_ids: ids, destination: connection.endpoint,
    scope: { kind: 'session', workspace_id: id, session_id: id } });
  if (choice !== 'text' && !adoptPin) expect(final.sources.excluded_source_ids).toEqual([resource.id]);
});

it('已接纳的续读发现原文件已变，输入框就近提供选择新版与仅发送文字', async () => {
  server();
  const previous = globalThis.fetch;
  const readId = '00000000-0000-4000-8000-000000000092';
  const resultId = '00000000-0000-4000-8000-000000000093';
  const messages = [
    { id: readId, run_id: run.id, role: 'assistant', origin: 'conversation', event_id: '1', event_index: 0,
      activity_id: null, private_ref: null, source_dependencies: [],
      parts: [{ kind: 'tool_call', name: 'files.read_text', call_id: 'read', arguments: { resource_id: resource.id } }] },
    { id: resultId, run_id: run.id, role: 'tool', origin: 'conversation', event_id: '2', event_index: 0,
      activity_id: null, private_ref: null, source_dependencies: [],
      parts: [{ kind: 'tool_result', call_id: 'read', origin_message_id: readId, error: 'file_source_changed', result: null }] },
  ];
  const sent: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === `/v3/sessions/${id}/messages`) return json(page(messages));
    if (path === `/v3/sessions/${id}/runs`) {
      if (init.method !== 'POST') return json(page([{ ...run, state: 'completed' }]));
      sent.push(JSON.parse(String(init.body)));
      return json({ ...run, id: secondId, state: 'completed' });
    }
    if (path === `/v3/runs/${secondId}`) {
      return json({ ...await (await previous(url.replace(secondId, id), init)).json(), run: { ...run, id: secondId, state: 'completed' } });
    }
    if (path.endsWith('/run-feedback')) return json(page([]));
    return previous(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  const panel = await screen.findByRole('region', { name: '处理会话文件' });
  expect(within(panel).getByRole('button', { name: '重新选择以使用新版' })).toBeTruthy();
  expect(within(panel).queryByText(resource.label)).toBeNull();
  await user.type(screen.getByLabelText('消息'), '这是下一条文字');
  await user.click(within(panel).getByRole('button', { name: '仅发送本条文字' }));
  await waitFor(() => expect(sent[0]?.data).toMatchObject({ text: '这是下一条文字',
    inherit_session_files: false, sources: { resource_ids: [] } }));
  await waitFor(() => expect(screen.queryByRole('region', { name: '处理会话文件' })).toBeNull());
});

it('当前连接被移除后保留同名模型原选择和输入，阻止直接发送到另一条连接', async () => {
  const requests = server();
  const previous = globalThis.fetch;
  const otherConnection = { ...connection, id, display_name: '备用连接', endpoint: 'https://alternative.invalid/v1' };
  const sameNameModel = { ...model, id, connection_id: otherConnection.id };
  let removed = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v3/models') return json(page([model, sameNameModel]));
    if (path === '/v3/model-connections') return json(page(removed ? [otherConnection] : [connection, otherConnection]));
    return previous(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), '保留现有输入');
  const submit = screen.getByRole('button', { name: '发送' });
  await waitFor(() => expect(submit).toHaveProperty('disabled', false));
  removed = true;
  await act(async () => window.dispatchEvent(new Event('flowmate:settings-changed')));
  await waitFor(() => expect(submit).toHaveProperty('disabled', true));
  fireEvent.submit(screen.getByLabelText('消息').closest('form')!);
  expect(requests.filter(request => request.method === 'POST')).toEqual([]);
  expect(screen.getByLabelText('消息')).toHaveProperty('value', '保留现有输入');
  await selectComposerModel(user, sameNameModel.id);
  await user.click(submit);
  expect(requests.find(request => request.method === 'POST')?.body.data.model_profile_id).toBe(sameNameModel.id);
});

it('连接被重新配置后重试待确认的原命令时，仍发送原连接和模型版本', async () => {
  server();
  const previous = globalThis.fetch;
  const changedConnection = { ...connection, version: 2, endpoint: 'https://replacement.invalid/v1' };
  const bodies: unknown[] = [];
  let reconfigured = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v3/model-connections') return json(page([reconfigured ? changedConnection : connection]));
    if (path.includes('/commands/')) return json({ status: 'not_found', result: null });
    if (init.method === 'POST' && path === `/v3/sessions/${id}/runs`) {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) throw new TypeError('synthetic transport error before dispatch');
      return Response.json({ error: { code: 'version_conflict', safe_message: '模型连接已改变', retryable: false, related_ids: [] } }, { status: 409 });
    }
    return previous(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  const input = screen.getByLabelText('消息');
  fireEvent.change(input, { target: { value: '不要改用新地址' } });
  await user.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText('提交状态待确认');
  reconfigured = true;
  await act(async () => window.dispatchEvent(new Event('flowmate:settings-changed')));
  await user.click(screen.getByRole('button', { name: '核对提交状态' }));
  await user.click(await screen.findByRole('button', { name: '使用原命令重试' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]).toMatchObject({ data: { model_profile_id: model.id, model_selection: {
    model_version: model.version, connection_id: connection.id, connection_version: connection.version,
  } } });
  expect(input).toHaveProperty('value', '不要改用新地址');
});

it.each([null, model.id])('快捷小窗的新会话使用固定模型或主窗实际接纳的项目模型：%s', async pinned => {
  server();
  const previous = globalThis.fetch;
  let lastDispatched: ReturnType<typeof modelUse> | undefined;
  const started: Array<{ path: string; modelId: string }> = [];
  let quick = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (quick && path === '/v3/profiles') return json(page([{ ...agent, default_model_profile_id: pinned }]));
    if (quick && path === `/v3/workspaces/${id}/snapshot`) {
      return json({ ...await (await previous(url, init)).json(), sessions: page([otherSession]),
        recent_model_uses: lastDispatched ? [lastDispatched] : [] });
    }
    if (init.method === 'POST' && path.endsWith('/runs')) {
      const modelId = JSON.parse(String(init.body)).data.model_profile_id;
      started.push({ path, modelId });
      if (!quick) lastDispatched = modelUse(event.event_id, id, modelId);
      return json({ ...run, state: 'completed' });
    }
    return previous(url, init);
  });
  const user = userEvent.setup();
  const main = render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await selectComposerModel(user, id);
  await user.type(screen.getByLabelText('消息'), '确认后记住本次发送的真实模型 ID');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(screen.getByLabelText('消息')).toHaveProperty('value', ''));
  await selectComposerModel(user, model.id);
  main.unmount();
  quick = true;
  render(<Conversation client={client} compact />);
  await screen.findByRole('heading', { name: otherSession.title });
  await expectComposerModel(user, pinned ?? id);
  fireEvent.change(screen.getByLabelText('消息'), { target: { value: '窗口冷开后的消息' } });
  await user.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(started[1]).toEqual({ path: `/v3/sessions/${secondId}/runs`, modelId: pinned ?? id }));
});

it('返回项目恢复本窗未建会话草稿，显式选择另一窗创建的会话后才离开草稿', async () => {
  server();
  const previous = globalThis.fetch;
  const workspaceA = { id, version: 1, name: '项目 A', directory_resource_id: null };
  const workspaceB = { ...workspaceA, id: secondId, name: '项目 B' };
  let createdElsewhere = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v3/profiles/default') return json({ ...agent, default_model_profile_id: model.id });
    if (path === '/v3/workspaces') return json(page([workspaceA, workspaceB]));
    if (path === '/v3/navigation') return json({
      default_workspace_id: id, workspaces: page([
        { workspace: workspaceA, sessions: page(createdElsewhere ? [session] : []), pending_count: 0 },
        { workspace: workspaceB, sessions: page([]), pending_count: 0 },
      ]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id,
    });
    if (path === `/v3/workspaces/${id}/snapshot` || path === `/v3/workspaces/${secondId}/snapshot`) {
      const value = await (await previous(url.replace(`/workspaces/${secondId}/snapshot`, `/workspaces/${id}/snapshot`), init)).json();
      return json({ ...value, workspace: path.includes(secondId) ? workspaceB : workspaceA,
        sessions: page(path.includes(secondId) || !createdElsewhere ? [] : [session]) });
    }
    return previous(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: 'FlowMate' });
  await selectComposerModel(user, id);
  fireEvent.change(screen.getByLabelText('消息'), { target: { value: '主窗口项目草稿' } });
  await user.click(screen.getByRole('button', { name: '项目 B' }));
  await waitFor(() => expect(screen.getByLabelText('消息')).toHaveProperty('value', ''));
  createdElsewhere = true;
  await user.click(screen.getByRole('button', { name: '项目 A' }));
  await waitFor(() => expect(screen.getByLabelText('消息')).toHaveProperty('value', '主窗口项目草稿'));
  await expectComposerModel(user, id);
  await user.click(await screen.findByRole('button', { name: session.title }));
  await screen.findByRole('heading', { name: session.title });
  expect(screen.getByLabelText('消息')).toHaveProperty('value', '');
});

it('主窗发送更新项目偏好时，快捷窗正在写的草稿保留原接收模型', async () => {
  server();
  const previous = globalThis.fetch;
  let lastDispatched: ReturnType<typeof modelUse> | undefined;
  const streams: Array<ReadableStreamDefaultController<Uint8Array>> = [];
  let quick = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (quick && path === '/v3/profiles') return json(page([agent]));
    if (quick && path === `/v3/workspaces/${id}/snapshot`) {
      return json({ ...await (await previous(url, init)).json(), sessions: page([otherSession]),
        recent_model_uses: lastDispatched ? [lastDispatched] : [] });
    }
    if (path.endsWith('/events')) return new Response(new ReadableStream({ start(controller) { streams.push(controller); } }));
    if (init.method === 'POST' && path === `/v3/sessions/${id}/runs`) {
      lastDispatched = modelUse((BigInt(event.event_id) + 1n).toString(), id, JSON.parse(String(init.body)).data.model_profile_id);
      return json({ ...run, state: 'completed' });
    }
    return previous(url, init);
  });
  const user = userEvent.setup();
  const main = render(<Conversation client={client} />);
  const mainWindow = within(main.container);
  const mainInput = main.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  await mainWindow.findByRole('heading', { name: session.title });
  fireEvent.change(mainInput, { target: { value: '第一次使用默认模型' } });
  await user.click(mainWindow.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(mainInput.value).toBe(''));
  quick = true;
  const small = render(<Conversation client={client} compact />);
  const smallWindow = within(small.container);
  const quickInput = small.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  await smallWindow.findByRole('heading', { name: otherSession.title });
  await expectComposerModel(user, model.id, smallWindow);
  fireEvent.change(quickInput, { target: { value: '保留快捷窗草稿原模型' } });
  await selectComposerModel(user, id, mainWindow);
  fireEvent.change(mainInput, { target: { value: '这次主窗换了模型' } });
  await user.click(mainWindow.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(mainInput.value).toBe(''));
  const change = { kind: 'durable', event_id: lastDispatched!.event_id, event: {
    ...event, kind: 'activity.dispatched', event_id: lastDispatched!.event_id, payload: { ...event.payload, chat_model_use: lastDispatched },
  } };
  await act(async () => { for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(change)}\n\n`)); });
  await expectComposerModel(user, model.id, smallWindow);
  expect(quickInput.value).toBe('保留快捷窗草稿原模型');
});

it('两窗按持久人工运行顺序更新最近使用，迟到的旧运行回执保持原顺序', async () => {
  server();
  const previous = globalThis.fetch;
  const streams: Array<ReadableStreamDefaultController<Uint8Array>> = [];
  const laterRun = {
    ...run, id: secondId, state: 'completed' as const, interaction_session_id: secondId, execution_session_id: secondId,
  };
  const earlierRun = { ...run, state: 'completed' as const, config: {
    ...run.config, model_profile: { ...run.config.model_profile, id, model_id: 'another-model' },
  } };
  let releaseEarlier!: (value: Response) => void;
  const earlierResponse = new Promise<Response>(resolve => { releaseEarlier = resolve; });
  let sentEarlier = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/events')) return new Response(new ReadableStream({ start(controller) { streams.push(controller); } }));
    if (init.method === 'POST' && path === `/v3/sessions/${id}/runs`) { sentEarlier = true; return earlierResponse; }
    if (init.method === 'POST' && path === `/v3/sessions/${secondId}/runs`) return json(laterRun);
    if (path === `/v3/runs/${secondId}`) return json({ ...await (await previous(url.replace(secondId, id), init)).json(), run: laterRun });
    return previous(url, init);
  });
  const main = render(<Conversation client={client} />);
  const small = render(<Conversation compact client={client} />);
  const mainWindow = within(main.container);
  const smallWindow = within(small.container);
  const mainInput = main.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  const quickInput = small.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  const user = userEvent.setup();
  await mainWindow.findByRole('heading', { name: session.title });
  await smallWindow.findByRole('heading', { name: session.title });
  await user.click(smallWindow.getByRole('button', { name: '打开项目导航' }));
  await user.click(await screen.findByRole('dialog', { name: '项目导航' })
    .then(dialog => within(dialog).findByRole('button', { name: otherSession.title })));
  await smallWindow.findByRole('heading', { name: otherSession.title });
  await selectComposerModel(user, id, mainWindow);
  fireEvent.change(mainInput, { target: { value: '较早的发送' } });
  await user.click(mainWindow.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(sentEarlier).toBe(true));
  fireEvent.change(quickInput, { target: { value: '较晚的发送' } });
  await user.click(smallWindow.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(quickInput.value).toBe(''));
  await act(async () => {
    for (const [offset, accepted] of [[1, earlierRun], [2, laterRun]] as const) {
      const position = (BigInt(event.event_id) + BigInt(offset)).toString();
      const durable = { kind: 'durable', event_id: position, event: { ...event, kind: 'activity.dispatched', event_id: position, run_id: accepted.id,
        session_id: accepted.interaction_session_id, payload: { ...event.payload, runs: [accepted],
          chat_model_use: modelUse(position, accepted.interaction_session_id!, accepted.config.model_profile.id),
          tasks: [{ ...task, run_id: accepted.id }] } } };
      for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(durable)}\n\n`));
    }
    releaseEarlier(json(earlierRun));
  });
  await waitFor(() => expect(mainInput.value).toBe(''));
  for (const view of [mainWindow, smallWindow]) {
    await user.click(view.getByRole('button', { name: '选择模型' }));
    const recent = await screen.findByRole('group', { name: '最近使用' });
    await waitFor(() => expect(within(recent).getAllByRole('option').map(option => option.dataset.modelId)).toEqual([model.id, id]));
    await user.keyboard('{Escape}');
  }
});

it.each([false, true])('断线期间保留草稿，重连恢复 Runtime 派发记录，快照重置=%s', async reset => {
  const requests = server();
  const previous = globalThis.fetch;
  const position = (BigInt(event.event_id) + 1n).toString();
  const dispatched = modelUse(position, id, id);
  let firstStream!: ReadableStreamDefaultController<Uint8Array>;
  const cursors: string[] = [];
  let refresh = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/events')) {
      cursors.push(parsed.searchParams.get('after')!);
      if (cursors.length === 1) {
        return new Response(new ReadableStream({ start(controller) { firstStream = controller; } }));
      }
      if (reset && !refresh) { refresh = true; return new Response(null, { status: 410 }); }
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        if (!reset) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
          kind: 'durable', event_id: position, event: { ...event, kind: 'activity.dispatched', event_id: position,
            payload: { ...event.payload, runs: [], chat_model_use: dispatched } },
        })}\n\n`));
      } }));
    }
    if (refresh && parsed.pathname.endsWith('/snapshot')) {
      const snapshot = await (await previous(url, init)).json();
      return json({ ...snapshot, watermark: position, recent_model_uses: [dispatched] });
    }
    if (refresh && init.method !== 'POST' && parsed.pathname === `/v3/sessions/${id}/runs`) {
      return json({ ...page([]), last_model_use: dispatched });
    }
    return previous(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await screen.findByText('本机事件流已连接');
  const input = screen.getByLabelText('消息');
  await act(async () => firstStream.close());
  await screen.findByText(/事件流断开/);
  fireEvent.change(input, { target: { value: '离线期间保留' } });
  expect(input).toHaveProperty('value', '离线期间保留');
  await screen.findByText('本机事件流已连接', undefined, { timeout: 3000 });
  await user.click(screen.getByRole('button', { name: '选择模型' }));
  const recent = await screen.findByRole('group', { name: '最近使用' });
  expect(within(recent).getByRole('option').dataset.modelId).toBe(id);
  await user.keyboard('{Escape}');
  expect(input).toHaveProperty('value', '离线期间保留');
  expect(cursors).toEqual(reset ? [event.event_id, event.event_id, position] : [event.event_id, event.event_id]);
  const target = screen.getByRole('button', { name: '发送' });
  await waitFor(() => expect(target).toHaveProperty('disabled', false));
  await user.click(target);
  // 草稿在断线前锁定了原接收方，重放只更新最近使用记录。
  expect(requests.find(request => request.method === 'POST')?.body.data.model_profile_id).toBe(model.id);
});

it('待办收起/重开保留回答，后台到达不抢普通草稿焦点；composer 独立于消息滚动区', async () => {
  server('agent', true); const user = userEvent.setup(); render(<Conversation client={client} />);
  await user.type(await screen.findByLabelText('回答'), '暂存答案');
  await user.click(screen.getByRole('button', { name: '收起待办' }));
  await user.type(screen.getByLabelText('消息'), '普通草稿');
  expect(document.activeElement).toBe(screen.getByLabelText('消息'));
  await user.click(screen.getByRole('button', { name: '展开待办' }));
  expect((screen.getByLabelText('回答') as HTMLTextAreaElement).value).toBe('暂存答案');
  expect(screen.getByRole('region', { name: '持久对话' }).contains(screen.getByLabelText('消息'))).toBe(false);
  expect(document.querySelector('.composer-wrap .interaction-panel')).toBeTruthy();
});
it('quick 从待办定位可直接回答，不在小窗展开复杂任务图或强制打开主窗', async () => {
  server('agent', true); const user = userEvent.setup(); render(<Conversation client={client} compact />);
  await user.click(await screen.findByRole('button', { name: '回答问题' }));
  expect(screen.getByLabelText('回答')).toBeTruthy(); expect(document.querySelector('.task-graph')).toBeNull();
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'show_workbench')).toBe(false);
});

it('A 提交期间编辑新 B、切换会话往返恢复文字/附件/模型，旧响应不清新输入', async () => {
  server(); const previous = globalThis.fetch;
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => init.method === 'POST' && new URL(url).pathname.endsWith('/runs')
    ? new Promise<Response>(resolve => { finish = resolve; }) : previous(url, init));
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await selectComposerModel(user, id);
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await user.type(screen.getByLabelText('消息'), 'A');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await user.clear(screen.getByLabelText('消息')); await user.type(screen.getByLabelText('消息'), '新 B');
  await user.click(screen.getByRole('button', { name: otherSession.title }));
  await user.type(screen.getByLabelText('消息'), '另一个会话草稿');
  await act(async () => { finish(json({ ...run, state: 'completed' })); });
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('另一个会话草稿');
  await user.click(screen.getByRole('button', { name: session.title }));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('新 B');
  await expectComposerModel(user, id);
  expect(screen.getByText(resource.label)).toBeTruthy();
});

it('跨项目返回恢复草稿 ID；附件尚未同步齐不能把已加载子集显示为全部已授权', async () => {
  server(); const previous = globalThis.fetch;
  const extra = { ...resource, id: '00000000-0000-4000-8000-000000000015', label: '尾页资料' };
  vi.mocked(invoke).mockResolvedValue({ resources: [resource, extra] });
  const other = { id: secondId, version: 1, name: '项目 B', directory_resource_id: null };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v3/workspaces') return json(page([{ id, version: 1, name: '项目 A', directory_resource_id: null }, other]));
    if (path === '/v3/navigation') return json({ default_workspace_id: id, workspaces: page([{ workspace: { id, version: 1, name: '项目 A', directory_resource_id: null }, sessions: page([session]), pending_count: 0 }, { workspace: other, sessions: page([{ ...otherSession, workspace_id: secondId }]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path === `/v3/workspaces/${secondId}/snapshot`) return json({ workspace: other, sessions: page([{ ...otherSession, workspace_id: secondId }]),
      active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id });
    if (path === `/v3/workspaces/${id}/snapshot`) {
      const value = await (await previous(url, init)).json();
      return json({ ...value, sessions: page([session]), resources: { ...page([resource]), next_cursor: 'remaining-resources' } });
    }
    return previous(url, init);
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), '项目 A 草稿'); await selectComposerModel(user, id);
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await user.click(screen.getByRole('button', { name: '项目 B' }));
  await screen.findByRole('heading', { name: otherSession.title }); await user.type(screen.getByLabelText('消息'), '项目 B 草稿');
  await user.click(screen.getByRole('button', { name: '项目 A' }));
  await screen.findByRole('heading', { name: session.title });
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('项目 A 草稿');
  await expectComposerModel(user, id);
  expect(screen.getByRole('button', { name: '移除附件「附件 2（正在同步）」' })).toBeTruthy();
  expect(screen.queryByText(extra.id, { exact: false })).toBeNull();
  expect(screen.queryByRole('button', { name: '当前范围已授权' })).toBeNull();
  expect(screen.getByText(/资料与授权同步中/)).toBeTruthy();
});

it('POST 成功 GET 失败显示已提交详情同步中，显式重试只 GET，不再次创建 Run', async () => {
  const requests = server(); const previous = globalThis.fetch; let fail = true;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (new URL(url).pathname === `/v3/runs/${id}` && fail) throw new TypeError('offline');
    return previous(url, init);
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), 'A'); await user.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText('已提交，详情同步中');
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('');
  fail = false; await user.click(screen.getByRole('button', { name: '重试状态同步' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重试状态同步' })).toBeNull());
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
});

it('提交响应丢失保留命令身份，not_found 仍待确认；显式原命令重试不清后来编辑的 B', async () => {
  server(); const previous = globalThis.fetch; const bodies: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') { bodies.push(JSON.parse(init.body as string)); if (bodies.length === 1) throw new TypeError('lost'); return json(run); }
    if (url.includes('/commands/')) return json({ status: 'not_found', result: null });
    return previous(url, init);
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), 'A'); await user.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText('提交状态待确认');
  await user.clear(screen.getByLabelText('消息')); await user.type(screen.getByLabelText('消息'), 'B');
  await user.click(screen.getByRole('button', { name: '核对提交状态' }));
  await screen.findByText(/未查到记录，不证明未提交/);
  await user.click(screen.getByRole('button', { name: '使用原命令重试' }));
  await waitFor(() => expect(bodies).toHaveLength(2)); expect(bodies[1]).toEqual(bodies[0]);
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('B');
});

it.each(['late', 'grant-check', 'run-check', 'run-retry'] as const)(
  '附件发送链固定 A 的归属，切至相同 revision 的 B 后迟到或核对只清 A：%s', async mode => {
    server(); const previous = globalThis.fetch;
    const writes: { path: string; body: any }[] = [], checks: string[] = [], coverageSessions: string[] = [];
    let releaseGrant!: (response: Response) => void;
    const grantResponse = new Promise<Response>(resolve => { releaseGrant = resolve; });
    let grantBody: any;
    let savedRunCommand: any;
    const created = { ...run, state: 'completed' as const };
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname.replace('/v3', '');
      if (path.endsWith('/resource-coverage')) {
        coverageSessions.push(path);
        expect(JSON.parse(String(init.body))).toEqual({ resource_ids: [resource.id], model_profile_id: model.id });
        return json({ allowed: !!grantBody, destination: connection.endpoint,
          missing_read: grantBody ? [] : [resource.id], missing_model_send: grantBody ? [] : [resource.id] });
      }
      if (init.method === 'POST') {
        const body = JSON.parse(String(init.body)); writes.push({ path, body });
        if (path === '/grants') {
          grantBody = body;
          if (mode === 'grant-check') throw new TypeError('synthetic lost grant receipt');
          return grantResponse;
        }
        if (path === `/sessions/${id}/runs`) {
          savedRunCommand = body;
          if (mode === 'run-check' || mode === 'run-retry' && writes.filter(item => item.path === path).length === 1) {
            throw new TypeError('synthetic lost run receipt');
          }
          return json(created);
        }
      }
      if (path.includes('/commands/')) {
        checks.push(path);
        const isGrant = path.endsWith(grantBody.meta.command_id);
        return json(mode === 'run-retry' && !isGrant ? { status: 'not_found', result: null }
          : { status: 'confirmed', result: isGrant ? { ...grant, ...grantBody.data } : created });
      }
      if (path === `/workspaces/${id}/grants`) return json(page(grantBody ? [{ ...grant, ...grantBody.data }] : []));
      if (path === `/workspaces/${id}/snapshot`) {
        const snapshot = await (await previous(url, init)).json();
        return json({ ...snapshot, grants: page([]) });
      }
      return previous(url, init);
    });
    const drafts = createDraftStore(), a = { workspaceId: id, sessionId: id }, b = { workspaceId: id, sessionId: secondId };
    const user = userEvent.setup(); render(<Conversation client={client} draftStore={drafts} />);
    await screen.findByRole('heading', { name: session.title });
    await user.click(screen.getByRole('button', { name: '选择文本文件' }));
    fireEvent.change(screen.getByLabelText('消息'), { target: { value: 'A 的附件目标' } });
    const submitted = drafts.read(a);
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: otherSession.title }));
    await screen.findByRole('heading', { name: otherSession.title });
    fireEvent.change(screen.getByLabelText('消息'), { target: { value: 'B 的未提交草稿' } });
    act(() => {
      while (drafts.read(b).revision < submitted.revision) drafts.update(b, { text: 'B 的未提交草稿' });
    });
    expect(drafts.read(b).revision).toBe(submitted.revision);
    if (mode === 'grant-check') await user.click(await screen.findByRole('button', { name: '核对提交状态' }));
    else await act(async () => { releaseGrant(json({ ...grant, ...grantBody.data })); });
    if (mode === 'run-check' || mode === 'run-retry') {
      await user.click(await screen.findByRole('button', { name: '核对提交状态' }));
      if (mode === 'run-retry') await user.click(await screen.findByRole('button', { name: '使用原命令重试' }));
    }
    await waitFor(() => expect(drafts.read(a).text).toBe(''));
    expect(drafts.read(b).text).toBe('B 的未提交草稿');
    expect(screen.getByLabelText('消息')).toHaveProperty('value', 'B 的未提交草稿');
    expect(writes.every(write => write.path === '/grants' || write.path === `/sessions/${id}/runs`)).toBe(true);
    expect(checks.every(path => path.startsWith(`/sessions/${id}/commands/`))).toBe(true);
    expect(coverageSessions.length).toBeGreaterThanOrEqual(2);
    expect(coverageSessions.every(path => path === `/sessions/${id}/resource-coverage`)).toBe(true);
    const starts = writes.filter(write => write.path.endsWith('/runs'));
    expect(starts).toHaveLength(mode === 'run-retry' ? 2 : 1);
    expect(starts.every(write => JSON.stringify(write.body) === JSON.stringify(savedRunCommand))).toBe(true);
  });

it('ToolRun 不显示 steering，保留草稿并说明导出结束后发送，不抢输入焦点', async () => {
  const requests = server('tool'); const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  const input = screen.getByLabelText('消息'); await user.type(input, '等待导出完成后的新要求');
  await screen.findByText('导出结束后可发送；也可另开会话');
  expect(screen.queryByRole('button', { name: '补充指令' })).toBeNull();
  expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.activeElement).toBe(input);
  fireEvent.submit(input.closest('form')!);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(0);
});

it('Question 答案按 ID/version 与普通草稿分离，切会话往返不丢回答', async () => {
  server('agent', true); const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByText(question.question);
  await user.type(screen.getByLabelText('回答'), '问题草稿'); await user.type(screen.getByLabelText('消息'), '普通草稿');
  await user.click(screen.getByRole('button', { name: otherSession.title }));
  await user.type(screen.getByLabelText('消息'), 'B 草稿');
  await user.click(screen.getByRole('button', { name: session.title }));
  expect((screen.getByLabelText('回答') as HTMLTextAreaElement).value).toBe('问题草稿');
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('普通草稿');
});

it('另一窗回答同 Question 后保留本窗未提交答案和普通输入，不抢焦点或自动回答', async () => {
  const requests = server('agent', true); const previous = globalThis.fetch;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => url.includes('/events?')
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } })) : previous(url, init));
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByText(question.question);
  await user.type(screen.getByLabelText('回答'), '本窗尚未提交的答案');
  const input = screen.getByLabelText('消息'); await user.type(input, '正在输入');
  const position = (BigInt(event.event_id) + 1n).toString();
  await act(async () => { stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ kind: 'durable', event_id: position,
    event: { ...event, event_id: position, kind: 'question.answered', payload: { ...event.payload,
      questions: [{ ...question, version: 2, status: 'answered', answer_message_id: id }] } } })}\n\n`)); });
  await screen.findByText(/问题已处理，未提交的回答已保留：本窗尚未提交的答案/);
  expect((input as HTMLTextAreaElement).value).toBe('正在输入'); expect(document.activeElement).toBe(input);
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(0);
});

it('导出用途授权待确认时切换会话，后续冻结导出仍归属原会话，核对不串路由', async () => {
  server(); const previous = globalThis.fetch;
  const artifact = { id: secondId, version: 1, task_id: task.id, activity_id: id, content_hash: 'a'.repeat(64), dependencies: [], media_type: 'text/plain' };
  const completed = { ...run, state: 'completed', output: {
    summary: '正式报告', artifact_ids: [artifact.id], handled_failures: [], unresolved: [],
  } };
  const commands: { path: string; body: any }[] = []; const checks: string[] = [];
  vi.mocked(invoke).mockResolvedValue({ resources: [{ ...resource, scope: { kind: 'session', workspace_id: id, session_id: id } }] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      commands.push({ path, body: JSON.parse(init.body as string) });
      if (path.endsWith('/grants') && commands.length > 1) return json({ ...grant, scope: { kind: 'session', workspace_id: id, session_id: id } });
      throw new TypeError('response lost');
    }
    if (path.includes('/commands/')) { checks.push(path); return json({ status: 'not_found', result: null }); }
    if (path.endsWith('/grants')) return json(page([]));
    if (path === `/v3/tasks/${task.id}`) return json(task);
    if (path.endsWith(`/sessions/${id}/runs`)) return json(page([completed]));
    if (path === `/v3/runs/${id}`) {
      const detail = await (await previous(url, init)).json();
      return json({ ...detail, run: completed, artifacts: page([artifact]) });
    }
    if (path.endsWith(`/artifacts/${secondId}/content`)) return json({ text: '产物', start: 0, end: 2, total_chars: 2, source_version: 'v1' });
    return previous(url, init);
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await user.click(await screen.findByRole('button', { name: '产物' }));
  const panel = within(await screen.findByRole('dialog', { name: '产物' }));
  await user.click(await panel.findByRole('button', { name: '文本产物 1' }));
  await user.click(await screen.findByRole('button', { name: '导出产物' }));
  expect(screen.queryByRole('button', { name: '确认导出到此文件' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '关闭详情' }));
  await screen.findByText('提交状态待确认');
  await user.click(screen.getByRole('button', { name: otherSession.title }));
  await user.click(screen.getByRole('button', { name: '使用原命令重试' }));
  await waitFor(() => expect(commands).toHaveLength(3));
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[2].path).toBe(`/v3/artifacts/${artifact.id}/export`);
  await user.click(screen.getByRole('button', { name: '核对提交状态' }));
  expect(checks[0]).toContain(`/v3/sessions/${id}/commands/`);
});

it('两个窗口各自保留草稿，不逐字同步，也不写 localStorage', async () => {
  server(); const write = vi.spyOn(Storage.prototype, 'setItem'); const user = userEvent.setup();
  const a = render(<Conversation client={client} />), b = render(<Conversation client={client} />);
  const first = within(a.container), second = within(b.container);
  await first.findByRole('heading', { name: session.title }); await second.findByRole('heading', { name: session.title });
  const firstInput = a.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  const secondInput = b.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  await user.type(firstInput, '窗口 A'); await user.type(secondInput, '窗口 B');
  expect(firstInput.value).toBe('窗口 A'); expect(secondInput.value).toBe('窗口 B');
  expect(write).not.toHaveBeenCalled(); write.mockRestore();
});

it('本次后台授权进入真实startRun且ack后重置，不成为下次全局默认', async () => {
  const requests = server(); const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.click(screen.getByLabelText('运行配置'));
  await user.click(screen.getByLabelText('允许本次转为独立后台任务'));
  await user.keyboard('{Escape}');
  await user.type(screen.getByLabelText('消息'), '允许这次后台处理');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(requests.some(request => request.method === 'POST')).toBe(true));
  expect(requests.find(request => request.method === 'POST')!.body.data.allow_managed).toBe(true);
  await waitFor(() => expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe(''));
  await user.click(screen.getByLabelText('运行配置'));
  expect(screen.getByRole('checkbox', { name: '允许本次转为独立后台任务', checked: false })).toBeTruthy();
});

it('managed不成为当前推进者；后台问答不切会话/模型/来源/草稿，确认后返回原输入', async () => {
  const requests = server('agent', true), previous = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const response = await previous(url, init);
    if (new URL(url).pathname.endsWith('/events')) return response;
    const value = await response.json();
    function managed(value: any): any {
      if (Array.isArray(value)) return value.map(managed);
      if (!value || typeof value !== 'object') return value;
      const next = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, managed(child)]));
      if ('root_task_id' in value) return { ...next, kind: 'managed', execution_session_id: secondId, state: 'waiting_user' };
      return next;
    }
    return json(managed(value));
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByLabelText('后台任务条');
  expect(screen.queryByLabelText('回答')).toBeNull();
  const input = screen.getByLabelText('消息'); await user.type(input, '另一个目标的草稿');
  await selectComposerModel(user, id);
  expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('button', { name: '补充指令' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '回答后台问题' }));
  await user.type(await screen.findByLabelText('回答'), '仅供后台使用的答案');
  await user.click(screen.getByRole('button', { name: '提交回答' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '返回原页与草稿' })).toBeNull());
  expect((input as HTMLTextAreaElement).value).toBe('另一个目标的草稿');
  await expectComposerModel(user, id);
  expect(screen.getByRole('heading', { name: session.title })).toBeTruthy();
  expect(requests.filter(request => request.method === 'POST').map(request => request.path)).toEqual([`/questions/${question.id}/answer`]);
});

it('全局待办定位RunDetail首页外Question，仍使用原Question版本，不错答当前目标', async () => {
  const requests = server('agent'), previous = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (new URL(url).pathname === '/v3/inbox') return json(page([{ id: question.id, kind: 'question', workspace_id: id, session_id: id, run_id: id, question: { ...question, version: 5 } }]));
    if (new URL(url).pathname === `/v3/runs/${id}/questions`) return json(page([{ ...question, version: 6, status: 'answered', answer_message_id: id }]));
    if (new URL(url).pathname === `/v3/runs/${id}`) {
      const detail = await (await previous(url, init)).json();
      return json({ ...detail, questions: { ...page([]), next_cursor: 'question-tail' } });
    }
    return previous(url, init);
  });
  const user = userEvent.setup(); render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.type(screen.getByLabelText('消息'), '原输入草稿');
  await user.click(screen.getByTitle('待办'));
  await user.click(await screen.findByRole('button', { name: question.question }));
  await user.type(await screen.findByLabelText('回答'), '首页外问题的答案');
  await user.click(screen.getByRole('button', { name: '提交回答' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '返回原页与草稿' })).toBeNull());
  const answer = requests.find(request => request.path === `/questions/${question.id}/answer`);
  expect(answer?.body.meta.expected_version).toBe(5);
  expect(screen.queryByLabelText('回答')).toBeNull();
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('原输入草稿');
});
