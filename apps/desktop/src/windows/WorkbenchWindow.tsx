import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { RuntimeClient } from '../api/client';
import { windowError, type SettingsNavigation, type SettingsSection, type WorkbenchRequest } from '../api/windows';
import { Conversation, type WorkbenchNavigation } from '../features/chat/Conversation';
import Settings, { type SettingsTransition } from '../features/settings/Settings';
import { createRuntimeStore } from '../state/runtime-store';
import type { MemoryScope } from '../api/memory';
import WindowNotifications from './WindowNotifications';

export default function WorkbenchWindow({ client }: { client: RuntimeClient }) {
  const settingsStore = useMemo(() => createRuntimeStore(client), [client]);
  const [navigation, setNavigation] = useState<WorkbenchNavigation>();
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<SettingsSection>();
  const [connectionId, setConnectionId] = useState<string>();
  const [settingsSequence, setSettingsSequence] = useState(0);
  const [settingsTransition, setSettingsTransition] = useState<SettingsTransition>();
  const settingsRequestId = useRef(0);
  const [fromQuick, setFromQuick] = useState(false);
  const [navigationFromQuick, setNavigationFromQuick] = useState(false);
  const [memoryScope, setMemoryScope] = useState<MemoryScope>();
  const workbench = useRef<HTMLDivElement>(null);
  function restoreFocus(trigger: HTMLElement | null, returnToNavigation = true) {
    const active = document.activeElement;
    if (active?.isConnected && !active.matches('body,html') && !active.closest('.settings-shell,[inert]')) return;
    const host = workbench.current;
    const candidates = [trigger, returnToNavigation && host?.querySelector<HTMLElement>('.sidebar-drawer-toggle'),
      host?.querySelector<HTMLElement>('#message-input')];
    for (const target of candidates) {
      if (!target || !target.isConnected || target.matches('body,html,:disabled') || target.closest('[inert]')) continue;
      target.focus();
      if (document.activeElement === target) return;
    }
  }
  const origin = useRef<HTMLElement | null>(null);
  const settingsOpen = useRef(false);
  function guardSettings(action: (id: number) => void, target?: { section: SettingsSection; connectionId?: string }) {
    const id = ++settingsRequestId.current;
    if (settingsOpen.current) {
      setSettingsTransition({ id, settings: target ? { section: target.section, connectionId: target.connectionId, navigationSequence: id } : undefined, apply: () => action(id) });
    } else action(id);
  }
  function openSettings(section: SettingsSection, fromQuick = false, connection?: string, scope?: MemoryScope) {
    guardSettings(id => {
      if (!settingsOpen.current) {
        const active = document.activeElement as HTMLElement;
        origin.current = active.closest('.run-configuration') ? workbench.current!.querySelector('[aria-label="运行配置"]') : active;
      }
      setMemoryScope(scope);
      settingsOpen.current = true; setFromQuick(fromQuick); setConnectionId(connection); setSettings(section);
      setSettingsSequence(id);
      if (connection !== undefined) setNavigationFromQuick(fromQuick);
    }, { section, connectionId: connection });
  }
  useEffect(() => { if (!settings && settingsOpen.current) { settingsOpen.current = false; setSettingsTransition(undefined); } }, [settings]);
  function returnSettingsFocus() {
    if (!origin.current) return;
    restoreFocus(origin.current, !!origin.current.closest('.sidebar'));
  }
  useEffect(() => {
    let disposed = false; let unlisten: UnlistenFn | undefined; let reading = false; let requested = false;
    async function take() {
      requested = true; if (reading) return; reading = true;
      try { while (requested && !disposed) { requested = false; const target = await invoke<SettingsNavigation | null>('take_settings_navigation'); if (!disposed && target !== null) openSettings(target.section, target.from_quick); } }
      finally { reading = false; }
    }
    async function register() { const remove = await listen<null>('settings-navigation', () => { if (!disposed) void take().catch(error => setError(windowError(error))); }, { target: 'main' }); if (disposed) { remove(); return; } unlisten = remove; await take(); }
    register().catch(error => { if (!disposed) setError(windowError(error)); });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let reading = false;
    let requested = false;
    async function take() {
      requested = true;
      if (reading) return;
      reading = true;
      try {
        while (requested && !disposed) {
          requested = false;
          const request = await invoke<WorkbenchRequest | null>('take_workbench_navigation');
          if (!disposed && request !== null) {
            const target = request.target;
            if (target?.kind === 'connection') openSettings('models', request.from_quick, target.connection_id);
            else guardSettings(() => {
              setNavigationFromQuick(request.from_quick);
              if (target) { setSettings(undefined); setNavigation(current => ({ target, sequence: (current?.sequence ?? 0) + 1 })); }
            });
          }
        }
      } finally { reading = false; }
    }
    const wake = () => { void take().catch(error => { if (!disposed) setError(windowError(error)); }); };
    async function subscribe() {
      const remove = await listen<null>('workbench-navigation', wake, { target: 'main' });
      if (disposed) { remove(); return; }
      unlisten = remove;
      await take();
    }
    subscribe().catch(error => { if (!disposed) setError(windowError(error)); });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  async function returnToQuick() { await invoke('return_to_quick'); setNavigationFromQuick(false); }
  return <div className="workbench-window"><WindowNotifications label="main" />{error && <p role="alert">{error}</p>}<div ref={workbench} className="workbench-host" inert={settings !== undefined}><Conversation obscured={settings !== undefined} runtimeStore={settingsStore} client={client} navigation={navigation} onSettings={(section, connection, scope) => openSettings(section, false, connection, scope)} onReturnToQuick={navigationFromQuick ? returnToQuick : undefined} /></div>
    {settings && <Settings client={client} section={settings} connectionId={connectionId} navigationSequence={settingsSequence} transition={settingsTransition} memoryScope={memoryScope} onReturnToMemory={memoryScope ? () => setSettings(undefined) : undefined}
      onTransitionConsumed={id => setSettingsTransition(current => current?.id === id ? undefined : current)}
      runtimeStore={settingsStore} onSectionChange={setSettings} onClose={() => setSettings(undefined)} onReturnFocus={returnSettingsFocus}
      onReturnToQuick={fromQuick ? async () => { await invoke('return_to_quick'); origin.current = null; setSettings(undefined); } : undefined} />}
  </div>;
}
