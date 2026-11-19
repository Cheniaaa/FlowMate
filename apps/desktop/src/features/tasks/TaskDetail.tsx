import { useEffect, useState, useSyncExternalStore } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { MemberLaneList, RunDetail } from '../../generated/contracts';
import type { CommandOutcome, RuntimeStore, UiCommand } from '../../state/runtime-store';
import type { DraftKey } from '../../state/draft-store';
import { laterCursor, reduceStream, terminal } from '../../api/events';
import Status from '../../components/Status';
import ArtifactPanel from '../artifacts/ArtifactPanel';
import RunCostSummary from '../chat/RunCostSummary';
import { TaskGraph } from './TaskGraph';
import { TaskList } from './TaskList';
import { TracePanel } from '../trace/TracePanel';
import ResultInbox from '../notifications/ResultInbox';
import MemberLanes from './MemberLanes';
import MemberResult from './MemberResult';
import ScriptActivity from './ScriptActivity';

interface TaskDetailProps {
  client: RuntimeClient; store: RuntimeStore; runId: string;
  onCommand: (command: UiCommand, key: DraftKey) => Promise<CommandOutcome>; onQuestion: (runId: string) => void;
  onOpen: (runId: string) => void;
}

export default function TaskDetail(props: TaskDetailProps) {
  const [identity, setIdentity] = useState({ client: props.client, runId: props.runId, key: 0 });
  if (identity.client !== props.client || identity.runId !== props.runId) {
    // 身份变化在提交子树前重置；同身份的权威刷新不卸载结果/用户选择。
    setIdentity({ client: props.client, runId: props.runId, key: identity.key + 1 });
  }
  return <TaskDetailView key={identity.key} {...props} />;
}

function TaskDetailView({ client, store, runId, onCommand, onQuestion, onOpen }: TaskDetailProps) {
  const [detail, setDetail] = useState<RunDetail>();
  const [sourceWatermark, setSourceWatermark] = useState('0');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<'graph' | 'list' | 'trace' | 'members'>('graph');
  const [lanes, setLanes] = useState<{ items: MemberLaneList; sourceWatermark: string }>();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [trace, setTrace] = useState<Awaited<ReturnType<RuntimeClient['trace']>>>();
  const [selected, setSelected] = useState<string>();
  const [artifactId, setArtifactId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  useEffect(() => {
    let ignore = false;
    client.run(runId).then(value => {
      if (!ignore) {
        setDetail(previous => previous && BigInt(previous.watermark) > BigInt(value.watermark) ? previous : value);
        setError('');
      }
    }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, runId, revision]);
  useEffect(() => {
    if (!detail) return;
    const abort = new AbortController();
    void client.watchWorkspace(detail.run.workspace_id, detail.watermark, {
      snapshot: snapshot => {
        // 重连快照可能跨过来源失效事件；保留子树不等于保留旧正文授权。
        setSourceWatermark(previous => laterCursor(previous, snapshot.watermark));
        setRevision(value => value + 1);
      },
      event: event => {
        if (event.kind !== 'durable') return;
        const sourceChanged = event.event.kind.startsWith('scope.') || event.event.kind === 'grant.revoked'
          || event.event.kind === 'delivery.changed' && event.event.payload.deliveries.some(entry => entry.result.run_id === runId && !entry.source_valid);
        if (sourceChanged) setSourceWatermark(previous => laterCursor(previous, event.event_id));
        if (event.event.run_id === runId || sourceChanged) {
          store.update(state => reduceStream(state, event));
          setRevision(value => value + 1);
        }
      },
    }, abort.signal).catch(error => { if (!abort.signal.aborted) setError(windowError(error)); });
    return () => abort.abort();
  }, [client, store, runId, !!detail]);
  useEffect(() => {
    if (tab !== 'trace') return;
    let ignore = false; setTrace(undefined);
    client.trace(runId, { limit: 50 }).then(value => { if (!ignore) setTrace(value); }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, runId, tab, revision]);
  useEffect(() => {
    if (tab !== 'members') return;
    let ignore = false;
    client.memberLanes(runId).then(value => { if (!ignore) setLanes({ items: value, sourceWatermark }); }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, runId, tab, revision, sourceWatermark]);
  async function more(kind: 'tasks' | 'activities' | 'artifacts' | 'waits' | 'consumptions' | 'joins') {
    setBusy(true);
    try {
      const page = await client[kind](runId, { cursor: detail![kind].next_cursor!, limit: 50 });
      setDetail(previous => previous?.run.id === runId && BigInt(page.watermark) >= BigInt(previous.watermark) ? { ...previous, [kind]: { ...page,
        items: [...new Map([...previous[kind].items, ...page.items].map(item => [item.id, item])).values()] } } : previous);
    } catch (error) { setError(windowError(error)); } finally { setBusy(false); }
  }
  if (!detail) return <section aria-label="任务详情">{error ? <p role="alert">{error}</p> : <p>正在读取任务详情…</p>}<button onClick={() => setRevision(value => value + 1)}>重新读取详情</button></section>;
  const run = detail.run;
  const sourcesCurrent = BigInt(detail.watermark) >= BigInt(sourceWatermark);
  const scriptArtifacts = [...detail.activities.items, ...(trace && BigInt(trace.watermark) >= BigInt(sourceWatermark)
    ? trace.items.flatMap(item => item.activities) : [])]
    .flatMap(activity => activity.script_execution?.outputs.map(entry => entry.artifact) ?? []);
  return <section className="task-detail" aria-label="任务详情">
    <header><h2>任务详情</h2><Status state={run.state} /><button onClick={() => setRevision(value => value + 1)}>刷新详情</button></header>
    {error && <p role="alert">{error}</p>}
    <p>{run.kind === 'maintenance' ? '记忆整理；独立维护运行，不占用实时对话。' : run.kind === 'managed' ? '独立后台；停止本次对话不会停止它。' : '会话运行'}</p><code>{run.id}</code>
    {run.reason && <p>{run.reason}</p>}
    {!terminal(run.state) && <button disabled={busy || commands.some(command => command.status === 'unconfirmed' && command.targetId === runId)}
      onClick={() => { setBusy(true); onCommand({ type: 'cancel', args: [run.id, commandMeta(run.version)] }, { workspaceId: run.workspace_id, sessionId: run.interaction_session_id ?? '' }).then(() => setRevision(value => value + 1)).catch(error => setError(windowError(error))).finally(() => setBusy(false)); }}>{run.kind === 'maintenance' ? '停止记忆整理' : run.kind === 'managed' ? '停止该后台' : '停止本次对话'}</button>}
    {detail.questions.items.some(question => question.status === 'pending') && <button onClick={() => onQuestion(runId)}>回答任务问题并返回草稿</button>}
    {detail.approvals.items.some(approval => approval.status === 'pending') && <button onClick={() => onQuestion(runId)}>处理任务审批并返回草稿</button>}
    <details><summary>范围与固定配置</summary><p>模型：{run.config.model_profile.model_id}</p><p>本链后台授权：{run.allow_managed ? '已允许' : '未允许'}</p><pre>{JSON.stringify(run.sources, null, 2)}</pre></details>
    <section aria-label="运行预算"><h3>预算与费用</h3><RunCostSummary summary={detail.cost_summary} disclosureName={`task-${runId}`} /><p>步骤 {detail.budget.steps} / {detail.budget.limits.max_steps} · 请求 {detail.budget.model_requests} / {detail.budget.limits.max_model_requests}</p>
      <p className="muted">共享预算组 <code>{run.budget_group_id}</code>；此处仅展示本 Run 消费，不与组总额重复相加。</p></section>
    <div className="button-row"><button aria-pressed={tab === 'graph'} onClick={() => setTab('graph')}>任务图</button><button aria-pressed={tab === 'list'} onClick={() => setTab('list')}>任务列表</button><button aria-pressed={tab === 'members'} onClick={() => setTab('members')}>成员泳道</button><button aria-pressed={tab === 'trace'} onClick={() => setTab('trace')}>原始 Trace</button></div>
    {tab === 'members' && (lanes?.sourceWatermark === sourceWatermark ? <MemberLanes lanes={lanes.items} onSelect={setSelected} onOpen={onOpen} /> : <p>正在读取真实成员…</p>)}
    {tab === 'members' && sourcesCurrent && lanes?.sourceWatermark === sourceWatermark && lanes.items.filter(lane => lane.task.id === selected && lane.task.binding.agent_work && lane.task.result_version !== null).map(lane =>
      <MemberResult key={`${lane.task.id}:${lane.task.result_version}:${sourceWatermark}`} client={client} lane={lane} />)}
    {tab === 'graph' && <TaskGraph tasks={detail.tasks.items} activities={detail.activities.items} waits={detail.waits.items} consumptions={detail.consumptions.items} joins={detail.joins.items} collapsedIds={collapsed} selectedId={selected} onSelect={setSelected} onToggle={id => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />}
    {tab === 'list' && <TaskList tasks={detail.tasks.items} activities={detail.activities.items} selectedId={selected} onSelect={setSelected} />}
    {sourcesCurrent && tab !== 'trace' && detail.activities.items.filter(activity => activity.operation === 'skills.run_script'
      && (!selected || activity.id === selected || activity.task_id === selected)).map(activity =>
      <ScriptActivity key={activity.id} activity={activity} onArtifact={setArtifactId} />)}
    {tab === 'trace' && <TracePanel client={client} events={trace && BigInt(trace.watermark) >= BigInt(sourceWatermark) ? trace.items : []} selectedId={selected} onSelect={setSelected} onArtifact={sourcesCurrent ? setArtifactId : undefined} nextCursor={trace?.next_cursor} loading={busy} onLoadMore={() => {
      setBusy(true); client.trace(runId, { cursor: trace!.next_cursor!, limit: 50 }).then(next => setTrace(previous => ({ ...next, items: [...new Map([...previous!.items, ...next.items].map(item => [item.event_id, item])).values()] }))).catch(error => setError(windowError(error))).finally(() => setBusy(false));
    }} />}
    {selected && <pre>{JSON.stringify([...detail.tasks.items, ...detail.activities.items].find(item => item.id === selected), null, 2)}</pre>}
    {(['tasks', 'activities', 'artifacts', 'waits', 'consumptions', 'joins'] as const).filter(kind => detail[kind].next_cursor).map(kind => <button key={kind} disabled={busy} onClick={() => void more(kind)}>更多 {kind}</button>)}
    <section><h3>产物</h3>{detail.artifacts.items.map(artifact => <button key={artifact.id} disabled={!sourcesCurrent} onClick={() => setArtifactId(artifact.id)}>查看产物 {artifact.id.slice(0, 8)}</button>)}
      <ArtifactPanel key={sourceWatermark} artifact={sourcesCurrent
        ? detail.artifacts.items.find(item => item.id === artifactId) ?? scriptArtifacts.find(item => item.id === artifactId) ?? null
        : null} client={client} /></section>
    {run.interaction_session_id && <ResultInbox client={client} store={store} sessionId={run.interaction_session_id} runId={run.id} sourceWatermark={sourceWatermark}
      onCommand={command => onCommand(command, { workspaceId: run.workspace_id, sessionId: run.interaction_session_id! })} onOpen={onOpen} />}
  </section>;
}
