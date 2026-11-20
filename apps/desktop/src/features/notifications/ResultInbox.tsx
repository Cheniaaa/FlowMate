import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { SessionInboxEntry, TaskResult } from '../../generated/contracts';
import type { CommandOutcome, RuntimeStore, UiCommand } from '../../state/runtime-store';
import { AgentResult as isAgentResult } from '../../generated/validators.js';
import AgentResultView from '../tasks/AgentResultView';
import type { Projection } from '../../api/events';

function sourceAvailable(entry: SessionInboxEntry, state: Projection, result?: TaskResult): boolean {
  return entry.source_valid && entry.delivery_state !== 'invalidated' && !state.deletedSessions[entry.target_session_id]
    && [...entry.dependencies, ...(result?.dependencies ?? [])].every(dependency =>
      [state.scopes[dependency.scope_id], state.grants[dependency.scope_id]].every(scope =>
        !scope || scope.epoch <= dependency.epoch && scope.status === 'active'));
}

interface ResultInboxProps {
  client: RuntimeClient; store: RuntimeStore; sessionId: string; runId?: string;
  sourceWatermark?: string;
  onCommand: (command: UiCommand) => Promise<CommandOutcome>; onOpen: (runId: string) => void;
  onSummarize?: (entry: SessionInboxEntry) => void; summaryBlocked?: boolean;
}

export default function ResultInbox(props: ResultInboxProps) {
  const [identity, setIdentity] = useState({ client: props.client, store: props.store, sessionId: props.sessionId, runId: props.runId, key: 0 });
  if (identity.client !== props.client || identity.store !== props.store || identity.sessionId !== props.sessionId || identity.runId !== props.runId) {
    setIdentity({ client: props.client, store: props.store, sessionId: props.sessionId, runId: props.runId, key: identity.key + 1 });
  }
  return <ResultInboxView key={identity.key} {...props} />;
}

function ResultInboxView({ client, store, sessionId, runId, sourceWatermark = '0', onCommand, onOpen, onSummarize, summaryBlocked = false }: ResultInboxProps) {
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const [preview, setPreview] = useState<{ id: string; resultVersion: number; sourceWatermark: string; result: TaskResult }>();
  const previewEntry = preview && projection.deliveries[preview.id];
  useEffect(() => {
    if (preview && (!previewEntry || !sourceAvailable(previewEntry, projection, preview.result)
      || previewEntry.result_version !== preview.resultVersion || preview.sourceWatermark !== sourceWatermark || projection.deletedSessions[sessionId])) setPreview(undefined);
  }, [preview, previewEntry, sourceWatermark, projection.scopes, projection.grants, projection.deletedSessions, sessionId]);
  useEffect(() => {
    let ignore = false; setError('');
    store.refreshResults(sessionId).then(() => { if (!ignore) setReady(true); }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [store, sessionId, projection.snapshotWatermark, sourceWatermark]);
  const entries = ready ? (projection.resultPages[sessionId]?.ids ?? []).map(id => projection.deliveries[id]).filter(entry => entry && (!runId || entry.result.run_id === runId)) : [];
  async function act(action: () => Promise<unknown>) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(windowError(error)); }
    finally { acting.current = false; setBusy(false); }
  }
  async function view(entry: SessionInboxEntry) {
    setPreview(undefined);
    await onCommand({ type: 'viewResult', args: [entry.id, commandMeta(entry.version)] });
    const accepted = store.getSnapshot().deliveries[entry.id];
    if (!accepted || !sourceAvailable(accepted, store.getSnapshot())) return;
    const result = await client.taskResult(entry.result.task_id);
    const current = store.getSnapshot();
    const latest = current.deliveries[entry.id];
    if (latest && sourceAvailable(latest, current, result) && latest.result_version === entry.result_version)
      setPreview({ id: entry.id, resultVersion: entry.result_version, sourceWatermark, result });
  }
  const labels = { pending: '等待投递', delivered: '已送达', failed: '投递失败', invalidated: '来源已失效' };
  return <section className="result-inbox" aria-label="结果收件箱"><header><h2>结果收件箱</h2><button disabled={busy} onClick={() => void act(async () => { await store.refreshResults(sessionId); setReady(true); })}>刷新结果</button></header>
    {error && <p role="alert">{error}</p>}
    {ready && !entries.length && <p className="empty-state">暂无后台交付结果。</p>}
    {entries.map(entry => {
      const available = sourceAvailable(entry, projection, preview?.id === entry.id ? preview.result : undefined);
      // 语义禁用保留键盘焦点；act 同步拦截提交前的重复激活。
      const viewBlocked = busy || commands.some(command => command.targetId === entry.id && command.status === 'unconfirmed');
      return <article key={entry.id} className="result-entry">
      <h3>{labels[entry.delivery_state]}</h3>
      <p>{entry.viewed_at ? '你已查看' : '尚未查看'} · {entry.consumers.length ? `模型消费记录 ${entry.consumers.length}` : '模型尚未消费'}</p>
      {!available && <p>来源已失效，正文不可用</p>}
      {entry.last_error && <p>投递错误：{entry.last_error} · 尝试 {entry.attempts} 次</p>}
      <div className="button-row"><button aria-disabled={viewBlocked} onClick={() => { if (!viewBlocked) void act(() => view(entry)); }}>{available ? '查看结果' : '标记已查看'}</button>
        {entry.delivery_state === 'failed' && available && <button disabled={busy || commands.some(command => command.targetId === entry.id && command.type === 'retryDelivery')} onClick={() => void act(() => onCommand({ type: 'retryDelivery', args: [entry.id, commandMeta(entry.version)] }))}>重新投递</button>}
        {onSummarize && <button disabled={busy || summaryBlocked || !available || entry.target_session_id !== sessionId}
          onClick={() => onSummarize(entry)}>在会话中总结</button>}
        <button onClick={() => onOpen(entry.result.run_id)}>定位结果任务</button></div>
      {entry.delivery_state === 'pending' && <p className="muted">通知仍在等待投递；不会重新执行任务。</p>}
      {preview?.id === entry.id && preview.resultVersion === entry.result_version && preview.sourceWatermark === sourceWatermark && available && <section className="result-preview" aria-label="结果预览">
        {isAgentResult(preview.result.result) ? <AgentResultView result={preview.result.result} /> : <pre>{JSON.stringify(preview.result.result, null, 2)}</pre>}
        <p>产物 {preview.result.artifacts.length} · 查看不会创建模型消费。</p></section>}
      {entry.consumers.length > 0 && <details><summary>查看消费记录</summary><ul>{entry.consumers.map(item => <li key={item.id}>Task <code>{item.task_id}</code> · 执行会话 <code>{item.execution_session_id}</code> · 结果版本 {item.result_version}</li>)}</ul></details>}
    </article>; })}
    {projection.resultPages[sessionId]?.next_cursor && <button disabled={busy} onClick={() => void act(() => store.refreshResults(sessionId, projection.resultPages[sessionId].next_cursor!))}>更多结果</button>}
  </section>;
}
