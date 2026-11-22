import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ActivityView, ModelMessage, RunFeedback, RunSnapshot } from '../../generated/contracts';
import { event, grant, id, resource, run, secondId } from '../../test/fixtures';
import MessageList from './MessageList';
import { validate } from '../../api/validation';
import RunFeedbackNotice from '../tasks/RunFeedbackNotice';
import { emptyProjection, reduceStream } from '../../api/events';
import type { RuntimeStore } from '../../state/runtime-store';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function message(messageId: string, parts: ModelMessage['parts'], role: ModelMessage['role'] = 'assistant', activityId: string | null = null): ModelMessage {
  return { id: messageId, run_id: run.id, role, parts, activity_id: activityId, source_dependencies: [], private_ref: null, origin: 'conversation', event_id: '1', event_index: 0 };
}
const call = (name: string, callId = 'reused-call'): Extract<ModelMessage['parts'][number], { kind: 'tool_call' }> => ({ kind: 'tool_call', call_id: callId, name, arguments: { target: name } });
const result = (originId: string | null, text: string, callId = 'reused-call', error: string | null = null): Extract<ModelMessage['parts'][number], { kind: 'tool_result' }> => ({ kind: 'tool_result', origin_message_id: originId, call_id: callId, result: { text }, error });
function article(container: HTMLElement, messageId: string) { return container.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)!; }
function feedback(value: RunSnapshot, error: string, state: ActivityView['state']): RunFeedback {
  return { run_id: value.id, version: value.version, workspace_id: value.workspace_id, session_id: value.interaction_session_id!,
    root_task_id: value.root_task_id, state: value.state, reason: value.reason, connection_id: value.config.model_profile.connection_id,
    context_usage: null, model_activity: { id: uuid(19), version: 3, kind: 'model', operation: 'model.generate', state, error,
      run_id: value.id, task_id: value.root_task_id, usage: null, actual_units: null, dependencies: [], script_execution: null } };
}

it('两个已发送文件归各自的用户原消息，补充文字不继承文件', () => {
  const text = [{ kind: 'text' as const, text: '这个文件' }];
  const first = { ...message(uuid(8), text, 'user'), attachments: [{ resource_id: uuid(31), name: 'tmp.txt',
    resource_lineage: [uuid(31)], read_grant_ids: [uuid(41)] }] };
  const steering = { ...message(uuid(9), text, 'user'), origin: 'steering' as const };
  const second = { ...message(uuid(10), text, 'user'), run_id: secondId, attachments: [{ resource_id: uuid(32), name: 'notes.txt',
    resource_lineage: [uuid(32)], read_grant_ids: [uuid(42)] }] };
  const view = render(<MessageList messages={[first, steering, second]} assistantName="助理" />);
  expect(within(article(view.container, first.id)).getByText('tmp.txt')).toBeTruthy();
  expect(within(article(view.container, steering.id)).queryByText(/\.txt$/)).toBeNull();
  expect(within(article(view.container, second.id)).getByText('notes.txt')).toBeTruthy();
});

it('SSE 来源观察更新保留文件名，最后一份读取授权撤销时只隐藏附件', () => {
  const secondGrant = { ...grant, id: uuid(43) };
  const first = validate('ModelMessage', { ...message(uuid(8), [{ kind: 'text', text: '这个文件' }], 'user'),
    attachments: [{ resource_id: resource.id, name: 'tmp.txt', resource_lineage: [resource.id],
      read_grant_ids: [grant.id] }] });
  let projection = { ...emptyProjection(), entityScopes: {
    [first.id]: { workspace_id: grant.scope.workspace_id, session_id: grant.scope.session_id },
  }};
  const store = { getSnapshot: () => projection } as RuntimeStore;
  const content = () => <MessageList messages={[first]} assistantName="助理" store={store} />;
  const view = render(content());
  expect(screen.getByText('tmp.txt')).toBeTruthy();
  const updated = { ...resource, source_version: 'a'.repeat(64), version: resource.version + 1 };
  projection = reduceStream(projection, validate('StreamEvent', { kind: 'durable', event_id: '2',
    event: { ...event, event_id: '2', kind: 'resource.updated', payload: { resources: [updated], grants: [], approvals: [] } } }));
  view.rerender(content());
  expect(screen.getByText('tmp.txt')).toBeTruthy();
  projection = reduceStream(projection, validate('StreamEvent', { kind: 'durable', event_id: '3',
    event: { ...event, event_id: '3', kind: 'grant.created', payload: { resources: [], grants: [secondGrant], approvals: [] } } }));
  for (const [index, current] of [grant, secondGrant].entries()) {
    const event_id = String(4 + index);
    projection = reduceStream(projection, validate('StreamEvent', { kind: 'durable', event_id,
      event: { ...event, event_id, kind: 'grant.revoked', payload: { resources: [], approvals: [],
        grants: [{ ...current, status: 'revoked', version: current.version + 1, epoch: current.epoch + 1 }] } } }));
    view.rerender(content());
    expect(!!screen.queryByText('tmp.txt')).toBe(index === 0);
  }
  expect(screen.getByText('这个文件')).toBeTruthy();
});

it('同文两轮的错误只在各自任务中显示，设置入口指向失败的连接', () => {
  const otherConnection = uuid(14);
  const first = { ...run, id, state: 'failed' as const, reason: 'model_permission_denied' };
  const second = { ...run, id: secondId, state: 'failed' as const, reason: 'credential_missing',
    config: { ...run.config, model_profile: { ...run.config.model_profile, connection_id: otherConnection } } };
  const open = vi.fn();
  const text = [{ kind: 'text' as const, text: 'hello' }];
  const view = render(<><MessageList messages={[{ ...message(uuid(8), text, 'user'), run_id: id }, { ...message(uuid(9), text, 'user'), run_id: secondId }]}
    runs={[second, first]} assistantName="助理" />
    <RunFeedbackNotice run={first} onOpenConnection={open} /><section aria-label="第二轮任务"><RunFeedbackNotice run={second} onOpenConnection={open} /></section></>);
  expect(article(view.container, uuid(8)).textContent).toBe('你hello');
  expect(screen.getByText(/没有访问此模型的权限/)).toBeTruthy();
  const missing = within(screen.getByRole('region', { name: '第二轮任务' }));
  expect(missing.getByText(/尚未配置密钥/)).toBeTruthy();
  fireEvent.click(missing.getByRole('button', { name: '检查连接' }));
  expect(open).toHaveBeenCalledWith(otherConnection);
  expect(view.container.querySelector('.turn-recovery')).toBeNull();
});

it('历史运行在服务商拒绝后被停止，仍显示该轮根任务的模型回执', () => {
  const stopped = { ...run, state: 'cancelled' as const, reason: 'user_cancelled' };
  const msg = message(uuid(12), [{ kind: 'text', text: 'hello' }], 'user');
  const view = render(<MessageList messages={[msg]} runs={[stopped]} assistantName="助理" />);
  expect(screen.queryByText(/拒绝了此前的请求/)).toBeNull();
  view.rerender(<><MessageList messages={[msg]} runs={[stopped]} assistantName="助理" />
    <RunFeedbackNotice run={stopped} feedback={feedback(stopped, 'model_authentication_failed', 'uncertain')} /></>);
  expect(within(article(view.container, msg.id)).queryByText(/拒绝了此前的请求/)).toBeNull();
  expect(screen.getByText(/拒绝了此前的请求/)).toBeTruthy();
});

it.each([
  ['model_authentication_failed', 'failed', /拒绝了此连接的凭据/],
  ['model_permission_denied', 'failed', /没有访问此模型的权限/],
  ['model_connection_failed', 'uncertain', /无法连接到模型服务/],
  ['model_timeout', 'uncertain', /模型响应超时/],
] as const)('Run保留uncertain_activity时展示根模型的%s，不从当前默认模型推测', (error, state, description) => {
  const interrupted = { ...run, state: 'interrupted' as const, reason: 'uncertain_activity' };
  const input = message(uuid(13), [{ kind: 'text', text: '同一轮' }], 'user');
  render(<><MessageList messages={[input]} runs={[interrupted]} assistantName="助理" />
    <RunFeedbackNotice run={interrupted} feedback={feedback(interrupted, error, state)} /></>);
  expect(screen.getByText(description)).toBeTruthy();
});

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
  expect(within(first).getByText(/result-A/).closest('.tool-card')).toBe(within(first).getByText('notes.read', { selector: 'code' }).closest('.tool-card'));
  expect(within(second).getByText(/result-B/).closest('.tool-card')).toBe(within(second).getByText('web.search', { selector: 'code' }).closest('.tool-card'));
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
  expect(within(article(container, secondId)).getByText('未完成')).toBeTruthy();
  expect(within(article(container, secondId)).getByText('工具结果 · 源调用未加载')).toBeTruthy();
});

it('真实公开契约接收原始错参字符串，保留空白call_id并将错误结果配回原调用', () => {
  const exactId = '  exact wire id  ', raw = '{"number":';
  const source = validate('ModelMessage', message(id, [{ ...call('test.number', exactId), arguments: raw }]));
  const receipt = validate('ModelMessage', message(secondId, [result(id, '请提供整数 number', exactId, 'invalid_arguments')], 'tool'));
  const { container } = render(<MessageList messages={[source, receipt]} assistantName="助理" />);
  expect(container.querySelectorAll('.tool-card')).toHaveLength(1);
  expect(article(container, id).textContent).not.toContain(exactId);
  expect(within(article(container, id)).getByText('未完成')).toBeTruthy();
  expect(article(container, id).textContent).toContain('请提供整数 number');
});

it('活动展开只呈现本次输入和业务结果，不显示调用信封和原始错误码', () => {
  const { container } = render(<MessageList assistantName="助理" messages={[
    message(id, [{ ...call('mcp.docs'), arguments: { query: '离线使用' } }]),
    message(secondId, [result(id, '这份文档支持离线查看', 'reused-call', 'mcp_call_failed')], 'tool'),
  ]} />);
  const card = container.querySelector('.tool-card')!;
  expect(card.textContent).toContain('离线使用');
  expect(card.textContent).toContain('这份文档支持离线查看');
  expect(card.textContent).not.toMatch(/reused-call|origin_message_id|mcp_call_failed/);
});

it('另发的 MCP 回执保留原查询未知状态，展示另发内容且不合并相同参数的其他调用', () => {
  const query = call('mcp.docs');
  const retry = { ...result(id, ''), result: { mcp_requery: true, texts: ['另发查询返回的文档'] } };
  const { container } = render(<MessageList assistantName="助理" messages={[
    message(id, [query]), message(secondId, [retry], 'tool'),
    message(uuid(3), [query]), message(uuid(4), [result(uuid(3), '另一轮查询的结果')], 'tool'),
  ]} />);
  const first = within(article(container, id));
  expect(first.getByText('原查询结果未确认 · 另发查询已返回')).toBeTruthy();
  expect(first.getByText('另发查询返回的文档')).toBeTruthy();
  expect(first.queryByText('另一轮查询的结果')).toBeNull();
  expect(container.textContent).not.toContain('mcp_requery');
});

it('MCP 回执只投影正文和业务字段，来源未知的历史 JSON 保持原字段', () => {
  const receipt = { server_id: uuid(90), catalog_hash: 'catalog-private', config_revision: 8,
    destination: 'mcp://private-host', call_id: 'wire-secret', texts: [`文档中的合法编号 ${uuid(91)}`],
    structured_content: { record_id: uuid(92), conclusion: '支持离线' }, is_error: false };
  const legacy = { result: { text: '旧版本返回的可读结果', server_id: uuid(93), catalog_hash: 'legacy-private' },
    activity_id: uuid(94), config_revision: 6, destination: 'mcp://legacy-private', call_id: 'legacy-call' };
  const { container } = render(<MessageList assistantName="助理" messages={[
    message(id, [{ ...call(`mcp.${uuid(95)}.query`), arguments: { query: '离线使用' } }]),
    message(secondId, [{ ...result(id, ''), result: receipt }], 'tool'),
    message(uuid(96), [{ ...result(null, ''), result: legacy }], 'tool'),
    message(uuid(97), [{ kind: 'text', text: `用户自己输入的 ${uuid(98)}` }], 'user'),
  ]} />);
  expect(container.textContent).toContain(`文档中的合法编号 ${uuid(91)}`);
  expect(container.textContent).toContain(uuid(92));
  expect(container.textContent).toContain('支持离线');
  expect(container.textContent).toContain('旧版本返回的可读结果');
  expect(container.textContent).toContain(`用户自己输入的 ${uuid(98)}`);
  const mcp = article(container, id);
  expect(mcp.textContent).not.toMatch(/server_id|catalog_hash|config_revision|destination|call_id|private-host|wire-secret/);
  expect(mcp.textContent).not.toContain(uuid(90));
  expect(article(container, uuid(96)).textContent).toContain('"server_id"');
  expect(article(container, uuid(96)).textContent).toContain(uuid(93));
  expect(article(container, uuid(96)).textContent).toContain(uuid(94));
});

it('用户澄清 JSON 保留业务字段与占位符样式的值', () => {
  const answer = { kind: 'artifact_preview', artifact_id: uuid(280), truncated: true, total_chars: 12,
    server_id: '客户编号', tool_name: '业务动作', call_id: '订单编号', mcp_requery: true,
    nested: { dependencies: ['合同'], destination: '仓库' } };
  const { container } = render(<MessageList assistantName="助理" messages={[
    message(id, [call('user.ask')]),
    message(secondId, [{ ...result(id, ''), result: answer }], 'tool'),
  ]} />);
  const card = article(container, id).querySelector('.tool-card')!;
  expect(JSON.parse(card.querySelector('.tool-result pre')!.textContent!)).toEqual(answer);
  expect(card.textContent).not.toContain('原查询');
  expect(card.querySelector('button')).toBeNull();
});

it.each([
  ['run.finish', '提交答复'], ['user.ask', '向用户提问'], ['task.submit', '提交任务'],
  ['task.await', '等待任务'], ['task.status', '查看任务状态'], ['task.result', '读取任务结果'], ['task.cancel', '停止任务'],
])('%s 的调用及成功/拒绝/恢复结果均折入同一过程详情，不挤占正文', (name, label) => {
  const error = name === 'run.finish' || name === 'user.ask' ? '控制调用被拒绝' : null;
  const { container } = render(<MessageList messages={[message(secondId, [result(id, 'control-result', 'control-call', error)], 'tool'),
    message(id, [{ kind: 'text', text: '真实交付正文' }, call(name, 'control-call')])]} assistantName="助理" />);
  const source = article(container, id);
  const process = source.querySelector<HTMLDetailsElement>('.process-details')!;
  expect(process.open).toBe(false); expect(source.querySelectorAll('.tool-card')).toHaveLength(1);
  expect(within(source).getByText(/control-result/).closest('.process-details')).toBe(process);
  expect(within(source).getByText(label).closest('.process-details')).toBe(process);
  expect(within(source).queryByText(name, { selector: 'code' })).toBeNull();
  expect(within(source).getByText('真实交付正文').closest('details')).toBeNull();
  expect(container.querySelector('.message--tool')).toBeNull();
});

it('调用已有失败结果时同一动作行明确失败，空错误文本也不伪称成功', () => {
  const { container } = render(<MessageList messages={[message(id, [call('notes.read')]), message(secondId, [result(id, 'failed-result', 'reused-call', '')], 'tool')]} assistantName="助理" />);
  const source = article(container, id);
  expect(within(source).getByText('未完成').closest('.tool-card')).toBe(within(source).getByText('notes.read', { selector: 'code' }).closest('.tool-card'));
  expect(container.querySelectorAll('.tool-card')).toHaveLength(1);
});

it('失败的读取在折叠工具组之外显示，内部结束动作保留自己的过程详情', () => {
  const { container } = render(<MessageList assistantName="助理" messages={[
    message(uuid(85), [call('files.read_text', 'read')]),
    message(uuid(86), [result(uuid(85), '', 'read', 'source_invalid')], 'tool'),
    message(uuid(87), [call('files.list', 'list')]),
    message(uuid(88), [result(uuid(87), '目录已读取', 'list')], 'tool'),
    message(uuid(89), [call('run.finish', 'finish')]),
  ]} />);
  expect(article(container, uuid(85)).querySelector('.tool-card > summary')?.textContent).toContain('未完成');
  expect(article(container, uuid(85)).closest('.activity-group')).toBeNull();
  expect(article(container, uuid(89)).querySelector('.process-details')).toBeTruthy();
  expect(article(container, uuid(89)).closest('.activity-group')).toBeNull();
});
it('reasoning 与正文独立 disclosure，不复制私有对象；内部控制不挤占交付正文', () => {
  const message = { id, run_id: run.id, role: 'assistant', parts: [{ kind: 'reasoning', text: '公开推理', signature: 'private-signature' }, { kind: 'text', text: '交付正文' }, { kind: 'tool_call', call_id: 'finish', name: 'run.finish', arguments: { output: {} } }], activity_id: null, source_dependencies: [], private_ref: null, origin: 'conversation', event_id: '1', event_index: 0 } as ModelMessage;
  render(<MessageList messages={[message]} assistantName="助理" />);
  const summary = document.querySelector('details.reasoning > summary')!;
  expect(summary.textContent).toContain('公开推理');
  expect(summary.closest('.activity-group')).toBeNull();
  expect(screen.getByText('交付正文').closest('details')).toBeNull();
  expect(document.body.textContent).not.toContain('private-signature');
  expect(screen.getByText('提交答复').closest('.process-details')).toBeTruthy();
});

it('已知工具隐藏内部参数和空对象，自定义工具保留同名业务字段', () => {
  const resource_id = uuid(190);
  const { container } = render(<MessageList messages={[
    message(uuid(191), [{ ...call('files.read_text'), arguments: { resource_id } }]),
    message(uuid(192), [{ ...call('files.list'), arguments: {} }]),
    message(uuid(193), [{ ...call('files.read_text'), arguments: { resource_id, offset: 12 } }]),
    message(uuid(194), [{ ...call('notes.read'), arguments: { resource_id, server_id: 'business' } }]),
  ]} assistantName="助理" />);
  for (const messageId of [uuid(191), uuid(192)]) {
    expect(within(article(container, messageId)).queryByText('调用参数')).toBeNull();
  }
  expect(within(article(container, uuid(191))).queryByText('files.read_text')).toBeNull();
  expect(article(container, uuid(193)).textContent).toContain('"offset": 12');
  expect(article(container, uuid(193)).textContent).not.toContain(resource_id);
  expect(article(container, uuid(194)).textContent).toContain(`"resource_id": "${resource_id}"`);
  expect(article(container, uuid(194)).textContent).toContain('"server_id": "business"');
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

it('同文不同轮分别保留一次答复，交付落在各自输入之后，重复读取不会重复正文', () => {
  const output = { summary: '这份资料可以离线使用。', artifact_ids: [], unresolved: [], handled_failures: [] };
  const first = { ...run, state: 'completed' as const, output };
  const second = { ...first, id: secondId };
  const messages = [
    message(uuid(30), [{ kind: 'text', text: '第一轮问题' }], 'user'),
    message(uuid(31), [{ kind: 'text', text: output.summary }]),
    { ...message(uuid(32), [{ kind: 'text', text: '第二轮问题' }], 'user'), run_id: secondId },
  ];
  const view = render(<MessageList assistantName="助理" messages={messages} runs={[second, first]} />);
  expect(screen.getAllByText(output.summary)).toHaveLength(2);
  expect(view.container.textContent!.indexOf('第二轮问题')).toBeGreaterThan(view.container.textContent!.indexOf(output.summary));
  expect(view.container.textContent!.lastIndexOf(output.summary)).toBeGreaterThan(view.container.textContent!.indexOf('第二轮问题'));
  view.rerender(<MessageList assistantName="助理" messages={[...messages,
    { ...message(uuid(33), [{ kind: 'text', text: output.summary }]), run_id: secondId }]} runs={[first, second]} />);
  expect(screen.getAllByText(output.summary)).toHaveLength(2);
});

it('仅工具结束也显示正式交付；中间活动的同文文本不能吞掉最终交付', () => {
  const output = { summary: '已核对文档。', artifact_ids: [], unresolved: ['附件仍待复核'], handled_failures: [] };
  render(<MessageList assistantName="助理" runs={[{ ...run, state: 'completed', output }]} messages={[
    message(uuid(40), [{ kind: 'text', text: '请核对文档' }], 'user'),
    message(uuid(41), [{ kind: 'text', text: output.summary }, call('notes.read')]),
    message(uuid(42), [result(uuid(41), '核对完成')], 'tool'),
    message(uuid(43), [{ ...call('run.finish'), arguments: { output } }]),
  ]} />);
  expect(screen.getAllByText(output.summary)).toHaveLength(2);
  expect(screen.getByText('附件仍待复核')).toBeTruthy();
  expect(document.querySelector('[aria-label="正式答复"]')?.textContent).toContain(output.summary);
});

it('迟到的后台回告留在发布位置，run.finish 的正式结论仍在第二轮提问之前', () => {
  const output = { summary: '第一轮正式结论', artifact_ids: [], unresolved: [], handled_failures: [] };
  const runs = [{ ...run, state: 'completed' as const, output },
    { ...run, id: secondId, state: 'completed' as const, output: { ...output, summary: '第二轮答复' } }];
  const history = [
    message(uuid(301), [{ kind: 'text', text: '第一轮阶段答复' }]),
    message(uuid(302), [{ ...call('run.finish'), arguments: { output } }]),
    { ...message(uuid(303), [{ kind: 'text', text: '第二轮提问' }], 'user'), run_id: secondId },
    { ...message(uuid(304), [{ kind: 'text', text: '第二轮答复' }]), run_id: secondId },
  ];
  const report: ModelMessage = { ...message(uuid(305), [{ kind: 'text', text: '第一轮的后台回告' }]), origin: 'background_report' };
  const view = render(<MessageList messages={history} runs={runs} assistantName="助理" />);
  const order = () => [...view.container.querySelectorAll('article .markdown-body')].map(node => node.textContent);
  const expected = ['第一轮阶段答复', output.summary, '第二轮提问', '第二轮答复'];
  expect(order()).toEqual(expected);
  view.rerender(<MessageList messages={[...history, report]} runs={runs} assistantName="助理" />);
  expect(order()).toEqual([...expected, '第一轮的后台回告']);
});

it('收到补充后由结束工具交付时，不能拿此前同文候选当成最后一次正式答复', () => {
  const output = { summary: '可以离线使用。', artifact_ids: [], unresolved: [], handled_failures: [] };
  render(<MessageList assistantName="助理" runs={[{ ...run, state: 'completed', output }]} messages={[
    message(uuid(50), [{ kind: 'text', text: '请确认能否离线' }], 'user'),
    message(uuid(51), [{ kind: 'text', text: output.summary }]),
    { ...message(uuid(52), [{ kind: 'text', text: '再核对一次测试结果' }], 'user'), origin: 'steering' },
    message(uuid(53), [{ ...call('run.finish'), arguments: { output } }]),
  ]} />);
  expect(screen.getAllByText(output.summary)).toHaveLength(2);
  expect(document.querySelector('[aria-label="正式答复"]')?.textContent).toContain(output.summary);
});

it('归拢相邻过程，保留阶段答复、交错输入和独立失败的原位置', () => {
  const incoming = [
    message(uuid(61), [{ kind: 'reasoning', text: '第一段推理' }]),
    message(uuid(62), [call('files.list', 'room')]),
    message(uuid(63), [result(uuid(62), '第一项核对', 'room')], 'tool'),
    message(uuid(64), [{ kind: 'text', text: '阶段答复' }]),
    { ...message(uuid(65), [{ kind: 'text', text: '另一轮输入' }], 'user'), run_id: secondId },
    message(uuid(66), [result(null, '独立工具失败', 'error', 'invalid_arguments')], 'tool'),
    message(uuid(67), [{ kind: 'text', text: '最终答复' }]),
  ];
  const completed = { ...run, state: 'completed' as const,
    output: { summary: '最终答复', artifact_ids: [], unresolved: [], handled_failures: [] } };
  const openArtifact = vi.fn();
  const file = { id: uuid(68), runId: run.id, label: '设备清单.md' };
  const { container } = render(<MessageList messages={incoming} assistantName="助理" runs={[completed]}
    artifacts={[file]} onOpenArtifact={openArtifact} />);
  const thought = article(container, uuid(61)).querySelector('.reasoning > summary')!;
  expect(thought.textContent).toContain('第一段推理');
  expect(thought.closest('.activity-group')).toBeNull();
  const tool = article(container, uuid(62));
  expect(tool.querySelector('.tool-card > summary')?.textContent).toContain('列出文件');
  expect(tool.querySelector('.message-avatar,.message-author')).toBeNull();
  const ordered = ['阶段答复', '另一轮输入', '独立工具失败', '最终答复'].map(text =>
    container.textContent!.indexOf(text));
  expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  expect(screen.getByText(/独立工具失败/).closest('.activity-group')).toBeNull();
  expect(screen.getByText('未完成').closest('.activity-group')).toBeNull();
  expect(screen.getAllByText('最终答复')).toHaveLength(1);
  expect(screen.queryByText('已完成')).toBeNull();
  const fileLink = screen.getByRole('button', { name: '设备清单.md' });
  expect(fileLink.closest('details')).toBeNull();
  fireEvent.click(fileLink);
  expect(openArtifact).toHaveBeenCalledWith(file.id, run.id);
});

it('同一活动的持久正文到达后立即替换流式显示，后到的历史预览不再显示', () => {
  const activity: ActivityView = {
    id: uuid(70), run_id: run.id, task_id: run.root_task_id, version: 1,
    kind: 'model', operation: 'model.generate', state: 'dispatched', actual_units: null, dependencies: [],
    error: null, usage: null, script_execution: null,
  };
  const input = message(uuid(71), [{ kind: 'text', text: '短问' }], 'user');
  const props = { assistantName: '助理', runs: [run], activities: [activity],
    previews: { [activity.id]: { 0: '流式中间文本' } } };
  const view = render(<MessageList {...props} messages={[input]} />);
  expect(screen.getByText('流式中间文本')).toBeTruthy();
  view.rerender(<MessageList {...props} messages={[input,
    message(uuid(72), [{ kind: 'text', text: '持久答复' }], 'assistant', activity.id)]} />);
  expect(screen.queryByText('流式中间文本')).toBeNull();
  expect(screen.getAllByText('持久答复')).toHaveLength(1);
});

it('来源失效后，配对回执和镜像正式答复都收回', () => {
  const source = { ...message(uuid(81), [call('files.read_text')]), source_valid: false };
  const reply = { ...message(uuid(82), [{ kind: 'text', text: '已失效的答复' }]), source_valid: false };
  render(<MessageList assistantName="助理" messages={[
    source, message(uuid(83), [result(source.id, '已失效的工具正文')], 'tool'), reply,
  ]} runs={[{ ...run, state: 'completed',
    output: { summary: '已失效的答复', artifact_ids: [], unresolved: [], handled_failures: [] } }]} />);
  expect(screen.queryByText(/已失效的答复|已失效的工具正文/)).toBeNull();
  expect(screen.queryByText(/工具结果 · 源调用未加载/)).toBeNull();
});

it('已派发的真实工具进度保持可见，结果仍可从已提交调用查找', () => {
  const action: ActivityView = { id: uuid(91), run_id: run.id, task_id: run.root_task_id, version: 1,
    kind: 'tool', operation: 'files.read_text', state: 'dispatched', dependencies: [],
    error: null, usage: null, actual_units: null, script_execution: null };
  const { container } = render(<MessageList assistantName="助理" runs={[run]} activities={[action]} messages={[
    message(uuid(92), [{ kind: 'reasoning', text: '核对文件' }]),
    message(uuid(93), [call('files.read_text')]),
  ]} />);
  const live = screen.getByRole('region', { name: '本轮活动' });
  expect(live.textContent).toContain('读取文本');
  expect(within(live).getByText(/执行中/)).toBeTruthy();
  expect(container.querySelector('.reasoning > summary')?.textContent).toContain('核对文件');
  expect(article(container, uuid(93)).querySelector('.tool-card > summary')?.textContent).toContain('读取文本');
});
