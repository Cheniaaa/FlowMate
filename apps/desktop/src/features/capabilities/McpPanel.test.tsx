import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from '../../api/mcp';
import type { McpServerView } from '../../generated/contracts';
import { mcpConfig, mcpConnection, mcpPage, mcpView } from '../../test/mcp-fixtures';
import McpPanel from './McpPanel';

afterEach(() => vi.unstubAllGlobals());

const discovered: McpServerView = {
  ...mcpView, state: 'connected' as const, selection: null, catalog: {
    server_id: mcpConfig.id, config_revision: 1, content_hash: 'a'.repeat(64), tools: [
      { name: 'echo', description: '合成文本', input_schema: { type: 'object' }, output_schema: null,
        annotations: null, unavailable_reason: null },
      { name: 'unsafe-schema', description: '不支持', input_schema: { type: 'object' }, output_schema: null,
        annotations: null, unavailable_reason: 'mcp_schema_unsupported' },
    ],
  },
};

describe('McpPanel', () => {
  it('用户显式选择发现工具，保存后显示固定选择；空选择明确保存且不再发现', async () => {
    const writes: { path: string; body: any }[] = [];
    let current = discovered;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (!init?.method) return Response.json(mcpPage([current]));
      const body = JSON.parse(init.body); writes.push({ path: String(url), body });
      current = { ...current, selection: { server_id: mcpConfig.id, version: writes.length,
        ...body.data } };
      return Response.json(current.selection);
    }));
    render(<McpPanel client={new McpClient(mcpConnection)} />);
    const echo = await screen.findByRole('checkbox', { name: '允许工具 echo' });
    expect(echo).toHaveProperty('checked', false);
    expect(screen.getByRole('checkbox', { name: '允许工具 unsafe-schema' })).toHaveProperty('disabled', true);
    fireEvent.click(echo);
    fireEvent.click(screen.getByRole('button', { name: '保存允许的工具' }));
    await screen.findByText('当前固定选择：echo');
    expect(writes[0].path).toMatch(/\/tools$/);
    expect(writes[0].body.meta.expected_version).toBeNull();
    expect(writes[0].body.data).toEqual({ scope: mcpConfig.scope, config_revision: 1,
      catalog_hash: 'a'.repeat(64), selected_names: ['echo'] });
    fireEvent.click(screen.getByRole('checkbox', { name: '允许工具 echo' }));
    fireEvent.click(screen.getByRole('button', { name: '保存允许的工具' }));
    await screen.findByText('当前固定选择：无');
    expect(writes[1].body.meta.expected_version).toBe(1);
    expect(writes[1].body.data.selected_names).toEqual([]);
    expect(writes.every(item => item.path.endsWith('/tools'))).toBe(true);
  });

  it('另窗通知不覆盖未保存选择；冲突后保留草稿并显式重新读取', async () => {
    let current = discovered;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (!init?.method) return Response.json(mcpPage([current]));
      return Response.json({ error: { code: 'version_conflict', safe_message: '选择已改变',
        retryable: false, related_ids: [] } }, { status: 409 });
    }));
    const client = new McpClient(mcpConnection);
    const panel = render(<McpPanel client={client} refreshKey={0} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: '允许工具 echo' }));
    current = { ...discovered, selection: { server_id: mcpConfig.id, version: 1,
      scope: mcpConfig.scope, config_revision: 1, catalog_hash: 'a'.repeat(64), selected_names: [] } };
    await act(async () => panel.rerender(<McpPanel client={client} refreshKey={1} />));
    expect(screen.getByRole('checkbox', { name: '允许工具 echo' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('button', { name: '保存允许的工具' }));
    await screen.findByText(/工具选择已改变，请放弃草稿后重新读取/);
    expect(screen.getByRole('checkbox', { name: '允许工具 echo' })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('button', { name: '放弃工具选择修改' }));
    await screen.findByText('当前固定选择：无');
    expect(screen.getByRole('checkbox', { name: '允许工具 echo' })).toHaveProperty('checked', false);
  });

  it('响应丢失后只核对同一选择命令，期间不能重新发现或切配置', async () => {
    const writes: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (!init?.method) return Response.json(mcpPage([discovered]));
      const body = JSON.parse(init.body); writes.push(body);
      if (writes.length === 1) throw new TypeError('synthetic disconnected');
      return Response.json({ server_id: mcpConfig.id, version: 1, ...body.data });
    }));
    render(<McpPanel client={new McpClient(mcpConnection)} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: '允许工具 echo' }));
    fireEvent.click(screen.getByRole('button', { name: '保存允许的工具' }));
    await screen.findByRole('button', { name: '按原命令核对工具选择' });
    expect(screen.getByRole('button', { name: '连接并发现工具' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('MCP 范围')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '按原命令核对工具选择' }));
    await screen.findByText('当前固定选择：echo');
    expect(writes[1]).toEqual(writes[0]);
  });
  it('卡片显示已保存，只有明确点击才连接发现', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      requests.push(String(url));
      if (!init?.method) return Response.json(mcpPage([mcpView]));
      expect(JSON.parse(init.body).expected_version).toBe(1);
      return Response.json({ ...mcpView, state: 'connected', catalog: {
        server_id: mcpConfig.id, config_revision: 1, content_hash: 'a'.repeat(64), tools: [{
          name: 'echo', description: '合成文本', input_schema: { type: 'object' },
          output_schema: { type: 'string' }, annotations: { readOnlyHint: true }, unavailable_reason: null,
        }],
      } });
    }));
    render(<McpPanel client={new McpClient(mcpConnection)} />);
    await screen.findByRole('button', { name: /Local Notes/ });
    expect(screen.getAllByText(/已保存/).length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '连接并发现工具' }));
    await screen.findByRole('checkbox', { name: '允许工具 echo' });
    expect(screen.getByText(/注解仅供参考/)).toBeTruthy();
    expect(requests.filter(url => url.endsWith('/discover'))).toHaveLength(1);
  });

  it('连接失败留在当前配置并可读取安全状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => !init?.method
      ? Response.json(mcpPage([mcpView]))
      : Response.json({ ...mcpView, state: 'failed', error_code: 'mcp_connection_failed' })));
    render(<McpPanel client={new McpClient(mcpConnection)} initialServerId={mcpConfig.id} />);
    await screen.findByRole('button', { name: '连接并发现工具' });
    fireEvent.click(screen.getByRole('button', { name: '连接并发现工具' }));
    await screen.findByText('mcp_connection_failed');
    expect(screen.getAllByText(/连接失败/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Local Notes/ })).toBeTruthy();
  });

  it('个人与项目范围通过查询分开，编辑器切换前保留明确取消', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async url => { requests.push(String(url)); return Response.json(mcpPage([])); }));
    render(<McpPanel client={new McpClient(mcpConnection)} workspaceId="00000000-0000-4000-8000-000000000001" />);
    await screen.findByText('没有匹配的 MCP 配置。');
    fireEvent.change(screen.getByLabelText('MCP 范围'), { target: { value: 'workspace' } });
    await waitFor(() => expect(requests.at(-1)).toContain('scope_kind=workspace'));
    fireEvent.click(screen.getByRole('button', { name: '添加 MCP' }));
    expect(screen.getByLabelText('MCP 范围')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '取消配置' }));
    expect(screen.getByLabelText('MCP 范围')).toHaveProperty('disabled', false);
  });

  it('指定服务器不在第一页时仍读取该配置，不静默改选其它服务器', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async url => {
      requests.push(String(url));
      return Response.json(String(url).endsWith(`/mcp/${mcpConfig.id}`) ? mcpView : mcpPage([]));
    }));
    render(<McpPanel client={new McpClient(mcpConnection)} initialServerId={mcpConfig.id} />);
    await screen.findByRole('button', { name: /Local Notes/ });
    expect(requests.some(path => path.endsWith(`/mcp/${mcpConfig.id}`))).toBe(true);
  });
});
