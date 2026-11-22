import { act, renderHook, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { afterEach, expect, it, vi } from 'vitest';
import { checkWorkspaceDirectoryCommand, createWorkspaceFromDirectory, openSettings, retryWorkspaceFromDirectory, selectWorkspaceDirectory, showWorkbench, useWindowSettings, type WindowSettings, type WorkbenchTarget, type SettingsSection } from './windows';
import { commandMeta } from './client';
import { id, resource } from '../test/fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const initial: WindowSettings = { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
const newer: WindowSettings = { quick_pinned: true, ball_enabled: true, shortcut: 'Control+Space', shortcut_error: null };

it('记忆内容导航与策略章节分别使用原Workbench/settings命令，不传记录正文或owner', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  const target: WorkbenchTarget = { kind: 'memory' }, section: SettingsSection = 'memory';
  await showWorkbench(target);
  await openSettings(section);
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ['show_workbench', { target: { kind: 'memory' } }],
    ['open_settings', { section: 'memory' }],
  ]);
});

it('原生目录创建只有首次选择；响应丢失后明确核对/原命令 retry，不再 create，不保存路径', async () => {
  const meta = commandMeta();
  const result = { workspace: { id, version: 1, name: '目录项目', directory_resource_id: resource.id }, directory: { ...resource, kind: 'directory' } };
  vi.mocked(invoke).mockImplementation(async name => {
    if (name === 'create_workspace_from_directory') throw new Error('native response lost');
    if (name === 'check_workspace_directory_command') return { status: 'not_found', result: null };
    return result;
  });
  await expect(createWorkspaceFromDirectory('目录项目', meta)).rejects.toThrow('native response lost');
  expect(await checkWorkspaceDirectoryCommand(meta.command_id!)).toEqual({ status: 'not_found', result: null });
  expect(await retryWorkspaceFromDirectory('目录项目', meta)).toEqual(result);
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ['create_workspace_from_directory', { name: '目录项目', meta }],
    ['check_workspace_directory_command', { command_id: meta.command_id }],
    ['retry_workspace_from_directory', { name: '目录项目', meta }],
  ]);
});

it('原生 picker 取消是 null；冻结选择丢失/冲突如实抛出，不重弹 picker 或伪造项目', async () => {
  const meta = commandMeta(); vi.mocked(invoke).mockResolvedValueOnce(null);
  expect(await selectWorkspaceDirectory(meta.command_id!)).toBeNull();
  for (const code of ['directory_selection_lost', 'directory_command_conflict', 'busy', 'scope_deleted']) {
    vi.mocked(invoke).mockRejectedValueOnce(code);
    await expect(retryWorkspaceFromDirectory('取消项目', meta)).rejects.toBe(code);
  }
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'select_workspace_directory')).toEqual([
    ['select_workspace_directory', { commandId: meta.command_id }],
  ]);
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'create_workspace_from_directory')).toHaveLength(0);
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function nativeBoundary() {
  const reads: ReturnType<typeof deferred<WindowSettings>>[] = [];
  let callback!: EventCallback<null>;
  const remove = vi.fn();
  vi.mocked(listen).mockImplementation(async (_event, handler) => { callback = handler; return remove; });
  vi.mocked(invoke).mockImplementation(name => {
    if (name !== 'window_settings') throw Error(`unexpected command ${name}`);
    const read = deferred<WindowSettings>(); reads.push(read); return read.promise as Promise<any>;
  });
  return { reads, remove, wake: () => callback({ event: 'window-settings-changed', id: 1, payload: null }) };
}

it.each(['quick', 'main'] as const)('%s先监听再读初值，null唤醒只经授权invoke刷新', async label => {
  const native = nativeBoundary();
  const registration = deferred<() => void>();
  const register = vi.mocked(listen).getMockImplementation()!;
  vi.mocked(listen).mockImplementation((...args) => { void register(...args); return registration.promise; });
  const view = renderHook(() => useWindowSettings(label));
  expect(listen).toHaveBeenCalledWith('window-settings-changed', expect.any(Function), { target: label });
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => registration.resolve(native.remove));
  expect(native.reads).toHaveLength(1);
  await act(async () => native.reads[0].resolve(initial));
  expect(view.result.current.settings).toEqual(initial);
  await act(async () => native.wake());
  expect(native.reads).toHaveLength(2);
  expect(view.result.current.settings).toEqual(initial);
  await act(async () => native.reads[1].resolve(newer));
  expect(view.result.current.settings).toEqual(newer);
});

it('读取开始淘汰旧初始化和事件请求，旧响应先到也不能淘汰最新请求', async () => {
  const native = nativeBoundary(); const view = renderHook(() => useWindowSettings('quick'));
  await waitFor(() => expect(native.reads).toHaveLength(1));
  await act(async () => { native.wake(); native.wake(); });
  expect(native.reads).toHaveLength(3);
  await act(async () => { native.reads[0].resolve(initial); native.reads[1].resolve(initial); });
  expect(view.result.current.settings).toBeUndefined();
  await act(async () => native.reads[2].resolve(newer));
  expect(view.result.current.settings).toEqual(newer);
  await act(async () => { native.wake(); native.wake(); });
  await act(async () => native.reads[4].resolve(initial));
  await act(async () => native.reads[3].resolve(newer));
  expect(view.result.current.settings).toEqual(initial);
});

it.each(['initial', 'event'] as const)('显式命令install淘汰在途%s读，后续新唤醒仍能查询更新', async phase => {
  const native = nativeBoundary(); const view = renderHook(() => useWindowSettings('main'));
  await waitFor(() => expect(native.reads).toHaveLength(1));
  if (phase === 'event') {
    await act(async () => native.reads[0].resolve(initial));
    await act(async () => native.wake());
  }
  const pending = native.reads.at(-1)!;
  await act(async () => view.result.current.install(newer));
  await act(async () => pending.resolve(initial));
  expect(view.result.current.settings).toEqual(newer);
  await act(async () => native.wake());
  await act(async () => native.reads.at(-1)!.resolve(initial));
  expect(view.result.current.settings).toEqual(initial);
});

it('迟到旧读失败不会覆盖新状态或显式命令错误，最新失败可见', async () => {
  const native = nativeBoundary(); const view = renderHook(() => useWindowSettings('main'));
  await waitFor(() => expect(native.reads).toHaveLength(1));
  await act(async () => native.wake());
  expect(native.reads).toHaveLength(2);
  await act(async () => native.reads[1].resolve(newer));
  await act(async () => native.reads[0].reject('stale-read-error'));
  expect(view.result.current.settings).toEqual(newer); expect(view.result.current.error).toBe('');
  await act(async () => native.wake());
  await act(async () => { view.result.current.install(initial); view.result.current.setError('explicit-command-error'); });
  await act(async () => native.reads[2].reject('older-read-error'));
  expect(view.result.current.error).toBe('explicit-command-error');
  await act(async () => native.wake());
  await act(async () => native.reads[3].reject('current-read-error'));
  expect(view.result.current.error).toBe('current-read-error');
});

it('卸载后读回或唤醒不再更新或查询，晚到监听立即解绑', async () => {
  const native = nativeBoundary(); const view = renderHook(() => useWindowSettings('quick'));
  await waitFor(() => expect(native.reads).toHaveLength(1));
  await act(async () => native.reads[0].resolve(initial));
  await act(async () => native.wake());
  expect(native.reads).toHaveLength(2);
  view.unmount(); expect(native.remove).toHaveBeenCalledOnce();
  await act(async () => { native.reads[1].resolve(newer); native.wake(); });
  expect(native.reads).toHaveLength(2); expect(view.result.current.settings).toEqual(initial);
  const registration = deferred<() => void>(); const remove = vi.fn();
  vi.mocked(listen).mockReturnValueOnce(registration.promise);
  const next = renderHook(() => useWindowSettings('main')); next.unmount();
  await act(async () => registration.resolve(remove));
  expect(remove).toHaveBeenCalledOnce(); expect(native.reads).toHaveLength(2);
});
