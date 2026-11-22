import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import { id } from '../../test/fixtures';
import { skillHash, skillScope, skillView, skillReceipt } from '../../test/skill-fixtures';
import SkillDetail from './SkillDetail';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });

it('保存取消不写；确认旧hash后固定版本/target_ref，以真实saved回执显示实际文件名', async () => {
  const writes: any[] = [];
  vi.mocked(invoke).mockResolvedValueOnce({ resources: [] }).mockResolvedValueOnce({ resources: [{
    id, scope: skillScope, version: 1, kind: 'export', label: '所选旧包.zip', source_version: 'c'.repeat(64),
  }] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') { const body = JSON.parse(String(init.body)); writes.push(body);
      return Response.json({ ...skillReceipt, command_id: body.meta.command_id }); }
    if (path.endsWith('/skill-exports')) return Response.json([]);
    if (path.endsWith('/file')) return Response.json({ skill_id: skillView.version.skill_id, content_hash: skillHash, path: 'SKILL.md',
      file_hash: skillHash, encoding: 'utf-8', content: '原文', start: 0, end: 2, total: 2 });
    throw new Error(path);
  });
  const user = userEvent.setup(); render(<SkillDetail client={client()} view={skillView} scope={skillScope} workspaceId={id} onChanged={() => {}} onEdit={async () => {}} />);
  await user.click(screen.getByRole('button', { name: '导出标准包' }));
  expect(writes).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '导出标准包' }));
  await screen.findByText(/将覆盖所选文件/);
  expect(writes).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '确认覆盖并保存' }));
  await screen.findByText('已保存：实际保存.zip');
  expect(writes[0].data).toEqual({ scope: skillScope, skill_id: skillView.version.skill_id, content_hash: skillHash,
    target_ref: id, confirmed_target_hash: 'c'.repeat(64) });
  expect(writes[0].data).not.toHaveProperty('run_id');
});

it.each(['original', 'needs_restore', 'conflict'] as const)('重开真实%s保存命令可查；仅待恢复状态提供显式恢复', async state => {
  const writes: { path: string; body: any }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') { writes.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json({ ...skillReceipt, state: 'original', target_matches: 'original' }); }
    if (path.endsWith('/skill-exports')) return Response.json([{ ...skillReceipt, state, target_matches: state === 'original' ? 'original' : 'missing', cleanup_pending: true }]);
    if (path.endsWith('/file')) return Response.json({ skill_id: skillView.version.skill_id, content_hash: skillHash, path: 'SKILL.md',
      file_hash: skillHash, encoding: 'utf-8', content: '原文', start: 0, end: 2, total: 2 });
    return Response.json({ ...skillReceipt, state });
  });
  const user = userEvent.setup(); render(<SkillDetail client={client()} view={skillView} scope={skillScope} workspaceId={id} onChanged={() => {}} onEdit={async () => {}} />);
  await screen.findByRole('article', { name: '实际保存.zip' });
  expect(screen.queryByText('已保存：实际保存.zip')).toBeNull();
  expect(writes).toHaveLength(0);
  if (state === 'needs_restore') {
    await user.click(screen.getByRole('button', { name: '恢复原文件' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ path: `/v4/capabilities/skill-exports/${id}/restore`, body: { scope: skillScope } });
    await screen.findByText('原文件完整，未确认保存新版本');
  } else expect(screen.queryByRole('button', { name: '恢复原文件' })).toBeNull();
});

it.each(['rejected', 'lost'] as const)('%s保存结果区别明确失败与未确认原命令', async kind => {
  let commandId = '';
  const reads: string[] = [];
  vi.mocked(invoke).mockResolvedValue({ resources: [{
    id, scope: skillScope, version: 1, kind: 'export', label: 'selected.zip', source_version: null,
  }] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      commandId = JSON.parse(String(init.body)).meta.command_id;
      if (kind === 'lost') throw new TypeError('lost response');
      return Response.json({ error: { code: 'file_target_changed', safe_message: '所选目标已改变',
        retryable: false, related_ids: [] } }, { status: 409 });
    }
    if (path.endsWith('/skill-exports')) return Response.json([]);
    if (path.endsWith('/file')) return Response.json({ skill_id: skillView.version.skill_id, content_hash: skillHash, path: 'SKILL.md',
      file_hash: skillHash, encoding: 'utf-8', content: '原文', start: 0, end: 2, total: 2 });
    reads.push(path); return Response.json({ ...skillReceipt, command_id: commandId });
  });
  const user = userEvent.setup(); render(<SkillDetail client={client()} view={skillView} scope={skillScope} workspaceId={id} onChanged={() => {}} onEdit={async () => {}} />);
  await user.click(screen.getByRole('button', { name: '导出标准包' }));
  await screen.findByRole('alert');
  if (kind === 'rejected') {
    expect(screen.queryByRole('button', { name: '查询保存结果' })).toBeNull();
    expect((screen.getByRole('button', { name: '导出标准包' }) as HTMLButtonElement).disabled).toBe(false);
  } else {
    await user.click(screen.getByRole('button', { name: '查询保存结果' }));
    await screen.findByText('已保存：实际保存.zip');
    expect(reads).toEqual([`/v4/capabilities/skill-exports/${commandId}`]);
  }
});

it('版本失效重查保留未确认导出命令的原hash和target_ref', async () => {
  let commandId = '';
  vi.mocked(invoke).mockResolvedValue({ resources: [{
    id, scope: skillScope, version: 1, kind: 'export', label: 'selected.zip', source_version: null,
  }] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      const command = JSON.parse(String(init.body)); commandId = command.meta.command_id;
      expect(command.data.content_hash).toBe(skillHash);
      throw new TypeError('controlled lost receipt');
    }
    if (path.endsWith('/skill-exports')) return Response.json([]);
    if (path.endsWith('/file')) return Response.json({ skill_id: skillView.version.skill_id, content_hash: path.includes('cccc') ? 'c'.repeat(64) : skillHash,
      path: 'SKILL.md', file_hash: skillHash, encoding: 'utf-8', content: '原文', start: 0, end: 2, total: 2 });
    return Response.json({ ...skillReceipt, command_id: commandId });
  });
  const user = userEvent.setup(), runtime = client();
  const props = { client: runtime, scope: skillScope, workspaceId: id, onChanged: () => {}, onEdit: async () => {} };
  const view = render(<SkillDetail {...props} view={skillView} refreshKey={0} />);
  await user.click(screen.getByRole('button', { name: '导出标准包' }));
  await screen.findByRole('button', { name: '查询保存结果' });
  view.rerender(<SkillDetail {...props} view={{ ...skillView, version: { ...skillView.version, content_hash: 'c'.repeat(64) } }} refreshKey={1} />);
  expect(screen.getByRole('button', { name: '查询保存结果' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '查询保存结果' }));
  await screen.findByText('已保存：实际保存.zip');
});
