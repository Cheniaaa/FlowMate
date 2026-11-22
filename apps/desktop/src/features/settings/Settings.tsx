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
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import IconButton from '../../components/IconButton';
import AppearanceSettings from './AppearanceSettings';
import TitleSettings from './TitleSettings';
import './settings-density.css';

export interface EditorLifecycle {
  onBusyChange?: (busy: boolean) => void;
  onSaved?: (form: HTMLFormElement) => void;
  onDiscard?: (form: HTMLFormElement) => void;
  onViewReady?: () => void;
  guard?: (action: () => void) => void;
}
export interface SettingsTransition {
  id: number; apply: () => void;
  settings?: { section: SettingsSection; connectionId: string | undefined; navigationSequence: number };
}
export default function Settings({ client, section = 'models', connectionId, navigationSequence = 0, transition, onTransitionConsumed, onClose, onReturnFocus, runtimeStore, onSectionChange, onReturnToQuick, onReturnToMemory, memoryScope }: { client: RuntimeClient; section?: SettingsSection; connectionId?: string; navigationSequence?: number; transition?: SettingsTransition; onTransitionConsumed?: (id: number) => void; onClose?: () => void; onReturnFocus?: () => void; runtimeStore?: ReturnType<typeof createRuntimeStore>; onSectionChange?: (section: SettingsSection) => void; onReturnToQuick?: () => Promise<void>; onReturnToMemory?: () => void; memoryScope?: MemoryScope }) {
  const store = useMemo(() => runtimeStore ?? createRuntimeStore(client), [client, runtimeStore]);
  const [tab, setTab] = useState(section);
  const [showTitleSettings, setShowTitleSettings] = useState(false);
  const [editorConnection, setEditorConnection] = useState(connectionId);
  const [busy, setBusy] = useState(false);
  const [returnError, setReturnError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [requestRevision, setRequestRevision] = useState(0);
  const dirty = useRef(new Set<HTMLFormElement>());
  const continuation = useRef<(() => void) | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const lastTarget = useRef({ section, connectionId, navigationSequence });
  const consumedTransition = useRef<number | undefined>(undefined);
  function request(action: () => void) {
    continuation.current = action;
    setRequestRevision(value => value + 1);
  }
  function installTarget(target: typeof lastTarget.current) {
    // 同一次批准同步父窗参数与编辑器，后续 props 更新不再进入第二次确认。
    lastTarget.current = target;
    if (target.connectionId !== undefined || target.section !== tab || target.connectionId !== editorConnection) {
      setGeneration(value => value + 1);
    }
    setEditorConnection(target.connectionId); setTab(target.section);
  }
  function guard(action: () => void) {
    if (busy) return;
    request(action);
  }
  useEffect(() => {
    if (!transition || transition.id === consumedTransition.current) return;
    consumedTransition.current = transition.id;
    // 接收即移交；busy 期间仍替换唯一待执行请求，取消后父窗不能重放。
    request(() => {
      if (transition.settings) installTarget(transition.settings);
      transition.apply();
    });
    onTransitionConsumed?.(transition.id);
  }, [transition]);
  useEffect(() => {
    if (lastTarget.current.section !== section || lastTarget.current.connectionId !== connectionId
      || lastTarget.current.navigationSequence !== navigationSequence) {
      lastTarget.current = { section, connectionId, navigationSequence };
      const target = lastTarget.current;
      request(() => installTarget(target));
    }
  }, [section, connectionId, navigationSequence]);
  useEffect(() => {
    if (busy || !continuation.current) return;
    for (const form of dirty.current) if (!form.isConnected) dirty.current.delete(form);
    if (dirty.current.size) setConfirming(true);
    else {
      const action = continuation.current; continuation.current = undefined;
      setConfirming(false); action();
    }
  }, [busy, requestRevision]);
  useEffect(() => { closeButton.current?.focus(); }, []);
  const keepFocusInside = useCallback(() => {
    if (!busy && document.hasFocus() && root.current && !root.current.contains(document.activeElement)) {
      closeButton.current!.focus();
    }
  }, [busy]);
  function completed(form: HTMLFormElement) {
    window.dispatchEvent(new Event('flowmate:settings-changed'));
    dirty.current.delete(form);
    for (const previous of dirty.current) if (!previous.isConnected) dirty.current.delete(previous);
    if (continuation.current && dirty.current.size) dirty.current.values().next().value!.requestSubmit();
    // 编辑器 onSaved 早于 finally；等 busy 结束后统一执行最新请求。
    setRequestRevision(value => value + 1);
  }
  const lifecycle: EditorLifecycle = { onBusyChange: setBusy, onSaved: completed, onDiscard: form => dirty.current.delete(form), onViewReady: keepFocusInside, guard };
  function selectTab(id: SettingsSection) {
    guard(() => {
      setGeneration(value => value + 1);
      setTab(id);
      lastTarget.current = { ...lastTarget.current, section: id };
      onSectionChange?.(id);
    });
  }
  return <Dialog open onOpenChange={open => { if (!open) guard(() => onClose?.()); }}><DialogContent ref={root} className="settings-shell flex flex-col gap-0 overflow-hidden p-0 max-[760px]:rounded-none" aria-describedby={undefined}
    onCloseAutoFocus={onReturnFocus ? event => { event.preventDefault(); onReturnFocus(); } : undefined}
    onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => {
      event.preventDefault();
      if (event.isComposing || event.keyCode === 229) return;
      if (confirming) { setConfirming(false); continuation.current = undefined; } else guard(() => onClose?.());
    }}>
    <header className="settings-header"><div><DialogTitle asChild><h1>设置</h1></DialogTitle><p>管理连接、助理和本机偏好</p></div>
      <IconButton ref={closeButton} icon="close" label="关闭设置" disabled={busy} onClick={() => guard(() => onClose?.())} />
    </header><div className="settings-body"><nav className="settings-tabs" aria-label="设置类别">
      {([['models', '连接与模型'], ['assistant', '助理设置'], ['resources', '资料与授权'], ['memory', '记忆与上下文'], ['environments', '运行环境'], ['appearance', '外观与主题'], ['windows', '窗口与快捷键']] as const).map(([id, label]) =>
         <Button key={id} variant="ghost" className="shrink-0 justify-start" disabled={busy} aria-pressed={tab === id} onClick={() => selectTab(id)}>{label}</Button>)}
    </nav>
    <div className="settings-content" data-section={tab} onChangeCapture={event => { const target = event.target as HTMLElement; const form = target.closest('form'); if (form && !target.hasAttribute('data-settings-search')) dirty.current.add(form); }}>
      {confirming && <section className="dirty-confirmation" aria-label="未保存设置"><h2>有未保存的设置</h2><p>保存成功后继续，或明确放弃本次更改。密钥不会写入浏览器存储。</p>
        <div className="button-row">
          <Button disabled={busy} onClick={() => { continuation.current = undefined; setConfirming(false); }}>继续编辑</Button>
          <Button disabled={busy} onClick={() => { for (const form of dirty.current) form.reset(); dirty.current.clear(); const action = continuation.current; continuation.current = undefined; setConfirming(false); action?.(); }}>放弃更改</Button>
          <Button variant="default" disabled={busy} onClick={() => dirty.current.values().next().value?.requestSubmit()}>保存后继续</Button>
        </div>
      </section>}
      <div key={`${tab}:${generation}`}>
        {tab === 'models' && <>
          <ConnectionSettings key={editorConnection} client={client} initialConnectionId={editorConnection} {...lifecycle} />
          <section className="mt-5 border-t border-border pt-3">
            <Button variant="ghost" aria-expanded={showTitleSettings} disabled={busy}
              onClick={() => guard(() => setShowTitleSettings(value => !value))}>标题命名</Button>
            {showTitleSettings && <TitleSettings client={client} {...lifecycle} />}
          </section>
        </>}
        {tab === 'assistant' && <AssistantSettings client={client} {...lifecycle} />}
        {tab === 'resources' && <ResourceSettings client={client} store={store} {...lifecycle} />}
        {tab === 'windows' && <WindowSettings {...lifecycle} />}
        {tab === 'memory' && <MemorySettings client={client} store={store} initialScope={memoryScope} {...lifecycle} />}
        {tab === 'environments' && <ExecutionEnvironments client={client} store={store} {...lifecycle} />}
        {tab === 'appearance' && <AppearanceSettings />}
      </div>
    </div></div><footer className="settings-footer flex-wrap"><span>{tab === 'appearance' ? '立即应用到主工作台、快捷小窗和报告' : tab === 'environments' ? '环境变更需重新检测，旧运行不会自动切换' : tab === 'memory' ? '记忆策略不代替模型发送授权' : '配置修改仅对新运行生效'}</span>{returnError && <span role="alert">{returnError}</span>}
      {onReturnToMemory && <IconButton icon="back" label="返回记忆与成长" disabled={busy} onClick={() => guard(onReturnToMemory)} />}
      {onReturnToQuick && <IconButton icon="quick" label="返回快捷小窗" disabled={busy} onClick={() => guard(() => { setBusy(true); setReturnError(''); void onReturnToQuick().catch(() => setReturnError('返回快捷小窗失败，请重试')).finally(() => setBusy(false)); })} />}
      <Button disabled={busy} onClick={() => guard(() => onClose?.())}>完成</Button></footer>
  </DialogContent></Dialog>;
}
