import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { RuntimeClient } from '../api/client';
import { windowError, type SettingsNavigation, type SettingsSection, type WorkbenchRequest } from '../api/windows';
import { Conversation, type WorkbenchNavigation } from '../features/chat/Conversation';
import Settings from '../features/settings/Settings';
import { createRuntimeStore } from '../state/runtime-store';
import AssistantsPage from '../features/assistants/AssistantsPage';
import MemoryPage from '../features/memory/MemoryPage';
import type { MemoryScope } from '../api/memory';
import type { RunSnapshot } from '../generated/contracts';

export default function WorkbenchWindow({ client }: { client: RuntimeClient }) {
  const settingsStore = useMemo(() => createRuntimeStore(client), [client]);
  const skillsRevision = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.getSnapshot().skillsRevision);
  const [navigation, setNavigation] = useState<WorkbenchNavigation>();
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<SettingsSection>();
  const [fromQuick, setFromQuick] = useState(false);
  const [navigationFromQuick, setNavigationFromQuick] = useState(false);
  const [assistantsOpen, setAssistantsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false), [memoryScope, setMemoryScope] = useState<MemoryScope>();
  const [memorySource, setMemorySource] = useState<RunSnapshot>();
  const memoryOrigin = useRef<HTMLElement | null>(null), memoryActive = useRef(false);
  function openMemory(source?: RunSnapshot) { if (!memoryActive.current) memoryOrigin.current = document.activeElement as HTMLElement; setMemorySource(source); memoryActive.current = true; setMemoryOpen(true); }
  useEffect(() => { if (!memoryOpen && memoryActive.current) { memoryActive.current = false; memoryOrigin.current?.focus(); } }, [memoryOpen]);
  const [profileRevision, setProfileRevision] = useState('');
  const assistantOrigin = useRef<HTMLElement | null>(null);
  const assistantsActive = useRef(false);
  function openAssistants() { if (!assistantsActive.current) assistantOrigin.current = document.activeElement as HTMLElement; assistantsActive.current = true; setAssistantsOpen(true); }
  useEffect(() => {
    if (!assistantsOpen && assistantsActive.current) { assistantsActive.current = false; assistantOrigin.current?.focus(); }
  }, [assistantsOpen]);
  const origin = useRef<HTMLElement | null>(null);
  const settingsOpen = useRef(false);
  function openSettings(section: SettingsSection, fromQuick = false) {
    if (!settingsOpen.current) origin.current = document.activeElement as HTMLElement;
    settingsOpen.current = true; setFromQuick(fromQuick); setSettings(section);
  }
  useEffect(() => { if (!settings && settingsOpen.current) { settingsOpen.current = false; origin.current?.focus(); } }, [settings]);
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
            setNavigationFromQuick(request.from_quick);
            if (target?.kind === 'memory') openMemory();
            else if (target?.kind === 'assistants') openAssistants();
            else if (target) setNavigation(current => ({ target, sequence: (current?.sequence ?? 0) + 1 }));
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
  return <div className="workbench-window">{error && <p role="alert">{error}</p>}<div className="workbench-host" inert={settings !== undefined || assistantsOpen || memoryOpen}><Conversation runtimeStore={settingsStore} client={client} navigation={navigation} onSettings={openSettings} onAssistants={openAssistants} onMemory={openMemory} onProfilesChange={setProfileRevision} onReturnToQuick={navigationFromQuick ? returnToQuick : undefined} /></div>
    {memoryOpen && <div inert={settings !== undefined}><MemoryPage client={client} store={settingsStore} initialSource={memorySource} onClose={() => setMemoryOpen(false)}
      onOpenTask={task => { setNavigation(current => ({ target: { kind: 'task', task_id: task.task_id }, sequence: (current?.sequence ?? 0) + 1 })); setMemoryOpen(false); }}
      onSettings={scope => { setMemoryScope(scope); openSettings('memory'); }}
      onReturnToQuick={navigationFromQuick ? async () => { await returnToQuick(); } : undefined} /></div>}
    {assistantsOpen && <AssistantsPage client={client} refreshKey={profileRevision} skillsRevision={skillsRevision} onClose={() => setAssistantsOpen(false)}
      onReturnToQuick={navigationFromQuick ? async () => { await returnToQuick(); assistantsActive.current = false; setAssistantsOpen(false); } : undefined} />}
    {settings && <Settings client={client} section={settings} memoryScope={memoryScope} onReturnToMemory={memoryOpen ? () => setSettings(undefined) : undefined}
      runtimeStore={settingsStore} onSectionChange={setSettings} onClose={() => setSettings(undefined)}
      onReturnToQuick={fromQuick ? async () => { await invoke('return_to_quick'); origin.current = null; setSettings(undefined); } : undefined} />}
  </div>;
}
