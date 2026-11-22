import type { ActivityView, TaskSnapshot } from '../../generated/contracts';
import Status from '../../components/Status';
import { operationLabel } from './operation-label';
import ScriptActivity from './ScriptActivity';

export default function SelectedStep({ id, tasks, activities, onArtifact, fileNames, taskTitles }: {
  id: string; tasks: TaskSnapshot[]; activities: ActivityView[]; onArtifact?: (id: string) => void;
  fileNames?: Record<string, string>;
  taskTitles?: Record<string, string>;
}) {
  const activity = activities.find(item => item.id === id);
  const task = tasks.find(item => item.id === (activity?.task_id ?? id));
  if (!activity && !task) return null;
  const binding = task?.binding;
  const goal = binding?.agent_work?.goal;
  const title = task && taskTitles?.[task.id];
  const config = binding?.config;
  const files = Object.keys(binding?.file_inputs ?? {});
  const namedFiles = files.flatMap(id => fileNames?.[id] ? [fileNames[id]] : []);
  return <section className="entity-detail" aria-label="所选步骤">
    <header className="task-step-heading">
      <h3>{activity ? operationLabel(activity.operation, task) : title || goal || (task!.kind === 'agent' ? '助理任务' : '工具任务')}</h3>
      <Status state={activity?.state ?? task!.state} />
    </header>
    {config && <p className="muted">负责人 {config.agent_profile.display_name}</p>}
    {goal && (activity || title && title !== goal) && <p>任务目标 {goal}</p>}
    {(!activity || activity.kind === 'model') && config && <p>模型 {config.model_profile.model_id}</p>}
    {files.length > 0 && <div><p>固定输入文件 {files.length} 个</p>
      {namedFiles.length > 0 && <ul>{namedFiles.map((name, index) => <li key={index}>{name}</li>)}</ul>}</div>}
    {binding?.agent_work?.success_criteria.length ? <ul>{binding.agent_work.success_criteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul> : null}
    {activity?.actual_units != null && <p>已记账单位 {activity.actual_units}</p>}
    {activity?.usage?.input_tokens != null && <p>输入 Token {activity.usage.input_tokens}</p>}
    {activity?.usage?.output_tokens != null && <p>输出 Token {activity.usage.output_tokens}</p>}
    {activity && <ScriptActivity activity={activity} onArtifact={onArtifact} />}
  </section>;
}
