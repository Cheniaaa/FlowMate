import { useRef, useState } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { Session, Workspace } from '../../generated/contracts';
import type { CommandOutcome, UiCommand } from '../../state/runtime-store';
import type { DraftKey } from '../../state/draft-store';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { toast } from 'sonner';
import IconButton from '../../components/IconButton';

export default function ScopeActions({ client, target, busy, onCommand, onDelete, onDirectory, onRename, onSuggestName, onNewSession }: {
  client: RuntimeClient; target: Session | Workspace; busy: boolean;
  onCommand: (command: UiCommand, options?: { key: DraftKey; targetName: string }) => Promise<CommandOutcome>;
  onDelete?: (origin: HTMLButtonElement) => void;
  onDirectory?: (origin: HTMLButtonElement) => void;
  onRename?: (origin: HTMLButtonElement) => void;
  onSuggestName?: (origin: HTMLButtonElement) => void;
  onNewSession?: (origin: HTMLButtonElement) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  async function act(action: () => Promise<unknown>) {
    setWorking(true); setError('');
    try { await action(); } catch (error) { const message = windowError(error); setError(message); toast.error(message, { id: `session:${message}` }); } finally { setWorking(false); }
  }
  const session = 'workspace_id' in target ? target : undefined;
  const label = 'title' in target ? `会话「${target.title}」的更多操作` : `项目「${target.name}」的更多操作`;
  return <DropdownMenu modal={false}><DropdownMenuTrigger asChild>
    <IconButton ref={trigger} icon="more" size="icon-sm" label={label} className="scope-menu-trigger" disabled={busy || working} />
  </DropdownMenuTrigger><DropdownMenuContent align="end" aria-label={label} onCloseAutoFocus={event => {
    if (openingDialog.current) { event.preventDefault(); openingDialog.current = false; }
  }}>
    <DropdownMenuGroup>
      {onNewSession && <DropdownMenuItem onSelect={() => { openingDialog.current = true; onNewSession(trigger.current!); }}>在此项目新建会话</DropdownMenuItem>}
      {onRename && <DropdownMenuItem onSelect={() => { openingDialog.current = true; onRename(trigger.current!); }}>
        {session ? '重命名会话' : '重命名项目'}</DropdownMenuItem>}
      {onSuggestName && <DropdownMenuItem onSelect={() => { openingDialog.current = true; onSuggestName(trigger.current!); }}>
        建议项目名称</DropdownMenuItem>}
      {onDirectory && <DropdownMenuItem onSelect={() => { openingDialog.current = true; onDirectory(trigger.current!); }}>管理项目目录</DropdownMenuItem>}
      {session && <DropdownMenuItem onSelect={() => void act(() => onCommand({ type: 'archiveSession',
        args: [session.id, { meta: commandMeta(session.version), data: { archived: !session.archived } }] }))}>
        {session.archived ? '取消归档会话' : '归档会话'}</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => void act(async () => {
        const fence = session ? await client.sessionAdmission(target.id) : await client.workspaceAdmission(target.id);
        await onCommand({ type: session ? 'stopSession' : 'stopWorkspace', args: [target.id, commandMeta(fence.generation)] }, {
          key: { workspaceId: fence.scope.workspace_id!, sessionId: fence.scope.session_id ?? '' },
          targetName: 'title' in target ? target.title : target.name,
        });
      })}>{session ? '停止本会话全部任务' : '停止本项目全部任务'}</DropdownMenuItem>
      {onDelete && <DropdownMenuItem variant="destructive" onSelect={() => { openingDialog.current = true; onDelete(trigger.current!); }}>
        {session ? '删除会话' : '删除项目'}</DropdownMenuItem>}
    </DropdownMenuGroup>
    {error && <p role="alert">{error}</p>}
  </DropdownMenuContent></DropdownMenu>;
}
