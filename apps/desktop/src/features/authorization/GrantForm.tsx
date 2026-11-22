import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { McpClient, mcpDestinationLabel } from '../../api/mcp';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { windowError } from '../../api/windows';
import type { DataUseGrant, GrantRequest, KnowledgeSettings, KnowledgeSource, McpServerView, ModelConnection, ModelProfile, ResourceRef, ScopeRef, SkillView, ToolSpecList } from '../../generated/contracts';
import type { EditorLifecycle } from '../settings/Settings';

type Source = 'file' | 'memory' | 'mcp' | 'knowledge';
type Purpose = 'model_send' | 'tool_send' | 'local_process_send' | 'embedding_send';
const purposeLabels: Record<Purpose, string> = { model_send: '发送到模型', tool_send: '发送到 MCP 工具',
  local_process_send: '发送到绑定的本机脚本', embedding_send: '发送到向量模型' };

export default function GrantForm({ client, workspaceId, sessionId, resources, workspaceName, sessionTitles, onGranted, onBusyChange, onSaved,
  initialSource = 'file', allowedPurposes }: {
  client: RuntimeClient; workspaceId: string; sessionId: string | null; resources: ResourceRef[]; onGranted: (grant: DataUseGrant) => void;
  workspaceName?: string; sessionTitles?: Readonly<Record<string, string>>;
  initialSource?: Source; allowedPurposes?: readonly Purpose[];
} & EditorLifecycle) {
  const fieldId = useId();
  const [catalog, setCatalog] = useState<{ tools: ToolSpecList; models: ModelProfile[]; connections: ModelConnection[]; servers: McpServerView[] }>();
  const [source, setSource] = useState<Source>(initialSource), [purpose, setPurpose] = useState<Purpose>(allowedPurposes?.[0] ?? 'model_send');
  const [scopeId, setScopeId] = useState(sessionId ?? workspaceId), [resourceIds, setResourceIds] = useState<string[]>([]);
  const [serverId, setServerId] = useState(''), [destination, setDestination] = useState('');
  const [locals, setLocals] = useState<{ value: string; label: string }[]>();
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<GrantRequest>();
  const [generation, refresh] = useState(0);
  const working = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeSource[]>([]), [wholeKnowledge, setWholeKnowledge] = useState(true);
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]), [embeddingTargets, setEmbeddingTargets] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (source !== 'knowledge') return;
    let ignore = false;
    async function read() {
      const items: KnowledgeSource[] = []; let cursor: string | undefined;
      do { const page = await client.knowledgeSources(workspaceId, { cursor }); items.push(...page.items); cursor = page.next_cursor ?? undefined; } while (cursor);
      if (!ignore) setKnowledge(items);
    }
    void read().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, source, workspaceId, generation]);
  useEffect(() => {
    if (purpose !== 'embedding_send') return;
    let ignore = false; setEmbeddingTargets([]);
    async function read() {
      const [first, settings] = await Promise.all([client.embeddingProfiles(), client.knowledgeSettings(workspaceId)]);
      const profiles = [...first.items]; let cursor = first.next_cursor;
      while (cursor) { const next = await client.embeddingProfiles({ cursor }); profiles.push(...next.items); cursor = next.next_cursor; }
      const references = new Map<string, NonNullable<KnowledgeSettings['active_profile']>>(profiles.map(profile => [`${profile.id}:${profile.revision}`, profile]));
      for (const profile of [settings.active_profile, settings.desired_profile]) if (profile) references.set(`${profile.id}:${profile.revision}`, profile);
      const views = await Promise.all([...references.values()].map(profile => client.embeddingProfile(profile.id, profile.revision)));
      if (!ignore) setEmbeddingTargets([...new Map(views.flatMap(view => view.destination
        ? [[view.destination, { value: view.destination, label: `${view.profile.display_name} · ${view.destination}` }] as const] : [])).values()]);
    }
    void read().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, purpose, workspaceId, generation]);
  useEffect(() => {
    let ignore = false; setCatalog(undefined); setError('');
    async function all<T>(read: (cursor?: string) => Promise<{ items: T[]; next_cursor: string | null }>) {
      const items: T[] = []; let cursor: string | undefined;
      do { const page = await read(cursor); items.push(...page.items); cursor = page.next_cursor ?? undefined; } while (cursor);
      return items;
    }
    async function load() {
      const mcp = new McpClient(client.connection);
      const [tools, models, connections, personal, project] = await Promise.all([
        client.tools(), all(cursor => client.models({ cursor })), all(cursor => client.connections({ cursor })),
        all(cursor => mcp.mcpServers({ scope_kind: 'user_global', cursor })),
        all(cursor => mcp.mcpServers({ scope_kind: 'workspace', workspace_id: workspaceId, cursor })),
      ]);
      if (!ignore) setCatalog({ tools, models, connections, servers: [...new Map([...personal, ...project].map(item => [item.config.id, item])).values()] });
    }
    void load().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, workspaceId, generation]);
  useEffect(() => {
    if (pending) return;
    setScopeId(source === 'file' ? sessionId ?? workspaceId : workspaceId);
    setResourceIds([]); setDestination(''); setServerId('');
  }, [workspaceId, sessionId, source, !!pending]);
  useEffect(() => {
    if (purpose !== 'local_process_send') return;
    let ignore = false; setLocals(undefined);
    async function load() {
      const skills: SkillView[] = []; let cursor: string | undefined;
      do {
        const page = await client.skills({ scope_kind: 'workspace', workspace_id: workspaceId, cursor });
        skills.push(...page.items); cursor = page.next_cursor ?? undefined;
      } while (cursor);
      const targets: { value: string; label: string }[] = [];
      for (const item of skills) {
        const binding = item.binding;
        if (!binding?.enabled || !binding.environment_id || !binding.environment_revision || item.readiness !== 'content_available') continue;
        const environment = await client.executionEnvironment(binding.environment_id);
        if (environment.revision !== binding.environment_revision) continue;
        targets.push({ value: `skill:${item.version.skill_id}:${item.version.content_hash}:environment:${environment.id}:${environment.revision}`,
          label: `${item.version.name} · ${environment.executable_path}` });
      }
      if (!ignore) setLocals(targets);
    }
    void load().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, purpose, workspaceId, generation]);

  const scope: ScopeRef = scopeId === 'personal' ? { kind: 'user_global', workspace_id: null, session_id: null }
    : scopeId === workspaceId ? { kind: 'workspace', workspace_id: workspaceId, session_id: null }
    : { kind: 'session', workspace_id: workspaceId, session_id: scopeId };
  const selectedServer = catalog?.servers.find(item => item.config.id === serverId)?.config;
  const serverAllowed = (server: McpServerView['config']) => server.enabled
    && (server.scope.kind === 'user_global' || server.scope.workspace_id === workspaceId);
  const toolTargets = [...new Map(catalog?.tools.flatMap(tool => {
    const fixed = tool.mcp, config = catalog.servers.find(server => server.config.id === fixed?.server_id)?.config;
    return fixed && config && serverAllowed(config) && config.revision === fixed.config_revision
      ? [[fixed.destination, { value: fixed.destination, label: `${config.display_name} · ${mcpDestinationLabel(fixed.destination)}` }] as const] : [];
  }) ?? []).values()];
  const models = [...new Map(catalog?.models.flatMap(model => {
    const connection = catalog.connections.find(item => item.id === model.connection_id);
    return connection ? [[connection.endpoint, { value: connection.endpoint, label: `${model.display_name ?? model.model_id} · ${connection.display_name}` }] as const] : [];
  }) ?? []).values()];
  const targets = purpose === 'tool_send' ? toolTargets : purpose === 'model_send' ? models
    : purpose === 'embedding_send' ? embeddingTargets : locals ?? [];
  const available = resources.filter(resource => resource.kind !== 'export'
    && (resource.scope.kind === 'workspace' || resource.scope.session_id === scope.session_id));
  const selected = available.filter(resource => resourceIds.includes(resource.id)).map(resource => resource.id);
  const canSubmit = !!catalog && targets.some(target => target.value === destination)
    && (source === 'file' ? scope.kind !== 'user_global' && selected.length > 0
      : source === 'knowledge' ? scope.kind === 'workspace' && (wholeKnowledge || knowledgeIds.length > 0)
      : source === 'memory' ? scope.kind !== 'session'
      : !!selectedServer && serverAllowed(selectedServer));

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (working.current || !pending && !canSubmit) return;
    const target = form.current!;
    const request: GrantRequest = pending ?? { meta: commandMeta(), data: {
      scope, resource_ids: source === 'file' ? selected : [],
      memory_scopes: source === 'memory' ? [scope] : [],
      ...(source === 'knowledge' ? { knowledge_scopes: wholeKnowledge ? [scope] : [], knowledge_source_ids: wholeKnowledge ? [] : knowledgeIds } : {}),
      mcp_versions: source === 'mcp' ? { [selectedServer!.id]: selectedServer!.revision } : {},
      purposes: [purpose], destination,
    } };
    working.current = true; setBusy(true); onBusyChange?.(true); setError(''); setStatus(''); setPending(request);
    try {
      const grant = await client.grant(request); setPending(undefined); setStatus('用途授权已创建'); onGranted(grant);
      onSaved?.(target);
    } catch (error) {
      if (error instanceof ApiError) setPending(undefined);
      setError(windowError(error));
    } finally { working.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <form ref={form} className="grid gap-3" aria-label="用途授权" onSubmit={submit}>
    <div><h3 className="m-0">新增用途授权</h3><FieldDescription>授权只覆盖所选来源、用途与目的地；工具审批不会代替这份许可。</FieldDescription></div>
    {error && <FieldError>{error}</FieldError>}{status && <p role="status">{status}</p>}
    {!catalog && !error && <FieldDescription role="status">正在读取真实工具、模型和 MCP 配置…</FieldDescription>}
    <Button type="button" className="justify-self-start" disabled={busy || !!pending} onClick={() => { setDestination(''); setServerId(''); refresh(value => value + 1); }}>重新读取授权目录</Button>
    <FieldSet disabled={busy || !!pending}><FieldGroup>
      <Field><FieldLabel htmlFor={`${fieldId}-source`}>授权来源</FieldLabel>
        <NativeSelect id={`${fieldId}-source`} value={source} onChange={event => { setSource(event.target.value as Source); setDestination(''); setPurpose(allowedPurposes?.[0] ?? 'model_send'); setScopeId(workspaceId); }}>
        <NativeSelectOption value="file">文件资料</NativeSelectOption><NativeSelectOption value="knowledge">项目资料</NativeSelectOption><NativeSelectOption value="memory">长期记忆范围</NativeSelectOption><NativeSelectOption value="mcp">MCP 返回资料</NativeSelectOption>
      </NativeSelect></Field>
      <Field><FieldLabel htmlFor={`${fieldId}-scope`}>授权范围</FieldLabel>
      <NativeSelect id={`${fieldId}-scope`} value={scopeId} onChange={event => { setScopeId(event.target.value); setResourceIds([]); setDestination(''); }}>
        <NativeSelectOption value={workspaceId}>{workspaceName ?? '当前项目'}</NativeSelectOption>
        {source === 'file' ? [...new Set([sessionId, ...resources.map(resource => resource.scope.session_id)].filter((value): value is string => !!value))]
          .map(id => <NativeSelectOption key={id} value={id}>{sessionTitles?.[id] ?? (id === sessionId ? '当前会话' : resources.filter(item => item.scope.session_id === id).map(item => item.label).join('、'))}</NativeSelectOption>)
          : source === 'memory' && <NativeSelectOption value="personal">个人</NativeSelectOption>}
      </NativeSelect></Field>
      {source === 'file' && <FieldSet><FieldLegend>所选文件资料</FieldLegend>{available.map(resource => <Field key={resource.id} orientation="horizontal">
        <Checkbox id={`${fieldId}-${resource.id}`} disabled={busy || !!pending} checked={resourceIds.includes(resource.id)} onCheckedChange={checked => setResourceIds(current => checked === true ? [...current, resource.id] : current.filter(id => id !== resource.id))} />
        <FieldLabel htmlFor={`${fieldId}-${resource.id}`}>{resource.label}</FieldLabel>
      </Field>)}</FieldSet>}
      {source === 'knowledge' && <FieldSet><FieldLegend>项目知识来源</FieldLegend>
        <Field orientation="horizontal"><Checkbox id={`${fieldId}-whole-knowledge`} checked={wholeKnowledge}
          onCheckedChange={checked => setWholeKnowledge(checked === true)} />
          <FieldLabel htmlFor={`${fieldId}-whole-knowledge`}>本项目全部资料（包含以后加入的资料）</FieldLabel></Field>
        {!wholeKnowledge && knowledge.filter(item => !['removed', 'revoked', 'deleted'].includes(item.status)).map(item =>
          <Field key={item.id} orientation="horizontal"><Checkbox id={`${fieldId}-source-${item.id}`} checked={knowledgeIds.includes(item.id)}
            onCheckedChange={checked => setKnowledgeIds(current => checked === true ? [...current, item.id] : current.filter(id => id !== item.id))} />
            <FieldLabel htmlFor={`${fieldId}-source-${item.id}`}>{item.label}</FieldLabel></Field>)}
      </FieldSet>}
      {source === 'mcp' && <Field><FieldLabel htmlFor={`${fieldId}-server`}>返回资料的 MCP 配置</FieldLabel>
        <NativeSelect id={`${fieldId}-server`} value={serverId} onChange={event => setServerId(event.target.value)}>
        <NativeSelectOption value="">请选择服务</NativeSelectOption>{catalog?.servers.filter(item => serverAllowed(item.config)).map(item =>
          <NativeSelectOption key={item.config.id} value={item.config.id}>{item.config.display_name}</NativeSelectOption>)}
      </NativeSelect></Field>}
      <Field><FieldLabel htmlFor={`${fieldId}-purpose`}>发送用途</FieldLabel>
      <NativeSelect id={`${fieldId}-purpose`} value={purpose} onChange={event => { setPurpose(event.target.value as Purpose); setDestination(''); }}>
        {(allowedPurposes ?? ['model_send', 'embedding_send', 'tool_send', 'local_process_send'] as const).map(purpose =>
          <NativeSelectOption key={purpose} value={purpose}>{purposeLabels[purpose]}</NativeSelectOption>)}
      </NativeSelect></Field>
      <Field><FieldLabel htmlFor={`${fieldId}-destination`}>实际接收目的地</FieldLabel>
      <NativeSelect id={`${fieldId}-destination`} value={destination} onChange={event => setDestination(event.target.value)}>
        <NativeSelectOption value="">请选择实际目的地</NativeSelectOption>{targets.map(target => <NativeSelectOption key={target.value} value={target.value}>{target.label}</NativeSelectOption>)}
      </NativeSelect>
      {destination && purpose !== 'local_process_send' && <FieldDescription>服务地址：{mcpDestinationLabel(destination)}</FieldDescription>}
      </Field>
      {selectedServer && source === 'mcp' && <FieldDescription>将授权 {selectedServer.display_name} 当前配置返回的资料。配置变更后需重新核对授权。</FieldDescription>}
      {source === 'memory' && scope.kind === 'user_global' && <FieldDescription>个人记忆授权也可在“记忆与上下文”设置中查看和撤销。</FieldDescription>}
      {purpose === 'local_process_send' && <FieldDescription>脚本执行还需另行授权，并核对所选 Skill 与环境。</FieldDescription>}
      <Button type="submit" variant="default" className="self-start" disabled={!canSubmit}>确认创建用途授权</Button>
    </FieldGroup></FieldSet>
    {pending && <section><p>授权结果待核对。重试会使用本次已选的范围和目的地。</p>
      <Button type="button" disabled={busy} onClick={() => void submit()}>以原命令重试用途授权</Button></section>}
  </form>;
}
