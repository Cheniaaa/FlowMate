import { useEffect, useId, useState, type FormEvent } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { NativeSelect } from '../../components/ui/native-select';
import type { ModelConnection, ModelProfile, TitlePolicy, Workspace } from '../../generated/contracts';
import type { EditorLifecycle } from './Settings';

async function all<T>(load: (cursor?: string) => Promise<{ items: T[]; next_cursor: string | null }>) {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return items;
}

export default function TitleSettings({ client, onBusyChange, onSaved, guard }: EditorLifecycle & { client: RuntimeClient }) {
  const field = useId();
  const [catalog, setCatalog] = useState<{ workspaces: Workspace[]; models: ModelProfile[]; connections: ModelConnection[] }>();
  const [workspace, setWorkspace] = useState('');
  const [policy, setPolicy] = useState<TitlePolicy>();
  const [modelId, setModelId] = useState('');
  const [requests, setRequests] = useState(10);
  const [tokens, setTokens] = useState(4000);
  const [cost, setCost] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let disposed = false;
    Promise.all([
      all(cursor => client.workspaces({ cursor })), all(cursor => client.models({ cursor })), all(cursor => client.connections({ cursor })),
    ]).then(([workspaces, models, connections]) => {
      if (!disposed) { setCatalog({ workspaces, models, connections }); setWorkspace(workspaces[0]?.id ?? ''); }
    }).catch(reason => { if (!disposed) setError(windowError(reason)); });
    return () => { disposed = true; };
  }, [client]);
  useEffect(() => {
    if (!workspace) return;
    let disposed = false;
    setPolicy(undefined);
    setSaved(false);
    setError('');
    client.titlePolicy(workspace).then(value => {
      if (disposed) return;
      setPolicy(value);
      setModelId(value.binding?.model_profile_id ?? '');
      setRequests(value.binding?.max_requests ?? 10);
      setTokens(value.binding?.max_tokens ?? 4000);
      setCost(value.binding?.max_cost_units ?? '');
    }).catch(reason => { if (!disposed) setError(windowError(reason)); });
    return () => { disposed = true; };
  }, [client, workspace]);
  const model = catalog?.models.find(item => item.id === modelId);
  const connection = catalog?.connections.find(item => item.id === model?.connection_id);
  const reconfirm = policy?.binding && (policy.binding.endpoint !== connection?.endpoint
    || policy.binding.connection_version !== connection?.version || policy.binding.model_version !== model?.version);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !policy || policy.workspace_id !== workspace || (modelId && (!model || !connection))) return;
    const form = event.currentTarget;
    setBusy(true); onBusyChange?.(true); setError(''); setSaved(false);
    try {
      const value = await client.saveTitlePolicy(workspace, {
        meta: commandMeta(policy.version ?? null),
        data: { binding: model && connection ? {
          model_profile_id: model.id, model_version: model.version, connection_version: connection.version,
          endpoint: connection.endpoint, max_requests: requests, max_tokens: tokens, max_cost_units: cost || null,
        } : null },
      });
      setPolicy(value);
      setSaved(true);
      onSaved?.(form);
    } catch (reason) { setError(windowError(reason)); }
    finally { setBusy(false); onBusyChange?.(false); }
  }

  return <section aria-label="标题命名" className="mt-4">
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${field}-workspace`}>适用项目</FieldLabel>
        <NativeSelect id={`${field}-workspace`} value={workspace} disabled={busy || !catalog}
          data-settings-search onChange={event => {
            const next = event.target.value;
            if (guard) guard(() => setWorkspace(next)); else setWorkspace(next);
          }}>
          {(catalog?.workspaces ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </NativeSelect>
      </Field>
      {policy?.workspace_id === workspace && <form onSubmit={submit}>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor={`${field}-model`}>标题模型</FieldLabel>
            <NativeSelect id={`${field}-model`} value={modelId} disabled={busy} onChange={event => { setModelId(event.target.value); setSaved(false); }}>
              <option value="">本地规则</option>
              {modelId && !model && <option value={modelId} disabled>原模型已不可用</option>}
              {(catalog?.models ?? []).map(item => <option key={item.id} value={item.id}>{item.display_name ?? item.model_id}</option>)}
            </NativeSelect>
            {connection && <FieldDescription className="wrap-anywhere">目标文字将发送到 {connection.display_name} · {connection.endpoint}。适用于会话、长任务和主动请求的项目名称建议。</FieldDescription>}
            {reconfirm && <FieldDescription>当前模型或连接已变化，重新保存后才允许发送。</FieldDescription>}
          </Field>
          {model && connection && <>
            <Field>
              <FieldLabel htmlFor={`${field}-requests`}>命名请求总数上限</FieldLabel>
              <Input id={`${field}-requests`} type="number" min={1} max={1000} required value={requests}
                onChange={event => setRequests(Number(event.target.value))} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${field}-tokens`}>累计 Token 上限</FieldLabel>
              <Input id={`${field}-tokens`} type="number" min={1} max={1000000} required value={tokens}
                onChange={event => setTokens(Number(event.target.value))} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${field}-cost`}>费用上限（可选，十亿分之一美元）</FieldLabel>
              <Input id={`${field}-cost`} inputMode="numeric" pattern="[0-9]+" value={cost}
                onChange={event => setCost(event.target.value)} />
            </Field>
          </>}
          <Button type="submit" variant="default" className="self-start" disabled={busy || (!!modelId && !connection)}>
            {modelId ? '授权并保存' : '使用本地规则'}
          </Button>
        </FieldGroup>
      </form>}
      {saved && <p role="status">标题设置已保存</p>}
      {error && <p role="alert">{error}</p>}
      {catalog?.workspaces.length === 0 && <FieldDescription>新建项目后可设置标题命名。</FieldDescription>}
    </FieldGroup>
  </section>;
}
