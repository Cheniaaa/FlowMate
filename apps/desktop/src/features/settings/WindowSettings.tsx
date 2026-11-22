import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useWindowSettings, windowError, type WindowSettings as Settings } from '../../api/windows';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Field, FieldDescription, FieldLabel, FieldSet } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import type { EditorLifecycle } from './Settings';

export default function WindowSettings({ onBusyChange, onSaved }: EditorLifecycle) {
  const fieldId = useId();
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
      <FieldSet disabled={busy} className="window-settings-fields">
        <Field orientation="horizontal">
          <Checkbox id={`${fieldId}-pinned`} disabled={busy} checked={settings.quick_pinned}
            onCheckedChange={checked => void change('set_quick_pinned', { pinned: checked === true }, '小窗置顶已更新')} />
          <FieldLabel htmlFor={`${fieldId}-pinned`}>快捷小窗置顶</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id={`${fieldId}-pet`} disabled={busy} checked={settings.ball_enabled}
            onCheckedChange={checked => void change('set_ball_enabled', { enabled: checked === true }, '桌面折纸鸟配置已更新')} />
          <FieldLabel htmlFor={`${fieldId}-pet`}>启用桌面折纸鸟</FieldLabel>
        </Field>
      </FieldSet>
      <form className="settings-form" onSubmit={save} onReset={() => setChord(settings.shortcut ?? '')}>
        <FieldSet disabled={busy} className="window-settings-fields items-start">
          <Field className="w-full">
            <FieldLabel htmlFor={`${fieldId}-shortcut`}>全局快捷键</FieldLabel>
            <Input id={`${fieldId}-shortcut`} aria-describedby={`${fieldId}-shortcut-help`}
              value={chord} onChange={event => setChord(event.target.value)} placeholder="例如 Control+Shift+Space" />
            <FieldDescription id={`${fieldId}-shortcut-help`}>输入 Tauri 支持的组合键；留空保存可注销。注册失败会显示真实错误，不覆盖已有绑定。</FieldDescription>
          </Field>
          <Button type="submit" variant="default">保存快捷键</Button>
        </FieldSet>
    </form></>}
  </section>;
}
