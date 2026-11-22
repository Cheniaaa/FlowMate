import type { MemberLane } from '../../generated/contracts';
import Status from '../../components/Status';
import { Button } from '../../components/ui/button';
import { activityLabel } from './operation-label';
import { pricingUnknownMessage } from '../../api/pricing';

export default function MemberLanes({ lanes, onSelect, onOpen }: {
  lanes: MemberLane[]; onSelect: (id: string, kind: 'task' | 'activity') => void; onOpen: (runId: string) => void;
}) {
  const members = new Map(lanes.map(lane => [lane.task.id, lane]));
  return <section aria-label="成员泳道" className="member-lanes">
    {!lanes.length && <p>本次任务暂无成员。</p>}
    <div className="my-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3.5">{lanes.map(lane => {
      const config = lane.task.binding.config;
      if (config.kind !== 'agent') return null;
      return <article className="min-w-0 rounded-lg border border-border bg-background p-3.5 wrap-anywhere [&_header]:flex [&_header]:justify-between [&_header]:gap-2 [&_code]:whitespace-normal" key={lane.task.id}>
      <header className="task-step-heading"><h3>{lane.profile.display_name}</h3><Status state={lane.task.state} /></header>
      {lane.task.parent_task_id && members.has(lane.task.parent_task_id) &&
        <p>结果交给{members.get(lane.task.parent_task_id)!.profile.display_name}</p>}
      <details><summary>模型与计价</summary><p>服务地址 {config.model_profile.endpoint}</p>
        <p>{config.pricing_unknown_reason ? `价格未知：${pricingUnknownMessage(config.pricing_unknown_reason)}` : '使用任务开始时固定的模型价格'}</p></details>
      <Button type="button" size="sm" onClick={() => onSelect(lane.task.id, 'task')}>查看{lane.profile.display_name}的任务</Button>
      <p>固定模型 {config.model_profile.model_id}</p>
      {lane.task.binding.agent_work && <details><summary>目标与成功判据</summary><p>{lane.task.binding.agent_work.goal}</p><ul>{lane.task.binding.agent_work.success_criteria.map((text, index) => <li key={index}>{text}</li>)}</ul>
        <p>固定输入产物 {lane.task.binding.input_artifacts.length}</p></details>}
      {lane.task.reason === 'context_authorization_required' && <p>需要核对资料及发送授权。</p>}
      <ol className="list-decimal ps-5 [&>li]:my-3">{lane.activities.map(activity => <li key={activity.id}>
        <Button type="button" size="sm" variant="ghost" onClick={() => onSelect(activity.id, 'activity')}>{activityLabel(activity, lane.task)} · <Status state={activity.state} /></Button>
      </li>)}</ol>
      {lane.handoffs.map(handle => {
        const child = members.get(handle.task_id);
        const managed = handle.lifetime === 'managed';
        return <div className="mt-2.5 border-t border-dashed border-border pt-2.5" key={handle.task_id}>
          <Button type="button" size="sm" onClick={() => managed ? onOpen(handle.run_id) : onSelect(handle.task_id, 'task')}>
            {managed ? '查看后台交接' : child ? `查看委派给${child.profile.display_name}的任务` : '查看委派任务'}</Button>
          {managed ? <p className="muted">独立执行，结果回到原会话。</p> : child && <Status state={child.task.state} />}
        </div>;
      })}
    </article>; })}</div>
  </section>;
}
