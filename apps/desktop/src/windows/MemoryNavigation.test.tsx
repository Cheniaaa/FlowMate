import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../api/client';
import { openSettings, showWorkbench, type SettingsNavigation, type WorkbenchRequest } from '../api/windows';
import { expectComposerModel, selectComposerModel } from '../test/composer-model';
import { agent, connection, event, grant, id, model, page, resource, secondId } from '../test/fixtures';
import WorkbenchWindow from './WorkbenchWindow';
import QuickAssistant from './QuickAssistant';
import { memory, memoryGrant, memoryPolicy } from '../test/memory-fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

function boundary(withMemory = false, crossProject: false | 'project' | 'personal' = false) {
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
  const projectB = { ...workspace, id: secondId, name: '另一个项目' };
  const projectMemory: typeof memory = { ...memory, scope: { kind: 'workspace', workspace_id: secondId, session_id: null }, status: 'confirmed' };
  const personalMemory: typeof memory = { ...projectMemory, scope: memory.scope };
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>[]>();
  let valid = true;
  let readsPending: Promise<void> | undefined;
  const session = { id, workspace_id: id, version: 1, title: '原会话', agent_profile_id: id, kind: 'interaction', archived: false };
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/v3', ''); paths.push(path);
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      streams.set(path, [...streams.get(path) ?? [], controller]);
    } }));
    if (path === '/memory/records') {
      if (crossProject === 'personal' && parsed.searchParams.get('scope_kind') === 'user_global') {
        if (parsed.searchParams.has('profile_rules')) {
          await readsPending;
          return Response.json(page(valid ? [personalMemory] : []));
        }
        return Response.json(page([personalMemory]));
      }
      return Response.json(page(crossProject === 'project' && parsed.searchParams.get('workspace_id') === secondId
        ? [projectMemory] : withMemory ? [memory] : []));
    }
    if (path === `/memory/records/${memory.id}`) return Response.json(crossProject === 'personal' ? personalMemory : crossProject ? projectMemory : memory);
    if (path === `/memory/records/${memory.id}/evidence`) {
      await readsPending;
      return Response.json(page(memory.evidence.map(evidence => ({ evidence, available: valid, reason: valid ? null : 'scope_revoked' }))));
    }
    if (path.endsWith('/excerpt')) {
      const text = '项目 B 原依据';
      return Response.json({ record_id: memory.id, record_revision: memory.revision, evidence: memory.evidence[0], source_label: '项目 B 对话',
        reason: null, excerpt: { text, start: 0, end: text.length, total_chars: text.length, source_version: memory.evidence[0].source_version } });
    }
    if (path === '/memory/grants') return Response.json(page(crossProject === 'personal' ? [memoryGrant] : []));
    if (path.endsWith('/maintenance') || path === '/tasks') return Response.json(page([]));
    if (path === '/settings/memory') return Response.json(memoryPolicy);
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/runs') || path.endsWith('/messages')) return Response.json(page([]));
    const values: Record<string, unknown> = {
      '/workspaces': page(crossProject ? [workspace, projectB] : [workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
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
    holdReads() {
      let resume!: () => void;
      readsPending = new Promise<void>(resolve => { resume = resolve; });
      return resume;
    },
    async revokeInProjectB() {
      valid = false;
      const eventId = String(BigInt(event.event_id) + 10n);
      const wire = { kind: 'durable', event_id: eventId, event: { ...event, kind: 'grant.revoked', event_id: eventId,
        workspace_id: secondId, session_id: null, run_id: null, seq: null, payload: { resources: [], grants: [{
          ...grant, version: 2, epoch: 2, status: 'revoked', scope: { kind: 'workspace', workspace_id: secondId, session_id: null },
        }] } } };
      await act(async () => {
        for (const stream of streams.get(`/workspaces/${secondId}/events`) ?? [])
          stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`));
        if (crossProject === 'personal') {
          const globalId = String(BigInt(eventId) + 1n);
          const signal = { kind: 'durable', event_id: globalId, event: { ...event, kind: 'memory.changed',
            event_id: globalId, workspace_id: null, session_id: null, run_id: null, seq: null, causation_id: null,
            payload: { records: [], policies: [] } } };
          for (const stream of streams.get(`/workspaces/${id}/events`) ?? [])
            stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(signal)}\n\n`));
        }
      });
    },
    async wake(name: 'workbench-navigation' | 'settings-navigation') {
      await act(async () => { callbacks.get(name)!({ id: 1, event: name, payload: null }); });
    },
  };
}

it('项目 A 的工作台选中 B 后，只发往 B 事件流的撤权立即收回记忆与节选', async () => {
  const api = boundary(false, 'project'), user = userEvent.setup();
  render(<WorkbenchWindow client={api.client} />);
  await screen.findByRole('heading', { name: '原会话' });
  await user.click(screen.getByTitle('记忆与成长'));
  await user.selectOptions(await screen.findByLabelText('记忆范围'), secondId);
  await screen.findByText(memory.text);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText('项目 B 原依据');
  expect(api.paths).toContain(`/workspaces/${id}/events`);
  await api.revokeInProjectB();
  expect(screen.queryByText('项目 B 原依据')).toBeNull();
  expect(screen.queryByText(memory.text)).toBeNull();
  await screen.findByText('来源已失效，记忆正文不可用');
  expect(api.paths).toContain(`/workspaces/${secondId}/events`);
});

it('A 仅收到全局失效信号时，在个人记忆和聊天排除预览均收回 B 的正文', async () => {
  const api = boundary(false, 'personal'), user = userEvent.setup();
  render(<WorkbenchWindow client={api.client} />);
  await screen.findByRole('heading', { name: '原会话' });
  await user.click(screen.getByLabelText('运行配置'));
  await user.click(await screen.findByText('本次排除单条记忆'));
  const preview = await screen.findByLabelText(`本次排除：${memory.text}`);
  await user.click(preview);
  await user.keyboard('{Escape}');
  await user.click(screen.getByTitle('记忆与成长'));
  await screen.findByText(memory.text);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText('项目 B 原依据');
  const resume = api.holdReads();
  await api.revokeInProjectB();
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.queryByText('项目 B 原依据')).toBeNull();
  expect(screen.queryByLabelText(`本次排除：${memory.text}`)).toBeNull();
  expect(api.paths).toContain(`/workspaces/${id}/events`);
  expect(api.paths).not.toContain(`/workspaces/${secondId}/events`);
  await act(async () => resume());
  await screen.findByText('来源已失效，记忆正文不可用');
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.queryByText('项目 B 原依据')).toBeNull();
  expect(screen.queryByLabelText(`本次排除：${memory.text}`)).toBeNull();
});

it('记忆和策略导航走正式查询，不误查Run，保持主小窗草稿/返回位置', async () => {
  const api = boundary(), user = userEvent.setup();
  const main = render(<WorkbenchWindow client={api.client} />), quick = render(<QuickAssistant client={api.client} />);
  const workbench = within(main.container), small = within(quick.container);
  await workbench.findByRole('heading', { name: '原会话' }); await small.findByRole('heading', { name: '原会话' });
  const mainInput = main.container.querySelector<HTMLTextAreaElement>('#message-input')!, quickInput = quick.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  await user.type(mainInput, '主窗草稿'); await selectComposerModel(user, id, workbench);
  await user.type(quickInput, '小窗草稿');
  expect(workbench.getByTitle('记忆与成长')).toBeTruthy();
  expect(small.getByTitle('记忆与成长')).toBeTruthy();
  await showWorkbench({ kind: 'memory' }); await api.wake('workbench-navigation');
  await openSettings('memory'); await api.wake('settings-navigation');
  const settings = screen.getByRole('dialog', { name: '设置' });
  await screen.findByLabelText('启用个人画像读取');
  expect(api.paths.some(path => path.startsWith('/runs/'))).toBe(false);
  expect(api.paths).toContain('/settings/memory');
  expect(workbench.queryByRole('alert')).toBeNull();
  expect(main.container.querySelector('#message-input')).toBe(mainInput); expect(mainInput.value).toBe('主窗草稿');
  expect(quick.container.querySelector('#message-input')).toBe(quickInput); expect(quickInput.value).toBe('小窗草稿');
  await user.click(within(settings).getByRole('button', { name: '完成' }));
  await user.click(await workbench.findByRole('button', { name: '返回对话与草稿' }));
  await expectComposerModel(user, id, workbench);
});

it('记忆页专注审阅，策略进入设置且返回原记忆页，关闭后恢复原草稿焦点', async () => {
  const api = boundary(), user = userEvent.setup(); render(<WorkbenchWindow client={api.client} />);
  await screen.findByRole('heading', { name: '原会话' });
  const input = screen.getByLabelText('消息'); await user.type(input, '从记忆管理返回的草稿');
  await selectComposerModel(user, id);
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await user.click(input);
  await showWorkbench({ kind: 'memory' }); await api.wake('workbench-navigation');
  await screen.findByRole('heading', { name: '记忆与成长' });
  expect(screen.queryByRole('checkbox', { name: /个人画像读取|自动记忆整理/ })).toBeNull();
  const memoryMenu = screen.getByRole('button', { name: '更多记忆管理' });
  await user.click(memoryMenu);
  fireEvent.click(await screen.findByRole('menuitem', { name: '管理读取与整理设置' }));
  const settings = screen.getByRole('dialog', { name: '设置' });
  expect(within(settings).getByRole('button', { name: '记忆与上下文' }).getAttribute('aria-pressed')).toBe('true');
  expect(within(settings).queryByRole('button', { name: '查看依据' })).toBeNull();
  await user.click(within(settings).getByRole('button', { name: '返回记忆与成长' }));
  await screen.findByRole('heading', { name: '记忆与成长' });
  await waitFor(() => expect(document.activeElement).toBe(memoryMenu));
  for (const closeSettings of ['Escape', '完成']) {
    await user.keyboard('{Enter}');
    const settingsItem = await screen.findByRole('menuitem', { name: '管理读取与整理设置' });
    settingsItem.focus();
    await user.keyboard('{Enter}');
    const opened = await screen.findByRole('dialog', { name: '设置' });
    await within(opened).findByLabelText('启用个人画像读取');
    if (closeSettings === 'Escape') await user.keyboard('{Escape}');
    else await user.click(within(opened).getByRole('button', { name: '完成' }));
    await screen.findByRole('heading', { name: '记忆与成长' });
    await waitFor(() => expect(document.activeElement).toBe(memoryMenu));
  }
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  expect(screen.getByLabelText('消息')).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe('从记忆管理返回的草稿');
  expect(screen.getByText(resource.label)).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(input));
  await expectComposerModel(user, id);
});

it('小窗记忆管理交唯一主窗，可返回小窗原输入，主窗草稿与模型各自保留', async () => {
  const api = boundary(true), user = userEvent.setup();
  const main = render(<WorkbenchWindow client={api.client} />), quick = render(<QuickAssistant client={api.client} />);
  const workbench = within(main.container), small = within(quick.container);
  await workbench.findByRole('heading', { name: '原会话' }); await small.findByRole('heading', { name: '原会话' });
  const mainInput = main.container.querySelector<HTMLTextAreaElement>('#message-input')!, quickInput = quick.container.querySelector<HTMLTextAreaElement>('#message-input')!;
  await user.type(mainInput, '主窗独立草稿'); await selectComposerModel(user, id, workbench);
  await user.type(quickInput, '小窗独立草稿');
  await user.click(small.getByTitle('记忆与成长'));
  expect(invoke).toHaveBeenCalledWith('show_workbench', { target: { kind: 'memory' } });
  await api.wake('workbench-navigation');
  await workbench.findByRole('heading', { name: '记忆与成长' });
  const review = within(await workbench.findByRole('region', { name: '记忆审阅' }));
  expect(await review.findByText(memory.text)).toBeTruthy();
  expect(review.getByText('适用范围：个人')).toBeTruthy();
  expect(review.getByRole('button', { name: '记住' })).toBeTruthy();
  expect(review.getByRole('button', { name: '拒绝' })).toBeTruthy();
  expect(review.queryByRole('button', { name: '删除' })).toBeNull();
  expect(small.queryByRole('heading', { name: '记忆与成长' })).toBeNull();
  await user.click(within(workbench.getByRole('region', { name: '记忆与成长' })).getByRole('button', { name: '返回快捷小窗' }));
  expect(invoke).toHaveBeenCalledWith('return_to_quick');
  expect((mainInput as HTMLTextAreaElement).value).toBe('主窗独立草稿');
  expect((quickInput as HTMLTextAreaElement).value).toBe('小窗独立草稿');
  await user.click(workbench.getByRole('button', { name: '返回对话与草稿' }));
  await expectComposerModel(user, id, workbench);
  await expectComposerModel(user, secondId, small);
});
