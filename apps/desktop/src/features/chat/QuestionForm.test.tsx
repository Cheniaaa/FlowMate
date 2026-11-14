import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { AnswerCommand, Question } from '../../generated/contracts';
import { id } from '../../test/fixtures';
import QuestionForm from './QuestionForm';
const question = (schema: Question['answer_schema']): Question => ({ id, version: 1, run_id: id, task_id: id, call_id: 'ask', message_id: id, question: '选择范围', answer_schema: schema, status: 'pending', answer_message_id: null, dependencies: [] });
function Form({ schema, submit }: { schema: Question['answer_schema']; submit: (value: AnswerCommand['data']['answer']) => void }) {
  const [value, change] = useState<AnswerCommand['data']['answer']>();
  return <QuestionForm question={question(schema)} value={value} onChange={change} onSubmit={submit} busy={false} />;
}
it('可选补充初始收起，展开填写再收起重开保留原答案与缺省语义', async () => {
  const submit = vi.fn(); const user = userEvent.setup();
  render(<Form submit={submit} schema={{ type: 'object', properties: { scope: { type: 'string', enum: ['要点', '全文'], title: '范围' }, note: { type: 'string', title: '补充要求' } }, required: ['scope'] }} />);
  const summary = screen.getByText('补充要求（可选）', { selector: 'summary' });
  expect(summary.closest('details')!.open).toBe(false);
  expect(screen.getByRole('textbox', { name: '补充要求' }).closest('details')).toBe(summary.closest('details'));
  await user.click(screen.getByRole('radio', { name: '要点' }));
  await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).toHaveBeenLastCalledWith({ scope: '要点' });
  await user.click(summary); await user.type(screen.getByRole('textbox', { name: '补充要求' }), '保留来源');
  await user.click(summary); await user.click(summary);
  expect((screen.getByRole('textbox', { name: '补充要求' }) as HTMLTextAreaElement).value).toBe('保留来源');
  await user.click(summary); await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).toHaveBeenLastCalledWith({ scope: '要点', note: '保留来源' });
});
it('少量枚举直接选择且保持原scalar类型，不编造其他答案', async () => {
  const submit = vi.fn(); const user = userEvent.setup(); render(<Form submit={submit} schema={{ type: 'integer', enum: [1, 2] }} />);
  const choices = screen.getByRole('group', { name: '回答' });
  expect(within(choices).getAllByRole('radio')).toHaveLength(2);
  expect(screen.queryByText('其他')).toBeNull();
  await user.click(within(choices).getByRole('radio', { name: '2' })); await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).toHaveBeenLastCalledWith(2);
});
it('问答单行输入Enter不提交整卡，明确提交按钮仍可用', async () => {
  const submit = vi.fn(); const user = userEvent.setup(); render(<Form submit={submit} schema={{ type: 'integer', minimum: 1 }} />);
  await user.type(screen.getByLabelText('回答'), '2{Enter}');
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).toHaveBeenCalledWith(2);
});
it('扁平表单区分 optional 缺省和显式 null，boolean/数字/多选保留类型', async () => {
  const submit = vi.fn(); const user = userEvent.setup();
  render(<Form submit={submit} schema={{ type: 'object', properties: { enabled: { type: 'boolean', title: '启用' }, count: { type: 'integer', minimum: 1, title: '数量' }, note: { type: ['string', 'null'], title: '备注' }, tags: { type: 'array', title: '标签', items: { type: 'string', enum: ['A', 'B'] } } }, required: ['enabled', 'count', 'tags'], additionalProperties: false }} />);
  await user.click(within(screen.getByRole('group', { name: '启用' })).getByRole('radio', { name: '是' })); await user.type(screen.getByLabelText('数量'), '2');
  await user.click(screen.getByLabelText('A')); await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).toHaveBeenLastCalledWith({ enabled: true, count: 2, tags: ['A'] });
  await user.click(screen.getByText('备注（可选）', { selector: 'summary' }));
  await user.click(screen.getByLabelText('备注：设为 null')); await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).toHaveBeenLastCalledWith({ enabled: true, count: 2, tags: ['A'], note: null });
});
it('按 schema 拒绝越界与超过 8KiB 文本，不展示 JSON 编辑器', async () => {
  const submit = vi.fn(); render(<Form submit={submit} schema={{ type: 'string', maxLength: 9000 }} />);
  fireEvent.change(screen.getByLabelText('回答'), { target: { value: '中'.repeat(3000) } });
  fireEvent.submit(screen.getByRole('button', { name: '提交回答' }).closest('form')!);
  expect(submit).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('8KiB');
});
it('无 type 的同类 enum 可用，multipleOf 检查不拒绝有效小数', async () => {
  const submit = vi.fn(); const user = userEvent.setup();
  const view = render(<Form submit={submit} schema={{ enum: ['A', 'B'] }} />);
  await user.click(screen.getByRole('radio', { name: 'A' })); await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).toHaveBeenLastCalledWith('A'); view.unmount();
  render(<Form submit={submit} schema={{ type: 'number', multipleOf: 0.1 }} />);
  await user.type(screen.getByLabelText('回答'), '0.35'); await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).toHaveBeenCalledTimes(1);
  await user.clear(screen.getByLabelText('回答')); await user.type(screen.getByLabelText('回答'), '0.3'); await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).toHaveBeenLastCalledWith(0.3);
});
it.each([{ schema: { type: 'object', properties: { note: { type: 'string' } } }, answer: {} }, { schema: { type: 'array', items: { enum: ['A', 'B'] }, minItems: 0 }, answer: [] }, { schema: { type: 'string', minLength: 0 }, answer: '' }])('未填写时只按 Schema 提交合法空值 $answer，不把缺省变成 null', async ({ schema, answer }) => {
  const submit = vi.fn(); render(<Form submit={submit} schema={schema} />);
  fireEvent.submit(screen.getByRole('button', { name: '提交回答' }).closest('form')!);
  expect(submit).toHaveBeenCalledWith(answer);
});
it('nullable enum 仍受 enum 约束，未知关键字不冒充受支持表单', async () => {
  const submit = vi.fn(); const user = userEvent.setup();
  const view = render(<Form submit={submit} schema={{ type: ['string', 'null'], enum: ['A'] }} />);
  await user.click(screen.getByLabelText('回答：设为 null')); await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).not.toHaveBeenCalled(); view.unmount();
  render(<Form submit={submit} schema={{ type: 'string', const: 'A' }} />);
  expect(screen.getByRole('alert').textContent).toContain('不受支持'); expect(screen.queryByLabelText('回答')).toBeNull();
});
it('UTF8 文本恰好 8192bytes 可提交，optional 文本可以明确恢复缺省', async () => {
  const submit = vi.fn(); const user = userEvent.setup();
  render(<Form submit={submit} schema={{ type: 'object', properties: { note: { type: 'string', title: '备注' } } }} />);
  await user.click(screen.getByText('备注（可选）', { selector: 'summary' }));
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: 'a'.repeat(8192) } });
  await user.click(screen.getByRole('button', { name: '提交回答' })); expect(submit).toHaveBeenLastCalledWith({ note: 'a'.repeat(8192) });
  await user.click(screen.getByRole('button', { name: '不填写备注' })); await user.click(screen.getByRole('button', { name: '提交回答' }));
  expect(submit).toHaveBeenLastCalledWith({});
});
it('无 properties 的空 object 合法；无 type 的混合 scalar enum 明确不可处理', () => {
  const submit = vi.fn(); const view = render(<Form submit={submit} schema={{ type: 'object' }} />);
  fireEvent.submit(screen.getByRole('button', { name: '提交回答' }).closest('form')!); expect(submit).toHaveBeenCalledWith({}); view.unmount();
  render(<Form submit={submit} schema={{ enum: ['A', 1] }} />);
  expect(screen.getByRole('alert').textContent).toContain('不受支持'); expect(screen.queryByLabelText('回答')).toBeNull();
});
