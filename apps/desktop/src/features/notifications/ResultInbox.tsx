import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { ActivityPage, ActivityView, ArtifactRef, SessionInboxEntry, TaskResult } from '../../generated/contracts';
import type { CommandOutcome, RuntimeStore, UiCommand } from '../../state/runtime-store';
import { AgentResult as isAgentResult } from '../../generated/validators.js';
import AgentResultView from '../tasks/AgentResultView';
import type { Projection } from '../../api/events';
import { describeArtifacts } from '../artifacts/artifact-presentation';
import IconButton from '../../components/IconButton';
import { Button } from '../../components/ui/button';

function dependenciesAvailable(dependencies: ArtifactRef['dependencies'], state: Projection) {
  return dependencies.every(dependency =>
      [state.scopes[dependency.scope_id], state.grants[dependency.scope_id]].every(scope =>
        !scope || scope.epoch <= dependency.epoch && scope.status === 'active')
      && !(state.resources[dependency.scope_id]?.version > dependency.epoch));
}

function sourceAvailable(entry: SessionInboxEntry, state: Projection, result?: TaskResult): boolean {
  return entry.source_valid && entry.delivery_state !== 'invalidated' && !state.deletedSessions[entry.target_session_id]
    && dependenciesAvailable([...entry.dependencies, ...(result?.dependencies ?? [])], state);
}

type ActivityRead = { page: ActivityPage } | { issue: '产物名称不可用' | '产物名称读取失败' };
type ResolvedActivity = { activity: ActivityView; page?: ActivityPage } | Extract<ActivityRead, { issue: string }>;

const labels = { pending: '等待投递', delivered: '已送达', failed: '投递失败', invalidated: '来源已失效' };

interface ResultInboxProps {
  client: RuntimeClient; store: RuntimeStore; sessionId: string; runId?: string;
  sourceWatermark?: string;
  deliveryIds?: readonly string[];
  onCommand: (command: UiCommand) => Promise<CommandOutcome>; onOpen: (runId: string) => void;
  onSummarize?: (entry: SessionInboxEntry) => void; summaryBlocked?: boolean;
  onArtifact?: (artifact: ArtifactRef, entry: SessionInboxEntry, activityPage?: ActivityPage) => void;
  onMessage?: (deliveryId: string) => void;
  messageDeliveryIds?: ReadonlySet<string>;
  activities?: readonly ActivityView[];
}

export default function ResultInbox(props: ResultInboxProps) {
  const selection = props.deliveryIds?.join(',');
  const [identity, setIdentity] = useState({ client: props.client, store: props.store, sessionId: props.sessionId, runId: props.runId, selection, key: 0 });
  if (identity.client !== props.client || identity.store !== props.store || identity.sessionId !== props.sessionId || identity.runId !== props.runId || identity.selection !== selection) {
    setIdentity({ client: props.client, store: props.store, sessionId: props.sessionId, runId: props.runId, selection, key: identity.key + 1 });
  }
  return <ResultInboxView key={identity.key} {...props} />;
}

function ResultInboxView({ client, store, sessionId, runId, deliveryIds, sourceWatermark = '0', onCommand, onOpen, onSummarize,
  summaryBlocked = false, onArtifact, onMessage, messageDeliveryIds, activities = [] }: ResultInboxProps) {
  const headingId = useId();
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const automatic = useRef(false);
  const currentSourceWatermark = useRef(sourceWatermark);
  currentSourceWatermark.current = sourceWatermark;
  const [preview, setPreview] = useState<{ id: string; resultVersion: number; sourceWatermark: string; result: TaskResult; activities: readonly ActivityView[] }>();
  const [activityReads, setActivityReads] = useState<{ owner: NonNullable<typeof preview>; reads: Map<string, ActivityRead> }>();
  const showsArtifacts = !!onArtifact;
  const previewEntry = preview && projection.deliveries[preview.id];
  useEffect(() => {
    if (preview && (!previewEntry || !sourceAvailable(previewEntry, projection, preview.result)
      || previewEntry.result_version !== preview.resultVersion || preview.sourceWatermark !== sourceWatermark || projection.deletedSessions[sessionId])) setPreview(undefined);
  }, [preview, previewEntry, sourceWatermark, projection.scopes, projection.grants, projection.resources, projection.deletedSessions, sessionId]);
  useEffect(() => {
    if (!preview || !showsArtifacts || preview.result.artifacts.length === 0) return;
    const { result, activities } = preview;
    const missing = new Set(result.artifacts.filter(artifact => !activities.some(activity =>
      activity.id === artifact.activity_id && activity.task_id === artifact.task_id)).map(artifact => artifact.activity_id));
    let ignore = false;
    void Promise.all([...missing].map(async (id): Promise<[string, ActivityRead]> => {
      try {
        return [id, { page: await client.activities(result.handle.run_id, { activity_id: id }) }];
      } catch (error) {
        const unavailable = error instanceof ApiError && (['scope_revoked', 'outside_run_scope', 'not_found'].includes(error.code)
          || error.status === 401 || error.status === 403);
        return [id, { issue: unavailable ? '产物名称不可用' : '产物名称读取失败' }];
      }
    })).then(reads => { if (!ignore) setActivityReads({ owner: preview, reads: new Map(reads) }); });
    return () => { ignore = true; };
  }, [client, preview, showsArtifacts]);
  async function refresh(current: () => boolean = () => true) {
    await store.refreshResults(sessionId);
    if (deliveryIds) {
      let page = store.getSnapshot().resultPages[sessionId];
      while (current() && page?.next_cursor && deliveryIds.some(id => !page.ids.includes(id))) {
        const cursor = page.next_cursor;
        await store.refreshResults(sessionId, cursor);
        page = store.getSnapshot().resultPages[sessionId];
        if (page?.next_cursor === cursor) break;
      }
    }
    if (current()) setReady(true);
  }
  useEffect(() => {
    let ignore = false; setError('');
    void refresh(() => !ignore).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [store, sessionId, projection.snapshotWatermark, sourceWatermark]);
  const ids = projection.resultPages[sessionId]?.ids ?? [];
  const entries = ready ? ids.map(id => projection.deliveries[id])
    .filter(entry => entry?.target_session_id === sessionId && (!runId || entry.result.run_id === runId)) : [];
  const visible = deliveryIds ? deliveryIds.flatMap(id => entries.filter(entry => entry.id === id)) : entries;
  const single = deliveryIds?.length === 1 ? visible[0] : undefined;
  async function act(action: () => Promise<unknown>) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(windowError(error)); }
    finally { acting.current = false; setBusy(false); }
  }
  async function view(entry: SessionInboxEntry) {
    setPreview(undefined);
    const before = store.getSnapshot();
    const target = before.deliveries[entry.id];
    if (!target || target.target_session_id !== sessionId || target.result_version !== entry.result_version) return;
    if (!target.viewed_at) {
      const outcome = await onCommand({ type: 'viewResult', args: [target.id, commandMeta(target.version)] });
      if (outcome.status !== 'confirmed') return;
    }
    const acceptedState = store.getSnapshot();
    const accepted = acceptedState.deliveries[target.id];
    if (!accepted || accepted.result_version !== entry.result_version || !sourceAvailable(accepted, acceptedState)
      || currentSourceWatermark.current !== sourceWatermark) return;
    const result = await client.taskResult(entry.result.task_id);
    const current = store.getSnapshot();
    const latest = current.deliveries[entry.id];
    if (latest && currentSourceWatermark.current === sourceWatermark && sourceAvailable(latest, current, result)
      && latest.result_version === entry.result_version && result.result_version === entry.result_version
      && result.handle.task_id === entry.result.task_id && result.handle.run_id === entry.result.run_id)
      setPreview({ id: entry.id, resultVersion: entry.result_version, sourceWatermark, result, activities });
  }
  useEffect(() => {
    if (!single || automatic.current || !sourceAvailable(single, projection)
      || commands.some(command => command.targetId === single.id && command.status === 'unconfirmed')) return;
    automatic.current = true;
    void act(() => view(single));
  }, [single, projection, commands]);

  function name(entry: SessionInboxEntry) {
    if (!sourceAvailable(entry, projection)) return '后台交付';
    const task = projection.tasks[entry.result.task_id];
    const run = projection.runs[entry.result.run_id];
    return entry.task_name || task?.binding.agent_work?.goal || entry.assistant_name
      || task?.binding.config.agent_profile.display_name || run?.config.agent_profile.display_name || '后台交付';
  }
  function artifactLinks(entry: SessionInboxEntry, selected: NonNullable<typeof preview>) {
    if (!onArtifact || selected.result.artifacts.length === 0) return null;
    if (activityReads?.owner !== selected) return <p role="status">正在读取产物名称…</p>;
    const resolved = new Map<string, ResolvedActivity>(selected.result.artifacts.map(artifact => {
      const read = activityReads.reads.get(artifact.activity_id);
      const page = read && 'page' in read ? read.page : undefined;
      const activity = (page?.items ?? selected.activities).find(item =>
        item.id === artifact.activity_id && item.task_id === artifact.task_id && (!page || item.run_id === selected.result.handle.run_id));
      if (read && 'issue' in read) return [artifact.id, { issue: read.issue }] as const;
      if (!activity || !dependenciesAvailable(activity.dependencies, projection)
        || page && BigInt(page.watermark) < BigInt(projection.snapshotWatermark))
        return [artifact.id, { issue: '产物名称不可用' }] as const;
      return [artifact.id, { activity, page }] as const;
    }));
    const usable = [...resolved.values()].flatMap(item => 'activity' in item ? [item.activity] : []);
    return <ul aria-label="交付产物">{describeArtifacts(selected.result.artifacts, usable).map(({ artifact, label }) => {
      const item = resolved.get(artifact.id)!;
      return <li key={artifact.id}>
        <Button size="sm" variant="link" className="h-auto whitespace-normal text-start wrap-anywhere" onClick={() => onArtifact(artifact, entry, 'page' in item ? item.page : undefined)}>{label}</Button>
        {'issue' in item && <span className="muted"> {item.issue}</span>}
      </li>;
    })}</ul>;
  }
  const names = new Map(entries.map(entry => [entry.id, name(entry)]));
  const nameCounts = new Map<string, number>();
  const rowLabels = new Map<string, string>();
  for (const title of names.values()) nameCounts.set(title, (nameCounts.get(title) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const [id, title] of names) {
    const order = (seen.get(title) ?? 0) + 1;
    seen.set(title, order);
    rowLabels.set(id, nameCounts.get(title)! > 1 ? `${title} · 第 ${order} 项` : title);
  }
  return <section className="result-inbox mt-3.5" aria-label="结果收件箱"><header className="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h2>结果收件箱</h2><IconButton icon="refresh" size="icon-sm" label="刷新结果" disabled={busy} onClick={() => void act(() => refresh())} /></header>
    {error && <p role="alert">{error}</p>}
    {ready && !visible.length && <p className="empty-state">{deliveryIds ? '找不到回告对应的交付。' : '暂无后台交付结果。'}</p>}
    {visible.map(entry => {
      const available = sourceAvailable(entry, projection, preview?.id === entry.id ? preview.result : undefined);
      const title = names.get(entry.id);
      const heading = `${headingId}-${entry.id}`;
      // 语义禁用保留键盘焦点；act 同步拦截提交前的重复激活。
      const viewBlocked = busy || commands.some(command => command.targetId === entry.id && command.status === 'unconfirmed');
      return <article key={entry.id} className="result-entry mb-3 rounded-lg border border-border bg-background p-4 wrap-anywhere [&_p]:my-1.5" aria-labelledby={heading}>
      <h3 id={heading}>{rowLabels.get(entry.id)}</h3>
      <p className="muted">{labels[entry.delivery_state]}</p>
      {available && entry.assistant_name && entry.assistant_name !== title && <p className="muted">负责人 {entry.assistant_name}</p>}
      <p>{entry.viewed_at ? '你已查看' : '尚未查看'} · {entry.consumers.length ? `模型消费记录 ${entry.consumers.length}` : '模型尚未消费'}</p>
      {!available && <p>来源已失效，正文不可用</p>}
      {entry.last_error && <p>投递错误：{entry.last_error} · 尝试 {entry.attempts} 次</p>}
      <div className="button-row"><Button size="sm" variant="secondary" aria-disabled={viewBlocked} onClick={() => { if (!viewBlocked) void act(() => view(entry)); }}>{available ? '查看结果' : '标记已查看'}</Button>
        {entry.delivery_state === 'failed' && available && <Button size="sm" variant="outline" disabled={busy || commands.some(command => command.targetId === entry.id && command.type === 'retryDelivery')} onClick={() => void act(() => onCommand({ type: 'retryDelivery', args: [entry.id, commandMeta(entry.version)] }))}>重新投递</Button>}
        {onSummarize && <Button size="sm" variant="outline" disabled={busy || summaryBlocked || !available || entry.target_session_id !== sessionId}
          onClick={() => onSummarize(entry)}>在会话中总结</Button>}
        <Button size="sm" variant="ghost" onClick={() => onOpen(entry.result.run_id)}>定位结果任务</Button>
        {onMessage && messageDeliveryIds?.has(entry.id) && <Button size="sm" variant="ghost" onClick={() => onMessage(entry.id)}>定位聊天回告</Button>}
      </div>
      {entry.delivery_state === 'pending' && <p className="muted">通知仍在等待投递；不会重新执行任务。</p>}
      {preview?.id === entry.id && preview.resultVersion === entry.result_version && preview.sourceWatermark === sourceWatermark && available && <section className="mt-3" aria-label="结果预览">
        {isAgentResult(preview.result.result) ? <AgentResultView result={preview.result.result} /> : <pre>{JSON.stringify(preview.result.result, null, 2)}</pre>}
         {artifactLinks(entry, preview)}
        {preview.result.artifacts.length === 0 && <p className="muted">暂无产物</p>}</section>}
      {entry.consumers.length > 0 && <details><summary>查看消费记录</summary><ol>{entry.consumers.map(item => <li key={item.id}>
        {projection.tasks[item.task_id]?.binding.config.agent_profile.display_name ?? '助理'} · 结果版本 {item.result_version}</li>)}</ol></details>}
    </article>; })}
    {!deliveryIds && projection.resultPages[sessionId]?.next_cursor && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => store.refreshResults(sessionId, projection.resultPages[sessionId].next_cursor!))}>更多结果</Button>}
  </section>;
}
