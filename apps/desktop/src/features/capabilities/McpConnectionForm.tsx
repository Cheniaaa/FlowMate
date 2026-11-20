import { useEffect, useRef, useState, type FormEvent } from 'react';
import { commandMeta } from '../../api/client';
import type { McpClient } from '../../api/mcp';
import type { McpConfiguredServer, McpImportPreview, McpSaveCommand, ScopeRef } from '../../generated/contracts';
import { splitMcpJson } from './mcp-import';
import { saveMcpSecret } from './mcp-secrets';

export default function McpConnectionForm({ client, scope, initial, generatedJson, onSaved, onCancel, onBusyChange }: {
  client: McpClient; scope: ScopeRef; initial?: McpConfiguredServer; generatedJson?: string;
  onSaved: (config: McpConfiguredServer) => void; onCancel: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<'form' | 'json'>(generatedJson ? 'json' : 'form');
  const [raw, setRaw] = useState(generatedJson ?? '');
  const [name, setName] = useState(initial?.display_name ?? '');
  const [transport, setTransport] = useState<'stdio' | 'http'>(initial?.transport ?? 'stdio');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [args, setArgs] = useState(JSON.stringify(initial?.args ?? []));
  const [cwd, setCwd] = useState(initial?.cwd ?? ''), [url, setUrl] = useState(initial?.url ?? '');
  const [env, setEnv] = useState(JSON.stringify(Object.fromEntries(Object.keys(initial?.env_refs ?? {}).map(key => [key, '']))));
  const [token, setToken] = useState(''), [enabled, setEnabled] = useState(initial?.enabled ?? !generatedJson);
  const [preview, setPreview] = useState<McpImportPreview>();
  const [pending, setPending] = useState<McpSaveCommand[]>();
  const [saved, setSaved] = useState<McpConfiguredServer[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const secrets = useRef(new Map<string, string>()), inflight = useRef(false);
  const [, refreshSecrets] = useState(0);
  useEffect(() => () => { secrets.current.clear(); }, []);

  async function act(action: () => Promise<void>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try { await action(); }
    catch { setError('配置操作未完成，请核对配置或按原命令查询保存结果。'); }
    finally { inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  function source() {
    if (mode === 'json') return raw;
    const entry = transport === 'stdio'
      ? { command, args: JSON.parse(args), ...(cwd ? { cwd } : {}), env: JSON.parse(env) }
      : { url, ...(token || initial?.credential_ref ? { headers: { Authorization: `Bearer ${token}` } } : {}) };
    return JSON.stringify({ mcpServers: { [name]: entry } });
  }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    await act(async () => {
      secrets.current.clear();
      try {
        const split = splitMcpJson(source());
        secrets.current = split.secrets;
        setRaw(''); setEnv('{}'); setToken('');
        const result = await client.previewMcp({ sanitized_json: split.sanitized_json, scope });
        if (result.errors.length || (initial && result.configs.length !== 1)) {
          secrets.current.clear(); setError('配置格式不受支持，请检查字段与参数类型。'); return;
        }
        const configs = result.configs.map(config => ({ ...config, enabled,
          ...(initial ? { id: initial.id, revision: initial.revision + 1 } : {}) }));
        const slots = result.required_secret_slots.map(slot => ({ ...slot,
          server_id: initial ? initial.id : slot.server_id }));
        setPreview({ ...result, configs, required_secret_slots: slots });
        setPending(undefined); setSaved([]); setStatus('');
      } catch {
        secrets.current.clear(); setError('配置格式不受支持，请检查字段与参数类型。');
      } finally { setRaw(''); setEnv('{}'); setToken(''); }
    });
  }

  async function confirm() {
    await act(async () => {
      const commands = pending ?? preview!.configs.map(config => {
        const refs: Record<string, string> = Object.assign(Object.create(null), config.env_refs);
        let credential = config.credential_ref;
        for (const slot of preview!.required_secret_slots.filter(slot => slot.server_id === config.id)) {
          if (slot.purpose === 'env') refs[slot.env_name!] = crypto.randomUUID();
          else credential = crypto.randomUUID();
        }
        return { meta: commandMeta(initial?.revision ?? null), data: {
          config: { ...config, env_refs: refs, credential_ref: credential }, confirmed: true,
        } };
      });
      setPending(commands);
      const confirmed: McpConfiguredServer[] = [];
      try {
        for (const request of commands) confirmed.push(await client.saveMcp(request));
        setSaved(confirmed); setPending(undefined);
        await credentials(confirmed);
      } finally { secrets.current.clear(); refreshSecrets(value => value + 1); }
    });
  }

  async function credentials(configs: McpConfiguredServer[]) {
    let missing = false;
    try {
      for (const config of configs) {
        for (const slot of preview!.required_secret_slots.filter(slot => slot.server_id === config.id)) {
          const value = secrets.current.get(slot.slot);
          if (value) await saveMcpSecret(config, slot, value);
          else missing = true;
        }
      }
      if (missing) { setStatus('配置已保存；请补填凭据后连接。'); return; }
      for (const config of configs) {
        if (config.enabled) {
          const result = await client.discoverMcp(config.id, commandMeta(config.revision));
          if (result.state !== 'connected') { setStatus('配置已保存，连接失败；可从详情重试。'); }
        }
      }
      configs.forEach(onSaved);
    } catch { setError('配置已保存，凭据未完成；请重新填写后补存凭据。'); }
  }

  return <section className="mcp-form" aria-label="MCP 配置编辑">
    {!preview && <form onSubmit={event => void prepare(event)}>
      <fieldset disabled={busy}>
        <legend>{initial ? '编辑 MCP 配置' : '添加 MCP 配置'}</legend>
        {!initial && <div className="mcp-actions">
          <button type="button" onClick={() => { setMode('form'); setRaw(''); }}>连接表单</button>
           <button type="button" onClick={() => { setMode('json'); setEnabled(false); }}>导入 JSON</button>
        </div>}
        {mode === 'json' ? <label>mcpServers JSON<textarea autoComplete="off" rows={10} maxLength={262144}
          value={raw} onChange={event => setRaw(event.target.value)} /></label> : <>
          <label>名称<input required value={name} onChange={event => setName(event.target.value)} /></label>
          <label>传输<select value={transport} onChange={event => { setTransport(event.target.value as typeof transport); setToken(''); setEnv('{}'); }}>
            <option value="stdio">本机 stdio</option><option value="http">Streamable HTTP</option></select></label>
          {transport === 'stdio' ? <>
            <label>Command<input required value={command} onChange={event => setCommand(event.target.value)} /></label>
            <label>Args（JSON 字符串数组）<textarea rows={3} value={args} onChange={event => setArgs(event.target.value)} /></label>
            <label>工作目录<input value={cwd} onChange={event => setCwd(event.target.value)} /></label>
            <label>环境变量（JSON 对象）<textarea autoComplete="off" rows={3} value={env} onChange={event => setEnv(event.target.value)} /></label>
          </> : <>
            <label>URL<input required value={url} onChange={event => setUrl(event.target.value)} /></label>
            <label>API token<input type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} /></label>
          </>}
        </>}
        <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用此配置</label>
        <p>个人/项目范围由能力库选择。秘密请放在环境变量或 API token；命令与参数按原值保存。</p>
        <button>预览配置</button>
      </fieldset>
    </form>}
    {preview && <section aria-label="待确认 MCP 配置">
      <h3>确认连接配置</h3>
      {preview.configs.map(config => <article key={config.id}>
        <strong>{config.display_name}</strong><p>{config.scope.kind === 'user_global' ? '个人' : '项目'} · {config.transport}</p>
        {config.transport === 'stdio' ? <><p>Command：<code>{config.command}</code></p><pre>{JSON.stringify(config.args, null, 2)}</pre>
          <p>工作目录：{config.cwd ?? '未指定'}</p>
          {initial && (initial.command !== config.command || JSON.stringify(initial.args) !== JSON.stringify(config.args)
            || initial.cwd !== config.cwd) && <p>原配置：{initial.command} {JSON.stringify(initial.args)} · 工作目录 {initial.cwd ?? '未指定'}</p>}
          <p>连接与发现会以当前用户权限运行此命令，请确认信任此本机服务。</p></> : <p>URL：<code>{config.url}</code></p>}
      </article>)}
      <p>启用后将连接上述服务并发现工具，首次连接后仍须选择允许的工具。环境变量和认证仅存入系统凭据。</p>
      {preview.required_secret_slots.map(slot => <label key={slot.slot}>
        {slot.purpose === 'env' ? `环境变量 ${slot.env_name}` : 'API token'}（待填写可留空）
        <input type="password" autoComplete="new-password" disabled={busy} value={secrets.current.get(slot.slot) ?? ''}
          onChange={event => { secrets.current.set(slot.slot, event.target.value); refreshSecrets(value => value + 1); }} />
      </label>)}
      {!saved.length && <button disabled={busy} onClick={() => void confirm()}>{pending ? '按原命令核对保存' : enabled ? '连接并启用' : '确认保存配置'}</button>}
      {!!saved.length && <button disabled={busy} onClick={() => void act(async () => {
        try { await credentials(saved); } finally { secrets.current.clear(); refreshSecrets(value => value + 1); }
      })}>补存凭据</button>}
    </section>}
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <button disabled={busy || !!pending} onClick={() => { secrets.current.clear(); onCancel(); }}>取消配置</button>
  </section>;
}
