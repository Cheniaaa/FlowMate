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

it('已启用工具无需填写接收模型地址，历史查询许可可单独撤销', async () => {
  const catalog = { server_id: mcpConfig.id, config_revision: 1, content_hash: 'a'.repeat(64), tools: [{
    name: 'user-selected-query', description: '公开资料', input_schema: { type: 'object' },
    output_schema: null, annotations: { readOnlyHint: true }, unavailable_reason: null,
  }] };
  const view = { ...mcpView, config: { ...mcpConfig, enabled: false }, state: 'stopped',
    catalog: null, selection: { server_id: mcpConfig.id, version: 1,
     scope: mcpConfig.scope, config_revision: 1, catalog_hash: catalog.content_hash, selected_names: ['user-selected-query'] },
    query_grants: [{ ...grant, status: 'active', destination: 'https://model.invalid/v1',
      mcp_queries: [{ server_id: mcpConfig.id, config_revision: 1, catalog_hash: catalog.content_hash,
        original_name: 'user-selected-query', destination: 'synthetic-mcp' }] }] };
  const writes: { path: string; body: any }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (!init.method) return Response.json(mcpPage([view as any]));
    const body = JSON.parse(String(init.body)); writes.push({ path, body });
    if (path.endsWith('/revoke')) return Response.json({ id: grant.id, scope: mcpConfig.scope, epoch: 2, status: 'revoked' });
    return Response.json({ ...grant, ...body.data, resource_ids: [], memory_scopes: [], mcp_versions: {} });
  });
  render(<McpPanel client={new McpClient(mcpConnection)} />);
  const revoke = await screen.findByRole('button', { name: '撤销公共查询许可' });
  expect(screen.queryByLabelText('结果接收模型地址')).toBeNull();
  expect(writes).toEqual([]);
  fireEvent.click(revoke);
  await waitFor(() => expect(screen.queryByRole('button', { name: '撤销公共查询许可' })).toBeNull());
  expect(writes.map(write => write.path)).toEqual([`/v3/grants/${grant.id}/revoke`]);
});

it('撤销未成功时保留可重试的原许可', async () => {
  const view = { ...mcpView, state: 'connected' as const,
    catalog: { server_id: mcpConfig.id, config_revision: 1, content_hash: 'b'.repeat(64), tools: [] },
    selection: { server_id: mcpConfig.id, version: 1, scope: mcpConfig.scope,
      config_revision: 1, catalog_hash: 'b'.repeat(64), selected_names: ['explicit-query'] },
    query_grants: [{ ...grant, mcp_queries: [] }] };
  vi.stubGlobal('fetch', async () => Response.json({ error: { code: 'blocked_incompatible',
    safe_message: '目录已改变', retryable: false, related_ids: [] } }, { status: 409 }));
  const active = vi.fn();
  render(<McpQueryPermissions client={new McpClient(mcpConnection)} view={view}
    disabled={false} onActiveChange={active} />);
  fireEvent.click(screen.getByRole('button', { name: '撤销公共查询许可' }));
  await screen.findByText(/撤销未确认/);
  expect(screen.getByRole('button', { name: '撤销公共查询许可' })).toHaveProperty('disabled', false);
  expect(active).toHaveBeenLastCalledWith(false);
});
