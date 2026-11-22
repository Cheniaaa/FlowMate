import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { RuntimeClient } from '../api/client';
import { setQuickFormActive, showWorkbench, useWindowSettings, windowError, type WindowSettings } from '../api/windows';
import { Conversation } from '../features/chat/Conversation';
import IconButton from '../components/IconButton';
import WindowNotifications from './WindowNotifications';

export default function QuickAssistant({ client }: { client: RuntimeClient }) {
  const { settings, install, error, setError } = useWindowSettings('quick');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function operate(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(windowError(error)); }
    finally { setBusy(false); }
  }
  return <div className="quick-assistant">
    <WindowNotifications label="quick" />
    {error && <p role="alert">{error}</p>}
    <Conversation client={client} compact onSelectedRunChange={setSelectedRunId} onFormActiveChange={setQuickFormActive} headerActions={<div className="quick-controls" aria-label="快捷小窗控制">
      <IconButton icon={settings?.quick_pinned ? 'unpin' : 'pin'} label={settings?.quick_pinned ? '取消置顶' : '置顶小窗'}
        disabled={!settings || busy} aria-pressed={settings?.quick_pinned ?? false} onClick={() => void operate(async () => {
        install(await invoke<WindowSettings>('set_quick_pinned', { pinned: !settings!.quick_pinned }));
      })} />
      <IconButton icon="workbench" label="展开工作台" aria-disabled={busy}
        onClick={() => void operate(() => showWorkbench(selectedRunId ? { kind: 'run', run_id: selectedRunId } : null))} />
      <IconButton icon="hide" label="隐藏快捷小窗" disabled={busy} onClick={() => void operate(() => invoke('toggle_quick'))} />
    </div>} />
  </div>;
}
