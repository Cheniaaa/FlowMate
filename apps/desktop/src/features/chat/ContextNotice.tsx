import type { ContextUsageSummary } from '../../generated/contracts';

const states = { prepared: '准备使用', dispatched: '已派发', succeeded: '已完成', failed: '未完成', uncertain: '结果待确认' };
const reasons = { outside_run_scope: '不在本次资料范围', source_invalid: '来源已失效',
  replay_incompatible: '历史续接不兼容', capacity: '容量限制' };

export default function ContextNotice({ usage, disclosureName }: { usage: ContextUsageSummary | null; disclosureName: string }) {
  if (!usage || usage.omitted_message_count === 0) return null;
  return <aside className="context-notice" aria-label="历史使用说明" data-activity-id={usage.activity_id}>
    <details key={usage.activity_id} name={disclosureName}>
      <summary>本次未使用部分历史</summary>
      <p>最近一次模型请求 · {states[usage.state]}</p>
      <p>共省略 {usage.omitted_group_count} 组、{usage.omitted_message_count} 条。此为已提交请求的记录，不是当前草稿预览。</p>
      <ul>{Object.entries(usage.reason_counts).map(([reason, count]) =>
        <li key={reason}>{reasons[reason as keyof typeof reasons]}：{count} 条</li>)}</ul>
    </details>
  </aside>;
}
