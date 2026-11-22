import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ModelMessage } from '../../generated/contracts';
import { id, run } from '../../test/fixtures';
import MessageList from '../chat/MessageList';
import { evidenceId } from './knowledge-fixtures';

const summary = '结论 [1]，**依据 [1]**。未知 [2]、[0]、[01]。\n\n`[1]`\n\n```txt\n[1]\n```\n\n[伪造 [1]](file:///private.txt) [1](https://example.invalid/evidence) <button>[1]</button>';
it.each([true, false])('只让正式输出的真实正整数 marker 成为引用，合并最终消息=%s', represented => {
  const open = vi.fn();
  const message: ModelMessage = { id, run_id: run.id, role: 'assistant', origin: 'conversation',
    activity_id: null, source_dependencies: [], private_ref: null, event_id: '1', event_index: 0,
    parts: [{ kind: 'text', text: represented ? summary : '过程 [1]' }] };
  render(<MessageList assistantName="助理" messages={[message]} onOpenEvidence={open}
    runs={[{ ...run, state: 'completed', output: { summary, artifact_ids: [], handled_failures: [], unresolved: [],
      citations: [{ marker: 1, evidence_id: evidenceId }] } }]} />);
  const links = screen.getAllByRole('button', { name: '查看引用 1' });
  expect(links).toHaveLength(3);
  fireEvent.click(links[0]);
  expect(open).toHaveBeenCalledWith(run.workspace_id, evidenceId);
  expect(screen.queryByRole('button', { name: '查看引用 2' })).toBeNull();
  expect(screen.getAllByText('[1]', { selector: 'code' })).toHaveLength(2);
  expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.invalid/evidence');
});

it('用户、预览和未发布模型消息不能借用本轮的引用映射', () => {
  const open = vi.fn();
  const message: ModelMessage = { id, run_id: run.id, role: 'user', origin: 'conversation',
    activity_id: null, source_dependencies: [], private_ref: null, event_id: '1', event_index: 0,
    parts: [{ kind: 'text', text: '自己输入的 [1]' }] };
  render(<MessageList assistantName="助理" messages={[message]} onOpenEvidence={open} runs={[run]} />);
  expect(screen.queryByRole('button', { name: '查看引用 1' })).toBeNull();
});
