import type { KnowledgeImportCommand } from '../../generated/contracts';
import { validate } from '../../api/validation';

export interface PendingImport {
  command: KnowledgeImportCommand;
  labels: Record<string, string>;
}

const key = (workspaceId: string) => `flowmate:knowledge-import:${workspaceId}`;

export function readPendingImport(workspaceId: string): PendingImport | undefined {
  const encoded = localStorage.getItem(key(workspaceId));
  if (!encoded) return;
  const value = JSON.parse(encoded) as PendingImport;
  validate('KnowledgeImportCommand', value.command);
  return value;
}

export function rememberImport(workspaceId: string, pending: PendingImport) {
  localStorage.setItem(key(workspaceId), JSON.stringify(pending));
}

export function forgetImport(workspaceId: string) {
  localStorage.removeItem(key(workspaceId));
}
