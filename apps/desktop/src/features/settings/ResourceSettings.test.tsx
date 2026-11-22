import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { createRuntimeStore } from '../../state/runtime-store';
import { applyDeletion } from '../../api/events';
import { grant, resource, id, secondId, page, event } from '../../test/fixtures';
import Settings from './Settings';
afterEach(() => vi.unstubAllGlobals());
it('授权用后续页的真实会话标题，撤销仍使用原授权和版本', async () => {
  const workspace = { id, version: 1, name: '资料项目', directory_resource_id: null };
  const owner = { id: secondId, version: 1, title: '校对交付稿', workspace_id: workspace.id, agent_profile_id: id, kind: 'interaction', archived: false };
  const firstSession = { ...owner, id, title: '首页其他会话' };
  const scoped = { ...grant, version: 4, scope: { kind: 'session', workspace_id: workspace.id, session_id: owner.id } };
  const queriedSessionPages: [string, string | null][] = [];
  const writes: [string, number][] = [];
  let revoked = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const { pathname: path, searchParams } = new URL(url);
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/workspaces')) return Response.json(page([workspace]));
    if (path.endsWith('/snapshot')) return Response.json({ workspace, sessions: { ...page([firstSession]), next_cursor: 'session-tail' }, active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([resource]), grants: page([]), watermark: event.event_id });
    if (path.endsWith('/sessions')) {
      queriedSessionPages.push([path, searchParams.get('cursor')]);
      return Response.json({ ...page([owner]), next_cursor: 'unneeded-tail' });
    }
    if (path === `/v4/grants/${scoped.id}/revoke` && init.method === 'POST') {
      writes.push([path, JSON.parse(String(init.body)).expected_version]);
      revoked = true;
      return Response.json({ id: scoped.id, scope: scoped.scope, epoch: 2, status: 'revoked' });
    }
    if (path.endsWith('/resources')) return Response.json(page([resource]));
    if (path.endsWith('/grants')) return Response.json(page([revoked ? { ...scoped, status: 'revoked', version: 5, epoch: 2 } : scoped]));
    throw new Error(`意外请求 ${path}`);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
  const user = userEvent.setup();
  render(<Settings client={client} section="resources" />);
  await screen.findByText(resource.label);
  expect(screen.getAllByRole('heading', { name: '资料与授权' })).toHaveLength(1);
  await user.click(screen.getByText('授权范围详情'));
  expect(await screen.findByText('校对交付稿')).toBeTruthy();
  expect(screen.queryByText(firstSession.title)).toBeNull();
  expect(queriedSessionPages).toEqual([[`/v4/workspaces/${workspace.id}/sessions`, 'session-tail']]);
  expect(screen.getByRole('region', { name: '授权管理' }).textContent).not.toMatch(/00000000-0000/);
  await user.click(screen.getByRole('button', { name: '撤销这份授权并保留历史' }));
  await user.click(screen.getByRole('button', { name: '确认撤销整份授权' }));
  await screen.findByText(/指定会话.*已撤销/);
  expect(writes).toEqual([[`/v4/grants/${scoped.id}/revoke`, 4]]);
});
it('授权命令响应丢失后关闭/重开设置，仍以窗口内冻结命令重试', async () => {
  const bodies: unknown[] = []; let revoked = false;
  const workspace = { id, version: 1, name: '资料项目', directory_resource_id: null };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') { bodies.push(JSON.parse(init.body as string)); if (bodies.length === 1) throw new TypeError('response lost'); revoked = true; return Response.json({ id: grant.id, scope: grant.scope, epoch: 2, status: 'revoked' }); }
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/workspaces')) return Response.json(page([workspace]));
    if (path.endsWith('/snapshot')) return Response.json({ workspace, sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([resource]), grants: page([grant]), watermark: event.event_id });
    return Response.json(path.endsWith('/resources') ? page([resource]) : page([{ ...grant, ...(revoked ? { status: 'revoked', version: 2, epoch: 2 } : {}) }]));
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
  const store = createRuntimeStore(client); const user = userEvent.setup();
  const view = render(<Settings client={client} section="resources" runtimeStore={store} />);
  await user.click(await screen.findByRole('button', { name: '撤销这份授权并保留历史' }));
  await user.click(screen.getByRole('button', { name: '确认撤销整份授权' }));
  await screen.findByText('撤销提交状态待确认；尚未确认撤销');
  view.rerender(<></>); view.rerender(<Settings client={client} section="resources" runtimeStore={store} />);
  await user.click(await screen.findByRole('button', { name: '使用原命令重试撤销' }));
  await waitFor(() => expect(bodies).toHaveLength(2)); expect(bodies[1]).toEqual(bodies[0]);
  await screen.findByText(/整个项目.*已撤销/);
});
it('项目删除立即清理资料设置的项目选择与授权缓存，旧查询不能恢复标题', async () => {
  const workspace = { id, version: 1, name: '待删除资料项目', directory_resource_id: null };
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/events')) return new Response(new ReadableStream());
    if (url.endsWith('/snapshot')) return Response.json({ workspace, sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([resource]), grants: page([grant]), watermark: event.event_id });
    return Response.json(url.endsWith('/workspaces') ? page([workspace]) : url.endsWith('/resources') ? page([resource]) : page([grant]));
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 }); const store = createRuntimeStore(client);
  render(<Settings client={client} section="resources" runtimeStore={store} />); await screen.findByText(resource.label);
  await act(async () => { store.update(state => applyDeletion(state, { scope: { kind: 'workspace', workspace_id: id, session_id: null }, epoch: 2, status: 'deleted' })); });
  expect(screen.queryByRole('option', { name: workspace.name })).toBeNull(); expect(screen.queryByText(resource.label)).toBeNull();
});
