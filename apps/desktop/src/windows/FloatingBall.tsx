import { useEffect, useState, type PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { windowError, type PendingCounts } from '../api/windows';

export default function FloatingBall() {
  const [counts, setCounts] = useState<PendingCounts | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let changed = false;
    async function subscribe() {
      const remove = await listen<PendingCounts>('pending-counts', event => {
        changed = true;
        if (!disposed) setCounts(event.payload);
      }, { target: 'ball' });
      if (disposed) { remove(); return; }
      unlisten = remove;
      const initial = await invoke<PendingCounts | null>('pending_counts');
      if (!disposed && !changed) setCounts(initial);
    }
    subscribe().catch(error => { if (!disposed) setError(windowError(error)); });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  async function operate(command: 'toggle_quick' | 'show_workbench' | 'start_ball_drag') {
    setError('');
    try { await (command === 'show_workbench' ? invoke(command, { target: null }) : invoke(command)); }
    catch (error) { setError(windowError(error)); }
  }
  function drag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    void operate('start_ball_drag');
  }
  return <main className="floating-ball" aria-label="FlowMate 快捷入口">
    <button className="ball-drag-handle" aria-label="拖动悬浮球" title="拖动悬浮球" onPointerDown={drag}>⠿</button>
    <button className="ball-trigger" aria-label="打开快捷小窗" onClick={() => void operate('toggle_quick')}>F</button>
    <p role="status">{counts ? `${counts.pending_actions} 项待处理 · ${counts.unviewed_results} 项未查看` : '待办同步中'}</p>
    <button className="ball-workbench" onClick={() => void operate('show_workbench')}>打开工作台</button>
    {error && <p role="alert">{error}</p>}
  </main>;
}
