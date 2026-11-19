import type { ContextUsageSummary } from '../../generated/contracts';

const states = { prepared: '准备使用', dispatched: '已派发', succeeded: '已完成', failed: '未完成', uncertain: '结果待确认' };
const reasons = { outside_run_scope: '不在本次资料范围', source_invalid: '来源已失效',
  replay_incompatible: '历史续接不兼容', capacity: '容量限制' };
const compactionTitles = { none: '本次未使用部分历史', running: '正在压缩上下文', committed: '上下文摘要已提交',
  blocked: '上下文压缩受阻', invalidated: '上下文压缩已失效' };
const compactionReasons: Record<string, string> = {
  context_limit: '当前模型窗口无法容纳必需内容或最小压缩请求。',
  context_authorization_required: '需要核对原资料范围、来源有效性及模型目的地授权。',
  context_incomplete: '历史工具交互不完整，需要核对原运行。',
  blocked_incompatible: '历史续接或摘要结构不兼容，需要核对原运行。',
  invalid_compaction_summary: '压缩结果未通过结构校验，本轮候选未采用。',
  source_changed: '来源或当前指令已改变，失效内容不计为有效摘要。',
};

export default function ContextNotice({ usage, disclosureName, onInspectRun }: {
  usage: ContextUsageSummary | null; disclosureName: string; onInspectRun?: () => void;
}) {
  if (!usage || usage.omitted_message_count === 0 && usage.compaction_state === 'none') return null;
  const hasCompaction = usage.compaction_state !== 'none';
  const title = usage.compaction_state === 'committed' && usage.summary_count > 0 ? '已采用上下文摘要' : compactionTitles[usage.compaction_state];
  return <aside className="context-notice" aria-label="历史使用说明" data-activity-id={usage.activity_id ?? undefined}>
    <details key={usage.activity_id ?? undefined} name={disclosureName}>
      <summary>{title}</summary>
      <p>{usage.state ? `最近一次模型请求 · ${states[usage.state]}`
        : usage.activity_id ? '模型活动状态尚未报告' : '尚未创建模型请求活动'}</p>
      {hasCompaction && <>
        {usage.compaction_state === 'running' && <p>{usage.state === 'prepared' ? '压缩活动已排队，等待执行。'
          : usage.state === 'dispatched' ? '压缩活动正在执行，费用沿当前账本记录。' : '压缩阶段进行中，本轮候选尚未计作已采用摘要。'}</p>}
        {usage.summary_count > 0 ? <p>最近普通请求采用 {usage.summary_count} 份有效摘要，覆盖 {usage.compacted_message_count} 条原消息。</p>
          : <p>有效摘要采用数 {usage.summary_count} · 替换原消息数 {usage.compacted_message_count}。</p>}
        {usage.compaction_state === 'committed' && <p>{usage.summary_count === 0 && '摘要已提交，尚未报告采用。'}原用户要求与近期完整交互仍保留。</p>}
        {usage.compaction_reason && <p>原因：{compactionReasons[usage.compaction_reason]}（{usage.compaction_reason}）</p>}
        {onInspectRun && <button type="button" onClick={onInspectRun}>查看原运行与待办</button>}
        <p>审批、权限和允许操作沿原运行与待办处理，摘要不授予新权限。</p>
      </>}
      {usage.omitted_message_count > 0 && <><p>共省略 {usage.omitted_group_count} 组、{usage.omitted_message_count} 条。此为已提交请求的记录，不是当前草稿预览。</p>
        <ul>{Object.entries(usage.reason_counts).map(([reason, count]) =>
          <li key={reason}>{reasons[reason as keyof typeof reasons] ?? reason}：{count} 条</li>)}</ul></>}
    </details>
  </aside>;
}
