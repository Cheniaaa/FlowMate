import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWindowSettings, windowError, type WindowSettings as Settings } from '../../api/windows';
import type { EditorLifecycle } from './Settings';

export default function WindowSettings({ onBusyChange, onSaved }: EditorLifecycle) {
  const { settings, install, error, setError } = useWindowSettings('main');
  const [chord, setChord] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const pending = useRef(false);
  useEffect(() => { if (settings) setChord(settings.shortcut ?? ''); }, [settings?.shortcut]);
  async function change(command: string, args: Record<string, unknown>, message: string, form?: HTMLFormElement) {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusyChange?.(true); setError(''); setStatus('');
    try { const value = await invoke<Settings>(command, args); install(value);
      if (command === 'set_shortcut' && value.shortcut_error) { setError(value.shortcut_error); return; }
      setStatus(message); if (form) onSaved?.(form);
    }
    catch (error) { setError(windowError(error)); }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false); }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void change('set_shortcut', { chord: chord.trim() || null }, chord.trim() ? '快捷键已保存' : '快捷键已停用', event.currentTarget);
  }
  return <section aria-label="桌面入口设置">
    <h2>桌面入口</h2>
    <p>默认不注册全局快捷键；关闭窗口只隐藏，退出应用才停止 Runtime。</p>
    {error && <p role="alert">{error}</p>}
    {settings?.shortcut_error && <p role="alert">{settings.shortcut_error}</p>}
    {status && <p role="status">{status}</p>}
    {!settings ? <p role="status">正在读取桌面配置…</p> : <>
      <fieldset disabled={busy} className="window-settings-fields">
        <label><input type="checkbox" checked={settings.quick_pinned} onChange={event => void change('set_quick_pinned', { pinned: event.target.checked }, '小窗置顶已更新')} />快捷小窗置顶</label>
        <label><input type="checkbox" checked={settings.ball_enabled} onChange={event => void change('set_ball_enabled', { enabled: event.target.checked }, '悬浮球配置已更新')} />启用悬浮球</label>
      </fieldset><form className="settings-form" onSubmit={save} onReset={() => setChord(settings.shortcut ?? '')}><fieldset disabled={busy} className="window-settings-fields">
        <label>全局快捷键<input value={chord} onChange={event => setChord(event.target.value)} placeholder="例如 Control+Shift+Space" /></label>
        <p className="muted">输入 Tauri 支持的组合键；留空保存可注销。注册失败会显示真实错误，不覆盖已有绑定。</p>
        <button type="submit">保存快捷键</button>
      </fieldset>
    </form></>}
  </section>;
}
