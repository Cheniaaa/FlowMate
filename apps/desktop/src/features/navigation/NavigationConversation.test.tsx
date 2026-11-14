import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { Conversation } from '../chat/Conversation';
import { id, secondId, page, agent, event } from '../../test/fixtures';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it('启动默认项目来自 navigation 身份，不把工作区首页第一项当日常', async () => {
  const other = { id, version: 1, name: '先创建的其它项目', directory_resource_id: null };
  const daily = { ...other, id: secondId, name: '改过名字的默认项目' };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/navigation')) return Response.json({ default_workspace_id: secondId, workspaces: page([{ workspace: daily, sessions: page([]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path.endsWith('/workspaces')) return Response.json(page([other, daily]));
    if (path.endsWith('/profiles')) return Response.json(page([agent]));
    if (path.endsWith('/directory')) return Response.json({ workspace_id: path.includes(secondId) ? secondId : id, workspace_version: 1, state: 'unlinked', resource: null, reason: null });
    if (path.endsWith('/snapshot')) { const workspace = path.includes(secondId) ? daily : other; return Response.json({ workspace, sessions: page([{ id: workspace.id, version: 1, workspace_id: workspace.id, title: workspace.id === secondId ? '默认会话' : '其它会话', agent_profile_id: id }]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id }); }
    return Response.json(page([]));
  });
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 2 })} />);
  await screen.findByRole('heading', { name: '默认会话' });
  expect((screen.getByLabelText('工作区') as HTMLSelectElement).value).toBe(secondId);
});
