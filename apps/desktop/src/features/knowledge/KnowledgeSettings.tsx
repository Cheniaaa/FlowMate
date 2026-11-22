import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { validate } from '../../api/validation';
import { windowError } from '../../api/windows';
import type { DataUseGrant, EmbeddingProfile, EmbeddingProfileView, KnowledgeJob, KnowledgeSource, KnowledgeSettings as Settings, SetProjectKnowledgeCommand, TaskHandle } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import GrantForm from '../authorization/GrantForm';
import { KnowledgeGrantScope, readKnowledgeGrantSources } from '../chat/ResourcePanel';

type ProfileRef = NonNullable<Settings['active_profile']>;
const profileKey = (profile: ProfileRef) => `${profile.id}:${profile.revision}`;
const pendingKey = (workspaceId: string) => `flowmate:knowledge-settings:${workspaceId}`;
export default function KnowledgeSettings(props: {
  client: RuntimeClient; workspaceId: string; refreshKey?: string;
  onOpenTask?: (task: TaskHandle) => void; onConfigureModels?: () => void;
}) {
  return <KnowledgeSettingsView key={props.workspaceId} {...props} />;
}
function KnowledgeSettingsView({ client, workspaceId, refreshKey, onOpenTask, onConfigureModels }: Parameters<typeof KnowledgeSettings>[0]) {
  const [settings, setSettings] = useState<Settings>(), [profiles, setProfiles] = useState<EmbeddingProfile[]>([]);
  const [views, setViews] = useState<Record<string, EmbeddingProfileView>>({});
  const [job, setJob] = useState<KnowledgeJob | null>(null);
  const [sources, setSources] = useState<Record<string, KnowledgeSource>>({});
  const [grants, setGrants] = useState<DataUseGrant[]>([]), [selected, setSelected] = useState<ProfileRef | null>(null);
  const [consent, setConsent] = useState(false), [grantOpen, setGrantOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [pending, setPending] = useState<SetProjectKnowledgeCommand | undefined>(() => {
    const encoded = localStorage.getItem(pendingKey(workspaceId));
    return encoded ? validate('SetProjectKnowledgeCommand', JSON.parse(encoded)) : undefined;
  });
  const [generation, refresh] = useState(0), inflight = useRef(false), dirty = useRef(false), fieldId = useId();
  useEffect(() => {
    let ignore = false;
    async function read() {
      const [settings, profilePage, grantPage] = await Promise.all([
        client.knowledgeSettings(workspaceId), client.embeddingProfiles(), client.grants(workspaceId),
      ]);
      const profiles = [...profilePage.items]; let cursor = profilePage.next_cursor;
      while (cursor) { const page = await client.embeddingProfiles({ cursor }); profiles.push(...page.items); cursor = page.next_cursor; }
      const grants = [...grantPage.items]; cursor = grantPage.next_cursor;
      while (cursor) { const page = await client.grants(workspaceId, { cursor }); grants.push(...page.items); cursor = page.next_cursor; }
      const references = new Map(profiles.map(item => [profileKey(item), { id: item.id, revision: item.revision }]));
      for (const reference of [settings.active_profile, settings.desired_profile]) if (reference) references.set(profileKey(reference), reference);
      const [fixed, job, sources] = await Promise.all([
        Promise.all([...references.values()].map(async reference =>
          [profileKey(reference), await client.embeddingProfile(reference.id, reference.revision)] as const)),
        settings.rebuild_job_id ? client.knowledgeJob(settings.rebuild_job_id) : null,
        readKnowledgeGrantSources(client, workspaceId, grants),
      ]);
      if (!ignore) {
        setSettings(settings); setProfiles(profiles); setGrants(grants); setViews(Object.fromEntries(fixed));
        setJob(job); setSources(sources);
        if (!dirty.current) setSelected(settings.desired_profile);
      }
    }
    void read().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, workspaceId, refreshKey, generation]);
  function accepted(result: Settings) {
    if (result.workspace_id !== workspaceId) throw new Error('设置回执不属于当前项目');
    localStorage.removeItem(pendingKey(workspaceId)); setPending(undefined); setSettings(result);
    dirty.current = false; setSelected(result.desired_profile); setConsent(false); setStatus('检索选择已保存');
    refresh(value => value + 1);
  }
  useEffect(() => {
    const encoded = localStorage.getItem(pendingKey(workspaceId));
    if (!encoded) return;
    const command = validate('SetProjectKnowledgeCommand', JSON.parse(encoded));
    let ignore = false;
    client.workspaceCommandStatus(workspaceId, command.meta.command_id!).then(result => {
      if (ignore) return;
      if (result.status === 'confirmed') accepted(validate('KnowledgeSettings', result.result));
      else setError('暂未查到保存回执，请稍后重试。');
    }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, workspaceId]);
  async function act(action: () => Promise<void>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) { setError(windowError(error)); }
    finally { inflight.current = false; setBusy(false); }
  }
  const fixed = selected ? views[profileKey(selected)] : undefined, destination = fixed?.destination;
  const covered = !!destination && grants.some(grant => grant.status === 'active' && grant.purposes.includes('embedding_send')
    && grant.destination === destination && grant.knowledge_scopes?.some(scope => scope.kind === 'workspace' && scope.workspace_id === workspaceId));
  const embeddingGrants = grants.filter(grant => grant.status === 'active' && grant.purposes.includes('embedding_send')
    && grant.destination === destination && (grant.knowledge_source_ids?.length || grant.knowledge_scopes?.length));
  async function save() {
    const command: SetProjectKnowledgeCommand = pending ?? { meta: commandMeta(settings!.revision), data: {
      embedding_profile: selected, grants: consent && destination && !covered ? [{
        scope: { kind: 'workspace', workspace_id: workspaceId, session_id: null },
        knowledge_scopes: [{ kind: 'workspace', workspace_id: workspaceId, session_id: null }],
        resource_ids: [], purposes: ['embedding_send'], destination,
      }] : [],
    } };
    localStorage.setItem(pendingKey(workspaceId), JSON.stringify(command)); setPending(command);
    try { accepted(await client.setProjectKnowledge(workspaceId, command)); }
    catch (error) {
      if (error instanceof ApiError && error.status < 500) { localStorage.removeItem(pendingKey(workspaceId)); setPending(undefined); }
      throw error;
    }
  }
  function name(reference: ProfileRef | null) {
    return reference ? views[profileKey(reference)]?.profile.display_name ?? '正在读取固定检索配置' : '仅关键词';
  }
  const currentJob = job?.id === settings?.rebuild_job_id ? job : null;
  const options = new Map([...profiles.map(item => [profileKey(item), item] as const),
    ...Object.values(views).map(item => [profileKey(item.profile), item.profile] as const)]);
  return <section className="grid min-w-0 gap-3 rounded-lg border border-border p-4" aria-label="项目检索与发送设置">
    <h2 className="m-0 text-sm font-semibold">检索与发送</h2>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {settings ? <>
      <p className="m-0 text-sm">当前可用：{name(settings.active_profile)}</p>
      {settings.rebuild_job_id && <p className="m-0 text-sm">已选目标：{name(settings.desired_profile)}
        {currentJob?.status === 'cancelled' ? ' · 已取消，继续使用当前配置'
          : currentJob?.status === 'failed' ? ' · 更新失败，继续使用当前可用配置。'
          : currentJob?.status === 'completed' ? ' · 处理完成。'
          : currentJob ? ' · 等待处理完成后切换。' : ' · 正在读取处理状态…'}</p>}
      <Field><FieldLabel htmlFor={`${fieldId}-profile`}>项目检索方式</FieldLabel>
        <NativeSelect id={`${fieldId}-profile`} disabled={busy || !!pending} value={selected ? profileKey(selected) : ''}
          onChange={event => {
            const profile = options.get(event.target.value); dirty.current = true;
            setSelected(profile ? { id: profile.id, revision: profile.revision } : null); setConsent(false); setStatus('');
          }}>
          <NativeSelectOption value="">仅关键词</NativeSelectOption>
          {[...options].map(([key, profile]) => {
            const current = settings.active_profile && key === profileKey(settings.active_profile);
            const newer = profiles.some(item => item.id === profile.id && item.revision > profile.revision);
            return <NativeSelectOption key={key} value={key}>{profile.display_name}
              {current ? ' · 当前使用' : newer ? ' · 历史配置' : ''}
              {newer && ' · 有更新'}</NativeSelectOption>;
          })}
        </NativeSelect>
      </Field>
      {fixed && <div className="grid gap-2 text-sm">
        <span>{fixed.profile.provider === 'openai' ? '云端（OpenAI 兼容）' : '本地'} · {fixed.profile.model_id}</span>
        {destination ? <>
          <span className="wrap-anywhere">{destination}</span>
          {covered ? <p className="m-0 text-muted-foreground">本项目资料已有向量发送许可。</p> : <>
            <Field orientation="horizontal"><Checkbox id={`${fieldId}-consent`} checked={consent} disabled={busy || !!pending}
              onCheckedChange={checked => setConsent(checked === true)} />
              <FieldLabel htmlFor={`${fieldId}-consent`}>允许本项目资料发送到所选检索服务</FieldLabel></Field>
            <FieldDescription>文档和检索问题会发送到当前固定服务，可能产生费用。未勾选时不新增许可，仍可使用关键词检索。</FieldDescription>
          </>}
        </> : <FieldDescription>{fixed.local_runtime_available ? '本地运行库已安装' : '缺少本地运行库'}；不代表模型效果已经验证。</FieldDescription>}
      </div>}
      {embeddingGrants.map(grant => <article key={grant.id} className="grid gap-1 rounded-md border border-border p-3">
        <p className="m-0 text-sm text-muted-foreground">向量发送许可</p>
        <KnowledgeGrantScope grant={grant} sources={sources} />
      </article>)}
      <div className="flex flex-wrap gap-2">
        <Button variant="default" disabled={busy || !!pending || !!selected && !fixed} onClick={() => void act(save)}>保存检索选择</Button>
        {onConfigureModels && <Button disabled={busy} onClick={onConfigureModels}>管理检索模型</Button>}
        {currentJob?.task && onOpenTask && <Button disabled={busy} onClick={() => onOpenTask(currentJob.task!)}>查看检索更新任务</Button>}
      </div>
    </> : !error && <p role="status">正在读取项目检索设置…</p>}
    {pending && <section><p>保存结果待核对，离开后仍可核对。</p>
      <Button disabled={busy} onClick={() => void act(async () => {
        const result = await client.workspaceCommandStatus(workspaceId, pending.meta.command_id!);
        if (result.status === 'confirmed') accepted(validate('KnowledgeSettings', result.result));
        else setError('暂未查到保存回执，请稍后重试。');
      })}>核对设置保存结果</Button>
      <Button disabled={busy} onClick={() => void act(save)}>重试</Button></section>}
    <details onToggle={event => setGrantOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm">生成模型发送授权</summary>
      <p className="text-sm text-muted-foreground">加入资料只授予项目读取。将知识片段发送给生成模型时，另行明确来源与接收目的地。</p>
      {grants.filter(grant => grant.status === 'active' && grant.purposes.includes('model_send')
        && (grant.knowledge_scopes?.length || grant.knowledge_source_ids?.length)).map(grant =>
          <article className="my-2 grid gap-1 rounded-md border border-border p-3" key={grant.id}>
            <KnowledgeGrantScope grant={grant} sources={sources} />
            <p className="m-0 text-sm wrap-anywhere">已授权知识片段发送到：{grant.destination}</p>
          </article>)}
      {grantOpen && <GrantForm client={client} workspaceId={workspaceId} sessionId={null} resources={[]}
        initialSource="knowledge" allowedPurposes={['model_send']} onGranted={grant => {
          setGrants(current => [...current, grant]); refresh(value => value + 1);
        }} />}
    </details>
  </section>;
}
