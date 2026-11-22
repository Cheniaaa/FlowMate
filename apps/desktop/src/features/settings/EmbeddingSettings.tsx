import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { validate } from '../../api/validation';
import { windowError } from '../../api/windows';
import type { EmbeddingProfile, EmbeddingProfilePage, EmbeddingProfileView, ModelConnection, SaveEmbeddingProfileCommand } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import type { EditorLifecycle } from './Settings';

const pendingKey = 'flowmate:embedding-profile-save';
function pendingSave() {
  const value = localStorage.getItem(pendingKey);
  return value ? validate('SaveEmbeddingProfileCommand', JSON.parse(value)) : undefined;
}

export default function EmbeddingSettings({ client, refreshKey, onConnections, guard = action => action(), ...lifecycle }: {
  client: RuntimeClient; refreshKey?: string; onConnections?: () => void;
} & EditorLifecycle) {
  const [profiles, setProfiles] = useState<EmbeddingProfilePage>(), [connections, setConnections] = useState<ModelConnection[]>([]);
  const [selected, setSelected] = useState<EmbeddingProfileView | null>(), [editing, setEditing] = useState(() => !!pendingSave());
  const [revision, refresh] = useState(0), [error, setError] = useState(''), [status, setStatus] = useState('');
  useEffect(() => {
    let ignore = false;
    async function read() {
      const [profiles, first] = await Promise.all([client.embeddingProfiles(), client.connections()]);
      const connections = [...first.items]; let cursor = first.next_cursor;
      while (cursor) { const next = await client.connections({ cursor }); connections.push(...next.items); cursor = next.next_cursor; }
      if (!ignore) { setProfiles(profiles); setConnections(connections); }
    }
    void read().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, refreshKey, revision]);
  return <section className="grid min-w-0 gap-4" aria-label="检索模型设置">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="m-0">检索模型</h2>
      <Button disabled={!profiles} onClick={() => guard(() => { setSelected(null); setEditing(true); setStatus(''); })}>新建检索模型</Button>
    </header>
    <p className="m-0 text-sm text-muted-foreground">检索专用型号与对话模型分别配置。复用连接只使用服务地址和已保存的 API Key。</p>
    {onConnections && <Button variant="link" className="justify-self-start" onClick={onConnections}>管理连接与密钥</Button>}
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {profiles?.items.map(profile => <Button key={profile.id} variant="outline" className="h-auto justify-start whitespace-normal text-start"
      onClick={() => guard(() => { void client.embeddingProfile(profile.id, profile.revision).then(view => {
        setSelected(view); setEditing(true); setStatus('');
      }).catch(error => setError(windowError(error))); })}>
      {profile.display_name} · {profile.provider === 'openai' ? '云端（OpenAI 兼容）' : '本地'} · {profile.model_id}
    </Button>)}
    {profiles?.next_cursor && <Button className="justify-self-start" onClick={() => {
      void client.embeddingProfiles({ cursor: profiles.next_cursor! }).then(next => setProfiles({ ...next, items: [...profiles.items, ...next.items] }))
        .catch(error => setError(windowError(error)));
    }}>更多检索模型</Button>}
    {editing && <EmbeddingEditor key={selected?.profile.id ?? 'new'} client={client} view={selected ?? undefined}
      connections={connections.filter(item => item.protocol === 'openai_compatible' || item.protocol === 'openai_responses')}
      {...lifecycle} onComplete={form => {
        lifecycle.onSaved?.(form); setStatus('已保存检索模型；尚未验证服务调用，已有项目继续使用当前配置。');
        setEditing(false); refresh(value => value + 1);
      }} />}
  </section>;
}

function EmbeddingEditor({ client, view, connections, onComplete, onBusyChange, onChanged, onDiscard }: {
  client: RuntimeClient; view?: EmbeddingProfileView; connections: ModelConnection[];
  onComplete: (form: HTMLFormElement) => void;
} & EditorLifecycle) {
  const pending = useRef(pendingSave()), original = view?.profile;
  const [draft, setDraft] = useState<SaveEmbeddingProfileCommand['data']>(() => pending.current?.data ?? {
    display_name: original?.display_name ?? '', provider: original?.provider ?? 'openai',
    model_id: original?.model_id ?? '', dimensions: original?.dimensions ?? 0,
    request_dimensions: original?.request_dimensions ?? false,
    connection_id: original?.connection_id ?? null, local_resource_id: original?.local_resource_id ?? null,
    model_revision: original?.model_revision ?? null, query_prefix: original?.query_prefix ?? '',
    document_prefix: original?.document_prefix ?? '', request_timeout_seconds: original?.request_timeout_seconds,
    pricing: { currency: 'USD', input_per_million: original?.pricing.input_per_million ?? null },
  });
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(!!pending.current);
  const [directoryLabel, setDirectoryLabel] = useState(''), [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null), fieldId = useId(), inflight = useRef(false);
  function edit(change: Partial<typeof draft>) { setDraft(current => ({ ...current, ...change })); }
  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (inflight.current) return;
    const command = pending.current ?? { meta: commandMeta(original?.revision ?? null),
      data: { ...draft, id: original?.id ?? crypto.randomUUID() } };
    inflight.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try {
      validate('SaveEmbeddingProfileCommand', command);
      pending.current = command; localStorage.setItem(pendingKey, JSON.stringify(command));
      await client.saveEmbeddingProfile(command.data.id!, command);
      pending.current = undefined; localStorage.removeItem(pendingKey); setUnknown(false); onComplete(form.current!);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        pending.current = undefined; localStorage.removeItem(pendingKey); setUnknown(false);
      } else setUnknown(!!pending.current);
      setError(windowError(error));
    } finally { inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }
  const connection = connections.find(item => item.id === draft.connection_id);
  return <form ref={form} className="grid gap-3 rounded-lg border border-border p-4" aria-label="编辑检索模型"
    onSubmit={save} onReset={() => { if (!unknown) onDiscard?.(form.current!); }}>
    {view?.destination && <p className="m-0 text-sm">当前配置接收地址：{view.destination}</p>}
    {view?.local_runtime_available !== null && view?.profile.provider === 'fastembed' && <p>
      {view.local_runtime_available ? '本地向量运行库已安装' : '缺少本地向量运行库'}；这不代表模型文件或效果已验证。</p>}
    {error && <p role="alert">{error}</p>}
    <FieldGroup><Field><FieldLabel htmlFor={`${fieldId}-name`}>配置名称</FieldLabel>
      <Input id={`${fieldId}-name`} required disabled={busy || unknown} value={draft.display_name} onChange={event => edit({ display_name: event.target.value })} /></Field>
      <Field><FieldLabel htmlFor={`${fieldId}-provider`}>运行位置</FieldLabel>
        <NativeSelect id={`${fieldId}-provider`} disabled={busy || unknown} value={draft.provider}
          onChange={event => edit({ provider: event.target.value as EmbeddingProfile['provider'], connection_id: null, local_resource_id: null })}>
          <NativeSelectOption value="openai">云端（OpenAI 兼容）</NativeSelectOption><NativeSelectOption value="fastembed">本地</NativeSelectOption>
        </NativeSelect></Field>
      {draft.provider === 'openai' ? <Field><FieldLabel htmlFor={`${fieldId}-connection`}>复用连接</FieldLabel>
        <NativeSelect id={`${fieldId}-connection`} required disabled={busy || unknown} value={draft.connection_id ?? ''}
          onChange={event => edit({ connection_id: event.target.value || null })}>
          <NativeSelectOption value="">请选择兼容的服务连接</NativeSelectOption>
          {connections.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.display_name} · {item.endpoint}</NativeSelectOption>)}
        </NativeSelect>
        <FieldDescription>固定调用服务的 /embeddings 接口。不会选择对话模型，也不需要重复设置聊天协议。</FieldDescription>
        {connection && <FieldDescription>当前连接地址：{connection.endpoint}；保存新修订时固定此连接。</FieldDescription>}
      </Field> : <Field>
        <Button type="button" className="justify-self-start" disabled={busy || unknown} onClick={() => {
          void client.navigation().then(navigation => {
            if (!navigation.default_workspace_id) throw new Error('默认项目不可用，请返回项目页检查。');
            return invoke<{ resources: unknown[] }>('select_resources', {
              scope: { kind: 'workspace', workspace_id: navigation.default_workspace_id, session_id: null }, kind: 'directory',
            });
          })
            .then(value => {
              if (!value.resources.length) return;
              const directory = validate('ResourceRef', value.resources[0]);
              if (directory.id === draft.local_resource_id) return;
              edit({ local_resource_id: directory.id }); setDirectoryLabel(directory.label);
              onChanged?.(form.current!);
            }).catch(error => setError(windowError(error)));
        }}>选择本地模型目录</Button>
        {directoryLabel && <p>{directoryLabel}</p>}
        <FieldDescription>仅使用所选目录中的模型；不会下载模型或改用云端。保存后可查看本地运行库状态。</FieldDescription>
      </Field>}
      <Field><FieldLabel htmlFor={`${fieldId}-model`}>检索专用型号</FieldLabel>
        <Input id={`${fieldId}-model`} required disabled={busy || unknown} placeholder="例如 Qwen/Qwen3-Embedding-4B"
          value={draft.model_id} onChange={event => edit({ model_id: event.target.value })} /></Field>
      <Field><FieldLabel htmlFor={`${fieldId}-dimensions`}>向量维度</FieldLabel>
        <Input id={`${fieldId}-dimensions`} type="number" min={1} step={1} required disabled={busy || unknown}
          placeholder="按该型号支持的维度填写" value={draft.dimensions || ''} onChange={event => edit({ dimensions: event.target.valueAsNumber })} />
        <FieldDescription>用于校验返回长度与索引。硅基流动 Qwen3-Embedding-4B 可按 1024 维生成，需在高级设置明确启用；其他型号请核对服务说明。</FieldDescription></Field>
      <details><summary className="cursor-pointer">高级设置</summary><FieldGroup className="mt-3">
        {draft.provider === 'openai' && <FieldGroup>
          <Field orientation="horizontal" data-disabled={busy || unknown}>
            <Checkbox id={`${fieldId}-request-dimensions`} disabled={busy || unknown} checked={draft.request_dimensions ?? false}
              onCheckedChange={checked => edit({ request_dimensions: checked === true })} />
            <FieldLabel htmlFor={`${fieldId}-request-dimensions`}>按指定维度生成（需模型支持）</FieldLabel>
          </Field>
          <FieldDescription>默认不发送维度参数，使用模型原生维度。仅在服务明确支持时启用；返回长度仍须与上方维度一致。</FieldDescription>
        </FieldGroup>}
        {([['query_prefix', '查询前缀'], ['document_prefix', '文档前缀'], ['model_revision', '模型修订']] as const).map(([key, label]) =>
          <Field key={key}><FieldLabel htmlFor={`${fieldId}-${key}`}>{label}</FieldLabel>
            <Input id={`${fieldId}-${key}`} disabled={busy || unknown} value={draft[key] ?? ''} onChange={event => edit({ [key]: event.target.value || (key === 'model_revision' ? null : '') })} /></Field>)}
        <Field><FieldLabel htmlFor={`${fieldId}-timeout`}>请求超时（秒）</FieldLabel><Input id={`${fieldId}-timeout`} type="number" min="0.001" step="any"
          disabled={busy || unknown} value={draft.request_timeout_seconds ?? ''} onChange={event => edit({ request_timeout_seconds: event.target.value ? event.target.valueAsNumber : undefined })} /></Field>
        {draft.provider === 'openai' && <Field><FieldLabel htmlFor={`${fieldId}-price`}>自定义输入单价（USD/百万输入 token，可选）</FieldLabel>
          <Input id={`${fieldId}-price`} inputMode="decimal" pattern="(0|[1-9][0-9]*)([.][0-9]+)?" disabled={busy || unknown}
            value={draft.pricing?.input_per_million ?? ''} onChange={event => edit({ pricing: { currency: 'USD', input_per_million: event.target.value || null } })} />
          <FieldDescription>默认按官方价格目录精确匹配；无法匹配时费用未知，不视为免费。仅自定义服务需要填写。</FieldDescription>
        </Field>}
      </FieldGroup></details>
    </FieldGroup>
    {unknown ? <section><p>保存结果待核对，可重试。</p>
      <Button type="button" disabled={busy} onClick={() => void save()}>重试</Button></section>
      : <Button type="submit" variant="default" className="justify-self-start" disabled={busy
        || !draft.model_id || !draft.display_name || !Number.isInteger(draft.dimensions) || draft.dimensions < 1
        || (draft.provider === 'openai' ? !draft.connection_id : !draft.local_resource_id)}>保存检索模型</Button>}
  </form>;
}
