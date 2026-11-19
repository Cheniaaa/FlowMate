import type { MemberLane } from '../../generated/contracts';
import Status from '../../components/Status';

export default function MemberLanes({ lanes, onSelect, onOpen }: {
  lanes: MemberLane[]; onSelect: (id: string, kind: 'task' | 'activity') => void; onOpen: (runId: string) => void;
}) {
  return <section aria-label="成员泳道" className="member-lanes">
    <p className="muted">按真实创建与过程顺序展示，不表示持续时间；工具过程归实际执行成员。配置修改不改变这些固定快照。</p>
    {!lanes.length && <p>此运行暂无 Agent 成员。</p>}
    <div className="member-lane-grid">{lanes.map(lane => <article className="member-lane" key={lane.task.id}>
      <header><h3>{lane.profile.display_name}</h3><Status state={lane.task.state} /></header>
      <p>Profile v{lane.profile.version} · <code>{lane.profile.id}</code></p>
      <button onClick={() => onSelect(lane.task.id, 'task')}>查看成员任务 {lane.task.id}</button>
      <p>固定模型 {lane.task.binding.config.model_profile.model_id}</p>
      <p className="muted">{lane.task.binding.config.model_profile.endpoint}</p>
      {lane.task.binding.agent_work && <details><summary>目标与成功判据</summary><p>{lane.task.binding.agent_work.goal}</p><ul>{lane.task.binding.agent_work.success_criteria.map((text, index) => <li key={index}>{text}</li>)}</ul>
        <pre>{JSON.stringify(lane.task.binding.agent_work.output_schema, null, 2)}</pre><p>固定输入产物 {lane.task.binding.input_artifacts.length}</p></details>}
      <p className="muted">{lane.task.binding.config.pricing_unknown_reason ? `价格未知：${lane.task.binding.config.pricing_unknown_reason}` : `使用本成员固定价格 ${lane.task.binding.config.model_pricing?.snapshot_id}`}</p>
      {lane.task.reason && <p>{lane.task.reason}</p>}
      <ol className="member-activities">{lane.activities.map(activity => <li key={activity.id}>
        <button onClick={() => onSelect(activity.id, 'activity')}>{activity.kind === 'tool' ? '工具' : '模型'} · {activity.operation} · {activity.state}</button>
        <p className="muted">Task {activity.task_id} · 已记账单位 {activity.actual_units ?? '未知'}</p>
      </li>)}</ol>
      {lane.handoffs.map(handle => <div className="member-handoff" key={`${handle.run_id}:${handle.task_id}`}>
        <button onClick={() => handle.run_id === lane.task.run_id ? onSelect(handle.task_id, 'task') : onOpen(handle.run_id)}>{handle.lifetime === 'managed' ? '独立后台交接' : '从属委派'} · {handle.task_id}</button>
        <p className="muted">{handle.lifetime === 'managed' ? '来源关联，不是取消从属关系' : '真实 parent 从属关系'} · {handle.submitted_state}</p>
      </div>)}
    </article>)}</div>
  </section>;
}
