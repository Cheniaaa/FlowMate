import { useEffect, useRef, useState } from 'react';
import { ApiError, commandMeta } from '../../api/client';
import type { McpClient } from '../../api/mcp';
import type { McpSelectToolsCommand, McpServerView, McpToolSelection } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { FieldLabel, FieldLegend, FieldSet } from '../../components/ui/field';

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
  const emptyCatalog = view.catalog?.tools.length === 0;
  const fixedEmpty = fixed?.selected_names.length === 0;
  const available = view.catalog?.tools.filter(tool => !tool.unavailable_reason).map(tool => tool.name) ?? [];
  const names = draft?.data.selected_names ?? (fixed ? available.filter(name => fixed.selected_names.includes(name)) : available);
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
      {fixedEmpty && <p>已固定为空名单。后续发现的工具也不会自动启用。</p>}
      {!current && view.catalog && <p>工具目录已更新，可核对下方名单并保存。</p>}
    </> : emptyCatalog
      ? <p>当前未发现工具。后续发现的受支持工具会自动启用。</p>
      : <p>默认使用此服务中受支持的工具。</p>}
    {view.catalog && (!emptyCatalog || !current || !fixedEmpty || draft || command) && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      {!emptyCatalog && <FieldSet disabled={disabled || busy || !!command || !view.config.enabled}>
        <FieldLegend>选择允许的工具</FieldLegend>
        {view.catalog.tools.map(tool => <FieldLabel key={tool.name} className="flex items-center gap-2">
          <Checkbox aria-label={`允许工具 ${tool.name}`} disabled={disabled || busy || !!command || !view.config.enabled || tool.unavailable_reason !== null}
            checked={!tool.unavailable_reason && names.includes(tool.name)}
            onCheckedChange={checked => toggle(tool.name, checked === true)} />
          {tool.name}{tool.unavailable_reason && ' · 暂不支持'}
        </FieldLabel>)}
      </FieldSet>}
      {names.length === 0 && !fixedEmpty && <p>固定为空名单后，已发现和后续发现的工具都不会自动启用。</p>}
      {names.length > 0 && <p>取消全部勾选后，可将此服务固定为空名单。</p>}
      <Button type="submit" variant="default" disabled={disabled || busy || !view.config.enabled}>
        {command ? '按原命令核对工具选择' : names.length ? '保存允许的工具' : '固定为空名单'}</Button>
      {draft && <Button type="button" variant="outline" disabled={busy || !!command} onClick={() => {
        setDraft(undefined); setError(''); onDiscard();
      }}>放弃工具选择修改</Button>}
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
