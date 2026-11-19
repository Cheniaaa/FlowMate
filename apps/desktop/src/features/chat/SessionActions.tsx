import { useState } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { Session } from '../../generated/contracts';
import type { CommandOutcome, UiCommand } from '../../state/runtime-store';

export default function SessionActions({ client, session, busy, onCommand }: {
  client: RuntimeClient; session: Session; busy: boolean; onCommand: (command: UiCommand) => Promise<CommandOutcome>;
}) {
  const [working, setWorking] = useState(false), [error, setError] = useState('');
  async function act(action: () => Promise<unknown>) {
    setWorking(true); setError('');
    try { await action(); } catch (error) { setError(windowError(error)); } finally { setWorking(false); }
  }
  return <details className="session-actions"><summary>会话与停止选项</summary>
    <p>停止全部先关闭旧任务链准入；新的独立输入仍可开始。归档不停止既有后台，不自动总结。</p>
    <button disabled={busy || working} onClick={() => void act(async () => {
      const fence = await client.sessionAdmission(session.id);
      await onCommand({ type: 'stopSession', args: [session.id, commandMeta(fence.generation)] });
    })}>停止本会话全部任务</button>
    <button disabled={busy || working} onClick={() => void act(async () => {
      const fence = await client.workspaceAdmission(session.workspace_id);
      await onCommand({ type: 'stopWorkspace', args: [session.workspace_id, commandMeta(fence.generation)] });
    })}>停止本项目全部任务</button>
    <button disabled={busy || working} onClick={() => void act(() => onCommand({ type: 'archiveSession', args: [session.id, { meta: commandMeta(session.version), data: { archived: !session.archived } }] }))}>{session.archived ? '取消归档会话' : '归档会话'}</button>
    {error && <p role="alert">{error}</p>}
  </details>;
}
