import type { PendingCommand } from '../../state/runtime-store';
import { Button } from '../../components/ui/button';

export default function CommandStatus({ commands, busy, label, location, canCheck, onCheck, onRetry }: {
  commands: PendingCommand[]; busy: boolean; location: (command: PendingCommand) => string;
  label?: (command: PendingCommand) => string;
  canCheck: (command: PendingCommand) => boolean;
  onCheck: (command: PendingCommand) => void; onRetry: (command: PendingCommand) => void;
}) {
  if (!commands.length) return null;
  return <section aria-label="命令状态">{commands.map(command => <article key={command.commandId}>
    <p>{label ? label(command) : <>{command.type} · {location(command)}</>}</p>
    <p>{command.status === 'unconfirmed' ? '提交状态待确认' : command.type === 'startRun' || command.type === 'steer' ? '已提交，详情同步中' : '已提交，状态同步中'}</p>
    {command.error && <p>{command.error}</p>}
    <div className="flex flex-wrap gap-2">
      {command.status === 'unconfirmed' && command.type !== 'stopWorkspace' && canCheck(command)
        && <Button type="button" size="sm" disabled={command.busy || busy} onClick={() => onCheck(command)}>核对提交状态</Button>}
      <Button type="button" size="sm" disabled={command.busy || busy} onClick={() => onRetry(command)}>{command.status === 'unconfirmed' ? '使用原命令重试' : '重试状态同步'}</Button>
    </div>
  </article>)}</section>;
}
