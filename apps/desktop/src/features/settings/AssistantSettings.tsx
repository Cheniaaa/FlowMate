import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { mergeVersioned } from '../../api/events';
import type { AgentProfile, AgentProfilePage, ModelConnectionPage, ModelProfilePage, ToolSpecList, SkillPage } from '../../generated/contracts';
import { assistantIcons as icons } from '../../components/assistant-icons';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { FieldLabel, FieldLegend } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { Textarea } from '../../components/ui/textarea';
import type { EditorLifecycle } from './Settings';
import SettingsConflict, { findSetting, useSettingsConflict } from './SettingsConflict';

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
  const [modelChoice, setModelChoice] = useState<{ key: string; id: string }>();
  const selected = newProfile ?? profiles?.items.find(profile => profile.id === selectedId);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const [editRevision, setEditRevision] = useState(0);
  const [readRevision, setReadRevision] = useState(0);
  const lastRefreshKey = useRef(refreshKey);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  function modelName(id: string) {
    const model = models?.items.find(item => item.id === id);
    if (!model) return '尚未加载的型号';
    const connection = connections?.items.find(item => item.id === model.connection_id);
    const name = model.display_name && model.display_name !== model.model_id ? `${model.display_name} · ${model.model_id}` : model.model_id;
    return `${name} · ${connection ? `${connection.display_name} · ${connection.endpoint}` : '连接尚未同步'}`;
  }
  const recovery = useSettingsConflict<AgentProfile>(inflight, setBusy, onBusyChange, (original, draft, latest, choose) => ({
    ...latest,
    display_name: choose('助理显示名称', original.display_name, draft.display_name, latest.display_name),
    icon_id: choose('内置图标', original.icon_id, draft.icon_id, latest.icon_id, value => icons.find(icon => icon.id === value)?.label ?? '不可用图标'),
    communication_style: choose('沟通方式', original.communication_style, draft.communication_style, latest.communication_style),
    instructions: choose('工作指导', original.instructions, draft.instructions, latest.instructions),
    default_model_profile_id: choose('默认模型', original.default_model_profile_id, draft.default_model_profile_id, latest.default_model_profile_id,
      value => value ? modelName(value) : '未指定默认模型'),
    delegatable: choose('允许作为委派成员', original.delegatable, draft.delegatable, latest.delegatable),
    allowed_tools: choose('成员允许工具', original.allowed_tools, draft.allowed_tools, latest.allowed_tools),
    skill_ids: choose('成员允许 Skill', original.skill_ids, draft.skill_ids, latest.skill_ids,
      value => value.map(id => skills?.items.find(item => item.version.skill_id === id)?.version.name ?? '尚未加载的 Skill').join('、') || '无'),
  }));
  const { conflict } = recovery;
  const draft = recovery.editing?.draft ?? selected;
  const formKey = `${selected?.id}:${draft?.version}:${editRevision}:${!!recovery.editing}`;
  const selectedSkills = skillSelection?.key === formKey ? skillSelection.ids : draft?.skill_ids ?? [];
  const modelSelection = modelChoice?.key === formKey ? modelChoice.id : draft?.default_model_profile_id ?? '';
  function resetDraft() {
    const latest = recovery.latestBase;
    if (latest) setProfiles(current => ({ ...current!, items: Object.values(mergeVersioned(
      Object.fromEntries(current!.items.map(item => [item.id, item])), [latest])) }));
    recovery.clear(); setEditRevision(value => value + 1); setModelChoice(undefined); setError(''); setStatus('');
  }

  useLayoutEffect(() => { if (!busy) onViewReady?.(); }, [formKey, busy, onViewReady]);
  useEffect(() => {
    let ignore = false;
    client.profiles().then(page => {
      if (ignore) return;
      setProfiles(page);
      setSelectedId(page.items[0]?.id ?? '');
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
    if (inflight.current || (conflict && !recovery.merged)) return;
    const base = recovery.latestBase ?? selected!;
    const values = new FormData(event.currentTarget);
    const form = event.currentTarget;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setError(''); setStatus('');
    const data: AgentProfile = recovery.merged ?? {
        ...base,
        display_name: String(values.get('display_name')), icon_id: String(values.get('icon_id')),
        communication_style: String(values.get('communication_style')), instructions: String(values.get('instructions')),
        default_model_profile_id: String(values.get('default_model_profile_id')) || null,
        delegatable: manageMembers ? values.has('delegatable') : base.delegatable,
        allowed_tools: manageMembers && tools ? values.getAll('allowed_tools').map(String) : draft!.allowed_tools,
        skill_ids: manageMembers && skills ? selectedSkills : draft!.skill_ids,
    };
    try {
      const saved = await client.saveAgent(data.id, { meta: commandMeta(newProfile ? null : data.version), data });
      setProfiles(current => ({ ...current!, items: Object.values(mergeVersioned(Object.fromEntries(current!.items.map(item => [item.id, item])), [saved])) }));
      setNewProfile(undefined); setSelectedId(saved.id);
      recovery.clear();
      setModelChoice(undefined);
      setStatus('助理配置已保存；仅对新运行生效');
      window.dispatchEvent(new Event('flowmate:settings-changed'));
      onSaved?.(form);
    } catch (error) {
      if (!recovery.capture(error, newProfile ? undefined : base, data)) {
        setError(error instanceof ApiError ? error.message : '助理配置保存失败，请检查 Runtime 状态');
      }
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
      setError(error instanceof ApiError ? error.message : '读取下一页配置失败');
    } finally { inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  return <section aria-labelledby="assistant-settings-title" className="flex min-w-0 flex-col items-start gap-3">
    <h2 id="assistant-settings-title">{manageMembers ? '助理配置' : '主助理设置'}</h2>
    <p>多个会话共用同一助理身份；修改仅对新运行生效，不改变当前运行的配置快照。</p>
    {error && <p className="status-message" role="alert">{error}</p>}<p className="status-message" role="status">{status}</p>
    {!profiles && !error && <p>正在读取助理配置…</p>}
    {profiles && !profiles.items.length && <p>暂无主助理配置</p>}
    <div className="flex flex-wrap items-end gap-2">
    {!!profiles?.items.length && <FieldLabel>编辑助理 <NativeSelect value={newProfile ? '' : selectedId} disabled={busy} onChange={event => { const id = event.target.value; guard(() => { setNewProfile(undefined); setSelectedId(id); setModelChoice(undefined); recovery.clear(); setError(''); setStatus(''); }); }}>
      {newProfile && <NativeSelectOption value="">新助理（未保存）</NativeSelectOption>}
      {profiles.items.map(profile => <NativeSelectOption key={profile.id} value={profile.id}>{profile.display_name}</NativeSelectOption>)}
    </NativeSelect></FieldLabel>}
    {profiles?.next_cursor && <Button disabled={busy || !!conflict} onClick={() => loadMore('profiles')}>更多助理</Button>}
    {manageMembers && profiles && <Button disabled={busy} onClick={() => guard(() => {
      setNewProfile({ id: crypto.randomUUID(), version: 1, display_name: '', icon_id: 'assistant', instructions: '', communication_style: '',
        default_model_profile_id: null, delegatable: false, allowed_tools: [], skill_ids: [] });
      setModelChoice(undefined); recovery.clear(); setStatus(''); setError('');
    })}>新建助理</Button>}
    {manageMembers && <Button variant="ghost" disabled={busy} onClick={() => guard(() => { setNewProfile(undefined); recovery.clear(); setError(''); setReadRevision(value => value + 1); })}>刷新助理与目录</Button>}
    </div>
    {conflict && <SettingsConflict label="助理" latest={conflict.latest?.display_name} error={conflict.error} busy={busy} {...recovery}
      onRead={() => void recovery.read(() => findSetting(selectedId, cursor => client.profiles(cursor ? { cursor } : undefined)))} />}
    {draft && <form className="settings-form w-full" onSubmit={save} onReset={resetDraft}>
      <fieldset className="settings-grid" key={formKey} disabled={busy || !models || !!conflict}>
        <FieldLegend>共享身份与工作指导</FieldLegend>
        {manageMembers && <details className="col-span-full rounded-md border border-border p-3">
          <summary className="cursor-pointer">身份详情</summary>
          <p className="mt-2">{newProfile ? '新助理（尚未保存）' : draft.display_name}</p>
        </details>}
        <FieldLabel>显示名称 <Input name="display_name" required maxLength={256} defaultValue={draft.display_name} /></FieldLabel>
        <FieldLabel>内置图标 <NativeSelect name="icon_id" required defaultValue={draft.icon_id}>
          {!icons.some(icon => icon.id === draft.icon_id) && <NativeSelectOption value={draft.icon_id}>原图标（当前不可用）</NativeSelectOption>}
          {icons.map(icon => <NativeSelectOption key={icon.id} value={icon.id}>{icon.symbol} {icon.label}</NativeSelectOption>)}
        </NativeSelect></FieldLabel>
        <FieldLabel>沟通方式 <Textarea name="communication_style" defaultValue={draft.communication_style} /></FieldLabel>
        <FieldLabel>工作指导 <Textarea name="instructions" rows={5} defaultValue={draft.instructions} /></FieldLabel>
        {manageMembers && <><FieldLabel className="flex items-center gap-2">
          <Checkbox name="delegatable" disabled={busy || !models || !!conflict} defaultChecked={draft.delegatable} />允许作为委派成员
        </FieldLabel>
          <p className="muted">可委派成员必须明确选择默认模型。成员能力不等于资料外发或文件写出许可。</p>
          {tools ? <fieldset className="member-tools"><FieldLegend>成员允许工具（能力上界）</FieldLegend>
            {tools.map(tool => <FieldLabel className="flex items-center gap-2" key={tool.name}>
              <Checkbox name="allowed_tools" value={tool.name} disabled={busy || !models || !!conflict} defaultChecked={draft.allowed_tools.includes(tool.name)} />{tool.name}
            </FieldLabel>)}
            {draft.allowed_tools.filter(name => !tools.some(tool => tool.name === name)).map(name => <FieldLabel className="flex items-center gap-2" key={name}>
              <Checkbox name="allowed_tools" value={name} disabled={busy || !models || !!conflict} defaultChecked />{name}（当前未装配，保留配置不代表可执行）
            </FieldLabel>)}
            {!tools.length && <p>当前目录没有业务工具。</p>}
          </fieldset> : <p>工具目录未就绪；保存其他字段会保留原允许列表。</p>}
           {skills ? <fieldset className="col-span-full"><FieldLegend>成员允许 Skill</FieldLegend>
             {[...skills.items.filter(item => item.binding?.enabled && item.readiness === 'content_available').map(item => item.version.skill_id),
               ...selectedSkills.filter(id => !skills.items.some(item => item.version.skill_id === id && item.binding?.enabled && item.readiness === 'content_available'))]
               .map((id, index) => {
                 const item = skills.items.find(item => item.version.skill_id === id);
                 const available = item?.binding?.enabled && item.readiness === 'content_available';
                 return <FieldLabel className="flex items-center gap-2" key={id}>
                   <Checkbox name="skill_ids" value={id} disabled={busy || !models || !!conflict} checked={selectedSkills.includes(id)}
                     onCheckedChange={checked => setSkillSelection({ key: formKey, ids: checked === true
                       ? [...selectedSkills, id] : selectedSkills.filter(value => value !== id) })} />
                   {item ? `${item.version.name} · ${item.version.scope.kind === 'workspace' ? '项目' : '个人'}` : `尚未加载的 Skill ${index + 1}`}
                   {!available && '（当前不可选，保留原配置）'}
                 </FieldLabel>;
               })}
            {skills.next_cursor && <Button type="button" size="sm" variant="ghost" disabled={busy || loadingSkills} onClick={async () => {
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
            }}>更多允许 Skill</Button>}
          </fieldset> : <p>Skill 目录未就绪；保留原有 {draft.skill_ids.length} 项。</p>}</>}
        <FieldLabel className="col-span-full">默认模型 <NativeSelect name="default_model_profile_id" value={modelSelection} onChange={event => setModelChoice({ key: formKey, id: event.target.value })}>
          <NativeSelectOption value="">新会话沿用项目最近使用的模型</NativeSelectOption>
          {modelSelection && !models?.items.some(model => model.id === modelSelection) && <NativeSelectOption value={modelSelection}>所选模型（尚未加载）</NativeSelectOption>}
          {models?.items.map(model => <NativeSelectOption key={model.id} value={model.id}>{modelName(model.id)}</NativeSelectOption>)}
        </NativeSelect></FieldLabel>
      </fieldset>
        {(models?.next_cursor || connections?.next_cursor) && <div className="button-row">
           {models?.next_cursor && <Button disabled={busy} onClick={() => loadMore('models')}>更多模型</Button>}
           {connections?.next_cursor && <Button disabled={busy} onClick={() => loadMore('connections')}>更多连接</Button>}
        </div>}
        <div className="settings-form-actions button-row">
          <Button type="submit" variant="default" disabled={busy || !models || (!!conflict && !recovery.merged)}>{recovery.latestBase ? '保存合并后的助理' : '保存助理'}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={event => {
            onDiscard?.(event.currentTarget.form!);
            resetDraft();
          }}>取消编辑</Button>
        </div>
    </form>}
  </section>;
}
