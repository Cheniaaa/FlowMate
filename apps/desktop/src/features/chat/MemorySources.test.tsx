import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { expectComposerModel, selectComposerModel } from '../../test/composer-model';
import type { DataUseGrant } from '../../generated/contracts';
import { agent, connection, event, followUpIntent, id, limits, model, page, pendingUserCommand, run, runDetailSummary, secondId } from '../../test/fixtures';
import { memory, memoryGrant, memoryPolicy, personalScope, projectScope } from '../../test/memory-fixtures';
import { Conversation } from './Conversation';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

function server(queued = false, grants?: DataUseGrant[]) {
  const writes: { path: string; body: any }[] = [], streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const memoryReads: URL[] = [];
  let read = true, authorized = true;
  const otherConnection = { ...connection, id: '00000000-0000-4000-8000-000000000064', endpoint: 'https://other.invalid/v1' };
  const workspace = { id, version: 1, name: '项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '记忆范围会话', agent_profile_id: id, kind: 'interaction', archived: false };
  const summary = { ...run, kind: 'follow_up', allow_follow_up: true };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v3', '');
    if (init.method === 'POST') { writes.push({ path, body: JSON.parse(String(init.body)) }); return Response.json(queued ? pendingUserCommand : run); }
    if (path === '/settings/memory' || path === '/memory/grants' || path === '/memory/records') memoryReads.push(parsed);
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); } }));
    if (path === '/settings/memory') return Response.json({ ...memoryPolicy, read_profile: read,
      scope: parsed.searchParams.get('scope_kind') === 'workspace' ? projectScope : personalScope });
    if (path === '/memory/grants') {
      const scope = parsed.searchParams.get('scope_kind') === 'workspace' ? projectScope : personalScope;
      return Response.json(page(authorized ? (grants ?? [{ ...memoryGrant, scope, memory_scopes: [scope] }])
        .filter(grant => grant.scope.workspace_id === scope.workspace_id) : []));
    }
    if (path === '/memory/records') {
      const rules = parsed.searchParams.get('profile_rules');
      const records = parsed.searchParams.get('scope_kind') === 'user_global'
        ? [...(rules !== 'false' ? [{ ...memory, status: 'confirmed' }] : []), ...(rules !== 'true' ? [personalFact] : [])] : [];
      return Response.json(page(records));
    }
    if (path.endsWith('/evidence')) return Response.json(page(memory.evidence.map(evidence => ({ evidence, available: true, reason: null }))));
    if (path === '/navigation') return Response.json({ default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session, { ...session, id: secondId, title: '另一会话' }]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path === `/sessions/${secondId}`) return Response.json({ ...session, id: secondId, title: '另一会话' });
    if (path === `/sessions/${id}`) return Response.json(session);
    if (path.endsWith('/directory')) return Response.json({ workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null });
    if (path.endsWith('/commands')) return Response.json(page([]));
    if (path.endsWith('/follow-ups')) return Response.json(page(queued ? [followUpIntent] : []));
    if (path.endsWith('/export-recovery')) return Response.json([]);
    if (path === `/runs/${id}`) return Response.json({ ...runDetailSummary, run: queued ? summary : run,
      tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]),
      waits: page([]), consumptions: page([]), joins: page([]), budget: { id: run.budget_id, run_id: id, version: 1, limits,
        spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id });
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model, { ...model, id, model_id: 'other-model', connection_id: otherConnection.id }]), '/model-connections': page([connection, otherConnection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session, { ...session, id: secondId, title: '另一会话' }]),
        active_runs: page(queued ? [summary] : []), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/messages`]: page([]), [`/sessions/${secondId}/messages`]: page([]),
      [`/sessions/${id}/runs`]: page(queued ? [summary] : []), [`/sessions/${secondId}/runs`]: page([]) };
    if (!(path in values)) throw new Error(`未定义 ${path}`);
    return Response.json(values[path]);
  });
  return { writes, memoryReads, setRead: (value: boolean) => { read = value; }, setAuthorized: (value: boolean) => { authorized = value; },
     emit: async (offset: number, revokeFile = false) => {
       const position = String(BigInt(event.event_id) + BigInt(offset));
       await act(async () => { for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
         kind: 'durable', event_id: position, event: { ...event, kind: revokeFile ? 'scope.revoked' : 'memory.policy_changed', event_id: position,
           seq: null, workspace_id: revokeFile ? id : null, session_id: null, run_id: null, payload: revokeFile
             ? { scopes: [{ id: memory.dependencies[0].scope_id, epoch: 2, status: 'revoked', scope: projectScope }], deletions: [] }
             : { records: [], policies: [] } },
      })}\n\n`)); });
    } };
}
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
async function openRunConfiguration(user: ReturnType<typeof userEvent.setup>, view: Pick<typeof screen, 'findByRole'> = screen) {
  await user.click(await view.findByRole('button', { name: '运行配置' }));
  return within(await screen.findByRole('dialog', { name: '运行配置' }));
}

async function closeRunConfiguration(user: ReturnType<typeof userEvent.setup>, dialog: ReturnType<typeof within>) {
  await user.click(dialog.getByRole('button', { name: '关闭对话框' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '运行配置' })).toBeNull());
}

const projectGrant: DataUseGrant = { ...memoryGrant, scope: projectScope, memory_scopes: [projectScope] };
const projectPreference = { ...memory, scope: projectScope, status: 'confirmed' as const,
  id: '00000000-0000-4000-8000-000000000071', text: '以后在项目报告中用中文' };
const projectInstruction = { ...projectPreference, kind: 'instruction' as const,
  id: '00000000-0000-4000-8000-000000000072', text: '项目报告附摘要' };
const projectFact = { ...projectPreference, kind: 'fact' as const,
  id: '00000000-0000-4000-8000-000000000073', text: '项目一般事实' };
const personalFact = { ...projectFact, scope: personalScope,
  id: '00000000-0000-4000-8000-000000000074', text: '个人一般事实' };

it('文件撤权后重新读取项目规则时只接受无缓存的服务端有效投影', async () => {
  const api = server(false, [projectGrant]), user = userEvent.setup();
  const boundary = globalThis.fetch;
  const requests: { url: URL; cache?: RequestCache }[] = [];
  let revoked = false;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v3/memory/records' && parsed.searchParams.get('scope_kind') === 'workspace') {
      requests.push({ url: parsed, cache: init?.cache });
      return Response.json(page(revoked && init?.cache === 'no-store' ? [projectInstruction] : [projectPreference, projectInstruction]));
    }
    return boundary(url, init);
  });
  render(<Conversation client={client()} />);
  const dialog = await openRunConfiguration(user);
  await user.click(await dialog.findByText('本次排除单条记忆', { selector: 'summary' }));
  await dialog.findByRole('checkbox', { name: `本次排除：${projectPreference.text}` });
  revoked = true;
  await api.emit(12, true);
  await waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2));
  await dialog.findByRole('checkbox', { name: `本次排除：${projectInstruction.text}` });
  expect(dialog.queryByRole('checkbox', { name: `本次排除：${projectPreference.text}` })).toBeNull();
  expect(requests.at(-1)).toMatchObject({ cache: 'no-store' });
});

it('另一个记忆分组首读 503 就地重试，已选排除项和第一组请求均保留', async () => {
  server(false, [projectGrant]);
  const user = userEvent.setup(), boundary = globalThis.fetch;
  const queries: URL[] = [];
  let failOther = true;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v3/memory/records' && parsed.searchParams.get('scope_kind') === 'workspace') {
      queries.push(parsed);
      if (parsed.searchParams.get('profile_rules') === 'true') return Response.json(page([projectPreference]));
      if (failOther) return Response.json({ error: { code: 'unavailable', safe_message: '记录暂时不可用', related_ids: [], retryable: true } }, { status: 503 });
      return Response.json(page([projectFact]));
    }
    return boundary(url, init);
  });
  render(<Conversation client={client()} />);
  const dialog = await openRunConfiguration(user);
  await user.click(await dialog.findByText('本次排除单条记忆', { selector: 'summary' }));
  const excluded = { name: `本次排除：${projectPreference.text}` };
  await user.click(await dialog.findByRole('checkbox', excluded));
  await user.click(dialog.getByRole('checkbox', { name: '本次读取其他项目记忆' }));
  const group = within(await dialog.findByRole('region', { name: '其他项目记忆' }));
  await group.findByText('载入失败：记录暂时不可用');
  failOther = false;
  await user.click(group.getByRole('button', { name: '重试读取其他项目记忆' }));
  await group.findByRole('checkbox', { name: `本次排除：${projectFact.text}` });
  expect(dialog.getByRole('checkbox', { ...excluded, checked: true })).toBeTruthy();
  expect(queries.map(url => url.searchParams.get('profile_rules'))).toEqual(['true', 'false', 'false']);
});

function projectRecords(wait?: Promise<void>) {
  const fetchServer = globalThis.fetch;
  const reads: URL[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/memory/records')) {
      reads.push(parsed);
      if (parsed.pathname === '/v3/memory/records' && parsed.searchParams.get('scope_kind') === 'workspace') {
        await wait;
        if (parsed.searchParams.get('profile_rules') === 'true') {
          if (parsed.searchParams.get('cursor') === 'next-rules') return Response.json(page([projectInstruction]));
          return Response.json({ ...page([projectPreference]), next_cursor: 'next-rules' });
        }
        if (parsed.searchParams.get('profile_rules') === 'false') return Response.json(page([projectFact]));
        return Response.json(page([projectFact, projectPreference, projectInstruction]));
      }
    }
    return fetchServer(url, init);
  });
  return reads;
}

it.each([false, true])('默认项目规则可直接按条排除且发送不扩大范围 queued=%s', async queued => {
  const api = server(queued, [projectGrant]), user = userEvent.setup();
  const reads = projectRecords();
  render(<Conversation client={client()} />);
  await screen.findByRole('heading', { name: '记忆范围会话' });
  expect(reads).toHaveLength(0);
  const dialog = await openRunConfiguration(user);
  expect(dialog.getByRole('checkbox', { name: '本次读取其他项目记忆', checked: false })).toBeTruthy();
  await user.click(await dialog.findByText('本次排除单条记忆', { selector: 'summary' }));
  await dialog.findByRole('checkbox', { name: `本次排除：${projectPreference.text}` });
  expect(dialog.queryByRole('checkbox', { name: `本次排除：${projectInstruction.text}` })).toBeNull();
  expect(reads).toHaveLength(1);
  await user.click(dialog.getByRole('button', { name: '加载更多项目默认规则' }));
  await dialog.findByRole('checkbox', { name: `本次排除：${projectInstruction.text}` });
  const excluded = queued ? projectInstruction : projectPreference;
  const included = queued ? projectPreference : projectInstruction;
  await user.click(dialog.getByRole('checkbox', { name: `本次排除：${excluded.text}` }));
  expect(dialog.getByRole('checkbox', { name: `本次排除：${included.text}`, checked: false })).toBeTruthy();
  expect(dialog.queryByRole('checkbox', { name: `本次排除：${projectFact.text}` })).toBeNull();
  await closeRunConfiguration(user, dialog);
  await user.type(screen.getByLabelText('消息'), '按默认范围发送');
  await user.click(screen.getByRole('button', { name: queued ? '排队发送' : '发送' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0]).toMatchObject({ path: `/sessions/${id}/${queued ? 'commands' : 'runs'}`, body: { data: {
    sources: { memory_scopes: [], resource_ids: [], excluded_source_ids: [excluded.id] },
  } } });
  expect(reads.map(url => url.pathname)).toEqual(['/v3/memory/records', '/v3/memory/records']);
});

it('默认规则记录加载期间仍能发送空显式范围', async () => {
  const api = server(false, [projectGrant]), user = userEvent.setup();
  let finish!: () => void;
  const reads = projectRecords(new Promise<void>(resolve => { finish = resolve; }));
  try {
    render(<Conversation client={client()} />);
    await screen.findByRole('heading', { name: '记忆范围会话' });
    await user.type(screen.getByLabelText('消息'), '不等待预览就发送');
    const dialog = await openRunConfiguration(user);
    await waitFor(() => expect(reads).toHaveLength(1));
    await closeRunConfiguration(user, dialog);
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0].body.data.sources).toMatchObject({ memory_scopes: [], excluded_source_ids: [] });
  } finally {
    await act(async () => { finish(); });
  }
});

it('个人画像按主助理授权预览，可排除单条而不加入额外个人资料', async () => {
  const api = server(false, [memoryGrant]), user = userEvent.setup();
  const personalRecordQueries = () => api.memoryReads.filter(url =>
    url.pathname === '/v3/memory/records' && url.searchParams.get('scope_kind') === 'user_global');
  render(<Conversation client={client()} />);
  await screen.findByRole('heading', { name: '记忆范围会话' });
  expect(api.memoryReads).toEqual([]);
  const dialog = await openRunConfiguration(user);
  await user.click(await dialog.findByText('本次排除单条记忆', { selector: 'summary' }));
  const defaultRule = await dialog.findByRole('checkbox', { name: `本次排除：${memory.text}` });
  expect(dialog.getByText(/个人偏好和指令.*仅.*已获个人记忆授权的主助理/)).toBeTruthy();
  const extras = dialog.getByRole('checkbox', { name: '本次读取其他个人记忆', checked: false });
  expect(dialog.queryByRole('checkbox', { name: `本次排除：${personalFact.text}` })).toBeNull();
  expect(personalRecordQueries().map(url => url.searchParams.get('profile_rules'))).toEqual(['true']);

  await user.click(defaultRule);
  await user.click(extras);
  await dialog.findByRole('checkbox', { name: `本次排除：${personalFact.text}` });
  await user.click(extras);
  expect(dialog.queryByRole('checkbox', { name: `本次排除：${personalFact.text}` })).toBeNull();
  expect(dialog.getByRole('checkbox', { name: `本次排除：${memory.text}`, checked: true })).toBeTruthy();
  expect(personalRecordQueries().map(url => url.searchParams.get('profile_rules'))).toEqual(['true', 'false']);
  await closeRunConfiguration(user, dialog);
  await user.type(screen.getByLabelText('消息'), '本轮排除这条个人偏好');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0].body.data.sources).toMatchObject({ memory_scopes: [], excluded_source_ids: [memory.id] });
});

it('主模型未获授权时，仍可为成员排除项目默认偏好', async () => {
  const api = server(false, [{ ...projectGrant, destination: 'https://other.invalid/v1' }]);
  const user = userEvent.setup(), reads = projectRecords();
  const projectAccessReads = () => api.memoryReads.filter(url => url.searchParams.get('scope_kind') === 'workspace')
    .map(url => url.pathname);
  render(<Conversation client={client()} />);
  await screen.findByRole('heading', { name: '记忆范围会话' });
  expect(api.memoryReads).toEqual([]);
  expect(reads).toEqual([]);

  const dialog = await openRunConfiguration(user);
  await user.click(await dialog.findByText('本次排除单条记忆', { selector: 'summary' }));
  await user.click(await dialog.findByRole('checkbox', { name: `本次排除：${projectPreference.text}` }));
  expect(projectAccessReads()).toEqual(['/v3/settings/memory']);
  expect(dialog.getByRole('checkbox', { name: '本次读取其他项目记忆', checked: false })).toBeTruthy();

  await user.click(dialog.getByRole('checkbox', { name: '本次读取其他项目记忆' }));
  await dialog.findByText('项目记忆：目标模型未授权，本次排除');
  expect(dialog.queryByRole('checkbox', { name: `本次排除：${projectFact.text}` })).toBeNull();
  await closeRunConfiguration(user, dialog);
  await user.type(screen.getByLabelText('消息'), '本轮排除这条项目偏好');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0]).toMatchObject({ path: `/sessions/${id}/runs`, body: { data: {
    model_profile_id: model.id, sources: { memory_scopes: [], excluded_source_ids: [projectPreference.id] },
  } } });
  expect(projectAccessReads()).toEqual(['/v3/settings/memory', '/v3/memory/grants']);
  expect(reads.map(url => [url.pathname, url.searchParams.get('profile_rules')])).toEqual([['/v3/memory/records', 'true']]);
});

it('项目读取关闭后隐藏默认规则，配置关闭时不会刷新预览', async () => {
  const api = server(false, [projectGrant]), user = userEvent.setup(), reads = projectRecords();
  render(<Conversation client={client()} />);
  await screen.findByRole('heading', { name: '记忆范围会话' });
  const dialog = await openRunConfiguration(user);
  await user.click(await dialog.findByText('本次排除单条记忆', { selector: 'summary' }));
  await dialog.findByRole('checkbox', { name: `本次排除：${projectPreference.text}` });

  api.setRead(false);
  await api.emit(1);
  await waitFor(() => expect(dialog.queryByText('本次排除单条记忆', { selector: 'summary' })).toBeNull());
  expect(reads).toHaveLength(1);

  await closeRunConfiguration(user, dialog);
  const checks = api.memoryReads.length;
  api.setRead(true);
  await api.emit(2);
  expect(api.memoryReads).toHaveLength(checks);
  expect(reads).toHaveLength(1);
});

it.each([false, true])('正式model_send记忆grant的实际发送范围 queued=%s', async queued => {
  const api = server(queued, [projectGrant]), user = userEvent.setup();
  render(<Conversation client={client()} />);
  await screen.findByRole('heading', { name: '记忆范围会话' });
  const dialog = await openRunConfiguration(user);
  expect(dialog.getByText(/项目偏好.*已获授权的模型服务.*自动/)).toBeTruthy();
  await user.click(dialog.getByRole('checkbox', { name: '本次读取其他项目记忆' }));
  await dialog.findByText('项目记忆：已选择并授权');
  await closeRunConfiguration(user, dialog);
  await user.type(screen.getByLabelText('消息'), '使用已授权项目记忆');
  await user.click(screen.getByRole('button', { name: queued ? '排队发送' : '发送' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0]).toMatchObject({ path: `/sessions/${id}/${queued ? 'commands' : 'runs'}`, body: { data: {
    model_profile_id: model.id, sources: { memory_scopes: [projectScope], resource_ids: [], excluded_source_ids: [] },
  } } });
});

it.each([false, true].flatMap(queued => [
  { queued, reason: 'other未授权', grants: [projectGrant], read: true, modelId: id },
  { queued, reason: '读取关闭', grants: [projectGrant], read: false, modelId: model.id },
  { queued, reason: '授权已撤销', grants: [{ ...projectGrant, status: 'revoked' as const, version: 2, epoch: 2 }], read: true, modelId: model.id },
  { queued, reason: '个人授权不覆盖项目', grants: [memoryGrant], read: true, modelId: model.id },
]))('$reason实际发送不包含项目记忆 queued=$queued', async ({ queued, grants, read, modelId }) => {
  const api = server(queued, grants), user = userEvent.setup();
  api.setRead(read);
  render(<Conversation client={client()} />);
  await screen.findByRole('heading', { name: '记忆范围会话' });
  await selectComposerModel(user, modelId);
  const dialog = await openRunConfiguration(user);
  await user.click(dialog.getByRole('checkbox', { name: '本次读取其他项目记忆' }));
  await dialog.findByText(read ? '项目记忆：目标模型未授权，本次排除' : '项目记忆：读取已关闭，本次排除');
  await closeRunConfiguration(user, dialog);
  await user.type(screen.getByLabelText('消息'), '按当前范围发送');
  await user.click(screen.getByRole('button', { name: queued ? '排队发送' : '发送' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0]).toMatchObject({ path: `/sessions/${id}/${queued ? 'commands' : 'runs'}`, body: { data: {
    model_profile_id: modelId, sources: { memory_scopes: [], resource_ids: [], excluded_source_ids: [] },
  } } });
});

it.each([false, true])('本次记忆范围沿真实%s发送入口，按模型/策略装配，保留排除范围和原会话草稿', async queued => {
  const api = server(queued), user = userEvent.setup(); render(<Conversation client={client()} />);
  await screen.findByRole('heading', { name: '记忆范围会话' });
  const personal = { name: '本次读取其他个人记忆' };
  const project = { name: '本次读取其他项目记忆' };
  let dialog = await openRunConfiguration(user);
  await user.click(dialog.getByRole('checkbox', personal));
  await user.click(dialog.getByRole('checkbox', project));
  await dialog.findByText('关于我：已选择并授权');
  await user.click(dialog.getByText('本次排除单条记忆', { selector: 'summary' }));
  await user.click(await dialog.findByRole('checkbox', { name: `本次排除：${memory.text}` }));
  await closeRunConfiguration(user, dialog);
  await user.click(screen.getByRole('button', { name: '另一会话' }));
  await screen.findByRole('heading', { name: '另一会话' });
  dialog = await openRunConfiguration(user);
  expect(dialog.getByRole('checkbox', { ...personal, checked: false })).toBeTruthy();
  await closeRunConfiguration(user, dialog);
  await user.click(screen.getByRole('button', { name: '记忆范围会话' }));
  await screen.findByRole('heading', { name: '记忆范围会话' });
  dialog = await openRunConfiguration(user);
  expect(dialog.getByRole('checkbox', { ...personal, checked: true })).toBeTruthy();
  await closeRunConfiguration(user, dialog);
  await selectComposerModel(user, id);
  dialog = await openRunConfiguration(user);
  await user.click(await dialog.findByRole('checkbox', { ...personal, checked: false }));
  await user.click(dialog.getByRole('checkbox', project));
  await dialog.findByText('关于我：目标模型未授权，本次排除');
  await closeRunConfiguration(user, dialog);
  await selectComposerModel(user, model.id);
  dialog = await openRunConfiguration(user);
  await user.click(await dialog.findByRole('checkbox', { ...personal, checked: false }));
  await user.click(dialog.getByRole('checkbox', project));
  await dialog.findByText('关于我：已选择并授权');
  api.setRead(false); await api.emit(1);
  await dialog.findByText('关于我：读取已关闭，本次排除');
  api.setRead(true); await api.emit(2);
  await dialog.findByText('关于我：已选择并授权');
  await user.click(dialog.getByRole('checkbox', { ...project, checked: true }));
  await closeRunConfiguration(user, dialog);
  await user.type(screen.getByLabelText('消息'), '使用这次选择');
  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: queued ? '排队发送' : '发送' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0]).toMatchObject({ path: `/sessions/${id}/${queued ? 'commands' : 'runs'}`, body: { data: {
    model_profile_id: model.id, text: '使用这次选择',
    sources: { memory_scopes: [personalScope], resource_ids: [], excluded_source_ids: [memory.id] },
  } } });
});

it('个人记忆全局事件同时更新主小窗的有效范围，两窗输入与模型独立', async () => {
  const api = server(), user = userEvent.setup();
  const main = render(<Conversation client={client()} />), quick = render(<Conversation client={client()} compact />);
  const mainWindow = within(main.container), quickWindow = within(quick.container);
  const mainInput = main.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  const quickInput = quick.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  const windows = [[mainWindow, mainInput, '主窗输入'], [quickWindow, quickInput, '小窗输入']] as const;
  const personal = { name: '本次读取其他个人记忆' };
  for (const [view, input, text] of windows) {
    await view.findByRole('heading', { name: '记忆范围会话' });
    await user.type(input, text);
    const dialog = await openRunConfiguration(user, view);
    await user.click(dialog.getByRole('checkbox', { ...personal, checked: false }));
    await dialog.findByText('关于我：已选择并授权');
    await closeRunConfiguration(user, dialog);
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole('button', { name: '运行配置' })));
  }
  const quickDialog = await openRunConfiguration(user, quickWindow);
  api.setAuthorized(false); await api.emit(1);
  await quickDialog.findByText('关于我：目标模型未授权，本次排除');
  await closeRunConfiguration(user, quickDialog);
  for (const [view] of windows) {
    const dialog = await openRunConfiguration(user, view);
    await dialog.findByText('关于我：目标模型未授权，本次排除');
    expect(dialog.getByRole('checkbox', { ...personal, checked: true })).toBeTruthy();
    expect(dialog.queryByLabelText(`本次排除：${memory.text}`)).toBeNull();
    await closeRunConfiguration(user, dialog);
  }
  await waitFor(() => expect(document.activeElement).toBe(quickWindow.getByRole('button', { name: '运行配置' })));
  await selectComposerModel(user, id, quickWindow);
  const updatedQuick = await openRunConfiguration(user, quickWindow);
  await user.click(await updatedQuick.findByRole('checkbox', { ...personal, checked: false }));
  await updatedQuick.findByText('关于我：目标模型未授权，本次排除');
  await closeRunConfiguration(user, updatedQuick);
  expect([mainInput.value, quickInput.value]).toEqual(['主窗输入', '小窗输入']);
  await expectComposerModel(user, model.id, mainWindow);
  await expectComposerModel(user, id, quickWindow);
  expect(api.writes).toHaveLength(0);
  for (const [view] of windows) await user.click(view.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(api.writes).toHaveLength(2));
  expect(api.writes).toMatchObject([
    { path: `/sessions/${id}/runs`, body: { data: {
      text: '主窗输入', model_profile_id: model.id, sources: { memory_scopes: [], resource_ids: [], excluded_source_ids: [] },
    } } },
    { path: `/sessions/${id}/runs`, body: { data: {
      text: '小窗输入', model_profile_id: id, sources: { memory_scopes: [], resource_ids: [], excluded_source_ids: [] },
    } } },
  ]);
});
