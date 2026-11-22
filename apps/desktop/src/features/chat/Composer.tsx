import { useRef, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { FieldLabel } from '../../components/ui/field';
import { Textarea } from '../../components/ui/textarea';
import IconButton from '../../components/IconButton';

export default function Composer({ value, onChange, onSubmit, disabled, steering, queueing = false, blockedReason, toolbar, onStop, stopDisabled }: {
  value: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void; disabled: boolean; steering: boolean; blockedReason?: string;
  toolbar?: ReactNode; queueing?: boolean; onStop?: () => void; stopDisabled?: boolean;
}) {
  const composing = useRef(false);
  const hint = blockedReason ?? (steering ? '补充会在下一个安全步骤处理' : queueing ? '新目标先保存到队列，自动总结在安全边界让出' : undefined);
  return <form className="composer" onSubmit={event => { if (disabled || !value.trim()) event.preventDefault(); else onSubmit(event); }}>
    <FieldLabel htmlFor="message-input">消息</FieldLabel>
    <Textarea id="message-input" rows={2} required value={value} onChange={event => onChange(event.target.value)} placeholder="说说你想完成的事…" title="Enter 发送 · Shift+Enter 换行"
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey
          || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault();
        if (!disabled && value.trim() && !event.repeat) event.currentTarget.form!.requestSubmit();
      }} />
    <footer>{toolbar}
      <div className="composer-send-actions">{onStop && <IconButton icon="stop" size="icon-sm" label="停止当前运行" variant="default" disabled={stopDisabled} onClick={onStop} />}
        {(!onStop || value.trim()) && (steering || queueing
          ? <Button type="submit" size="sm" variant={onStop ? 'outline' : 'default'} disabled={disabled}>{steering ? '补充指令' : '排队发送'}</Button>
          : <IconButton icon="send" size="icon-sm" label="发送" type="submit" variant="default" disabled={disabled} />)}</div></footer>
    {hint && <p className="composer-hint">{hint}</p>}
  </form>;
}
