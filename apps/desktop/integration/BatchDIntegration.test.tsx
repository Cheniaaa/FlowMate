import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient, commandMeta } from '../src/api/client';
import { createRuntimeStore } from '../src/state/runtime-store';
import { createDraftStore } from '../src/state/draft-store';
import { Conversation } from '../src/features/chat/Conversation';
import WorkbenchWindow from '../src/windows/WorkbenchWindow';
import type { SkillBinding, SkillVersion, ResourceRef, ArtifactRef } from '../src/generated/contracts';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
let process: ChildProcessWithoutNullStreams;
let fixture: { connection: ConstructorParameters<typeof RuntimeClient>[0]; workspace: { id: string };
  session: { id: string }; binding: SkillBinding; version: SkillVersion; target: ResourceRef;
  binary_session: string; artifact: ArtifactRef;
  destination: string; executable: string };
let exit: Promise<unknown>;
const nativeFetch = globalThis.fetch;

beforeAll(async () => {
  process = spawn(resolve('../../.venv/Scripts/python.exe'), ['tests/m2/batch_d_ui_server.py'], {
    cwd: resolve('../..'), env: { ...globalThis.process.env, PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: `${resolve('../../packages')};${resolve('../..')}` },
  });
  exit = new Promise(done => process.once('exit', done));
  let errors = '';
  process.stderr.on('data', data => { errors += String(data); });
  fixture = await new Promise((done, reject) => {
    let text = '';
    process.once('error', reject);
    process.once('exit', () => reject(new Error(errors)));
    process.stdout.on('data', data => {
      text += String(data);
      if (text.includes('\n')) done(JSON.parse(text.split('\n')[0]));
    });
  });
}, 45_000);
afterAll(async () => { process.stdin.end('\n'); await exit; }, 30_000);
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function connect() {
  // Node 无 WebView Origin，补与真实 Tauri 相同的 Origin；全部请求仍经过真实认证/API。
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => nativeFetch(input, {
    ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Origin: 'http://tauri.localhost' },
  }));
  return new RuntimeClient(fixture.connection);
}

it('两个独立窗口消费真实无正文binding通知；相同Skill修订刷新并保留本地编辑和草稿', { timeout: 30_000 }, async () => {
  const client = connect(), user = userEvent.setup();
  const stores = [createRuntimeStore(client), createRuntimeStore(client)];
  const drafts = [createDraftStore(), createDraftStore()];
  const key = { workspaceId: fixture.workspace.id, sessionId: fixture.session.id };
  drafts[0].update(key, { text: '主窗未提交', skillVersions: { [fixture.version.skill_id]: fixture.version.content_hash } });
  drafts[1].update(key, { text: '小窗未提交' });
  const main = render(<Conversation client={client} runtimeStore={stores[0]} draftStore={drafts[0]} />);
  const quick = render(<Conversation compact client={client} runtimeStore={stores[1]} draftStore={drafts[1]} />);
  for (const window of [main, quick]) {
    const controls = within(window.container);
    await user.click(await controls.findByRole('button', { name: 'D 集成会话' }, { timeout: 7000 }));
  }
  await within(main.container).findByRole('heading', { name: 'D 集成会话' }, { timeout: 7000 });
  await within(quick.container).findByRole('heading', { name: 'D 集成会话' }, { timeout: 7000 });
  await user.click(within(main.container).getByRole('button', { name: '选择 Skill' }));
  await user.click(within(quick.container).getByRole('button', { name: '选择 Skill' }));
  await within(main.container).findByRole('button', { name: '停用' });
  await within(quick.container).findByRole('button', { name: '停用' });
  await user.click(within(main.container).getByRole('button', { name: '编辑新版本' }));
  const editor = await within(main.container).findByLabelText('SKILL.md 原文件');
  await user.type(editor, '本地修改');
  const before = drafts[0].read(key);
  let binding = await client.bindSkill({ meta: commandMeta(fixture.binding.revision), data: { ...fixture.binding, enabled: false } });
  await waitFor(() => expect((within(quick.container).getByRole('button', { name: '用于原会话的新目标' }) as HTMLButtonElement).disabled).toBe(true), { timeout: 7000 });
  expect((editor as HTMLTextAreaElement).value).toContain('本地修改');
  expect(drafts[0].read(key)).toEqual(before);
  const rev = stores[1].getSnapshot().skillsRevision;
  binding = await client.bindSkill({ meta: commandMeta(binding.revision), data: { ...binding, enabled: true } });
  await waitFor(() => expect(stores[1].getSnapshot().skillsRevision).toBeGreaterThan(rev), { timeout: 7000 });
  await waitFor(() => expect((within(quick.container).getByRole('button', { name: '用于原会话的新目标' }) as HTMLButtonElement).disabled).toBe(false));
  expect(drafts[1].read(key).text).toBe('小窗未提交');
  expect(drafts[1].read(key).skillVersions).toEqual({});
  fixture.binding = binding;
  main.unmount(); quick.unmount();
});

it('Conversation已发布二进制入口进入真实详情，可定位来源且不请求文本正文', { timeout: 20_000 }, async () => {
  const client = connect(), user = userEvent.setup();
  const reads = vi.spyOn(client, 'artifactContent');
  const view = render(<Conversation client={client} />);
  await user.click(await screen.findByRole('button', { name: '二进制会话' }, { timeout: 7000 }));
  await screen.findByRole('heading', { name: '二进制会话', exact: true }, { timeout: 7000 });
  await user.click(screen.getByRole('button', { name: '产物', exact: true }));
  const drawer = await screen.findByRole('dialog', { name: '产物', exact: true });
  await user.click(await within(drawer).findByRole('button', { name: '二进制文件 1' }, { timeout: 7000 }));
  const detail = await screen.findByRole('region', { name: '产物详情' });
  expect(within(detail).queryByTitle('产物预览')).toBeNull();
  expect(within(detail).getByRole('button', { name: '定位来源' })).toBeTruthy();
  expect(within(detail).getByRole('button', { name: '导出产物' })).toBeTruthy();
  expect(reads).not.toHaveBeenCalled();
  view.unmount(); reads.mockRestore();
});

it('重新定位当前会话时，等待工作区快照期间的输入保存在该会话', { timeout: 20_000 }, async () => {
  const client = connect(), user = userEvent.setup(), drafts = createDraftStore();
  const view = render(<Conversation client={client} draftStore={drafts} />);
  const key = { workspaceId: fixture.workspace.id, sessionId: fixture.session.id };
  await user.click(await screen.findByRole('button', { name: 'D 集成会话' }));
  await screen.findByRole('heading', { name: 'D 集成会话' });
  await user.type(screen.getByLabelText('消息'), '保留');
  const snapshot = client.workspaceSnapshot.bind(client);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const session = vi.spyOn(client, 'session');
  const request = vi.spyOn(client, 'workspaceSnapshot').mockImplementationOnce(async (...args) => {
    await barrier;
    return snapshot(...args);
  });
  try {
    await user.click(screen.getByRole('button', { name: 'D 集成会话' }));
    await waitFor(() => expect(session).toHaveBeenCalledWith(key.sessionId));
    await act(async () => { await session.mock.results[0].value; });
    await user.type(screen.getByLabelText('消息'), '这条目标');
    expect(drafts.read(key).text).toBe('保留这条目标');
    expect(drafts.read({ ...key, sessionId: '' }).text).toBe('');
  } finally {
    release(); request.mockRestore(); session.mockRestore(); view.unmount();
  }
});

it('真实能力库选择→环境设置保存/检测→标准ZIP导出后仍保留原会话未提交草稿', { timeout: 30_000 }, async () => {
  const client = connect(), user = userEvent.setup();
  vi.mocked(invoke).mockImplementation(async command => command === 'choose_skill_export_target'
    ? { resources: [fixture.target] } : null);
  const view = render(<WorkbenchWindow client={client} />);
  await user.click(await screen.findByRole('button', { name: 'D 集成会话' }, { timeout: 7000 }));
  await screen.findByRole('heading', { name: 'D 集成会话' }, { timeout: 7000 });
  await user.type(screen.getByLabelText('消息'), '保留这条未提交目标');
  await user.click(screen.getByRole('button', { name: '选择 Skill' }));
  await user.click(await screen.findByRole('button', { name: '用于原会话的新目标' }));
  await screen.findByText(`release-note · ${fixture.version.content_hash.slice(0, 12)}`);
  await user.click(screen.getByTitle('设置'));
  await user.click(screen.getByRole('button', { name: '运行环境' }));
  await user.click(await screen.findByRole('button', { name: '登记运行环境' }));
  await user.type(screen.getByLabelText('解释器绝对路径'), fixture.executable);
  await user.click(screen.getByRole('button', { name: '保存运行环境' }));
  await screen.findByText('运行环境已保存；版本检测需单独进行');
  await waitFor(() => expect((screen.getByRole('button', { name: '检测版本' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: '检测版本' }));
  await waitFor(() => {
    const messages = within(screen.getByRole('region', { name: '运行环境' })).getAllByRole('status').map(item => item.textContent);
    expect(messages.join('\n')).toContain('检测完成：已完成版本检测');
  }, { timeout: 10_000 });
  await user.click(screen.getByRole('button', { name: '完成' }));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('保留这条未提交目标');
  await user.click(screen.getByRole('button', { name: '选择 Skill' }));
  await user.click(await screen.findByRole('button', { name: '导出标准包' }));
  await screen.findByText('已保存：actual-package.zip');
  expect(readFileSync(fixture.destination).subarray(0, 2).toString()).toBe('PK');
  expect(invoke).toHaveBeenCalledWith('choose_skill_export_target', {
    scope: { kind: 'workspace', workspace_id: fixture.workspace.id, session_id: null },
  });
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('保留这条未提交目标');
  expect(screen.getByText(`release-note · ${fixture.version.content_hash.slice(0, 12)}`)).toBeTruthy();
  view.unmount();
});
