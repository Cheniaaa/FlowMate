import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { agent, connection, page, model, id, grant, resource } from '../../test/fixtures';
import Settings from './Settings';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.restoreAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
it.each(['连接卡片', '新建连接'])('%s进入表单后仍可直接Escape退出', async entry => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('fetch', async (url: string) => Response.json(url.endsWith('/provider-presets') ? [] : page([connection])));
  const close = vi.fn(); const user = userEvent.setup(); render(<Settings client={client} onClose={close} />);
  await user.click(await screen.findByRole('button', { name: entry === '新建连接' ? entry : new RegExp(connection.display_name) }));
  expect(screen.getByRole('dialog', { name: '设置' }).contains(document.activeElement)).toBe(true);
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalledOnce();
});
it('保存连接及取消编辑重建表单后保持设置内焦点，Escape仍生效', async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') return Response.json({ ...JSON.parse(init.body as string).data, version: 2 });
    return Response.json(url.endsWith('/provider-presets') ? [] : page([connection]));
  });
  const close = vi.fn(); const user = userEvent.setup(); render(<Settings client={client} onClose={close} />);
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.click(screen.getByRole('button', { name: '保存连接' }));
  await screen.findByText('连接已保存；仅对新运行生效');
  await waitFor(() => expect(screen.getByRole('dialog', { name: '设置' }).contains(document.activeElement)).toBe(true));
  await user.type(screen.getByLabelText('连接名称'), '-discard');
  await user.click(screen.getByRole('button', { name: '取消编辑' }));
  expect((screen.getByLabelText('连接名称') as HTMLInputElement).value).toBe(connection.display_name);
  expect(screen.getByRole('dialog', { name: '设置' }).contains(document.activeElement)).toBe(true);
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalledOnce();
});
it('保存期间用户移到仍存活的设置内容，完成后不抢走焦点', async () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json(url.endsWith('/provider-presets') ? [] : page([connection]));
  });
  const user = userEvent.setup(); render(<Settings client={client} />);
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.click(screen.getByRole('button', { name: '保存连接' }));
  // 浏览器中选中文本也能把焦点移至稳定的内容节点。
  const heading = screen.getByRole('heading', { name: '设置' });
  heading.tabIndex = -1; heading.focus();
  finish(Response.json({ ...connection, version: 2 }));
  await screen.findByText('连接已保存；仅对新运行生效');
  expect(document.activeElement).toBe(heading);
});
it('保存完成时窗口已退到后台，不调用设置焦点恢复', async () => {
  const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json(url.endsWith('/provider-presets') ? [] : page([connection]));
  });
  const user = userEvent.setup(); render(<Settings client={client} />);
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.click(screen.getByRole('button', { name: '保存连接' }));
  hasFocus.mockReturnValue(false);
  const focus = vi.spyOn(screen.getByRole('button', { name: '关闭设置' }), 'focus');
  finish(Response.json({ ...connection, version: 2 }));
  await screen.findByText('连接已保存；仅对新运行生效');
  expect(focus).not.toHaveBeenCalled();
});
it.each(['assistant', 'model'] as const)('%s保存重建后仍可键盘关闭设置', async editor => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') return Response.json({ ...JSON.parse(init.body as string).data, version: 2 });
    if (url.endsWith('/resolved')) return Response.json({ ...model, connection_version: 1,
      protocol: connection.protocol, endpoint: connection.endpoint, secret_ref: null, provider_preset_id: null,
      metadata_sources: {}, model_pricing: null, pricing_unknown_reason: '离线未知价格', blockers: [] });
    return Response.json(url.endsWith('/provider-presets') ? [] : url.includes('/model-connections') ? page([connection])
      : url.endsWith('/profiles') ? page([agent]) : page([model]));
  });
  const close = vi.fn(); const user = userEvent.setup();
  render(<Settings client={client} section={editor === 'assistant' ? 'assistant' : 'models'} onClose={close} />);
  if (editor === 'model') {
    await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
    await user.click(screen.getByRole('button', { name: '模型设置' }));
    await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  } else await screen.findByLabelText('显示名称');
  await user.click(screen.getByRole('button', { name: editor === 'assistant' ? '保存助理' : '保存模型' }));
  await screen.findByText(editor === 'assistant' ? '助理配置已保存；仅对新运行生效' : '模型配置已保存；仅对新运行生效');
  await waitFor(() => expect(screen.getByRole('dialog', { name: '设置' }).contains(document.activeElement)).toBe(true));
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalledOnce();
});
it('连接卡片进入详情，dirty 关闭先保存或明确放弃；不卸载聊天由宿主保障', async () => {
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') { const body = JSON.parse(init.body as string); writes.push(body); return Response.json({ ...body.data, version: 2 }); }
    return Response.json(url.endsWith('/provider-presets') ? [] : url.includes('/model-connections') ? page([connection]) : page([model]));
  });
  const close = vi.fn(); const user = userEvent.setup(); render(<Settings client={client} section="models" onClose={close} />);
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.type(screen.getByLabelText('连接名称'), '-draft');
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  expect(close).not.toHaveBeenCalled(); expect(screen.getByText('有未保存的设置')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '保存后继续' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(writes).toHaveLength(1);
});
it('官方预设使用 API 地址/协议及来源，修改目的地转自定义且不伪称已验证 SDK', async () => {
  vi.mocked(invoke).mockResolvedValue({ configured: true });
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') { const body = JSON.parse(init.body as string); writes.push(body); return Response.json(body.data); }
    return Response.json(url.endsWith('/provider-presets') ? [{ id: 'test-provider', display_name: '契约提供商', protocol: 'anthropic', default_endpoint: 'https://provider.invalid/api', auth_mode: 'api_key', source_url: 'https://provider.invalid/docs', source_version: 'test-v1', verified_at: '2026-11-12' }] : page([]));
  });
  const user = userEvent.setup(); render(<Settings client={client} section="models" onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '新建连接' }));
  await user.selectOptions(await screen.findByLabelText('提供商预设'), 'test-provider');
  expect((screen.getByLabelText('Endpoint') as HTMLInputElement).value).toBe('https://provider.invalid/api');
  expect(screen.getByText(/test-v1/)).toBeTruthy();
  await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'synthetic-key');
  await user.click(screen.getByRole('button', { name: '保存连接' }));
  await waitFor(() => expect(writes).toHaveLength(1)); expect(writes[0].data.provider_preset_id).toBe('test-provider');
  expect(invoke).toHaveBeenCalledWith('save_credential', expect.objectContaining({ value: 'synthetic-key' }));
});

it('资料分类复用完整授权管理，撤销走真实版本命令且不调用隐私删除', async () => {
  const writes: { path: string; body: any }[] = []; let revoked = false;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/snapshot')) return Response.json({ workspace: { id, version: 1, name: '授权项目', directory_resource_id: null }, sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([resource]), grants: page([grant]), watermark: '9007199254740993' });
    if (init.method === 'POST') { writes.push({ path, body: JSON.parse(init.body as string) }); revoked = true; return Response.json({ id: grant.id, scope: grant.scope, epoch: 2, status: 'revoked' }); }
    if (path.endsWith('/workspaces')) return Response.json(page([{ id, version: 1, name: '授权项目', directory_resource_id: null }]));
    return Response.json(path.endsWith('/resources') ? page([resource]) : page([{ ...grant, ...(revoked ? { version: 2, status: 'revoked', epoch: 2 } : {}) }]));
  });
  const user = userEvent.setup(); render(<Settings client={client} section="resources" onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '撤销这份授权并保留历史' }));
  await user.click(screen.getByRole('button', { name: '确认撤销整份授权' }));
  await screen.findByText(/已撤销/);
  expect(writes).toEqual([{ path: `/v3/grants/${grant.id}/revoke`, body: expect.objectContaining({ expected_version: 1 }) }]);
  expect(invoke).not.toHaveBeenCalled();
});
it('窗口快捷键 dirty 关闭可保存后继续；即时 pin 不伪清除未保存快捷键', async () => {
  const native = { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
  vi.mocked(invoke).mockImplementation(async (name, args: any) => name === 'set_shortcut' ? { ...native, shortcut: args.chord } : name === 'set_quick_pinned' ? { ...native, quick_pinned: args.pinned } : native);
  const close = vi.fn(); const user = userEvent.setup(); render(<Settings client={client} section="windows" onClose={close} />);
  await user.type(await screen.findByLabelText('全局快捷键'), 'Control+Space'); await user.click(screen.getByLabelText('快捷小窗置顶'));
  await user.click(screen.getByRole('button', { name: '关闭设置' })); expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '保存后继续' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce()); expect(invoke).toHaveBeenCalledWith('set_shortcut', { chord: 'Control+Space' });
});
it('保存期间的原生分类导航等待保存结束，不丢失也不打断在途表单', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') return new Promise<Response>(resolve => { finish = resolve; });
    return Response.json(url.endsWith('/provider-presets') ? [] : url.endsWith('/profiles') ? page([agent]) : url.includes('/model-connections') ? page([connection]) : page([model]));
  });
  const user = userEvent.setup(); const view = render(<Settings client={client} section="models" />);
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.click(screen.getByRole('button', { name: '保存连接' }));
  view.rerender(<Settings client={client} section="assistant" />);
  expect(screen.getByLabelText('连接名称')).toBeTruthy();
  finish(Response.json({ ...connection, version: 2 }));
  expect(await screen.findByRole('heading', { name: '主助理设置' })).toBeTruthy();
});
