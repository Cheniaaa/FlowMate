import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { McpClient } from '../../api/mcp';
import { mcpConfig, mcpConnection, mcpPage, mcpView } from '../../test/mcp-fixtures';
import { grant } from '../../test/fixtures';
import McpPanel from './McpPanel';
import McpQueryPermissions from './McpQueryPermissions';

afterEach(() => vi.unstubAllGlobals());

it.each([undefined, '00000000-0000-4000-8000-000000000001'])('MCP 添加默认使用所在入口范围 %s', async workspaceId => {
  const queries: URL[] = [];
  vi.stubGlobal('fetch', async (url: string) => { queries.push(new URL(url)); return Response.json(mcpPage([])); });
  render(<McpPanel client={new McpClient(mcpConnection)} workspaceId={workspaceId}
    initialScope={workspaceId ? { kind: 'workspace', workspace_id: workspaceId, session_id: null } : undefined} />);
  await screen.findByText('没有匹配的 MCP 配置。');
  expect(queries[0].searchParams.get('scope_kind')).toBe(workspaceId ? 'workspace' : 'user_global');
});

it('明确指定工具和模型地址后才创建窄公共查询许可，可撤销且不会改变允许工具', async () => {
  const catalog = { server_id: mcpConfig.id, config_revision: 1, content_hash: 'a'.repeat(64), tools: [{
    name: 'user-selected-query', description: '公开资料', input_schema: { type: 'object' },
    output_schema: null, annotations: { readOnlyHint: true }, unavailable_reason: null,
  }] };
  const view = { ...mcpView, state: 'connected', catalog, selection: { server_id: mcpConfig.id, version: 1,
    scope: mcpConfig.scope, config_revision: 1, catalog_hash: catalog.content_hash, selected_names: ['user-selected-query'] } };
  const writes: { path: string; body: any }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (!init.method) return Response.json(mcpPage([view as any]));
    const body = JSON.parse(String(init.body)); writes.push({ path, body });
    if (path.endsWith('/revoke')) return Response.json({ id: grant.id, scope: mcpConfig.scope, epoch: 2, status: 'revoked' });
    return Response.json({ ...grant, ...body.data, resource_ids: [], memory_scopes: [], mcp_versions: {} });
  });
  render(<McpPanel client={new McpClient(mcpConnection)} />);
  const trust = await screen.findByRole('button', { name: '信任此工具用于公共查询' });
  expect(trust).toHaveProperty('disabled', true);
  expect(writes).toEqual([]);
  fireEvent.change(screen.getByLabelText('公共查询工具'), { target: { value: 'user-selected-query' } });
  fireEvent.change(screen.getByLabelText('结果接收模型地址'), { target: { value: 'https://model.invalid/v1' } });
  fireEvent.click(trust);
  await screen.findByRole('button', { name: '撤销公共查询许可' });
  expect(writes[0].body.data).toMatchObject({ scope: mcpConfig.scope, purposes: ['model_send'],
    destination: 'https://model.invalid/v1', mcp_queries: [{
      original_name: 'user-selected-query', server_id: mcpConfig.id, config_revision: 1, catalog_hash: catalog.content_hash,
    }] });
  fireEvent.click(screen.getByRole('button', { name: '撤销公共查询许可' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '撤销公共查询许可' })).toBeNull());
  expect(writes.every(write => !write.path.endsWith('/tools'))).toBe(true);
});

it('查询许可被明确拒绝时解除编辑锁，可核对当前配置后修改', async () => {
  const view = { ...mcpView, state: 'connected' as const,
    catalog: { server_id: mcpConfig.id, config_revision: 1, content_hash: 'b'.repeat(64), tools: [] },
    selection: { server_id: mcpConfig.id, version: 1, scope: mcpConfig.scope,
      config_revision: 1, catalog_hash: 'b'.repeat(64), selected_names: ['explicit-query'] } };
  vi.stubGlobal('fetch', async () => Response.json({ error: { code: 'blocked_incompatible',
    safe_message: '目录已改变', retryable: false, related_ids: [] } }, { status: 409 }));
  const active = vi.fn();
  render(<McpQueryPermissions client={new McpClient(mcpConnection)} view={view}
    disabled={false} onActiveChange={active} />);
  fireEvent.change(screen.getByLabelText('公共查询工具'), { target: { value: 'explicit-query' } });
  fireEvent.change(screen.getByLabelText('结果接收模型地址'), { target: { value: 'https://model.invalid/v1' } });
  fireEvent.click(screen.getByRole('button', { name: '信任此工具用于公共查询' }));
  await screen.findByText(/公共查询许可未保存/);
  expect(screen.getByLabelText('结果接收模型地址')).toHaveProperty('disabled', false);
  expect(active).toHaveBeenLastCalledWith(false);
});
