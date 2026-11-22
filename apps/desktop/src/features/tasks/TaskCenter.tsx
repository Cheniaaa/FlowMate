import { useEffect, useRef, useState } from 'react';
import type { RuntimeClient, TaskQuery } from '../../api/client';
import { windowError } from '../../api/windows';
import type { RunSnapshot, TaskCenterPage, Workspace } from '../../generated/contracts';
import Status from '../../components/Status';
import { Button } from '../../components/ui/button';
import { FieldLabel } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import './task-presentation.css';

const states: RunSnapshot['state'][] = ['queued', 'running', 'waiting_user', 'waiting_approval', 'waiting_children', 'interrupted', 'blocked_incompatible', 'completed', 'failed', 'cancelled'];
export const runKinds = { user: '本次对话', managed: '独立后台', follow_up: '后续运行', maintenance: '记忆整理', knowledge: '资料处理' };
const stateLabels: Partial<Record<RunSnapshot['state'], string>> = {
  queued: '排队中', running: '运行中', waiting_user: '等待回答', waiting_approval: '待审批', waiting_children: '等待子任务',
  interrupted: '已中断', blocked_incompatible: '版本不兼容', completed: '已完成', failed: '失败', cancelled: '已取消',
};
const deliveryLabels = { pending: '等待投递', delivered: '已送达', failed: '投递失败', invalidated: '来源已失效' };

export default function TaskCenter({ client, workspaceId, workspaces, sessionNames, onOpen, onOrganize }: {
  client: RuntimeClient; workspaceId: string; workspaces: Workspace[]; onOpen: (runId: string) => void;
  sessionNames?: Record<string, string>;
  onOrganize?: (source: RunSnapshot) => void;
}) {
  const [scope, setScope] = useState(workspaceId);
  const [state, setState] = useState<RunSnapshot['state'] | ''>('');
  const [kind, setKind] = useState<RunSnapshot['kind'] | ''>('');
  const [page, setPage] = useState<TaskCenterPage>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamStatus, setStreamStatus] = useState<'connected' | 'reconnecting'>('connected');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const filters: TaskQuery = { ...(scope ? { workspace_id: scope } : {}), ...(state ? { state } : {}), ...(kind ? { kind } : {}), limit: 50 };
  const filterKey = JSON.stringify(filters);
  const loadedFilter = useRef(filterKey);
  useEffect(() => {
    const current = ++generation.current;
    if (loadedFilter.current !== filterKey) { setPage(undefined); loadedFilter.current = filterKey; }
    setBusy(true); setError('');
    client.globalTasks(filters).then(value => { if (current === generation.current) setPage(value); })
      .catch(error => { if (current === generation.current) setError(windowError(error)); })
      .finally(() => { if (current === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [client, filterKey, revision]);
  // 全部范围不是单项目流：订阅已加载各项目；重新打开/手动刷新会重新读取全局列表。
  const projects = scope ? [scope] : [...new Set([...workspaces.map(item => item.id), ...(page?.items.map(item => item.run.workspace_id) ?? [])])];
  const projectKey = projects.join(',');
  const watermark = useRef('0');
  if (page) watermark.current = page.watermark;
  useEffect(() => {
    if (!page) return;
    const abort = new AbortController();
    for (const id of projects) void client.watchWorkspace(id, watermark.current, {
      snapshot: () => setRevision(value => value + 1),
      event: event => { if (event.kind === 'durable') setRevision(value => value + 1); },
      connection: setStreamStatus,
    }, abort.signal).catch(error => { if (!abort.signal.aborted) setError(windowError(error)); });
    return () => abort.abort();
  }, [client, projectKey, !!page]);
  async function more() {
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const next = await client.globalTasks({ ...filters, cursor: page!.next_cursor! });
      if (current === generation.current) setPage(previous => ({ ...next, items: [...new Map([...previous!.items, ...next.items].map(item => [item.run.id, item])).values()] }));
    } catch (error) { if (current === generation.current) setError(windowError(error)); }
    finally { if (current === generation.current) setBusy(false); }
  }
  return <section className="task-center" aria-label="任务中心">
    <header><h2 tabIndex={-1}>任务中心</h2><Button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新任务</Button></header>
    <div className="task-filters">
      <FieldLabel>任务范围
        <NativeSelect value={scope} onChange={event => setScope(event.target.value)}>
          <NativeSelectOption value="">全部项目</NativeSelectOption>
          {workspaceId && !workspaces.some(item => item.id === workspaceId) && <NativeSelectOption value={workspaceId}>当前项目</NativeSelectOption>}
          {workspaces.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
        </NativeSelect>
      </FieldLabel>
      <FieldLabel>任务状态
        <NativeSelect value={state} onChange={event => setState(event.target.value as typeof state)}>
          <NativeSelectOption value="">全部状态</NativeSelectOption>
          {states.map(value => <NativeSelectOption key={value} value={value}>{stateLabels[value]}</NativeSelectOption>)}
        </NativeSelect>
      </FieldLabel>
      <FieldLabel>任务类型
        <NativeSelect value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
          <NativeSelectOption value="">全部类型</NativeSelectOption>
          {Object.entries(runKinds).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
        </NativeSelect>
      </FieldLabel>
    </div>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">正在读取任务…</p>}
    {streamStatus === 'reconnecting' && <p role="status">事件流重连中；可刷新任务列表。</p>}
    {page?.items.length === 0 && <p className="empty-state">此范围没有任务。</p>}
    <div className="task-center-list">{page?.items.map(item => {
      const config = item.root.binding.config;
      const owner = config.kind === 'agent' ? config.agent_profile.display_name : undefined;
      const target = item.source_valid !== false
        && (item.task_title || item.task_goal?.trim() || item.root.binding.agent_work?.goal.trim() || item.run.output?.summary.trim());
      const sessionName = item.session_title ?? (item.run.interaction_session_id && sessionNames?.[item.run.interaction_session_id]);
      const workspace = workspaces.find(project => project.id === item.run.workspace_id);
      return <article key={item.run.id} className="task-center-row">
      <div><div className="task-step-heading"><h3 title={target && item.task_goal || undefined}>{target || (owner ? `${runKinds[item.run.kind]} · ${owner}` : runKinds[item.run.kind])}</h3><Status state={item.root.state} /></div>
        <div className="task-center-meta">
          {target && <span className="muted">{owner ? `负责人 ${owner}` : runKinds[item.run.kind]}</span>}
          {(workspace || sessionName) && <span className="muted">{[workspace?.name, sessionName].filter(Boolean).join(' / ')}</span>}
          {item.pending_count > 0 && <span>待处理 {item.pending_count}</span>}
          {item.delivery_state && <span>投递 {deliveryLabels[item.delivery_state]}</span>}
        </div>
      </div><div className="button-row"><Button type="button" onClick={() => onOpen(item.run.id)}>查看任务详情</Button>
        {onOrganize && (item.run.kind === 'user' || item.run.kind === 'managed') && <Button type="button" size="sm" variant="ghost" onClick={() => onOrganize(item.run)}>整理此运行的记忆</Button>}</div>
    </article>; })}</div>
    {page?.next_cursor && <Button type="button" disabled={busy} onClick={() => void more()}>更多任务</Button>}
  </section>;
}
