import { useEffect, useRef, useState } from 'react';
import { commandMeta } from '../../api/client';
import type { McpClient, McpQuery } from '../../api/mcp';
import type { CommandMeta, McpConfiguredServer, McpServerPage, ScopeRef } from '../../generated/contracts';
import McpConnectionForm from './McpConnectionForm';
import McpCredentials from './McpCredentials';
import McpPanelTools from './McpPanelTools';
import McpQueryPermissions from './McpQueryPermissions';
import './mcp.css';

const states = { saved: '已保存', connecting: '连接中', connected: '已连接', failed: '连接失败', stopped: '已停用' };
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
      <label>MCP 范围<select disabled={busy || !!editor || !!discovering || toolsActive} value={scope.kind}
        onChange={event => setScope(event.target.value === 'workspace'
          ? { kind: 'workspace', workspace_id: workspaceId!, session_id: null }
          : { kind: 'user_global', workspace_id: null, session_id: null })}>
        <option value="user_global">个人</option>{workspaceId && <option value="workspace">当前项目</option>}
      </select></label>
      <label>搜索 MCP<input disabled={busy || !!editor || !!discovering || toolsActive} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button disabled={busy || !!editor || !!discovering || toolsActive} onClick={() => setEditor({})}>添加 MCP</button>
      <button disabled={busy || !!editor || !!discovering || toolsActive} onClick={() => refresh(value => value + 1)}>刷新配置</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {editor ? <McpConnectionForm key={editor.initial?.id ?? 'new'} client={client} scope={scope} initial={editor.initial}
      onSaved={config => { select(config.id); setEditor(undefined); refresh(value => value + 1); }}
      onCancel={() => setEditor(undefined)} /> : <>
      {!page && !error && <p>正在读取 MCP 配置…</p>}
      {page?.items.length === 0 && <p>没有匹配的 MCP 配置。</p>}
      <div className="mcp-layout">
        <aside aria-label="MCP 配置列表">{page?.items.map(item => <button className="mcp-server" key={item.config.id}
          disabled={busy || !!discovering || toolsActive} aria-pressed={selected === item.config.id} onClick={() => select(item.config.id)}>
          <strong>{item.config.display_name}</strong><span>{item.config.scope.kind === 'user_global' ? '个人' : '项目'} · {item.config.transport}</span>
          <span>{states[item.state]} · {item.catalog?.tools.length ?? 0} 个工具</span></button>)}
          {page?.next_cursor && <button disabled={busy || toolsActive} onClick={async () => {
            setBusy(true);
            try { const next = await client.mcpServers({ ...parameters, cursor: page.next_cursor! }); setPage({ ...next, items: [...page.items, ...next.items] }); }
            catch { setError('MCP 配置读取失败，请刷新。'); } finally { setBusy(false); }
          }}>更多 MCP</button>}
        </aside>
        {view && <section aria-label="MCP 配置详情">
          <h3>{view.config.display_name}</h3><p>{states[view.state]} · {view.catalog?.tools.length ?? 0} 个工具</p>
          <details><summary>连接技术详情</summary><p>配置修订 {view.config.revision}</p><code>{view.config.id}</code>
            {view.catalog && <p>目录 {view.catalog.content_hash}</p>}</details>
          {view.config.transport === 'stdio' ? <><code>{view.config.command}</code><pre>{JSON.stringify(view.config.args, null, 2)}</pre>
            <p>工作目录：{view.config.cwd ?? '未指定'}</p></>
            : <code>{view.config.url}</code>}
          {view.error_code && <section><p role="alert">{view.error_code === 'mcp_connection_trust_changed'
            ? '本机程序或参数文件已改变。请核对当前命令、参数和工作目录后重新连接。'
            : '此服务暂时无法连接，请检查连接配置。'}</p><details><summary>错误诊断</summary><code>{view.error_code}</code></details></section>}
          {view.config.transport === 'stdio' && <p>连接与发现会以当前用户权限运行上述命令，请仅连接可信的本机服务。</p>}
          <div className="mcp-actions"><button disabled={busy || toolsActive || !view.config.enabled} onClick={() => void discover()}>
            {discovering ? '按原命令核对连接' : view.error_code === 'mcp_connection_trust_changed'
              ? '确认当前目标并重新连接' : '连接并发现工具'}</button>
            <button disabled={busy || toolsActive || !!discovering} onClick={() => setEditor({ initial: view.config })}>编辑配置</button></div>
          <p>已信任且启用的配置将在启动时自动连接。工具选择与公共查询许可可分别撤销；工具注解仅供参考。</p>
          <McpCredentials key={`${view.config.id}:${view.config.revision}`} config={view.config} onBusyChange={setBusy} />
          <McpPanelTools key={`tools:${view.config.id}:${view.config.revision}`} client={client} view={view}
            disabled={busy || !!discovering}
            onActiveChange={setToolsActive} onDiscard={() => refresh(value => value + 1)}
            onSaved={selection => setPage(current => ({ ...current!,
              items: current!.items.map(item => item.config.id === selection.server_id ? { ...item, selection } : item) }))} />
          <McpQueryPermissions key={`query:${view.config.id}:${view.config.revision}:${view.selection?.version}`}
            client={client} view={view} onActiveChange={setBusy}
            disabled={toolsActive || !!discovering || !view.config.enabled} />
          {view.catalog && <>
            {view.catalog.tools.map(tool => <details key={tool.name}><summary>{tool.name}</summary>
              <p>{tool.description}</p>{tool.unavailable_reason && <p>{tool.unavailable_reason}</p>}
              <pre>{JSON.stringify({ input_schema: tool.input_schema, output_schema: tool.output_schema, annotations: tool.annotations }, null, 2)}</pre>
            </details>)}</>}
        </section>}
      </div>
    </>}
  </section>;
}
