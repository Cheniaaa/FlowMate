import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
