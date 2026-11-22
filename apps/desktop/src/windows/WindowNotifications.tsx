import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PendingCounts } from '../api/windows';
import { toast } from 'sonner';

export default function WindowNotifications({ label }: { label: 'main' | 'quick' }) {
  const [counts, setCounts] = useState<PendingCounts | null>(null);
  useEffect(() => {
    let disposed = false, changed = false, unlisten: UnlistenFn | undefined;
    async function connect() {
      const remove = await listen<PendingCounts>('pending-counts', event => {
        changed = true; if (!disposed) setCounts(event.payload);
      }, { target: label });
      if (disposed) { remove(); return; }
      unlisten = remove;
      const initial = await invoke<PendingCounts | null>('pending_counts');
      if (!disposed && !changed) setCounts(initial);
    }
    connect().catch(() => { if (!disposed) toast.error('通知同步失败，请重新打开窗口', { id: 'window-notifications' }); });
    return () => { disposed = true; unlisten?.(); };
  }, [label]);
  return counts && (counts.pending_actions > 0 || counts.unviewed_results > 0)
    ? <p className="sr-only" role="status" aria-live="polite">待办 {counts.pending_actions} · 未查看结果 {counts.unviewed_results}</p> : null;
}
