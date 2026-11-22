import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('同名 MCP 卡以目标区分，工具未知与零分别展示，详情和编辑仍使用原配置', async () => {
    const remoteId = '00000000-0000-4000-8000-000000000014';
    const address = 'https://notes.example.invalid/team/mcp?access_token=synthetic-private-url';
    const local = { ...mcpView, config: { ...mcpConfig, args: ['synthetic-private-argv', ''] } };
    const remote: McpServerView = { ...mcpView, state: 'connected',
      config: { ...mcpConfig, id: remoteId, transport: 'http', command: null, args: [], url: address },
      catalog: { ...discovered.catalog!, server_id: remoteId, tools: [] } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(mcpPage([local, remote]))));
    render(<McpPanel client={new McpClient(mcpConnection)} />);
    const list = within(screen.getByRole('complementary', { name: 'MCP 配置列表' }));
    const localCard = await list.findByRole('button', { name: /Local Notes.*已保存.*server\.exe.*工具数量未知/ });
    const remoteCard = list.getByRole('button', { name: /Local Notes.*已连接.*notes\.example\.invalid\/team\/mcp.*0 个工具/ });
    expect(localCard).toHaveProperty('textContent', expect.not.stringContaining('synthetic-private-argv'));
    expect(remoteCard.outerHTML).not.toContain('synthetic-private-url');
    expect(within(screen.getByRole('region', { name: 'MCP 配置详情' })).getByText('synthetic-private-argv')).toBeTruthy();
    fireEvent.click(remoteCard);
    expect(remoteCard.getAttribute('aria-pressed')).toBe('true');
    expect(localCard.getAttribute('aria-pressed')).toBe('false');
    const detail = within(screen.getByRole('region', { name: 'MCP 配置详情' }));
    expect(detail.getByText(address)).toBeTruthy();
    fireEvent.click(detail.getByRole('button', { name: '编辑配置' }));
    expect(screen.getByLabelText('URL')).toHaveProperty('value', address);
    fireEvent.click(screen.getByRole('button', { name: '取消配置' }));
    expect(list.getByRole('button', { name: /notes\.example\.invalid/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('零工具时区分跟随发现和固定为空，未确认后只重放原命令', async () => {
    const empty = { ...discovered, catalog: { ...discovered.catalog!, tools: [] } };
    const writes: unknown[] = [];
    let selection: McpServerView['selection'] = null;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (!init?.method) return Response.json(mcpPage([empty]));
      if (String(url).endsWith('/discover')) {
        return Response.json({ ...discovered, selection, catalog: { ...discovered.catalog!, content_hash: 'b'.repeat(64) } });
      }
      const command = JSON.parse(init.body);
      writes.push(command);
      if (writes.length === 1) throw new TypeError('synthetic disconnected');
      selection = { server_id: mcpConfig.id, version: 1, ...command.data };
      return Response.json(selection);
    }));
    render(<McpPanel client={new McpClient(mcpConnection)} />);
    const tools = within(await screen.findByRole('region', { name: 'MCP 允许工具' }));
    await tools.findByText(/当前未发现工具.*后续发现的受支持工具会自动启用/);
    expect(tools.queryByRole('group', { name: '选择允许的工具' })).toBeNull();
    expect(writes).toEqual([]);
    fireEvent.click(tools.getByRole('button', { name: '固定为空名单' }));
    fireEvent.click(await tools.findByRole('button', { name: '按原命令核对工具选择' }));
    await tools.findByText(/已固定为空名单.*后续发现的工具也不会自动启用/);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ data: { selected_names: [] } });
    expect(writes[1]).toEqual(writes[0]);
    expect(tools.queryByRole('button', { name: '固定为空名单' })).toBeNull();
    await waitFor(() => expect(screen.getByLabelText('搜索 MCP')).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: '连接并发现工具' }));
    expect((await tools.findByRole('checkbox', { name: '允许工具 echo' })).getAttribute('aria-checked')).toBe('false');
    expect(tools.getByText(/后续发现的工具也不会自动启用/)).toBeTruthy();
  });

  it('同名 stdio 共用解释器时区分卡片，选中后只操作对应的配置', async () => {
    const otherId = '00000000-0000-4000-8000-000000000017';
    const first = { ...mcpView, config: { ...mcpConfig, args: ['--vault', '合成参数 A'] } };
    const second = { ...first, config: { ...first.config, id: otherId, args: ['--vault', '合成参数 B', ''] } };
    const writes: { path: string; body: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const path = new URL(url).pathname;
      if (!init?.method) return Response.json(mcpPage([first, second]));
      const body = JSON.parse(init.body);
      writes.push({ path, body });
      if (path.endsWith('/discover')) return Response.json({
        ...second, state: 'connected', catalog: { ...discovered.catalog!, server_id: otherId },
      });
      return Response.json({ server_id: otherId, version: 1, ...body.data });
    }));
    render(<McpPanel client={new McpClient(mcpConnection)} />);
    const list = within(screen.getByRole('complementary', { name: 'MCP 配置列表' }));
    const a = await list.findByRole('button', { name: /Local Notes.*同名配置 1/ });
    const b = list.getByRole('button', { name: /Local Notes.*同名配置 2/ });
    expect(a.outerHTML + b.outerHTML).not.toMatch(/--vault|合成参数|00000000-0000/);
    fireEvent.click(b);
    const detail = within(screen.getByRole('region', { name: 'MCP 配置详情' }));
    expect(detail.getByText('合成参数 B')).toBeTruthy();
    expect(detail.getByText('""')).toBeTruthy();
    expect(detail.queryByText('合成参数 A')).toBeNull();
    expect(writes).toEqual([]);
    fireEvent.click(detail.getByRole('button', { name: '连接并发现工具' }));
    await detail.findByRole('checkbox', { name: '允许工具 echo' });
    fireEvent.click(detail.getByRole('button', { name: '保存允许的工具' }));
    await detail.findByText('当前固定选择：echo');
    expect(writes.map(item => item.path)).toEqual([`/v3/capabilities/mcp/${otherId}/discover`, `/v3/capabilities/mcp/${otherId}/tools`]);
    expect(writes[1].body.data).toMatchObject({ scope: mcpConfig.scope, selected_names: ['echo'] });
  });

  it('默认启用受支持的工具，用户可固定名单再明确关闭全部', async () => {
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
    expect(echo.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: '允许工具 unsafe-schema' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '保存允许的工具' }));
    await screen.findByText('当前固定选择：echo');
    expect(writes[0].path).toMatch(/\/tools$/);
    expect(writes[0].body.meta.expected_version).toBeNull();
    expect(writes[0].body.data).toEqual({ scope: mcpConfig.scope, config_revision: 1,
      catalog_hash: 'a'.repeat(64), selected_names: ['echo'] });
    fireEvent.click(screen.getByRole('checkbox', { name: '允许工具 echo' }));
    fireEvent.click(screen.getByRole('button', { name: '固定为空名单' }));
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
      scope: mcpConfig.scope, config_revision: 1, catalog_hash: 'a'.repeat(64), selected_names: ['echo'] } };
    await act(async () => panel.rerender(<McpPanel client={client} refreshKey={1} />));
    expect(screen.getByRole('checkbox', { name: '允许工具 echo' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '固定为空名单' }));
    await screen.findByText(/工具选择已改变，请放弃草稿后重新读取/);
    expect(screen.getByRole('checkbox', { name: '允许工具 echo' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '放弃工具选择修改' }));
    await screen.findByText('当前固定选择：echo');
    expect(screen.getByRole('checkbox', { name: '允许工具 echo' }).getAttribute('aria-checked')).toBe('true');
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
    fireEvent.click(screen.getByRole('button', { name: '固定为空名单' }));
    await screen.findByRole('button', { name: '按原命令核对工具选择' });
    expect(screen.getByRole('button', { name: '连接并发现工具' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('MCP 范围')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '按原命令核对工具选择' }));
    await screen.findByText('当前固定选择：无');
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
    expect(screen.getByRole('checkbox', { name: '允许工具 echo' }).getAttribute('aria-checked')).toBe('true');
    expect(requests.filter(url => url.endsWith('/discover'))).toHaveLength(1);
  });

  it('连接失败留在当前配置并可读取安全状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => !init?.method
      ? Response.json(mcpPage([mcpView]))
      : Response.json({ ...mcpView, state: 'failed', error_code: 'mcp_connection_failed' })));
    render(<McpPanel client={new McpClient(mcpConnection)} initialServerId={mcpConfig.id} />);
    await screen.findByRole('button', { name: '连接并发现工具' });
    fireEvent.click(screen.getByRole('button', { name: '连接并发现工具' }));
    await screen.findByText(/此服务暂时无法连接/);
    expect(screen.queryByText('mcp_connection_failed')).toBeNull();
    expect(screen.queryByText(mcpConfig.id)).toBeNull();
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
