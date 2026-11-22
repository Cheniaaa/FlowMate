import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '../../components/ui/button';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { ArtifactRef, MemberLaneList, RunDetail } from '../../generated/contracts';
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
import RunFeedbackNotice from './RunFeedbackNotice';
import SelectedStep from './SelectedStep';
import { describeArtifacts } from '../artifacts/artifact-presentation';
import { runKinds } from './TaskCenter';
import './task-presentation.css';

interface TaskDetailProps {
  client: RuntimeClient; store: RuntimeStore; runId: string;
  onCommand: (command: UiCommand, key: DraftKey) => Promise<CommandOutcome>;
  onQuestion: (runId: string, itemId: string, trigger: HTMLButtonElement) => void;
  onOpen: (runId: string) => void;
  onExport?: (artifact: ArtifactRef) => Promise<void>; exportBlocked?: boolean;
  onOpenConnection?: (id: string) => void;
  onOpenEvidence?: (workspaceId: string, evidenceId: string) => void;
}

export default function TaskDetail(props: TaskDetailProps) {
  const [identity, setIdentity] = useState({ client: props.client, runId: props.runId, key: 0 });
  if (identity.client !== props.client || identity.runId !== props.runId) {
    // 身份变化在提交子树前重置；同身份的权威刷新不卸载结果/用户选择。
    setIdentity({ client: props.client, runId: props.runId, key: identity.key + 1 });
  }
  return <TaskDetailView key={identity.key} {...props} />;
}

function TaskDetailView({ client, store, runId, onCommand, onQuestion, onOpen, onExport, exportBlocked, onOpenConnection, onOpenEvidence }: TaskDetailProps) {
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
  const [resultArtifact, setResultArtifact] = useState<{ artifact: ArtifactRef; sourceWatermark: string }>();
  const [busy, setBusy] = useState(false);
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  type PageKind = 'tasks' | 'activities' | 'artifacts' | 'waits' | 'consumptions' | 'joins';
  const pageDepths = useRef<Partial<Record<PageKind, number>>>({});
  const detailPage = useRef<RunDetail | undefined>(undefined);
  const detailRead = useRef<Promise<void> | undefined>(undefined);
  const detailActive = useRef(true);
  const detailMorePending = useRef(false);
  useEffect(() => {
    detailActive.current = true;
    return () => { detailActive.current = false; };
  }, []);
  function readDetail(kind?: PageKind): Promise<void> {
    async function read() {
      if (!detailActive.current) return;
      let value: RunDetail;
      if (kind) {
        const previous = detailPage.current!;
        const cursor = previous[kind].next_cursor;
        if (!cursor) return;
        const page = await client[kind](runId, { cursor, limit: 50 });
        if (!detailActive.current) return;
        value = { ...previous, [kind]: { ...page,
          watermark: BigInt(previous[kind].watermark) < BigInt(page.watermark) ? previous[kind].watermark : page.watermark,
          items: [...new Map([...previous[kind].items, ...page.items].map(item => [item.id, item])).values()] } };
        pageDepths.current[kind] = (pageDepths.current[kind] ?? 0) + 1;
      } else {
        value = await client.run(runId);
        if (!detailActive.current) return;
        // RunDetail 会替换各集合首页，须等此前续页安装后再确定各自阅读深度。
        for (const name of Object.keys(pageDepths.current) as PageKind[]) {
          let count = 0;
          while (count < pageDepths.current[name]! && value[name].next_cursor) {
            const page = await client[name](runId, { cursor: value[name].next_cursor!, limit: 50 });
            if (!detailActive.current) return;
            Object.assign(value[name], { ...page,
              watermark: BigInt(value[name].watermark) < BigInt(page.watermark) ? value[name].watermark : page.watermark,
              items: [...new Map([...value[name].items, ...page.items].map(item => [item.id, item])).values()] });
            count++;
          }
          pageDepths.current[name] = count;
        }
      }
      detailPage.current = value;
      setDetail(value);
      setError('');
    }
    // 同一快照的刷新与续页按序安装；每个集合仍只使用自己的游标和深度。
    const previous = detailRead.current;
    const operation = previous ? previous.then(read, read) : read();
    detailRead.current = operation;
    const clear = () => { if (detailRead.current === operation) detailRead.current = undefined; };
    void operation.then(clear, clear);
    return operation;
  }
  const traceDepth = useRef(0);
  const tracePage = useRef<typeof trace>(undefined);
  const traceRead = useRef<Promise<void> | undefined>(undefined);
  const traceActive = useRef(true);
  useEffect(() => {
    traceActive.current = true;
    return () => { traceActive.current = false; };
  }, []);
  function readTrace(more = false): Promise<void> {
    async function read() {
      if (!traceActive.current) return;
      let pages: NonNullable<typeof trace>[];
      if (more) {
        // 刷新可能已更换分页上界，轮到续页时才取当前末页游标。
        const previous = tracePage.current;
        if (!previous?.next_cursor) return;
        const next = await client.trace(runId, { cursor: previous.next_cursor, limit: 50 });
        if (!traceActive.current) return;
        pages = [previous, next];
        traceDepth.current++;
      } else {
        // 前一续页完成后再确定深度，沿新首页串行恢复阅读位置。
        const depth = traceDepth.current;
        pages = [await client.trace(runId, { limit: 50 })];
        if (!traceActive.current) return;
        while (pages.length <= depth && pages.at(-1)!.next_cursor) {
          pages.push(await client.trace(runId, { cursor: pages.at(-1)!.next_cursor!, limit: 50 }));
          if (!traceActive.current) return;
        }
        traceDepth.current = pages.length - 1;
      }
      // 末页提供续读游标，累计水位只到最早读取的那一页。
      const value = { ...pages.at(-1)!, items: [...new Map(pages.flatMap(page => page.items).map(item => [item.event_id, item])).values()],
        watermark: pages.reduce((mark, page) => BigInt(page.watermark) < BigInt(mark) ? page.watermark : mark, pages[0].watermark) };
      tracePage.current = value;
      setTrace(value);
    }
    const previous = traceRead.current;
    const operation = previous ? previous.then(read, read) : read();
    traceRead.current = operation;
    const clear = () => { if (traceRead.current === operation) traceRead.current = undefined; };
    void operation.then(clear, clear);
    return operation;
  }
  useEffect(() => {
    readDetail().catch(error => { if (detailActive.current) setError(windowError(error)); });
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
    readTrace().catch(error => { if (traceActive.current) setError(windowError(error)); });
  }, [client, runId, tab, revision]);
  useEffect(() => {
    if (tab !== 'members') return;
    let ignore = false;
    client.memberLanes(runId).then(value => { if (!ignore) setLanes({ items: value, sourceWatermark }); }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, runId, tab, revision, sourceWatermark]);
  async function more(kind: PageKind) {
    if (detailMorePending.current) return;
    detailMorePending.current = true;
    setBusy(true);
    try { await readDetail(kind); }
    catch (error) { if (detailActive.current) setError(windowError(error)); }
    finally { detailMorePending.current = false; if (detailActive.current) setBusy(false); }
  }
  if (!detail) return <section aria-label="任务详情">{error ? <p role="alert">{error}</p> : <p>正在读取任务详情…</p>}<Button type="button" onClick={() => setRevision(value => value + 1)}>重新读取详情</Button></section>;
  const run = detail.run;
  const config = run.config;
  const sourcesCurrent = detail.source_valid !== false && BigInt(detail.watermark) >= BigInt(sourceWatermark);
  const fixedActivities = sourcesCurrent ? [...detail.activities.items, ...(trace && BigInt(trace.watermark) >= BigInt(sourceWatermark)
    ? trace.items.flatMap(item => item.activities) : [])] : [];
  const scriptArtifacts = fixedActivities
    .flatMap(activity => activity.script_execution?.outputs.map(entry => entry.artifact) ?? []);
  const artifactOptions = sourcesCurrent ? describeArtifacts(detail.artifacts.items, fixedActivities) : [];
  const selectedArtifact = artifactOptions.find(({ artifact }) => artifact.id === artifactId)
    ?? describeArtifacts(scriptArtifacts, fixedActivities).find(({ artifact }) => artifact.id === artifactId)
    ?? (sourcesCurrent && resultArtifact && resultArtifact.artifact.id === artifactId && resultArtifact.sourceWatermark === sourceWatermark
      ? describeArtifacts([resultArtifact.artifact], fixedActivities)[0] : undefined);
  const goal = detail.task_goal ?? detail.tasks.items.find(task => task.id === run.root_task_id)?.binding.agent_work?.goal;
  const pendingQuestion = detail.questions.items.find(question => question.status === 'pending');
  const pendingApproval = detail.approvals.items.find(approval => approval.status === 'pending');
  return <section className="task-detail" aria-label="任务详情">
    <header><h2>任务详情</h2><Status state={run.state} /><Button type="button" onClick={() => setRevision(value => value + 1)}>刷新详情</Button></header>
    {error && <p role="alert">{error}</p>}
    <RunFeedbackNotice run={run} feedback={store.getSnapshot().runFeedback[run.id]} onOpenConnection={onOpenConnection} />
    <div className="task-step-heading"><h3>{(sourcesCurrent && (detail.task_title || goal || run.output?.summary)) || runKinds[run.kind]}</h3></div>
    {sourcesCurrent && detail.task_title && goal && detail.task_title !== goal && <details>
      <summary>完整任务目标</summary><p className="whitespace-pre-wrap">{goal}</p>
    </details>}
    {config.kind === 'agent' && <p className="muted">负责人 {config.agent_profile.display_name}</p>}
    {!terminal(run.state) && <Button type="button" disabled={busy || commands.some(command => command.status === 'unconfirmed' && command.targetId === runId)}
      onClick={() => { setBusy(true); onCommand({ type: 'cancel', args: [run.id, commandMeta(run.version)] }, { workspaceId: run.workspace_id, sessionId: run.interaction_session_id ?? '' }).then(() => setRevision(value => value + 1)).catch(error => setError(windowError(error))).finally(() => setBusy(false)); }}>{run.kind === 'knowledge' ? '停止资料处理' : run.kind === 'maintenance' ? '停止记忆整理' : run.kind === 'managed' ? '停止该后台' : '停止本次对话'}</Button>}
    {pendingQuestion && <Button type="button" onClick={event => onQuestion(runId, pendingQuestion.id, event.currentTarget)}>回答任务问题并返回草稿</Button>}
    {pendingApproval && <Button type="button" onClick={event => onQuestion(runId, pendingApproval.id, event.currentTarget)}>处理任务审批并返回草稿</Button>}
    <details><summary>范围与固定配置</summary>{config.kind === 'agent' ? <><p>模型：{config.model_profile.model_id}</p><p>后台执行：{run.allow_managed ? '已允许' : '未允许'}</p></> : <p>资料处理</p>}
      <p>已选资料 {run.sources.resource_ids.length} 项 · Skill {Object.keys(run.sources.skill_versions).length} 项</p></details>
    {config.kind === 'agent' || detail.budget.model_requests > 0 || detail.cost_summary.calculated_units !== '0'
      || detail.cost_summary.unknown_request_count > 0 || detail.cost_summary.pending_request_count > 0
      ? <section aria-label="运行预算"><h3>预算与费用</h3><RunCostSummary summary={detail.cost_summary} disclosureName={`task-${runId}`} /><p>步骤 {detail.budget.steps} / {detail.budget.limits.max_steps} · 请求 {detail.budget.model_requests} / {detail.budget.limits.max_model_requests}</p>
      <details><summary>预算详情</summary><p>累计 Token {detail.budget.total_tokens} / {detail.budget.limits.max_total_tokens ?? '未设上限'}</p>
        <p>已用预算单位 {detail.budget.spent_units} / {detail.budget.limits.max_cost_units ?? '未设上限'}</p></details></section>
      : <section aria-label="执行用量"><h3>执行用量</h3><p>步骤 {detail.budget.steps} / {detail.budget.limits.max_steps}</p></section>}
    <div className="button-row">
      <Button type="button" size="sm" variant={tab === 'graph' ? 'secondary' : 'ghost'} aria-pressed={tab === 'graph'} onClick={() => setTab('graph')}>任务图</Button>
      <Button type="button" size="sm" variant={tab === 'list' ? 'secondary' : 'ghost'} aria-pressed={tab === 'list'} onClick={() => setTab('list')}>任务列表</Button>
      {config.kind === 'agent' && <Button type="button" size="sm" variant={tab === 'members' ? 'secondary' : 'ghost'} aria-pressed={tab === 'members'} onClick={() => setTab('members')}>成员泳道</Button>}
      <Button type="button" size="sm" variant={tab === 'trace' ? 'secondary' : 'ghost'} aria-pressed={tab === 'trace'} onClick={() => setTab('trace')}>原始 Trace</Button>
    </div>
    {tab === 'members' && (lanes?.sourceWatermark === sourceWatermark ? <MemberLanes lanes={lanes.items} onSelect={setSelected} onOpen={onOpen} /> : <p>正在读取真实成员…</p>)}
    {tab === 'members' && sourcesCurrent && lanes?.sourceWatermark === sourceWatermark && lanes.items.filter(lane => lane.task.id === selected && lane.task.binding.agent_work && lane.task.result_version !== null).map(lane =>
      <MemberResult key={`${lane.task.id}:${lane.task.result_version}:${sourceWatermark}`} client={client} lane={lane} onExport={onExport} exportBlocked={exportBlocked}
        onOpenEvidence={onOpenEvidence && (id => onOpenEvidence(run.workspace_id, id))} />)}
    {tab === 'graph' && <TaskGraph tasks={detail.tasks.items} activities={detail.activities.items} waits={detail.waits.items} consumptions={detail.consumptions.items} joins={detail.joins.items} collapsedIds={collapsed} selectedId={selected} onSelect={setSelected} onToggle={id => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />}
    {tab === 'list' && <TaskList tasks={detail.tasks.items} activities={detail.activities.items} selectedId={selected} onSelect={setSelected} />}
    {sourcesCurrent && tab !== 'trace' && detail.activities.items.filter(activity => activity.operation === 'skills.run_script'
      && (!selected || activity.task_id === selected)).map(activity =>
      <ScriptActivity key={activity.id} activity={activity} onArtifact={setArtifactId} />)}
    {tab === 'trace' && <TracePanel client={client} events={trace && sourcesCurrent && BigInt(trace.watermark) >= BigInt(sourceWatermark) ? trace.items : []}
      taskSnapshots={sourcesCurrent ? detail.tasks.items : []} selectedId={selected} onSelect={setSelected} onArtifact={sourcesCurrent ? setArtifactId : undefined} nextCursor={trace?.next_cursor} loading={busy} onLoadMore={() => {
      setBusy(true);
      readTrace(true).catch(error => { if (traceActive.current) setError(windowError(error)); })
        .finally(() => { if (traceActive.current) setBusy(false); });
    }} />}
    {sourcesCurrent && selected && tab !== 'trace' && <SelectedStep id={selected} tasks={detail.tasks.items} activities={detail.activities.items}
      fileNames={detail.file_names} taskTitles={detail.task_titles} onArtifact={setArtifactId} />}
    {(['tasks', 'activities', 'artifacts', 'waits', 'consumptions', 'joins'] as const).filter(kind => detail[kind].next_cursor).map(kind => <Button type="button" key={kind} disabled={busy} onClick={() => void more(kind)}>更多 {kind}</Button>)}
    <section aria-label="任务产物"><h3>任务产物</h3>
      {sourcesCurrent && artifactOptions.length === 0 && <p className="muted">暂无产物</p>}
      {artifactOptions.map(({ artifact, label }) => <Button type="button" key={artifact.id} aria-pressed={artifact.id === artifactId}
        onClick={() => setArtifactId(artifact.id)}>查看{label}</Button>)}
      <ArtifactPanel key={sourceWatermark} artifact={selectedArtifact?.artifact ?? null} label={selectedArtifact?.label}
        client={client} onExport={onExport} exportBlocked={exportBlocked} /></section>
    {run.interaction_session_id && <ResultInbox client={client} store={store} sessionId={run.interaction_session_id} runId={run.id} sourceWatermark={sourceWatermark}
      onCommand={command => onCommand(command, { workspaceId: run.workspace_id, sessionId: run.interaction_session_id! })} onOpen={onOpen}
      onOpenEvidence={onOpenEvidence && (id => onOpenEvidence(run.workspace_id, id))}
      onArtifact={artifact => { setResultArtifact({ artifact, sourceWatermark }); setArtifactId(artifact.id); }} activities={fixedActivities} />}
  </section>;
}
