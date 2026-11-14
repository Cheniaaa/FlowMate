import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { mergeVersioned } from '../../api/events';
import type { AgentProfile, AgentProfilePage, ModelConnectionPage, ModelProfilePage } from '../../generated/contracts';
import { assistantIcons as icons } from '../../components/assistant-icons';
import type { EditorLifecycle } from './Settings';

export default function AssistantSettings({ client, onBusyChange, onSaved, onDiscard, onViewReady, guard = action => action() }: { client: RuntimeClient } & EditorLifecycle) {
  const [profiles, setProfiles] = useState<AgentProfilePage>();
  const [models, setModels] = useState<ModelProfilePage>();
  const [connections, setConnections] = useState<ModelConnectionPage>();
  const [selectedId, setSelectedId] = useState('');
  const [modelId, setModelId] = useState<string>();
  const selected = profiles?.items.find(profile => profile.id === selectedId);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const [editRevision, setEditRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useLayoutEffect(() => { if (!busy) onViewReady?.(); }, [selectedId, selected?.version, editRevision, busy, onViewReady]);

  useEffect(() => {
    let ignore = false;
    client.profiles().then(page => {
      if (!ignore) { setProfiles(page); setSelectedId(page.items[0]?.id ?? ''); }
    }).catch(() => { if (!ignore) setError('无法读取助理配置'); });
    client.models().then(page => { if (!ignore) setModels(page); })
      .catch(() => { if (!ignore) setError('无法读取模型配置'); });
    client.connections().then(page => { if (!ignore) setConnections(page); })
      .catch(() => { if (!ignore) setError('无法读取连接配置'); });
    return () => { ignore = true; };
  }, [client]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inflight.current) return;
    const values = new FormData(event.currentTarget);
    const form = event.currentTarget;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setError(''); setStatus('');
    try {
      const data: AgentProfile = {
        id: selected!.id, version: selected!.version,
        display_name: String(values.get('display_name')), icon_id: String(values.get('icon_id')),
        communication_style: String(values.get('communication_style')), instructions: String(values.get('instructions')),
        default_model_profile_id: String(values.get('default_model_profile_id')) || null,
      };
      const saved = await client.saveAgent(data.id, { meta: commandMeta(data.version), data });
      setProfiles(current => ({ ...current!, items: current!.items.map(profile => profile.id === saved.id ? saved : profile) }));
      setModelId(undefined);
      setStatus('助理配置已保存；仅对新运行生效');
      onSaved?.(form);
    } catch (error) {
      setError(error instanceof ApiError ? `${error.code}: ${error.message}` : '助理配置保存失败，请检查 Runtime 状态');
    } finally { inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  async function loadMore(kind: 'profiles' | 'models' | 'connections') {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setError('');
    try {
      if (kind === 'profiles') {
        const next = await client.profiles({ cursor: profiles!.next_cursor! });
        setProfiles(current => ({ ...next, items: Object.values(mergeVersioned(
          Object.fromEntries(current!.items.map(item => [item.id, item])), next.items)) }));
        if (!selectedId) setSelectedId(next.items[0]?.id ?? '');
      } else if (kind === 'models') {
        const next = await client.models({ cursor: models!.next_cursor! });
        setModels(current => ({ ...next, items: Object.values(mergeVersioned(
          Object.fromEntries(current!.items.map(item => [item.id, item])), next.items)) }));
      } else {
        const next = await client.connections({ cursor: connections!.next_cursor! });
        setConnections(current => ({ ...next, items: Object.values(mergeVersioned(
          Object.fromEntries(current!.items.map(item => [item.id, item])), next.items)) }));
      }
    } catch (error) {
      setError(error instanceof ApiError ? `${error.code}: ${error.message}` : '读取下一页配置失败');
    } finally { inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  return <section aria-labelledby="assistant-settings-title">
    <h2 id="assistant-settings-title">主助理设置</h2>
    <p>多个会话共用同一助理身份；修改仅对新运行生效，不改变当前运行的配置快照。</p>
    {error && <p className="status-message" role="alert">{error}</p>}<p className="status-message" role="status">{status}</p>
    {!profiles && !error && <p>正在读取助理配置…</p>}
    {profiles && !profiles.items.length && <p>暂无主助理配置</p>}
    {!!profiles?.items.length && <label>编辑助理 <select value={selectedId} disabled={busy} onChange={event => { const id = event.target.value; guard(() => { setSelectedId(id); setModelId(undefined); setError(''); setStatus(''); }); }}>
      {profiles.items.map(profile => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}
    </select></label>}
    {profiles?.next_cursor && <button className="button" type="button" disabled={busy} onClick={() => loadMore('profiles')}>更多助理</button>}
    {selected && <form className="settings-form" key={`${selected.id}:${selected.version}:${editRevision}`} onSubmit={save} onReset={() => { setModelId(undefined); setEditRevision(value => value + 1); }}>
      <fieldset className="settings-grid" disabled={busy || !models}>
        <legend>共享身份与工作指导</legend>
        <label>显示名称 <input name="display_name" required maxLength={256} defaultValue={selected.display_name} /></label>
        <label>内置图标 <select name="icon_id" required defaultValue={selected.icon_id}>
          {!icons.some(icon => icon.id === selected.icon_id) && <option value={selected.icon_id}>{selected.icon_id}</option>}
          {icons.map(icon => <option key={icon.id} value={icon.id}>{icon.symbol} {icon.label}</option>)}
        </select></label>
        <label>沟通方式 <textarea name="communication_style" defaultValue={selected.communication_style} /></label>
        <label>工作指导 <textarea name="instructions" rows={5} defaultValue={selected.instructions} /></label>
        <label>默认模型 <select name="default_model_profile_id" value={modelId ?? selected.default_model_profile_id ?? ''} onChange={event => setModelId(event.target.value)}>
          <option value="">未指定默认模型</option>
          {selected.default_model_profile_id && !models?.items.some(model => model.id === selected.default_model_profile_id) && <option value={selected.default_model_profile_id}>当前默认模型 · {selected.default_model_profile_id}（尚未加载）</option>}
          {models?.items.map(model => {
            const connection = connections?.items.find(connection => connection.id === model.connection_id);
            return <option key={model.id} value={model.id}>{model.display_name ?? model.model_id} · {connection ? `${connection.display_name} · ${connection.endpoint}` : '连接尚未同步'}</option>;
          })}
        </select></label>
        {models?.next_cursor && <button className="button" type="button" disabled={busy} onClick={() => loadMore('models')}>更多模型</button>}
        {connections?.next_cursor && <button className="button" type="button" disabled={busy} onClick={() => loadMore('connections')}>更多连接</button>}
        <button className="button" type="submit" disabled={busy}>保存助理</button>
        <button className="button" type="button" disabled={busy} onClick={event => { onDiscard?.(event.currentTarget.form!); setEditRevision(value => value + 1); setModelId(undefined); setError(''); setStatus(''); }}>取消编辑</button>
      </fieldset>
    </form>}
  </section>;
}
