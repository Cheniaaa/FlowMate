import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { createRuntimeStore } from '../../state/runtime-store';
import { event, id, page, secondId } from '../../test/fixtures';
import { reduceStream } from '../../api/events';
import { memory } from '../../test/memory-fixtures';
import MemoryPage from './MemoryPage';

afterEach(() => vi.unstubAllGlobals());
const runtime = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
function server(lostResponses = 0) {
  let current = structuredClone(memory), valid = true, paginated = false, listError = false;
  let loseBeforeSave = false;
  let pendingEvidence: Promise<void> | undefined;
  const other = { ...memory, id: secondId, text: '项目使用两空格缩进', status: 'confirmed' as const,
    scope: { kind: 'workspace' as const, workspace_id: id, session_id: null } };
  const writes: { path: string; body: any }[] = [], reads: URL[] = [];
  const committed = new Map<string, typeof memory>();
  function receipt(record: typeof memory, status = 200) {
    if (lostResponses > 0) { lostResponses--; throw new TypeError('响应未收到'); }
    return Response.json(record, { status });
  }
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), path = parsed.pathname; reads.push(parsed);
    if (path.endsWith('/workspaces')) return Response.json(page([{ id, version: 1, name: '记忆项目', directory_resource_id: null }]));
    if (path.endsWith('/tasks') || path.endsWith('/maintenance')) return Response.json(page([]));
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (init.method === 'POST' && path.endsWith('/records')) {
      const body = JSON.parse(String(init.body)); writes.push({ path, body });
      const previous = committed.get(body.meta.command_id);
      if (previous) return receipt(previous, 201);
      current = { ...current, status: 'confirmed', revision: 1, text: body.data.text };
      committed.set(body.meta.command_id, current);
      return receipt(current, 201);
    }
    if (path.endsWith('/decisions')) {
      const body = JSON.parse(String(init.body)); writes.push({ path, body });
      const previous = committed.get(body.meta.command_id);
      if (previous) return receipt(previous);
      if (loseBeforeSave) { loseBeforeSave = false; throw new TypeError('请求未到达 Runtime'); }
      if (body.meta.expected_version !== current.revision) return Response.json({ error: { code: 'version_conflict', safe_message: '记录已修订', related_ids: [], retryable: false } }, { status: 409 });
      if (body.data.action === 'revise' && !valid) return Response.json({ error: {
        code: 'memory_source_invalid', safe_message: '原记忆来源已失效，修改未保存。', related_ids: [], retryable: false,
      } }, { status: 409 });
      current = { ...current, revision: current.revision + 1, status: body.data.action === 'accept' || body.data.action === 'revise' ? 'confirmed'
        : body.data.action === 'delete' ? 'deleted' : 'rejected', text: body.data.action === 'delete' ? '' : body.data.text ?? current.text,
        evidence: body.data.action === 'delete' ? [] : current.evidence, dependencies: body.data.action === 'delete' ? [] : current.dependencies };
      committed.set(body.meta.command_id, current);
      return receipt(current);
    }
    if (path.endsWith('/excerpt')) {
      const text = '用户在普通对话中留下的原始依据。';
      return Response.json({ record_id: current.id, record_revision: current.revision, evidence: current.evidence[0],
        source_label: '对话「原始材料」', excerpt: valid ? { text, start: 0, end: text.length,
          total_chars: text.length, source_version: current.evidence[0].source_version } : null,
        reason: valid ? null : 'source_unavailable' });
    }
    if (path.endsWith('/evidence')) {
      await pendingEvidence;
      return Response.json(page(current.evidence.map(evidence => ({ evidence, available: valid, reason: valid ? null : 'source_invalid' }))));
    }
    if (path.endsWith('/records')) {
      if (listError) return Response.json({ error: { code: 'unavailable', safe_message: '暂时无法读取记忆', related_ids: [], retryable: true } }, { status: 503 });
      if (parsed.searchParams.get('workspace_id') === id) return Response.json(page([other]));
      if (paginated) return Response.json(parsed.searchParams.has('cursor') ? page([current]) : { ...page([]), next_cursor: 'memory-tail' });
      return Response.json(page([current]));
    }
    if (path.endsWith(current.id)) return Response.json(current);
    if (path.endsWith(other.id)) return Response.json(other);
    throw new Error(`未定义 ${path}`);
  });
  return { writes, reads, committed, paginate: () => { paginated = true; }, failList: (value: boolean) => { listError = value; },
    loseNextBeforeSave: () => { loseBeforeSave = true; },
    deferEvidence: () => { let resume!: () => void; pendingEvidence = new Promise<void>(resolve => { resume = resolve; }); return resume; },
    invalidate: () => { valid = false; }, save: () => { current = { ...current, status: 'confirmed' }; },
    change: () => { current = { ...current, revision: 8, text: '另一窗的修订' }; } };
}

it('未改字的选区跨后台重读保持，已确认撤权则收回原文', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  api.save();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '修改' }));
  const input = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '记忆内容' });
  input.setSelectionRange(2, 5, 'backward');
  const resume = api.deferEvidence();
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  expect(document.activeElement).toBe(input);
  await act(async () => resume());
  await waitFor(() => expect(input.readOnly).toBe(false));
  expect(input.value).toBe(memory.text);
  expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([2, 5, 'backward']);
  expect(document.activeElement).toBe(input);
  api.invalidate();
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  expect(input.value).not.toBe(memory.text);
  await screen.findByText('来源已失效或记忆已移除，无法保存修改。');
  expect(screen.queryByRole('textbox', { name: '记忆内容' })).toBeNull();
});

it.each(['新建', '修改'])('%s已提交但响应丢失时在原模态重试冻结的命令', async operation => {
  const api = server(1), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  api.save();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text);
  if (operation === '新建') {
    await user.click(screen.getByRole('button', { name: '更多记忆管理' }));
    await user.click(await screen.findByRole('menuitem', { name: '新建记忆' }));
  } else await user.click(screen.getByRole('button', { name: '修改' }));
  const title = operation === '新建' ? '新建长期记忆' : '修改记忆';
  const dialog = screen.getByRole('dialog', { name: title }), editor = within(dialog);
  const input = editor.getByRole('textbox', { name: operation === '新建' ? '新记忆内容' : '记忆内容' });
  await user.clear(input);
  await user.type(input, '只保存一条记忆');
  await user.click(editor.getByRole('button', { name: operation === '新建' ? '保存新记忆' : '保存修改' }));
  const retry = await editor.findByRole('button', { name: '重试保存' });
  expect(screen.getByRole('dialog', { name: title })).toBe(dialog);
  expect(input).toHaveProperty('value', '只保存一条记忆');
  expect(input).toHaveProperty('readOnly', true);
  await user.click(retry);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
  await screen.findByText('只保存一条记忆');
  expect(api.writes).toHaveLength(2);
  expect(api.writes[1]).toEqual(api.writes[0]);
  expect(api.committed.size).toBe(1);
});

it.each([['新建', 'Escape'], ['修改', '关闭对话框']])('%s两次断线后可用%s退出，稍后只重试同一命令', async (operation, exit) => {
  const api = server(2), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  api.save();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text);
  if (operation === '新建') {
    await user.click(screen.getByRole('button', { name: '更多记忆管理' }));
    await user.click(await screen.findByRole('menuitem', { name: '新建记忆' }));
  } else await user.click(screen.getByRole('button', { name: '修改' }));
  const title = operation === '新建' ? '新建长期记忆' : '修改记忆';
  const editor = within(screen.getByRole('dialog', { name: title }));
  const input = editor.getByRole('textbox', { name: operation === '新建' ? '新记忆内容' : '记忆内容' });
  await user.clear(input);
  await user.type(input, '响应暂时未确认的已写入记录');
  await user.click(editor.getByRole('button', { name: operation === '新建' ? '保存新记忆' : '保存修改' }));
  await user.click(await editor.findByRole('button', { name: '重试保存' }));
  expect(api.writes).toHaveLength(2);
  expect(editor.getByText('保存结果尚未确认。')).toBeTruthy();
  if (exit === 'Escape') await user.keyboard('{Escape}');
  else await user.click(editor.getByRole('button', { name: exit }));
  expect(screen.queryByRole('dialog', { name: title })).toBeNull();
  expect(screen.queryByText(/已撤销/)).toBeNull();
  const pending = within(screen.getByRole('region', { name: '命令状态' }));
  expect(pending.getByText(operation === '新建' ? '新建记忆' : '记忆变更')).toBeTruthy();
  expect(pending.queryByText(/createMemory|decideMemory/)).toBeNull();
  expect(pending.getByText('提交状态待确认')).toBeTruthy();
  await user.click(pending.getByRole('button', { name: '使用原命令重试' }));
  await screen.findByText('响应暂时未确认的已写入记录');
  expect(screen.queryByRole('region', { name: '命令状态' })).toBeNull();
  expect(api.writes).toEqual([api.writes[0], api.writes[0], api.writes[0]]);
  expect(api.committed.size).toBe(1);
});

it.each(['原编辑器', '稍后处理'])('待确认请求经%s首次到达 Runtime 后因来源失效终止', async recovery => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  api.save();
  api.loseNextBeforeSave();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '修改' }));
  const editor = within(screen.getByRole('dialog', { name: '修改记忆' }));
  await user.type(editor.getByRole('textbox', { name: '记忆内容' }), '，补写的说明');
  await user.click(editor.getByRole('button', { name: '保存修改' }));
  await editor.findByText('保存结果尚未确认。');
  expect(api.committed.size).toBe(0);
  if (recovery === '稍后处理') await user.click(editor.getByRole('button', { name: recovery }));

  api.invalidate();
  const resume = api.deferEvidence();
  if (recovery === '原编辑器') {
    await user.click(editor.getByRole('button', { name: '重试保存' }));
  } else {
    await user.click(screen.getByRole('button', { name: '使用原命令重试' }));
  }
  expect(await screen.findByText('原记忆来源已失效，修改未保存。')).toBeTruthy();
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.queryByRole('textbox', { name: '记忆内容' })).toBeNull();
  expect(screen.queryByRole('button', { name: '重试保存' })).toBeNull();
  expect(store.getCommandsSnapshot()).toHaveLength(0);
  expect(api.writes).toEqual([api.writes[0], api.writes[0]]);
  expect(api.committed.size).toBe(0);

  if (recovery === '原编辑器') {
    await user.click(editor.getByRole('button', { name: '关闭编辑器' }));
    expect(screen.queryByRole('dialog', { name: '修改记忆' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: '记忆审阅' })));
  }
  await act(async () => resume());
  await screen.findByText('来源已失效，记忆正文不可用');
});

it('在原文上增补后复核期间遮蔽草稿，确认有效还原选区，撤权后保持收回', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  api.save();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '修改' }));
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '记忆内容' });
  await user.type(input, '，交付时附摘要');
  const draft = input.value;
  expect(draft).toContain(memory.text);
  input.setSelectionRange(3, 7, 'backward');
  let resume = api.deferEvidence();
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  expect(input.value).toBe('');
  expect(document.activeElement).toBe(input);
  await act(async () => resume());
  await waitFor(() => expect(input.value).toBe(draft));
  expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([3, 7, 'backward']);
  expect(document.activeElement).toBe(input);
  resume = api.deferEvidence();
  api.invalidate();
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  expect(input.value).toBe('');
  await act(async () => resume());
  await screen.findByText('来源已失效或记忆已移除，无法保存修改。');
  expect(screen.queryByRole('textbox', { name: '记忆内容' })).toBeNull();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('button', { name: '继续编辑' })).toBeNull();
  expect(screen.queryByRole('dialog', { name: '修改记忆' })).toBeNull();
});

it('列表/依据沿真实来源读取，accept/revise/delete分别绑定所显示revision，策略不在记忆卡编辑', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText(memory.claim_key)).toBeNull();
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  expect(await screen.findByText('用户原话')).toBeTruthy();
  expect(await screen.findByText('用户在普通对话中留下的原始依据。')).toBeTruthy();
  expect(screen.getByText('消息第 1 段')).toBeTruthy();
  expect(screen.queryByText('/parts/0/text')).toBeNull();
  expect(api.reads.find(url => url.pathname === `/v4/memory/records/${memory.id}/evidence/0/excerpt`)?.searchParams.get('expected_revision')).toBe('3');
  await user.click(screen.getByRole('button', { name: '记住' }));
  await within(screen.getByRole('region', { name: '记忆审阅' })).findByText('已记住');
  expect(api.writes[0].body).toMatchObject({ meta: { expected_version: 3 }, data: { action: 'accept', scope: memory.scope } });
  expect(api.writes[0].body.data).not.toHaveProperty('text');
  expect(api.reads.filter(url => url.pathname.endsWith('/decisions')).every(url => !url.searchParams.has('receipt_message_id'))).toBe(true);
  await user.click(screen.getByRole('button', { name: '修改' }));
  await user.clear(screen.getByLabelText('记忆内容')); await user.type(screen.getByLabelText('记忆内容'), '改为简洁中文');
  await user.click(screen.getByRole('button', { name: '保存修改' }));
  await screen.findByText('改为简洁中文');
  expect(api.writes[1].body).toMatchObject({ meta: { expected_version: 4 }, data: { action: 'revise', text: '改为简洁中文' } });
  const more = screen.getByRole('button', { name: '更多' });
  more.focus();
  await user.keyboard('{Enter}');
  const remove = await screen.findByRole('menuitem', { name: '删除' });
  remove.focus();
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: '确认删除记忆' }));
  await within(screen.getByRole('region', { name: '记忆审阅' })).findByText('已删除');
  expect(screen.queryByText('改为简洁中文')).toBeNull();
  expect(api.writes[2].body.meta.expected_version).toBe(5);
});

it('冲突重读当前事实但不重交；全局/来源事件立刻隐藏旧正文并重新核对依据', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text); api.change();
  await user.click(screen.getByRole('button', { name: '记住' }));
  await screen.findByText('记录已修订');
  await screen.findByText('另一窗的修订');
  expect(api.writes).toHaveLength(1);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText('用户在普通对话中留下的原始依据。');
  api.invalidate();
  await act(async () => { store.update(state => reduceStream(state, { kind: 'durable', event_id: event.event_id,
    event: { ...event, kind: 'scope.revoked', run_id: null, seq: null, payload: { scopes: [{
      id, epoch: 2, status: 'revoked', scope: { kind: 'session', workspace_id: id, session_id: id },
    }], deletions: [] } } })); });
  expect(screen.queryByText('另一窗的修订')).toBeNull();
  expect(screen.queryByText('用户在普通对话中留下的原始依据。')).toBeNull();
  await screen.findByText('来源已失效，记忆正文不可用');
  expect(screen.queryByRole('button', { name: '记住' })).toBeNull();
});

it('自动重读现有卡片，列表读取失败只在原位置提供重试', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text); api.change(); api.failList(true);
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  await screen.findByText('另一窗的修订');
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(await screen.findByText('暂时无法读取记忆')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '刷新记忆' })).toBeNull();
  api.failList(false);
  await user.click(screen.getByRole('button', { name: '重试读取记忆列表' }));
  await waitFor(() => expect(screen.queryByText('暂时无法读取记忆')).toBeNull());
});

it('个人和项目使用同一记忆列表，清楚显示项目名称且只展示当前范围', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text);
  expect(screen.getByText('适用范围：个人')).toBeTruthy();
  expect(screen.getByRole('button', { name: '记住' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '修改' })).toBeNull();
  await user.selectOptions(screen.getByLabelText('记忆范围'), id);
  await screen.findByText('项目使用两空格缩进');
  expect(screen.getByText('适用范围：项目「记忆项目」')).toBeTruthy();
  expect(screen.getByRole('button', { name: '修改' })).toBeTruthy();
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(api.reads.find(url => url.searchParams.get('scope_kind') === 'workspace')?.searchParams.get('workspace_id')).toBe(id);
});

it('确认撤销后立即收回旧记忆和已展开原文', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  api.save();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text);
  await user.click(screen.getByText('查看来源', { selector: 'summary' }));
  await screen.findByText('用户在普通对话中留下的原始依据。');
  await user.click(screen.getByRole('button', { name: '更多' }));
  await user.click(await screen.findByRole('menuitem', { name: '撤销' }));
  await screen.findByText('已撤销记忆变更');
  expect(screen.queryByText(memory.text)).toBeNull();
  expect(screen.queryByText('用户在普通对话中留下的原始依据。')).toBeNull();
  expect(api.writes[0].body).toMatchObject({ meta: { expected_version: 3 }, data: { action: 'undo', scope: memory.scope } });
});

it('记忆编辑中的 Esc 先交给中文输入法，组合结束后才处理离开', async () => {
  server();
  const client = runtime(), store = createRuntimeStore(client), close = vi.fn(), user = userEvent.setup();
  render(<MemoryPage client={client} store={store} onClose={close} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text);
  await user.click(screen.getByRole('button', { name: '更多记忆管理' }));
  await user.click(await screen.findByRole('menuitem', { name: '新建记忆' }));
  const input = screen.getByRole('textbox', { name: '新记忆内容' });
  await user.type(input, '保留的草稿');
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: '未保存记忆' })).toBeNull();
  expect(close).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(await screen.findByRole('region', { name: '未保存记忆' })).toBeTruthy();
  expect(input).toHaveProperty('value', '保留的草稿');
  await user.click(screen.getByRole('button', { name: '放弃更改' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '更多记忆管理' })));
});

it('正在编辑的修订绑定原revision，全局更新不默默改绑；离开需保存或放弃，来源失效隐藏编辑正文', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup(), close = vi.fn();
  api.save();
  render(<MemoryPage client={client} store={store} onClose={close} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text);
  await user.click(screen.getByRole('button', { name: '修改' }));
  await user.clear(screen.getByLabelText('记忆内容')); await user.type(screen.getByLabelText('记忆内容'), '本窗未保存修订');
  await user.keyboard('{Escape}');
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  api.change();
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  await screen.findByText('另一窗的修订');
  expect((screen.getByLabelText('记忆内容') as HTMLTextAreaElement).value).toBe('本窗未保存修订');
  await user.click(screen.getByRole('button', { name: '保存修改' }));
  await screen.findByText('记录已修订');
  expect(api.writes[0].body.meta.expected_version).toBe(3);
  api.invalidate();
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  await screen.findByText('来源已失效或记忆已移除，无法保存修改。');
  expect(screen.queryByLabelText('记忆内容')).toBeNull();
  const submitted = api.writes.length;
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: '修改记忆' })).toBeNull();
  expect(api.writes).toHaveLength(submitted);
  expect(close).not.toHaveBeenCalled();
});

it('从下一页打开的编辑器在后台重读期间保留草稿、选择范围和焦点', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  api.save(); api.paginate();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '更多记忆' }));
  await user.click(await screen.findByRole('button', { name: '修改' }));
  const input = screen.getByLabelText<HTMLTextAreaElement>('记忆内容');
  await user.clear(input); await user.type(input, '本页未保存的修改');
  input.setSelectionRange(2, 4);
  const resume = api.deferEvidence();
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('');
  await act(async () => resume());
  await screen.findByText(memory.text);
  expect(input.value).toBe('本页未保存的修改');
  expect(input.selectionStart).toBe(2);
  expect(input.selectionEnd).toBe(4);
  expect(document.activeElement).toBe(input);
  expect(api.reads.filter(url => url.searchParams.get('cursor') === 'memory-tail')).toHaveLength(2);
});
