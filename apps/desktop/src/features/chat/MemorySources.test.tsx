import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { DataUseGrant } from '../../generated/contracts';
import { agent, connection, event, followUpIntent, id, limits, model, page, pendingUserCommand, run, runDetailSummary, secondId } from '../../test/fixtures';
import { memory, memoryGrant, memoryPolicy, personalScope, projectScope } from '../../test/memory-fixtures';
import { Conversation } from './Conversation';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

function server(queued = false, grants?: DataUseGrant[]) {
  const writes: { path: string; body: any }[] = [], streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  let read = true, authorized = true;
  const otherConnection = { ...connection, id: '00000000-0000-4000-8000-000000000064', endpoint: 'https://other.invalid/v1' };
  const workspace = { id, version: 1, name: '项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '记忆范围会话', agent_profile_id: id, kind: 'interaction', archived: false };
  const summary = { ...run, kind: 'follow_up', allow_follow_up: true };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v3', '');
    if (init.method === 'POST') { writes.push({ path, body: JSON.parse(String(init.body)) }); return Response.json(queued ? pendingUserCommand : run); }
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); } }));
    if (path === '/settings/memory') return Response.json({ ...memoryPolicy, read_profile: read,
      scope: parsed.searchParams.get('scope_kind') === 'workspace' ? projectScope : personalScope });
    if (path === '/memory/grants') {
      const scope = parsed.searchParams.get('scope_kind') === 'workspace' ? projectScope : personalScope;
      return Response.json(page(authorized ? (grants ?? [{ ...memoryGrant, scope, memory_scopes: [scope] }])
        .filter(grant => grant.scope.workspace_id === scope.workspace_id) : []));
    }
    if (path === '/memory/records') return Response.json(page(parsed.searchParams.get('scope_kind') === 'user_global' ? [{ ...memory, status: 'confirmed' }] : []));
    if (path.endsWith('/evidence')) return Response.json(page(memory.evidence.map(evidence => ({ evidence, available: true, reason: null }))));
    if (path === '/navigation') return Response.json({ default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
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
  return { writes, setRead: (value: boolean) => { read = value; }, setAuthorized: (value: boolean) => { authorized = value; },
    emit: async (offset: number) => {
      const position = String(BigInt(event.event_id) + BigInt(offset));
      await act(async () => { for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
        kind: 'durable', event_id: position, event: { ...event, kind: 'memory.policy_changed', event_id: position,
          seq: null, workspace_id: null, session_id: null, run_id: null, payload: { records: [], policies: [] } },
      })}\n\n`)); });
    } };
}
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
const projectGrant: DataUseGrant = { ...memoryGrant, scope: projectScope, memory_scopes: [projectScope] };

it.each([false, true])('正式model_send记忆grant的实际发送范围 queued=%s', async queued => {
  const api = server(queued, [projectGrant]), user = userEvent.setup();
  render(<Conversation client={client()} />);
  await screen.findByRole('heading', { name: '记忆范围会话' });
  await user.click(screen.getByLabelText('运行配置'));
  await user.click(screen.getByLabelText('本次读取项目记忆'));
  await screen.findByText(/项目记忆：(已选择并授权|目标模型未授权，本次排除)/);
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
  await user.click(screen.getByLabelText('运行配置'));
  await user.selectOptions(screen.getByLabelText('模型'), modelId);
  await user.click(screen.getByLabelText('本次读取项目记忆'));
  await screen.findByText(read ? '项目记忆：目标模型未授权，本次排除' : '项目记忆：读取已关闭，本次排除');
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
  await user.click(screen.getByLabelText('运行配置'));
  await user.click(screen.getByLabelText('本次读取个人记忆'));
  await user.click(screen.getByLabelText('本次读取项目记忆'));
  await screen.findByText('关于我：已选择并授权');
  await user.click(screen.getByText('本次排除单条记忆', { selector: 'summary' }));
  await user.click(screen.getByLabelText(`本次排除：${memory.text}`));
  await user.selectOptions(screen.getByLabelText('会话'), secondId);
  expect((screen.getByLabelText('本次读取个人记忆') as HTMLInputElement).checked).toBe(false);
  await user.selectOptions(screen.getByLabelText('会话'), id);
  expect((screen.getByLabelText('本次读取个人记忆') as HTMLInputElement).checked).toBe(true);
  await user.selectOptions(screen.getByLabelText('模型'), id);
  await screen.findByText('关于我：目标模型未授权，本次排除');
  await user.selectOptions(screen.getByLabelText('模型'), model.id);
  await screen.findByText('关于我：已选择并授权');
  api.setRead(false); await api.emit(1);
  await screen.findByText('关于我：读取已关闭，本次排除');
  api.setRead(true); await api.emit(2);
  await screen.findByText('关于我：已选择并授权');
  await user.click(screen.getByLabelText('本次读取项目记忆'));
  await user.type(screen.getByLabelText('消息'), '使用这次选择');
  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: queued ? '排队发送' : '发送' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0]).toMatchObject({ path: `/sessions/${id}/${queued ? 'commands' : 'runs'}`, body: { data: { sources: {
    memory_scopes: [personalScope], resource_ids: [], excluded_source_ids: [memory.id],
  } } } });
});

it('个人记忆全局事件同时更新主小窗的有效范围，两窗输入与模型独立', async () => {
  const api = server(), user = userEvent.setup();
  const main = render(<Conversation client={client()} />), quick = render(<Conversation client={client()} compact />);
  for (const container of [main.container, quick.container]) {
    const view = within(container);
    await view.findByRole('heading', { name: '记忆范围会话' });
    await user.click(view.getByLabelText('运行配置')); await user.click(view.getByLabelText('本次读取个人记忆'));
    await view.findByText('关于我：已选择并授权');
  }
  const mainInput = main.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  const quickInput = quick.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  await user.type(mainInput, '主窗输入'); await user.type(quickInput, '小窗输入');
  api.setAuthorized(false); await api.emit(1);
  await within(main.container).findByText('关于我：目标模型未授权，本次排除');
  await within(quick.container).findByText('关于我：目标模型未授权，本次排除');
  expect(mainInput.value).toBe('主窗输入'); expect(quickInput.value).toBe('小窗输入');
  expect(document.activeElement).toBe(quickInput);
  expect(api.writes).toHaveLength(0);
});
