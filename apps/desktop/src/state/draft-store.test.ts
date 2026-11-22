import { describe, expect, it, vi } from 'vitest';
import { createDraftStore } from './draft-store';

const a = { workspaceId: 'workspace-a', sessionId: 'session-a' };
const b = { workspaceId: 'workspace-b', sessionId: 'session-b' };

it('迁移未建会话草稿时保留文字和明确选择的模型与强度', () => {
  const store = createDraftStore();
  const project = { workspaceId: a.workspaceId, sessionId: '' };
  const choice = { text: '尚未提交', modelId: 'selected-model', reasoningEffort: 'high' };
  store.update(project, choice);
  store.move(project, a, { modelId: 'inherited-model', reasoningEffort: 'low' });
  expect(store.read(a)).toMatchObject(choice);
  expect(store.read(project)).toMatchObject({ text: '', modelId: '' });
  expect(store.read(b).text).toBe('');
});

it('创建回执迟到时，迁移不会覆盖已在目标会话编辑的草稿', () => {
  const store = createDraftStore();
  const project = { workspaceId: a.workspaceId, sessionId: '' };
  const original = store.update(project, { text: '原目标', resourceIds: ['attachment'] });
  const latest = store.update(a, { text: '目标会话已编辑的新草稿' });
  expect(store.move(project, a)).toBeUndefined();
  expect(store.read(project)).toBe(original);
  expect(store.read(a)).toBe(latest);
});

it('首次配置模型后保留未建会话草稿中已经明确选择的 Skill', () => {
  localStorage.clear();
  const project = { workspaceId: '00000000-0000-4000-8000-000000000001', sessionId: '' };
  const destination = 'https://model.invalid/v1';
  const previousWindow = createDraftStore();
  const storedSkill = '00000000-0000-4000-8000-000000000002';
  const draftSkill = '00000000-0000-4000-8000-000000000003';
  previousWindow.update(project, { skillVersions: { [storedSkill]: 'a'.repeat(64) } });
  previousWindow.rememberPreference(project, destination);

  const store = createDraftStore();
  store.update(project, { skillVersions: { [draftSkill]: 'b'.repeat(64) }, skillExecutionPermissions: { [draftSkill]: null } });
  store.applyPreference(project, destination);

  expect(store.read(project)).toMatchObject({
    skillVersions: { [draftSkill]: 'b'.repeat(64) },
    skillExecutionPermissions: { [draftSkill]: null },
  });
  expect(store.read(project).skillVersions).not.toHaveProperty(storedSkill);
  localStorage.clear();
});

describe('窗口内按归属和修订隔离的草稿', () => {
  it('会话往返恢复文字/附件/模型，不写 localStorage，两个窗口独立', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const first = createDraftStore(), second = createDraftStore();
    const saved = first.update(a, { text: 'A', resourceIds: ['resource-a'], modelId: 'model-a' });
    first.update(b, { text: 'B', resourceIds: ['resource-b'], modelId: 'model-b' });
    expect(first.read(a)).toEqual(saved);
    expect(first.read(b).text).toBe('B');
    expect(second.read(a)).toEqual({ text: '', resourceIds: [], memoryScopes: [], skillVersions: {}, skillExecutionPermissions: {}, excludedSourceIds: [], modelId: '', allowManaged: false, allowFollowUp: false, sourceResult: null, summaryRunId: null, limits: {}, revision: 0 });
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
    expect(store.read(a)).toEqual({ text: '', resourceIds: [], memoryScopes: [], skillVersions: {}, skillExecutionPermissions: {}, excludedSourceIds: [], modelId: 'selected-model', allowManaged: false, allowFollowUp: false, sourceResult: null, summaryRunId: null, limits: {}, revision: edited.revision + 1 });
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

  it('提交后切换 Skill 版本，旧回执保留新选择，当前回执只清当前会话', () => {
    const store = createDraftStore();
    const selection = { release: 'first-version' };
    const first = store.update(a, { skillVersions: selection });
    selection.release = 'second-version';
    const second = store.update(a, { skillVersions: selection });
    store.update(b, { skillVersions: { review: 'other-version' } });
    store.acknowledge(a, first.revision);
    expect(first.skillVersions.release).toBe('first-version');
    expect(store.read(a).skillVersions.release).toBe('second-version');
    store.acknowledge(a, second.revision);
    expect(store.read(a).skillVersions).toEqual({});
    expect(store.read(b).skillVersions).toEqual({ review: 'other-version' });
  });
});

it('后台授权仅属本次草稿；旧ack不清新选项，当前ack重置，窗口彼此隔离', () => {
  const a = createDraftStore(), b = createDraftStore(), key = { workspaceId: 'project', sessionId: 'chat' };
  expect(a.read(key).allowManaged).toBe(false);
  const sent = a.update(key, { allowManaged: true, text: 'A' });
  a.update(key, { text: 'B' }); a.acknowledge(key, sent.revision);
  expect(a.read(key).allowManaged).toBe(true);
  expect(b.read(key).allowManaged).toBe(false);
  a.acknowledge(key, a.read(key).revision);
  expect(a.read(key).allowManaged).toBe(false);
});

it('明确记住来源偏好后跨会话和窗口复用，项目/模型地址隔离，清除后停止默认选入', () => {
  localStorage.clear();
  const project = '00000000-0000-4000-8000-000000000001';
  const key = { workspaceId: project, sessionId: 'a' };
  const scope = { kind: 'workspace' as const, workspace_id: project, session_id: null };
  const store = createDraftStore();
  store.applyPreference(key, 'https://model.invalid/v1');
  store.update(key, { memoryScopes: [scope], skillVersions: {}, resourceIds: ['private-attachment'], allowFollowUp: true });
  store.rememberPreference(key, 'https://model.invalid/v1');
  store.acknowledge(key, store.read(key).revision);
  expect(store.read(key).memoryScopes).toEqual([scope]);
  expect(store.read(key).resourceIds).toEqual([]);
  expect(store.read(key).allowFollowUp).toBe(false);
  const next = createDraftStore(), otherSession = { ...key, sessionId: 'b' };
  next.applyPreference(otherSession, 'https://model.invalid/v1');
  expect(next.read(otherSession).memoryScopes).toEqual([scope]);
  next.applyPreference(otherSession, 'https://new.invalid/v1');
  expect(next.read(otherSession).memoryScopes).toEqual([]);
  next.applyPreference(b, 'https://model.invalid/v1');
  expect(next.read(b).memoryScopes).toEqual([]);
  next.forgetPreference(key, 'https://model.invalid/v1');
  const reopened = createDraftStore();
  reopened.applyPreference(key, 'https://model.invalid/v1');
  expect(reopened.read(key).memoryScopes).toEqual([]);
  localStorage.clear();
});
