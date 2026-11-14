import { useRef, type FormEvent, type ReactNode } from 'react';
import Button from '../../components/Button';

export default function Composer({ value, onChange, onSubmit, disabled, steering, blockedReason, toolbar }: {
  value: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void; disabled: boolean; steering: boolean; blockedReason?: string;
  toolbar?: ReactNode;
}) {
  const composing = useRef(false);
  return <form className="composer" onSubmit={event => { if (disabled || !value.trim()) event.preventDefault(); else onSubmit(event); }}>
    <label htmlFor="message-input">消息</label>
    <textarea id="message-input" required value={value} onChange={event => onChange(event.target.value)} placeholder="说说你想完成的事…"
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey
          || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault();
        if (!disabled && value.trim() && !event.repeat) event.currentTarget.form!.requestSubmit();
      }} />
    <footer>{toolbar}
      <Button type="submit" className="button--primary" disabled={disabled}>{steering ? '补充指令' : '发送'}</Button></footer>
    <p className="composer-hint"><span>{blockedReason ?? (steering ? '补充会在下一个安全步骤处理' : '只有明确选中的资料才会用于本次任务')}</span><span>Enter 发送 · Shift+Enter 换行</span></p>
  </form>;
}
