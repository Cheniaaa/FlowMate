import { useState, useSyncExternalStore } from 'react';
import type { PendingCommand, RuntimeStore } from '../../state/runtime-store';
import CommandStatus from '../notifications/CommandStatus';
import { windowError } from '../../api/windows';

const labels: Partial<Record<PendingCommand['type'], string>> = {
  createMemory: '新建记忆',
  decideMemory: '记忆变更',
  saveMemoryPolicy: '保存记忆设置',
  grantMemory: '记忆读取授权',
  revoke: '撤销授权',
  submitMemoryMaintenance: '提交整理任务',
};

export default function MemoryCommands({ store, targetId }: { store: RuntimeStore; targetId?: string }) {
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [error, setError] = useState('');
  return <>{error && <p role="alert">{error}</p>}<CommandStatus commands={commands.filter(command =>
    labels[command.type] && (!targetId || command.targetId === targetId))}
    busy={false} label={command => labels[command.type]!} location={() => '原记忆范围'} canCheck={() => false} onCheck={() => {}}
    onRetry={command => { void store.retry(command.commandId).catch(error => setError(windowError(error))); }} /></>;
}
