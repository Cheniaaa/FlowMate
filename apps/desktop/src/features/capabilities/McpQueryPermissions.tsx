import { useEffect, useState } from 'react';
import { commandMeta } from '../../api/client';
import type { McpClient } from '../../api/mcp';
import type { McpServerView } from '../../generated/contracts';
import { Button } from '../../components/ui/button';

export default function McpQueryPermissions({ client, view, disabled, onActiveChange }: {
  client: McpClient; view: McpServerView; disabled: boolean; onActiveChange: (active: boolean) => void;
}) {
  const [grants, setGrants] = useState(view.query_grants);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { setGrants(view.query_grants); }, [view.query_grants]);
  useEffect(() => {
    onActiveChange(busy);
    return () => onActiveChange(false);
  }, [busy, onActiveChange]);
  const active = grants.filter(grant => grant.status === 'active');
  if (!active.length) return null;
  return <section aria-label="公共查询许可">
    <h4>已保存的公共查询许可</h4>
    {active.map(grant => <div key={grant.id}>
      <span>{grant.mcp_queries.map(binding => binding.original_name).join('、')} → {grant.destination}</span>
      {grant.mcp_queries.some(binding => binding.config_revision !== view.config.revision
        || binding.catalog_hash !== view.catalog?.content_hash
        || !view.selection?.selected_names.includes(binding.original_name)) && <p>配置、目录或工具选择已改变，此许可当前不适用。</p>}
      <Button type="button" size="sm" disabled={disabled || busy} onClick={async () => {
        setBusy(true); setError('');
        try { await client.revoke(grant.id, commandMeta(grant.version)); setGrants(values => values.filter(item => item.id !== grant.id)); }
        catch { setError('撤销未确认，请重新读取许可后核对。'); }
        finally { setBusy(false); }
      }}>撤销公共查询许可</Button>
    </div>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
