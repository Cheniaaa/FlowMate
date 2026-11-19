import { useLayoutEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { createRuntimeStore } from '../../state/runtime-store';
import { id, page, run, secondId } from '../../test/fixtures';
import type { SessionInboxEntry } from '../../generated/contracts';
import ResultInbox from './ResultInbox';

afterEach(() => vi.restoreAllMocks());
const entry: SessionInboxEntry = { id, version: 3, source_event_id: '9007199254740993', target_session_id: id,
  result: { run_id: run.id, task_id: secondId, lifetime: 'managed', submitted_state: 'completed' }, result_version: 1,
  delivery_state: 'delivered', viewed_at: null, dependencies: [], attempts: 1, last_error: null, source_valid: true, consumers: [] };

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
