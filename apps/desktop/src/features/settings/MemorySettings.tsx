import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { mergeGrants } from '../../api/events';
import { windowError } from '../../api/windows';
import type { DataUseGrant, MemoryPolicy, ModelConnectionPage, ModelProfilePage } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';
import type { EditorLifecycle } from './Settings';
import { memoryQuery, personalScope, type MemoryScope } from '../../api/memory';
import MemoryScopePicker from '../memory/MemoryScopePicker';
import MemoryCommands from '../memory/MemoryCommands';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';

const purposeLabels = { read: '读取', model_send: '模型发送', export: '导出', tool_send: 'MCP 工具发送', local_process_send: '本机脚本发送' };

export default function MemorySettings({ client, store, initialScope = personalScope, onBusyChange, onSaved, onDiscard, guard = action => action() }: {
  client: RuntimeClient; store: RuntimeStore; initialScope?: MemoryScope;
} & EditorLifecycle) {
  const helpId = useId();
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
  return <section className="grid gap-3 wrap-anywhere"><h2 className="m-0">记忆与上下文</h2>
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
      <FieldSet disabled={blocked}><FieldLegend>读取与整理策略</FieldLegend>
        <FieldGroup className="rounded-md border border-border p-3">
        <Field orientation="horizontal" className="items-start">
          <Checkbox id={`${helpId}-read-check`} className="mt-0.5" disabled={blocked} aria-describedby={`${helpId}-read`} checked={draft.read_profile} onCheckedChange={checked => edit({ read_profile: checked === true })} />
          <div className="grid gap-1"><FieldLabel htmlFor={`${helpId}-read-check`}>启用个人画像读取</FieldLabel>
          <FieldDescription id={`${helpId}-read`}>本次运行需选择此范围，发送前还需获得目标模型授权。停用会保留已有记忆。</FieldDescription></div>
        </Field>
        <Field orientation="horizontal" className="items-start">
          <Checkbox id={`${helpId}-organize-check`} className="mt-0.5" disabled={blocked} aria-describedby={`${helpId}-organize`} checked={draft.auto_organize} onCheckedChange={checked => edit({ auto_organize: checked === true })} />
          <div className="grid gap-1"><FieldLabel htmlFor={`${helpId}-organize-check`}>启用自动记忆整理</FieldLabel>
          <FieldDescription id={`${helpId}-organize`}>由维护任务生成候选，采纳由你决定。</FieldDescription></div>
        </Field>
        <Field><FieldLabel htmlFor={`${helpId}-model`}>整理模型</FieldLabel>
          <NativeSelect id={`${helpId}-model`} value={draft.model_profile_id ?? ''} onChange={event => edit({ model_profile_id: event.target.value || null })}>
            <NativeSelectOption value="">未选择</NativeSelectOption>{models?.items.map(model => <NativeSelectOption key={model.id} value={model.id}>{model.display_name ?? model.model_id}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <details><summary className="cursor-pointer">维护额度</summary><FieldGroup className="mt-2">{([['max_steps', '步骤上限'], ['max_model_requests', '模型请求上限'], ['max_tasks', '任务上限'],
          ['deadline_seconds', '时限（秒）'], ['max_total_tokens', '总 Token 上限'], ['max_parallel_agents', '并行成员上限'],
          ['max_delegation_depth', '委派深度上限']] as const).map(([name, label]) => <Field key={name}>
          <FieldLabel htmlFor={`${helpId}-${name}`}>{label}</FieldLabel>
          <Input id={`${helpId}-${name}`} type="number" required={name !== 'max_total_tokens'} min={name === 'deadline_seconds' ? '0.001' : '0'} step={name === 'deadline_seconds' ? 'any' : '1'} max={Number.MAX_SAFE_INTEGER}
            value={draft.maintenance_limits[name] ?? ''} onChange={event => edit({ maintenance_limits: { ...draft.maintenance_limits,
              [name]: event.target.value === '' && name === 'max_total_tokens' ? null : event.target.valueAsNumber } })} /></Field>)}
          <Field><FieldLabel htmlFor={`${helpId}-max-cost`}>费用上限（记账单位）</FieldLabel>
          <Input id={`${helpId}-max-cost`} pattern="(0|[1-9][0-9]*)" value={draft.maintenance_limits.max_cost_units ?? ''} onChange={event => edit({
            maintenance_limits: { ...draft.maintenance_limits, max_cost_units: event.target.value || null },
          })} /></Field>
        </FieldGroup></details>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="default">保存记忆策略</Button>
          <Button type="button" onClick={() => { isDirty.current = false; setDirty(false); setDraft(policy); onDiscard?.(form.current!); }}>放弃策略编辑</Button>
        </div>
        </FieldGroup>
      </FieldSet>
    </form>}
    <section className="grid gap-3 rounded-md border border-border p-3">
    <div><h3 className="m-0 text-sm font-medium">目标模型发送授权</h3><FieldDescription>单独授权当前记忆范围和发送目的地。</FieldDescription></div>
    <Field><FieldLabel htmlFor={`${helpId}-destination`}>授权目标模型</FieldLabel>
      <NativeSelect id={`${helpId}-destination`} value={destinationModel} disabled={blocked} onChange={event => setDestinationModel(event.target.value)}>
        <NativeSelectOption value="">请选择模型</NativeSelectOption>{models?.items.map(model => <NativeSelectOption key={model.id} value={model.id}>{model.display_name ?? model.model_id}</NativeSelectOption>)}
      </NativeSelect>
    </Field>
    {destination && <FieldDescription>发送目的地：{destination}</FieldDescription>}
    <Button className="justify-self-start whitespace-normal" disabled={blocked || !destination} onClick={() => void act(async () => { await store.dispatch({ type: 'grantMemory',
      args: [{ meta: commandMeta(), data: { scope, destination: destination! } }] }); })}>授权此范围发送到所选模型</Button>
    {loaded === key ? grants.map(grant => <article key={grant.id}><p>{grant.purposes.map(purpose => purposeLabels[purpose]).join('、')} · {grant.destination} · <span>{grant.status === 'active' ? '已授权' : '已撤销'}</span></p>
      {grant.status === 'active' && <Button disabled={blocked} onClick={() => void act(async () => { await store.dispatch({ type: 'revoke', args: [grant.id, commandMeta(grant.version)] }); })}>撤销此{grant.purposes.map(purpose => purposeLabels[purpose]).join('、')}授权</Button>}
    </article>) : !error && <p role="status" className="muted">正在核对发送授权…</p>}
    </section>
    {models?.next_cursor && <Button className="justify-self-start" onClick={() => void act(async () => { const next = await client.models({ cursor: models.next_cursor! }); setModels({ ...next, items: [...models.items, ...next.items] }); })}>更多记忆模型</Button>}
    {connections?.next_cursor && <Button className="justify-self-start" onClick={() => void act(async () => { const next = await client.connections({ cursor: connections.next_cursor! }); setConnections({ ...next, items: [...connections.items, ...next.items] }); })}>更多记忆连接</Button>}
    <MemoryCommands store={store} />
  </section>;
}
