import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { DropdownMenu as Menu, Popover } from 'radix-ui';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import type { ModelConnection, ModelProfile, ProviderPresetList } from '../../generated/contracts';
import './composer-model-picker.css';

export type ComposerModelPickerProps = {
  models: ModelProfile[];
  connections: ModelConnection[];
  providerPresets?: readonly Pick<ProviderPresetList[number], 'id' | 'display_name'>[];
  recentModelIds: string[];
  modelId: string;
  onModelChange: (id: string) => void;
  effort: string | null;
  effortOptions: readonly string[];
  onEffortChange: (value: string | null) => void;
  disabled?: boolean;
  onLoadCatalog?: () => Promise<void>;
};

const effortLabels = new Map([
  ['none', '关闭'], ['minimal', '极低'], ['low', '低'], ['medium', '中'], ['high', '高'],
  ['xhigh', '极高'], ['max', '最高'],
]);

const protocolNames: Record<ModelConnection['protocol'], string> = {
  openai_compatible: 'OpenAI Chat Completions',
  openai_responses: 'OpenAI Responses',
  anthropic: 'Anthropic Messages',
};

function profileMarker(id: string) {
  // FNV-1a 只使用配置 ID。搜索、目录顺序和凭据变化不影响标记。
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36).toUpperCase();
}

export default function ComposerModelPicker({
  models, connections, providerPresets = [], recentModelIds, modelId, onModelChange, effort, effortOptions,
  onEffortChange, disabled, onLoadCatalog,
}: ComposerModelPickerProps) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const returnOnModelClose = useRef(false);
  const returnOnEffortClose = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string>();
  const [catalogStatus, setCatalogStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const connectionById = new Map(connections.map(connection => [connection.id, connection]));
  const providerNameById = new Map(providerPresets.map(preset => [preset.id, preset.display_name]));
  const rows = models.map(model => {
    const connection = connectionById.get(model.connection_id);
    const name = model.display_name ?? model.model_id;
    const connectionName = connection?.display_name ?? '连接尚未同步';
    const presetId = connection?.provider_preset_id;
    const providerName = presetId ? providerNameById.get(presetId) : undefined;
    return {
      model, name, connectionName, endpoint: connection?.endpoint,
      protocol: connection && protocolNames[connection.protocol],
      label: `${name} · ${connectionName}`,
      groupKey: providerName ? `preset:${presetId}` : connection ? `connection:${connection.id}` : 'unresolved',
      groupLabel: providerName ?? connectionName,
    };
  });
  type Row = typeof rows[number];
  const rowsByLabel = new Map<string, Row[]>();
  for (const row of rows) {
    const namesake = rowsByLabel.get(row.label);
    if (namesake) namesake.push(row);
    else rowsByLabel.set(row.label, [row]);
  }
  const detailsById = new Map<string, { trigger: string; option: string }>();
  for (const namesakes of rowsByLabel.values()) {
    if (namesakes.length < 2) continue;
    const showModelId = new Set(namesakes.map(row => row.model.model_id)).size > 1;
    const showEndpoint = new Set(namesakes.map(row => row.endpoint)).size > 1;
    for (const row of namesakes) {
      const sameModelAndAddress = namesakes.filter(other => other.model.model_id === row.model.model_id && other.endpoint === row.endpoint);
      const protocol = sameModelAndAddress.some(other => other.protocol !== row.protocol) ? row.protocol : undefined;
      const duplicates = sameModelAndAddress.filter(other => other.protocol === row.protocol);
      let marker;
      if (duplicates.length > 1) {
        const code = profileMarker(row.model.id);
        const sameCode = duplicates.map(other => other.model.id).filter(id => profileMarker(id) === code).sort();
        const suffix = sameCode.length > 1 ? `-${sameCode.indexOf(row.model.id) + 1}` : '';
        marker = `配置 ${code}${suffix}`;
      }
      const option = [showEndpoint ? row.endpoint : undefined, protocol, marker].filter(Boolean).join(' · ');
      detailsById.set(row.model.id, {
        trigger: [showModelId ? row.model.model_id : undefined, option].filter(Boolean).join(' · '),
        option,
      });
    }
  }
  const current = rows.find(row => row.model.id === modelId);
  const currentLabel = current?.label ?? (modelId ? '当前模型尚未加载' : '请选择模型');
  const currentDetail = detailsById.get(modelId)?.trigger;
  const currentDescription = currentDetail ? `${currentLabel} · ${currentDetail}` : currentLabel;
  const currentEffort = effort !== null && effortOptions.includes(effort) ? effort : null;
  const effortChoices = [null, ...effortOptions].map(value => ({
    value, label: value === null ? '默认' : effortLabels.get(value) ?? value,
  }));
  const currentEffortLabel = effortChoices.find(choice => choice.value === currentEffort)!.label;

  const matching = rows.filter(row => {
    const fields = [row.name, row.model.model_id, row.model.id, row.connectionName, row.groupLabel,
      row.endpoint, row.protocol, detailsById.get(row.model.id)?.option];
    return terms.every(term => fields.some(field => field?.toLowerCase().includes(term)));
  });
  const remaining = new Map(matching.map(row => [row.model.id, row]));
  const recent = [...new Set(recentModelIds)].flatMap(id => {
    const row = remaining.get(id);
    if (!row) return [];
    remaining.delete(id);
    return [row];
  });
  const providerGroups = new Map<string, { label: string; rows: Row[] }>();
  for (const row of remaining.values()) {
    const group = providerGroups.get(row.groupKey);
    if (group) group.rows.push(row);
    else providerGroups.set(row.groupKey, { label: row.groupLabel, rows: [row] });
  }
  const groups = [
    ...(recent.length ? [{ key: 'recent', label: '最近使用', rows: recent }] : []),
    ...[...providerGroups].map(([key, group]) => ({ key, ...group })),
  ];
  const visibleRows = groups.flatMap(group => group.rows);
  const activeIndex = visibleRows.findIndex(row => row.model.id === activeId);
  const optionId = (id: string) => `${listId}-${id}`;

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) return;
    setQuery('');
    setActiveId(undefined);
    composing.current = false;
    returnOnModelClose.current = false;
    if (onLoadCatalog && catalogStatus !== 'loading') {
      setCatalogStatus('loading');
      void onLoadCatalog().then(() => setCatalogStatus('idle'), () => setCatalogStatus('error'));
    }
  }

  function focusComposer(event: Event) {
    const input = triggerRef.current?.form?.querySelector('textarea');
    if (input) {
      event.preventDefault();
      // 菜单退出动画期间，用户可能已将焦点移到其他控件。
      if (document.activeElement === document.body) input.focus();
    }
  }

  function selectModel(row: Row) {
    returnOnModelClose.current = true;
    setOpen(false);
    onModelChange(row.model.id);
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'Tab') {
      // 先退出 portal，让浏览器从工具栏按钮继续原来的 Tab 顺序。
      triggerRef.current?.focus();
      setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = visibleRows[activeIndex < 0 ? 0 : activeIndex];
      if (row) selectModel(row);
      return;
    }
    if (!visibleRows.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const index = event.key === 'ArrowDown'
      ? (activeIndex + 1) % visibleRows.length
      : (activeIndex < 0 ? visibleRows.length - 1 : (activeIndex - 1 + visibleRows.length) % visibleRows.length);
    const row = visibleRows[index];
    setActiveId(row.model.id);
    const list = listRef.current!;
    const option = document.getElementById(optionId(row.model.id))!;
    const bounds = list.getBoundingClientRect();
    const item = option.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }

  return <div className="composer-model-picker">
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <Button ref={triggerRef} variant="outline" size="sm" className="composer-model-trigger" disabled={disabled}
          aria-label="选择模型" aria-description={currentDescription} title={currentDescription}
          data-has-model-detail={!!currentDetail || undefined}
          onKeyDown={event => {
            if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault();
              changeOpen(true);
            }
          }}>
          <span className="composer-model-trigger-content">
            <span className="composer-model-trigger-label">{currentLabel}</span>
            {currentDetail && <span className="composer-model-identity" dir="ltr">{currentDetail}</span>}
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="ui-menu ui-surface-motion composer-model-popover" aria-label="模型列表"
          side="top" align="start" sideOffset={6} collisionPadding={12}
          onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus(); }}
          onCloseAutoFocus={event => { if (returnOnModelClose.current) focusComposer(event); }}
          onEscapeKeyDown={event => {
            if (composing.current || event.isComposing || event.keyCode === 229) event.preventDefault();
            else returnOnModelClose.current = true;
          }}>
          <div className="composer-model-search">
            <Search size={16} aria-hidden="true" />
            <Input ref={searchRef} role="combobox" aria-label="搜索模型" aria-autocomplete="list"
              aria-expanded={open} aria-controls={listId}
              aria-activedescendant={activeIndex < 0 ? undefined : optionId(visibleRows[activeIndex].model.id)}
              placeholder="搜索模型、提供方、连接或 URL" autoComplete="off" value={query}
              onChange={event => { setQuery(event.target.value); setActiveId(undefined); }}
              onKeyDown={handleSearchKey}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }} />
          </div>
          <div id={listId} ref={listRef} role="listbox" aria-label="可用模型" className="composer-model-results">
            {groups.map(group => <div key={group.key} role="group" aria-label={group.label} className="composer-model-group">
              <div aria-hidden="true" className="composer-model-group-label">{group.label}</div>
              {group.rows.map(row => {
                const detail = detailsById.get(row.model.id)?.option;
                return <div key={row.model.id} id={optionId(row.model.id)} role="option"
                  data-model-id={row.model.id} aria-selected={row.model.id === modelId}
                  data-active={row.model.id === activeId} className="composer-model-option"
                  title={[row.model.model_id, row.connectionName, detail].filter(Boolean).join(' · ')}
                  onMouseDown={event => event.preventDefault()} onClick={() => selectModel(row)}>
                  <div className="composer-model-option-label">
                    <div>{row.name}</div>
                    <div className="composer-model-option-detail">
                      {row.name !== row.model.model_id && <>{row.model.model_id} · </>}{row.connectionName}
                    </div>
                    {detail && <span className="composer-model-identity" dir="ltr">{detail}</span>}
                  </div>
                  {row.model.id === modelId && <Check size={15} aria-hidden="true" />}
                </div>;
              })}
            </div>)}
          </div>
          {catalogStatus === 'loading' ? <p role="status" className="composer-model-status">正在加载模型目录…</p>
            : catalogStatus === 'error' ? <p role="status" className="composer-model-status">模型目录加载失败，请重新打开重试</p>
              : !visibleRows.length && <p role="status" className="composer-model-status">{terms.length ? '未找到匹配模型' : '暂无模型配置'}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    {effortOptions.length > 0 && <DropdownMenu onOpenChange={next => { if (next) returnOnEffortClose.current = false; }}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="composer-thinking-trigger"
          aria-label="思考强度" aria-description={currentEffortLabel} title={`思考：${currentEffortLabel}`}>
          <span>思考：{currentEffortLabel}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" collisionPadding={12} aria-label="思考强度"
        onEscapeKeyDown={() => { returnOnEffortClose.current = true; }}
        onCloseAutoFocus={event => { if (returnOnEffortClose.current) focusComposer(event); }}>
        <Menu.RadioGroup value={currentEffort ?? ''}>
          {effortChoices.map(({ value, label }) => <Menu.RadioItem key={value ?? ''} value={value ?? ''}
            className="composer-thinking-option ui-control-motion"
            onSelect={() => {
              returnOnEffortClose.current = true;
              onEffortChange(value);
            }}>
            <span className="composer-thinking-indicator"><Menu.ItemIndicator><Check size={15} aria-hidden="true" /></Menu.ItemIndicator></span>
            {label}
          </Menu.RadioItem>)}
        </Menu.RadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}
