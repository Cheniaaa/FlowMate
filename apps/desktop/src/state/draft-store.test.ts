import { describe, expect, it, vi } from 'vitest';
import { createDraftStore } from './draft-store';

const a = { workspaceId: 'workspace-a', sessionId: 'session-a' };
const b = { workspaceId: 'workspace-b', sessionId: 'session-b' };

describe('窗口内按归属和修订隔离的草稿', () => {
  it('会话往返恢复文字/附件/模型，不写 localStorage，两个窗口独立', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const first = createDraftStore(), second = createDraftStore();
    const saved = first.update(a, { text: 'A', resourceIds: ['resource-a'], modelId: 'model-a' });
    first.update(b, { text: 'B', resourceIds: ['resource-b'], modelId: 'model-b' });
    expect(first.read(a)).toEqual(saved);
    expect(first.read(b).text).toBe('B');
    expect(second.read(a)).toEqual({ text: '', resourceIds: [], modelId: '', revision: 0 });
    expect(write).not.toHaveBeenCalled(); write.mockRestore();
  });

  it('A 提交后编辑 B，旧 acknowledgement 不清 B；只清相同修订的内容，保留模型选择', () => {
    const store = createDraftStore();
    const submitted = store.update(a, { text: 'A', resourceIds: ['one'], modelId: 'selected-model' });
    const edited = store.update(a, { text: 'B' });
    store.acknowledge(a, submitted.revision);
    expect(store.read(a)).toEqual(edited);
    store.acknowledge(b, submitted.revision);
    expect(store.read(a)).toEqual(edited);
    store.acknowledge(a, edited.revision);
    expect(store.read(a)).toEqual({ text: '', resourceIds: [], modelId: 'selected-model', revision: edited.revision + 1 });
    const acknowledged = store.read(a);
    store.acknowledge(a, edited.revision);
    expect(store.read(a)).toBe(acknowledged);
  });

  it('稳定快照、通知及输入数组不共享可变引用', () => {
    const store = createDraftStore();
    expect(store.read(a)).toBe(store.read(a));
    const listener = vi.fn(); const unsubscribe = store.subscribe(listener);
    const ids = ['one']; store.update(a, { resourceIds: ids }); ids.push('two');
    expect(store.read(a).resourceIds).toEqual(['one']);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe(); store.update(b, { text: 'B' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
