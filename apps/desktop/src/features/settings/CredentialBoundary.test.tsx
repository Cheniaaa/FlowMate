import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import Settings from './Settings';
import { connection, model, page } from '../../test/fixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'public-token', protocol_version: 2 });

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
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('save_credential', { binding: { connection_id: connection.id, connection_version: 2, protocol: connection.protocol, endpoint: 'https://new.example.invalid/v1', secret_ref: body.data.secret_ref }, value: 'public-test-key-not-a-secret' });
    expect(screen.queryByText('public-test-key-not-a-secret')).toBeNull();
  });
  it('HTTP 配置保存失败仍清空 Key，且不写系统凭据', async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => init.method === 'PUT'
      ? new Response(JSON.stringify({ error: { code: 'version_conflict', safe_message: '配置已改变', retryable: false, related_ids: [] } }), { status: 409 })
      : Response.json(url.includes('/model-connections') ? page([connection]) : page([model])));
    vi.mocked(invoke).mockResolvedValue({ configured: false });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'public-test-key-not-a-secret');
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await screen.findByText('version_conflict: 配置已改变');
    expect((screen.getByLabelText('API Key（仅保存到系统凭据）') as HTMLInputElement).value).toBe('');
    expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'save_credential')).toBe(false);
  });
});
