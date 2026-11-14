import type { TracePageSchema } from '../../generated/contracts';

export interface TracePanelProps {
  events: TracePageSchema.TraceItem[];
  selectedId?: string;
  onSelect?: (id: string, kind: 'task' | 'activity') => void;
  nextCursor?: string | null;
  onLoadMore?: () => void;
  loading?: boolean;
}

export function TracePanel({ events, selectedId, onSelect, nextCursor, onLoadMore, loading = false }: TracePanelProps) {
  const visible = events.filter(event => selectedId === undefined || event.task_id === selectedId
    || event.activity_id === selectedId || event.activities.some(activity => activity.id === selectedId || activity.task_id === selectedId));
  return <section className="trace-panel" aria-label="公开事件" aria-busy={loading}>
    <h2>Trace</h2>
    {visible.length === 0 ? <p>暂无对应公开事件</p> : <ol className="trace-events">
      {visible.map(event => {
        const references = new Map<string, { id: string; kind: 'task' | 'activity' }>();
        if (event.task_id !== null) references.set(`task:${event.task_id}`, { id: event.task_id, kind: 'task' });
        if (event.activity_id !== null) references.set(`activity:${event.activity_id}`, { id: event.activity_id, kind: 'activity' });
        for (const activity of event.activities) {
          references.set(`task:${activity.task_id}`, { id: activity.task_id, kind: 'task' });
          references.set(`activity:${activity.id}`, { id: activity.id, kind: 'activity' });
        }
        return <li key={event.event_id}>
          <article className="trace-event">
            <header><code>{event.event_id}</code><strong>{event.kind}</strong>
              {event.seq !== null && <span>序号 {event.seq}</span>}</header>
            <p>公开过程 {event.activities.length} 项</p>
            {event.activities.length > 0 && <ul className="trace-activities">{event.activities.map(activity => <li key={activity.id}>
              {activity.kind} · {activity.operation} · {activity.state} · v{activity.version}
            </li>)}</ul>}
            <div className="trace-references">{[...references.values()].map(reference => onSelect
              ? <button type="button" key={`${reference.kind}:${reference.id}`}
                aria-label={`定位${reference.kind === 'task' ? '任务' : '过程'} ${reference.id}`}
                onClick={() => onSelect(reference.id, reference.kind)}>
                {reference.kind === 'task' ? '任务' : '过程'} <code>{reference.id}</code>
              </button>
              : <span key={`${reference.kind}:${reference.id}`}>{reference.kind === 'task' ? '任务' : '过程'} <code>{reference.id}</code></span>)}</div>
          </article>
        </li>;
      })}
    </ol>}
    {nextCursor != null && onLoadMore && <button type="button" disabled={loading} onClick={onLoadMore}>加载更多事件</button>}
  </section>;
}
