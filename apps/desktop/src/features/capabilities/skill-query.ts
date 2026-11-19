import type { ScopeRef } from '../../generated/contracts';

export const skillQuery = (scope: ScopeRef) => scope.kind === 'workspace'
  ? { scope_kind: 'workspace' as const, workspace_id: scope.workspace_id! }
  : { scope_kind: 'user_global' as const };
