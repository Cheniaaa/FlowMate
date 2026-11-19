import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { mergeGrants } from '../../api/events';
import { windowError } from '../../api/windows';
import type { DataUseGrant, MemoryPolicy, ModelConnectionPage, ModelProfilePage } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';
import type { EditorLifecycle } from './Settings';
import { memoryQuery, personalScope, type MemoryScope } from '../../api/memory';
import MemoryScopePicker from '../memory/MemoryScopePicker';
import MemoryCommands from '../memory/MemoryCommands';

const purposeLabels = { read: '读取', model_send: '模型发送', export: '导出', tool_send: 'MCP 工具发送', local_process_send: '本机脚本发送' };

export default function MemorySettings({ client, store, initialScope = personalScope, onBusyChange, onSaved, onDiscard, guard = action => action() }: {
  client: RuntimeClient; store: RuntimeStore; initialScope?: MemoryScope;
} & EditorLifecycle) {
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot), commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [scope, setScope] = useState(initialScope), [policy, setPolicy] = useState<MemoryPolicy>(), [draft, setDraft] = useState<MemoryPolicy>();
  const [models, setModels] = useState<ModelProfilePage>(), [connections, setConnections] = useState<ModelConnectionPage>();
  const [grants, setGrants] = useState<DataUseGrant[]>([]), [destinationModel, setDestinationModel] = useState('');
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null), isDirty = useRef(false), [generation, refresh] = useState(0), [loaded, setLoaded] = useState('');
  const key = `${scope.kind}:${scope.workspace_id}:${projection.memoryRevision}:${generation}`;
  useEffect(() => { let ignore = false;
    Promise.all([client.models(), client.connections()]).then(([models, connections]) => { if (!ignore) { setModels(models); setConnections(connections); } })
      .catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client]);
  useEffect(() => { let ignore = false;
    async function read() {
      const policy = await client.memoryPolicy(memoryQuery(scope));
      const items: DataUseGrant[] = []; let cursor: string | undefined;
      do { const page = await client.memoryGrants({ ...memoryQuery(scope), cursor }); items.push(...page.items); cursor = page.next_cursor ?? undefined; } while (cursor);
      if (ignore) return;
      store.update(state => mergeGrants(state, items)); setGrants(items); setPolicy(policy); setLoaded(key);
      if (!isDirty.current) setDraft(policy);
    }
    void read().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, store, key]);
  const destination = connections?.items.find(connection => connection.id === models?.items.find(model => model.id === destinationModel)?.connection_id)?.endpoint;
  const blocked = busy || commands.some(command => ['saveMemoryPolicy', 'grantMemory', 'revoke'].includes(command.type));
  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); onBusyChange?.(true); setError('');
    try { await action(); } catch (error) { setError(windowError(error)); }
    finally { setBusy(false); onBusyChange?.(false); refresh(value => value + 1); }
  }
  function edit(change: Partial<MemoryPolicy>) { isDirty.current = true; setDirty(true); setDraft(current => ({ ...current!, ...change })); }
  return <section><h2>记忆与上下文</h2>
    <MemoryScopePicker client={client} scope={scope} disabled={blocked} onChange={next => guard(() => {
      isDirty.current = false; setDirty(false); setDraft(undefined); setScope(next); setStatus(''); onDiscard?.(form.current!);
    })} />
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {draft && <form ref={form} onReset={() => { isDirty.current = false; setDirty(false); setDraft(policy); }} onSubmit={event => {
      event.preventDefault(); const submitted = draft, element = event.currentTarget;
      void act(async () => {
        const outcome = await store.dispatch({ type: 'saveMemoryPolicy', args: [{ meta: commandMeta(submitted.version), data: submitted }] });
        if (outcome.status === 'confirmed') { isDirty.current = false; setDirty(false); setStatus('记忆策略已保存'); onSaved?.(element); }
      });
    }}>
      {dirty && policy && policy.version !== draft.version && <p role="alert">记忆策略已在另一窗改变；当前编辑保留，请重新读取后决定。</p>}
      <fieldset disabled={blocked}><legend>读取与整理策略 · 版本 {draft.version}</legend>
        <label><input type="checkbox" checked={draft.read_profile} onChange={event => edit({ read_profile: event.target.checked })} />启用个人画像读取</label>
        <label><input type="checkbox" checked={draft.auto_organize} onChange={event => edit({ auto_organize: event.target.checked })} />启用自动记忆整理</label>
        <p>读取开启仍需本次选择范围及目标模型授权；停用不删除已有事实。自动整理的实际执行由维护任务负责。</p>
        <label>整理模型 <select value={draft.model_profile_id ?? ''} onChange={event => edit({ model_profile_id: event.target.value || null })}>
          <option value="">未选择</option>{models?.items.map(model => <option key={model.id} value={model.id}>{model.display_name ?? model.model_id}</option>)}
        </select></label>
        <details><summary>维护额度</summary>{([['max_steps', '步骤上限'], ['max_model_requests', '模型请求上限'], ['max_tasks', '任务上限'],
          ['deadline_seconds', '时限（秒）'], ['max_total_tokens', '总 Token 上限'], ['max_parallel_agents', '并行成员上限'],
          ['max_delegation_depth', '委派深度上限']] as const).map(([name, label]) => <label key={name}>{label}
          <input type="number" required={name !== 'max_total_tokens'} min={name === 'deadline_seconds' ? '0.001' : '0'} step={name === 'deadline_seconds' ? 'any' : '1'} max={Number.MAX_SAFE_INTEGER}
            value={draft.maintenance_limits[name] ?? ''} onChange={event => edit({ maintenance_limits: { ...draft.maintenance_limits,
              [name]: event.target.value === '' && name === 'max_total_tokens' ? null : event.target.valueAsNumber } })} /></label>)}
          <label>费用上限（记账单位）<input pattern="(0|[1-9][0-9]*)" value={draft.maintenance_limits.max_cost_units ?? ''} onChange={event => edit({
            maintenance_limits: { ...draft.maintenance_limits, max_cost_units: event.target.value || null },
          })} /></label>
        </details>
        <button>保存记忆策略</button><button type="button" onClick={() => { isDirty.current = false; setDirty(false); setDraft(policy); onDiscard?.(form.current!); }}>放弃策略编辑</button>
      </fieldset>
    </form>}
    <h3>目标模型发送授权</h3><p>保存策略和记忆内容均不会创建发送授权。</p>
    <label>授权目标模型 <select value={destinationModel} disabled={blocked} onChange={event => setDestinationModel(event.target.value)}>
      <option value="">请选择模型</option>{models?.items.map(model => <option key={model.id} value={model.id}>{model.display_name ?? model.model_id}</option>)}
    </select></label>
    {destination && <p>发送目的地：{destination}</p>}
    <button disabled={blocked || !destination} onClick={() => void act(async () => { await store.dispatch({ type: 'grantMemory',
      args: [{ meta: commandMeta(), data: { scope, destination: destination! } }] }); })}>授权此范围发送到所选模型</button>
    {loaded === key ? grants.map(grant => <article key={grant.id}><p>{grant.purposes.map(purpose => purposeLabels[purpose]).join('、')} · {grant.destination} · <span>{grant.status === 'active' ? '已授权' : '已撤销'}</span></p>
      {grant.status === 'active' && <button disabled={blocked} onClick={() => void act(async () => { await store.dispatch({ type: 'revoke', args: [grant.id, commandMeta(grant.version)] }); })}>撤销此{grant.purposes.map(purpose => purposeLabels[purpose]).join('、')}授权</button>}
    </article>) : <p>正在核对发送授权…</p>}
    {models?.next_cursor && <button onClick={() => void act(async () => { const next = await client.models({ cursor: models.next_cursor! }); setModels({ ...next, items: [...models.items, ...next.items] }); })}>更多记忆模型</button>}
    {connections?.next_cursor && <button onClick={() => void act(async () => { const next = await client.connections({ cursor: connections.next_cursor! }); setConnections({ ...next, items: [...connections.items, ...next.items] }); })}>更多记忆连接</button>}
    <MemoryCommands store={store} />
  </section>;
}
