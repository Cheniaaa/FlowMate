import { useRef, type FormEvent, type ReactNode } from 'react';
import Button from '../../components/Button';

export default function Composer({ value, onChange, onSubmit, disabled, steering, queueing = false, blockedReason, toolbar, onStop, stopDisabled }: {
  value: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void; disabled: boolean; steering: boolean; blockedReason?: string;
  toolbar?: ReactNode; queueing?: boolean; onStop?: () => void; stopDisabled?: boolean;
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
      <div className="composer-send-actions">{onStop && <Button aria-label="停止当前运行" className="button--primary" disabled={stopDisabled} onClick={onStop}>■ 停止</Button>}
        {(!onStop || value.trim()) && <Button type="submit" className={onStop ? '' : 'button--primary'} disabled={disabled}>{steering ? '补充指令' : queueing ? '排队发送' : '发送'}</Button>}</div></footer>
    <p className="composer-hint"><span>{blockedReason ?? (steering ? '补充会在下一个安全步骤处理' : queueing ? '新目标先保存到队列，自动总结在安全边界让出' : '只有明确选中的资料才会用于本次任务')}</span><span>Enter 发送 · Shift+Enter 换行</span></p>
  </form>;
}
