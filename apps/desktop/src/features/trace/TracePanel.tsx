import { useEffect, useState } from 'react';
import type { TaskSnapshot, TracePageSchema } from '../../generated/contracts';
import { RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import ScriptActivity from '../tasks/ScriptActivity';
import McpIdentity from '../authorization/McpIdentity';

export interface TracePanelProps {
  events: TracePageSchema.TraceItem[];
  selectedId?: string;
  onSelect?: (id: string, kind: 'task' | 'activity') => void;
  nextCursor?: string | null;
  onLoadMore?: () => void;
  loading?: boolean;
  onArtifact?: (id: string) => void;
  client?: RuntimeClient;
}

export function TracePanel({ events, selectedId, onSelect, nextCursor, onLoadMore, loading = false, onArtifact, client }: TracePanelProps) {
  const [tasks, setTasks] = useState<Record<string, TaskSnapshot>>({}), [error, setError] = useState('');
  const taskIds = [...new Set(events.flatMap(event => event.activities.filter(activity => activity.operation.startsWith('mcp.')).map(activity => activity.task_id)))].sort().join(',');
  useEffect(() => {
    if (!taskIds) return;
    let ignore = false; setTasks({}); setError('');
    async function read() {
      const runtime = client ?? await RuntimeClient.connect();
      const fixed = await Promise.all(taskIds.split(',').map(id => runtime.task(id)));
      if (!ignore) setTasks(Object.fromEntries(fixed.map(task => [task.id, task])));
    }
    void read().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, taskIds]);
  const visible = events.filter(event => selectedId === undefined || event.task_id === selectedId
    || event.activity_id === selectedId || event.activities.some(activity => activity.id === selectedId || activity.task_id === selectedId));
  return <section className="trace-panel" aria-label="公开事件" aria-busy={loading}>
    <h2>Trace</h2>
    {error && <p role="alert">固定 MCP 调用信息读取失败：{error}</p>}
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
              {activity.operation.startsWith('mcp.') && <section aria-label="MCP 调用">
                {tasks[activity.task_id]?.binding.config.catalog.mcp_tools[activity.operation]
                  ? <McpIdentity value={tasks[activity.task_id].binding.config.catalog.mcp_tools[activity.operation]} />
                  : <p>固定目录尚未读取，不能按当前配置解释此调用。</p>}
                {activity.state === 'uncertain' && <p>结果未确认，不自动重发；取消不代表外部副作用已撤销。</p>}
                <p>外部费用未知；本机工具记账不代表服务端免费。</p>
              </section>}
              <ScriptActivity activity={activity} onArtifact={onArtifact} />
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
