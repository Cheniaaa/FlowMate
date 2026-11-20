import type { MemberLane } from '../../generated/contracts';
import Status from '../../components/Status';
import { operationLabel } from './operation-label';

export default function MemberLanes({ lanes, onSelect, onOpen }: {
  lanes: MemberLane[]; onSelect: (id: string, kind: 'task' | 'activity') => void; onOpen: (runId: string) => void;
}) {
  return <section aria-label="成员泳道" className="member-lanes">
    <p className="muted">按真实创建与过程顺序展示，不表示持续时间；工具过程归实际执行成员。配置修改不改变这些固定快照。</p>
    {!lanes.length && <p>此运行暂无 Agent 成员。</p>}
    <div className="member-lane-grid">{lanes.map(lane => <article className="member-lane" key={lane.task.id}>
      <header><h3>{lane.profile.display_name}</h3><Status state={lane.task.state} /></header>
      <details><summary>身份与计价详情</summary><p>Profile v{lane.profile.version} · <code>{lane.profile.id}</code></p><code>{lane.task.id}</code>
        <p>{lane.task.binding.config.model_profile.endpoint}</p>
        <p>{lane.task.binding.config.pricing_unknown_reason ? `价格未知：${lane.task.binding.config.pricing_unknown_reason}` : `使用本成员固定价格 ${lane.task.binding.config.model_pricing?.snapshot_id}`}</p></details>
      <button onClick={() => onSelect(lane.task.id, 'task')}>查看{lane.profile.display_name}的任务</button>
      <p>固定模型 {lane.task.binding.config.model_profile.model_id}</p>
      {lane.task.binding.agent_work && <details><summary>目标与成功判据</summary><p>{lane.task.binding.agent_work.goal}</p><ul>{lane.task.binding.agent_work.success_criteria.map((text, index) => <li key={index}>{text}</li>)}</ul>
        <pre>{JSON.stringify(lane.task.binding.agent_work.output_schema, null, 2)}</pre><p>固定输入产物 {lane.task.binding.input_artifacts.length}</p></details>}
      {lane.task.reason && <details><summary>运行诊断</summary><p>{lane.task.reason}</p></details>}
      <ol className="member-activities">{lane.activities.map(activity => <li key={activity.id}>
        <button onClick={() => onSelect(activity.id, 'activity')}>{activity.kind === 'model' ? '模型回复' : operationLabel(activity.operation, lane.task)} · <Status state={activity.state} /></button>
        <details><summary>过程详情</summary><p>{activity.operation}</p><p>Task {activity.task_id} · 已记账单位 {activity.actual_units ?? '未知'}</p></details>
      </li>)}</ol>
      {lane.handoffs.map(handle => <div className="member-handoff" key={`${handle.run_id}:${handle.task_id}`}>
        <button onClick={() => handle.run_id === lane.task.run_id ? onSelect(handle.task_id, 'task') : onOpen(handle.run_id)}>{handle.lifetime === 'managed' ? '查看后台交接' : '查看委派任务'}</button>
        <p className="muted">{handle.lifetime === 'managed' ? '来源关联，不是取消从属关系' : '真实 parent 从属关系'} · {handle.submitted_state}</p>
      </div>)}
    </article>)}</div>
  </section>;
}
