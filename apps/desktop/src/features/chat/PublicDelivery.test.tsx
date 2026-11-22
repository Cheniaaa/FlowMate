import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { SessionInboxEntry } from '../../generated/contracts';
import { agent, connection, event, id, model, page, secondId } from '../../test/fixtures';
import { Conversation } from './Conversation';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));

it('两窗同步撤销状态，重开历史时收回交付正文', async () => {
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  const workspace = { id, version: 1, name: '交付测试项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '原会话', agent_profile_id: id, kind: 'interaction', archived: false };
  const dep = { scope_id: secondId, epoch: 1 };
  const base = { run_id: id, activity_id: null, private_ref: null, event_id: '2', event_index: 0 };
  const report = { ...base, id, origin: 'background_report', role: 'assistant',
    parts: [{ kind: 'text', text: '已交付的报告正文' }], source_dependencies: [dep] };
  const reference = { ...base, id: secondId, event_index: 1, origin: 'task_result', role: 'user',
    parts: [], source_dependencies: [] };
  const entry: SessionInboxEntry = {
    id: secondId, version: 1, source_event_id: '2', target_session_id: id,
    result: { run_id: id, task_id: secondId, lifetime: 'managed', submitted_state: 'completed' },
    result_version: 1, delivery_state: 'delivered', viewed_at: null, dependencies: [dep],
    attempts: 1, last_error: null, source_valid: true, consumers: [],
  };
  let sourceValid = true;
  const views: ReturnType<typeof render>[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start: controller => { streams.push(controller); } }));
    if (path.endsWith('/messages')) return Response.json(page([{ ...report, source_valid: sourceValid }, reference]));
    if (path === `/sessions/${id}/results`) return Response.json({
      ...page([{ ...entry, source_valid: sourceValid }]), watermark: sourceValid ? '2' : '3',
    });
    if (['/commands', '/follow-ups', '/runs'].some(suffix => path.endsWith(suffix))) return Response.json(page([]));
    const routes: Record<string, unknown> = {
      [`/sessions/${id}`]: session,
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]),
        pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: '1' },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]),
        recent_sessions: page([]), pending_count: 0, watermark: '1' },
    };
    if (!(path in routes)) throw new Error(`未定义的测试查询 ${path}`);
    return Response.json(routes[path]);
  });
  try {
    views.push(render(<Conversation client={client()} />), render(<Conversation client={client()} compact />));
    const hidden = '历史交付 · 来源已失效';
    for (const [index, view] of views.entries()) {
      const window = within(view.container);
      await window.findByText('已交付的报告正文');
      expect(window.queryByText(hidden)).toBeNull();
      fireEvent.change(view.container.querySelector('textarea')!, { target: { value: `草稿 ${index + 1}` } });
    }
    await waitFor(() => expect(streams).toHaveLength(2));
    sourceValid = false;
    await act(async () => {
      const payload = { scopes: [{ id: secondId, scope: { kind: 'session', workspace_id: id, session_id: id },
        epoch: 2, status: 'revoked' }], deletions: [] };
      const encoded = new TextEncoder().encode(`data: ${JSON.stringify({
        kind: 'durable', event_id: '3', event: { ...event, kind: 'scope.revoked', event_id: '3',
          workspace_id: id, session_id: id, payload },
      })}\n\n`);
      for (const stream of streams) stream.enqueue(encoded);
    });
    for (const [index, view] of views.entries()) {
      const window = within(view.container);
      expect(within(await window.findByRole('article', { name: '后台交付' })).getByText(hidden)).toBeTruthy();
      expect(window.queryByText('已交付的报告正文')).toBeNull();
      expect(window.getByRole('article', { name: '任务交付引用' }).textContent).toContain('已接收任务交付');
      expect(view.container.querySelector('textarea')?.value).toBe(`草稿 ${index + 1}`);
    }
    const mainReport = within(views[0].container).getByRole('article', { name: '后台交付' });
    fireEvent.click(within(mainReport).getByRole('button', { name: '打开结果收件箱' }));
    const inbox = within(await screen.findByRole('region', { name: '结果收件箱' }));
    await inbox.findByText('来源已失效，正文不可用');
    expect(inbox.queryByRole('button', { name: '查看结果' })).toBeNull();
    expect(inbox.getByRole('button', { name: '在会话中总结' })).toHaveProperty('disabled', true);
    for (const view of views) view.unmount();
    const reopened = render(<Conversation client={client()} />);
    views.push(reopened);
    const history = within(reopened.container);
    await history.findByText(hidden);
    expect(history.queryByText('已交付的报告正文')).toBeNull();
  } finally {
    for (const view of views) view.unmount();
    vi.unstubAllGlobals();
  }
});

it.each([[false, false], [true, false], [false, true]])('从聊天精确查看关联投递并保留草稿（compact=%s，合并=%s）', async (compact, grouped) => {
  const user = userEvent.setup();
  const workspace = { id, version: 1, name: '交付项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '交付会话', agent_profile_id: id, kind: 'interaction', archived: false };
  const otherId = '00000000-0000-4000-8000-000000000030';
  const unrelatedId = '00000000-0000-4000-8000-000000000031';
  const wanted: SessionInboxEntry = { id: secondId, result_version: 1, source_event_id: '2', version: 3, target_session_id: id,
    result: { run_id: id, task_id: secondId, lifetime: 'managed', submitted_state: 'completed' },
    task_name: '核查项目依赖', delivery_state: 'delivered', viewed_at: null, dependencies: [], attempts: 1, last_error: null, source_valid: true, consumers: [] };
  const other = { ...wanted, id: otherId, task_name: '核查部署手册', result: { ...wanted.result, task_id: id } };
  const unrelated = { ...other, id: unrelatedId, task_name: '当前回告无关结果' };
  const message = { id, run_id: id, activity_id: null, private_ref: null, event_id: '3', event_index: 0,
    role: 'assistant', origin: 'background_report', source_valid: true, source_dependencies: [],
    parts: [{ kind: 'text', text: '周报已完成' }], delivery_ids: grouped ? [otherId, secondId] : [secondId] };
  const writes: string[] = [], reads: string[] = [];
  let selected = wanted;
  const matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('matchMedia', matchMedia);
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/run-feedback')) return Response.json(page([]));
    if (path.includes('/results/') && init?.method === 'POST') {
      writes.push(path);
      if (path !== `/results/${secondId}/view`) throw new Error(path);
      selected = { ...wanted, version: 4, viewed_at: '2026-11-21T08:00:00Z' };
      return Response.json(selected);
    }
    if (path.startsWith('/tasks/') && path.endsWith('/result')) {
      reads.push(path);
      if (path !== `/tasks/${secondId}/result`) throw new Error(path);
      return Response.json({ handle: wanted.result, result_version: 1, state: 'completed',
        result: { summary: '关联交付正文' }, artifacts: [], dependencies: [], error: null });
    }
    if (['/commands', '/follow-ups', '/runs'].some(suffix => path.endsWith(suffix))) return Response.json(page([]));
    const routes: Record<string, unknown> = {
      [`/sessions/${id}`]: session, [`/sessions/${id}/messages`]: page([message]),
      [`/sessions/${id}/results`]: page([unrelated, other, selected]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]),
        pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: '1' },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]),
      '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]),
        recent_sessions: page([]), pending_count: 0, watermark: '1' },
    };
    if (!(path in routes)) throw new Error(`未定义的测试查询 ${path}`);
    return Response.json(routes[path]);
  });
  const view = render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 })} compact={compact} />);
  try {
    const input = await screen.findByLabelText('消息');
    await user.type(input, '之前的草稿');
    const trigger = within(await screen.findByRole('article', { name: '后台交付' })).getByRole('button', { name: '查看交付结果' });
    await user.click(trigger);
    const inbox = within(await screen.findByRole('region', { name: '结果收件箱' }));
    if (grouped) {
      await inbox.findByRole('heading', { name: '核查部署手册' });
      expect(inbox.queryByText('当前回告无关结果')).toBeNull();
      expect(writes).toEqual([]);
      expect(reads).toEqual([]);
      await user.click(within(inbox.getByRole('article', { name: '核查项目依赖' })).getByRole('button', { name: '查看结果' }));
    }
    expect(await inbox.findByText(/关联交付正文/)).toBeTruthy();
    expect(inbox.getAllByRole('article')).toHaveLength(grouped ? 2 : 1);
    expect(inbox.getByText(/你已查看/)).toBeTruthy();
    expect(writes).toEqual([`/results/${secondId}/view`]);
    expect(reads).toEqual([`/tasks/${secondId}/result`]);
    if (compact) {
      expect(screen.getByRole('dialog')).toBeTruthy();
      await user.keyboard('{Escape}');
    } else {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('complementary', { name: '后台交付结果' })).toBeTruthy();
      await user.type(input, '仍可编辑');
      await user.click(screen.getByRole('button', { name: '关闭详情' }));
    }
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(input).toHaveProperty('value', compact ? '之前的草稿' : '之前的草稿仍可编辑');
    await user.click(screen.getByRole('button', { name: /^结果/ }));
    const all = within(await screen.findByRole('region', { name: '结果收件箱' }));
    const remaining = await all.findByRole('article', { name: '当前回告无关结果' });
    expect(within(remaining).getByText(/尚未查看/)).toBeTruthy();
    expect(writes).toHaveLength(1);
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
  }
});
