import type { RunCostSummary as Summary } from '../../generated/contracts';
import PricingAssumptions from '../../components/PricingAssumptions';
import { formatUsd, pricingUnknownMessage } from '../../api/pricing';

export default function RunCostSummary({ summary, disclosureName }: { summary: Summary; disclosureName: string }) {
  const amount = (units: string) => formatUsd(units, summary.units_per_currency);
  const basis = summary.pricing_basis;
  const source = basis.source === 'manual-final' ? '手动配置' : basis.source === 'genai-prices-bundled' ? '内置价格目录' : null;
  return <section className="run-cost-summary" aria-label="本次费用">
    <div className="cost-facts">
      {summary.unknown_request_count > 0 && summary.calculated_units === '0'
        ? <span>费用待确认</span>
        : <span>费用 {amount(summary.calculated_units)} · {summary.unknown_request_count > 0 ? '已知部分' : '按用量计算'}</span>}
      {summary.unknown_request_count > 0 && <span className="cost-unknown">待确认费用 {summary.unknown_request_count} 次</span>}
      {summary.pending_request_count > 0 && <span>在途 {summary.pending_request_count} 次</span>}
    </div>
    <details name={disclosureName}>
      <summary>计价详情</summary>
      <p>预留 {amount(summary.reserved_units)}</p>
      <p>依用量与本次固定价格计算，币种 {summary.currency}；不是供应商实扣。</p>
      {basis.unknown_reason ? <p>单价未知{basis.unknown_reason !== 'price_unknown' && `：${pricingUnknownMessage(basis.unknown_reason)}`}</p>
        : <dl>
          {source && <><dt>价格来源</dt><dd>{source}</dd></>}
          {source && basis.catalog_version && <><dt>目录版本</dt><dd>{basis.catalog_version}</dd></>}
          <dt>有效倍率</dt><dd>{basis.effective_multiplier}</dd>
        </dl>}
      <PricingAssumptions assumptions={basis.assumptions} />
    </details>
  </section>;
}
