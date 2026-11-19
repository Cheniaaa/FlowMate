import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { createRuntimeStore } from '../../state/runtime-store';
import { event, id, page } from '../../test/fixtures';
import { reduceStream } from '../../api/events';
import { memory } from '../../test/memory-fixtures';
import MemoryPage from './MemoryPage';

afterEach(() => vi.unstubAllGlobals());
const runtime = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
function server() {
  let current = structuredClone(memory), valid = true;
  const writes: { path: string; body: any }[] = [], reads: URL[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), path = parsed.pathname; reads.push(parsed);
    if (path.endsWith('/workspaces')) return Response.json(page([{ id, version: 1, name: '记忆项目', directory_resource_id: null }]));
    if (path.endsWith('/tasks') || path.endsWith('/maintenance')) return Response.json(page([]));
    if (path.endsWith('/decisions')) {
      const body = JSON.parse(String(init.body)); writes.push({ path, body });
      if (body.meta.expected_version !== current.revision) return Response.json({ error: { code: 'version_conflict', safe_message: '记录已修订', related_ids: [], retryable: false } }, { status: 409 });
      current = { ...current, revision: current.revision + 1, status: body.data.action === 'accept' || body.data.action === 'revise' ? 'confirmed'
        : body.data.action === 'delete' ? 'deleted' : 'rejected', text: body.data.action === 'delete' ? '' : body.data.text ?? current.text,
        evidence: body.data.action === 'delete' ? [] : current.evidence, dependencies: body.data.action === 'delete' ? [] : current.dependencies };
      return Response.json(current);
    }
    if (path.endsWith('/excerpt')) {
      const text = '用户在普通对话中留下的原始依据。';
      return Response.json({ record_id: current.id, record_revision: current.revision, evidence: current.evidence[0],
        source_label: '对话「原始材料」', excerpt: valid ? { text, start: 0, end: text.length,
          total_chars: text.length, source_version: current.evidence[0].source_version } : null,
        reason: valid ? null : 'source_unavailable' });
    }
    if (path.endsWith('/evidence')) return Response.json(page(current.evidence.map(evidence => ({ evidence, available: valid, reason: valid ? null : 'source_invalid' }))));
    if (path.endsWith('/records')) return Response.json(page([current]));
    if (path.endsWith(current.id)) return Response.json(current);
    throw new Error(`未定义 ${path}`);
  });
  return { writes, reads, invalidate: () => { valid = false; }, change: () => { current = { ...current, revision: 8, text: '另一窗的修订' }; } };
}

it('列表/依据沿真实来源读取，accept/revise/delete分别绑定所显示revision，策略不在记忆卡编辑', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText(memory.claim_key)).toBeNull();
  await user.click(screen.getByText('查看依据', { selector: 'summary' }));
  expect(await screen.findByText(/用户自述 · message/)).toBeTruthy();
  expect(await screen.findByText('用户在普通对话中留下的原始依据。')).toBeTruthy();
  expect(screen.getByText('/parts/0/text')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '采纳' }));
  await within(screen.getByRole('region', { name: '记忆审阅' })).findByText('已采纳');
  expect(api.writes[0].body).toMatchObject({ meta: { expected_version: 3 }, data: { action: 'accept', scope: memory.scope } });
  expect(api.writes[0].body.data).not.toHaveProperty('text');
  expect(api.reads.filter(url => url.pathname.endsWith('/decisions')).every(url => !url.searchParams.has('receipt_message_id'))).toBe(true);
  await user.click(screen.getByRole('button', { name: '修改' }));
  await user.clear(screen.getByLabelText('记忆内容')); await user.type(screen.getByLabelText('记忆内容'), '改为简洁中文');
  await user.click(screen.getByRole('button', { name: '保存修订' }));
  await screen.findByText('改为简洁中文');
  expect(api.writes[1].body).toMatchObject({ meta: { expected_version: 4 }, data: { action: 'revise', text: '改为简洁中文' } });
  await user.click(screen.getByRole('button', { name: '删除' }));
  await user.click(screen.getByRole('button', { name: '确认删除记忆' }));
  await within(screen.getByRole('region', { name: '记忆审阅' })).findByText('已删除');
  expect(screen.queryByText('改为简洁中文')).toBeNull();
  expect(api.writes[2].body.meta.expected_version).toBe(5);
});

it('冲突重读当前事实但不重交；全局/来源事件立刻隐藏旧正文并重新核对依据', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text); api.change();
  await user.click(screen.getByRole('button', { name: '采纳' }));
  await screen.findByText(/version_conflict/);
  await screen.findByText('另一窗的修订');
  expect(api.writes).toHaveLength(1);
  await user.click(screen.getByText('查看依据', { selector: 'summary' }));
  await screen.findByText('用户在普通对话中留下的原始依据。');
  api.invalidate();
  await act(async () => { store.update(state => reduceStream(state, { kind: 'durable', event_id: event.event_id,
    event: { ...event, kind: 'scope.revoked', run_id: null, seq: null, payload: { scopes: [{
      id, epoch: 2, status: 'revoked', scope: { kind: 'session', workspace_id: id, session_id: id },
    }], deletions: [] } } })); });
  expect(screen.queryByText('另一窗的修订')).toBeNull();
  expect(screen.queryByText('用户在普通对话中留下的原始依据。')).toBeNull();
  await screen.findByText(/来源已失效/);
  expect(screen.queryByRole('button', { name: '采纳' })).toBeNull();
});

it('显式刷新列表同时重新核对现有卡片，不保留同ID的旧正文', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup();
  render(<MemoryPage client={client} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text); api.change();
  await user.click(screen.getByRole('button', { name: '刷新记忆' }));
  await screen.findByText('另一窗的修订');
  expect(screen.queryByText(memory.text)).toBeNull();
});

it('正在编辑的修订绑定原revision，全局更新不默默改绑；离开需保存或放弃，来源失效隐藏编辑正文', async () => {
  const api = server(), client = runtime(), store = createRuntimeStore(client), user = userEvent.setup(), close = vi.fn();
  render(<MemoryPage client={client} store={store} onClose={close} onSettings={() => {}} onOpenTask={() => {}} />);
  await screen.findByText(memory.text);
  await user.click(screen.getByRole('button', { name: '修改' }));
  await user.clear(screen.getByLabelText('记忆内容')); await user.type(screen.getByLabelText('记忆内容'), '本窗未保存修订');
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  api.change();
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  await screen.findByText('另一窗的修订');
  expect((screen.getByLabelText('记忆内容') as HTMLTextAreaElement).value).toBe('本窗未保存修订');
  await user.click(screen.getByRole('button', { name: '保存修订' }));
  await screen.findByText(/version_conflict/);
  expect(api.writes[0].body.meta.expected_version).toBe(3);
  api.invalidate();
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  await screen.findByText(/来源已失效/);
  expect(screen.queryByLabelText('记忆内容')).toBeNull();
  const submitted = api.writes.length;
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  await user.click(screen.getByRole('button', { name: '保存后继续' }));
  expect(api.writes).toHaveLength(submitted);
  expect(close).not.toHaveBeenCalled();
});
