import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import { id, page } from '../../test/fixtures';
import { skillCandidate, skillHash, skillScope, skillView } from '../../test/skill-fixtures';
import CapabilityLibrary from './CapabilityLibrary';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });

it('长名单只显示名称和状态，搜索后原包描述及编辑正文来自选中项', async () => {
  const items = Array.from({ length: 27 }, (_, index) => ({ ...skillView,
    version: { ...skillView.version, skill_id: `00000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`,
      name: `review-${String(index + 1).padStart(2, '0')}`, directory_name: `review-${String(index + 1).padStart(2, '0')}`,
      description: `该包用于第 ${index + 1} 项审核` } }));
  const selected = items[26].version;
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input), path = url.pathname;
    paths.push(path);
    if (path.endsWith('/skills')) return Response.json(page(items.filter(item => item.version.name.includes(url.searchParams.get('query') ?? ''))));
    if (path.endsWith('/skill-exports')) return Response.json([]);
    if (path.endsWith('/file')) {
      const version = items.find(item => path.includes(item.version.skill_id))!.version;
      const content = `固定说明 ${version.name}`;
      return Response.json({ skill_id: version.skill_id, content_hash: skillHash, path: 'SKILL.md',
        file_hash: skillHash, encoding: 'utf-8', content, start: 0, end: content.length, total: content.length });
    }
    if (path.endsWith(`/skills/${selected.skill_id}`)) return Response.json({
      skill_id: selected.skill_id, current_hash: skillHash, scope: selected.scope, revision: 1, status: 'active',
    });
    throw new Error(path);
  });
  render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  const list = within(screen.getByRole('complementary', { name: 'Skill 列表' }));
  await list.findByRole('button', { name: /review-27/ });
  expect(list.getAllByRole('button')).toHaveLength(27);
  expect(list.queryByText('该包用于第 27 项审核')).toBeNull();
  fireEvent.change(screen.getByLabelText('搜索 Skills'), { target: { value: 'review-27' } });
  const detail = within(await screen.findByRole('article', { name: 'Skill 详情' }));
  await detail.findByRole('heading', { name: 'review-27' });
  expect(list.getAllByRole('button')).toHaveLength(1);
  expect(detail.getByText('该包用于第 27 项审核')).toBeTruthy();
  await userEvent.click(detail.getByRole('button', { name: '编辑新版本' }));
  expect(await screen.findByLabelText('SKILL.md 原文件')).toHaveProperty('value', '固定说明 review-27');
  expect(paths).toContain(`/v3/capabilities/skills/${selected.skill_id}`);
});

it.each(['2026.11-preview+local', undefined])('打开脚本包详情时显示发布版和许可对应的解释器（%s）', async release => {
  const executable = 'C:/Selected Tools/python.exe';
  const binding = { ...skillView.binding!, environment_id: id, environment_revision: 1 };
  const version = { ...skillView.version, metadata: release ? { version: release } : {},
    files: [...skillView.version.files, { path: 'scripts/report.py', content_hash: skillHash, size_bytes: 5 }] };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/skills')) return Response.json(page([{ ...skillView, version, binding }]));
    if (path.endsWith('/skill-exports')) return Response.json([]);
    if (path.endsWith('/script-settings')) return Response.json({
      skill_id: version.skill_id, content_hash: skillHash, scope: skillScope, scripts: ['scripts/report.py'], binding,
      permissions: [{ id, skill_id: version.skill_id, content_hash: skillHash, environment_id: id,
        environment_revision: 1, scope: skillScope, revision: 1, status: 'active' }],
    });
    if (path.endsWith('/file')) return Response.json({ skill_id: version.skill_id, content_hash: skillHash, path: 'SKILL.md',
      file_hash: skillHash, encoding: 'utf-8', content: '包说明', start: 0, end: 3, total: 3 });
    if (path.endsWith(`/execution-environments/${id}`)) return Response.json({
      id, revision: 1, kind: 'python', executable_path: executable, executable_identity: 'identity', version: 'Python 3.13',
      cwd_mode: 'package_copy', env_keys: [], dependency_coverage: 'unverified', manifest_count: 0,
      status: 'probed', checked_at: null, diagnostic_code: null,
    });
    throw new Error(path);
  });
  const user = userEvent.setup();
  render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  const item = await screen.findByRole('button', { name: /release-note.*项目.*已启用/ });
  await user.click(item);
  const detail = await screen.findByRole('article', { name: 'Skill 详情' });
  await user.click(within(detail).getByText('版本详情'));
  expect((await within(detail).findByText(/此版本已有执行许可/)).closest('section')?.textContent).toContain(executable);
  const decision = within(detail).getByRole('group', { name: '当前脚本许可' });
  for (const value of ['release-note', release ?? '当前发布版', executable]) expect(decision.textContent).toContain(value);
  expect(within(detail).getByRole('heading', { name: 'release-note' })).toBeTruthy();
  expect(within(detail).getByText('用户创建')).toBeTruthy();
  expect(detail.textContent).not.toMatch(new RegExp(`${id}|${skillHash.slice(0, 12)}`));
  expect(item.getAttribute('aria-label') ?? item.textContent).not.toContain(skillHash.slice(0, 12));
  expect(within(detail).getByText(release ?? '当前发布版').closest('details')?.open).toBe(true);
});

it('真实DTO默认显示Skills；创建先预览候选，再按明确hash发布并启用', { timeout: 15_000 }, async () => {
  const writes: { path: string; body: any }[] = [];
  let published = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push({ path, body });
      if (path.endsWith('skill-candidates')) return Response.json(skillCandidate);
      if (path === '/capabilities/skills') { published = true; return Response.json(skillView.version); }
    }
    if (path === '/capabilities/skills') return Response.json(page(published ? [skillView] : []));
    if (path === '/capabilities/skill-exports') return Response.json([]);
    if (path.endsWith('/file')) return Response.json({ skill_id: skillView.version.skill_id, content_hash: skillHash, path: 'SKILL.md',
      file_hash: skillHash, encoding: 'utf-8', content: '候选原文：发布说明', start: 0, end: 10, total: 10 });
    throw new Error(path);
  });
  const user = userEvent.setup(); render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getByRole('tab', { name: 'Skills' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: 'MCP' }).getAttribute('aria-selected')).toBe('false');
  await user.click(screen.getByRole('button', { name: '创建 Skill' }));
  await user.type(screen.getByLabelText('包目录名'), 'release-note');
  fireEvent.change(screen.getByLabelText('SKILL.md 原文件'), { target: { value: '---\nname: release-note\ndescription: 发布说明\n---\n候选正文' } });
  await user.click(screen.getByRole('button', { name: '校验候选' }));
  await screen.findByText('候选原文：发布说明');
  expect(writes).toHaveLength(1);
  expect(writes[0].body.data.files).toHaveProperty('SKILL.md');
  await user.click(screen.getByRole('button', { name: '确认发布此版本' }));
  await screen.findByRole('article', { name: 'Skill 详情' });
  expect(writes[1]).toMatchObject({ path: '/capabilities/skills', body: {
    meta: { expected_version: null }, data: { scope: skillScope, staging_ref: skillCandidate.staging_ref, confirmed_hash: skillHash },
  } });
});

it('导入取消不发API；真实原生选择只提交selection ID并等待显式发布', async () => {
  const writes: any[] = [];
  vi.mocked(invoke).mockResolvedValueOnce({ resources: [] }).mockResolvedValueOnce({ resources: [{
    id, scope: skillScope, version: 1, kind: 'directory', label: 'release-note', source_version: null,
  }] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') { writes.push(JSON.parse(String(init.body))); return Response.json(skillCandidate); }
    if (path.endsWith('/skills')) return Response.json(page([]));
    if (path.endsWith('/file')) return Response.json({ skill_id: skillView.version.skill_id, content_hash: skillHash, path: 'SKILL.md',
      file_hash: skillHash, encoding: 'utf-8', content: '导入原文', start: 0, end: 4, total: 4 });
    throw new Error(path);
  });
  const user = userEvent.setup(); render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: '导入目录' }));
  expect(writes).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '导入目录' }));
  await screen.findByText('导入原文');
  expect(writes).toHaveLength(1);
  expect(writes[0].data).toEqual({ scope: skillScope, selection_id: id, skill_id: null, base_hash: null });
  expect(invoke).toHaveBeenCalledWith('select_skill_package', { scope: skillScope, kind: 'directory' });
});

it('启停使用binding CAS；用户编辑候选保留base hash和管理revision', async () => {
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (init.method) {
      const body = JSON.parse(String(init.body)); writes.push({ path, body });
      if (path.endsWith('skill-bindings')) return Response.json({ ...body.data, revision: 2 });
      return Response.json({ ...skillCandidate, base_hash: skillHash });
    }
    if (path === '/capabilities/skills') return Response.json(page([skillView]));
    if (path === '/capabilities/skill-exports') return Response.json([]);
    if (path.endsWith('/file')) return Response.json({ skill_id: skillView.version.skill_id, content_hash: skillHash, path: 'SKILL.md',
      file_hash: skillHash, encoding: 'utf-8', content: '原始SKILL文件', start: 0, end: 11, total: 11 });
    if (path.endsWith(skillView.version.skill_id)) return Response.json({ skill_id: skillView.version.skill_id, current_hash: skillHash, scope: skillScope, revision: 3, status: 'active' });
    throw new Error(path);
  });
  const user = userEvent.setup(); render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '停用' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toMatchObject({ meta: { expected_version: 1 }, data: { enabled: false, revision: 1 } });
  await user.click(screen.getByRole('button', { name: '编辑新版本' }));
  const editor = await screen.findByLabelText('SKILL.md 原文件');
  expect((editor as HTMLTextAreaElement).value).toBe('原始SKILL文件');
  await user.type(editor, '更新');
  await user.click(screen.getByRole('button', { name: '校验候选' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].body.data).toMatchObject({ skill_id: skillView.version.skill_id, base_hash: skillHash, scope: skillScope });
});

it('明确拒绝候选后可继续编辑，不把版本冲突留成永久待核对', async () => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') return Response.json({ error: { code: 'version_conflict', safe_message: '原版本已更新',
      retryable: false, related_ids: [] } }, { status: 409 });
    if (new URL(url).pathname.endsWith('/skills')) return Response.json(page([]));
    throw new Error(url);
  });
  const user = userEvent.setup(); render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: '创建 Skill' }));
  fireEvent.change(screen.getByLabelText('包目录名'), { target: { value: 'release-note' } });
  await user.click(screen.getByRole('button', { name: '校验候选' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('SKILL.md 原文件') as HTMLTextAreaElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: '取消编辑' }) as HTMLButtonElement).disabled).toBe(false);
});
