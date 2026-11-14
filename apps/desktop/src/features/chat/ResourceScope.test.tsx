import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { DataUseGrant, ResourceRef, WorkspaceSnapshot } from '../../generated/contracts';
import { agent, connection, event, grant, id, limits, model, page, resource, run, runDetailSummary, secondId } from '../../test/fixtures';
import { Conversation } from './Conversation';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 2 });
const otherResource: ResourceRef = { ...resource, id: '00000000-0000-4000-8000-000000000012', label: '另一共享资料.md' };
const sharedGrant: DataUseGrant = { ...grant, resource_ids: [resource.id, otherResource.id], purposes: ['read', 'model_send'] };
const workspace = { id, version: 1, name: '资料工作区', directory_resource_id: null };
const session = { id, version: 1, workspace_id: id, title: '当前会话', agent_profile_id: agent.id };
const otherSession = { ...session, id: secondId, title: '另一个会话' };
const snapshot = (resources: ResourceRef[], grants: DataUseGrant[]): WorkspaceSnapshot => ({ workspace,
  sessions: page([session, otherSession]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]),
  resources: page(resources), grants: page(grants), watermark: event.event_id });

function server(initial: WorkspaceSnapshot, selection = [resource, otherResource]) {
  const commands: { path: string; body: any }[] = [];
  const requests: URL[] = [];
  vi.mocked(invoke).mockImplementation(async name => name === 'select_resources' ? { resources: selection } : undefined);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v2', '');
    requests.push(parsed);
    if (init.method === 'POST') {
      const body = JSON.parse(init.body as string); commands.push({ path, body });
      if (path === '/grants') return Response.json({ ...body.data, id: grant.id, version: 1, epoch: 1, status: 'active' });
      return Response.json(run);
    }
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    const values: Record<string, unknown> = { '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model]), '/model-connections': page([connection]), [`/workspaces/${id}/snapshot`]: initial,
      [`/sessions/${id}/messages`]: page([]), [`/sessions/${secondId}/messages`]: page([]),
      [`/sessions/${id}/runs`]: initial.active_runs, [`/sessions/${secondId}/runs`]: page([]),
      [`/runs/${id}`]: { ...runDetailSummary, run, tasks: page([{ id: run.root_task_id, version: 1, run_id: run.id, parent_task_id: null, origin_task_id: null,
        kind: 'agent', executor_id: 'builtin.agent', state: 'running', created_seq: 1, deadline_at: null, result_version: null, reason: null }]), activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]),
        waits: page([]), consumptions: page([]), joins: page([]), budget: { id: run.budget_id, version: 1, run_id: id, limits,
          spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1 }, watermark: event.event_id } };
    if (!(path in values)) throw new Error(`测试未定义路由 ${path}`);
    return Response.json(values[path]);
  });
  return { commands, requests };
}

it('窗口重建后复用同一完整共享 grant，只有显式选择的资源进入新 Run，不重交授权', async () => {
  const fixture = server(snapshot([resource, otherResource], [sharedGrant]));
  const user = userEvent.setup();
  const first = render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  expect(screen.queryByText(resource.label)).toBeNull();
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await screen.findByRole('button', { name: '当前范围已授权' });
  expect(fixture.commands).toHaveLength(0);
  first.unmount();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await screen.findByRole('button', { name: '当前范围已授权' });
  await user.type(screen.getByLabelText('消息'), '整理共享资料');
  await user.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(fixture.commands).toHaveLength(1));
  expect(fixture.commands[0]).toMatchObject({ path: `/sessions/${id}/runs`, body: { data: { resource_ids: [resource.id, otherResource.id] } } });
  expect((screen.getByRole('button', { name: '选择文本文件' }) as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByLabelText('消息'), '仅补充文本');
  await user.click(screen.getByRole('button', { name: '补充指令' }));
  await waitFor(() => expect(fixture.commands).toHaveLength(2));
  expect(fixture.commands[1]).toMatchObject({ path: `/runs/${id}/steering`, body: { data: { text: '仅补充文本' } } });
  expect(fixture.commands[1].body.data).not.toHaveProperty('resource_ids');
});

it('会话专属 grant 不授权其他会话，切换后只复用本会话或 workspace 共享授权', async () => {
  server(snapshot([resource], [{ ...grant, scope: { workspace_id: id, session_id: secondId } }]), [resource]);
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  expect(screen.queryByRole('button', { name: '当前范围已授权' })).toBeNull();
  expect((screen.getByRole('button', { name: '授权读取并发送' }) as HTMLButtonElement).disabled).toBe(false);
  await user.selectOptions(screen.getByLabelText('会话'), secondId);
  expect(screen.queryByText(resource.label)).toBeNull();
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await screen.findByRole('button', { name: '当前范围已授权' });
});

it('资源/授权未查齐保留游标与同步状态，可继续分页且不将未加载授权当成未授权', async () => {
  const initial = snapshot([resource], []);
  initial.resources.next_cursor = 'resources-next';
  initial.grants.next_cursor = 'grants-next';
  const fixture = server(initial, [resource]);
  const previousFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/resources')) { fixture.requests.push(parsed); return Response.json(page([otherResource])); }
    if (parsed.pathname.endsWith('/grants')) {
      fixture.requests.push(parsed);
      return Response.json(parsed.searchParams.get('cursor') === 'grants-next'
        ? { ...page([{ ...grant, version: 2, epoch: 2, status: 'revoked' }]), next_cursor: 'grants-last' }
        : page([{ ...sharedGrant, id: secondId }]));
    }
    return previousFetch(url, init);
  });
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  expect((screen.getByRole('button', { name: '授权状态同步中' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: '更多资料' }));
  expect(screen.queryByRole('button', { name: '更多资料' })).toBeNull();
  expect(screen.queryByText(otherResource.label)).toBeNull();
  await user.click(screen.getByRole('button', { name: '更多授权' }));
  expect(screen.getByRole('button', { name: '授权状态同步中' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '更多授权' }));
  await screen.findByRole('button', { name: '当前范围已授权' });
  expect(screen.queryByRole('button', { name: '更多授权' })).toBeNull();
  expect(screen.queryByText(/资料与授权同步中/)).toBeNull();
  expect(fixture.requests.filter(url => /\/(resources|grants)$/.test(url.pathname)).map(url => url.search)).toEqual([
    '?cursor=resources-next', '?cursor=grants-next', '?cursor=grants-last',
  ]);
  expect(fixture.commands).toHaveLength(0);
});

it('旧会话的授权续页迟到不清掉新视图游标或误授权，仍可重新加载', async () => {
  const initial = snapshot([resource], []); initial.grants.next_cursor = 'old-page';
  const fixture = server(initial, [resource]);
  const previousFetch = globalThis.fetch;
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => new URL(url).pathname.endsWith('/grants')
    ? new Promise<Response>(resolve => { finish = resolve; }) : previousFetch(url, init));
  const user = userEvent.setup();
  render(<Conversation client={client} />);
  await screen.findByRole('heading', { name: session.title });
  await user.click(screen.getByRole('button', { name: '更多授权' }));
  await user.selectOptions(screen.getByLabelText('会话'), secondId);
  await act(async () => { finish(Response.json(page([{ ...grant, scope: { workspace_id: id, session_id: id } }]))); });
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  expect(screen.getByRole('button', { name: '更多授权' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '授权状态同步中' })).toBeTruthy();
  expect(fixture.commands).toHaveLength(0);
});
