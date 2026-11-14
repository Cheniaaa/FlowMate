import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RunCostSummary as Summary } from '../../generated/contracts';
import RunCostSummary from './RunCostSummary';

const summary: Summary = {
  calculated_units: '1152921504606847099', reserved_units: '120212000',
  unknown_request_count: 3, pending_request_count: 1, currency: 'USD', units_per_currency: '1000000000',
  pricing_basis: { source: 'manual', snapshot_id: 'fixed-price-1', catalog_version: null,
    effective_multiplier: '1', assumptions: ['缓存读取按输入单价计费'], unknown_reason: null },
};

describe('完整费用摘要', () => {
  it('machine code 缓存假设明确映射，小额非零不显示为0', async () => {
    render(<RunCostSummary disclosureName="cost-test" summary={{ ...summary, calculated_units: '1', pricing_basis: { ...summary.pricing_basis, assumptions: ['cache_read_at_input_rate', 'cache_write_at_input_rate', 'cache_write_1h_at_cache_write_rate'] } }} />);
    expect(screen.getByText('已计算费用 $0.000000001')).toBeTruthy(); await userEvent.click(screen.getByText('计价详情'));
    expect(screen.getByText('缓存读取按输入单价计费')).toBeTruthy();
    expect(screen.getByText('缓存写入按输入单价计费')).toBeTruthy();
    expect(screen.getByText('1 小时缓存写入按缓存写入单价计费')).toBeTruthy();
  });
  it('精确显示超JS安全整数金额，并区分unknown、在途与预留', async () => {
    render(<RunCostSummary disclosureName="cost-test" summary={summary} />);
    expect(screen.getByText('已计算费用 $1,152,921,504.606847099')).toBeTruthy();
    expect(screen.getByText('待确认费用 3 次')).toBeTruthy();
    expect(screen.getByText('在途 1 次')).toBeTruthy();
    await userEvent.click(screen.getByText('计价详情'));
    expect(screen.getByText('预留 $0.120212')).toBeTruthy();
    expect(screen.getByText('缓存读取按输入单价计费')).toBeTruthy();
    expect(screen.getByText(/fixed-price-1/)).toBeTruthy();
    expect(screen.getByText(/不是供应商实扣/)).toBeTruthy();
    expect(screen.getByText('计价详情').closest('details')?.open).toBe(true);
  });

  it('known零费用与未知单价并存时不伪称费用全部为零', async () => {
    const { rerender } = render(<RunCostSummary disclosureName="cost-test" summary={{ ...summary, calculated_units: '0',
      pricing_basis: { source: null, snapshot_id: null, catalog_version: null,
        effective_multiplier: null, assumptions: [], unknown_reason: 'price_unknown' } }} />);
    expect(screen.getByText('已计算费用 $0')).toBeTruthy();
    expect(screen.getByText('待确认费用 3 次')).toBeTruthy();
    await userEvent.click(screen.getByText('计价详情'));
    expect(screen.getByText('单价未知')).toBeTruthy();
    rerender(<RunCostSummary disclosureName="cost-test" summary={{ ...summary, calculated_units: '0', reserved_units: '0',
      unknown_request_count: 0, pending_request_count: 0 }} />);
    expect(screen.queryByText(/待确认费用/)).toBeNull();
    expect(screen.queryByText(/在途/)).toBeNull();
    expect(screen.getByText('预留 $0')).toBeTruthy();
  });
});
