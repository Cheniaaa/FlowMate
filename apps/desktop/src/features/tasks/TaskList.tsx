import type { ActivityView, TaskSnapshot } from '../../generated/contracts';
import { buildTaskGraph, graphStateLabels } from './graph-layout';

export interface TaskListProps {
  tasks: TaskSnapshot[];
  activities: ActivityView[];
  selectedId?: string;
  onSelect: (id: string, kind: 'task' | 'activity') => void;
}

export function TaskList({ tasks, activities, selectedId, onSelect }: TaskListProps) {
  const model = buildTaskGraph(tasks, activities, [], [], [], new Set());
  return <section className="task-list" aria-label="任务列表">
    {model.nodes.length === 0 ? <p>暂无任务或过程</p> : <ul aria-label="任务与过程列表">
      {model.nodes.map(node => <li key={node.id} className={`task-list-item task-list-item--${node.entity_kind}`}>
        <button type="button" data-entity-id={node.id} aria-pressed={selectedId === node.id}
          className={selectedId === node.id ? 'task-list-button task-list-button--selected' : 'task-list-button'}
          onClick={() => onSelect(node.id, node.entity_kind)}>
          <span>{node.entity_kind === 'task' ? '任务' : '过程'} · {node.label}</span>
          <span className="task-list-state">{graphStateLabels[node.state]}</span>
        </button>
      </li>)}
    </ul>}
  </section>;
}
