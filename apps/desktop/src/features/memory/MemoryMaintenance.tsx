import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { memoryQuery, type MemoryScope } from '../../api/memory';
import { windowError } from '../../api/windows';
import type { MemoryPolicy, MemorySourceBoundary, ModelResolution, RunSnapshot, TaskCenterPage, TaskHandle } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';
import { Button } from '../../components/ui/button';
import { FieldLabel, FieldLegend, FieldSet } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import Status from '../../components/Status';
import MaintenanceHistory from './MaintenanceHistory';

type Proof = { key: string; policy: MemoryPolicy; boundary: MemorySourceBoundary; model: ModelResolution };

export default function MemoryMaintenance({ client, store, scope, scopeLabel = scope.kind === 'user_global' ? '个人' : '当前项目',
  initialSource, onOpenTask, disabled = false, onBusyChange }: {
  client: RuntimeClient; store: RuntimeStore; scope: MemoryScope; initialSource?: RunSnapshot;
  scopeLabel?: string; onOpenTask: (task: TaskHandle) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot), commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [kind, setKind] = useState<'user' | 'managed'>(initialSource?.kind === 'managed' ? 'managed' : 'user');
  const [sourceId, setSourceId] = useState(initialSource?.id ?? ''), [generation, refresh] = useState(0);
  const [sources, setSources] = useState<{ key: string; identity: string; page: TaskCenterPage }>();
  const [proof, setProof] = useState<Proof>(), [confirming, setConfirming] = useState<Proof>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [readError, setReadError] = useState('');
  const [submitted, setSubmitted] = useState<{ scopeKey: string; task: TaskHandle }>(), pending = useRef(false);
  const scopeKey = `${scope.kind}:${scope.workspace_id}`, sourceIdentity = `${scopeKey}:${kind}`;
  const listKey = `${sourceIdentity}:${generation}:${projection.memoryRevision}`;
  const proofKey = `${scopeKey}:${sourceId}:${projection.memoryRevision}:${generation}`;
  const filters = { ...(scope.kind === 'workspace' ? { workspace_id: scope.workspace_id! } : {}), kind, limit: 50 };
  useEffect(() => {
    const selected = [initialSource, ...(sources?.page.items.map(item => item.run) ?? [])].find(run => run?.id === sourceId);
    if (scope.kind === 'workspace' && selected?.workspace_id !== scope.workspace_id) setSourceId('');
  }, [scopeKey]);
  useEffect(() => { let ignore = false; setReadError('');
    client.globalTasks(filters).then(page => { if (!ignore) setSources(previous => ({ key: listKey, identity: sourceIdentity,
      page: previous?.identity === sourceIdentity && previous.page.items.some(item => item.run.id === sourceId)
        && !page.items.some(item => item.run.id === sourceId)
        ? { ...page, items: [...page.items, previous.page.items.find(item => item.run.id === sourceId)!] } : page })); })
      .catch(error => { if (!ignore) setReadError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, listKey]);
  useEffect(() => { let ignore = false;
    if (sourceId) Promise.all([client.memoryPolicy(memoryQuery(scope)), client.memorySourceBoundary(sourceId)]).then(async ([policy, boundary]) => {
      if (!policy.model_profile_id) throw new Error('尚未选择整理模型');
      const model = await client.modelResolution(policy.model_profile_id);
      if (model.blockers.length) throw new Error('整理模型不可用：请在模型设置中核对型号、请求预算和工具调用能力。');
      if (!ignore) setProof({ key: proofKey, policy, boundary, model });
    }).catch(error => { if (!ignore) setReadError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, proofKey]);
  const sourcePage = sources?.identity === sourceIdentity ? sources.page : undefined;
  const selectedInitial = initialSource && initialSource.kind === kind && (scope.kind === 'user_global' || scope.workspace_id === initialSource.workspace_id) ? initialSource : undefined;
  const options = [...new Map([...(selectedInitial ? [selectedInitial] : []), ...(sourcePage?.items.map(item => item.run) ?? [])].map(run => [run.id, run])).values()];
  const current = proof?.key === proofKey && options.some(run => run.id === sourceId) ? proof : undefined;
  const names = options.map(run => {
    const session = run.interaction_session_id ? projection.sessions[run.interaction_session_id] : undefined;
    const goal = sourcePage?.items.find(item => item.run.id === run.id)?.root.binding.agent_work?.goal;
    const label = goal || run.output?.summary || session?.title;
    return [run.id, label || `${run.kind === 'user' ? '普通对话' : '后台任务'} · ${run.config.agent_profile.display_name}`] as const;
  });
  const sourceLabels = Object.fromEntries(names.map(([id, label], index) => [id,
    names.filter(([, candidate]) => label === candidate).length > 1 ? `${label}（第 ${index + 1} 项）` : label]));
  const blocked = disabled || busy || commands.some(command => command.type === 'submitMemoryMaintenance');
  const confirmationChanged = current && confirming && (current.policy.version !== confirming.policy.version
    || current.boundary.event_id !== confirming.boundary.event_id || current.model.id !== confirming.model.id
    || current.model.version !== confirming.model.version || current.model.connection_version !== confirming.model.connection_version);
  async function submit() {
    if (pending.current || !current || !confirming || confirmationChanged) return;
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try {
      const outcome = await store.dispatch({ type: 'submitMemoryMaintenance', args: [{ meta: commandMeta(confirming.policy.version),
        data: { scope: confirming.policy.scope, source_boundary: confirming.boundary,
          budget_confirmation: { kind: 'new_budget', model_profile_id: confirming.model.id,
            model_version: confirming.model.version, connection_version: confirming.model.connection_version,
            limits: confirming.policy.maintenance_limits } } }] });
      if (outcome.status === 'confirmed' && outcome.task) setSubmitted({ scopeKey, task: outcome.task });
    } catch (error) { setError(windowError(error)); }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false); setConfirming(undefined); }
  }
  return <section className="memory-maintenance" aria-label="整理记忆">
    <p>从选定的对话或任务找出候选记忆，由你决定是否记住。</p>
    <FieldSet disabled={blocked}><FieldLegend>整理来源</FieldLegend>
      <FieldLabel>来源类型 <NativeSelect value={kind} onChange={event => { setKind(event.target.value as typeof kind); setSourceId(''); setConfirming(undefined); setError(''); }}>
        <NativeSelectOption value="user">普通对话</NativeSelectOption>
        <NativeSelectOption value="managed">后台任务</NativeSelectOption>
      </NativeSelect></FieldLabel>
      <FieldLabel>整理来源运行 <NativeSelect value={sourceId} onChange={event => { setSourceId(event.target.value); setConfirming(undefined); setError(''); setReadError(''); }}>
        <NativeSelectOption value="">请选择对话或任务</NativeSelectOption>
        {options.filter(run => run.kind === kind).map(run => <NativeSelectOption key={run.id} value={run.id}>{sourceLabels[run.id]}</NativeSelectOption>)}
      </NativeSelect></FieldLabel>
      {options.find(run => run.id === sourceId) && <Status state={options.find(run => run.id === sourceId)!.state} />}
      {sourcePage?.next_cursor && <Button type="button" onClick={() => {
        void client.globalTasks({ ...filters, cursor: sourcePage.next_cursor! }).then(page => setSources(previous => previous?.key === listKey ? {
          key: listKey, identity: sourceIdentity, page: { ...page, items: [...previous.page.items, ...page.items] },
        } : previous)).catch(error => setReadError(windowError(error)));
      }}>更多来源</Button>}
      <Button disabled={!current} onClick={() => setConfirming(current)}>整理记忆</Button>
    </FieldSet>
    {readError && <><p role="alert">{readError}</p><Button variant="outline" onClick={() => { setReadError(''); refresh(value => value + 1); }}>重试读取整理来源</Button></>}
    {error && <p role="alert">{error}</p>}
    {confirming && <section aria-label="确认整理记忆"><h3>确认整理记忆</h3>
      <p>适用范围：{scopeLabel} · 来源：{sourceLabels[confirming.boundary.run_id]}</p>
      <p>本次使用独立维护预算，从提交时起有效 {confirming.policy.maintenance_limits.deadline_seconds} 秒。</p>
      <p>整理模型：{confirming.model.display_name ?? confirming.model.model_id} · {confirming.model.endpoint}</p>
      <p>本次上限：模型请求 {confirming.policy.maintenance_limits.max_model_requests} 次，步骤 {confirming.policy.maintenance_limits.max_steps}，任务 {confirming.policy.maintenance_limits.max_tasks}，
        金额单位 {confirming.policy.maintenance_limits.max_cost_units ?? '不限'}，Token {confirming.policy.maintenance_limits.max_total_tokens ?? '不限'}，
        委派深度 {confirming.policy.maintenance_limits.max_delegation_depth}，并行助理 {confirming.policy.maintenance_limits.max_parallel_agents}。</p>
      {confirmationChanged && <p role="status">来源或预算已改变，请再次查看整理信息。</p>}
      <div className="flex flex-wrap gap-2"><Button aria-disabled={blocked || !current || !!confirmationChanged}
        onClick={() => { if (!blocked) void submit(); }}>确认提交整理任务</Button>
        <Button variant="outline" disabled={busy} onClick={() => setConfirming(undefined)}>暂不整理</Button></div>
    </section>}
    {submitted?.scopeKey === scopeKey && <><p role="status">整理任务已提交</p><Button type="button" onClick={() => onOpenTask(submitted.task)}>打开已提交的维护任务</Button></>}
    <MaintenanceHistory client={client} scope={scope} revision={`${projection.maintenanceRevision}:${projection.memoryRevision}`} sourceLabels={sourceLabels} onOpenTask={onOpenTask} />
  </section>;
}
