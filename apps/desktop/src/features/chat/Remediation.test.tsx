import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { mergeMessages, mergeSessions, mergeWorkspaces } from '../../api/events';
import { createRuntimeStore } from '../../state/runtime-store';
import { agent, connection, event, id, model, page, resultEntry, secondId } from '../../test/fixtures';
import { skillHash, skillReceipt, skillScope, skillView } from '../../test/skill-fixtures';
import ResourceSettings from '../settings/ResourceSettings';
import ResultInbox from '../notifications/ResultInbox';
import CapabilityLibrary from '../capabilities/CapabilityLibrary';
import Composer from './Composer';
import InteractionPanel from './InteractionPanel';
import { Conversation } from './Conversation';
import type { ModelMessage } from '../../generated/contracts';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'synthetic', protocol_version: 3 });
const workspace = { id, version: 1, name: '原聊天项目', directory_resource_id: null };
const session = { id, version: 1, title: '原聊天会话', workspace_id: id, agent_profile_id: id, kind: 'interaction' as const, archived: false };
const snapshot = { workspace, sessions: page([session]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id };

it('授权设置查看另一个项目不会更换聊天快照、历史和当前水位', async () => {
  const runtime = client(), store = createRuntimeStore(runtime), other = { ...workspace, id: secondId, name: '授权查询项目' };
  const message: ModelMessage = { id, run_id: id, activity_id: null, event_id: event.event_id, event_index: 0, role: 'user', origin: 'conversation',
    private_ref: null, parts: [{ kind: 'text', text: '原历史' }], source_dependencies: [] };
  store.update(state => mergeMessages(mergeSessions(mergeWorkspaces(state, [workspace]), [session]), id, [message]));
  const before = store.getSnapshot();
  vi.spyOn(runtime, 'workspaces').mockResolvedValue(page([other, workspace]));
  vi.spyOn(runtime, 'workspaceSnapshot').mockResolvedValue({ ...snapshot, workspace: other, sessions: page([]) });
  vi.spyOn(runtime, 'watchWorkspace').mockResolvedValue();
  vi.spyOn(runtime, 'resources').mockResolvedValue(page([]));
  vi.spyOn(runtime, 'grants').mockResolvedValue(page([]));
  render(<ResourceSettings client={runtime} store={store} />);
  await screen.findByRole('option', { name: other.name });
  await waitFor(() => expect(runtime.watchWorkspace).toHaveBeenCalled());
  expect(store.getSnapshot().sessions).toBe(before.sessions);
  expect(store.getSnapshot().messages).toBe(before.messages);
  expect(store.getSnapshot().cursor).toBe(before.cursor);
  expect(store.getSnapshot().workspaces[id]).toBe(workspace);
});

it('尾页结果刷新和无关事件保留第51条预览；真实撤权立即移除正文', async () => {
  const runtime = client(), store = createRuntimeStore(runtime);
  const entries = Array.from({ length: 51 }, (_, index) => ({ ...resultEntry, id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}` }));
  vi.spyOn(runtime, 'sessionResults').mockImplementation(async (_id, query) => ({ ...page(query?.cursor ? entries.slice(50) : entries.slice(0, 50)), next_cursor: query?.cursor ? null : 'tail' }));
  vi.spyOn(runtime, 'taskResult').mockResolvedValue({ handle: resultEntry.result, result_version: resultEntry.result_version, state: 'completed', result: { summary: '第51条正文' }, artifacts: [], dependencies: [], error: null });
  render(<ResultInbox client={runtime} store={store} sessionId={id} onCommand={vi.fn().mockResolvedValue({ status: 'confirmed', sync: 'ready', commandId: id })} onOpen={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: '更多结果' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: '查看结果' })).toHaveLength(51));
  await userEvent.click(screen.getAllByRole('button', { name: '查看结果' })[50]);
  await screen.findByText(/第51条正文/);
  await act(async () => { store.update(state => ({ ...state, cursor: String(BigInt(state.cursor) + 1n) })); await store.refreshResults(id); });
  expect(screen.getAllByRole('button', { name: '查看结果' })).toHaveLength(51);
  expect(screen.getByText(/第51条正文/)).toBeTruthy();
  await act(async () => store.update(state => ({ ...state, deliveries: { ...state.deliveries, [entries[50].id]: { ...entries[50], source_valid: false } } })));
  expect(screen.queryByText(/第51条正文/)).toBeNull();
});

it('Skill子页保存在途及回执丢失期间不能关闭，核对保留同一命令和目标', async () => {
  const runtime = client();
  vi.spyOn(runtime, 'skills').mockResolvedValue(page([skillView]));
  vi.spyOn(runtime, 'skillExports').mockResolvedValue([]);
  vi.spyOn(runtime, 'skillFile').mockResolvedValue({ skill_id: secondId, content_hash: skillHash, path: 'SKILL.md', file_hash: skillHash, encoding: 'utf-8', content: '合成正文', start: 0, end: 4, total: 4 });
  vi.mocked(invoke).mockResolvedValue({ resources: [{ id, version: 1, scope: skillScope, label: '合成导出.zip', kind: 'export', source_version: null }] });
  let reject!: (error: Error) => void;
  const save = vi.spyOn(runtime, 'saveSkillExport').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const check = vi.spyOn(runtime, 'skillExport').mockResolvedValue(skillReceipt);
  const close = vi.fn();
  render(<CapabilityLibrary client={runtime} workspaceId={id} onClose={close} />);
  await userEvent.click(await screen.findByRole('button', { name: '导出标准包' }));
  const returnButton = screen.getByRole('button', { name: '返回对话与草稿' }) as HTMLButtonElement;
  expect(returnButton.disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('dialog', { name: '能力库' }), { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  await act(async () => reject(new Error('合成回执丢失')));
  expect(returnButton.disabled).toBe(true);
  const frozen = save.mock.calls[0][0];
  await userEvent.click(screen.getByRole('button', { name: '查询原保存命令' }));
  expect(check).toHaveBeenCalledWith(frozen.meta.command_id, { scope_kind: 'workspace', workspace_id: id });
  await waitFor(() => expect(returnButton.disabled).toBe(false));
});

it('输入处停止独立于发送，中文组合态Esc保留待办', async () => {
  const stop = vi.fn(), submit = vi.fn(), collapse = vi.fn();
  const view = render(<Composer value="" onChange={vi.fn()} onSubmit={submit} disabled steering onStop={stop} />);
  await userEvent.click(screen.getByRole('button', { name: '停止当前运行' }));
  expect(stop).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
  view.rerender(<InteractionPanel item={{ id, kind: 'question', title: '待回答' }} collapsed={false} onCollapse={collapse}><input aria-label="组合输入" /></InteractionPanel>);
  fireEvent.keyDown(screen.getByLabelText('组合输入'), { key: 'Escape', isComposing: true, keyCode: 229 });
  expect(collapse).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText('组合输入'), { key: 'Escape' });
  expect(collapse).toHaveBeenCalledOnce();
});

it('会话绑定默认助理和模型，不选择排序靠前的新成员', async () => {
  const runtime = client();
  vi.spyOn(runtime, 'workspaces').mockResolvedValue(page([workspace]));
  vi.spyOn(runtime, 'profiles').mockResolvedValue(page([{ ...agent, id: secondId, display_name: '排序首项成员' }, { ...agent, display_name: '正确的默认助理', default_model_profile_id: model.id }]));
  vi.spyOn(runtime, 'models').mockResolvedValue(page([model]));
  vi.spyOn(runtime, 'connections').mockResolvedValue(page([connection]));
  vi.spyOn(runtime, 'navigation').mockResolvedValue({ default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
  vi.spyOn(runtime, 'workspaceSnapshot').mockResolvedValue(snapshot);
  vi.spyOn(runtime, 'watchWorkspace').mockResolvedValue();
  vi.spyOn(runtime, 'messages').mockResolvedValue(page([]));
  vi.spyOn(runtime, 'sessionRuns').mockResolvedValue(page([]));
  vi.spyOn(runtime, 'pendingUserCommands').mockResolvedValue(page([]));
  vi.spyOn(runtime, 'followUpIntents').mockResolvedValue(page([]));
  vi.spyOn(runtime, 'workspaceDirectory').mockResolvedValue({ workspace_id: id, workspace_version: 1, state: 'unlinked', reason: null, resource: null });
  render(<Conversation client={runtime} />);
  await screen.findByRole('heading', { name: '正确的默认助理' });
  expect((screen.getByLabelText('模型') as HTMLSelectElement).value).toBe(model.id);
});
