import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ContextUsageSummary } from '../../generated/contracts';
import ContextNotice from './ContextNotice';
import { contextUsage } from '../../test/fixtures';

const usage: ContextUsageSummary = { ...contextUsage, activity_id: '00000000-0000-4000-8000-000000000001',
  state: 'prepared', omitted_group_count: 2, omitted_message_count: 121,
  reason_counts: { outside_run_scope: 120, capacity: 1 } };

describe('最近请求上下文提示', () => {
  it('只有范围筛选时，折叠标题说明有多少条历史超出本轮资料范围', () => {
    render(<ContextNotice disclosureName="context-test" usage={{ ...usage, state: 'succeeded',
      omitted_group_count: 1, omitted_message_count: 4, reason_counts: { outside_run_scope: 4 } }} />);
    const summary = screen.getByText('4 条历史消息不在本轮资料范围');
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.closest('details')?.open).toBe(false);
  });
  it('只消费权威摘要，准备和派发事实清晰且不泄露历史正文', async () => {
    const { rerender } = render(<ContextNotice disclosureName="context-test" usage={usage} />);
    expect(screen.getByText('本次未使用部分历史')).toBeTruthy();
    expect(screen.getByText('最近一次模型请求 · 准备使用')).toBeTruthy();
    await userEvent.click(screen.getByText('本次未使用部分历史'));
    expect(screen.getByText('不在本次资料范围：120 条')).toBeTruthy();
    expect(screen.getByText('容量限制：1 条')).toBeTruthy();
    expect(screen.getByText('本次未使用部分历史').closest('details')?.open).toBe(true);
    rerender(<ContextNotice disclosureName="context-test" usage={{ ...usage, state: 'dispatched' }} />);
    expect(screen.getByText('最近一次模型请求 · 已派发')).toBeTruthy();
    expect(screen.queryByText(/供应商已收到/)).toBeNull();
    expect(screen.getByText('本轮模型请求省略了 2 组、共 121 条历史消息。')).toBeTruthy();
  });

  it('没有已提交manifest时不沿用旧Run的省略提示', () => {
    const { rerender, container } = render(<ContextNotice disclosureName="context-test" usage={usage} />);
    rerender(<ContextNotice disclosureName="context-test" usage={null} />);
    expect(container.innerHTML).toBe('');
    rerender(<ContextNotice disclosureName="context-test" usage={{ ...usage, omitted_group_count: 0, omitted_message_count: 0, reason_counts: {} }} />);
    expect(container.innerHTML).toBe('');
  });

  it.each([
    ['running', '正在压缩上下文', null],
    ['blocked', '上下文压缩受阻', 'context_limit'],
    ['invalidated', '上下文压缩已失效', 'source_changed'],
  ] as const)('%s零省略与可空Activity仍显示真实状态及安全原因', (compaction_state, title, compaction_reason) => {
    render(<ContextNotice disclosureName="context-test" usage={{ ...contextUsage, compaction_state, compaction_reason }} />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.queryByText(/undefined|null/)).toBeNull();
    expect(screen.queryByText('本次未使用部分历史')).toBeNull();
    expect(screen.getByRole('complementary', { name: '历史使用说明' }).hasAttribute('data-activity-id')).toBe(false);
    if (compaction_reason) expect(screen.queryByText(new RegExp(compaction_reason))).toBeNull();
  });

  it('已提交但未采用不记成功；采用数来自最近普通装配，原省略说明独立保留', () => {
    const { rerender } = render(<ContextNotice disclosureName="context-test" usage={{ ...contextUsage, compaction_state: 'committed' }} />);
    expect(screen.getByText('上下文摘要已提交')).toBeTruthy();
    expect(screen.queryByText('已采用上下文摘要')).toBeNull();
    rerender(<ContextNotice disclosureName="context-test" usage={{ ...usage, compaction_state: 'committed', summary_count: 2, compacted_message_count: 18 }} />);
    expect(screen.getByText('已采用上下文摘要')).toBeTruthy();
    expect(screen.getByText(/采用 2 份有效摘要，覆盖 18 条原消息/)).toBeTruthy();
    expect(screen.getByText('不在本次资料范围：120 条')).toBeTruthy();
    expect(screen.getByText('容量限制：1 条')).toBeTruthy();
  });

  it.each([
    ['runtime_restart', '运行时重启中断了压缩，请在原运行中查看处理方式。'],
    ['compaction_binding', '压缩请求与原运行的固定资料不一致，请核对原运行。'],
  ])('说明实际阻塞原因 %s', (compaction_reason, explanation) => {
    render(<ContextNotice disclosureName="context-test" usage={{ ...contextUsage, compaction_state: 'blocked', compaction_reason }} />);
    expect(screen.getByText(explanation)).toBeTruthy();
    expect(screen.queryByText(compaction_reason)).toBeNull();
  });

  it('显示排队和执行状态，未知原因仍可查看原运行', async () => {
    const inspect = vi.fn();
    const { rerender } = render(<ContextNotice disclosureName="context-test" onInspectRun={inspect}
      usage={{ ...usage, omitted_message_count: 0, omitted_group_count: 0, reason_counts: {}, compaction_state: 'running' }} />);
    expect(screen.getByText(/压缩活动已排队/)).toBeTruthy();
    rerender(<ContextNotice disclosureName="context-test" onInspectRun={inspect}
      usage={{ ...contextUsage, compaction_state: 'running', state: 'dispatched' }} />);
    expect(screen.getByText(/压缩活动正在执行/)).toBeTruthy();
    rerender(<ContextNotice disclosureName="context-test" onInspectRun={inspect}
      usage={{ ...usage, state: null, compaction_state: 'blocked', compaction_reason: 'new_safe_reason' }} />);
    expect(screen.getByText(/模型活动状态尚未报告/)).toBeTruthy();
    expect(screen.getByText('压缩未能继续，请在原运行中查看处理方式。')).toBeTruthy();
    expect(screen.queryByText(/new_safe_reason/)).toBeNull();
    await userEvent.click(screen.getByText('上下文压缩受阻'));
    await userEvent.click(screen.getByRole('button', { name: '查看原运行与待办' }));
    expect(inspect).toHaveBeenCalledOnce();
  });
});
