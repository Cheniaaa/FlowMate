import { useEffect, useRef, useState } from 'react';
import { ApiError, commandMeta } from '../../api/client';
import type { McpClient } from '../../api/mcp';
import type { GrantRequest, McpServerView } from '../../generated/contracts';

export default function McpQueryPermissions({ client, view, disabled, onActiveChange }: {
  client: McpClient; view: McpServerView; disabled: boolean; onActiveChange: (active: boolean) => void;
}) {
  const [grants, setGrants] = useState(view.query_grants);
  const [destination, setDestination] = useState(''), [tool, setTool] = useState('');
  const [pending, setPending] = useState<GrantRequest>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const working = useRef(false);
  useEffect(() => { setGrants(view.query_grants); }, [view.query_grants]);
  useEffect(() => {
    onActiveChange(busy || !!pending);
    return () => onActiveChange(false);
  }, [busy, pending, onActiveChange]);
  const current = view.selection?.config_revision === view.config.revision &&
    view.selection.catalog_hash === view.catalog?.content_hash;
  async function save() {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    const request = pending ?? { meta: commandMeta(), data: {
      scope: view.config.scope, purposes: ['model_send'] as ['model_send'], destination,
      mcp_queries: [{ server_id: view.config.id, config_revision: view.config.revision,
        catalog_hash: view.catalog!.content_hash, original_name: tool,
        destination: `mcp:${view.config.id}:${view.config.revision}:${view.config.transport === 'http' ? view.config.url : 'stdio'}` }],
    } };
    setPending(request);
    try {
      const grant = await client.grant(request);
      setGrants(values => [...values.filter(item => item.id !== grant.id), grant]); setPending(undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        setPending(undefined);
        setError('公共查询许可未保存，请重新核对当前工具、配置及目的地。');
      } else setError('公共查询许可未确认，请核对工具与目的地后按原命令重试。');
    }
    finally { working.current = false; setBusy(false); }
  }
  return <section aria-label="公共查询许可">
    <p>仅对你明确指定的公共查询免去逐次审批，结果可回到以下模型地址。个人许可可跨项目复用。私有资料外发仍核对用途，外部写入仍需具体审批。</p>
    <fieldset disabled={disabled || busy || !!pending || !current}>
      <label>公共查询工具<select value={tool} onChange={event => setTool(event.target.value)}>
        <option value="">请选择已允许的工具</option>
        {current && view.selection!.selected_names.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label>结果接收模型地址<input type="url" value={destination} onChange={event => setDestination(event.target.value)} /></label>
    </fieldset>
    <button disabled={disabled || busy || !current || (!pending && (!tool || !destination))}
      onClick={() => void save()}>{pending ? '按原命令核对查询许可' : '信任此工具用于公共查询'}</button>
    {grants.filter(grant => grant.status === 'active').map(grant => <div key={grant.id}>
      <span>{grant.mcp_queries.map(binding => binding.original_name).join('、')} → {grant.destination}</span>
      {grant.mcp_queries.some(binding => binding.config_revision !== view.config.revision
        || binding.catalog_hash !== view.catalog?.content_hash
        || !view.selection?.selected_names.includes(binding.original_name)) && <p>配置、目录或工具选择已改变，此许可当前不适用。</p>}
      <button disabled={disabled || busy} onClick={async () => {
        setBusy(true); setError('');
        try { await client.revoke(grant.id, commandMeta(grant.version)); setGrants(values => values.filter(item => item.id !== grant.id)); }
        catch { setError('撤销未确认，请重新读取许可后核对。'); }
        finally { setBusy(false); }
      }}>撤销公共查询许可</button>
    </div>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
