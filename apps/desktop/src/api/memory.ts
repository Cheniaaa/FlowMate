import type { MemoryQuery } from './client';
import type { MemoryRecord } from '../generated/contracts';

export type MemoryScope = MemoryRecord['scope'];
export const personalScope: MemoryScope = { kind: 'user_global', workspace_id: null, session_id: null };
export function memoryQuery(scope: Pick<MemoryScope, 'kind'> & Partial<Pick<MemoryScope, 'workspace_id' | 'session_id'>>): MemoryQuery {
  return scope.kind === 'workspace' ? { scope_kind: 'workspace', workspace_id: scope.workspace_id! } : { scope_kind: 'user_global' };
}
export const memoryScopeLabel = (scope: MemoryScope) => scope.kind === 'user_global' ? '关于我' : '项目记忆';
