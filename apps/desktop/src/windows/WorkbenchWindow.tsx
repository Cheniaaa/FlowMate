import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { RuntimeClient } from '../api/client';
import { windowError, type SettingsNavigation, type SettingsSection, type WorkbenchRequest } from '../api/windows';
import { Conversation, type WorkbenchNavigation } from '../features/chat/Conversation';
import Settings, { type SettingsTransition } from '../features/settings/Settings';
import { createRuntimeStore } from '../state/runtime-store';
import AssistantsPage from '../features/assistants/AssistantsPage';
import MemoryPage from '../features/memory/MemoryPage';
import type { MemoryScope } from '../api/memory';
import type { RunSnapshot } from '../generated/contracts';
import WindowNotifications from './WindowNotifications';

export default function WorkbenchWindow({ client }: { client: RuntimeClient }) {
  const settingsStore = useMemo(() => createRuntimeStore(client), [client]);
  const skillsRevision = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.getSnapshot().skillsRevision);
  const [navigation, setNavigation] = useState<WorkbenchNavigation>();
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<SettingsSection>();
  const [connectionId, setConnectionId] = useState<string>();
  const [settingsSequence, setSettingsSequence] = useState(0);
  const [settingsTransition, setSettingsTransition] = useState<SettingsTransition>();
  const settingsRequestId = useRef(0);
  const [fromQuick, setFromQuick] = useState(false);
  const [navigationFromQuick, setNavigationFromQuick] = useState(false);
  const [assistantsOpen, setAssistantsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false), [memoryScope, setMemoryScope] = useState<MemoryScope>();
  const [memorySource, setMemorySource] = useState<RunSnapshot>();
  const memoryOrigin = useRef<HTMLElement | null>(null), memoryActive = useRef(false);
  function showMemory(source?: RunSnapshot) { if (!memoryActive.current) memoryOrigin.current = document.activeElement as HTMLElement; setSettings(undefined); setAssistantsOpen(false); setMemorySource(source); memoryActive.current = true; setMemoryOpen(true); }
  function openMemory(source?: RunSnapshot) { guardSettings(() => showMemory(source)); }
  useEffect(() => { if (!memoryOpen && memoryActive.current) { memoryActive.current = false; memoryOrigin.current?.focus(); } }, [memoryOpen]);
  const [profileRevision, setProfileRevision] = useState('');
  const assistantOrigin = useRef<HTMLElement | null>(null);
  const assistantsActive = useRef(false);
  function showAssistants() { if (!assistantsActive.current) assistantOrigin.current = document.activeElement as HTMLElement; setSettings(undefined); setMemoryOpen(false); assistantsActive.current = true; setAssistantsOpen(true); }
  function openAssistants() { guardSettings(showAssistants); }
  useEffect(() => {
    if (!assistantsOpen && assistantsActive.current) { assistantsActive.current = false; assistantOrigin.current?.focus(); }
  }, [assistantsOpen]);
  const origin = useRef<HTMLElement | null>(null);
  const settingsOpen = useRef(false);
  function guardSettings(action: (id: number) => void, target?: { section: SettingsSection; connectionId?: string }) {
    const id = ++settingsRequestId.current;
    if (settingsOpen.current) {
      setSettingsTransition({ id, settings: target ? { section: target.section, connectionId: target.connectionId, navigationSequence: id } : undefined, apply: () => action(id) });
    } else action(id);
  }
  function openSettings(section: SettingsSection, fromQuick = false, connection?: string) {
    guardSettings(id => {
      setAssistantsOpen(false);
      if (!settingsOpen.current) origin.current = document.activeElement as HTMLElement;
      settingsOpen.current = true; setFromQuick(fromQuick); setConnectionId(connection); setSettings(section);
      setSettingsSequence(id);
      if (connection !== undefined) setNavigationFromQuick(fromQuick);
    }, { section, connectionId: connection });
  }
  useEffect(() => { if (!settings && settingsOpen.current) { settingsOpen.current = false; setSettingsTransition(undefined); } }, [settings]);
  function returnSettingsFocus() {
    if (!origin.current) return;
    const active = document.activeElement as HTMLElement | null;
    // 已由用户或新页面接管的焦点不回抢；自动跳转没有有效触发控件时回到原输入。
    if (active && active !== document.body && active !== document.documentElement && active.isConnected
      && !active.closest('.settings-shell,[inert]')) return;
    const trigger = origin.current;
    const target = trigger?.isConnected && !trigger.matches('body,html,:disabled')
      ? trigger : document.getElementById('message-input');
    if (target && !target.closest('[inert]')) target.focus();
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
              if (target?.kind === 'memory') showMemory();
              else if (target?.kind === 'assistants') showAssistants();
              else if (target) { setSettings(undefined); setAssistantsOpen(false); setMemoryOpen(false); setNavigation(current => ({ target, sequence: (current?.sequence ?? 0) + 1 })); }
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
  return <div className="workbench-window"><WindowNotifications label="main" />{error && <p role="alert">{error}</p>}<div className="workbench-host" inert={settings !== undefined || assistantsOpen || memoryOpen}><Conversation obscured={settings !== undefined || assistantsOpen || memoryOpen} runtimeStore={settingsStore} client={client} navigation={navigation} onSettings={openSettings} onAssistants={openAssistants} onMemory={openMemory} onProfilesChange={setProfileRevision} onReturnToQuick={navigationFromQuick ? returnToQuick : undefined} /></div>
    {memoryOpen && <div inert={settings !== undefined}><MemoryPage client={client} store={settingsStore} initialSource={memorySource} onClose={() => setMemoryOpen(false)}
      onOpenTask={task => { setNavigation(current => ({ target: { kind: 'task', task_id: task.task_id }, sequence: (current?.sequence ?? 0) + 1 })); setMemoryOpen(false); }}
      onSettings={scope => { setMemoryScope(scope); openSettings('memory'); }}
      onReturnToQuick={navigationFromQuick ? async () => { await returnToQuick(); } : undefined} /></div>}
    {assistantsOpen && <AssistantsPage client={client} refreshKey={profileRevision} skillsRevision={skillsRevision} onClose={() => setAssistantsOpen(false)}
      onReturnToQuick={navigationFromQuick ? async () => { await returnToQuick(); assistantsActive.current = false; setAssistantsOpen(false); } : undefined} />}
    {settings && <Settings client={client} section={settings} connectionId={connectionId} navigationSequence={settingsSequence} transition={settingsTransition} memoryScope={memoryScope} onReturnToMemory={memoryOpen ? () => setSettings(undefined) : undefined}
      onTransitionConsumed={id => setSettingsTransition(current => current?.id === id ? undefined : current)}
      runtimeStore={settingsStore} onSectionChange={setSettings} onClose={() => setSettings(undefined)} onReturnFocus={returnSettingsFocus}
      onReturnToQuick={fromQuick ? async () => { await invoke('return_to_quick'); origin.current = null; setSettings(undefined); } : undefined} />}
  </div>;
}
