import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { id, secondId, page, run, event, resource } from '../../test/fixtures';
import ProjectSidebar from './ProjectSidebar';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); localStorage.clear(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 2 });
const workspace = { id, version: 1, name: '研究项目', directory_resource_id: null };
const session = { id: secondId, version: 1, workspace_id: id, title: '真实会话', agent_profile_id: id };
function server() {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    const values: Record<string, unknown> = { '/v2/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 1 }]), recent_sessions: page([session]), pending_count: 1, watermark: event.event_id },
      '/v2/navigation/sessions': page([session]), '/v2/tasks': page([{ ...run, session_id: secondId }]), '/v2/inbox': page([{ id, kind: 'question', workspace_id: id, session_id: secondId, run_id: id,
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
