import { useLayoutEffect } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, RuntimeClient } from '../../api/client';
import { createRuntimeStore } from '../../state/runtime-store';
import { id, page, run, secondId } from '../../test/fixtures';
import type { ActivityView, ArtifactRef, SessionInboxEntry } from '../../generated/contracts';
import ResultInbox from './ResultInbox';

afterEach(() => vi.restoreAllMocks());
const entry: SessionInboxEntry = { id, version: 3, source_event_id: '9007199254740993', target_session_id: id,
  result: { run_id: run.id, task_id: secondId, lifetime: 'managed', submitted_state: 'completed' }, result_version: 1,
  delivery_state: 'delivered', viewed_at: null, dependencies: [], attempts: 1, last_error: null, source_valid: true, consumers: [] };

const reportArtifact: ArtifactRef = { id, version: 1, task_id: secondId, activity_id: secondId,
  content_hash: 'a'.repeat(64), dependencies: [], media_type: 'text/markdown' };
const genericArtifact = { ...reportArtifact, id: secondId };
function reportActivity(artifact: ArtifactRef, filename: string): ActivityView {
  return { id: artifact.activity_id, run_id: run.id, task_id: artifact.task_id, version: 1,
    kind: 'tool', operation: 'skills.run_script', state: 'succeeded', dependencies: [], error: null, usage: null, actual_units: null,
    script_execution: { skill_id: id, content_hash: 'a'.repeat(64), script_relative_path: 'scripts/report.py',
      environment_id: id, environment_revision: 1, attempt_id: id, exit_code: 0, termination_reason: 'exited',
      truncated: false, collection_error: null, external_costs: 'unknown', outputs: [{ artifact, relative_path: filename }] } };
}
function reportResult(delivery: SessionInboxEntry, artifacts: ArtifactRef[]) {
  return { handle: delivery.result, result_version: 1, state: 'completed' as const,
    result: { summary: delivery.task_name ?? '会议记录来源已完成' }, artifacts, error: null, dependencies: [] };
}

it('重开合并回告后仅按所选结果补读文件名，通用 Markdown 单独编号', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  const meeting = { ...entry, task_name: '会议记录整理', viewed_at: '2026-11-19T03:10:00Z' };
  const other = { ...meeting, id: secondId, task_name: '图书馆资料核对', result: { ...meeting.result, task_id: id } };
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([meeting, other]));
  const results = vi.spyOn(client, 'taskResult').mockResolvedValue(reportResult(meeting, [reportArtifact, genericArtifact]));
  const activity = reportActivity(reportArtifact, '阅读报告.md');
  const reads = vi.spyOn(client, 'activities').mockResolvedValue(page([activity]));
  const open = vi.fn();
  render(<ResultInbox client={client} store={createRuntimeStore(client)} sessionId={id} deliveryIds={[id, secondId]}
    onCommand={vi.fn()} onOpen={vi.fn()} onArtifact={open} />);
  const meetingRow = within(await screen.findByRole('article', { name: '会议记录整理' }));
  expect(reads).not.toHaveBeenCalled();
  await userEvent.click(meetingRow.getByRole('button', { name: '查看结果' }));
  await userEvent.click(await meetingRow.findByRole('button', { name: '阅读报告.md' }));
  expect(open.mock.calls[0].slice(0, 2)).toEqual([reportArtifact, meeting]);
  await userEvent.click(meetingRow.getByRole('button', { name: 'Markdown 文档 1' }));
  expect(open.mock.calls[1][0].id).toBe(genericArtifact.id);
  expect(results.mock.calls).toEqual([[meeting.result.task_id]]);
  expect(reads.mock.calls).toEqual([[run.id, { activity_id: reportArtifact.activity_id }]]);
  expect(within(screen.getByRole('article', { name: '图书馆资料核对' })).queryByRole('region', { name: '结果预览' })).toBeNull();
});

it('切换到同名文件的另一条交付后，迟到的活动不能覆盖所选预览', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  const meeting = { ...entry, task_name: '会议记录整理', viewed_at: '2026-11-19T03:10:00Z' };
  const other = { ...meeting, id: secondId, task_name: '图书馆资料核对', result: { ...meeting.result, task_id: id } };
  const otherFile = { ...genericArtifact, task_id: id, activity_id: id };
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([meeting, other]));
  vi.spyOn(client, 'taskResult').mockImplementation(async taskId =>
    taskId === secondId ? reportResult(meeting, [reportArtifact]) : reportResult(other, [otherFile]));
  let respond!: (value: Awaited<ReturnType<RuntimeClient['activities']>>) => void;
  vi.spyOn(client, 'activities').mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }))
    .mockResolvedValueOnce(page([reportActivity(otherFile, '阅读报告.md')]));
  const open = vi.fn(), user = userEvent.setup();
  render(<ResultInbox client={client} store={createRuntimeStore(client)} sessionId={id} deliveryIds={[id, secondId]}
    onCommand={vi.fn()} onOpen={vi.fn()} onArtifact={open} />);
  const meetingRow = within(await screen.findByRole('article', { name: '会议记录整理' }));
  const otherRow = within(screen.getByRole('article', { name: '图书馆资料核对' }));
  await user.click(meetingRow.getByRole('button', { name: '查看结果' }));
  await waitFor(() => expect(respond).toBeTypeOf('function'));
  await user.click(otherRow.getByRole('button', { name: '查看结果' }));
  const file = await otherRow.findByRole('button', { name: '阅读报告.md' });
  await act(async () => { respond(page([reportActivity(reportArtifact, '阅读报告.md')])); });
  expect(meetingRow.queryByRole('region', { name: '结果预览' })).toBeNull();
  await user.click(file);
  expect(open.mock.calls[0].slice(0, 2)).toEqual([otherFile, other]);
});

it.each([
  [new ApiError(409, 'scope_revoked', '内部路径'), '产物名称不可用'],
  [new Error('内部路径'), '产物名称读取失败'],
])('活动读取失败时保留已授权结果和文件入口，并显示 %s 对应的状态', async (failure, hint) => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  const meeting = { ...entry, viewed_at: '2026-11-19T03:10:00Z' };
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([meeting]));
  vi.spyOn(client, 'taskResult').mockResolvedValue(reportResult(meeting, [reportArtifact]));
  vi.spyOn(client, 'activities').mockRejectedValue(failure);
  const open = vi.fn();
  render(<ResultInbox client={client} store={createRuntimeStore(client)} sessionId={id} deliveryIds={[id]}
    onCommand={vi.fn()} onOpen={vi.fn()} onArtifact={open} />);
  expect(await screen.findByText(hint)).toBeTruthy();
  expect(screen.getByText(/会议记录来源已完成/)).toBeTruthy();
  expect(screen.queryByText('内部路径')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Markdown 文档 1' }));
  expect(open.mock.calls[0][0].id).toBe(reportArtifact.id);
});

it('同名交付可区分，重开已读项只读取其固定任务，其他投递仍未读', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  const unread = { ...entry, task_name: '核对周报' };
  const read = { ...entry, id: secondId, source_event_id: '9007199254740994', task_name: '核对周报',
    result: { ...entry.result, task_id: id }, viewed_at: '2026-11-19T03:10:00Z' };
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([unread, read]));
  const lookup = vi.spyOn(client, 'taskResult').mockResolvedValue({ handle: read.result, result_version: 1,
    state: 'completed', result: { status: 'completed', summary: '第二份周报已核对', structured_result: null,
      artifact_ids: [secondId], evidence_refs: [id], unresolved: [], verification: [], handled_failures: [] },
    artifacts: [], dependencies: [], error: null });
  const store = createRuntimeStore(client);
  const command = vi.fn();
  render(<ResultInbox client={client} store={store} sessionId={id} onCommand={command} onOpen={vi.fn()} />);
  const first = await screen.findByRole('article', { name: /核对周报.*第 1 项/ });
  const second = screen.getByRole('article', { name: /核对周报.*第 2 项/ });
  expect(within(first).getByText(/尚未查看/)).toBeTruthy();
  expect(within(second).getByText(/你已查看/)).toBeTruthy();
  await userEvent.click(within(second).getByRole('button', { name: '查看结果' }));
  expect(await within(second).findByText(/第二份周报已核对/)).toBeTruthy();
  expect(within(second).getByText('交付产物 1 项')).toBeTruthy();
  expect(second.textContent).not.toContain(secondId);
  expect(within(first).queryByRole('region', { name: '结果预览' })).toBeNull();
  expect(lookup.mock.calls).toEqual([[id]]);
  expect(command).not.toHaveBeenCalled();
  expect(store.getSnapshot().deliveries[unread.id].viewed_at).toBeNull();
});

it('查看不冒充消费，来源失效立即清正文；重投只在failed且有效时开放', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([entry]));
  vi.spyOn(client, 'taskResult').mockResolvedValue({ handle: entry.result, result_version: 1, state: 'completed',
    result: { summary: '有效交付正文' }, artifacts: [], dependencies: [], error: null });
  const command = vi.fn().mockResolvedValue({ status: 'confirmed', sync: 'ready', commandId: id });
  const store = createRuntimeStore(client);
  render(<ResultInbox client={client} store={store} sessionId={id} onCommand={command} onOpen={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: '查看结果' }));
  expect(await screen.findByText(/有效交付正文/)).toBeTruthy();
  expect(command).toHaveBeenCalledWith({ type: 'viewResult', args: [id, expect.objectContaining({ expected_version: 3 })] });
  expect(screen.getByText(/模型尚未消费/)).toBeTruthy();
  await act(async () => { store.update(state => ({ ...state, deliveries: { [id]: { ...entry, source_valid: false } } })); });
  expect(screen.queryByText(/有效交付正文/)).toBeNull();
  expect(screen.getByText('来源已失效，正文不可用')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重新投递' })).toBeNull();
});

it.each(['session', 'run', 'client'] as const)('%s身份切换在layout提交前隐藏旧预览，旧正文迟到不能写入新身份', async change => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  const other = new RuntimeClient({ ...client.connection, token: 'other' });
  const reads: ((result: Awaited<ReturnType<RuntimeClient['taskResult']>>) => void)[] = [];
  for (const runtime of [client, other]) {
    vi.spyOn(runtime, 'sessionResults').mockImplementation(async sessionId => page(sessionId === id ? [entry] : []));
    vi.spyOn(runtime, 'taskResult').mockImplementation(() => new Promise(resolve => { reads.push(resolve); }));
  }
  const store = createRuntimeStore(client);
  const props = { client, store, sessionId: id, runId: id, onCommand: vi.fn().mockResolvedValue({ status: 'confirmed', sync: 'ready', commandId: id }), onOpen: vi.fn() };
  const committed: string[] = [];
  function Host({ client, sessionId, runId }: { client: RuntimeClient; sessionId: string; runId: string }) {
    useLayoutEffect(() => { committed.push(document.body.textContent ?? ''); });
    return <ResultInbox {...props} client={client} sessionId={sessionId} runId={runId} />;
  }
  const view = render(<Host client={client} sessionId={id} runId={id} />);
  const result = { handle: entry.result, result_version: 1, state: 'completed' as const, result: { summary: '原身份正文' }, artifacts: [], dependencies: [], error: null };
  await userEvent.click(await screen.findByRole('button', { name: '查看结果' }));
  await act(async () => { reads[0](result); });
  await screen.findByText(/原身份正文/);
  committed.length = 0;
  const next = { client: change === 'client' ? other : client, sessionId: change === 'session' ? secondId : id, runId: change === 'run' ? secondId : id };
  view.rerender(<Host {...next} />);
  expect(committed[0]).not.toContain('原身份正文');
  expect(screen.queryByText(/原身份正文/)).toBeNull();
  // 返回原身份后在正文边界暂停；再次切换，旧响应不能“补回”新视图。
  view.rerender(<Host client={client} sessionId={id} runId={id} />);
  await userEvent.click(await screen.findByRole('button', { name: '查看结果' }));
  await waitFor(() => expect(reads).toHaveLength(2));
  view.rerender(<Host {...next} />);
  await act(async () => { reads[1](result); });
  expect(screen.queryByText(/原身份正文/)).toBeNull();
});

it('来源重连水位变化即使共享游标未变也隔离迟到正文，不自动重试查看；用户可重新明确查看', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([entry]));
  let reply!: (result: Awaited<ReturnType<RuntimeClient['taskResult']>>) => void;
  const body = { handle: entry.result, result_version: 1, state: 'completed' as const, result: { summary: '旧来源迟到正文' }, artifacts: [], dependencies: [], error: null };
  const query = vi.spyOn(client, 'taskResult').mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }))
    .mockResolvedValue({ ...body, result: { summary: '重新核查后的正文' } });
  const command = vi.fn().mockResolvedValue({ status: 'confirmed', sync: 'ready', commandId: id });
  const props = { client, store: createRuntimeStore(client), sessionId: id, onCommand: command, onOpen: vi.fn() };
  const view = render(<ResultInbox {...props} sourceWatermark="0" />);
  await userEvent.click(await screen.findByRole('button', { name: '查看结果' }));
  await waitFor(() => expect(reply).toBeTypeOf('function'));
  view.rerender(<ResultInbox {...props} sourceWatermark="9007199254740994" />);
  await act(async () => { reply(body); });
  expect(screen.queryByText(/旧来源迟到正文/)).toBeNull();
  expect(command).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledTimes(1);
  await userEvent.click(await screen.findByRole('button', { name: '查看结果' }));
  expect(await screen.findByText(/重新核查后的正文/)).toBeTruthy();
  expect(command).toHaveBeenCalledTimes(2);
});

it('来源失效或会话归档/正在steer时不能选择总结引用；不通过view命令启动总结', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([entry]));
  const store = createRuntimeStore(client), summarize = vi.fn(), command = vi.fn();
  const props = { client, store, sessionId: id, onCommand: command, onOpen: vi.fn(), onSummarize: summarize };
  const view = render(<ResultInbox {...props} summaryBlocked />);
  const button = await screen.findByRole('button', { name: '在会话中总结' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<ResultInbox {...props} />);
  await userEvent.click(button);
  expect(summarize).toHaveBeenCalledWith(entry);
  expect(command).not.toHaveBeenCalled();
  await act(async () => { store.update(state => ({ ...state, deliveries: { [id]: { ...entry, source_valid: false } } })); });
  expect((button as HTMLButtonElement).disabled).toBe(true);
});

it('键盘查看等待时保留可聚焦按钮，拦截同一提交内重复激活并保持其他操作禁用', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([{ ...entry, delivery_state: 'failed' }]));
  let reply!: (result: Awaited<ReturnType<RuntimeClient['taskResult']>>) => void;
  const query = vi.spyOn(client, 'taskResult').mockImplementation(() => new Promise(resolve => { reply = resolve; }));
  const command = vi.fn().mockResolvedValue({ status: 'confirmed', sync: 'ready', commandId: id });
  const store = createRuntimeStore(client), user = userEvent.setup();
  render(<ResultInbox client={client} store={store} sessionId={id} onCommand={command} onOpen={vi.fn()} onSummarize={vi.fn()} />);
  const button = await screen.findByRole('button', { name: '查看结果' }) as HTMLButtonElement;
  await user.tab(); await user.tab();
  expect(document.activeElement).toBe(button);
  // 在 React 提交 busy 之前连续触发，不能仅依赖下一次渲染的状态。
  act(() => { button.click(); button.click(); });
  await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
  expect(command).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(false);
  expect(button.getAttribute('aria-disabled')).toBe('true');
  for (const name of ['刷新结果', '重新投递', '在会话中总结'])
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '定位结果任务' }) as HTMLButtonElement).disabled).toBe(false);
  await user.keyboard('{Enter} ');
  expect(command).toHaveBeenCalledTimes(1);
  await act(async () => { reply({ handle: entry.result, result_version: 1, state: 'completed',
    result: { summary: '键盘查看正文' }, artifacts: [], dependencies: [], error: null }); });
  expect(screen.getByText(/键盘查看正文/)).toBeTruthy();
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute('aria-disabled')).toBe('false');
});

it.each(['success', 'error', 'revoked'] as const)('查看期间移至定位按钮后，%s不抢焦点且不泄漏撤权正文', async outcome => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([entry]));
  let reply!: (result: Awaited<ReturnType<RuntimeClient['taskResult']>>) => void, reject!: (error: Error) => void;
  vi.spyOn(client, 'taskResult').mockImplementation(() => new Promise((resolve, fail) => { reply = resolve; reject = fail; }));
  const store = createRuntimeStore(client), user = userEvent.setup();
  render(<ResultInbox client={client} store={store} sessionId={id}
    onCommand={vi.fn().mockResolvedValue({ status: 'confirmed', sync: 'ready', commandId: id })} onOpen={vi.fn()} onSummarize={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: '查看结果' }));
  await waitFor(() => expect(reply).toBeTypeOf('function'));
  await user.tab();
  const locate = screen.getByRole('button', { name: '定位结果任务' });
  expect(document.activeElement).toBe(locate);
  if (outcome === 'revoked') await act(async () => { store.update(state => ({ ...state, deliveries: { [id]: { ...entry, source_valid: false } } })); });
  await act(async () => {
    if (outcome === 'error') reject(new Error('合成正文读取失败'));
    else reply({ handle: entry.result, result_version: 1, state: 'completed',
      result: { summary: '迟到焦点正文' }, artifacts: [], dependencies: [], error: null });
  });
  expect(document.activeElement).toBe(locate);
  expect(!!screen.queryByText(/迟到焦点正文/)).toBe(outcome === 'success');
  if (outcome === 'error') expect(screen.getByRole('alert').textContent).toContain('合成正文读取失败');
  if (outcome === 'revoked') expect((screen.getByRole('button', { name: '在会话中总结' }) as HTMLButtonElement).disabled).toBe(true);
});

it('未确认查看命令保持可聚焦但不能再次激活', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  vi.spyOn(client, 'sessionResults').mockResolvedValue(page([entry]));
  const store = createRuntimeStore(client), command = vi.fn(), user = userEvent.setup();
  const pending = [{ commandId: secondId, type: 'viewResult' as const, targetId: id, status: 'unconfirmed' as const, sync: 'pending' as const, busy: false, error: '' }];
  vi.spyOn(store, 'getCommandsSnapshot').mockReturnValue(pending);
  render(<ResultInbox client={client} store={store} sessionId={id} onCommand={command} onOpen={vi.fn()} />);
  const button = await screen.findByRole('button', { name: '查看结果' }) as HTMLButtonElement;
  await user.tab(); await user.tab();
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute('aria-disabled')).toBe('true');
  await user.keyboard('{Enter} ');
  await user.click(button);
  expect(command).not.toHaveBeenCalled();
});
