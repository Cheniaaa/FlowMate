import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import type { SettingsSection } from '../../api/windows';
import AssistantSettings from './AssistantSettings';
import ConnectionSettings from './ConnectionSettings';
import WindowSettings from './WindowSettings';
import ResourceSettings from './ResourceSettings';
import { createRuntimeStore } from '../../state/runtime-store';
import MemorySettings from './MemorySettings';
import ExecutionEnvironments from './ExecutionEnvironments';
import type { MemoryScope } from '../../api/memory';

export interface EditorLifecycle {
  onBusyChange?: (busy: boolean) => void;
  onSaved?: (form: HTMLFormElement) => void;
  onDiscard?: (form: HTMLFormElement) => void;
  onViewReady?: () => void;
  guard?: (action: () => void) => void;
}
export default function Settings({ client, section = 'models', onClose, runtimeStore, onSectionChange, onReturnToQuick, onReturnToMemory, memoryScope }: { client: RuntimeClient; section?: SettingsSection; onClose?: () => void; runtimeStore?: ReturnType<typeof createRuntimeStore>; onSectionChange?: (section: SettingsSection) => void; onReturnToQuick?: () => Promise<void>; onReturnToMemory?: () => void; memoryScope?: MemoryScope }) {
  const store = useMemo(() => runtimeStore ?? createRuntimeStore(client), [client, runtimeStore]);
  const [tab, setTab] = useState(section);
  const [busy, setBusy] = useState(false);
  const [returnError, setReturnError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [generation, setGeneration] = useState(0);
  const dirty = useRef(new Set<HTMLFormElement>());
  const continuation = useRef<(() => void) | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const lastSection = useRef(section);
  const queuedSection = useRef<SettingsSection | undefined>(undefined);
  function guard(action: () => void) {
    if (busy) return;
    for (const form of dirty.current) if (!form.isConnected) dirty.current.delete(form);
    if (dirty.current.size) { continuation.current = action; setConfirming(true); } else action();
  }
  useEffect(() => {
    if (lastSection.current !== section) { lastSection.current = section; queuedSection.current = section; }
    if (!busy && queuedSection.current) { const next = queuedSection.current; queuedSection.current = undefined; if (next !== tab) guard(() => setTab(next)); }
  }, [section, busy]);
  useEffect(() => { closeButton.current?.focus(); }, []);
  const keepFocusInside = useCallback(() => {
    if (!busy && document.hasFocus() && root.current && !root.current.contains(document.activeElement)) {
      closeButton.current!.focus();
    }
  }, [busy]);
  function completed(form: HTMLFormElement) {
    dirty.current.delete(form);
    for (const previous of dirty.current) if (!previous.isConnected) dirty.current.delete(previous);
    if (!continuation.current) return;
    if (dirty.current.size) dirty.current.values().next().value!.requestSubmit();
    else { const action = continuation.current; continuation.current = undefined; setConfirming(false); action(); }
  }
  const lifecycle: EditorLifecycle = { onBusyChange: setBusy, onSaved: completed, onDiscard: form => dirty.current.delete(form), onViewReady: keepFocusInside, guard };
  return <div ref={root} className="settings-backdrop" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (confirming) { setConfirming(false); continuation.current = undefined; } else guard(() => onClose?.()); }
    if (event.key === 'Tab') {
      const controls = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><section className="settings-shell" role="dialog" aria-modal="true" aria-label="设置">
    <header className="settings-header"><div><h1>设置</h1><p>管理连接、助理和本机偏好</p></div>
      <button ref={closeButton} className="settings-close" aria-label="关闭设置" disabled={busy} onClick={() => guard(() => onClose?.())}>×</button>
    </header><div className="settings-body"><nav className="settings-tabs" aria-label="设置类别">
      {([['models', '模型与连接'], ['assistant', '助理设置'], ['resources', '资料与授权'], ['memory', '记忆与上下文'], ['environments', '运行环境'], ['windows', '窗口与快捷键']] as const).map(([id, label]) => <button key={id} disabled={busy} aria-pressed={tab === id} onClick={() => guard(() => { setGeneration(value => value + 1); setTab(id); onSectionChange?.(id); })}>{label}</button>)}
    </nav>
    <div className="settings-content" onChangeCapture={event => { const target = event.target as HTMLElement; const form = target.closest('form'); if (form && !target.hasAttribute('data-settings-search')) dirty.current.add(form); }}>
      {confirming && <section className="dirty-confirmation" aria-label="未保存设置"><h2>有未保存的设置</h2><p>保存成功后继续，或明确放弃本次更改。密钥不会写入浏览器存储。</p>
        <button disabled={busy} onClick={() => { continuation.current = undefined; setConfirming(false); }}>继续编辑</button>
        <button disabled={busy} onClick={() => { for (const form of dirty.current) form.reset(); dirty.current.clear(); const action = continuation.current; continuation.current = undefined; setConfirming(false); action?.(); }}>放弃更改</button>
        <button disabled={busy} onClick={() => dirty.current.values().next().value?.requestSubmit()}>保存后继续</button>
      </section>}
      <div key={`${tab}:${generation}`}>
        {tab === 'models' && <ConnectionSettings client={client} {...lifecycle} />}
        {tab === 'assistant' && <AssistantSettings client={client} {...lifecycle} />}
        {tab === 'resources' && <ResourceSettings client={client} store={store} {...lifecycle} />}
        {tab === 'windows' && <WindowSettings {...lifecycle} />}
        {tab === 'memory' && <MemorySettings client={client} store={store} initialScope={memoryScope} {...lifecycle} />}
        {tab === 'environments' && <ExecutionEnvironments client={client} store={store} {...lifecycle} />}
      </div>
    </div></div><footer className="settings-footer"><span>{tab === 'environments' ? '环境变更需重新检测，旧运行不会自动切换' : tab === 'memory' ? '记忆策略不代替模型发送授权' : '配置修改仅对新运行生效'}</span>{returnError && <span role="alert">{returnError}</span>}
      {onReturnToMemory && <button disabled={busy} onClick={() => guard(onReturnToMemory)}>返回记忆与成长</button>}
      {onReturnToQuick && <button disabled={busy} onClick={() => guard(() => { setBusy(true); setReturnError(''); void onReturnToQuick().catch(() => setReturnError('返回快捷小窗失败，请重试')).finally(() => setBusy(false)); })}>返回快捷小窗</button>}
      <button disabled={busy} onClick={() => guard(() => onClose?.())}>完成</button></footer>
  </section></div>;
}
