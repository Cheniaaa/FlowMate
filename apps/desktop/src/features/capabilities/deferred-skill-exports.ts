import type { SaveSkillExportCommand, ScopeRef } from '../../generated/contracts';
import { SaveSkillExportCommand as isSaveSkillExportCommand } from '../../generated/validators.js';

export interface DeferredSkillExport {
  label: string;
  command: SaveSkillExportCommand;
}

function prefix(workspaceId: string, scope: Pick<ScopeRef, 'kind'> & { workspace_id?: ScopeRef['workspace_id'] }) {
  return `flowmate:skill-export:${workspaceId}:${scope.kind}:${scope.workspace_id ?? ''}:`;
}

export function rememberSkillExport(workspaceId: string, { label, command }: DeferredSkillExport) {
  const key = prefix(workspaceId, command.data.scope) + command.meta.command_id;
  // 仅保存文件名和原公开命令。目标及覆盖授权继续由 Runtime 按引用核对。
  localStorage.setItem(key, JSON.stringify({ label: label.split(/[\\/]/).at(-1), command }));
}

export function deferredSkillExports(workspaceId: string | undefined, scope: ScopeRef): DeferredSkillExport[] {
  if (!workspaceId || (scope.kind === 'workspace' && scope.workspace_id !== workspaceId)) return [];
  const group = prefix(workspaceId, scope);
  return Object.keys(localStorage).filter(key => key.startsWith(group)).flatMap(key => {
    const value: unknown = JSON.parse(localStorage.getItem(key)!);
    if (!value || typeof value !== 'object' || !('label' in value) || typeof value.label !== 'string'
      || !('command' in value) || !isSaveSkillExportCommand(value.command)) return [];
    const { command, label } = value;
    if (key !== prefix(workspaceId, command.data.scope) + command.meta.command_id || command.data.scope.session_id) return [];
    return [{ label, command }];
  });
}

export function forgetSkillExport(workspaceId: string, scope: ScopeRef, id: string) {
  localStorage.removeItem(prefix(workspaceId, scope) + id);
}

export function watchDeferredSkillExports(workspaceId: string, scope: ScopeRef, onChange: () => void) {
  const group = prefix(workspaceId, scope);
  function onStorage(event: StorageEvent) {
    if (event.storageArea === localStorage && (event.key === null || event.key.startsWith(group))) onChange();
  }
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
