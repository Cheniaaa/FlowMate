import { useEffect, useRef, useState } from 'react';
import { commandMeta } from '../../api/client';
import type { McpClient, McpQuery } from '../../api/mcp';
import type { CommandMeta, McpConfiguredServer, McpServerPage, McpServerView, ScopeRef } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import IconButton, { UiIcon } from '../../components/IconButton';
import McpConnectionForm from './McpConnectionForm';
import McpCredentials from './McpCredentials';
import McpPanelTools from './McpPanelTools';
import McpQueryPermissions from './McpQueryPermissions';
import './mcp.css';

const states = { saved: '已保存', connecting: '连接中', connected: '已连接', failed: '连接失败', stopped: '已停用' };

function cardTarget(config: McpConfiguredServer) {
  if (config.transport === 'stdio') return config.command;
  if (!config.url) return null;
  try {
    const target = new URL(config.url);
    return target.protocol === 'http:' || target.protocol === 'https:' ? `${target.origin}${target.pathname}` : null;
  } catch {
    // 无法安全解析的旧地址只在原配置详情中显示。
    return null;
  }
}

function toolCount(catalog: McpServerView['catalog']) {
  return catalog ? `${catalog.tools.length} 个工具` : '工具数量未知';
}

export default function McpPanel({ client, workspaceId, initialServerId, initialScope, onBusyChange, refreshKey = 0 }: {
  client: McpClient; workspaceId?: string; initialServerId?: string; onBusyChange?: (busy: boolean) => void;
  initialScope?: ScopeRef;
  refreshKey?: number;
}) {
  const [scope, setScope] = useState<ScopeRef>(initialScope ??
    { kind: 'user_global', workspace_id: null, session_id: null });
  const [query, setQuery] = useState(''), [page, setPage] = useState<McpServerPage>();
  const [selected, select] = useState(initialServerId ?? ''), [revision, refresh] = useState(0);
  const [editor, setEditor] = useState<{ initial?: McpConfiguredServer }>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState<{ id: string; meta: CommandMeta }>();
  const [observedRefresh, setObservedRefresh] = useState(refreshKey);
  const [toolsActive, setToolsActive] = useState(false);
  const pending = useRef(false);
  const pendingTarget = useRef(initialServerId);
  useEffect(() => { onBusyChange?.(busy || !!editor || toolsActive || !!discovering); return () => onBusyChange?.(false); }, [busy, editor, toolsActive, discovering, onBusyChange]);
  useEffect(() => {
    if (!editor && !busy && !discovering && !toolsActive) setObservedRefresh(refreshKey);
  }, [refreshKey, editor, busy, discovering, toolsActive]);
  const parameters: McpQuery = { scope_kind: scope.kind as McpQuery['scope_kind'],
    ...(scope.workspace_id ? { workspace_id: scope.workspace_id } : {}), query };
  useEffect(() => {
    let ignore = false; setPage(undefined); setError('');
    client.mcpServers(parameters).then(async value => {
      const target = pendingTarget.current;
      if (target && !value.items.some(item => item.config.id === target)) {
        const exact = await client.mcpServer(target);
        if (exact.config.scope.kind !== scope.kind || exact.config.scope.workspace_id !== scope.workspace_id) {
          throw new Error('mcp_scope_mismatch');
        }
        value = { ...value, items: [exact, ...value.items] };
      }
      if (!ignore) {
        pendingTarget.current = undefined;
        setPage(value);
        select(current => value.items.some(item => item.config.id === current) ? current : value.items[0]?.config.id ?? '');
      }
    }).catch(() => { if (!ignore) setError('MCP 配置读取失败，请刷新。'); });
    return () => { ignore = true; };
  }, [client, scope, query, revision, observedRefresh]);
  const view = page?.items.find(item => item.config.id === selected);
  const sameTarget = new Map<string, string[]>();
  const duplicateLabels = new Map<string, string>();
  for (const { config } of page?.items ?? []) {
    if (config.transport !== 'stdio') continue;
    const key = JSON.stringify([config.display_name, config.command]);
    const ids = sameTarget.get(key) ?? [];
    ids.push(config.id);
    sameTarget.set(key, ids);
  }
  for (const group of sameTarget.values()) {
    if (group.length > 1) group.forEach((id, index) => duplicateLabels.set(id, `同名配置 ${index + 1}`));
  }
  const controlsLocked = busy || !!editor || !!discovering || toolsActive;
  async function discover() {
    if (!view || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const request = discovering ?? { id: view.config.id, meta: commandMeta(view.config.revision) };
    setDiscovering(request);
    try {
      const result = await client.discoverMcp(request.id, request.meta);
      setPage(current => ({ ...current!, items: current!.items.map(item => item.config.id === result.config.id ? result : item) }));
      setDiscovering(undefined);
    } catch { setError('连接结果未确认，请按原命令核对。'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="mcp-panel" aria-label="MCP 服务器">
    <div className="mcp-toolbar">
      <FieldLabel>MCP 范围<NativeSelect disabled={controlsLocked} value={scope.kind}
        onChange={event => setScope(event.target.value === 'workspace'
          ? { kind: 'workspace', workspace_id: workspaceId!, session_id: null }
          : { kind: 'user_global', workspace_id: null, session_id: null })}>
        <NativeSelectOption value="user_global">个人</NativeSelectOption>
        {workspaceId && <NativeSelectOption value="workspace">当前项目</NativeSelectOption>}
      </NativeSelect></FieldLabel>
      <FieldLabel>搜索 MCP<Input disabled={controlsLocked} value={query} onChange={event => setQuery(event.target.value)} /></FieldLabel>
      <IconButton icon="refresh" label="刷新配置" disabled={controlsLocked} onClick={() => refresh(value => value + 1)} />
    </div>
    {error && <p role="alert">{error}</p>}
    {editor ? <McpConnectionForm key={editor.initial?.id ?? 'new'} client={client} scope={scope} initial={editor.initial}
      onSaved={config => { select(config.id); setEditor(undefined); refresh(value => value + 1); }}
      onCancel={() => setEditor(undefined)} /> : <>
      {!page && !error && <p>正在读取 MCP 配置…</p>}
      {page?.items.length === 0 && <p>没有匹配的 MCP 配置。</p>}
      <div className="mcp-layout library-layout">
         <aside aria-label="MCP 配置列表" className="skill-list">
           <Button type="button" variant="default" className="mcp-add-card" disabled={controlsLocked} onClick={() => setEditor({})}>
             <UiIcon name="add" />添加 MCP
           </Button>
           {page?.items.map(item => {
             const { config } = item;
             const target = cardTarget(config);
             return <Button type="button" variant={selected === config.id ? 'secondary' : 'ghost'} className="capability-card" key={config.id}
               disabled={controlsLocked} aria-pressed={selected === config.id} onClick={() => select(config.id)}>
               <span className="mcp-card-title">
                 <strong>{config.display_name}</strong>
                 <span className="mcp-card-state" data-state={config.enabled ? item.state : 'stopped'}>
                   {config.enabled ? states[item.state] : '未启用'}
                 </span>
               </span>
                {target && <code className="mcp-card-target" title={target}>{target}</code>}
                <span className="text-xs text-muted-foreground">
                  {duplicateLabels.has(config.id) && `${duplicateLabels.get(config.id)} · `}
                  {config.scope.kind === 'user_global' ? '个人' : '项目'} · {config.transport === 'stdio' ? '本机 stdio' : '远程 HTTP'} · {toolCount(item.catalog)}
               </span>
             </Button>;
           })}
          {page?.next_cursor && <Button type="button" size="sm" variant="ghost" disabled={busy || toolsActive} onClick={async () => {
            setBusy(true);
            try { const next = await client.mcpServers({ ...parameters, cursor: page.next_cursor! }); setPage({ ...next, items: [...page.items, ...next.items] }); }
            catch { setError('MCP 配置读取失败，请刷新。'); } finally { setBusy(false); }
          }}>更多 MCP</Button>}
        </aside>
          {view && <section aria-label="MCP 配置详情" className="skill-detail flex flex-col gap-3 [overflow-wrap:anywhere]">
             <div><h3 className="text-xl font-semibold">{view.config.display_name}</h3><p className="text-sm text-muted-foreground">
               {duplicateLabels.has(view.config.id) && `${duplicateLabels.get(view.config.id)} · `}
               {states[view.state]} · {toolCount(view.catalog)}</p></div>
            <dl className="mcp-endpoint">
              {view.config.transport === 'stdio' ? <>
                <dt>启动命令</dt><dd><code>{view.config.command}</code></dd>
                {view.config.args.length > 0 && <><dt>参数</dt><dd className="mcp-arguments">{view.config.args.map((arg, index) =>
                   <code key={index} className="whitespace-pre-wrap">{arg || '""'}</code>)}</dd></>}
                {view.config.cwd && <><dt>工作目录</dt><dd><code>{view.config.cwd}</code></dd></>}
              </> : <><dt>服务地址</dt><dd><code>{view.config.url}</code></dd></>}
            </dl>
          {view.error_code && <section><p role="alert">{view.error_code === 'mcp_connection_trust_changed'
            ? '本机程序或参数文件已改变。请核对当前命令、参数和工作目录后重新连接。'
             : '此服务暂时无法连接，请检查连接配置。'}</p></section>}
           {view.config.transport === 'stdio' && <p>{duplicateLabels.has(view.config.id) && '连接或授权前，请核对上方原始参数。'}连接与发现会以当前用户权限运行上述命令，请仅连接可信的本机服务。</p>}
           <div className="mcp-actions"><Button variant="default" disabled={busy || toolsActive || !view.config.enabled} onClick={() => void discover()}>
            {discovering ? '按原命令核对连接' : view.error_code === 'mcp_connection_trust_changed'
               ? '确认当前目标并重新连接' : '连接并发现工具'}</Button>
             <Button disabled={busy || toolsActive || !!discovering} onClick={() => setEditor({ initial: view.config })}>编辑配置</Button></div>
          <McpCredentials key={`${view.config.id}:${view.config.revision}`} config={view.config} onBusyChange={setBusy} />
          <McpPanelTools key={`tools:${view.config.id}:${view.config.revision}`} client={client} view={view}
            disabled={busy || !!discovering}
            onActiveChange={setToolsActive} onDiscard={() => refresh(value => value + 1)}
            onSaved={selection => setPage(current => ({ ...current!,
              items: current!.items.map(item => item.config.id === selection.server_id ? { ...item, selection } : item) }))} />
          <McpQueryPermissions key={`query:${view.config.id}:${view.config.revision}:${view.selection?.version}`}
            client={client} view={view} onActiveChange={setBusy}
            disabled={toolsActive || !!discovering} />
          {view.catalog && <>
             {view.catalog.tools.map(tool => <details key={tool.name} className="rounded-md border border-border bg-background p-3"><summary className="cursor-pointer">{tool.name}</summary>
              <p>{tool.description}</p>{tool.unavailable_reason && <p>暂不支持此工具的定义。</p>}
              <pre>{JSON.stringify({ input_schema: tool.input_schema, output_schema: tool.output_schema, annotations: tool.annotations }, null, 2)}</pre>
            </details>)}</>}
        </section>}
      </div>
    </>}
  </section>;
}
