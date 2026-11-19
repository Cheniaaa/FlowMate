import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../api/client';
import { showWorkbench, type WorkbenchRequest } from '../api/windows';
import { agent, connection, event, grant, id, model, page, resource } from '../test/fixtures';
import { mcpPage, mcpView } from '../test/mcp-fixtures';
import WorkbenchWindow from './WorkbenchWindow';
import QuickAssistant from './QuickAssistant';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('MCP 管理定位走能力库主窗，保留主小窗草稿并返回小窗', async () => {
  let navigation: WorkbenchRequest | null = null;
  const callbacks = new Map<string, EventCallback<null>>(), paths: string[] = [];
  vi.mocked(listen).mockImplementation(async (name, callback) => { callbacks.set(name, callback); return () => {}; });
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'window_settings') return { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
    if (name === 'take_settings_navigation') return null;
    if (name === 'take_workbench_navigation') { const result = navigation; navigation = null; return result; }
    if (name === 'show_workbench') { navigation = { target: (args as Pick<WorkbenchRequest, 'target'>).target, from_quick: true }; return; }
    if (name === 'set_quick_form_active' || name === 'return_to_quick') return;
    throw new Error('未定义的合成原生命令');
  });
  const workspace = { id, version: 1, name: '原项目', directory_resource_id: null };
  const session = { id, workspace_id: id, version: 1, title: '原会话', agent_profile_id: id, kind: 'interaction', archived: false };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', ''); paths.push(path);
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path === '/capabilities/mcp') return Response.json(mcpPage([mcpView]));
    if (path === '/capabilities/skills') return Response.json(page([]));
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/runs') || path.endsWith('/messages')) return Response.json(page([]));
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]),
        pending_questions: page([]), pending_approvals: page([]), resources: page([resource]), grants: page([grant]), watermark: event.event_id },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
    };
    if (!(path in values)) throw new Error('缺少合成查询夹具');
    return Response.json(values[path]);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:19013', token: 'synthetic', protocol_version: 3 });
  const main = render(<WorkbenchWindow client={client} />), quick = render(<QuickAssistant client={client} />);
  const mainUi = within(main.container), quickUi = within(quick.container);
  await mainUi.findByRole('heading', { name: '原会话' });
  await quickUi.findByRole('heading', { name: '原会话' });
  // jsdom 同页模拟两个 WebView，label 的全局 id 会重名；实际元素按容器定位。
  const mainDraft = main.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  const quickDraft = quick.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  fireEvent.change(mainDraft, { target: { value: '主窗草稿' } });
  fireEvent.change(quickDraft, { target: { value: '小窗草稿' } });
  mainDraft.focus();
  await showWorkbench({ kind: 'mcp', server_id: mcpView.config.id, workspace_id: null });
  await act(async () => { callbacks.get('workbench-navigation')!({ id: 1, event: 'workbench-navigation', payload: null }); });
  const library = await screen.findByRole('dialog', { name: '能力库' });
  expect(within(library).getByRole('tab', { name: 'MCP' }).getAttribute('aria-selected')).toBe('true');
  await within(library).findByRole('button', { name: /Local Notes/ });
  expect(paths.some(path => path.startsWith('/runs/'))).toBe(false);
  expect(mainDraft).toHaveProperty('value', '主窗草稿');
  expect(quickDraft).toHaveProperty('value', '小窗草稿');
  fireEvent.click(within(library).getByRole('button', { name: '返回快捷小窗' }));
  await act(async () => {});
  expect(invoke).toHaveBeenCalledWith('return_to_quick');
  expect(screen.queryByRole('dialog', { name: '能力库' })).toBeNull();
  expect(main.container.querySelector('#message-input')).toBe(mainDraft);
  expect(quick.container.querySelector('#message-input')).toBe(quickDraft);
});
