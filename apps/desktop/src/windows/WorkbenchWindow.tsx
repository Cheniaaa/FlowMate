import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { RuntimeClient } from '../api/client';
import { windowError, type SettingsNavigation, type SettingsSection } from '../api/windows';
import { Conversation, type WorkbenchNavigation } from '../features/chat/Conversation';
import Settings from '../features/settings/Settings';
import { createRuntimeStore } from '../state/runtime-store';

export default function WorkbenchWindow({ client }: { client: RuntimeClient }) {
  const settingsStore = useMemo(() => createRuntimeStore(client), [client]);
  const [navigation, setNavigation] = useState<WorkbenchNavigation>();
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<SettingsSection>();
  const [fromQuick, setFromQuick] = useState(false);
  const origin = useRef<HTMLElement | null>(null);
  const settingsOpen = useRef(false);
  function openSettings(section: SettingsSection, fromQuick = false) { if (!settingsOpen.current) origin.current = document.activeElement as HTMLElement; settingsOpen.current = true; setFromQuick(fromQuick); setSettings(section); }
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
          const runId = await invoke<string | null>('take_workbench_navigation');
          if (!disposed && runId !== null) setNavigation(current => ({ runId, sequence: (current?.sequence ?? 0) + 1 }));
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
  return <div className="workbench-window">{error && <p role="alert">{error}</p>}<div className="workbench-host" inert={settings !== undefined}><Conversation client={client} navigation={navigation} onSettings={openSettings} /></div>
    {settings && <Settings client={client} section={settings} runtimeStore={settingsStore} onSectionChange={setSettings} onClose={() => setSettings(undefined)}
      onReturnToQuick={fromQuick ? async () => { await invoke('return_to_quick'); origin.current = null; setSettings(undefined); } : undefined} />}
  </div>;
}
