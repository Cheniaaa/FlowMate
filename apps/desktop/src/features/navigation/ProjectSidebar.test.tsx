import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { id, secondId, page, run, event, resource } from '../../test/fixtures';
import type { InboxPage } from '../../generated/contracts';
import ProjectSidebar from './ProjectSidebar';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); localStorage.clear(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
const workspace = { id, version: 1, name: '研究项目', directory_resource_id: null };
const session = { id: secondId, version: 1, workspace_id: id, title: '真实会话', agent_profile_id: id, kind: 'interaction', archived: false };
function server() {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    const values: Record<string, unknown> = { '/v3/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 1 }]), recent_sessions: page([session]), pending_count: 1, watermark: event.event_id },
      '/v3/navigation/sessions': page([session]), '/v3/tasks': page([{ ...run, interaction_session_id: secondId, execution_session_id: secondId }]), '/v3/inbox': page([{ id, kind: 'question', workspace_id: id, session_id: secondId, run_id: id,
        question: { id, version: 1, run_id: id, task_id: id, call_id: 'ask', message_id: id, question: '确认范围', answer_schema: { type: 'string' }, status: 'pending', answer_message_id: null, dependencies: [] } }]) };
    return Response.json(values[path]);
  });
}
it('默认项目按身份导航，最近创建与待办保持真实 owner；折叠只持久化偏好', async () => {
  server(); const navigate = vi.fn(); const user = userEvent.setup();
  render(<ProjectSidebar client={client} onNavigate={navigate} onCreated={() => {}} onSettings={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '日常助理' }));
  expect(navigate).toHaveBeenLastCalledWith({ workspaceId: id });
  await user.click(screen.getByRole('button', { name: '最近创建' }));
  await user.click(await screen.findByRole('button', { name: '真实会话' }));
  expect(navigate).toHaveBeenLastCalledWith({ workspaceId: id, sessionId: secondId });
  await user.click(screen.getByRole('button', { name: /待办/ }));
  await user.click(await screen.findByRole('button', { name: '确认范围' }));
  expect(navigate).toHaveBeenLastCalledWith({ workspaceId: id, sessionId: secondId, runId: id });
  await user.click(screen.getByRole('button', { name: '折叠侧栏' }));
  expect(localStorage.getItem('flowmate.sidebar.collapsed')).toBe('true');
  expect(localStorage.length).toBe(1);
});
it('从目录创建响应丢失后只核对/原命令重试，不重开 picker', async () => {
  server(); vi.mocked(invoke).mockRejectedValueOnce(new Error('响应丢失')).mockResolvedValueOnce({ status: 'not_found', result: null })
    .mockResolvedValueOnce({ workspace, directory: { ...resource, kind: 'directory' } });
  const created = vi.fn(); const user = userEvent.setup();
  render(<ProjectSidebar client={client} onNavigate={() => {}} onCreated={created} onSettings={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '新建项目' }));
  await user.type(screen.getByLabelText('项目名称'), '目录研究');
  await user.click(screen.getByRole('button', { name: '从目录创建' }));
  await screen.findByText(/响应丢失/);
  const args = vi.mocked(invoke).mock.calls[0][1];
  await user.click(screen.getByRole('button', { name: '核对目录创建' }));
  expect(created).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '重试目录创建' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('retry_workspace_from_directory', args));
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'create_workspace_from_directory')).toHaveLength(1);
  expect(created).toHaveBeenCalledWith(workspace);
});
it('quick 不提供 main-only 从目录创建命令', async () => {
  server(); const user = userEvent.setup();
  render(<ProjectSidebar client={client} onNavigate={() => {}} onCreated={() => {}} onSettings={() => {}} allowDirectoryCreation={false} />);
  await user.click(await screen.findByRole('button', { name: '新建项目' }));
  expect(screen.queryByRole('button', { name: '从目录创建' })).toBeNull();
});
it('新建会话入口与项目创建分开，移动抽屉可以明确关闭', async () => {
  server(); const create = vi.fn(); const user = userEvent.setup();
  render(<ProjectSidebar client={client} onNavigate={() => {}} onCreated={() => {}} onSettings={() => {}} onNewSession={create} />);
  await user.click(await screen.findByRole('button', { name: '新建会话' })); expect(create).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: '打开项目导航' }));
  await user.click(screen.getByRole('button', { name: '关闭项目导航' }));
  expect(document.querySelector('.sidebar--open')).toBeNull();
});
it('永久删除围栏过滤导航缓存与迟到全局查询，不恢复项目/会话/待办私有标题', async () => {
  server(); const user = userEvent.setup();
  const props = { client, onNavigate: vi.fn(), onCreated: vi.fn(), onSettings: vi.fn() };
  const view = render(<ProjectSidebar {...props} />); await screen.findByRole('button', { name: '真实会话' });
  view.rerender(<ProjectSidebar {...props} deletedSessionIds={[secondId]} />);
  await user.click(screen.getByRole('button', { name: '最近创建' })); expect(screen.queryByRole('button', { name: '真实会话' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /待办/ })); expect(screen.queryByRole('button', { name: '确认范围' })).toBeNull();
  view.rerender(<ProjectSidebar {...props} deletedWorkspaceIds={[id]} deletedSessionIds={[secondId]} />);
  await user.click(screen.getByRole('button', { name: '刷新导航' })); await user.click(screen.getByRole('button', { name: '项目' }));
  expect(screen.queryByText(/研究项目/)).toBeNull(); expect((screen.getByRole('button', { name: '日常助理' }) as HTMLButtonElement).disabled).toBe(true);
});

it('重投事件水位推进后待办4→3自动刷新，保留已加载项目/会话尾页与续页位置，不抢当前选择/焦点', async () => {
  const tailWorkspace = { ...workspace, id: '00000000-0000-4000-8000-000000000003', name: '尾页当前项目' };
  const tailSession = { ...session, id: '00000000-0000-4000-8000-000000000004', title: '已加载的会话尾页' };
  const targetSession = { ...session, id: '00000000-0000-4000-8000-000000000005', workspace_id: tailWorkspace.id, title: '当前目标会话' };
  const watermark = (BigInt(event.event_id) + 1n).toString();
  let pendingCount = 4;
  let finishRefresh!: (response: Response) => void;
  const refreshed = new Promise<Response>(resolve => { finishRefresh = resolve; });
  const requests: string[] = [];
  function navigation(cursor: string | null) {
    const currentPage = { ...page(cursor
      ? [{ workspace: tailWorkspace, sessions: page([targetSession]), pending_count: pendingCount }]
      : [{ workspace, sessions: { ...page([session]), next_cursor: 'session-tail' }, pending_count: 0 }]),
      next_cursor: cursor ? 'project-next' : 'project-tail', watermark: pendingCount === 4 ? event.event_id : watermark };
    return { default_workspace_id: id, workspaces: currentPage, recent_sessions: page([session]), pending_count: pendingCount, watermark: currentPage.watermark };
  }
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url); requests.push(parsed.pathname + parsed.search);
    if (parsed.pathname === `/v3/workspaces/${id}/sessions`) return Response.json({ ...page([tailSession]), next_cursor: 'session-next' });
    if (parsed.pathname === '/v3/navigation') {
      if (pendingCount === 3 && !parsed.searchParams.has('cursor')) return refreshed.then(response => response.clone());
      return Response.json(navigation(parsed.searchParams.get('cursor')));
    }
    throw new Error(`未定义HTTP ${parsed.pathname}`);
  });
  const navigate = vi.fn(), props = { client, onNavigate: navigate, onCreated: vi.fn(), onSettings: vi.fn() };
  const view = render(<ProjectSidebar {...props} refreshKey={event.event_id} />);
  await screen.findByRole('button', { name: /待办 4/ });
  await userEvent.click(screen.getByRole('button', { name: '更多项目会话' }));
  await screen.findByRole('button', { name: tailSession.title });
  await userEvent.click(screen.getByRole('button', { name: '更多项目' }));
  const target = await screen.findByRole('button', { name: targetSession.title });
  await userEvent.click(target);
  expect(navigate).toHaveBeenLastCalledWith({ workspaceId: tailWorkspace.id, sessionId: targetSession.id });
  pendingCount = 3;
  view.rerender(<ProjectSidebar {...props} refreshKey={watermark} />);
  expect(screen.getByRole('button', { name: targetSession.title })).toBe(target);
  expect(screen.getByRole('button', { name: tailSession.title })).toBeTruthy();
  expect(document.activeElement).toBe(target);
  await act(async () => { finishRefresh(Response.json(navigation(null))); });
  await screen.findByRole('button', { name: /待办 3/ });
  expect(screen.getByRole('button', { name: '尾页当前项目' }).textContent).toContain('3');
  expect(screen.getByRole('button', { name: tailSession.title })).toBeTruthy();
  expect(screen.getByRole('button', { name: targetSession.title })).toBe(target);
  expect(document.activeElement).toBe(target);
  expect(navigate).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: '刷新导航' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '刷新导航' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole('button', { name: tailSession.title })).toBeTruthy();
  expect(screen.getByRole('button', { name: targetSession.title })).toBe(target);
  const firstProject = screen.getByRole('button', { name: '研究项目' }).closest('section')!;
  await userEvent.click(within(firstProject).getByRole('button', { name: '更多项目会话' }));
  expect(requests.at(-1)).toBe(`/v3/workspaces/${id}/sessions?cursor=session-next`);
  await userEvent.click(screen.getByRole('button', { name: '更多项目' }));
  expect(requests.at(-1)).toBe('/v3/navigation?cursor=project-next');
});

it('导航旧水位响应不把已更新的待办3回退成4，也不切换当前导航分区', async () => {
  let older = false;
  vi.stubGlobal('fetch', async (url: string) => {
    if (new URL(url).pathname === '/v3/navigation/sessions') return Response.json(page([session]));
    return Response.json({
      default_workspace_id: id,
      workspaces: page([{ workspace, sessions: page([session]), pending_count: older ? 4 : 3 }]),
      recent_sessions: page([session]), pending_count: older ? 4 : 3,
      watermark: older ? event.event_id : (BigInt(event.event_id) + 1n).toString(),
    });
  });
  const user = userEvent.setup();
  render(<ProjectSidebar client={client} onNavigate={vi.fn()} onCreated={vi.fn()} onSettings={vi.fn()} />);
  await screen.findByRole('button', { name: /待办 3/ });
  await user.click(screen.getByRole('button', { name: '最近创建' }));
  await screen.findByRole('region', { name: '最近创建会话' });
  older = true;
  await user.click(screen.getByRole('button', { name: '刷新导航' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '刷新导航' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole('button', { name: /待办 3/ })).toBeTruthy();
  expect(screen.getByRole('region', { name: '最近创建会话' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '项目' }));
  expect(screen.getByRole('button', { name: '研究项目' }).textContent).toContain('3');
});

it('全局待办复用导航已知名称，跨项目相同问题/恢复原因仍显示准确Task并操作原对象，未知项目不额外查询', async () => {
  server(); const previous = globalThis.fetch, paths: string[] = [];
  const otherTask = '00000000-0000-4000-8000-000000000031';
  const question = (workspace_id: string): InboxPage['items'][number] => ({ id: workspace_id, kind: 'question', workspace_id, session_id: workspace_id, run_id: workspace_id,
    question: { id: workspace_id, version: 1, run_id: workspace_id, task_id: workspace_id === id ? run.root_task_id : otherTask,
      call_id: 'ask', message_id: workspace_id, question: '同文案问题', answer_schema: { type: 'string' }, status: 'pending', answer_message_id: null, dependencies: [] } });
  const recovery: InboxPage['items'][number] = { id: secondId, kind: 'recovery', workspace_id: secondId, session_id: secondId,
    run_id: secondId, task_id: otherTask, version: 3, reason: 'runtime_restart', allowed_actions: [{ kind: 'cancel_run', target_id: secondId, expected_version: 3 }] };
  const items = [question(id), question(secondId), recovery];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname; paths.push(path);
    return path === '/v3/inbox' ? Response.json(page(items)) : previous(url, init);
  });
  const onPendingOpen = vi.fn(), onPendingAction = vi.fn().mockResolvedValue(undefined);
  render(<ProjectSidebar client={client} onNavigate={vi.fn()} onCreated={vi.fn()} onSettings={vi.fn()} onPendingOpen={onPendingOpen} onPendingAction={onPendingAction} />);
  await screen.findByRole('button', { name: '真实会话' });
  await userEvent.click(screen.getByTitle('待办'));
  const cards = await screen.findAllByRole('article');
  expect(within(cards[0]).getByText('研究项目')).toBeTruthy();
  expect(within(cards[0]).getByText(id)).toBeTruthy();
  expect(within(cards[0]).getByText(run.root_task_id)).toBeTruthy();
  expect(within(cards[1]).getByText(secondId)).toBeTruthy();
  expect(within(cards[1]).getByText(otherTask)).toBeTruthy();
  expect(within(cards[1]).queryByText('研究项目')).toBeNull();
  await userEvent.click(within(cards[1]).getByRole('button', { name: '同文案问题' }));
  expect(onPendingOpen).toHaveBeenCalledWith(items[1]);
  await userEvent.click(within(cards[2]).getByRole('button', { name: '停止此任务' }));
  expect(onPendingAction).toHaveBeenCalledWith(recovery, { kind: 'cancel_run', target_id: secondId, expected_version: 3 });
  expect(paths.every(path => path === '/v3/navigation' || path === '/v3/inbox')).toBe(true);
});
