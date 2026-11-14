import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { createRuntimeStore } from '../../state/runtime-store';
import { applyDeletion } from '../../api/events';
import { grant, resource, id, page, event } from '../../test/fixtures';
import Settings from './Settings';
afterEach(() => vi.unstubAllGlobals());
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
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 2 });
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
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 2 }); const store = createRuntimeStore(client);
  render(<Settings client={client} section="resources" runtimeStore={store} />); await screen.findByText(resource.label);
  await act(async () => { store.update(state => applyDeletion(state, { scope: { workspace_id: id, session_id: null }, epoch: 2, status: 'deleted' })); });
  expect(screen.queryByRole('option', { name: workspace.name })).toBeNull(); expect(screen.queryByText(resource.label)).toBeNull();
});
