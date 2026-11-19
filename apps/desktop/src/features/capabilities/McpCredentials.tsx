import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { McpConfiguredServer, McpImportPreview } from '../../generated/contracts';
import { saveMcpSecret } from './mcp-secrets';

export default function McpCredentials({ config, onBusyChange }: {
  config: McpConfiguredServer; onBusyChange?: (busy: boolean) => void;
}) {
  const slots: McpImportPreview['required_secret_slots'] = [
    ...Object.keys(config.env_refs).map(name => ({ server_id: config.id, slot: config.env_refs[name],
      purpose: 'env' as const, env_name: name })),
    ...(config.credential_ref ? [{ server_id: config.id, slot: config.credential_ref,
      purpose: 'http_token' as const, env_name: null }] : []),
  ];
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), pending = useRef(false);
  useEffect(() => {
    let ignore = false; setValues({}); setConfigured({});
    Promise.all(slots.map(async slot => [slot.slot,
      (await invoke<{ configured: boolean }>('credential_status', { secret_ref: slot.slot })).configured] as const))
      .then(entries => { if (!ignore) setConfigured(Object.fromEntries(entries)); })
      .catch(() => { if (!ignore) setError('无法读取凭据状态。'); });
    return () => { ignore = true; };
  }, [config.id, config.revision]);
  async function act(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try { await action(); }
    catch { setError('系统凭据操作未完成，请重新填写后重试。'); }
    finally { setValues({}); pending.current = false; setBusy(false); onBusyChange?.(false); }
  }
  if (!slots.length) return <p>此配置没有凭据位置。</p>;
  return <form className="mcp-form" aria-label="此修订的 MCP 凭据" onSubmit={event => {
    event.preventDefault(); const frozen = values; setValues({});
    void act(async () => {
      for (const slot of slots) if (frozen[slot.slot]) {
        await saveMcpSecret(config, slot, frozen[slot.slot]);
        setConfigured(current => ({ ...current, [slot.slot]: true }));
      }
    });
  }}>
    <h4>此修订的凭据</h4>
    {slots.map(slot => <div key={slot.slot}>
      <label>{slot.env_name ? `环境变量 ${slot.env_name}` : 'API token'}
        <input type="password" autoComplete="new-password" value={values[slot.slot] ?? ''} disabled={busy}
          onChange={event => setValues(current => ({ ...current, [slot.slot]: event.target.value }))} /></label>
      <span>{configured[slot.slot] === undefined ? '读取状态中' : configured[slot.slot] ? '已配置' : '待填写'}</span>
      <button type="button" disabled={busy || !configured[slot.slot]} onClick={() => void act(async () => {
        const result = await invoke<{ configured: boolean }>('clear_credential', { secret_ref: slot.slot });
        setConfigured(current => ({ ...current, [slot.slot]: result.configured }));
      })}>清除 {slot.env_name ?? 'API token'}</button>
    </div>)}
    <p>补存与清除只影响此服务器修订的凭据；下一次发送会重新核对。</p>
    <button disabled={busy || !Object.values(values).some(Boolean)}>保存此修订的凭据</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
