import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import { validate } from '../../api/validation';
import type { ModelProfile, SaveConnectionCommand, SaveModelCommand } from '../../generated/contracts';
import { agent, connection, model, page } from '../../test/fixtures';
import Settings from './Settings';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'public-token', protocol_version: 2 });
async function openConnections() {
  render(<Settings client={client} />);
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
}

describe('连接设置编辑生命周期', () => {
  it('后续连接页的模型改名保存及重开保留 max_tokens 覆盖', async () => {
    const other = { ...connection, id: '00000000-0000-4000-8000-000000000004', display_name: '后续页连接' };
    let saved: ModelProfile = { ...model, connection_id: other.id, openai_max_tokens_field: 'max_tokens' };
    const bodies: SaveModelCommand[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/model-connections')) return Response.json(parsed.searchParams.has('cursor')
        ? page([other]) : { ...page([connection]), next_cursor: 'next-connections' });
      if (parsed.pathname.endsWith('/provider-presets')) return Response.json([]);
      if (init.method === 'PUT') {
        const body: SaveModelCommand = JSON.parse(init.body as string); bodies.push(body);
        saved = validate('ModelProfile', { ...model, ...body.data,
          openai_max_tokens_field: body.data.openai_max_tokens_field ?? null, version: saved.version + 1 });
        return Response.json(saved);
      }
      if (parsed.pathname.endsWith('/resolved')) return Response.json({ ...saved, connection_version: 1,
        protocol: other.protocol, endpoint: other.endpoint, secret_ref: null, provider_preset_id: null,
        metadata_sources: {}, model_pricing: null, pricing_unknown_reason: null, blockers: [] });
      if (parsed.pathname.endsWith('/models')) return Response.json(page([saved]));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.mocked(invoke).mockResolvedValue({ configured: false });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    await user.click(await screen.findByRole('button', { name: '更多连接' }));
    await user.click(await screen.findByRole('button', { name: /后续页连接/ }));
    await user.click(screen.getByRole('button', { name: '模型设置' }));
    await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
    await user.type(screen.getByLabelText('模型显示名称'), '只改名称');
    await user.click(screen.getByRole('button', { name: '保存模型' }));
    await screen.findByText('模型配置已保存；仅对新运行生效');
    expect(bodies[0].data.openai_max_tokens_field).toBe('max_tokens');
    expect(bodies[0].data.connection_id).toBe(other.id);
    await user.click(screen.getByRole('button', { name: '连接详情' }));
    await user.click(screen.getByRole('button', { name: '模型设置' }));
    await user.click(await screen.findByRole('button', { name: /只改名称/ }));
    expect((screen.getByLabelText('输出上限参数') as HTMLSelectElement).value).toBe('max_tokens');
    expect((screen.getByLabelText('模型显示名称') as HTMLInputElement).value).toBe('只改名称');
  });

  it('未配置凭据的已有连接改目的地也生成新引用，但不会写入密钥', async () => {
    const bodies: SaveConnectionCommand[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') { const body = JSON.parse(init.body as string); bodies.push(body); return Response.json({ ...body.data, version: 2 }); }
      return Response.json(url.includes('/model-connections') ? page([connection]) : page([model]));
    });
    vi.mocked(invoke).mockResolvedValue({ configured: false });
    const user = userEvent.setup();
    await openConnections();
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    await user.selectOptions(screen.getByLabelText('协议'), 'anthropic');
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await screen.findByText('连接已保存；仅对新运行生效');
    expect(bodies[0].data.secret_ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'save_credential')).toBe(false);
  });
  it.each(['endpoint', 'protocol', 'display_name'] as const)('连接修改 %s：只有目的地或协议变更才换凭据引用', async field => {
    const original = { ...connection, secret_ref: connection.id };
    const bodies: SaveConnectionCommand[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') { const body = JSON.parse(init.body as string); bodies.push(body); return Response.json({ ...body.data, version: 2 }); }
      return Response.json(url.includes('/model-connections') ? page([original]) : page([model]));
    });
    vi.mocked(invoke).mockResolvedValue({ configured: true });
    const user = userEvent.setup();
    await openConnections();
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    if (field === 'protocol') await user.selectOptions(screen.getByLabelText('协议'), 'anthropic');
    else await user.type(screen.getByLabelText(field === 'endpoint' ? 'Endpoint' : '连接名称'), '-changed');
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await screen.findByText('连接已保存；仅对新运行生效');
    if (field === 'display_name') expect(bodies[0].data.secret_ref).toBe(original.secret_ref);
    else expect(bodies[0].data.secret_ref).not.toBe(original.secret_ref);
    expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'save_credential')).toBe(false);
  });

  it('连接已保存但 Key 失败分开报告，重新输入后只补凭据，不重复保存连接', async () => {
    const bodies: SaveConnectionCommand[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') { const body = JSON.parse(init.body as string); bodies.push(body); return Response.json({ ...body.data, version: 2 }); }
      return Response.json(url.includes('/model-connections') ? page([connection]) : page([model]));
    });
    let writes = 0;
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'save_credential' && ++writes === 1) throw new Error('must-not-render-key');
      return { configured: command === 'save_credential' };
    });
    const user = userEvent.setup();
    await openConnections();
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'synthetic-key');
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await screen.findByText('连接已保存，凭据未配置或替换失败；请重新输入 Key 后重试凭据');
    expect(screen.queryByText('must-not-render-key')).toBeNull();
    expect((screen.getByLabelText('API Key（仅保存到系统凭据）') as HTMLInputElement).value).toBe('');
    await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'retry-key');
    await user.click(screen.getByRole('button', { name: '重试保存凭据' }));
    await screen.findByText('系统凭据已保存');
    expect(bodies).toHaveLength(1);
    expect(invoke).toHaveBeenLastCalledWith('save_credential', { binding: { connection_id: connection.id, connection_version: 2,
      protocol: connection.protocol, endpoint: connection.endpoint, secret_ref: bodies[0].data.secret_ref }, value: 'retry-key' });
  });
  it('keyset 续页按 ID 更新版本，保存不使用旧版本', async () => {
    let reads = 0;
    const bodies: SaveConnectionCommand[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (!url.includes('/model-connections')) return Response.json(page([model]));
      if (init.method === 'PUT') {
        const body: SaveConnectionCommand = JSON.parse(init.body as string); bodies.push(body);
        return Response.json({ ...body.data, version: 3 });
      }
      reads++;
      return Response.json(reads === 1 ? { ...page([connection]), next_cursor: 'old' } : page([{ ...connection, version: 2 }]));
    });
    const user = userEvent.setup();
    await openConnections();
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    await user.click(screen.getByRole('button', { name: '更多连接' }));
    expect(screen.getAllByRole('option', { name: /测试连接/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].meta.expected_version).toBe(2);
  });

  it('取消编辑清空 Key 并恢复已提交配置；再次保存不发送取消的 Key', async () => {
    const bodies: SaveConnectionCommand[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') {
        const body: SaveConnectionCommand = JSON.parse(init.body as string); bodies.push(body);
        return Response.json({ ...body.data, version: 2 });
      }
      return Response.json(url.includes('/model-connections') ? page([connection]) : page([model]));
    });
    vi.mocked(invoke).mockResolvedValue({ configured: false });
    const user = userEvent.setup();
    await openConnections();
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    await user.clear(screen.getByLabelText('Endpoint'));
    await user.type(screen.getByLabelText('Endpoint'), 'https://cancelled.invalid/v1');
    await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'cancelled-key');
    await user.click(screen.getByRole('button', { name: '取消编辑' }));
    expect((screen.getByLabelText('Endpoint') as HTMLInputElement).value).toBe(connection.endpoint);
    expect((screen.getByLabelText('API Key（仅保存到系统凭据）') as HTMLInputElement).value).toBe('');
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await screen.findByText('连接已保存；仅对新运行生效');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].data.endpoint).toBe('https://example.invalid/v1');
    expect(bodies[0].data.secret_ref).toBeNull();
    expect(vi.mocked(invoke).mock.calls.some(([name]) => name === 'save_credential')).toBe(false);
  });

  it('切换设置面板卸载密钥状态；credential_status 只消费 configured 且不持久化 Key', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const bodies: SaveConnectionCommand[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') {
        const body: SaveConnectionCommand = JSON.parse(init.body as string); bodies.push(body);
        return Response.json({ ...body.data, version: 2 });
      }
      return Response.json(url.endsWith('/profiles') ? page([agent]) : url.includes('/model-connections') ? page([{ ...connection, secret_ref: connection.id }]) : page([model]));
    });
    vi.mocked(invoke).mockResolvedValue({ configured: true, value: 'must-not-render-host-value' });
    const user = userEvent.setup();
    await openConnections();
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    await screen.findByText(/凭据状态：已配置/);
    expect(screen.queryByDisplayValue('must-not-render-host-value')).toBeNull();
    await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'discard-on-tab-change');
    await user.click(screen.getByRole('button', { name: '助理设置' }));
    await user.click(screen.getByRole('button', { name: '放弃更改' }));
    expect(screen.queryByLabelText('API Key（仅保存到系统凭据）')).toBeNull();
    await user.click(screen.getByRole('button', { name: '模型与连接' }));
    await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    expect((screen.getByLabelText('API Key（仅保存到系统凭据）') as HTMLInputElement).value).toBe('');
    await user.click(screen.getByRole('button', { name: '保存连接' }));
    await screen.findByText('连接已保存；仅对新运行生效');
    expect(bodies).toHaveLength(1);
    expect(storageWrite).not.toHaveBeenCalled();
    expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).toEqual(['credential_status', 'credential_status', 'credential_status']);
  });

  it('在途保存禁用取消、切换并阻止同一事件批次重复提交', async () => {
    const bodies: SaveConnectionCommand[] = [];
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') {
        bodies.push(JSON.parse(init.body as string));
        return new Promise<Response>(resolve => { finish = resolve; });
      }
      return Response.json(url.includes('/model-connections') ? page([connection]) : page([model]));
    });
    vi.mocked(invoke).mockResolvedValue({ configured: false });
    const user = userEvent.setup();
    await openConnections();
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    const form = screen.getByRole('button', { name: '保存连接' }).closest('form')!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((screen.getByRole('button', { name: '取消编辑' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '助理设置' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('编辑连接') as HTMLSelectElement).disabled).toBe(true);
    finish(Response.json({ ...connection, version: 2 }));
    await screen.findByText('连接已保存；仅对新运行生效');
    expect((screen.getByRole('button', { name: '助理设置' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('追加连接分页不丢选项或当前草稿；切连接会清空 Key', async () => {
    const other = { ...connection, id: '00000000-0000-4000-8000-000000000004', display_name: '第二连接' };
    vi.stubGlobal('fetch', async (url: string) => Response.json(!url.includes('/model-connections') ? page([model]) : url.includes('cursor=connections-next')
      ? page([other]) : { ...page([connection]), next_cursor: 'connections-next' }));
    vi.mocked(invoke).mockResolvedValue({ configured: false });
    const user = userEvent.setup();
    await openConnections();
    await user.selectOptions(await screen.findByLabelText('编辑连接'), connection.id);
    await user.type(screen.getByLabelText('连接名称'), '-draft');
    await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'discard-on-profile-change');
    await user.click(screen.getByRole('button', { name: '更多连接' }));
    await screen.findByRole('option', { name: /第二连接/ });
    expect(screen.getByRole('option', { name: /测试连接/ })).toBeDefined();
    expect((screen.getByLabelText('编辑连接') as HTMLSelectElement).value).toBe(connection.id);
    expect((screen.getByLabelText('连接名称') as HTMLInputElement).value).toBe('测试连接-draft');
    await user.selectOptions(screen.getByLabelText('编辑连接'), other.id);
    await user.click(screen.getByRole('button', { name: '放弃更改' }));
    expect((screen.getByLabelText('API Key（仅保存到系统凭据）') as HTMLInputElement).value).toBe('');
  });
});
