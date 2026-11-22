import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { id, page, secondId } from '../../test/fixtures';
import { skillHash, skillReceipt, skillScope, skillView } from '../../test/skill-fixtures';
import { invoke } from '@tauri-apps/api/core';
import CapabilityLibrary from './CapabilityLibrary';
import { forgetSkillExport, rememberSkillExport } from './deferred-skill-exports';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
const receipt = { ...skillReceipt, state: 'needs_restore', target_matches: 'missing',
  backup_path: 'C:\\Synthetic\\.owned.backup', backup_matches: true, stage_matches: true,
  cleanup_pending: true, disposition: 'pending' };

it('读取包内文件失败时保留原保存请求，迟到的旧列表不能覆盖新回执', async () => {
  const writes: string[] = [];
  let resolveList!: (response: Response) => void;
  vi.mocked(invoke).mockResolvedValue({ resources: [{ id, scope: skillScope, version: 1, kind: 'export', label: '实际保存.zip', source_version: null }] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith('/skills')) return Response.json(page([skillView]));
    if (pathname.endsWith('/skill-exports')) {
      if (init.method === 'POST') {
        writes.push(String(init.body));
        if (writes.length === 1) throw new TypeError('lost receipt');
        return Response.json({ ...skillReceipt, command_id: JSON.parse(writes[0]).meta.command_id });
      }
      return new Promise<Response>(resolve => { resolveList = resolve; });
    }
    if (pathname.endsWith('/file') && searchParams.get('path') === 'assets/data.bin') {
      return Response.json({ error: { code: 'not_found', safe_message: '包内文件已失效', retryable: false, related_ids: [] } }, { status: 404 });
    }
    if (pathname.endsWith('/file')) return Response.json({ skill_id: skillView.version.skill_id, content_hash: skillHash,
      path: 'SKILL.md', file_hash: skillHash, encoding: 'utf-8', content: '正文', start: 0, end: 2, total: 2 });
    throw new Error(pathname);
  });
  const user = userEvent.setup();
  render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '导出标准包' }));
  await screen.findByRole('button', { name: '重试保存' });
  await user.click(screen.getByRole('button', { name: 'assets/data.bin' }));
  await screen.findByText('包内文件已失效');
  await user.click(screen.getByRole('button', { name: '重试保存' }));
  await screen.findByText('已保存：实际保存.zip');
  await act(async () => resolveList(Response.json([{ ...receipt, command_id: JSON.parse(writes[0]).meta.command_id }])));
  expect(screen.getByText('已保存：实际保存.zip')).toBeTruthy();
  expect(screen.queryByText('保存中断，原文件待恢复')).toBeNull();
  expect(writes).toEqual([writes[0], writes[0]]);
});

it('未写入且不存在的目标不会显示原文件完整', async () => {
  vi.stubGlobal('fetch', async (url: string) => Response.json(url.includes('/skill-exports')
    ? [{ ...receipt, state: 'original', target_matches: 'missing' }] : page([])));
  render(<CapabilityLibrary client={client()} workspaceId={id} initialRecovery onClose={() => {}} />);
  const record = await screen.findByRole('article', { name: '实际保存.zip' });
  expect(within(record).getByText('目标文件未写入')).toBeTruthy();
  expect(within(record).queryByText(/原文件完整/)).toBeNull();
});

it('切换保存记录范围后，迟到的查询不会显示到新范围', async () => {
  let finishWorkspace!: (response: Response) => void;
  const saved = { ...skillReceipt, target_path: 'C:\\Synthetic\\个人副本.zip' };
  vi.stubGlobal('fetch', async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith('/skills')) return Response.json(page([]));
    if (searchParams.get('scope_kind') === 'workspace') {
      return new Promise<Response>(resolve => { finishWorkspace = resolve; });
    }
    return Response.json([saved]);
  });
  const user = userEvent.setup();
  render(<CapabilityLibrary client={client()} workspaceId={id} initialRecovery onClose={() => {}} />);
  await screen.findByText('正在读取保存记录…');
  await user.selectOptions(screen.getByLabelText('能力范围'), 'user_global');
  await screen.findByRole('article', { name: '个人副本.zip' });
  await act(async () => finishWorkspace(Response.json([receipt])));
  expect(screen.queryByRole('article', { name: '实际保存.zip' })).toBeNull();
  expect(screen.getByRole('article', { name: '个人副本.zip' })).toBeTruthy();
});

it('即使原Skill已删除，能力库保存记录仍可显式恢复/完成清理再重试删除', async () => {
  const writes: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      writes.push(path);
      return Response.json({ ...receipt, state: 'original', target_matches: 'original',
        disposition: path.endsWith('/finalize') ? 'restored' : 'pending',
        cleanup_pending: !path.endsWith('/finalize'), backup_matches: false });
    }
    if (path.endsWith('/skills')) return Response.json(page([]));
    if (path.endsWith('/skill-exports')) return Response.json([receipt]);
    throw new Error(`恢复不应读取已删原包 ${path}`);
  });
  const user = userEvent.setup();
  render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: '保存记录与恢复' }));
  await screen.findByText('保存中断，原文件待恢复');
  const record = within(screen.getByRole('region', { name: '保存记录' })).getByRole('article');
  expect(record.textContent).toContain('实际保存.zip');
  expect(record.textContent).not.toMatch(new RegExp(`${id}|${skillHash.slice(0, 12)}`));
  expect(record.getAttribute('aria-label')).toBe('实际保存.zip');
  expect(writes).toEqual([]);
  await user.click(screen.getByRole('button', { name: '恢复原文件' }));
  await screen.findByText('原文件完整，未确认保存新版本');
  await user.click(screen.getByRole('button', { name: '完成处置并清理所属临时文件' }));
  await screen.findByText('已恢复原文件并完成处置');
  expect(writes).toEqual([`/v3/capabilities/skill-exports/${id}/restore`, `/v3/capabilities/skill-exports/${id}/finalize`]);
});

it('读取不到回执后以原命令重试，只生成一笔业务操作并显示原目标', async () => {
  const target = '2026.11-原名.zip';
  const pathBase = '/v3/capabilities/skill-exports';
  const writes: string[] = [], reads: string[] = [];
  const completed = new Set<string>();
  vi.mocked(invoke).mockResolvedValue({ resources: [{
    id, scope: skillScope, version: 1, kind: 'export', label: target, source_version: skillHash,
  }] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === pathBase && init.method === 'POST') {
      const command = JSON.parse(String(init.body));
      writes.push(String(init.body));
      completed.add(command.meta.command_id);
      if (writes.length === 1) throw new TypeError('lost receipt');
      return Response.json({ ...skillReceipt, command_id: command.meta.command_id, target_path: `C:\\Synthetic\\${target}` });
    }
    if (path === pathBase) return Response.json([]);
    if (path.startsWith(`${pathBase}/`)) {
      reads.push(path);
      return Response.json({ error: { code: 'skill_export_not_found', safe_message: 'skill_export_not_found',
        retryable: false, related_ids: [] } }, { status: 409 });
    }
    if (path.endsWith('/skills')) return Response.json(page([skillView]));
    if (path.endsWith('/file')) return Response.json({ skill_id: skillView.version.skill_id, content_hash: skillHash,
      path: 'SKILL.md', file_hash: skillHash, encoding: 'utf-8', content: '包说明', start: 0, end: 3, total: 3 });
    throw new Error(path);
  });
  const user = userEvent.setup();
  render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '导出标准包' }));
  const overwrite = screen.getByRole('dialog', { name: '确认覆盖' });
  expect(overwrite.textContent).toContain(target);
  await user.click(within(overwrite).getByRole('button', { name: '确认覆盖并保存' }));
  const lookup = await screen.findByRole('button', { name: '查询保存结果' });
  await waitFor(() => expect(document.activeElement).toBe(lookup));
  const originalId = JSON.parse(writes[0]).meta.command_id;
  await user.click(lookup);
  expect(reads).toEqual([`${pathBase}/${originalId}`]);
  const retry = await screen.findByRole('button', { name: '重试保存' });
  const pending = screen.getByRole('region', { name: '保存结果待确认' });
  expect(pending.textContent).toContain(target);
  expect(pending.textContent).not.toContain(originalId);
  expect(overwrite.textContent).not.toContain(skillHash);
  await user.click(retry);
  await screen.findByText(`已保存：${target}`);
  expect(document.activeElement).toBe(screen.getByRole('article', { name: target }));
  expect(writes).toHaveLength(2);
  expect(writes[1]).toBe(writes[0]);
  expect(completed.size).toBe(1);
});

it('原命令查询定位的回执在已删除 Skill 刷新目录后仍可阅读', async () => {
  let deleted = false;
  let recorded: typeof skillReceipt;
  let updatedDirectory = false;
  vi.mocked(invoke).mockResolvedValue({ resources: [{
    id, scope: skillScope, version: 1, kind: 'export', label: '实际保存.zip', source_version: null,
  }] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/skills')) {
      if (deleted) updatedDirectory = true;
      return Response.json(page(deleted ? [] : [skillView]));
    }
    if (path.endsWith('/skill-exports')) {
      if (init.method === 'POST') {
        recorded = { ...skillReceipt, disposition: 'finalized', command_id: JSON.parse(String(init.body)).meta.command_id };
        throw new TypeError('lost receipt');
      }
      return Response.json(recorded ? [recorded] : []);
    }
    if (path.endsWith(`/skill-exports/${recorded?.command_id}`)) return Response.json(recorded);
    if (path.endsWith('/file')) return Response.json({ skill_id: skillView.version.skill_id, content_hash: skillHash,
      path: 'SKILL.md', file_hash: skillHash, encoding: 'utf-8', content: '包说明', start: 0, end: 3, total: 3 });
    throw new Error(path);
  });
  const user = userEvent.setup();
  const props = { client: client(), workspaceId: id, onClose: () => {} };
  const view = render(<CapabilityLibrary {...props} refreshKey={0} />);
  await user.click(await screen.findByRole('button', { name: '导出标准包' }));
  await screen.findByRole('button', { name: '查询保存结果' });
  deleted = true;
  view.rerender(<CapabilityLibrary {...props} refreshKey={1} />);
  await user.click(screen.getByRole('button', { name: '查询保存结果' }));
  await waitFor(() => expect(updatedDirectory).toBe(true));
  await waitFor(() => {
    expect(screen.queryByRole('article', { name: 'Skill 详情' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('article', { name: '实际保存.zip' }));
  });
});

it('放弃恢复要求显式确认，回执处置后不再提供恢复或清理', async () => {
  const writes: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      writes.push(path); return Response.json({ ...receipt, state: 'conflict', reason: 'file_access_failed', disposition: 'released' });
    }
    if (path.endsWith('/skills')) return Response.json(page([]));
    return Response.json([{ ...receipt, state: 'conflict' }]);
  });
  const user = userEvent.setup();
  render(<CapabilityLibrary client={client()} workspaceId={id} onClose={() => {}} />);
  await user.click(screen.getByRole('button', { name: '保存记录与恢复' }));
  await user.click(await screen.findByRole('button', { name: '放弃自动恢复' }));
  expect(writes).toEqual([]);
  expect(screen.getByText(/外部目标、暂存和备份都会保留/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '确认放弃恢复并保留外部文件' }));
  const record = screen.getByRole('article', { name: '实际保存.zip' });
  expect(await within(record).findByText('处置时记录的文件状态')).toBeTruthy();
  expect(within(record).getByText('已放弃自动恢复')).toBeTruthy();
  expect(within(record).queryByRole('button')).toBeNull();
  expect(within(record).queryByText(/重试|重新核对/)).toBeNull();
  expect(writes).toEqual([`/v3/capabilities/skill-exports/${id}/release`]);
});

it('跨窗失效重查期间保留正在操作的恢复入口', async () => {
  let reads = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    if (new URL(url).pathname.endsWith('/skills')) return Response.json(page([]));
    if (++reads > 1) return new Promise<Response>(() => {});
    return Response.json([receipt]);
  });
  const runtime = client();
  const view = render(<CapabilityLibrary client={runtime} workspaceId={id} initialRecovery refreshKey={0} onClose={() => {}} />);
  await screen.findByRole('button', { name: '恢复原文件' });
  view.rerender(<CapabilityLibrary client={runtime} workspaceId={id} initialRecovery refreshKey={1} onClose={() => {}} />);
  expect(screen.getByRole('button', { name: '恢复原文件' })).toBeTruthy();
});

it('恢复页同步同范围窗口的暂缓与确认，保留其余原命令供查询重试', async () => {
  const original = { meta: { command_id: id, expected_version: null }, data: {
    scope: skillScope, skill_id: skillView.version.skill_id, content_hash: skillHash,
    target_ref: id, confirmed_target_hash: null,
  } };
  const another = { ...original, meta: { ...original.meta, command_id: secondId }, data: { ...original.data, target_ref: secondId } };
  const personal = { ...original, data: { ...original.data, scope: { kind: 'user_global' as const, workspace_id: null, session_id: null } } };
  const installed: typeof skillReceipt[] = [];
  const commands: { path: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/skills')) return Response.json(page([]));
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      commands.push({ path, body });
      return Response.json({ ...skillReceipt, command_id: secondId, target_path: 'D:\\合成\\另一份.zip' });
    }
    if (!path.endsWith('/skill-exports')) {
      commands.push({ path });
      return Response.json({ error: { code: 'skill_export_not_found', safe_message: '暂未找到', retryable: false, related_ids: [] } }, { status: 404 });
    }
    return Response.json(installed);
  });
  function writeFromAnotherWindow(label: string, command: typeof original | typeof personal) {
    rememberSkillExport(id, { label, command });
    const key = Object.keys(localStorage).find(key => JSON.parse(localStorage.getItem(key)!).label === label)!;
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
    return key;
  }
  try {
    const user = userEvent.setup();
    render(<CapabilityLibrary client={client()} workspaceId={id} initialRecovery onClose={() => {}} />);
    await screen.findByText('当前范围没有保存记录。');
    let firstKey = '';
    act(() => {
      firstKey = writeFromAnotherWindow('首份.zip', original);
      writeFromAnotherWindow('另一份.zip', another);
      writeFromAnotherWindow('个人.zip', personal);
    });
    const first = await screen.findByRole('article', { name: '首份.zip' });
    expect(screen.queryByRole('article', { name: '个人.zip' })).toBeNull();
    await user.click(within(first).getByRole('button', { name: '查询保存结果' }));
    await within(first).findByText(/暂未找到原保存记录/);
    act(() => {
      installed.push({ ...skillReceipt, target_path: 'D:\\合成\\首份.zip' });
      forgetSkillExport(id, skillScope, id);
      window.dispatchEvent(new StorageEvent('storage', { key: firstKey, storageArea: localStorage }));
    });
    await screen.findByText('已保存：首份.zip');
    const second = screen.getByRole('article', { name: '另一份.zip' });
    await user.click(within(second).getByRole('button', { name: '重试保存' }));
    await screen.findByText('已保存：另一份.zip');
    expect(commands).toEqual([{ path: `/v3/capabilities/skill-exports/${id}` }, { path: '/v3/capabilities/skill-exports', body: another }]);
    expect(localStorage.getItem(Object.keys(localStorage).find(key => key.endsWith(secondId)) ?? '')).toBeNull();
    act(() => {
      rememberSkillExport(id, { label: '切回读回.zip', command: {
        ...original, meta: { ...original.meta, command_id: '00000000-0000-4000-8000-000000000043' },
      } });
      window.dispatchEvent(new Event('focus'));
    });
    await screen.findByRole('article', { name: '切回读回.zip' });
    await user.click(screen.getByRole('button', { name: '返回 Skill 列表' }));
    rememberSkillExport(id, { label: '稍后读回.zip', command: {
      ...original, meta: { ...original.meta, command_id: '00000000-0000-4000-8000-000000000044' },
    } });
    await user.click(screen.getByRole('button', { name: '保存记录与恢复' }));
    await screen.findByRole('article', { name: '稍后读回.zip' });
  } finally { localStorage.clear(); }
});
