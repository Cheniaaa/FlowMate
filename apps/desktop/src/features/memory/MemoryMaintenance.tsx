import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { memoryQuery, memoryScopeLabel, type MemoryScope } from '../../api/memory';
import { windowError } from '../../api/windows';
import type { MemoryPolicy, MemorySourceBoundary, ModelResolution, RunSnapshot, TaskCenterPage, TaskHandle } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';
import MaintenanceHistory from './MaintenanceHistory';

export default function MemoryMaintenance({ client, store, scope, initialSource, onOpenTask, disabled = false, onBusyChange }: {
  client: RuntimeClient; store: RuntimeStore; scope: MemoryScope; initialSource?: RunSnapshot;
  onOpenTask: (task: TaskHandle) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot), commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [kind, setKind] = useState<'user' | 'managed'>(initialSource?.kind === 'managed' ? 'managed' : 'user');
  const [sourceId, setSourceId] = useState(initialSource?.id ?? ''), [generation, refresh] = useState(0);
  const [sources, setSources] = useState<{ key: string; page: TaskCenterPage }>();
  const [proof, setProof] = useState<{ key: string; policy: MemoryPolicy; boundary: MemorySourceBoundary; model: ModelResolution }>();
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<{ scopeKey: string; task: TaskHandle }>(), pending = useRef(false);
  const scopeKey = `${scope.kind}:${scope.workspace_id}`, listKey = `${scopeKey}:${kind}:${generation}:${projection.memoryRevision}`;
  const proofKey = `${scopeKey}:${sourceId}:${projection.memoryRevision}:${generation}`;
  const filters = { ...(scope.kind === 'workspace' ? { workspace_id: scope.workspace_id! } : {}), kind, limit: 50 };
  useEffect(() => {
    const selected = [initialSource, ...(sources?.page.items.map(item => item.run) ?? [])].find(run => run?.id === sourceId);
    if (scope.kind === 'workspace' && selected?.workspace_id !== scope.workspace_id) setSourceId('');
  }, [scopeKey]);
  useEffect(() => { let ignore = false;
    client.globalTasks(filters).then(page => { if (!ignore) setSources({ key: listKey, page }); }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, listKey]);
  useEffect(() => { let ignore = false; setConfirming(false);
    if (sourceId) Promise.all([client.memoryPolicy(memoryQuery(scope)), client.memorySourceBoundary(sourceId)]).then(async ([policy, boundary]) => {
      if (!policy.model_profile_id) throw new Error('尚未选择整理模型');
      const model = await client.modelResolution(policy.model_profile_id);
      if (model.blockers.length) throw new Error(`整理模型不可用：${model.blockers.join('、')}`);
      if (!ignore) setProof({ key: proofKey, policy, boundary, model });
    }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, proofKey]);
  const sourcePage = sources?.key === listKey ? sources.page : undefined;
  const selectedInitial = initialSource && initialSource.kind === kind && (scope.kind === 'user_global' || scope.workspace_id === initialSource.workspace_id) ? initialSource : undefined;
  const options = [...new Map([...(selectedInitial ? [selectedInitial] : []), ...(sourcePage?.items.map(item => item.run) ?? [])].map(run => [run.id, run])).values()];
  const current = proof?.key === proofKey && options.some(run => run.id === sourceId) ? proof : undefined;
  const blocked = disabled || busy || commands.some(command => command.type === 'submitMemoryMaintenance');
  async function submit() {
    if (pending.current || !current) return;
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try {
      const outcome = await store.dispatch({ type: 'submitMemoryMaintenance', args: [{ meta: commandMeta(current.policy.version),
        data: { scope: current.policy.scope, source_boundary: current.boundary,
          budget_confirmation: { kind: 'new_budget', model_profile_id: current.model.id,
            model_version: current.model.version, connection_version: current.model.connection_version,
            limits: current.policy.maintenance_limits } } }] });
      if (outcome.status === 'confirmed' && outcome.task) setSubmitted({ scopeKey, task: outcome.task });
    } catch (error) { setError(error instanceof ApiError ? `${error.code}: ${error.message}` : windowError(error)); }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false); setConfirming(false); }
  }
  return <section className="memory-maintenance" aria-label="整理记忆">
    <h2>整理记忆</h2><p>从已提交的真实运行提取候选；整理不代替你的采纳决定。</p>
    <fieldset disabled={blocked}><legend>整理来源</legend>
      <label>来源运行类型 <select value={kind} onChange={event => { setKind(event.target.value as typeof kind); setSourceId(''); setError(''); }}><option value="user">普通运行</option><option value="managed">托管运行</option></select></label>
      <label>整理来源运行 <select value={sourceId} onChange={event => { setSourceId(event.target.value); setError(''); }}>
        <option value="">请选择已提交的来源运行</option>{options.filter(run => run.kind === kind).map(run => {
          const inCurrentPage = sourcePage?.items.some(item => item.run.id === run.id);
          return <option key={run.id} value={run.id}>{inCurrentPage
            ? `${run.output?.summary || `${kind === 'user' ? '普通运行' : '托管运行'} · ${run.id.slice(0, 8)}`} · ${run.state}`
            : `任务中心所选运行 · ${run.id.slice(0, 8)}`}</option>;
        })}
      </select></label>
      {sourcePage?.next_cursor && <button onClick={() => {
        void client.globalTasks({ ...filters, cursor: sourcePage.next_cursor! }).then(page => setSources(previous => previous?.key === listKey ? {
          key: listKey, page: { ...page, items: [...previous.page.items, ...page.items] },
        } : previous)).catch(error => setError(windowError(error)));
      }}>更多来源运行</button>}
      <button onClick={() => { setError(''); refresh(value => value + 1); }}>重新核对来源与策略</button>
      <button disabled={!current} onClick={() => setConfirming(true)}>整理记忆</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {confirming && current && <section aria-label="确认整理记忆"><h3>确认整理记忆</h3>
      <p>保存范围：{memoryScopeLabel(current.policy.scope)} · 来源运行 {current.boundary.run_id}</p>
      <p>已提交边界 {current.boundary.event_id} · 策略版本 {current.policy.version}</p>
      <p>本次确认独立维护预算，从提交时起有效 {current.policy.maintenance_limits.deadline_seconds} 秒；不使用来源运行的剩余额度。</p>
      <p>整理模型：{current.model.display_name ?? current.model.model_id} · 模型版本 {current.model.version} · 连接版本 {current.model.connection_version} · {current.model.endpoint}</p>
      <p>本次上限：模型请求 {current.policy.maintenance_limits.max_model_requests} 次，步骤 {current.policy.maintenance_limits.max_steps}，任务 {current.policy.maintenance_limits.max_tasks}；
        金额单位 {current.policy.maintenance_limits.max_cost_units ?? '不限'}，Token {current.policy.maintenance_limits.max_total_tokens ?? '不限'}；
        委派深度 {current.policy.maintenance_limits.max_delegation_depth}，并行 Agent {current.policy.maintenance_limits.max_parallel_agents}。</p>
      <p>继续检查固定来源及用途授权。自动整理{current.policy.auto_organize ? '已开启' : '未开启'}，仍只使用原组额度；本次提交不修改此策略。</p>
      <button disabled={blocked} onClick={() => void submit()}>确认提交整理任务</button><button disabled={busy} onClick={() => setConfirming(false)}>暂不整理</button>
    </section>}
    {submitted?.scopeKey === scopeKey && <><p role="status">整理任务已提交</p><button onClick={() => onOpenTask(submitted.task)}>打开已提交的维护任务</button></>}
    <MaintenanceHistory client={client} scope={scope} revision={`${projection.maintenanceRevision}:${projection.memoryRevision}`} onOpenTask={onOpenTask} />
  </section>;
}
