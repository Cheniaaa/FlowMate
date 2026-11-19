import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../api/client';
import { openSettings, showWorkbench, type SettingsNavigation, type WorkbenchRequest } from '../api/windows';
import { agent, connection, event, grant, id, model, page, resource, secondId } from '../test/fixtures';
import WorkbenchWindow from './WorkbenchWindow';
import QuickAssistant from './QuickAssistant';
import { memoryPolicy } from '../test/memory-fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

function boundary() {
  const callbacks = new Map<string, EventCallback<null>>();
  vi.mocked(listen).mockImplementation(async (name, callback) => { callbacks.set(name, callback); return () => {}; });
  let request: WorkbenchRequest | null = null, settings: SettingsNavigation | null = null;
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'window_settings') return { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
    if (name === 'take_workbench_navigation') { const value = request; request = null; return value; }
    if (name === 'take_settings_navigation') { const value = settings; settings = null; return value; }
    if (name === 'show_workbench') { request = { target: (args as Pick<WorkbenchRequest, 'target'>).target, from_quick: true }; return; }
    if (name === 'open_settings') { settings = { section: (args as Pick<SettingsNavigation, 'section'>).section, from_quick: true }; return; }
    if (name === 'set_quick_form_active' || name === 'return_to_quick') return;
    if (name === 'select_resources') return { resources: [resource] };
    throw new Error(`未定义原生命令 ${name}`);
  });
  const paths: string[] = [];
  const workspace = { id, version: 1, name: '原项目', directory_resource_id: null };
  const session = { id, workspace_id: id, version: 1, title: '原会话', agent_profile_id: id, kind: 'interaction', archived: false };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', ''); paths.push(path);
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path === '/memory/records' || path === '/memory/grants' || path === '/memory/maintenance' || path === '/tasks') return Response.json(page([]));
    if (path === '/settings/memory') return Response.json(memoryPolicy);
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/runs') || path.endsWith('/messages')) return Response.json(page([]));
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model, { ...model, id, model_id: 'other-model' }]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]),
        pending_approvals: page([]), resources: page([resource]), grants: page([grant]), watermark: event.event_id },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
    };
    if (!(path in values)) throw new Error(`尚无正式fixture ${path}`);
    return Response.json(values[path]);
  });
  return {
    client: new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 }), paths,
    async wake(name: 'workbench-navigation' | 'settings-navigation') {
      await act(async () => { callbacks.get(name)!({ id: 1, event: name, payload: null }); });
    },
  };
}

it('记忆和策略导航走正式查询，不误查Run，保持主小窗草稿/返回位置', async () => {
  const api = boundary(), user = userEvent.setup();
  const main = render(<WorkbenchWindow client={api.client} />), quick = render(<QuickAssistant client={api.client} />);
  const workbench = within(main.container), small = within(quick.container);
  await workbench.findByRole('heading', { name: '原会话' }); await small.findByRole('heading', { name: '原会话' });
  const mainInput = main.container.querySelector<HTMLTextAreaElement>('#message-input')!, quickInput = quick.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  await user.type(mainInput, '主窗草稿'); await user.selectOptions(workbench.getByLabelText('模型'), id);
  await user.type(quickInput, '小窗草稿');
  expect(workbench.getByTitle('记忆与成长')).toBeTruthy();
  expect(small.getByTitle('记忆与成长')).toBeTruthy();
  await showWorkbench({ kind: 'memory' }); await api.wake('workbench-navigation');
  await openSettings('memory'); await api.wake('settings-navigation');
  expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy();
  await screen.findByLabelText('启用个人画像读取');
  expect(api.paths.some(path => path.startsWith('/runs/'))).toBe(false);
  expect(api.paths).toContain('/settings/memory');
  expect(workbench.queryByRole('alert')).toBeNull();
  expect(main.container.querySelector('#message-input')).toBe(mainInput); expect(mainInput.value).toBe('主窗草稿');
  expect((workbench.getByLabelText('模型') as HTMLSelectElement).value).toBe(id);
  expect(quick.container.querySelector('#message-input')).toBe(quickInput); expect(quickInput.value).toBe('小窗草稿');
});

it('记忆页专注审阅，策略进入设置且返回原记忆页，关闭后恢复原草稿焦点', async () => {
  const api = boundary(), user = userEvent.setup(); render(<WorkbenchWindow client={api.client} />);
  await screen.findByRole('heading', { name: '原会话' });
  const input = screen.getByLabelText('消息'); await user.type(input, '从记忆管理返回的草稿');
  await user.selectOptions(screen.getByLabelText('模型'), id);
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await user.click(input);
  await showWorkbench({ kind: 'memory' }); await api.wake('workbench-navigation');
  await screen.findByRole('heading', { name: '记忆与成长' });
  expect(screen.queryByRole('checkbox', { name: /个人画像读取|自动记忆整理/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: '管理读取与整理设置' }));
  const settings = await screen.findByRole('dialog', { name: '设置' });
  expect(within(settings).getByRole('button', { name: '记忆与上下文' }).getAttribute('aria-pressed')).toBe('true');
  expect(within(settings).queryByRole('button', { name: '查看依据' })).toBeNull();
  await user.click(within(settings).getByRole('button', { name: '返回记忆与成长' }));
  await screen.findByRole('heading', { name: '记忆与成长' });
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  expect(screen.getByLabelText('消息')).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe('从记忆管理返回的草稿');
  expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe(id);
  expect(screen.getByText(resource.label)).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(input));
});

it('小窗记忆管理交唯一主窗，可返回小窗原输入，主窗草稿与模型各自保留', async () => {
  const api = boundary(), user = userEvent.setup();
  const main = render(<WorkbenchWindow client={api.client} />), quick = render(<QuickAssistant client={api.client} />);
  const workbench = within(main.container), small = within(quick.container);
  await workbench.findByRole('heading', { name: '原会话' }); await small.findByRole('heading', { name: '原会话' });
  const mainInput = main.container.querySelector<HTMLTextAreaElement>('#message-input')!, quickInput = quick.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  await user.type(mainInput, '主窗独立草稿'); await user.selectOptions(workbench.getByLabelText('模型'), id);
  await user.type(quickInput, '小窗独立草稿');
  await user.click(small.getByTitle('记忆与成长'));
  expect(invoke).toHaveBeenCalledWith('show_workbench', { target: { kind: 'memory' } });
  await api.wake('workbench-navigation');
  await workbench.findByRole('heading', { name: '记忆与成长' });
  expect(small.queryByRole('heading', { name: '记忆与成长' })).toBeNull();
  await user.click(within(workbench.getByRole('dialog', { name: '记忆与成长' })).getByRole('button', { name: '返回快捷小窗' }));
  expect(invoke).toHaveBeenCalledWith('return_to_quick');
  expect((mainInput as HTMLTextAreaElement).value).toBe('主窗独立草稿');
  expect((quickInput as HTMLTextAreaElement).value).toBe('小窗独立草稿');
  expect((workbench.getByLabelText('模型') as HTMLSelectElement).value).toBe(id);
  expect((small.getByLabelText('模型') as HTMLSelectElement).value).toBe(secondId);
});
