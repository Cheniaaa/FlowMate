import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import Settings from './Settings';
import { connection, model, page } from '../../test/fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'public-token', protocol_version: 3 });

describe('main 内设置凭据边界', () => {
  it('同一连接的两个模型共用一次凭据保存，模型命令不含地址或 Key', async () => {
    const connectionBodies: any[] = [];
    const modelBodies: any[] = [];
    let savedConnection = connection;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') {
        const body = JSON.parse(init.body as string);
        if (url.includes('/model-connections')) {
          connectionBodies.push(body); savedConnection = { ...body.data, version: 2 }; return Response.json(savedConnection);
        }
        modelBodies.push(body); return Response.json({ openai_max_tokens_field: null, ...body.data });
      }
      return Response.json(url.includes('/model-connections') ? page([savedConnection]) : page([]));
    });
    vi.mocked(invoke).mockResolvedValue({ configured: true });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'synthetic-shared-key');
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await screen.findByText('连接已保存；仅对新运行生效');
    await user.click(screen.getByRole('button', { name: '模型设置' }));
    for (const modelId of ['first-model', 'second-model']) {
      await user.click(await screen.findByRole('button', { name: '新建模型' }));
      await user.selectOptions(screen.getByLabelText('所属连接'), connection.id);
      await user.type(screen.getByLabelText('Model ID'), modelId);
      await user.click(screen.getByRole('button', { name: '保存模型' }));
      await screen.findByText('模型配置已保存；仅对新运行生效');
    }
    expect(connectionBodies).toHaveLength(1);
    expect(modelBodies.map(body => body.data.connection_id)).toEqual([connection.id, connection.id]);
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === 'save_credential')).toHaveLength(1);
    expect(JSON.stringify([...connectionBodies, ...modelBodies])).not.toContain('synthetic-shared-key');
    for (const body of modelBodies) {
      expect(body.data).not.toHaveProperty('endpoint'); expect(body.data).not.toHaveProperty('secret_ref');
      expect(body.data).not.toHaveProperty('protocol');
    }
  });

  it.each([false, true])('只向 Rust 交密钥且 finally 清空（保存失败=%s）；endpoint 变更不复用 secret_ref', async failure => {
    const savedBodies: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') {
        const body = JSON.parse(init.body as string); savedBodies.push(body);
        return new Response(JSON.stringify({ ...body.data, version: 2 }));
      }
      return Response.json(url.includes('/model-connections') ? page([{ ...connection, secret_ref: connection.id }]) : page([model]));
    });
    vi.mocked(invoke).mockImplementation(async (command, _args) => {
      if (command === 'save_credential' && failure) throw new Error('public-test-key-not-a-secret');
      return { configured: command === 'save_credential' };
    });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    const endpoint = screen.getByLabelText('Endpoint');
    await user.clear(endpoint); await user.type(endpoint, 'https://new.example.invalid/v1');
    await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'public-test-key-not-a-secret');
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await waitFor(() => expect(savedBodies).toHaveLength(1));
    await waitFor(() => expect((screen.getByLabelText('API Key（仅保存到系统凭据）') as HTMLInputElement).value).toBe(''));
    const body = savedBodies[0];
    expect(body.meta.expected_version).toBe(1);
    expect(body.data.version).toBe(1);
    expect(body.data.secret_ref).not.toBe(connection.id);
    expect(JSON.stringify(body)).not.toContain('public-test-key-not-a-secret');
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('save_credential', { binding: { kind: 'model', connection_id: connection.id, connection_version: 2, protocol: connection.protocol, endpoint: 'https://new.example.invalid/v1', secret_ref: body.data.secret_ref }, value: 'public-test-key-not-a-secret' });
    expect(screen.queryByText('public-test-key-not-a-secret')).toBeNull();
  });
  it('HTTP 配置保存失败仍清空 Key，且不写系统凭据', async () => {
    const latest = { ...connection, version: 2, display_name: '最新连接名称', endpoint: 'https://moved.example.test/v1',
      secret_ref: '00000000-0000-4000-8000-000000000099' };
    const writes: { meta: { expected_version: number }; data: typeof connection }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const { pathname } = new URL(url);
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body)); writes.push(body);
        if (body.meta.expected_version !== latest.version) {
          return Response.json({ error: { code: 'version_conflict', safe_message: '配置已改变', retryable: false, related_ids: [] } }, { status: 409 });
        }
        return Response.json({ ...body.data, version: 3 });
      }
      if (pathname.endsWith(`/model-connections/${connection.id}`)) return Response.json(latest);
      if (pathname.endsWith('/model-connections')) return Response.json(page([connection]));
      return Response.json(page([model]));
    });
    vi.mocked(invoke).mockResolvedValue({ configured: false });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    const name = screen.getByLabelText('连接名称');
    await user.clear(name);
    await user.type(name, '待保存的连接名称');
    await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'public-test-key-not-a-secret');
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await user.click(await screen.findByRole('button', { name: '读取最新连接配置' }));
    const conflict = await screen.findByRole('group', { name: '连接名称' });
    expect(within(conflict).getByText('最新连接名称')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '最新连接名称' })).toBeTruthy();
    expect(screen.getByText(/https:\/\/moved\.example\.test\/v1/, { selector: '.text-muted-foreground' })).toBeTruthy();
    expect(await screen.findByText('凭据状态：未配置')).toBeTruthy();
    expect((screen.getByLabelText('API Key（仅保存到系统凭据）') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('textbox', { name: '连接名称' })).toHaveProperty('value', '待保存的连接名称');
    expect(writes).toHaveLength(1);
    await user.click(within(conflict).getByRole('radio', { name: '使用我的值' }));
    await user.click(screen.getByRole('button', { name: '保存合并后的连接' }));
    await screen.findByText('连接已保存；仅对新运行生效');
    expect(writes[1]).toMatchObject({ meta: { expected_version: 2 }, data: {
      id: connection.id, version: 2, display_name: '待保存的连接名称', endpoint: latest.endpoint, secret_ref: latest.secret_ref,
    } });
    expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'save_credential')).toBe(false);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('credential_status', { secret_ref: latest.secret_ref });
  });

  it('合并连接遭业务拒绝后可在最新版本上修正地址，原 Key 不会跟随草稿', async () => {
    const latest = { ...connection, version: 2, display_name: '另一窗口名称', protocol: 'anthropic',
      secret_ref: '00000000-0000-4000-8000-000000000099' };
    const writes: { meta: { expected_version: number }; data: typeof connection }[] = [];
    const rejection = (code: string, safe_message: string) =>
      Response.json({ error: { code, safe_message, retryable: false, related_ids: [] } }, { status: 409 });
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const { pathname } = new URL(url);
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body)); writes.push(body);
        if (body.meta.expected_version !== 2) return rejection('version_conflict', '配置已改变');
        if (writes.length === 2) return rejection('model_endpoint_invalid', '请修正合并后的地址');
        return Response.json({ ...body.data, version: 3 });
      }
      if (pathname.endsWith(`/model-connections/${connection.id}`)) return Response.json(latest);
      if (pathname.endsWith('/model-connections')) return Response.json(page([connection]));
      return Response.json([]);
    });
    vi.mocked(invoke).mockResolvedValue({ configured: true });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
    await user.clear(await screen.findByLabelText('Endpoint'));
    await user.type(screen.getByLabelText('Endpoint'), 'https://new.example.invalid/v1/chat/completions');
    await user.type(screen.getByLabelText(/API Key/), 'synthetic-original-address-only');
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await user.click(await screen.findByRole('button', { name: '读取最新连接配置' }));
    await user.click(await screen.findByRole('button', { name: '保存合并后的连接' }));
    await screen.findByText('请修正合并后的地址');
    expect(screen.getByLabelText('Endpoint').matches(':disabled')).toBe(false);
    expect(screen.getByLabelText('连接名称')).toHaveProperty('value', latest.display_name);
    expect(screen.getByLabelText('协议')).toHaveProperty('value', 'anthropic');
    expect(screen.getByLabelText(/API Key/)).toHaveProperty('value', '');
    await user.clear(screen.getByLabelText('Endpoint'));
    await user.type(screen.getByLabelText('Endpoint'), 'https://new.example.invalid/v1/messages');
    await user.click(screen.getByRole('button', { name: '保存合并后的连接' }));
    await screen.findByText('连接已保存；仅对新运行生效');
    expect(writes[2]).toMatchObject({ meta: { expected_version: 2 }, data: {
      id: connection.id, version: 2, display_name: latest.display_name,
      protocol: 'anthropic', endpoint: 'https://new.example.invalid/v1/messages',
    } });
    expect(writes[2].data.secret_ref).not.toBe(latest.secret_ref);
    expect(JSON.stringify(writes)).not.toContain('synthetic-original-address-only');
    expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'save_credential')).toBe(false);
  });
});
