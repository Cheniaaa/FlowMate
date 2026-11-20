import { useEffect, useRef, useState } from 'react';
import { ApiError, commandMeta } from '../../api/client';
import type { McpClient } from '../../api/mcp';
import type { McpSelectToolsCommand, McpServerView, McpToolSelection } from '../../generated/contracts';

export default function McpPanelTools({ client, view, onSaved, onActiveChange, onDiscard, disabled }: {
  client: McpClient; view: McpServerView; onSaved: (selection: McpToolSelection) => void;
  onActiveChange: (active: boolean) => void; onDiscard: () => void; disabled: boolean;
}) {
  const [draft, setDraft] = useState<McpSelectToolsCommand>();
  const [command, setCommand] = useState<McpSelectToolsCommand>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  const fixed = view.selection;
  const current = fixed?.config_revision === view.config.revision &&
    fixed.catalog_hash === view.catalog?.content_hash;
  const names = draft?.data.selected_names ?? (current ? fixed!.selected_names : []);
  useEffect(() => {
    onActiveChange(!!draft || !!command || busy);
    return () => onActiveChange(false);
  }, [draft, command, busy, onActiveChange]);
  function toggle(name: string, checked: boolean) {
    const selected = checked ? [...names, name] : names.filter(value => value !== name);
    setDraft(previous => ({ meta: previous?.meta ?? commandMeta(fixed?.version ?? null), data: {
      scope: view.config.scope, config_revision: view.config.revision,
      catalog_hash: view.catalog!.content_hash, selected_names: selected,
    } }));
    onActiveChange(true);
    setError('');
  }
  async function save() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const request = command ?? draft ?? { meta: commandMeta(fixed?.version ?? null), data: {
      scope: view.config.scope, config_revision: view.config.revision,
      catalog_hash: view.catalog!.content_hash, selected_names: names,
    } };
    setDraft(request); onActiveChange(true);
    setCommand(request);
    try {
      const result = await client.selectMcpTools(view.config.id, request);
      onSaved(result); setDraft(undefined); setCommand(undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        setCommand(undefined);
        setError('工具选择已改变，请放弃草稿后重新读取，再明确保存。');
      } else setError('工具选择结果未确认，请按原命令核对。');
    } finally { pending.current = false; setBusy(false); }
  }
  return <section aria-label="MCP 允许工具">
    {fixed ? <>
      <p>{current ? '当前固定选择' : '上次固定选择'}：{fixed.selected_names.join('、') || '无'}</p>
      <p>选择版本 {fixed.version} · 配置修订 {fixed.config_revision} · 目录 {fixed.catalog_hash.slice(0, 12)}</p>
      {!current && <p>配置或目录已改变，须基于当前发现目录重新确认。</p>}
    </> : <p>尚未保存允许工具；发现不会自动允许调用。</p>}
    {view.catalog && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={disabled || busy || !!command || !view.config.enabled}>
        <legend>选择允许的工具</legend>
        {view.catalog.tools.map(tool => <label key={tool.name} style={{ display: 'block' }}>
          <input type="checkbox" aria-label={`允许工具 ${tool.name}`} disabled={tool.unavailable_reason !== null}
            checked={!tool.unavailable_reason && names.includes(tool.name)}
            onChange={event => toggle(tool.name, event.target.checked)} />
          {tool.name}{tool.unavailable_reason && ` · 不可用：${tool.unavailable_reason}`}
        </label>)}
      </fieldset>
      <p>保存空选择会停用全部工具，包括已有任务的后续调用。公共查询可另行明示信任；其余调用按实际参数审批。</p>
      <button disabled={disabled || busy || !view.config.enabled}>
        {command ? '按原命令核对工具选择' : '保存允许的工具'}</button>
      {draft && <button type="button" disabled={busy || !!command} onClick={() => {
        setDraft(undefined); setError(''); onDiscard();
      }}>放弃工具选择修改</button>}
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
