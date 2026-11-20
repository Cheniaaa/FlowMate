import type { RunCostSummary as Summary } from '../../generated/contracts';
import PricingAssumptions from '../../components/PricingAssumptions';

export default function RunCostSummary({ summary, disclosureName }: { summary: Summary; disclosureName: string }) {
  const scale = BigInt(summary.units_per_currency);
  const amount = (units: string) => {
    const value = BigInt(units);
    const fraction = (value % scale).toString().padStart(summary.units_per_currency.length - 1, '0').replace(/0+$/, '');
    return `$${(value / scale).toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
  };
  const basis = summary.pricing_basis;
  return <section className="run-cost-summary" aria-label="本次费用">
    <div className="cost-facts">
      <span>费用 {amount(summary.calculated_units)} · 按用量计算</span>
      {summary.unknown_request_count > 0 && <span className="cost-unknown">待确认费用 {summary.unknown_request_count} 次</span>}
      {summary.pending_request_count > 0 && <span>在途 {summary.pending_request_count} 次</span>}
    </div>
    <details name={disclosureName}>
      <summary>计价详情</summary>
      <p>预留 {amount(summary.reserved_units)}</p>
      <p>依用量与本次固定价格计算，币种 {summary.currency}；不是供应商实扣。</p>
      {basis.unknown_reason ? <p>{basis.unknown_reason === 'price_unknown' ? '单价未知' : `计价未知：${basis.unknown_reason}`}</p>
        : <dl>
          <dt>价格来源</dt><dd>{basis.source}</dd>
          <dt>固定快照</dt><dd>{basis.snapshot_id}</dd>
          {basis.catalog_version && <><dt>目录版本</dt><dd>{basis.catalog_version}</dd></>}
          <dt>有效倍率</dt><dd>{basis.effective_multiplier}</dd>
        </dl>}
      <PricingAssumptions assumptions={basis.assumptions} />
    </details>
  </section>;
}
