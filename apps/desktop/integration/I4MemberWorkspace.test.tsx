import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { RuntimeClient, commandMeta } from '../src/api/client';
import type { SkillVersion, StartRunCommand } from '../src/generated/contracts';
import AssistantsPage from '../src/features/assistants/AssistantsPage';

let server: ChildProcessWithoutNullStreams, exited: Promise<unknown>;
let fixture: { connection: ConstructorParameters<typeof RuntimeClient>[0]; workspace_a: { id: string; name: string };
  workspace_b: { id: string; name: string }; session_a: string; session_b: string; primary_id: string; model_id: string;
  versions: Record<'personal' | 'a' | 'b' | 'unselected' | 'overridden', SkillVersion> };
const nativeFetch = globalThis.fetch;
beforeAll(async () => {
  server = spawn(resolve('../../.venv/Scripts/python.exe'), ['tests/m2/member_ui_server.py'], {
    cwd: resolve('../..'), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8',
      PYTHONPATH: `${resolve('../../packages')};${resolve('../..')}` },
  });
  exited = new Promise(done => server.once('exit', done));
  fixture = await new Promise((done, reject) => {
    let text = '', errors = '';
    server.stderr.on('data', chunk => { errors += String(chunk); });
    server.once('error', reject);
    server.once('exit', () => reject(new Error(errors)));
    server.stdout.on('data', chunk => { text += String(chunk); if (text.includes('\n')) done(JSON.parse(text.split('\n')[0])); });
  });
}, 30_000);
afterAll(async () => { server?.stdin.end('\n'); await exited; vi.unstubAllGlobals(); }, 20_000);

it('普通页面真实保存项目成员、跨项目保留ID，Run和委派固定版本且拒绝越界', { timeout: 30_000 }, async () => {
  const reads: string[] = [], writes: unknown[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const path = new URL(input).pathname;
    if (init.method === 'PUT' && path.includes('/profiles/')) writes.push(JSON.parse(String(init.body)));
    reads.push(String(input));
    return nativeFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Origin: 'http://tauri.localhost' } });
  });
  const client = new RuntimeClient(fixture.connection), user = userEvent.setup();
  render(<AssistantsPage client={client} onClose={() => {}} />);
  const { a, b, personal, overridden, unselected } = fixture.versions;
  const label = (value: SkillVersion) => `${value.name} · ${value.content_hash.slice(0, 12)}`;
  await screen.findByRole('option', { name: fixture.workspace_b.name });
  await user.selectOptions(await screen.findByLabelText('能力所属项目'), fixture.workspace_b.id);
  await screen.findByLabelText(label(b));
  await user.click(screen.getByRole('button', { name: '新建助理' }));
  await user.type(screen.getByLabelText('显示名称'), 'I4 普通页面成员');
  await user.selectOptions(screen.getByLabelText('默认模型'), fixture.model_id);
  await user.click(screen.getByLabelText('允许作为委派成员'));
  await user.click(screen.getByLabelText(label(b)));
  await user.click(screen.getByRole('button', { name: '保存助理' }));
  await screen.findByText('助理配置已保存；仅对新运行生效');
  const member = (await client.profiles()).items.find(profile => profile.display_name === 'I4 普通页面成员')!;
  expect(member.skill_ids).toEqual([b.skill_id]);
  expect(member.delegatable).toBe(true);
  await user.selectOptions(screen.getByLabelText('能力所属项目'), fixture.workspace_a.id);
  await screen.findByLabelText(label(a));
  expect(screen.getByLabelText(label(personal))).toBeTruthy();
  expect(screen.queryByLabelText(label(overridden))).toBeNull();
  expect(screen.queryByText(new RegExp(b.name))).toBeNull();
  await user.click(screen.getByLabelText(label(a)));
  await user.click(screen.getByLabelText(label(personal)));
  await user.click(screen.getByRole('button', { name: '保存助理' }));
  await waitFor(async () => expect((await client.profiles()).items.find(profile => profile.id === member.id)?.version).toBe(2));
  const saved = (await client.profiles()).items.find(profile => profile.id === member.id)!;
  expect(new Set(saved.skill_ids)).toEqual(new Set([b.skill_id, a.skill_id, personal.skill_id]));
  expect(reads.filter(url => new URL(url).pathname.includes(`/skills/${b.skill_id}`))).toEqual([]);

  const pins = { [a.skill_id]: a.content_hash, [personal.skill_id]: personal.content_hash };
  const start = (sessionId: string, skillVersions: Record<string, string>) => {
    const command: StartRunCommand = { meta: commandMeta(), data: { agent_profile_id: fixture.primary_id,
      model_profile_id: fixture.model_id, text: 'I4 本地固定版本验收', sources: { skill_versions: skillVersions } } };
    return client.startRun(sessionId, command);
  };
  const root = await start(fixture.session_a, { ...pins, [unselected.skill_id]: unselected.content_hash });
  expect(root.sources.skill_versions[a.skill_id]).toBe(a.content_hash);
  expect(root.config.members[member.id].skill_versions).toEqual(pins);
  async function submit(taskId: string, versions: Record<string, string>, allowedTools: string[] = []) {
    const response = await fetch(`${fixture.connection.base_url}/v3/tasks/${taskId}/submit`, {
      method: 'POST', headers: { Authorization: `Bearer ${fixture.connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: commandMeta(), data: { work: { kind: 'agent', profile_id: member.id,
        goal: '本地成员接纳', input_refs: [], output_schema: { type: 'object', properties: { answer: { type: 'string' } },
          required: ['answer'], additionalProperties: false }, success_criteria: ['answer'] },
        sources: { skill_versions: versions }, allowed_tools: allowedTools } }),
    });
    return { response, body: await response.json() };
  }
  const first = await submit(root.root_task_id, pins);
  expect(first.response.status).toBe(202);
  expect((await client.task(first.body.handle.task_id)).binding.sources.skill_versions).toEqual(pins);
  expect((await submit(root.root_task_id, { [unselected.skill_id]: unselected.content_hash })).body.error.code).toBe('outside_run_scope');
  expect((await submit(root.root_task_id, { [b.skill_id]: b.content_hash })).body.error.code).toBe('outside_run_scope');
  expect((await submit(root.root_task_id, { [a.skill_id]: '0'.repeat(64) })).body.error.code).toBe('outside_run_scope');
  const narrowedTools = await submit(root.root_task_id, pins, ['files.read_text']);
  expect(narrowedTools.response.status).toBe(202);
  expect((await client.task(narrowedTools.body.handle.task_id)).binding.config.catalog.tools).not.toHaveProperty('files.read_text');
  await expect(start(fixture.session_b, { [a.skill_id]: a.content_hash })).rejects.toMatchObject({ code: 'scope_mismatch' });

  const scope = { kind: 'workspace' as const, workspace_id: fixture.workspace_a.id, session_id: null };
  const candidate = await client.stageSkill({ meta: commandMeta(), data: { directory_name: a.directory_name, scope,
    skill_id: a.skill_id, base_hash: a.content_hash, files: { 'SKILL.md':
      '---\nname: i4-project-a\ndescription: new local method\n---\nnew fixed version\n' } } });
  const newer = await client.publishSkill({ meta: commandMeta(1), data: { staging_ref: candidate.staging_ref, scope, confirmed_hash: candidate.content_hash } });
  expect(newer.content_hash).not.toBe(a.content_hash);
  await user.click(screen.getByRole('button', { name: '刷新助理与目录' }));
  await screen.findByLabelText(label(newer));
  await user.selectOptions(screen.getByLabelText('编辑助理'), member.id);
  await user.click(screen.getByLabelText(label(newer)));
  await user.click(screen.getByRole('button', { name: '保存助理' }));
  await waitFor(async () => expect((await client.profiles()).items.find(profile => profile.id === member.id)?.version).toBe(3));
  const originalChild = await submit(root.root_task_id, { [a.skill_id]: a.content_hash });
  expect(originalChild.response.status).toBe(202);
  expect((await client.task(originalChild.body.handle.task_id)).binding.sources.skill_versions).toEqual({ [a.skill_id]: a.content_hash });
  const nextSession = await client.createSession(fixture.workspace_a.id, { meta: commandMeta(), data: { title: 'I4 新版本接纳' } });
  const narrowed = await start(nextSession.id, { [a.skill_id]: newer.content_hash });
  expect(narrowed.config.members[member.id].skill_versions).toEqual({});
  expect((await submit(narrowed.root_task_id, { [a.skill_id]: newer.content_hash })).body.error.code).toBe('outside_run_scope');
  const other = await start(fixture.session_b, { [b.skill_id]: b.content_hash });
  expect(other.config.members[member.id].skill_versions).toEqual({ [b.skill_id]: b.content_hash });
  expect((await submit(other.root_task_id, { [b.skill_id]: b.content_hash })).response.status).toBe(202);
  expect(writes).toHaveLength(3);
});
