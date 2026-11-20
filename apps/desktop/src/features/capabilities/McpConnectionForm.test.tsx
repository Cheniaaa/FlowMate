import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from '../../api/mcp';
import { mcpConfig, mcpConnection, mcpScope } from '../../test/mcp-fixtures';
import McpConnectionForm from './McpConnectionForm';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const PRIVATE = 'synthetic-private-mcp-token';

function server(failNative = false) {
  const requests: { path: string; body: any }[] = [];
  vi.mocked(invoke).mockImplementation(async () => {
    if (failNative) throw new Error(PRIVATE);
    return { configured: true };
  });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const path = String(url), body = JSON.parse(init.body); requests.push({ path, body });
    if (path.endsWith('/preview')) {
      const entry = Object.values(JSON.parse(body.sanitized_json).mcpServers)[0] as any;
      const slots = entry.env ? Object.entries(entry.env).map(([name, value]: [string, any]) => ({
        server_id: mcpConfig.id, slot: value.secret_slot, purpose: 'env', env_name: name,
      })) : entry.headers ? [{
        server_id: mcpConfig.id, slot: entry.headers.Authorization.secret_slot, purpose: 'http_token', env_name: null,
      }] : [];
      return Response.json({ configs: [{ ...mcpConfig, display_name: Object.keys(JSON.parse(body.sanitized_json).mcpServers)[0],
        transport: entry.url ? 'http' : 'stdio', url: entry.url ?? null, command: entry.command ?? null,
        args: entry.args ?? [] }], errors: [], required_secret_slots: slots });
    }
    if (path.endsWith('/discover')) return Response.json({ config: mcpConfig, state: 'connected',
      catalog: null, selection: null, error_code: null, query_grants: [] });
    return Response.json(body.data.config);
  }));
  return requests;
}

describe('McpConnectionForm', () => {
  it('确认保存保留原型同名环境键的独立凭据引用', async () => {
    const requests = server();
    render(<McpConnectionForm client={new McpClient(mcpConnection)} scope={mcpScope}
      onSaved={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '导入 JSON' }));
    fireEvent.change(screen.getByLabelText('mcpServers JSON'), { target: { value: JSON.stringify({
      mcpServers: { 'Local Notes': { command: mcpConfig.command, args: [],
        env: JSON.parse('{"__proto__":"synthetic-only"}') } },
    }) } });
    fireEvent.click(screen.getByRole('button', { name: '预览配置' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认保存配置' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    const refs = requests[1].body.data.config.env_refs;
    expect(Object.hasOwn(refs, '__proto__')).toBe(true);
  });
  it.each([false, true])('JSON 只在内存拆秘密，明确确认后保存且 finally 清空（凭据失败=%s）', async fail => {
    const requests = server(fail);
    const saved = vi.fn();
    render(<McpConnectionForm client={new McpClient(mcpConnection)} scope={mcpScope} onSaved={saved} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '导入 JSON' }));
    const raw = JSON.stringify({ mcpServers: { 'Local Notes': {
      command: mcpConfig.command, args: mcpConfig.args, env: { SYNTHETIC_TOKEN: PRIVATE },
    } } });
    fireEvent.change(screen.getByLabelText('mcpServers JSON'), { target: { value: raw } });
    fireEvent.click(screen.getByRole('button', { name: '预览配置' }));
    await screen.findByRole('button', { name: '确认保存配置' });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests)).not.toContain(PRIVATE);
    expect(screen.queryByDisplayValue(raw)).toBeNull();
    expect(document.body.textContent).not.toContain(PRIVATE);
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认保存配置' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_credential', expect.objectContaining({
      binding: expect.objectContaining({ kind: 'mcp', config_revision: 1, transport: 'stdio',
        env_name: 'SYNTHETIC_TOKEN', destination: { command: mcpConfig.command, args: mcpConfig.args, cwd: null, url: null } }),
      value: PRIVATE,
    })));
    expect(requests[1].body.data.config.args).toEqual(['server file.py', '中文 参数', '']);
    expect(requests[1].body.data.confirmed).toBe(true);
    expect(JSON.stringify(requests)).not.toContain(PRIVATE);
    expect(requests.every(request => !request.path.endsWith('/discover'))).toBe(true);
    expect(document.body.textContent).not.toContain(PRIVATE);
    if (fail) await screen.findByText(/凭据未完成/);
    else await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  });

  it('表单先预览，真实 command 与参数数组不按空格切分', async () => {
    const requests = server();
    render(<McpConnectionForm client={new McpClient(mcpConnection)} scope={mcpScope} onSaved={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Local Notes' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: mcpConfig.command } });
    fireEvent.change(screen.getByLabelText('Args（JSON 字符串数组）'), { target: { value: JSON.stringify(mcpConfig.args) } });
    fireEvent.click(screen.getByRole('button', { name: '预览配置' }));
    await screen.findByRole('button', { name: '连接并启用' });
    const entry = JSON.parse(requests[0].body.sanitized_json).mcpServers['Local Notes'];
    expect(entry.command).toBe(mcpConfig.command);
    expect(entry.args).toEqual(mcpConfig.args);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('未知格式在本机拒绝，错误不回显原始 JSON 或秘密', async () => {
    const requests = server();
    render(<McpConnectionForm client={new McpClient(mcpConnection)} scope={mcpScope} onSaved={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '导入 JSON' }));
    fireEvent.change(screen.getByLabelText('mcpServers JSON'), {
      target: { value: JSON.stringify({ servers: { PRIVATE } }) },
    });
    fireEvent.click(screen.getByRole('button', { name: '预览配置' }));
    await screen.findByRole('alert');
    expect(requests).toEqual([]);
    expect(document.body.textContent).not.toContain(PRIVATE);
    expect(screen.getByLabelText('mcpServers JSON')).toHaveProperty('value', '');
  });

  it('生成配置也等待预览和用户确认', async () => {
    const requests = server();
    render(<McpConnectionForm client={new McpClient(mcpConnection)} scope={mcpScope}
      generatedJson={JSON.stringify({ mcpServers: { 'Local Notes': { command: mcpConfig.command } } })}
      onSaved={() => {}} onCancel={() => {}} />);
    expect(requests).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '预览配置' }));
    await screen.findByRole('button', { name: '确认保存配置' });
    expect(requests).toHaveLength(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('编辑有认证的 HTTP 配置保留待填写位置，不静默清除认证绑定', async () => {
    const requests = server();
    const original = { ...mcpConfig, transport: 'http' as const, command: null, args: [],
      url: 'http://127.0.0.1:19013/mcp', credential_ref: crypto.randomUUID() };
    render(<McpConnectionForm client={new McpClient(mcpConnection)} scope={mcpScope} initial={original}
      onSaved={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '预览配置' }));
    await screen.findByRole('button', { name: '连接并启用' });
    expect(screen.getByLabelText('API token（待填写可留空）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '连接并启用' }));
    await screen.findByText(/补填凭据/);
    expect(requests[1].body.data.config.credential_ref).toBeTruthy();
    expect(requests[1].body.data.config.credential_ref).not.toBe(original.credential_ref);
    expect(requests[1].body.data.config.revision).toBe(2);
    expect(requests[1].body.meta.expected_version).toBe(1);
  });
});
