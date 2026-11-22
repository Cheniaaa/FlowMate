import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../src/api/client';
import type { WorkbenchRequest } from '../src/api/windows';
import { agent, connection, event, grant, id, model, page, resource, resultEntry, run, secondId } from '../src/test/fixtures';
import { evidence, evidenceId, importReceipt, job, source, sourcePage } from '../src/features/knowledge/knowledge-fixtures';
import { embeddingProfile, embeddingView, projectKnowledge } from '../src/features/knowledge/embedding-fixtures';
import WorkbenchWindow from '../src/windows/WorkbenchWindow';
import QuickAssistant from '../src/windows/QuickAssistant';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); localStorage.clear(); });

function boundary(delivery = false) {
  const callbacks = new Map<string, EventCallback<null>>(), streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const reads: string[] = [], writes: any[] = [], checks: string[] = [];
  const settingsWrites: any[] = [];
  let knowledgeSettings = projectKnowledge;
  const actions: any[] = [];
  let managedSource = source;
  let request: WorkbenchRequest | null = null, unknown = false, revoked = false;
  vi.mocked(listen).mockImplementation(async (name, callback) => { callbacks.set(name, callback); return () => {}; });
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === 'window_settings') return { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
    if (name === 'take_workbench_navigation') { const value = request; request = null; return value; }
    if (name === 'take_settings_navigation') return null;
    if (name === 'show_workbench') { request = { target: (args as Pick<WorkbenchRequest, 'target'>).target, from_quick: true }; return; }
    if (name === 'select_resources') return { resources: [{ ...resource, label: '说明.md' }] };
    if (name === 'set_quick_form_active' || name === 'return_to_quick') return;
    throw new Error(name);
  });
  const workspace = { id, version: 1, name: '当前项目', directory_resource_id: null };
  const session = { id, workspace_id: id, version: 1, title: '原会话', agent_profile_id: id, kind: 'interaction', archived: false };
  const output = { summary: '结论来自历史原文 [1]。', artifact_ids: [], handled_failures: [], unresolved: [],
    citations: [{ marker: 1, evidence_id: evidenceId }] };
  const completed = { ...run, state: 'completed', output };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v4', '');
    if (path.endsWith('/actions') && init.method === 'POST') {
      const body = JSON.parse(String(init.body)); actions.push(body);
      managedSource = { ...managedSource, revision: managedSource.revision + 1,
        status: ({ remove: 'removed', revoke: 'revoked', delete: 'deleted' } as const)[body.data.action as 'remove' | 'revoke' | 'delete'],
        cleanup_status: 'pending' };
      return Response.json(managedSource);
    }
    if (path.endsWith('/knowledge/settings') && init.method === 'PUT') {
      const body = JSON.parse(String(init.body)); settingsWrites.push(body);
      knowledgeSettings = { ...knowledgeSettings, revision: knowledgeSettings.revision + 1,
        desired_profile: body.data.embedding_profile, rebuild_job_id: secondId };
      return Response.json(knowledgeSettings);
    }
    if (init.method === 'POST' && path.endsWith('/imports')) {
      const body = JSON.parse(String(init.body)); writes.push(body);
      if (unknown) throw new TypeError('response lost');
      return Response.json({ ...importReceipt, command_id: body.meta.command_id }, { status: 202 });
    }
    reads.push(path);
    if (path.includes('/commands/')) { checks.push(path); return Response.json({ status: 'confirmed',
      result: { ...importReceipt, command_id: writes[0].meta.command_id } }); }
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); } }));
    if (path.endsWith('/context')) return Response.json({
      round: { run_id: id, state: 'completed', source_attention: false }, files: [], hidden_file_count: 0,
      history: null, latest_request: null, activities: page([]), units_per_currency: '1000000000',
      knowledge: revoked || managedSource.status === 'revoked' || managedSource.status === 'deleted' ? []
        : [{ evidence_id: evidenceId, name: source.label, start_line: 18, end_line: 20, historical: true }],
      hidden_knowledge_count: revoked || managedSource.status === 'revoked' || managedSource.status === 'deleted' ? 1 : 0,
    });
    if (path.endsWith('/knowledge/sources')) return Response.json(sourcePage([{ ...managedSource, status: revoked ? 'revoked' : managedSource.status }]));
    if (path.endsWith('/knowledge/jobs')) return Response.json(page([]));
    if (path === `/knowledge/jobs/${secondId}`) return Response.json({ ...job, id: secondId, kind: 'rebuild' });
    if (path.endsWith('/knowledge/settings')) return Response.json(knowledgeSettings);
    if (path.endsWith('/embedding-profiles')) return Response.json(page([embeddingProfile]));
    if (path.includes('/embedding-profiles/')) return Response.json(embeddingView);
    if (path.endsWith('/grants')) return Response.json(page([]));
    if (path.includes('/knowledge/evidence/')) return revoked || managedSource.status === 'revoked' || managedSource.status === 'deleted'
      ? Response.json({ error: { code: 'scope_revoked', safe_message: '资料已撤权', retryable: false, related_ids: [] } }, { status: 403 })
      : Response.json(evidence);
    if (path.endsWith('/results')) return Response.json(page(delivery ? [{ ...resultEntry, viewed_at: '2026-11-22T12:00:00Z' }] : []));
    if (path === `/tasks/${secondId}/result`) return Response.json({
      handle: resultEntry.result, state: 'completed', result_version: resultEntry.result_version,
      result: { ...output, status: 'completed', verification: [], evidence_refs: [evidenceId], structured_result: null },
      artifacts: [], dependencies: [], error: null,
    });
    if (path === `/sessions/${id}/runs`) return Response.json({ ...page([completed]), last_model_use: null });
    if (path === `/sessions/${id}/messages`) return Response.json(page([]));
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/runs') || path.endsWith('/maintenance')
      || path === '/tasks' || path === '/memory/records' || path === '/memory/grants') return Response.json(page([]));
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]),
        recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]),
        pending_approvals: page([]), resources: page([]), grants: page([grant]), watermark: event.event_id },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
    };
    if (!(path in values)) throw new Error(`未定义路径 ${path}`);
    return Response.json(values[path]);
  });
  return { client: new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 }),
    reads, writes, checks, settingsWrites, actions, loseResponse() { unknown = true; },
    async wake() { await act(async () => { callbacks.get('workbench-navigation')!({ id: 1, event: 'workbench-navigation', payload: null }); }); },
    async notice(workspaceId: string, position: number, revoke = false) {
      revoked = revoke;
      const event_id = String(BigInt(event.event_id) + BigInt(position));
      const wire = { kind: 'durable', event_id, event: { ...event, event_id, kind: 'knowledge.changed',
        workspace_id: workspaceId, session_id: null, run_id: null, seq: null,
        payload: { workspace_id: workspaceId, source_revisions: { [source.id]: position }, job_revisions: {},
          settings_revision: null, profile_revisions: {} } } };
      await act(async () => { for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`)); });
    },
    async revokeSource() {
      revoked = true;
      const event_id = String(BigInt(event.event_id) + 10n);
      const wire = { kind: 'durable', event_id, event: { ...event, event_id, kind: 'scope.revoked',
        workspace_id: id, session_id: null, run_id: null, seq: null,
        payload: { scopes: [{ id: source.id, epoch: 2, status: 'revoked',
          scope: { kind: 'workspace', workspace_id: id, session_id: null } }], deletions: [] } } };
      await act(async () => { for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`)); });
    } };
}

it('正式工作台资料入口保留草稿；其他项目事件不刷新，当前项目刷新不卸载详情', async () => {
  const api = boundary(), user = userEvent.setup();
  render(<WorkbenchWindow client={api.client} />);
  await screen.findByRole('heading', { name: '原会话' });
  const input = screen.getByLabelText('消息'); await user.type(input, '保留中文草稿');
  await user.click(screen.getByRole('button', { name: /^资料$/ }));
  await user.click(await screen.findByRole('button', { name: /项目说明.md/ }));
  const detail = screen.getByRole('region', { name: '资料详情' });
  const count = api.reads.filter(path => path.endsWith('/knowledge/sources')).length;
  await api.notice(secondId, 2);
  expect(api.reads.filter(path => path.endsWith('/knowledge/sources'))).toHaveLength(count);
  await api.notice(id, 3);
  await waitFor(() => expect(api.reads.filter(path => path.endsWith('/knowledge/sources'))).toHaveLength(count + 1));
  expect(screen.getByRole('region', { name: '资料详情' })).toBe(detail);
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  expect(screen.getByLabelText('消息')).toBe(input);
  expect((input as HTMLTextAreaElement).value).toBe('保留中文草稿');
});

it('附件提升 unknown 后转资料页按原 command 查回，只有一次导入', async () => {
  const api = boundary(), user = userEvent.setup(); api.loseResponse();
  render(<WorkbenchWindow client={api.client} />);
  await screen.findByRole('heading', { name: '原会话' });
  await user.type(screen.getByLabelText('消息'), '附件仍属当前草稿');
  await user.click(screen.getByRole('button', { name: '选择文本文件' }));
  await user.click(await screen.findByRole('button', { name: '附件「说明.md」的更多操作' }));
  await user.click(await screen.findByRole('menuitem', { name: '加入项目资料' }));
  await user.click(await screen.findByRole('button', { name: '加入所选 1 个文件' }));
  await screen.findByText(/接收状态待核对/);
  await user.click(screen.getByRole('button', { name: /^资料$/ }));
  await screen.findByText('已接收 1 个文件');
  expect(api.writes).toHaveLength(1);
  expect(api.checks).toEqual([`/workspaces/${id}/commands/${api.writes[0].meta.command_id}`]);
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('附件仍属当前草稿');
  expect(screen.getByText('说明.md')).toBeTruthy();
});

it('真实引用打开准确历史原文，通知撤权立即收回；关闭返回引用并保留输入', async () => {
  const api = boundary(), user = userEvent.setup();
  render(<WorkbenchWindow client={api.client} />);
  await screen.findByRole('heading', { name: '原会话' });
  await user.type(screen.getByLabelText('消息'), '引用旁的草稿');
  const citation = await screen.findByRole('button', { name: /^查看引用 1(?: ·|$)/ }); await user.click(citation);
  await screen.findByText('项目说明.md');
  expect(screen.getByText('答复引用时的内容，当前已有更新')).toBeTruthy();
  await user.click(screen.getByText('引用详情'));
  expect(screen.getByText('引用版本 1')).toBeTruthy();
  await api.notice(id, 4, true);
  expect(screen.queryByText(/第一段原文/)).toBeNull();
  await screen.findByText('资料已撤权');
  await user.click(screen.getByRole('button', { name: '关闭原文' }));
  await waitFor(() => expect(document.activeElement).toBe(citation));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('引用旁的草稿');
});

it.each(['evidence', 'knowledge'] as const)('快捷窗 %s 目标交给工作台，返回时两窗草稿保持', async kind => {
  const api = boundary(), user = userEvent.setup();
  const main = render(<WorkbenchWindow client={api.client} />), quick = render(<QuickAssistant client={api.client} />);
  const large = within(main.container), small = within(quick.container);
  await large.findByRole('heading', { name: '原会话' }); await small.findByRole('heading', { name: '原会话' });
  await user.type(main.container.querySelector<HTMLTextAreaElement>('#message-input')!, '主窗草稿');
  await user.type(quick.container.querySelector<HTMLTextAreaElement>('#message-input')!, '快捷草稿');
  await user.click(await small.findByRole('button', { name: kind === 'evidence' ? /^查看引用 1(?: ·|$)/ : '资料' }));
  expect(invoke).toHaveBeenCalledWith('show_workbench', { target: kind === 'evidence'
    ? { kind, workspace_id: id, evidence_id: evidenceId } : { kind, workspace_id: id, source_id: null } });
  await api.wake();
  if (kind === 'evidence') await screen.findByText('项目说明.md');
  else await large.findByRole('heading', { name: '项目资料' });
  await user.click(screen.getByRole('button', { name: '返回快捷小窗' }));
  expect(quick.container.querySelector<HTMLTextAreaElement>('#message-input')!.value).toBe('快捷草稿');
  expect((main.container.querySelector('#message-input') as HTMLTextAreaElement).value).toBe('主窗草稿');
});

it('公开后台交付中的引用可阅读，关闭后返回原交付而不丢原按钮焦点', async () => {
  const api = boundary(true), user = userEvent.setup();
  render(<WorkbenchWindow client={api.client} />);
  await screen.findByRole('heading', { name: '原会话' });
  await user.click(screen.getByRole('button', { name: /^结果$/ }));
  await user.click(await screen.findByRole('button', { name: '查看结果' }));
  const preview = await screen.findByRole('region', { name: '结果预览' });
  const citation = within(preview).getByRole('button', { name: /^查看引用 1(?: ·|$)/ });
  await user.click(citation);
  await screen.findByText('项目说明.md');
  await user.click(screen.getByRole('button', { name: '关闭原文' }));
  expect(screen.getByRole('region', { name: '结果预览' })).toBe(preview);
  await waitFor(() => expect(document.activeElement).toBe(citation));
});

it('当前来源 scope.revoked 水位同样立即收回原文', async () => {
  const api = boundary(), user = userEvent.setup();
  render(<WorkbenchWindow client={api.client} />);
  await user.click(await screen.findByRole('button', { name: /^查看引用 1(?: ·|$)/ }));
  await screen.findByText(/第一段原文/);
  await api.revokeSource();
  expect(screen.queryByText(/第一段原文/)).toBeNull();
  await screen.findByText('资料已撤权');
});

it('正式项目页选择检索修订并明确授权，进入独立设置后返回保留草稿和项目状态', async () => {
  const api = boundary(), user = userEvent.setup();
  render(<WorkbenchWindow client={api.client} />);
  await screen.findByRole('heading', { name: '原会话' });
  await user.type(screen.getByLabelText('消息'), '检索配置不改这条聊天草稿');
  await user.click(screen.getByRole('button', { name: /^资料$/ }));
  await user.click(screen.getByText('检索与发送设置'));
  await user.selectOptions(await screen.findByLabelText('项目检索方式'), `${embeddingProfile.id}:${embeddingProfile.revision}`);
  await user.click(await screen.findByRole('checkbox', { name: '允许本项目资料发送到所选检索服务' }));
  await user.click(screen.getByRole('button', { name: '保存检索选择' }));
  await screen.findByText('检索选择已保存');
  expect(api.settingsWrites[0].data.grants[0].destination).toBe(embeddingView.destination);
  await user.click(screen.getByRole('button', { name: '管理检索模型' }));
  const settings = await screen.findByRole('dialog', { name: '设置' });
  await within(settings).findByRole('button', { name: '新建检索模型' });
  expect(within(settings).getByRole('button', { name: '检索模型' }).getAttribute('aria-pressed')).toBe('true');
  await user.click(within(settings).getByRole('button', { name: '完成' }));
  expect((screen.getByLabelText('项目检索方式') as HTMLSelectElement).value).toBe(`${embeddingProfile.id}:${embeddingProfile.revision}`);
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('检索配置不改这条聊天草稿');
});

it('正式资料动作移出后仍可审阅已核验历史原文，再撤权则收回正文且草稿不丢', async () => {
  const api = boundary(), user = userEvent.setup();
  render(<WorkbenchWindow client={api.client} />);
  await screen.findByRole('heading', { name: '原会话' });
  await user.type(screen.getByLabelText('消息'), '来源动作保留原草稿');
  async function openSource() {
    await user.click(screen.getByRole('button', { name: /^资料$/ }));
    await user.click(await screen.findByRole('button', { name: /项目说明.md/ }));
    await user.click(screen.getByText('操作与处理记录'));
  }
  await openSource();
  await user.click(screen.getByRole('button', { name: '移出项目资料' }));
  await screen.findByText('已停止使用，后台正在清理。');
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  await user.click(await screen.findByRole('button', { name: /^查看引用 1(?: ·|$)/ }));
  await screen.findByText('资料已移出项目，当前查看答复所引的历史原文。');
  await screen.findByText(/第一段原文/);
  await user.click(screen.getByRole('button', { name: '关闭原文' }));
  await openSource();
  await user.click(screen.getByRole('button', { name: '停止使用' }));
  await user.click(screen.getByRole('button', { name: '确认停止使用' }));
  await screen.findByText('已停止使用，历史原文不再开放。');
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  await user.click(await screen.findByRole('button', { name: /^查看引用 1(?: ·|$)/ }));
  await screen.findByText('资料已撤权');
  expect(screen.queryByText(/第一段原文/)).toBeNull();
  expect(api.actions.map(action => action.data.action)).toEqual(['remove', 'revoke']);
});
