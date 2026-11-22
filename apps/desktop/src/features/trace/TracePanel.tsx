import { useEffect, useState } from 'react';
import type { TaskSnapshot, TracePageSchema } from '../../generated/contracts';
import { RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import ScriptActivity from '../tasks/ScriptActivity';
import McpIdentity from '../authorization/McpIdentity';
import Status from '../../components/Status';
import { Button } from '../../components/ui/button';
import { operationLabel } from '../tasks/operation-label';

const eventLabels: Record<string, string> = {
  'run.started': '运行开始', 'run.stepped': '运行进度', 'run.finished': '运行结束',
  'task.created': '任务建立', 'task.submitted': '任务提交', 'task.stepped': '任务进度',
  'task.consumed': '助理读取交付', 'task.completed': '任务完成', 'task.failed': '任务失败',
  'activity.prepared': '步骤准备', 'activity.dispatched': '步骤开始', 'activity.received': '步骤回执',
  'activity.finished': '步骤结束', 'delivery.changed': '交付状态变化',
};

export interface TracePanelProps {
  events: TracePageSchema.TraceItem[];
  selectedId?: string;
  onSelect?: (id: string, kind: 'task' | 'activity') => void;
  nextCursor?: string | null;
  onLoadMore?: () => void;
  loading?: boolean;
  onArtifact?: (id: string) => void;
  client?: RuntimeClient;
  taskSnapshots?: readonly TaskSnapshot[];
}

export function TracePanel({ events, selectedId, onSelect, nextCursor, onLoadMore, loading = false, onArtifact, client, taskSnapshots = [] }: TracePanelProps) {
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
  const knownTasks = new Map([...taskSnapshots, ...Object.values(tasks)].map(task => [task.id, task]));
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
            <header><strong>{eventLabels[event.kind] ?? event.kind}</strong>
              {event.seq !== null && <span>步骤 {event.seq}</span>}</header>
            {event.activities.length > 0 && <ul className="trace-activities">{event.activities.map(activity => <li key={activity.id}>
              <div className="task-step-heading">
                <strong>{activity.kind === 'model' ? '模型回复' : operationLabel(activity.operation, knownTasks.get(activity.task_id))}</strong>
                <Status state={activity.state} />
              </div>
              {activity.operation.startsWith('mcp.') && <section aria-label="MCP 调用">
                {tasks[activity.task_id]?.binding.config.catalog.mcp_tools[activity.operation]
                  ? <McpIdentity value={tasks[activity.task_id].binding.config.catalog.mcp_tools[activity.operation]} />
                  : <p>固定目录尚未读取，不能按当前配置解释此调用。</p>}
                {activity.state === 'uncertain' && <p>{activity.error === 'mcp_call_cancelled_uncertain'
                  ? '调用已发送，随后取消。外部执行状态仍需核对。'
                  : activity.error === 'mcp_call_uncertain' ? '调用已发送，未收到结果。原调用不会自动重复。'
                    : '结果未确认，外部执行状态仍需核对。'}</p>}
                <p>外部费用未知；本机工具记账不代表服务端免费。</p>
              </section>}
              <ScriptActivity activity={activity} onArtifact={onArtifact} />
            </li>)}</ul>}
            {onSelect && <div className="flex flex-wrap gap-2">{[...references.values()].map(reference => {
              const task = knownTasks.get(reference.id);
              const activity = event.activities.find(item => item.id === reference.id);
              const label = reference.kind === 'task' ? task?.binding.agent_work?.goal ?? task?.binding.config.agent_profile.display_name ?? '关联任务'
                : activity ? operationLabel(activity.operation, knownTasks.get(activity.task_id)) : '关联步骤';
              return <Button type="button" size="sm" className="whitespace-normal text-start wrap-anywhere" key={`${reference.kind}:${reference.id}`} onClick={() => onSelect(reference.id, reference.kind)}>
                定位{reference.kind === 'task' ? '任务' : '步骤'} · {label}
              </Button>;
            })}</div>}
          </article>
        </li>;
      })}
    </ol>}
    {nextCursor != null && onLoadMore && <Button type="button" size="sm" disabled={loading} onClick={onLoadMore}>加载更多事件</Button>}
  </section>;
}
