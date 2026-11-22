import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import { connection, page } from '../../test/fixtures';
import type { SaveModelCommand } from '../../generated/contracts';
import ModelSettings from './ModelSettings';
import Settings from './Settings';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'public-token', protocol_version: 4 });
const discovered = {
  connection_id: connection.id, connection_version: 1, status: 'ready', cached: false,
  fetched_at: '2026-11-20T12:00:00Z', message: '已读取此连接的型号列表',
  items: ['GPT-site-alias', 'Claude-site-alias'].map(model_id => ({
    model_id, display_name: null, canonical_id: null, context_window_tokens: 65536,
    max_input_tokens: null, max_output_tokens: 4096, capabilities: { tools: true, thinking: null, vision: null, structured_output: null },
    metadata_sources: {},
  })),
};

it('从同站列表选择两个别名，保存原始 ID，不把服务声明写成用户覆盖', async () => {
  const saved: SaveModelCommand[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/discover')) { expect(init.method).toBe('POST'); return Response.json(discovered); }
    if (path.endsWith('/models')) return Response.json(page(saved.map(item => item.data)));
    if (path.endsWith('/provider-presets')) return Response.json([]);
    if (init.method === 'PUT') { const command = JSON.parse(init.body as string); saved.push(command); return Response.json(command.data); }
    if (path.endsWith('/resolved')) return Response.json({});
    throw new Error(`Unexpected path: ${path}`);
  });
  render(<ModelSettings client={client} connection={connection} />);
  const user = userEvent.setup();
  for (const alias of ['GPT-site-alias', 'Claude-site-alias']) {
    await user.click(await screen.findByRole('button', { name: '新建模型' }));
    await user.selectOptions(await screen.findByLabelText('本站型号'), alias);
    expect(screen.getByLabelText('Model ID')).toHaveProperty('value', alias);
    await user.click(screen.getByRole('button', { name: '保存模型' }));
    await waitFor(() => expect(saved).toHaveLength(alias.startsWith('GPT') ? 1 : 2));
  }
  expect(saved.map(item => item.data.model_id)).toEqual(['GPT-site-alias', 'Claude-site-alias']);
  expect(saved.every(item => item.data.connection_id === connection.id)).toBe(true);
  expect(saved.every(item => item.data.context_window_tokens === null && item.data.capabilities?.tools === null)).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
});

it('列表认证失败可回到原连接改 Key，保存后才使用新绑定刷新清单', async () => {
  const bound = { ...connection, secret_ref: connection.id };
  const sequence: string[] = [];
  let revision = 1;
  vi.mocked(invoke).mockImplementation(async command => {
    sequence.push(String(command)); return { configured: true };
  });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/discover')) {
      sequence.push('discover');
      return Response.json(revision === 1 ? { ...discovered, items: [], status: 'authentication_error',
        message: '认证或权限不足，请检查此连接的 API Key' } : { ...discovered, connection_version: revision });
    }
    if (init.method === 'PUT') { sequence.push('connection-save'); revision++; return Response.json({ ...JSON.parse(init.body as string).data, version: revision }); }
    if (path.endsWith('/model-connections')) return Response.json(page([bound]));
    if (path.endsWith('/models')) return Response.json(page([]));
    if (path.endsWith('/provider-presets')) return Response.json([]);
    throw new Error(`Unexpected path: ${path}`);
  });
  render(<Settings client={client} connectionId={connection.id} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '模型设置' }));
  await screen.findByText(/认证或权限不足/);
  await user.click(screen.getByRole('button', { name: '检查连接' }));
  expect(screen.getByLabelText('编辑连接')).toHaveProperty('value', connection.id);
  await user.type(screen.getByLabelText('API Key（仅保存到系统凭据）'), 'synthetic-new-key');
  await user.click(screen.getByRole('button', { name: '保存连接' }));
  await screen.findByText('已读取此连接的型号列表');
  expect(sequence.indexOf('connection-save')).toBeLessThan(sequence.indexOf('save_credential'));
  expect(sequence.lastIndexOf('discover')).toBeGreaterThan(sequence.indexOf('save_credential'));
  expect(screen.getByLabelText('API Key（仅保存到系统凭据）')).toHaveProperty('value', '');
});

it('无列表时明确标记离线可尝试候选并保留手填别名', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/discover')) return Response.json({ ...discovered, status: 'unavailable', items: [],
      message: '此服务未提供型号列表' });
    if (path.endsWith('/provider-presets')) return Response.json([{ id: 'openai', display_name: 'OpenAI', protocol: 'openai_compatible',
      default_endpoint: 'https://api.openai.com/v1', auth_mode: 'api_key', source_url: 'https://example.invalid', source_version: 'v1', verified_at: '2026-11-20' }]);
    if (path.endsWith('/model-catalog')) return Response.json([]);
    return Response.json(page([]));
  });
  render(<ModelSettings client={client} connection={connection} />);
  const user = userEvent.setup();
  await screen.findByText('此服务未提供型号列表');
  await user.click(screen.getByRole('button', { name: '新建模型' }));
  expect(screen.getByText(/可尝试的型号.*本站尚未确认/)).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('参考提供方目录'), 'openai');
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'my-private-alias' } });
  expect(screen.getByLabelText('Model ID')).toHaveProperty('value', 'my-private-alias');
});

it('刷新失败时保留宿主确认的同身份缓存型号，显示上次成功列表', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/discover')) return Response.json({ ...discovered, status: 'error', cached: true,
      message: '当前连接目录暂时不可读' });
    return Response.json(page([]));
  });
  render(<ModelSettings client={client} connection={connection} />);
  const user = userEvent.setup();
  await screen.findByText('当前连接目录暂时不可读');
  expect(screen.getByText(/当前显示此连接上次成功读取的列表/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '新建模型' }));
  await user.selectOptions(screen.getByLabelText('本站型号'), 'Claude-site-alias');
  expect(screen.getByLabelText('Model ID')).toHaveProperty('value', 'Claude-site-alias');
});
