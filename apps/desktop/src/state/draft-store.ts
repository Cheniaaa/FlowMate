import type { MemoryRecord, StartRunCommand } from '../generated/contracts';

export interface DraftKey { workspaceId: string; sessionId: string }
export interface Draft {
  text: string; resourceIds: string[]; memoryScopes: MemoryRecord['scope'][]; excludedSourceIds: string[]; modelId: string; allowManaged: boolean; allowFollowUp: boolean;
  skillVersions: Record<string, string>;
  sourceResult: string | null; limits: NonNullable<StartRunCommand['data']['limits']>; summaryRunId: string | null; revision: number;
}

export function createDraftStore() {
  const drafts = new Map<string, Draft>();
  const listeners = new Set<() => void>();
  const identity = (key: DraftKey) => JSON.stringify([key.workspaceId, key.sessionId]);
  function read(key: DraftKey): Draft {
    const id = identity(key);
    if (!drafts.has(id)) drafts.set(id, { text: '', resourceIds: [], memoryScopes: [], skillVersions: {}, excludedSourceIds: [], modelId: '', allowManaged: false, allowFollowUp: false,
      sourceResult: null, limits: {}, summaryRunId: null, revision: 0 });
    return drafts.get(id)!;
  }
  function update(key: DraftKey, change: Partial<Omit<Draft, 'revision'>>): Draft {
    const current = read(key);
    const next = { ...current, ...change, resourceIds: [...(change.resourceIds ?? current.resourceIds)],
      memoryScopes: (change.memoryScopes ?? current.memoryScopes).map(scope => ({ ...scope })),
      skillVersions: { ...(change.skillVersions ?? current.skillVersions) },
      excludedSourceIds: [...(change.excludedSourceIds ?? current.excludedSourceIds)],
      limits: { ...(change.limits ?? current.limits) }, revision: current.revision + 1 };
    drafts.set(identity(key), next);
    for (const listener of listeners) listener();
    return next;
  }
  return {
    read, update,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    acknowledge(key: DraftKey, submittedRevision: number, steering = false) {
      if (read(key).revision === submittedRevision) update(key, steering ? { text: '' }
        : { text: '', resourceIds: [], memoryScopes: [], skillVersions: {}, excludedSourceIds: [], allowManaged: false, allowFollowUp: false, sourceResult: null, summaryRunId: null });
    },
  };
}
