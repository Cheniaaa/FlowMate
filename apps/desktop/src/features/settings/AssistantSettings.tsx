import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { mergeVersioned } from '../../api/events';
import type { AgentProfile, AgentProfilePage, ModelConnectionPage, ModelProfilePage, ToolSpecList, SkillPage } from '../../generated/contracts';
import { assistantIcons as icons } from '../../components/assistant-icons';
import type { EditorLifecycle } from './Settings';

export default function AssistantSettings({ client, manageMembers = false, workspaceId, refreshKey, skillsRevision = 0, deferSkillRefresh = false, onBusyChange, onSaved, onDiscard, onViewReady, guard = action => action() }: { client: RuntimeClient; manageMembers?: boolean; workspaceId?: string; refreshKey?: string; skillsRevision?: number; deferSkillRefresh?: boolean } & EditorLifecycle) {
  const [profiles, setProfiles] = useState<AgentProfilePage>();
  const [models, setModels] = useState<ModelProfilePage>();
  const [connections, setConnections] = useState<ModelConnectionPage>();
  const [tools, setTools] = useState<ToolSpecList>();
  const [skillPage, setSkillPage] = useState<{ workspaceId?: string; page: SkillPage }>();
  const skills = skillPage?.workspaceId === workspaceId ? skillPage?.page : undefined;
  const skillQuery = useRef(0);
  const activeWorkspace = useRef(workspaceId);
  activeWorkspace.current = workspaceId;
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [skillSelection, setSkillSelection] = useState<{ key: string; ids: string[] }>();
  const [selectedId, setSelectedId] = useState('');
  const [newProfile, setNewProfile] = useState<AgentProfile>();
  const [modelId, setModelId] = useState<string>();
  const selected = newProfile ?? profiles?.items.find(profile => profile.id === selectedId);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const [editRevision, setEditRevision] = useState(0);
  const formKey = `${selected?.id}:${selected?.version}:${editRevision}`;
  const selectedSkills = skillSelection?.key === formKey ? skillSelection.ids : selected?.skill_ids ?? [];
  const [readRevision, setReadRevision] = useState(0);
  const lastRefreshKey = useRef(refreshKey);
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
    if (manageMembers) client.tools().then(value => { if (!ignore) setTools(value); })
      .catch(() => { if (!ignore) setError('无法读取真实工具目录；现有允许列表仍保留，请重试读取'); });
    return () => { ignore = true; };
  }, [client, manageMembers, readRevision]);
  useEffect(() => {
    if (!manageMembers || deferSkillRefresh) return;
    let ignore = false; ++skillQuery.current;
    client.skills(workspaceId ? { scope_kind: 'workspace', workspace_id: workspaceId } : { scope_kind: 'user_global' })
      .then(page => { if (!ignore) setSkillPage({ workspaceId, page }); })
      .catch(() => { if (!ignore) setError('无法读取 Skill 目录；原允许列表保留，请刷新后核对'); });
    return () => { ignore = true; };
  }, [client, manageMembers, workspaceId, readRevision, skillsRevision, deferSkillRefresh]);
  useEffect(() => {
    if (!refreshKey || newProfile || lastRefreshKey.current === refreshKey) return;
    let ignore = false;
    client.profiles().then(page => { if (!ignore) { lastRefreshKey.current = refreshKey; setProfiles(current => current ? { ...current, watermark: page.watermark,
      items: Object.values(mergeVersioned(Object.fromEntries(current.items.map(item => [item.id, item])), page.items)) } : page); } })
      .catch(() => { if (!ignore) setError('助理配置刷新失败，请显式刷新后核对'); });
    return () => { ignore = true; };
  }, [client, refreshKey, !!newProfile]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inflight.current) return;
    const values = new FormData(event.currentTarget);
    const form = event.currentTarget;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setError(''); setStatus('');
    try {
      const data: AgentProfile = {
        ...selected!,
        display_name: String(values.get('display_name')), icon_id: String(values.get('icon_id')),
        communication_style: String(values.get('communication_style')), instructions: String(values.get('instructions')),
        default_model_profile_id: String(values.get('default_model_profile_id')) || null,
        delegatable: manageMembers ? values.has('delegatable') : selected!.delegatable,
        allowed_tools: manageMembers && tools ? values.getAll('allowed_tools').map(String) : selected!.allowed_tools,
        skill_ids: manageMembers ? selectedSkills : selected!.skill_ids,
      };
      const saved = await client.saveAgent(data.id, { meta: commandMeta(newProfile ? null : data.version), data });
      setProfiles(current => ({ ...current!, items: Object.values(mergeVersioned(Object.fromEntries(current!.items.map(item => [item.id, item])), [saved])) }));
      setNewProfile(undefined); setSelectedId(saved.id);
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
    <h2 id="assistant-settings-title">{manageMembers ? '助理配置' : '主助理设置'}</h2>
    <p>多个会话共用同一助理身份；修改仅对新运行生效，不改变当前运行的配置快照。</p>
    {error && <p className="status-message" role="alert">{error}</p>}<p className="status-message" role="status">{status}</p>
    {!profiles && !error && <p>正在读取助理配置…</p>}
    {profiles && !profiles.items.length && <p>暂无主助理配置</p>}
    {!!profiles?.items.length && <label>编辑助理 <select value={newProfile ? '' : selectedId} disabled={busy} onChange={event => { const id = event.target.value; guard(() => { setNewProfile(undefined); setSelectedId(id); setModelId(undefined); setError(''); setStatus(''); }); }}>
      {newProfile && <option value="">新助理（未保存）</option>}
      {profiles.items.map(profile => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}
    </select></label>}
    {profiles?.next_cursor && <button className="button" type="button" disabled={busy} onClick={() => loadMore('profiles')}>更多助理</button>}
    {manageMembers && profiles && <button type="button" disabled={busy} onClick={() => guard(() => {
      setNewProfile({ id: crypto.randomUUID(), version: 1, display_name: '', icon_id: 'assistant', instructions: '', communication_style: '',
        default_model_profile_id: null, delegatable: false, allowed_tools: [], skill_ids: [] });
      setModelId(undefined); setStatus(''); setError('');
    })}>新建助理</button>}
    {manageMembers && <button type="button" disabled={busy} onClick={() => guard(() => { setNewProfile(undefined); setError(''); setReadRevision(value => value + 1); })}>刷新助理与目录</button>}
    {selected && <form className="settings-form" key={`${selected.id}:${selected.version}:${editRevision}`} onSubmit={save} onReset={() => { setModelId(undefined); setEditRevision(value => value + 1); }}>
      <fieldset className="settings-grid" disabled={busy || !models}>
        <legend>共享身份与工作指导</legend>
        {manageMembers && <p className="muted">Profile <code>{selected.id}</code> · v{selected.version}{newProfile ? ' · 尚未保存' : ''}</p>}
        <label>显示名称 <input name="display_name" required maxLength={256} defaultValue={selected.display_name} /></label>
        <label>内置图标 <select name="icon_id" required defaultValue={selected.icon_id}>
          {!icons.some(icon => icon.id === selected.icon_id) && <option value={selected.icon_id}>{selected.icon_id}</option>}
          {icons.map(icon => <option key={icon.id} value={icon.id}>{icon.symbol} {icon.label}</option>)}
        </select></label>
        <label>沟通方式 <textarea name="communication_style" defaultValue={selected.communication_style} /></label>
        <label>工作指导 <textarea name="instructions" rows={5} defaultValue={selected.instructions} /></label>
        {manageMembers && <><label className="checkbox-label"><input name="delegatable" type="checkbox" defaultChecked={selected.delegatable} />允许作为委派成员</label>
          <p className="muted">可委派成员必须明确选择默认模型。成员能力不等于资料外发或文件写出许可。</p>
          {tools ? <fieldset className="member-tools"><legend>成员允许工具（能力上界）</legend>
            {tools.map(tool => <label className="checkbox-label" key={tool.name}><input type="checkbox" name="allowed_tools" value={tool.name} defaultChecked={selected.allowed_tools.includes(tool.name)} />{tool.name} · v{tool.version}</label>)}
            {selected.allowed_tools.filter(name => !tools.some(tool => tool.name === name)).map(name => <label className="checkbox-label" key={name}><input type="checkbox" name="allowed_tools" value={name} defaultChecked />{name}（当前未装配，保留配置不代表可执行）</label>)}
            {!tools.length && <p>当前目录没有业务工具。</p>}
          </fieldset> : <p>工具目录未就绪；保存其他字段会保留原允许列表。</p>}
          {skills ? <fieldset><legend>成员允许 Skill（新运行固定实际版本）</legend>
            {skills.items.filter(item => item.binding?.enabled && item.readiness === 'content_available').map(item => <label key={item.version.skill_id}>
              <input type="checkbox" name="skill_ids" value={item.version.skill_id} checked={selectedSkills.includes(item.version.skill_id)}
                onChange={event => setSkillSelection({ key: formKey, ids: event.target.checked
                  ? [...selectedSkills, item.version.skill_id] : selectedSkills.filter(id => id !== item.version.skill_id) })} />
              {item.version.name} · {item.version.content_hash.slice(0, 12)}</label>)}
            {selectedSkills.filter(id => !skills.items.some(item => item.version.skill_id === id && item.binding?.enabled && item.readiness === 'content_available'))
              .map(id => <label key={id}><input type="checkbox" name="skill_ids" value={id} checked
                onChange={() => setSkillSelection({ key: formKey, ids: selectedSkills.filter(value => value !== id) })} />Skill {id}（当前不可选，保留原配置）</label>)}
            {skills.next_cursor && <button type="button" disabled={busy || loadingSkills} onClick={async () => {
              const query = skillQuery.current; setLoadingSkills(true);
              try {
                const next = await client.skills(workspaceId
                  ? { scope_kind: 'workspace', workspace_id: workspaceId, cursor: skills.next_cursor! }
                  : { scope_kind: 'user_global', cursor: skills.next_cursor! });
                if (query === skillQuery.current && workspaceId === activeWorkspace.current) setSkillPage(current => ({
                  workspaceId, page: { ...next, items: [...current!.page.items, ...next.items] },
                }));
              }
              catch { setError('Skill 续页读取失败，原允许列表保留'); }
              finally { setLoadingSkills(false); }
            }}>更多允许 Skill</button>}
          </fieldset> : <p>Skill 目录未就绪；保留原有 {selected.skill_ids.length} 项。</p>}</>}
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
