import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { agent, connection, event, id, limits, model, page, run, runDetailSummary } from '../../test/fixtures';
import { mcpConfig, mcpView } from '../../test/mcp-fixtures';
import { Conversation } from './Conversation';
import { toast } from 'sonner';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
const workspace = { id, version: 1, name: '等待项目', directory_resource_id: null };
const session = { id, version: 1, workspace_id: id, title: '等待会话', agent_profile_id: id, kind: 'interaction', archived: false };
const ready = { ...mcpView, state: 'connected', catalog: { server_id: mcpConfig.id, config_revision: 1,
  content_hash: 'a'.repeat(64), tools: [{ name: 'echo', description: null, input_schema: { type: 'object' },
    output_schema: null, annotations: null, unavailable_reason: null }] } };
const detail = { ...runDetailSummary, run, tasks: page([]), activities: page([]), messages: page([]),
  artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
  budget: { id: run.budget_id, run_id: run.id, version: 1, limits, spent_units: '0', reserved_units: '0',
    model_requests: 0, task_count: 1, steps: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id };

class Channel {
  static peers = new Set<Channel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) { Channel.peers.add(this); }
  postMessage(data: unknown) {
    for (const peer of Channel.peers) if (peer !== this && peer.name === this.name) peer.onmessage?.({ data } as MessageEvent);
  }
  close() { Channel.peers.delete(this); }
}
beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', Channel);
  const held = new Set<string>();
  vi.stubGlobal('navigator', Object.create(navigator, { locks: { value: {
    async request(name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name }); } finally { held.delete(name); }
    },
  } } }));
});
afterEach(() => { Channel.peers.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function harness() {
  let resolve!: (response: Response) => void;
  const response = new Promise<Response>(done => { resolve = done; });
  const writes: { path: string; body: any; search: string }[] = [];
  let views: unknown[] = [mcpView], mark = BigInt(event.event_id);
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v4', '');
    if (init.method === 'POST') {
      writes.push({ path, body: JSON.parse(init.body as string), search: parsed.search });
      if (path.endsWith('/discover')) return response;
      if (path.endsWith('/runs')) return Response.json(run);
      throw Error(path);
    }
    if (path === '/capabilities/mcp') return Response.json(page(parsed.searchParams.get('scope_kind') === 'user_global' ? views : []));
    if (path.endsWith('/events')) return new Response(new ReadableStream({
      start(controller) { streams.add(controller); }, cancel() {},
    }));
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/runs')
      || path.endsWith('/messages') || path.endsWith('/run-feedback')) return Response.json(page([]));
    if (path.endsWith('/export-recovery')) return Response.json([]);
    const body = { '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/sessions/${id}`]: session, [`/runs/${run.id}`]: detail,
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]),
        pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
    }[path];
    if (!body) throw Error(path);
    return Response.json(body);
  });
  return { writes, resolve, updateServers(next: unknown[]) {
    views = next;
    const event_id = String(++mark);
    for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
      kind: 'durable', event_id, event: { ...event, event_id, kind: 'mcp.changed',
        workspace_id: null, session_id: null, run_id: null,
        payload: { server_id: mcpConfig.id, config_revision: 1, scope: mcpConfig.scope } },
    })}\n\n`));
  } };
}
async function enter(container: HTMLElement, text = '等待后的同一输入') {
  const ui = within(container);
  await ui.findByRole('heading', { name: session.title });
  fireEvent.change(container.querySelector('textarea')!, { target: { value: text } });
  await waitFor(() => expect((ui.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(false));
  return ui;
}

it('未指定服务立即走原发送，连接中的选择入口不成为全局前置条件', async () => {
  const { writes } = harness();
  const view = render(<Conversation client={client} />);
  const ui = await enter(view.container, '直接发送');
  await ui.findByLabelText('发送前等待的服务');
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(writes.filter(write => write.path.endsWith('/runs'))).toHaveLength(1));
  expect(writes.some(write => write.path.endsWith('/discover'))).toBe(false);
});

it('等明确服务就绪后只提交一次，使用同一输入和声明的服务', async () => {
  const { writes, resolve } = harness();
  const view = render(<Conversation client={client} compact />);
  const ui = await enter(view.container);
  fireEvent.change(await ui.findByLabelText('发送前等待的服务'), { target: { value: mcpConfig.id } });
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await ui.findByRole('button', { name: '取消等待' });
  expect(writes.filter(write => write.path.endsWith('/runs'))).toHaveLength(0);
  await act(async () => { resolve(Response.json(ready)); });
  await waitFor(() => expect(writes.filter(write => write.path.endsWith('/runs'))).toHaveLength(1));
  const sent = writes.find(write => write.path.endsWith('/runs'))!;
  expect(sent.body.data.text).toBe('等待后的同一输入');
  expect(new URLSearchParams(sent.search).get('mcp_server_id')).toBe(mcpConfig.id);
});

it.each(['cancel', 'failure', 'edit'] as const)('%s 后草稿保留，迟到发现响应不会暗中提交', async mode => {
  const { writes, resolve } = harness();
  const view = render(<Conversation client={client} />);
  const ui = await enter(view.container);
  fireEvent.change(await ui.findByLabelText('发送前等待的服务'), { target: { value: mcpConfig.id } });
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  const cancel = await ui.findByRole('button', { name: '取消等待' });
  if (mode === 'cancel') fireEvent.click(cancel);
  if (mode === 'edit') fireEvent.change(ui.getByLabelText('消息'), { target: { value: '修改后的草稿' } });
  await act(async () => { resolve(Response.json(mode === 'failure' ? { ...mcpView, state: 'failed', error_code: 'mcp_connection_failed' } : ready)); });
  await waitFor(() => expect(ui.queryByRole('button', { name: '取消等待' })).toBeNull());
  expect(writes.filter(write => write.path.endsWith('/runs'))).toHaveLength(0);
  expect((ui.getByLabelText('消息') as HTMLTextAreaElement).value).toBe(mode === 'edit' ? '修改后的草稿' : '等待后的同一输入');
});

it('主窗和小窗共享等待和取消状态，草稿保持各自独立', async () => {
  const { writes, resolve } = harness();
  const main = render(<Conversation client={client} />), quick = render(<Conversation client={client} compact />);
  const a = await enter(main.container), b = await enter(quick.container, '小窗独立草稿');
  fireEvent.change(await a.findByLabelText('发送前等待的服务'), { target: { value: mcpConfig.id } });
  fireEvent.click(a.getByRole('button', { name: '发送' }));
  await a.findByRole('button', { name: '取消等待' });
  fireEvent.click(await b.findByRole('button', { name: '取消等待' }));
  await act(async () => { resolve(Response.json(ready)); });
  await waitFor(() => expect(a.queryByRole('button', { name: '取消等待' })).toBeNull());
  expect(writes.filter(write => write.path.endsWith('/runs'))).toHaveLength(0);
  expect(quick.container.querySelector('textarea')!.value).toBe('小窗独立草稿');
});

it('两窗等待同一会话只由发起窗口提交一次，其它窗口同步解锁', async () => {
  const { writes, resolve } = harness();
  const main = render(<Conversation client={client} />), quick = render(<Conversation client={client} compact />);
  const a = await enter(main.container), b = await enter(quick.container, '另一窗口独立草稿');
  fireEvent.change(await a.findByLabelText('发送前等待的服务'), { target: { value: mcpConfig.id } });
  fireEvent.click(a.getByRole('button', { name: '发送' }));
  await b.findByRole('button', { name: '取消等待' });
  expect((b.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(b.getByRole('button', { name: '发送' }).closest('form')!);
  await act(async () => { resolve(Response.json(ready)); });
  await waitFor(() => expect(writes.filter(write => write.path.endsWith('/runs'))).toHaveLength(1));
  expect(writes.find(write => write.path.endsWith('/runs'))!.body.data.text).toBe('等待后的同一输入');
  await waitFor(() => expect(b.queryByRole('button', { name: '取消等待' })).toBeNull());
  expect(quick.container.querySelector('textarea')!.value).toBe('另一窗口独立草稿');
});

it('发起窗口卸载后不接管或重发该等待输入', async () => {
  const { writes, resolve } = harness();
  const view = render(<Conversation client={client} />);
  const ui = await enter(view.container);
  fireEvent.change(await ui.findByLabelText('发送前等待的服务'), { target: { value: mcpConfig.id } });
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await ui.findByRole('button', { name: '取消等待' });
  view.unmount();
  await act(async () => { resolve(Response.json(ready)); });
  expect(writes.filter(write => write.path.endsWith('/runs'))).toHaveLength(0);
});

it.each(['disabled', 'missing', 'failed', 'revision', 'empty'] as const)(
  '刷新后服务 %s 保留本次明确意图，只有主动清除后才正常发送', async mode => {
    const { writes, updateServers } = harness();
    const notification = vi.spyOn(toast, 'error');
    const view = render(<Conversation client={client} />);
    const ui = await enter(view.container);
    const select = await ui.findByLabelText('发送前等待的服务') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: mcpConfig.id } });
    const changed = mode === 'disabled' ? { ...mcpView, config: { ...mcpConfig, enabled: false } }
      : mode === 'failed' ? { ...mcpView, state: 'failed', error_code: 'mcp_connection_failed' }
        : mode === 'revision' ? { ...mcpView, config: { ...mcpConfig, revision: 2 } }
          : { ...mcpView, selection: { server_id: mcpConfig.id, scope: mcpConfig.scope, version: 1,
            config_revision: 1, catalog_hash: 'a'.repeat(64), selected_names: [] } };
    await act(async () => { updateServers(mode === 'missing' ? [] : [changed]); });
    await ui.findByText(/所选.*(?:不可用|停用|失败|改变|全部关闭)/);
    expect(select.value).toBe(mcpConfig.id);
    fireEvent.click(ui.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(notification).toHaveBeenCalled());
    expect(ui.queryByRole('alert')).toBeNull();
    expect(writes).toHaveLength(0);
    expect(view.container.querySelector('textarea')!.value).toBe('等待后的同一输入');
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(ui.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(writes.filter(write => write.path.endsWith('/runs'))).toHaveLength(1));
    expect(writes[0].search).toBe('');
  });

it('刷新后所选服务已就绪仍保留选择，正式提交携带同一服务', async () => {
  const { writes, resolve, updateServers } = harness();
  const view = render(<Conversation client={client} />);
  const ui = await enter(view.container);
  const select = await ui.findByLabelText('发送前等待的服务') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: mcpConfig.id } });
  await act(async () => { updateServers([ready]); });
  await ui.findByText('所选服务已就绪，将用于本次发送。');
  expect(select.value).toBe(mcpConfig.id);
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await ui.findByRole('button', { name: '取消等待' });
  await act(async () => { resolve(Response.json(ready)); });
  await waitFor(() => expect(writes.filter(write => write.path.endsWith('/runs'))).toHaveLength(1));
  expect(new URLSearchParams(writes.at(-1)!.search).get('mcp_server_id')).toBe(mcpConfig.id);
  await waitFor(() => expect(ui.queryByLabelText('发送前等待的服务')).toBeNull());
});
