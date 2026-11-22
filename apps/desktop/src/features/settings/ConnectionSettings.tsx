import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { mergeVersioned } from '../../api/events';
import type { ModelConnection, ModelConnectionPage, ModelDiscoveryResult, ProviderPresetList } from '../../generated/contracts';
import type { EditorLifecycle } from './Settings';
import ModelSettings from './ModelSettings';
import { Button } from '../../components/ui/button';
import { FieldLabel, FieldLegend } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import IconButton, { UiIcon } from '../../components/IconButton';
import SettingsConflict, { useSettingsConflict } from './SettingsConflict';

const protocolNames: Record<ModelConnection['protocol'], string> = {
  openai_compatible: 'OpenAI Chat Completions',
  openai_responses: 'OpenAI Responses',
  anthropic: 'Anthropic Messages',
};
type ConnectionFields = Pick<ModelConnection, 'display_name' | 'endpoint' | 'protocol' | 'provider_preset_id'>;

export default function ConnectionSettings({ client, initialConnectionId, onBusyChange, onSaved, onDiscard, onViewReady, guard = action => action() }: { client: RuntimeClient; initialConnectionId?: string } & EditorLifecycle) {
  const [connections, setConnections] = useState<ModelConnectionPage>();
  const [selectedId, setSelectedId] = useState(initialConnectionId ?? '');
  const selected = connections?.items.find(connection => connection.id === selectedId);
  const [key, setKey] = useState('');
  const [credentialStatus, setCredentialStatus] = useState<{ connection: ModelConnection; configured: boolean }>();
  const [credentialRetry, setCredentialRetry] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const [editRevision, setEditRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(Boolean(initialConnectionId));
  const [modelsOpen, setModelsOpen] = useState(false);
  const [discovery, setDiscovery] = useState<ModelDiscoveryResult>();
  const [discoveryError, setDiscoveryError] = useState('');
  const [search, setSearch] = useState('');
  const [presets, setPresets] = useState<ProviderPresetList>([]);
  const [presetId, setPresetId] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const recovery = useSettingsConflict<ModelConnection, ConnectionFields>(inflight, setBusy, onBusyChange, (original, draft, latest, choose) => ({
    display_name: choose('连接名称', original.display_name, draft.display_name, latest.display_name),
    endpoint: choose('服务地址', original.endpoint, draft.endpoint, latest.endpoint),
    protocol: choose('协议', original.protocol, draft.protocol, latest.protocol, value => protocolNames[value]),
    provider_preset_id: choose('提供商预设', original.provider_preset_id, draft.provider_preset_id, latest.provider_preset_id,
      value => presets.find(preset => preset.id === value)?.display_name ?? '自定义连接'),
  }));
  const { conflict } = recovery;
  const currentConnection = recovery.latestBase ?? selected;
  const draft = recovery.editing?.draft ?? selected;
  const formKey = `${selectedId}:${recovery.editing?.base.version ?? selected?.version}:${editRevision}:${!!recovery.editing}`;
  const configured = !currentConnection?.secret_ref ? false
    : credentialStatus?.connection.id === currentConnection.id && credentialStatus.connection.version === currentConnection.version &&
      credentialStatus.connection.secret_ref === currentConnection.secret_ref ? credentialStatus.configured : undefined;
  useLayoutEffect(() => { if (!busy) onViewReady?.(); }, [formKey, editing, modelsOpen, busy, onViewReady]);

  useEffect(() => {
    let ignore = false;
    client.connections().then(async page => {
      if (initialConnectionId && !page.items.some(item => item.id === initialConnectionId)) {
        const target = await client.modelConnection(initialConnectionId);
        page = { ...page, items: [...page.items, target] };
      }
      if (!ignore) {
        setConnections(page);
        if (initialConnectionId) { setSelectedId(initialConnectionId); setEditing(true); }
      }
    })
      .catch(() => { if (!ignore) setError('无法读取连接配置'); });
    client.providerPresets().then(value => { if (!ignore) setPresets(value); }).catch(() => { if (!ignore) setError('无法读取提供商预设；请刷新后重试'); });
    return () => { ignore = true; };
  }, [client, initialConnectionId]);

  useEffect(() => { setPresetId(draft?.provider_preset_id ?? ''); }, [formKey]);

  useEffect(() => {
    let ignore = false;
    if (currentConnection?.secret_ref) {
      invoke<{ configured: boolean }>('credential_status', { secret_ref: currentConnection.secret_ref })
        .then(value => { if (!ignore) setCredentialStatus({ connection: currentConnection, configured: value.configured }); })
        .catch(() => { if (!ignore) setError('无法读取系统凭据状态'); });
    }
    return () => { ignore = true; };
  }, [currentConnection?.id, currentConnection?.secret_ref, currentConnection?.version]);

  async function saveCredential(connection: ModelConnection, value: string) {
    await invoke('save_credential', { binding: { kind: 'model', connection_id: connection.id, connection_version: connection.version,
      protocol: connection.protocol, endpoint: connection.endpoint, secret_ref: connection.secret_ref }, value });
    setCredentialStatus({ connection, configured: true });
  }

  async function discover(connection: ModelConnection) {
    setDiscovery(undefined); setDiscoveryError('');
    try { setDiscovery(await client.discoverConnection(connection.id)); }
    catch { setDiscoveryError('连接已保存，暂时无法读取型号列表；可在模型设置中刷新'); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inflight.current || (conflict && !recovery.merged)) return;
    if (credentialRetry) { if (key) await retryCredential(); else setError('连接已保存，请重新输入 Key 后只补凭据'); return; }
    const base = currentConnection;
    const values = new FormData(event.currentTarget);
    const form = event.currentTarget;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setKey(''); setError(''); setStatus('');
    let saved: ModelConnection | undefined;
    const fields = recovery.merged ?? {
      display_name: String(values.get('display_name')), endpoint: String(values.get('endpoint')),
      protocol: String(values.get('protocol')) as ModelConnection['protocol'], provider_preset_id: presetId || null,
    };
    const sameDestination = base?.endpoint === fields.endpoint && base.protocol === fields.protocol;
    const secret_ref = sameDestination ? base.secret_ref ?? (key ? crypto.randomUUID() : null)
      : base || key ? crypto.randomUUID() : null;
    const data: ModelConnection = {
      ...fields, id: base?.id ?? crypto.randomUUID(), version: base?.version ?? 1, secret_ref,
    };
    try {
      saved = await client.saveConnection(data.id, { meta: commandMeta(base?.version ?? null), data });
      recovery.clear();
      if (key) await saveCredential(saved, key);
      setCredentialRetry(false);
      setStatus('连接已保存；仅对新运行生效');
      onSaved?.(form);
      await discover(saved);
    } catch (error) {
      // 宿主异常可能包含刚录入的密钥，不回显其原始内容。
      if (saved) {
        setCredentialRetry(true);
        setError('连接已保存，凭据未配置或替换失败；请重新输入 Key 后重试凭据');
      } else if (!recovery.capture(error, base, fields)) {
        setError(error instanceof ApiError ? error.message : '连接保存失败，请检查配置和 Runtime 状态');
      }
    } finally {
      setKey('');
      if (saved) {
        const current = saved;
        setConnections(page => ({ ...page!, items: Object.values(mergeVersioned(
          Object.fromEntries(page!.items.map(item => [item.id, item])), [current])) }));
        setSelectedId(current.id);
      }
      inflight.current = false;
      setBusy(false); onBusyChange?.(false);
    }
  }

  async function retryCredential() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setKey(''); setError(''); setStatus('');
    try {
      await saveCredential(selected!, key);
      setCredentialRetry(false); setStatus('系统凭据已保存');
      onSaved?.(formRef.current!);
      await discover(selected!);
    } catch { setError('连接已保存，凭据未配置或替换失败；请重新输入 Key 后重试凭据'); }
    finally { setKey(''); inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  async function clearCredential() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setKey(''); setError(''); setStatus('');
    try {
      const value = await invoke<{ configured: boolean }>('clear_credential', { secret_ref: selected!.secret_ref });
      setCredentialStatus({ connection: selected!, configured: value.configured });
      setCredentialRetry(false); setStatus('系统凭据已清除；后续请求不能沿用旧值');
      setDiscovery(undefined); setDiscoveryError('');
    } catch { setError('清除系统凭据失败'); }
    finally { inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  async function loadMore() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setError('');
    try {
      const next = await client.connections({ cursor: connections!.next_cursor! });
      setConnections(current => ({ ...next, items: Object.values(mergeVersioned(
        Object.fromEntries(current!.items.map(item => [item.id, item])), next.items)) }));
    } catch (error) { setError(error instanceof ApiError ? error.message : '读取下一页连接失败'); }
    finally { inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  function select(id: string) { guard(() => { setKey(''); setCredentialRetry(false); setSelectedId(id); setEditing(true); setModelsOpen(false); setDiscovery(undefined); setDiscoveryError(''); recovery.clear(); setError(''); setStatus(''); }); }
  function resetDraft() {
    const latest = recovery.latestBase;
    if (latest) setConnections(current => ({ ...current!, items: Object.values(mergeVersioned(
      Object.fromEntries(current!.items.map(item => [item.id, item])), [latest])) }));
    recovery.clear(); setKey(''); setCredentialRetry(false); setEditRevision(value => value + 1); setError(''); setStatus('');
  }

  const preset = presets.find(item => item.id === presetId);
  return <section aria-labelledby="connection-settings-title" className="flex min-w-0 flex-col items-start gap-3 [overflow-wrap:anywhere]">
    <header className="flex w-full flex-wrap items-center justify-between gap-2">
      <h2 id="connection-settings-title">{editing ? currentConnection?.display_name ?? '新建连接' : '连接与模型'}</h2>
      {!editing && <Button variant="outline" size="sm" disabled={busy || !connections} onClick={() => select('')}>
        <UiIcon name="add" />新建连接
      </Button>}
    </header>
    {editing && currentConnection ? <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">{protocolNames[currentConnection.protocol]} · {currentConnection.endpoint}</p>
      <p className="text-sm" role="status">凭据状态：{configured === undefined ? '待确认' : configured ? '已配置' : '未配置'}</p>
    </div> : <p className="muted">同一连接的模型共用系统凭据。保存配置不代表已测试连接。</p>}
    {error && <p className="status-message" role="alert">{error}</p>}<p className="status-message" role="status">{status}</p>
    {editing && !modelsOpen && discovery && <section aria-label="连接型号列表">
      <p role={discovery.status === 'authentication_error' ? 'alert' : 'status'}>{discovery.message}</p>
      {discovery.cached && <p>当前显示此连接上次成功读取的列表</p>}
      {discovery.items.length > 0 && <Button disabled={busy} onClick={() => guard(() => { recovery.clear(); setModelsOpen(true); })}>选择本站型号（{discovery.items.length}）</Button>}
    </section>}
    {editing && !modelsOpen && discoveryError && <p role="alert">{discoveryError}</p>}
    {!editing ? <><div className="settings-search w-full"><FieldLabel>搜索连接 <Input data-settings-search value={search} onChange={event => setSearch(event.target.value)} /></FieldLabel></div>
       <div className="provider-grid connection-card-grid">{connections?.items.filter(item => `${item.display_name} ${item.endpoint}`.toLowerCase().includes(search.toLowerCase())).map(item =>
        <Button className="provider-card min-h-27 flex-col items-start justify-start gap-1 px-3 py-2.5 text-start whitespace-normal wrap-anywhere" key={item.id} onClick={() => select(item.id)}>
          <strong>{item.display_name}</strong><span className="text-xs text-muted-foreground">{protocolNames[item.protocol]}</span>
          <span className="max-w-full truncate text-xs text-muted-foreground" title={item.endpoint}>{item.endpoint}</span>
          <span className="text-xs text-muted-foreground">{item.secret_ref ? '已绑定凭据，可在详情查看状态' : '尚无凭据绑定'}</span>
        </Button>)}
      </div></>
      : <div className="button-row connection-toolbar items-end"><IconButton icon="back" label="返回连接列表" disabled={busy} onClick={() => guard(() => { setKey(''); recovery.clear(); setEditing(false); setModelsOpen(false); })} />
      {!modelsOpen && <FieldLabel>编辑连接 <NativeSelect value={selectedId} disabled={busy || !connections} onChange={event => select(event.target.value)}>
        <NativeSelectOption value="">新建连接</NativeSelectOption>
        {connections?.items.map(connection => <NativeSelectOption key={connection.id} value={connection.id}>{connection.display_name} · {connection.endpoint}</NativeSelectOption>)}
      </NativeSelect></FieldLabel>}
      {selected && <Button disabled={busy} onClick={() => guard(() => { setKey(''); recovery.clear(); setModelsOpen(value => !value); })}>{modelsOpen ? '连接详情' : '模型设置'}</Button>}</div>}
    {connections?.next_cursor && <Button disabled={busy || !!conflict} onClick={loadMore}>更多连接</Button>}
    {editing && !modelsOpen && conflict && <SettingsConflict label="连接"
      latest={conflict.latest && `${conflict.latest.display_name} · ${conflict.latest.endpoint} · ${protocolNames[conflict.latest.protocol]}`}
      {...recovery} error={conflict.error} busy={busy} onRead={() => void recovery.read(() => client.modelConnection(selectedId))} />}
    {editing && !modelsOpen && <form ref={formRef} className="settings-form w-full" onSubmit={save} onReset={resetDraft}>
       <fieldset className="settings-grid" key={formKey} disabled={busy || !connections || credentialRetry || !!conflict}>
        <FieldLegend>服务连接</FieldLegend>
        <FieldLabel>提供商预设 <NativeSelect value={presetId} onChange={event => {
          setPresetId(event.target.value); const preset = presets.find(item => item.id === event.target.value);
          if (preset) { const fields = formRef.current!.elements; (fields.namedItem('endpoint') as HTMLInputElement).value = preset.default_endpoint; (fields.namedItem('protocol') as HTMLSelectElement).value = preset.protocol; const name = fields.namedItem('display_name') as HTMLInputElement; if (!name.value) name.value = preset.display_name; }
        }}>
          <NativeSelectOption value="">自定义连接</NativeSelectOption>
          {presets.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.display_name}</NativeSelectOption>)}
        </NativeSelect></FieldLabel>
        {preset && <details className="rounded-md border border-border p-3"><summary className="cursor-pointer">预设来源详情</summary><p>官方来源：{preset.source_url} · 核验于 {preset.verified_at}</p></details>}
        <FieldLabel>连接名称 <Input name="display_name" required maxLength={256} defaultValue={draft?.display_name ?? ''} /></FieldLabel>
        <FieldLabel>协议 <NativeSelect name="protocol" required defaultValue={draft?.protocol ?? 'openai_compatible'} onChange={() => setPresetId('')}>
          {Object.entries(protocolNames).map(([protocol, title]) => <NativeSelectOption key={protocol} value={protocol}>{title}</NativeSelectOption>)}
        </NativeSelect></FieldLabel>
        <FieldLabel>Endpoint <Input name="endpoint" type="url" required placeholder="https://api.example.com/v1" aria-describedby="connection-endpoint-help" defaultValue={draft?.endpoint ?? ''} onChange={() => setPresetId('')} /></FieldLabel>
        <p id="connection-endpoint-help">填写服务商提供的 API 基础地址，例如 https://api.example.com/v1；也可填写对应协议的完整请求地址。</p>
        <p>请确认接收消息和附件的服务地址。更改地址后需为新地址重新保存 API Key。</p>
      </fieldset>
       <fieldset className="settings-grid" disabled={busy || !connections || !!conflict}>
        <FieldLegend>系统凭据</FieldLegend>
         <p>{conflict ? '合并连接后可为保存的地址重新输入 API Key。' : '已有密钥不会读回。'}</p>
        <FieldLabel>API Key（仅保存到系统凭据） <Input type="password" autoComplete="off" aria-invalid={credentialRetry || undefined} aria-describedby={credentialRetry ? 'credential-field-error' : undefined} value={key} onChange={event => setKey(event.target.value)} /></FieldLabel>
        {credentialRetry && <p id="credential-field-error" role="alert">凭据尚未保存。请重新输入此地址的 API Key 后重试保存凭据。</p>}
       </fieldset>
       <div className="settings-form-actions button-row">
           <Button type="submit" variant="default" disabled={busy || !connections || credentialRetry || (!!conflict && !recovery.merged)}>{recovery.latestBase ? '保存合并后的连接' : '保存连接'}</Button>
          {credentialRetry && <Button disabled={busy || !key} onClick={retryCredential}>重试保存凭据</Button>}
           <Button type="button" variant="outline" disabled={busy} onClick={() => {
            onDiscard?.(formRef.current!);
            resetDraft();
          }}>取消编辑</Button>
          <Button disabled={busy || !!conflict || !!recovery.editing || !selected?.secret_ref || !configured} onClick={clearCredential}>清除系统凭据</Button>
       </div>
    </form>}
    {editing && modelsOpen && selected && <ModelSettings client={client} connection={selected}
      initialDiscovery={discovery?.connection_id === selected.id && discovery.connection_version === selected.version ? discovery : undefined}
      onDiscovery={setDiscovery} onCheckConnection={() => guard(() => setModelsOpen(false))}
      onBusyChange={value => { setBusy(value); onBusyChange?.(value); }} onSaved={onSaved} onDiscard={onDiscard} onViewReady={onViewReady} guard={guard} />}
  </section>;
}
