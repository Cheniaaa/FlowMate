import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { mergeVersioned } from '../../api/events';
import type { ModelConnection, ModelConnectionPage, ProviderPresetList } from '../../generated/contracts';
import type { EditorLifecycle } from './Settings';
import ModelSettings from './ModelSettings';

export default function ConnectionSettings({ client, onBusyChange, onSaved, onDiscard, onViewReady, guard = action => action() }: { client: RuntimeClient } & EditorLifecycle) {
  const [connections, setConnections] = useState<ModelConnectionPage>();
  const [selectedId, setSelectedId] = useState('');
  const selected = connections?.items.find(connection => connection.id === selectedId);
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState<boolean>();
  const [credentialRetry, setCredentialRetry] = useState(false);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const [editRevision, setEditRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [presets, setPresets] = useState<ProviderPresetList>([]);
  const [presetId, setPresetId] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => { if (!busy) onViewReady?.(); }, [selectedId, selected?.version, editRevision, editing, modelsOpen, busy, onViewReady]);

  useEffect(() => {
    let ignore = false;
    client.connections().then(page => { if (!ignore) setConnections(page); })
      .catch(() => { if (!ignore) setError('无法读取连接配置'); });
    client.providerPresets().then(value => { if (!ignore) setPresets(value); }).catch(() => { if (!ignore) setError('无法读取提供商预设；请刷新后重试'); });
    return () => { ignore = true; };
  }, [client]);

  useEffect(() => { setPresetId(selected?.provider_preset_id ?? ''); }, [selectedId, selected?.version, editRevision]);

  useEffect(() => {
    let ignore = false;
    setConfigured(undefined);
    if (selected?.secret_ref) {
      invoke<{ configured: boolean }>('credential_status', { secret_ref: selected.secret_ref })
        .then(value => { if (!ignore) setConfigured(value.configured); })
        .catch(() => { if (!ignore) setError('无法读取系统凭据状态'); });
    } else setConfigured(false);
    return () => { ignore = true; };
  }, [selected?.secret_ref, selected?.version]);

  async function saveCredential(connection: ModelConnection, value: string) {
    await invoke('save_credential', { binding: { connection_id: connection.id, connection_version: connection.version,
      protocol: connection.protocol, endpoint: connection.endpoint, secret_ref: connection.secret_ref }, value });
    setConfigured(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (credentialRetry) { if (key) await retryCredential(); else setError('连接已保存，请重新输入 Key 后只补凭据'); return; }
    if (inflight.current) return;
    const values = new FormData(event.currentTarget);
    const form = event.currentTarget;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setKey(''); setError(''); setStatus('');
    let saved: ModelConnection | undefined;
    try {
      const endpoint = String(values.get('endpoint'));
      const protocol = String(values.get('protocol')) as ModelConnection['protocol'];
      const sameDestination = selected?.endpoint === endpoint && selected.protocol === protocol;
      const secret_ref = sameDestination ? selected.secret_ref ?? (key ? crypto.randomUUID() : null)
        : selected || key ? crypto.randomUUID() : null;
      const data: ModelConnection = { id: selected?.id ?? crypto.randomUUID(), version: selected?.version ?? 1,
        display_name: String(values.get('display_name')), protocol, endpoint, secret_ref,
        provider_preset_id: presetId || null };
      saved = await client.saveConnection(data.id, { meta: commandMeta(selected?.version ?? null), data });
      if (key) await saveCredential(saved, key);
      setCredentialRetry(false);
      setStatus('连接已保存；仅对新运行生效');
      onSaved?.(form);
    } catch (error) {
      // 宿主异常可能包含刚录入的密钥，不回显其原始内容。
      if (saved) {
        setCredentialRetry(true);
        setError('连接已保存，凭据未配置或替换失败；请重新输入 Key 后重试凭据');
      } else setError(error instanceof ApiError ? `${error.code}: ${error.message}` : '连接保存失败，请检查配置和 Runtime 状态');
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
    } catch { setError('连接已保存，凭据未配置或替换失败；请重新输入 Key 后重试凭据'); }
    finally { setKey(''); inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  async function clearCredential() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setKey(''); setError(''); setStatus('');
    try {
      const value = await invoke<{ configured: boolean }>('clear_credential', { secret_ref: selected!.secret_ref });
      setConfigured(value.configured); setCredentialRetry(false); setStatus('系统凭据已清除；后续请求不能沿用旧值');
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
    } catch (error) { setError(error instanceof ApiError ? `${error.code}: ${error.message}` : '读取下一页连接失败'); }
    finally { inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  function select(id: string) { guard(() => { setKey(''); setCredentialRetry(false); setSelectedId(id); setEditing(true); setModelsOpen(false); setError(''); setStatus(''); }); }
  const preset = presets.find(item => item.id === presetId);
  return <section aria-labelledby="connection-settings-title">
    <h2 id="connection-settings-title">{modelsOpen ? selected?.display_name : '连接设置'}</h2>
    <p className="muted">{modelsOpen ? `${selected?.protocol === 'openai_compatible' ? 'OpenAI compatible' : 'Anthropic'} · ${selected?.endpoint}` : '同一连接的模型共用系统凭据。保存配置不代表已测试连接。'}</p>
    {error && <p className="status-message" role="alert">{error}</p>}<p className="status-message" role="status">{status}</p>
    {!editing ? <><div className="settings-search"><label>搜索连接 <input value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      <div className="provider-grid">{connections?.items.filter(item => `${item.display_name} ${item.endpoint}`.toLowerCase().includes(search.toLowerCase())).map(item => <button className="provider-card" key={item.id} onClick={() => select(item.id)}><strong>{item.display_name}</strong><span>{item.protocol === 'openai_compatible' ? 'OpenAI compatible' : 'Anthropic'}</span><span>{item.endpoint}</span><span>{item.secret_ref ? '凭据绑定已保存，进入详情查询状态' : '尚无凭据绑定'}</span></button>)}
        <button className="provider-card provider-card--add" aria-label="新建连接" disabled={busy || !connections} onClick={() => select('')}><strong aria-hidden="true">＋</strong><span>新建连接</span></button>
      </div></>
      : <><button disabled={busy} onClick={() => guard(() => { setKey(''); setEditing(false); setModelsOpen(false); })}>返回连接列表</button>
      {!modelsOpen && <label>编辑连接 <select value={selectedId} disabled={busy || !connections} onChange={event => select(event.target.value)}><option value="">新建连接</option>{connections?.items.map(connection => <option key={connection.id} value={connection.id}>{connection.display_name} · {connection.endpoint}</option>)}</select></label>}
      {selected && <button disabled={busy} onClick={() => guard(() => { setKey(''); setModelsOpen(value => !value); })}>{modelsOpen ? '连接详情' : '模型设置'}</button>}</>}
    {connections?.next_cursor && <button className="button" disabled={busy} onClick={loadMore}>更多连接</button>}
    {editing && !modelsOpen && <form ref={formRef} key={`${selectedId}:${selected?.version ?? 'new'}:${editRevision}`} className="settings-form" onSubmit={save} onReset={() => { setKey(''); setEditRevision(value => value + 1); }}>
      <fieldset className="settings-grid" disabled={busy || !connections || credentialRetry}>
        <legend>服务连接</legend>
        <label>提供商预设 <select value={presetId} onChange={event => {
          setPresetId(event.target.value); const preset = presets.find(item => item.id === event.target.value);
          if (preset) { const fields = formRef.current!.elements; (fields.namedItem('endpoint') as HTMLInputElement).value = preset.default_endpoint; (fields.namedItem('protocol') as HTMLSelectElement).value = preset.protocol; const name = fields.namedItem('display_name') as HTMLInputElement; if (!name.value) name.value = preset.display_name; }
        }}><option value="">自定义连接</option>{presets.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
        {preset && <p>官方预设来源：{preset.source_url} · {preset.source_version} · {preset.verified_at} · 认证方式：API Key。目录核验不等于已验证你的连接。</p>}
        <label>连接名称 <input name="display_name" required maxLength={256} defaultValue={selected?.display_name ?? ''} /></label>
        <label>协议 <select name="protocol" required defaultValue={selected?.protocol ?? ''} onChange={() => setPresetId('')}>
          <option value="" disabled>请选择协议</option><option value="openai_compatible">OpenAI compatible（Chat Completions）</option><option value="anthropic">Anthropic</option>
        </select></label>
        <label>Endpoint <input name="endpoint" type="url" required defaultValue={selected?.endpoint ?? ''} onChange={() => setPresetId('')} /></label>
        <p>Endpoint 是明确的 SDK base URL；修改地址或协议使用新的 secret_ref，不复制旧密钥。</p>
      </fieldset>
      <fieldset className="settings-grid" disabled={busy || !connections}>
        <legend>系统凭据</legend>
        <p>凭据状态：{configured === undefined ? '查询中' : configured ? '已配置' : '未配置'}。已有密钥不会读回。</p>
        <label>API Key（仅保存到系统凭据） <input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} /></label>
        <button className="button" type="submit" disabled={busy || credentialRetry}>保存连接</button>
        {credentialRetry && <button className="button" type="button" disabled={busy || !key} onClick={retryCredential}>重试保存凭据</button>}
        <button className="button" type="button" disabled={busy} onClick={() => { onDiscard?.(formRef.current!); setKey(''); setCredentialRetry(false); setEditRevision(value => value + 1); setError(''); setStatus(''); }}>取消编辑</button>
        <button className="button" type="button" disabled={busy || !selected?.secret_ref || !configured} onClick={clearCredential}>清除系统凭据</button>
      </fieldset>
    </form>}
    {editing && modelsOpen && selected && <ModelSettings client={client} connection={selected} onBusyChange={value => { setBusy(value); onBusyChange?.(value); }} onSaved={onSaved} onDiscard={onDiscard} onViewReady={onViewReady} guard={guard} />}
  </section>;
}
