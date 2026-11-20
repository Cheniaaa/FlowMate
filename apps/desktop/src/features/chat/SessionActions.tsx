import { useState } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { Session } from '../../generated/contracts';
import type { CommandOutcome, UiCommand } from '../../state/runtime-store';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { toast } from 'sonner';

export default function SessionActions({ client, session, busy, onCommand }: {
  client: RuntimeClient; session: Session; busy: boolean; onCommand: (command: UiCommand) => Promise<CommandOutcome>;
}) {
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  async function act(action: () => Promise<unknown>) {
    setWorking(true); setError('');
    try { await action(); } catch (error) { const message = windowError(error); setError(message); toast.error(message, { id: `session:${message}` }); } finally { setWorking(false); }
  }
  return <div className="session-actions"><DropdownMenu><DropdownMenuTrigger asChild><button aria-label="会话菜单" disabled={busy || working}>会话 ···</button></DropdownMenuTrigger><DropdownMenuContent align="start">
    <DropdownMenuItem disabled={busy || working} onSelect={() => void act(async () => {
      const fence = await client.sessionAdmission(session.id);
      await onCommand({ type: 'stopSession', args: [session.id, commandMeta(fence.generation)] });
    })}>停止本会话全部任务</DropdownMenuItem>
    <DropdownMenuItem disabled={busy || working} onSelect={() => void act(() => onCommand({ type: 'archiveSession', args: [session.id, { meta: commandMeta(session.version), data: { archived: !session.archived } }] }))}>{session.archived ? '取消归档会话' : '归档会话'}</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>
  <DropdownMenu><DropdownMenuTrigger asChild><button aria-label="项目菜单" disabled={busy || working}>项目 ···</button></DropdownMenuTrigger><DropdownMenuContent align="start">
    <DropdownMenuItem disabled={busy || working} onSelect={() => void act(async () => {
      const fence = await client.workspaceAdmission(session.workspace_id);
      await onCommand({ type: 'stopWorkspace', args: [session.workspace_id, commandMeta(fence.generation)] });
    })}>停止本项目全部任务</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>
    {error && <p role="alert">{error}</p>}
  </div>;
}
