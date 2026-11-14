import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ContextUsageSummary } from '../../generated/contracts';
import ContextNotice from './ContextNotice';

const usage: ContextUsageSummary = { activity_id: '00000000-0000-4000-8000-000000000001',
  state: 'prepared', omitted_group_count: 2, omitted_message_count: 121,
  reason_counts: { outside_run_scope: 120, capacity: 1 } };

describe('最近请求上下文提示', () => {
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
    expect(screen.getByText(/不是当前草稿预览/)).toBeTruthy();
  });

  it('没有已提交manifest时不沿用旧Run的省略提示', () => {
    const { rerender, container } = render(<ContextNotice disclosureName="context-test" usage={usage} />);
    rerender(<ContextNotice disclosureName="context-test" usage={null} />);
    expect(container.innerHTML).toBe('');
    rerender(<ContextNotice disclosureName="context-test" usage={{ ...usage, omitted_group_count: 0, omitted_message_count: 0, reason_counts: {} }} />);
    expect(container.innerHTML).toBe('');
  });
});
