import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient, commandMeta } from '../src/api/client';
import { createRuntimeStore } from '../src/state/runtime-store';
import { createDraftStore } from '../src/state/draft-store';
import { expectComposerModel } from '../src/test/composer-model';
import { Conversation } from '../src/features/chat/Conversation';
import AssistantsPage from '../src/features/assistants/AssistantsPage';
import WorkbenchWindow from '../src/windows/WorkbenchWindow';
import type { SkillBinding, SkillVersion, ResourceRef, ArtifactRef, Session } from '../src/generated/contracts';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
let process: ChildProcessWithoutNullStreams;
let fixture: { connection: ConstructorParameters<typeof RuntimeClient>[0]; workspace: { id: string };
  session: Session; binding: SkillBinding; version: SkillVersion; target: ResourceRef;
  binary_session: string; artifact: ArtifactRef;
  destination: string; executable: string; package_path: string };
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
  const trace = vi.spyOn(client, 'trace');
  const { items: [binaryRun] } = await client.sessionRuns(fixture.binary_session);
  expect(binaryRun.output?.artifact_ids).toEqual([fixture.artifact.id]);
  const view = render(<Conversation client={client} />);
  await user.click(await screen.findByRole('button', { name: '二进制会话' }, { timeout: 7000 }));
  await screen.findByRole('heading', { name: '二进制会话', exact: true }, { timeout: 7000 });
  await user.click(screen.getByRole('button', { name: '产物', exact: true }));
  const drawer = await screen.findByRole('dialog', { name: '产物', exact: true });
  await user.click(await within(drawer).findByRole('button', { name: '二进制文件 1' }, { timeout: 7000 }));
  const detail = await screen.findByRole('region', { name: '产物详情' });
  expect(within(detail).queryByTitle('产物预览')).toBeNull();
  expect(within(detail).getByText('二进制文件，可导出到本机。')).toBeTruthy();
  expect(within(detail).getByRole('button', { name: '导出产物' })).toBeTruthy();
  await user.click(within(detail).getByRole('button', { name: '定位来源' }));
  const events = within(await screen.findByRole('region', { name: '公开事件' }));
  await events.findByText('步骤回执');
  expect(trace.mock.calls.map(([runId]) => runId)).toEqual([binaryRun.id]);
  expect(reads).not.toHaveBeenCalled();
  view.unmount(); reads.mockRestore(); trace.mockRestore();
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

it('助理设置保存到选中的委派成员，新会话仍使用 Runtime 默认助理及其模型', { timeout: 30_000 }, async () => {
  const client = connect(), user = userEvent.setup();
  vi.mocked(invoke).mockResolvedValue(null);
  const [agent] = (await client.profiles()).items;
  expect(agent.id).toBe(fixture.session.agent_profile_id);
  const [originalModel] = (await client.models()).items;
  const modelId = crypto.randomUUID();
  const newModel = await client.saveModel(modelId, {
    meta: commandMeta(), data: { ...originalModel, id: modelId, version: 1, model_id: 'alternate-session-model' },
  });
  const memberId = '00000000-0000-4000-8000-000000000000';
  const member = await client.saveAgent(memberId, { meta: commandMeta(), data: {
    ...agent, id: memberId, version: 1, display_name: '排序靠前的委派成员', delegatable: true,
  } });
  expect((await client.profiles()).items[0].id).toBe(member.id);
  render(<WorkbenchWindow client={client} />);
  await user.click(screen.getByTitle('设置'));
  const settings = await screen.findByRole('dialog', { name: '设置' });
  const settingsQueries = within(settings);
  await user.click(settingsQueries.getByRole('button', { name: '助理设置', exact: true }));
  const assistants = await settingsQueries.findByLabelText('编辑助理');
  await user.selectOptions(assistants, agent.id);
  await user.selectOptions(assistants, member.id);
  const picker = await settingsQueries.findByLabelText('默认模型');
  await waitFor(() => expect(picker.matches(':disabled')).toBe(false));
  await user.selectOptions(picker, newModel.id);
  await user.click(settingsQueries.getByRole('button', { name: '保存助理' }));
  await settingsQueries.findByText('助理配置已保存；仅对新运行生效');
  await user.click(settingsQueries.getByRole('button', { name: '完成' }));
  const savedProfiles = (await client.profiles()).items;
  expect(savedProfiles.find(item => item.id === member.id)).toEqual({
    ...member, version: member.version + 1, default_model_profile_id: newModel.id,
  });
  expect(savedProfiles.find(item => item.id === agent.id)).toEqual(agent);
  await user.click(screen.getByRole('button', { name: '新建会话' }));
  await user.type(screen.getByLabelText('新会话标题'), '核对真实默认模型');
  await user.click(screen.getByRole('button', { name: '创建会话' }));
  await screen.findByRole('heading', { name: '核对真实默认模型' });
  const created = (await client.sessions(fixture.workspace.id)).items.find(item => item.title === '核对真实默认模型');
  expect(created?.agent_profile_id).toBe(agent.id);
  await expectComposerModel(user, originalModel.id);
});

it('两窗各自可保存的助理修改发生业务校验冲突后，可在合并草稿和最新修订上修正', { timeout: 30_000 }, async () => {
  const client = connect(), user = userEvent.setup();
  const [model] = (await client.models()).items;
  const id = crypto.randomUUID();
  const profile = await client.saveAgent(id, { meta: commandMeta(), data: {
    id, version: 1, display_name: '两窗编辑助理', default_model_profile_id: model.id,
  } });
  render(<AssistantsPage client={client} onClose={() => {}} />);
  await user.selectOptions(await screen.findByLabelText('编辑助理'), profile.id);
  await waitFor(() => expect(screen.getByLabelText('默认模型').matches(':disabled')).toBe(false));
  await user.click(screen.getByRole('checkbox', { name: '允许作为委派成员' }));
  await user.type(screen.getByLabelText('工作指导'), '保留本窗指导');
  const latest = await client.saveAgent(profile.id, { meta: commandMeta(profile.version), data: {
    ...profile, default_model_profile_id: null, communication_style: '保留另一窗语气',
  } });
  await user.click(screen.getByRole('button', { name: '保存助理' }));
  await user.click(await screen.findByRole('button', { name: '读取最新助理配置' }));
  await user.click(await screen.findByRole('button', { name: '保存合并后的助理' }));
  await screen.findByText('可委派成员必须明确选择默认模型', { selector: '[role="alert"]' });
  expect(screen.getByLabelText('默认模型').matches(':disabled')).toBe(false);
  expect(screen.getByLabelText('默认模型')).toHaveProperty('value', '');
  expect(screen.getByLabelText('工作指导')).toHaveProperty('value', '保留本窗指导');
  expect(screen.getByLabelText('沟通方式')).toHaveProperty('value', '保留另一窗语气');
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  await screen.findByRole('heading', { name: '有未保存的助理配置' });
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await user.selectOptions(screen.getByLabelText('默认模型'), model.id);
  await user.click(screen.getByRole('button', { name: '保存合并后的助理' }));
  await screen.findByText('助理配置已保存；仅对新运行生效');
  expect((await client.profiles()).items.find(item => item.id === profile.id)).toMatchObject({
    version: latest.version + 1, delegatable: true, default_model_profile_id: model.id,
    instructions: '保留本窗指导', communication_style: '保留另一窗语气',
  });
});

it('真实 ZIP 已写入但首响丢失，包失效后重试仍能查询并定位原回执，保留原草稿', { timeout: 30_000 }, async () => {
  const client = connect(), user = userEvent.setup();
  const saveRequests: string[] = [], saveStatuses: number[] = [], receiptQueries: string[] = [];
  const runtimeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    const exportPath = '/v4/capabilities/skill-exports';
    if (path.startsWith(`${exportPath}/`)) receiptQueries.push(path);
    const response = await runtimeFetch(input, init);
    if (path === exportPath && init.method === 'POST') {
      saveRequests.push(String(init.body));
      saveStatuses.push(response.status);
      if (saveRequests.length === 1 && response.ok) {
        unlinkSync(fixture.package_path);
        throw new TypeError('lost HTTP response after native export');
      }
    }
    return response;
  });
  vi.mocked(invoke).mockImplementation(async command => command === 'choose_skill_export_target'
    ? { resources: [fixture.target] } : null);
  const view = render(<WorkbenchWindow client={client} />);
  await user.click(await screen.findByRole('button', { name: 'D 集成会话' }, { timeout: 7000 }));
  await screen.findByRole('heading', { name: 'D 集成会话' }, { timeout: 7000 });
  await user.type(screen.getByLabelText('消息'), '保留这条未提交目标');
  await user.click(screen.getByRole('button', { name: '选择 Skill' }));
  await user.click(await screen.findByRole('button', { name: '用于原会话的新目标' }));
  await screen.findByText('release-note · 本次已选版本');
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
  const retry = await screen.findByRole('button', { name: '重试保存' });
  await waitFor(() => expect(retry).toHaveProperty('disabled', false));
  await user.click(retry);
  await waitFor(() => expect(saveStatuses).toEqual([200, 409]));
  await waitFor(() => expect(screen.getByRole('button', { name: '查询保存结果' })).toHaveProperty('disabled', false));
  expect(screen.getByRole('button', { name: '导出标准包' })).toHaveProperty('disabled', true);
  await user.click(screen.getByRole('button', { name: '查询保存结果' }));
  const record = await screen.findByRole('article', { name: 'actual-package.zip' });
  expect(document.activeElement).toBe(record);
  expect(within(record).getByText('当时已确认保存')).toBeTruthy();
  expect(within(record).queryByRole('button')).toBeNull();
  expect(saveRequests).toEqual([saveRequests[0], saveRequests[0]]);
  expect(readFileSync(fixture.destination).subarray(0, 2).toString()).toBe('PK');
  const receipts = await client.skillExports({ scope_kind: 'workspace', workspace_id: fixture.workspace.id, skill_id: fixture.version.skill_id });
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ state: 'saved', content_hash: fixture.version.content_hash, target_ref: fixture.target.id });
  expect(receiptQueries).toEqual([`/v4/capabilities/skill-exports/${receipts[0].command_id}`]);
  expect(invoke).toHaveBeenCalledWith('choose_skill_export_target', {
    scope: { kind: 'workspace', workspace_id: fixture.workspace.id, session_id: null },
  });
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('保留这条未提交目标');
  expect(screen.getByText('release-note · 本次已选版本')).toBeTruthy();
  view.unmount();
});
