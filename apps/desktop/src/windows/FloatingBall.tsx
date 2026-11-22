import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PendingCounts } from '../api/windows';
import { Button } from '../components/ui/button';
import './desktop-pet.css';

const DRAG_THRESHOLD = 6;
const operationErrors = {
  start_ball_drag: '无法移动折纸鸟，请重试。',
  toggle_quick: '无法切换快捷小窗，请重试或使用系统托盘。',
};

export default function FloatingBall() {
  const [counts, setCounts] = useState<PendingCounts | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [actionError, setActionError] = useState('');
  const statusId = useId();
  const errorId = useId();
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let changed = false;
    async function subscribe() {
      const remove = await listen<PendingCounts | null>('pending-counts', event => {
        if (disposed) return;
        changed = true;
        setCounts(event.payload);
        setSyncFailed(false);
      }, { target: 'ball' });
      if (disposed) { remove(); return; }
      unlisten = remove;
      const initial = await invoke<PendingCounts | null>('pending_counts');
      if (!disposed && !changed) setCounts(initial);
    }
    subscribe().catch(() => { if (!disposed && !changed) setSyncFailed(true); });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  async function operate(command: keyof typeof operationErrors) {
    setActionError('');
    try { await invoke(command); }
    catch { setActionError(operationErrors[command]); }
  }

  function beginPress(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function trackPress(event: PointerEvent<HTMLButtonElement>) {
    const start = press.current;
    if (!start || start.id !== event.pointerId || !(event.buttons & 1)) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return;
    press.current = null;
    suppressClick.current = true;
    void operate('start_ball_drag');
  }

  function finishPress(event: PointerEvent<HTMLButtonElement>) {
    const start = press.current;
    if (!start || start.id !== event.pointerId || event.button !== 0) return;
    press.current = null;
    suppressClick.current = Math.hypot(event.clientX - start.x, event.clientY - start.y) >= DRAG_THRESHOLD;
  }

  function cancelPress(event: PointerEvent<HTMLButtonElement>) {
    if (press.current?.id !== event.pointerId) return;
    press.current = null;
    suppressClick.current = true;
  }

  let pose = 'syncing';
  if (counts) {
    if (counts.pending_actions > 0) pose = 'attention';
    else if (counts.unviewed_results > 0) pose = 'mail';
    else pose = 'idle';
  }
  const status = counts ? `${counts.pending_actions} 项待处理 · ${counts.unviewed_results} 项未查看`
    : syncFailed ? '待办状态暂不可用' : '待办同步中';
  const error = actionError || (syncFailed ? '无法同步待办，请在快捷小窗查看。' : '');
  const tooltip = ['FlowMate 折纸鸟', status, error, '短按切换快捷小窗，拖动可移动'].filter(Boolean).join('\n');

  return <main className="desktop-pet" aria-label="FlowMate 快捷入口">
    <Button type="button" variant="ghost" className="desktop-pet__button touch-none select-none border-0 p-0 hover:bg-transparent" data-pose={pose}
      aria-label="FlowMate 折纸鸟，切换快捷小窗" aria-describedby={error ? `${statusId} ${errorId}` : statusId}
      title={tooltip} onPointerDown={beginPress} onPointerMove={trackPress} onPointerUp={finishPress}
      onPointerCancel={cancelPress} onLostPointerCapture={cancelPress}
      onClick={event => {
        // 原生移动结束后仍可能收到 click。键盘和辅助技术激活不经过手势。
        if (event.detail === 0 || !suppressClick.current) void operate('toggle_quick');
      }}>
      <span key={pose} className="desktop-pet__art" aria-hidden="true">
        <span className="desktop-pet__far-wing" />
        <span className="desktop-pet__tail" />
        <span className="desktop-pet__body" />
        <span className="desktop-pet__wing" />
        <span className="desktop-pet__head">
          <span className="desktop-pet__face" />
          <span className="desktop-pet__beak" />
          <span className="desktop-pet__eye" />
        </span>
        {pose === 'mail' && <span className="desktop-pet__letter" />}
      </span>
    </Button>
    <p id={statusId} className="desktop-pet__feedback" role="status">{status}</p>
    {error && <p id={errorId} className="desktop-pet__feedback" role="alert">{error}</p>}
  </main>;
}
