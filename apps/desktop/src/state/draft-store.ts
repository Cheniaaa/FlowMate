export interface DraftKey { workspaceId: string; sessionId: string }
export interface Draft { text: string; resourceIds: string[]; modelId: string; revision: number }

export function createDraftStore() {
  const drafts = new Map<string, Draft>();
  const listeners = new Set<() => void>();
  const identity = (key: DraftKey) => JSON.stringify([key.workspaceId, key.sessionId]);
  function read(key: DraftKey): Draft {
    const id = identity(key);
    if (!drafts.has(id)) drafts.set(id, { text: '', resourceIds: [], modelId: '', revision: 0 });
    return drafts.get(id)!;
  }
  function update(key: DraftKey, change: Partial<Omit<Draft, 'revision'>>): Draft {
    const current = read(key);
    const next = { ...current, ...change, resourceIds: [...(change.resourceIds ?? current.resourceIds)], revision: current.revision + 1 };
    drafts.set(identity(key), next);
    for (const listener of listeners) listener();
    return next;
  }
  return {
    read, update,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    acknowledge(key: DraftKey, submittedRevision: number) {
      if (read(key).revision === submittedRevision) update(key, { text: '', resourceIds: [] });
    },
  };
}
