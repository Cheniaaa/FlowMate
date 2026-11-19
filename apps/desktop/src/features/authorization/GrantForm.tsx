import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { McpClient } from '../../api/mcp';
import { windowError } from '../../api/windows';
import type { DataUseGrant, GrantRequest, McpServerView, ModelConnection, ModelProfile, ResourceRef, ScopeRef, SkillView, ToolSpecList } from '../../generated/contracts';
import type { EditorLifecycle } from '../settings/Settings';

type Source = 'file' | 'memory' | 'mcp';
type Purpose = 'model_send' | 'tool_send' | 'local_process_send';

export default function GrantForm({ client, workspaceId, sessionId, resources, onGranted, onBusyChange, onSaved }: {
  client: RuntimeClient; workspaceId: string; sessionId: string | null; resources: ResourceRef[]; onGranted: (grant: DataUseGrant) => void;
} & EditorLifecycle) {
  const [catalog, setCatalog] = useState<{ tools: ToolSpecList; models: ModelProfile[]; connections: ModelConnection[]; servers: McpServerView[] }>();
  const [source, setSource] = useState<Source>('file'), [purpose, setPurpose] = useState<Purpose>('model_send');
  const [scopeId, setScopeId] = useState(sessionId ?? workspaceId), [resourceIds, setResourceIds] = useState<string[]>([]);
  const [serverId, setServerId] = useState(''), [destination, setDestination] = useState('');
  const [locals, setLocals] = useState<{ value: string; label: string }[]>();
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<GrantRequest>();
  const [generation, refresh] = useState(0);
  const working = useRef(false);
  const form = useRef<HTMLFormElement>(null);
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
          label: `${item.version.name} · ${item.version.content_hash.slice(0, 12)} · ${environment.executable_path} · 环境修订 ${environment.revision}` });
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
      ? [[fixed.destination, { value: fixed.destination, label: `${config.display_name} · 配置修订 ${fixed.config_revision}` }] as const] : [];
  }) ?? []).values()];
  const models = [...new Map(catalog?.models.flatMap(model => {
    const connection = catalog.connections.find(item => item.id === model.connection_id);
    return connection ? [[connection.endpoint, { value: connection.endpoint, label: `${model.display_name ?? model.model_id} · ${connection.display_name}` }] as const] : [];
  }) ?? []).values()];
  const targets = purpose === 'tool_send' ? toolTargets : purpose === 'model_send' ? models : locals ?? [];
  const available = resources.filter(resource => resource.kind !== 'export'
    && (resource.scope.kind === 'workspace' || resource.scope.session_id === scope.session_id));
  const selected = available.filter(resource => resourceIds.includes(resource.id)).map(resource => resource.id);
  const canSubmit = !!catalog && targets.some(target => target.value === destination)
    && (source === 'file' ? scope.kind !== 'user_global' && selected.length > 0
      : source === 'memory' ? scope.kind !== 'session'
      : !!selectedServer && serverAllowed(selectedServer));

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (working.current || !pending && !canSubmit) return;
    const target = form.current!;
    const request: GrantRequest = pending ?? { meta: commandMeta(), data: {
      scope, resource_ids: source === 'file' ? selected : [],
      memory_scopes: source === 'memory' ? [scope] : [],
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
  return <form ref={form} aria-label="用途授权" onSubmit={submit}>
    <h3>新增用途授权</h3><p>授权只覆盖所选来源、用途与目的地；工具审批不会代替这份许可。</p>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {!catalog && <p>正在读取真实工具、模型和 MCP 配置…</p>}
    <button type="button" disabled={busy || !!pending} onClick={() => { setDestination(''); setServerId(''); refresh(value => value + 1); }}>重新读取授权目录</button>
    <fieldset disabled={busy || !!pending}>
      <label>授权来源 <select value={source} onChange={event => { setSource(event.target.value as Source); setDestination(''); setPurpose('model_send'); setScopeId(workspaceId); }}>
        <option value="file">文件资料</option><option value="memory">长期记忆范围</option><option value="mcp">MCP 返回资料</option>
      </select></label>
      <label>授权范围 <select value={scopeId} onChange={event => { setScopeId(event.target.value); setResourceIds([]); setDestination(''); }}>
        <option value={workspaceId}>当前项目</option>
        {source === 'file' ? [...new Set([sessionId, ...resources.map(resource => resource.scope.session_id)].filter((value): value is string => !!value))]
          .map(id => <option key={id} value={id}>会话 {id}</option>) : source === 'memory' && <option value="personal">个人</option>}
      </select></label>
      {source === 'file' && <fieldset><legend>所选文件资料</legend>{available.map(resource => <label key={resource.id}>
        <input type="checkbox" checked={resourceIds.includes(resource.id)} onChange={event => setResourceIds(current => event.target.checked ? [...current, resource.id] : current.filter(id => id !== resource.id))} />{resource.label}
      </label>)}</fieldset>}
      {source === 'mcp' && <label>返回资料的 MCP 配置 <select value={serverId} onChange={event => setServerId(event.target.value)}>
        <option value="">请选择实际服务器修订</option>{catalog?.servers.filter(item => serverAllowed(item.config)).map(item =>
          <option key={item.config.id} value={item.config.id}>{item.config.display_name} · 配置修订 {item.config.revision}</option>)}
      </select></label>}
      <label>发送用途 <select value={purpose} onChange={event => { setPurpose(event.target.value as Purpose); setDestination(''); }}>
        <option value="model_send">发送到模型</option>
        <option value="tool_send">发送到 MCP 工具</option>
        <option value="local_process_send">发送到绑定的本机脚本</option>
      </select></label>
      <label>实际接收目的地 <select value={destination} onChange={event => setDestination(event.target.value)}>
        <option value="">请选择实际目的地</option>{targets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}
      </select></label>
      {destination && <p>{destination}</p>}
      {selectedServer && source === 'mcp' && <p>将授权服务器 {selectedServer.id} · 配置修订 {selectedServer.revision} 的返回资料；不授权其它修订。</p>}
      {source === 'memory' && scope.kind === 'user_global' && <p>个人记忆授权也可在“记忆与上下文”设置中查看和撤销。</p>}
      {purpose === 'local_process_send' && <p>资料发送授权不代表脚本执行许可；执行仍核对所选 Skill 与环境修订。</p>}
      <button disabled={!canSubmit}>确认创建用途授权</button>
    </fieldset>
    {pending && <section><p>命令 {pending.meta.command_id} 的授权结果待核对；原范围 {pending.data.scope.workspace_id ?? '个人'}，原目的地 {pending.data.destination}</p>
      <button type="button" disabled={busy} onClick={() => void submit()}>以原命令重试用途授权</button></section>}
  </form>;
}
