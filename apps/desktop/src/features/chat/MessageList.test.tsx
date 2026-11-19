import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ModelMessage } from '../../generated/contracts';
import { id, secondId } from '../../test/fixtures';
import MessageList from './MessageList';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function message(messageId: string, parts: ModelMessage['parts'], role: ModelMessage['role'] = 'assistant', activityId: string | null = null): ModelMessage {
  return { id: messageId, role, parts, activity_id: activityId, source_dependencies: [], private_ref: null, origin: 'conversation', event_id: '1', event_index: 0 };
}
const call = (name: string, callId = 'reused-call'): Extract<ModelMessage['parts'][number], { kind: 'tool_call' }> => ({ kind: 'tool_call', call_id: callId, name, arguments: { target: name } });
const result = (originId: string | null, text: string, callId = 'reused-call', error: string | null = null): Extract<ModelMessage['parts'][number], { kind: 'tool_result' }> => ({ kind: 'tool_result', origin_message_id: originId, call_id: callId, result: { text }, error });
function article(container: HTMLElement, messageId: string) { return container.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)!; }

it.each([
  { label: '正常消息顺序', order: [0, 1, 2, 3] },
  { label: '工具结果先于源消息', order: [3, 0, 2, 1] },
  { label: '跨任务混合乱序', order: [1, 2, 0, 3] },
])('$label：重复 call_id 只按源 assistant message 身份配对，普通调用与结果紧凑同行', ({ order }) => {
  // 两个 Task 的模型/工具 Activity 各不相同，不能按 Activity 或输入顺序配对。
  const messages = [message(id, [call('notes.read')], 'assistant', uuid(101)), message(secondId, [call('web.search')], 'assistant', uuid(201)),
    message(uuid(3), [result(id, 'result-A')], 'tool', uuid(102)), message(uuid(4), [result(secondId, 'result-B')], 'tool', uuid(202))];
  const { container } = render(<MessageList messages={order.map(index => messages[index])} assistantName="助理" />);
  expect(container.querySelectorAll('.tool-card')).toHaveLength(2);
  const first = article(container, id), second = article(container, secondId);
  expect(within(first).getByText(/result-A/).closest('.tool-card')).toBe(within(first).getByText('工具调用 · notes.read').closest('.tool-card'));
  expect(within(second).getByText(/result-B/).closest('.tool-card')).toBe(within(second).getByText('工具调用 · web.search').closest('.tool-card'));
  expect(within(first).queryByText(/result-B/)).toBeNull(); expect(within(second).queryByText(/result-A/)).toBeNull();
  expect(within(first).getByText('已返回').closest('summary')).toBeTruthy();
  expect(container.querySelector('.message--tool')).toBeNull();
});

it('分页缺源与 null 来源的结果独立可读，不借同 call_id 猜配对；补到真源后才合并', () => {
  const wrong = message(id, [call('wrong-source')]);
  const orphan = message(uuid(3), [result(secondId, 'known-origin-result')], 'tool');
  const independent = message(uuid(4), [result(null, 'no-origin-result')], 'tool');
  const view = render(<MessageList messages={[wrong, orphan, independent]} assistantName="助理" />);
  expect(within(article(view.container, id)).getByText('结果未加载')).toBeTruthy();
  expect(within(article(view.container, id)).queryByText(/known-origin-result|no-origin-result/)).toBeNull();
  expect(within(article(view.container, uuid(3))).getByText('工具结果 · 源调用未加载')).toBeTruthy();
  expect(within(article(view.container, uuid(4))).getByText('工具结果 · 无来源关联')).toBeTruthy();
  const actual = message(secondId, [call('actual-source')]);
  view.rerender(<MessageList messages={[independent, actual, orphan, wrong]} assistantName="助理" />);
  expect(within(article(view.container, secondId)).getByText(/known-origin-result/)).toBeTruthy();
  expect(within(article(view.container, secondId)).queryByText(/no-origin-result/)).toBeNull();
  expect(within(article(view.container, uuid(4))).getByText(/no-origin-result/)).toBeTruthy();
  expect(article(view.container, uuid(3))).toBeNull();
});

it('源消息已加载但 call_id 不同仍不能配对，独立失败结果不丢失', () => {
  const { container } = render(<MessageList messages={[message(id, [call('notes.read', 'call-A')]), message(secondId, [result(id, 'unmatched-error', 'call-B', '失败原因')], 'tool')]} assistantName="助理" />);
  expect(container.querySelectorAll('.tool-card')).toHaveLength(2);
  expect(within(article(container, id)).getByText('结果未加载')).toBeTruthy();
  expect(within(article(container, secondId)).getByText(/失败原因/)).toBeTruthy();
  expect(within(article(container, secondId)).getByText('工具结果 · 源调用未加载')).toBeTruthy();
});

it.each(['run.finish', 'user.ask', 'task.submit', 'task.await', 'task.status', 'task.result', 'task.cancel'])('%s 的调用及成功/拒绝/恢复结果均折入同一过程详情，不挤占正文', name => {
  const error = name === 'run.finish' || name === 'user.ask' ? '控制调用被拒绝' : null;
  const { container } = render(<MessageList messages={[message(secondId, [result(id, 'control-result', 'control-call', error)], 'tool'),
    message(id, [{ kind: 'text', text: '真实交付正文' }, call(name, 'control-call')])]} assistantName="助理" />);
  const source = article(container, id);
  const process = source.querySelector<HTMLDetailsElement>('.process-details')!;
  expect(process.open).toBe(false); expect(source.querySelectorAll('.tool-card')).toHaveLength(1);
  expect(within(source).getByText(/control-result/).closest('.process-details')).toBe(process);
  expect(within(source).getByText(`工具调用 · ${name}`).closest('.process-details')).toBe(process);
  expect(within(source).getByText('真实交付正文').closest('details')).toBeNull();
  expect(container.querySelector('.message--tool')).toBeNull();
});

it('调用已有失败结果时同一动作行明确失败，空错误文本也不伪称成功', () => {
  const { container } = render(<MessageList messages={[message(id, [call('notes.read')]), message(secondId, [result(id, 'failed-result', 'reused-call', '')], 'tool')]} assistantName="助理" />);
  const source = article(container, id);
  expect(within(source).getByText('未完成').closest('.tool-card')).toBe(within(source).getByText('工具调用 · notes.read').closest('.tool-card'));
  expect(container.querySelectorAll('.tool-card')).toHaveLength(1);
});
it('reasoning 与正文独立 disclosure，不复制私有对象；内部控制不挤占交付正文', () => {
  const message = { id, role: 'assistant', parts: [{ kind: 'reasoning', text: '公开推理', signature: 'private-signature' }, { kind: 'text', text: '交付正文' }, { kind: 'tool_call', call_id: 'finish', name: 'run.finish', arguments: { output: {} } }], activity_id: null, source_dependencies: [], private_ref: null, origin: 'conversation', event_id: '1', event_index: 0 } as ModelMessage;
  render(<MessageList messages={[message]} assistantName="助理" />);
  expect(screen.getByText('公开推理').closest('details')?.querySelector('summary')?.textContent).toContain('推理');
  expect(screen.getByText('交付正文').closest('details')).toBeNull();
  expect(document.body.textContent).not.toContain('private-signature');
  expect(screen.getByText('工具调用 · run.finish').closest('.process-details')).toBeTruthy();
});

it.each([
  '{"handle":{"run_id":"internal-run","task_id":"internal-task"},"result":{"summary":"旧上下文交付正文"},"dependencies":[{"scope_id":"internal-scope","epoch":1}]}',
  '旧上下文交付正文，无需解析为JSON',
])('task_result按可信origin显示交付标记，不冒充用户或展开上下文：%s', text => {
  const input: ModelMessage = { ...message(id, [{ kind: 'text', text }], 'user'), origin: 'task_result',
    source_dependencies: [{ scope_id: secondId, epoch: 1 }], private_ref: 'private-context-ref' };
  const frozen = JSON.stringify(input);
  const { container } = render(<MessageList messages={[input,
    message(secondId, [{ kind: 'text', text: '最终助理总结' }])]} assistantName="助理" />);
  const received = article(container, id);
  expect(received.textContent).not.toContain(text);
  expect(received.textContent).toContain('已接收任务交付');
  expect(received.querySelector('.message-avatar')?.textContent).not.toBe('你');
  expect(received.classList.contains('message--user')).toBe(false);
  expect(received.innerHTML).not.toMatch(/internal-run|internal-task|internal-scope|private-context-ref|旧上下文交付正文/);
  expect(screen.getByText('最终助理总结')).toBeTruthy();
  expect(JSON.stringify(input)).toBe(frozen);
});

it.each(['conversation', 'steering', 'answer'] as const)('真实用户%s输入的TaskResult形状JSON保留原话与用户身份，不按文本猜来源', origin => {
  const text = '{"origin":"task_result","handle":{"task_id":"用户自己输入的ID"},"dependencies":[],"result":{"summary":"用户自己的JSON"}}';
  const { container } = render(<MessageList messages={[{ ...message(id, [{ kind: 'text', text }], 'user'), origin }]} assistantName="助理" />);
  const user = article(container, id);
  expect(within(user).getByText(text).textContent).toBe(text);
  expect(user.querySelector('.message-avatar')?.textContent).toBe('你');
  expect(screen.queryByText(/已接收任务交付/)).toBeNull();
});
