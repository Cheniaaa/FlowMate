import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { createRuntimeStore } from '../../state/runtime-store';
import { connection, id, model, page } from '../../test/fixtures';
import { memoryGrant, memoryPolicy } from '../../test/memory-fixtures';
import { remoteSnapshot } from '../../test/mcp-tool-fixtures';
import { skillView } from '../../test/skill-fixtures';
import MemorySettings from './MemorySettings';
import Settings from './Settings';
afterEach(() => vi.unstubAllGlobals());

it('读取与自动整理策略保存不创建发送授权；目的地授权明确另发，撤销保留记忆', async () => {
  const writes: { path: string; method: string; body: any }[] = [];
  let policy = memoryPolicy, grants = [memoryGrant];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(String(init.body)) : null;
    if (init.method) writes.push({ path, method: init.method, body });
    if (init.method === 'PUT') { policy = { ...body.data, version: policy.version + 1 }; return Response.json(policy); }
    if (path.endsWith('/revoke')) { grants = [{ ...memoryGrant, status: 'revoked', version: 2, epoch: 2 }]; return Response.json({ id: memoryGrant.id, scope: memoryGrant.scope, epoch: 2, status: 'revoked' }); }
    if (path.endsWith('/memory/grants') && init.method === 'POST') return Response.json(memoryGrant);
    if (path.endsWith('/memory/grants')) return Response.json(page(grants));
    if (path.endsWith('/settings/memory')) return Response.json(policy);
    if (path.endsWith('/models')) return Response.json(page([model]));
    if (path.endsWith('/model-connections')) return Response.json(page([connection]));
    if (path.endsWith('/workspaces')) return Response.json(page([{ id, version: 1, name: '项目', directory_resource_id: null }]));
    throw new Error(path);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 }), store = createRuntimeStore(client);
  const user = userEvent.setup(); render(<MemorySettings client={client} store={store} />);
  const read = await screen.findByLabelText('启用个人画像读取');
  expect(read.getAttribute('aria-describedby')).toBeTruthy();
  expect(document.getElementById(read.getAttribute('aria-describedby')!)?.textContent).toContain('目标模型授权');
  const organize = screen.getByRole('checkbox', { name: '启用自动记忆整理' });
  expect(document.getElementById(organize.getAttribute('aria-describedby')!)?.textContent).toContain('维护任务');
  expect(screen.getByText('已授权')).toBeTruthy();
  await user.click(read); await user.click(screen.getByRole('button', { name: '保存记忆策略' }));
  await screen.findByText('记忆策略已保存');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ method: 'PUT', body: { meta: { expected_version: 1 }, data: { version: 1, read_profile: false, auto_organize: false } } });
  expect(screen.getByText('已授权')).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('授权目标模型'), model.id);
  await user.click(screen.getByRole('button', { name: '授权此范围发送到所选模型' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1].path).toBe('/v3/memory/grants');
  expect(writes[1].body.data).toEqual({ destination: connection.endpoint, scope: memoryPolicy.scope });
  await user.click(screen.getByRole('button', { name: '撤销此模型发送授权' }));
  await screen.findByText('已撤销');
  expect(writes.at(-1)?.body.expected_version).toBe(1);
  expect(writes.some(write => write.path.includes('/records'))).toBe(false);
});

it('全局策略更新不覆盖设置草稿或替聊天选择授权；关闭沿原dirty guard，CAS仍用编辑原版本', async () => {
  let policy = memoryPolicy;
  const writes: any[] = [], close = vi.fn();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'PUT') { writes.push(JSON.parse(String(init.body))); return Response.json({ error: {
      code: 'version_conflict', safe_message: '策略版本已改变', related_ids: [], retryable: false,
    } }, { status: 409 }); }
    if (path.endsWith('/settings/memory')) return Response.json(policy);
    if (path.endsWith('/models')) return Response.json(page([model]));
    if (path.endsWith('/model-connections')) return Response.json(page([connection]));
    if (path.endsWith('/memory/grants') || path.endsWith('/workspaces')) return Response.json(page([]));
    throw new Error(path);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 }), store = createRuntimeStore(client);
  const user = userEvent.setup(); render(<Settings client={client} runtimeStore={store} section="memory" onClose={close} />);
  await user.click(await screen.findByLabelText('启用自动记忆整理'));
  policy = { ...memoryPolicy, version: 2, read_profile: false };
  await act(async () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); });
  await screen.findByText(/记忆策略已在另一窗改变/);
  expect(screen.getByRole('checkbox', { name: '启用自动记忆整理', checked: true })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: '启用个人画像读取', checked: true })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '保存后继续' }));
  await screen.findByText('策略版本已改变');
  expect(close).not.toHaveBeenCalled();
  expect(writes[0]).toMatchObject({ meta: { expected_version: 1 }, data: { version: 1, read_profile: true, auto_organize: true } });
});

it.each([
  { purpose: 'tool_send' as const, label: 'MCP 工具发送', destination: remoteSnapshot.destination },
  { purpose: 'local_process_send' as const, label: '本机脚本发送',
    destination: `skill:${skillView.version.skill_id}:${skillView.version.content_hash}:environment:${remoteSnapshot.server_id}:2` },
])('记忆授权按实际$purpose显示并撤销原授权', async ({ purpose, label, destination }) => {
  const writes: { path: string; body: unknown }[] = [];
  let saved = { ...memoryGrant, purposes: [purpose], destination };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith(`/grants/${memoryGrant.id}/revoke`)) {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      saved = { ...saved, status: 'revoked', version: 2, epoch: 2 };
      return Response.json({ id: saved.id, scope: saved.scope, status: saved.status, epoch: saved.epoch });
    }
    if (path.endsWith('/memory/grants')) return Response.json(page([saved]));
    if (path.endsWith('/settings/memory')) return Response.json(memoryPolicy);
    if (path.endsWith('/models')) return Response.json(page([model]));
    if (path.endsWith('/model-connections')) return Response.json(page([connection]));
    if (path.endsWith('/workspaces')) return Response.json(page([]));
    throw new Error(path);
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  const user = userEvent.setup();
  render(<MemorySettings client={client} store={createRuntimeStore(client)} />);
  await user.click(await screen.findByRole('button', { name: `撤销此${label}授权` }));
  await screen.findByText('已撤销');
  expect(writes).toEqual([{ path: `/v3/grants/${memoryGrant.id}/revoke`, body: expect.objectContaining({ expected_version: 1 }) }]);
});
