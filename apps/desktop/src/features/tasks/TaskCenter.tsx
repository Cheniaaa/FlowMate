import { useEffect, useRef, useState } from 'react';
import type { RuntimeClient, TaskQuery } from '../../api/client';
import { windowError } from '../../api/windows';
import type { RunSnapshot, TaskCenterPage, Workspace } from '../../generated/contracts';
import Status from '../../components/Status';

const states: RunSnapshot['state'][] = ['queued', 'running', 'waiting_user', 'waiting_approval', 'waiting_children', 'interrupted', 'blocked_incompatible', 'completed', 'failed', 'cancelled'];
const kinds = { user: '本次对话', managed: '独立后台', follow_up: '后续运行', maintenance: '记忆整理' };
export default function TaskCenter({ client, workspaceId, workspaces, onOpen, onOrganize }: {
  client: RuntimeClient; workspaceId: string; workspaces: Workspace[]; onOpen: (runId: string) => void;
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
    <header><h2>任务中心</h2><button disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新任务</button></header>
    <div className="task-filters">
      <label>任务范围 <select value={scope} onChange={event => setScope(event.target.value)}><option value="">全部项目</option>{workspaceId && !workspaces.some(item => item.id === workspaceId) && <option value={workspaceId}>定位项目 · {workspaceId.slice(0, 8)}</option>}{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>任务状态 <select value={state} onChange={event => setState(event.target.value as typeof state)}><option value="">全部状态</option>{states.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>任务类型 <select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="">全部类型</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">正在读取任务…</p>}
    {streamStatus === 'reconnecting' && <p role="status">事件流重连中；可刷新任务列表。</p>}
    {page?.items.length === 0 && <p className="empty-state">此范围没有任务。</p>}
    <div className="task-center-list">{page?.items.map(item => <article key={item.run.id} className="task-center-row">
      <div><h3>{kinds[item.run.kind]} · {item.run.id.slice(0, 8)}</h3><Status state={item.root.state} />
        <p>待处理 {item.pending_count}</p><p>投递：{item.delivery_state ?? '无通知'}</p>
        {item.origin_task_id && <p className="muted">来源 Task <code>{item.origin_task_id}</code> · 因果关联，不传播取消</p>}
      </div><div className="button-row"><button onClick={() => onOpen(item.run.id)}>查看任务详情</button>
        {onOrganize && (item.run.kind === 'user' || item.run.kind === 'managed') && <button onClick={() => onOrganize(item.run)}>整理此运行的记忆</button>}</div>
    </article>)}</div>
    {page?.next_cursor && <button disabled={busy} onClick={() => void more()}>更多任务</button>}
  </section>;
}
