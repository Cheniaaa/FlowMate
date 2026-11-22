import type { ContextUsageSummary } from '../../generated/contracts';
import { Button } from '../../components/ui/button';

const states = { prepared: '准备使用', dispatched: '已派发', succeeded: '已完成', failed: '未完成', uncertain: '结果待确认' };
const reasons = { outside_run_scope: '不在本次资料范围', source_invalid: '来源已失效',
  replay_incompatible: '历史续接不兼容', capacity: '容量限制' };
const compactionTitles = { none: '本次未使用部分历史', running: '正在压缩上下文', committed: '上下文摘要已提交',
  blocked: '上下文压缩受阻', invalidated: '上下文压缩已失效' };
const privateStateUnavailable = '历史模型续接资料不可用，请在原运行中查看处理方式。';
const compactionReasons: Record<string, string> = {
  context_limit: '当前模型窗口无法容纳必需内容或最小压缩请求。',
  context_authorization_required: '需要核对原资料范围、来源有效性及模型目的地授权。',
  context_incomplete: '历史工具交互不完整，需要核对原运行。',
  blocked_incompatible: '历史续接或摘要结构不兼容，需要核对原运行。',
  plugin_or_tool_version_unavailable: '原运行所需的插件或工具版本不可用，请核对原运行。',
  compaction_binding: '压缩请求与原运行的固定资料不一致，请核对原运行。',
  runtime_restart: '运行时重启中断了压缩，请在原运行中查看处理方式。',
  uncertain_activity: '压缩请求结果待确认，请查看原运行。',
  scope_revoked: '原资料的授权已撤销，请核对原运行。',
  scope_mismatch: '原资料与本轮权限范围不一致，请核对原运行。',
  outside_run_scope: '压缩所需资料不在本轮资料范围内。',
  grant_required: '压缩所需资料缺少授权，请核对原运行。',
  source_scope_changed: '原资料范围已改变，请核对原运行。',
  source_version_conflict: '原资料版本已改变，请核对原运行。',
  private_state_missing: privateStateUnavailable,
  private_state_invalid: privateStateUnavailable,
  private_state_too_large: privateStateUnavailable,
  private_state_unavailable: privateStateUnavailable,
  unsupported_capability: '当前模型不支持原请求所需的能力，请核对原运行。',
  vision_model_required: '本轮需要能处理图片的模型，请核对原运行。',
  invalid_compaction_summary: '压缩结果未通过结构校验，本轮候选未采用。',
  source_changed: '来源或当前指令已改变，失效内容不计为有效摘要。',
};

export default function ContextNotice({ usage, disclosureName, onInspectRun }: {
  usage: ContextUsageSummary | null; disclosureName: string; onInspectRun?: () => void;
}) {
  if (!usage || usage.omitted_message_count === 0 && usage.compaction_state === 'none') return null;
  const hasCompaction = usage.compaction_state !== 'none';
  let title = compactionTitles[usage.compaction_state];
  if (usage.compaction_state === 'committed' && usage.summary_count > 0) title = '已采用上下文摘要';
  if (!hasCompaction && usage.reason_counts.outside_run_scope === usage.omitted_message_count) {
    title = `${usage.omitted_message_count} 条历史消息不在本轮资料范围`;
  }
  const explanation = usage.compaction_reason && Object.hasOwn(compactionReasons, usage.compaction_reason)
    ? compactionReasons[usage.compaction_reason]
    : usage.compaction_state === 'blocked' ? '压缩未能继续，请在原运行中查看处理方式。' : null;
  return <aside className="context-notice" aria-label="历史使用说明" data-state={usage.compaction_state} data-activity-id={usage.activity_id ?? undefined}>
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
        {explanation && <p>{explanation}</p>}
        {onInspectRun && <Button size="sm" variant="ghost" onClick={onInspectRun}>查看原运行与待办</Button>}
        <p>审批、权限和允许操作沿原运行与待办处理，摘要不授予新权限。</p>
      </>}
      {usage.omitted_message_count > 0 && <><p>本轮模型请求省略了 {usage.omitted_group_count} 组、共 {usage.omitted_message_count} 条历史消息。</p>
        <ul>{Object.entries(usage.reason_counts).map(([reason, count]) =>
          <li key={reason}>{reasons[reason as keyof typeof reasons] ?? reason}：{count} 条</li>)}</ul></>}
    </details>
  </aside>;
}
