import type { PendingCommand } from '../../state/runtime-store';

export default function CommandStatus({ commands, busy, location, canCheck, onCheck, onRetry }: {
  commands: PendingCommand[]; busy: boolean; location: (command: PendingCommand) => string;
  canCheck: (command: PendingCommand) => boolean;
  onCheck: (command: PendingCommand) => void; onRetry: (command: PendingCommand) => void;
}) {
  if (!commands.length) return null;
  return <section aria-label="命令状态">{commands.map(command => <article key={command.commandId}>
    <p>{command.type} · {location(command)}</p>
    <p>{command.status === 'unconfirmed' ? '提交状态待确认' : command.type === 'startRun' || command.type === 'steer' ? '已提交，详情同步中' : '已提交，状态同步中'}</p>
    {command.error && <p>{command.error}</p>}
    {command.status === 'unconfirmed' && command.type !== 'stopWorkspace' && canCheck(command) && <button disabled={command.busy || busy} onClick={() => onCheck(command)}>核对提交状态</button>}
    <button disabled={command.busy || busy} onClick={() => onRetry(command)}>{command.status === 'unconfirmed' ? '使用原命令重试' : '重试状态同步'}</button>
  </article>)}</section>;
}
