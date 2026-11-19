import { useState, useSyncExternalStore } from 'react';
import type { RuntimeStore } from '../../state/runtime-store';
import CommandStatus from '../notifications/CommandStatus';
import { windowError } from '../../api/windows';

export default function MemoryCommands({ store, targetId }: { store: RuntimeStore; targetId?: string }) {
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [error, setError] = useState('');
  return <>{error && <p role="alert">{error}</p>}<CommandStatus commands={commands.filter(command =>
    ['createMemory', 'decideMemory', 'saveMemoryPolicy', 'grantMemory', 'revoke', 'submitMemoryMaintenance'].includes(command.type) && (!targetId || command.targetId === targetId))}
    busy={false} location={() => '原记忆范围'} canCheck={() => false} onCheck={() => {}}
    onRetry={command => { void store.retry(command.commandId).catch(error => setError(windowError(error))); }} /></>;
}
