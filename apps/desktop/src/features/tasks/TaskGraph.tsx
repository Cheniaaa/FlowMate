import { Fragment, useId, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ActivityView, JoinFact, ResultConsumption, TaskSnapshot, WaitRecord } from '../../generated/contracts';
import { buildTaskGraph, graphStateLabels } from './graph-layout';

export interface TaskGraphProps {
  tasks: TaskSnapshot[];
  activities: ActivityView[];
  waits: WaitRecord[];
  consumptions: ResultConsumption[];
  joins: JoinFact[];
  collapsedIds: ReadonlySet<string>;
  selectedId?: string;
  onSelect: (id: string, kind: 'task' | 'activity') => void;
  onToggle: (id: string) => void;
}

export function TaskGraph({ tasks, activities, waits, consumptions, joins, collapsedIds, selectedId, onSelect, onToggle }: TaskGraphProps) {
  const markerId = useId();
  const model = buildTaskGraph(tasks, activities, waits, consumptions, joins, collapsedIds);
  const nodeById = new Map(model.nodes.map(node => [node.id, node]));
  const labelCounts = new Map<string, number>();
  for (const node of model.nodes) labelCounts.set(node.label, (labelCounts.get(node.label) ?? 0) + 1);
  const labelOrder = new Map<string, number>();
  const expandable = new Set([
    ...tasks.flatMap(task => task.parent_task_id === null ? [] : [task.parent_task_id]),
    ...activities.map(activity => activity.task_id),
  ]);
  const width = Math.max(288, ...model.nodes.map(node => node.x + 176));
  const height = Math.max(96, ...model.nodes.map(node => node.y + 48));
  function activate(event: KeyboardEvent<SVGGElement>, action: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  }
  return <section className="task-graph" aria-label="任务图">
    <details className="graph-order-note"><summary>图例</summary>
    <ul className="graph-legend" aria-label="任务图图例">
      <li>父关系：实线</li><li>等待：虚线 → 等待目标</li>
      <li>结果消费：虚线 → 消费任务</li><li>结果合流：虚线 → 根任务</li>
    </ul></details>
    {model.nodes.length === 0 ? <p>暂无任务或过程</p> : <div className="task-graph-canvas">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="任务与过程关系">
        <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker></defs>
        {model.edges.map(edge => {
          const from = nodeById.get(edge.from)!;
          const to = nodeById.get(edge.to)!;
          const down = to.y > from.y;
          const startY = from.y + (down ? 30 : -30);
          const endY = to.y + (down ? -30 : 30);
          const middleY = (startY + endY) / 2;
          let path = `M ${from.x} ${startY} C ${from.x} ${middleY}, ${to.x} ${middleY}, ${to.x} ${endY}`;
          if (edge.kind !== 'parent') {
            // 真实依赖使用独立侧线，避免同端点的实线覆盖虚线。
            const lane = { wait: 0, consumed: 1, join: 2 }[edge.kind];
            const bendX = Math.max(from.x, to.x) + 140 + lane * 12;
            const offsetY = (lane - 1) * 12;
            path = `M ${from.x + 118} ${from.y + offsetY} C ${bendX} ${from.y + offsetY}, ${bendX} ${to.y + offsetY}, ${to.x + 118} ${to.y + offsetY}`;
          }
          return <path key={edge.id} className={`graph-edge graph-edge--${edge.kind}${edge.active ? ' graph-edge--active' : ''}`}
            d={path}
            fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={edge.kind === 'parent' ? undefined : '6 4'}
            markerEnd={`url(#${markerId})`} aria-hidden="true" />;
        })}
        {model.nodes.map(node => {
          const order = (labelOrder.get(node.label) ?? 0) + 1;
          labelOrder.set(node.label, order);
          const label = labelCounts.get(node.label)! > 1 ? `${node.label} · 第 ${order} 项` : node.label;
          return <Fragment key={node.id}>
          <g role="button" tabIndex={0} data-entity-id={node.id} data-entity-kind={node.entity_kind}
            className={`graph-node graph-node--${node.entity_kind}${selectedId === node.id ? ' graph-node--selected' : ''}`}
            aria-label={`${node.entity_kind === 'task' ? '任务' : '过程'} · ${label} · ${graphStateLabels[node.state]}`}
            aria-pressed={selectedId === node.id} onClick={() => onSelect(node.id, node.entity_kind)}
            onKeyDown={event => activate(event, () => onSelect(node.id, node.entity_kind))} transform={`translate(${node.x}, ${node.y})`}>
            <title>{label} · {graphStateLabels[node.state]}</title>
            <rect x={-118} y={-30} width={236} height={60} rx={node.entity_kind === 'task' ? 12 : 24} />
            <svg x={-104} y={-24} width={196} height={25} viewBox="0 0 196 25" aria-hidden="true">
              <text x={0} y={18}>{node.label}</text>
            </svg>
            <text x={-104} y={20} className="graph-node-state">{graphStateLabels[node.state]}</text>
          </g>
          {node.entity_kind === 'task' && expandable.has(node.id) && <g role="button" tabIndex={0}
            className="graph-toggle" aria-label={`${collapsedIds.has(node.id) ? '展开' : '折叠'}任务 · ${label}`}
            aria-expanded={!collapsedIds.has(node.id)} transform={`translate(${node.x + 101}, ${node.y - 11})`}
            onClick={() => onToggle(node.id)} onKeyDown={event => activate(event, () => onToggle(node.id))}>
            <rect x={-13} y={-13} width={26} height={26} rx={6} />
            {collapsedIds.has(node.id)
              ? <ChevronRight x={-8} y={-8} size={16} strokeWidth={1.75} aria-hidden="true" />
              : <ChevronDown x={-8} y={-8} size={16} strokeWidth={1.75} aria-hidden="true" />}
          </g>}
        </Fragment>; })}
      </svg>
    </div>}
  </section>;
}
