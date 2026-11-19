import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import type { SaveModelCommand } from '../../generated/contracts';
import { connection, model, page } from '../../test/fixtures';
import ModelSettings from './ModelSettings';
import Settings from './Settings';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'public-token', protocol_version: 3 });

it('兼容模型可选择 max_tokens，保存重开后保留并能清除覆盖', async () => {
  let saved = model;
  const bodies: SaveModelCommand[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body as string); bodies.push(body);
      saved = { ...body.data, version: saved.version + 1 }; return Response.json(saved);
    }
    return Response.json(url.includes('/model-connections') ? page([connection]) : page([saved]));
  });
  const user = userEvent.setup();
  const first = render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  await user.click(screen.getByText('高级覆盖 · 留空由目录解析或报告未知'));
  await user.selectOptions(screen.getByLabelText('输出上限参数'), 'max_tokens');
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await screen.findByText('模型配置已保存；仅对新运行生效');
  expect(bodies[0].data.openai_max_tokens_field).toBe('max_tokens');
  first.unmount(); render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  expect((screen.getByLabelText('输出上限参数') as HTMLSelectElement).value).toBe('max_tokens');
  await user.click(screen.getByText('高级覆盖 · 留空由目录解析或报告未知'));
  await user.selectOptions(screen.getByLabelText('输出上限参数'), '');
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1].data.openai_max_tokens_field).toBeNull();
});

it('Anthropic 模型不展示或提交 OpenAI 输出参数覆盖', async () => {
  const bodies: SaveModelCommand[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') { const body = JSON.parse(init.body as string); bodies.push(body); return Response.json({ ...model, ...body.data }); }
    return Response.json(url.includes('/model-connections') ? page([{ ...connection, protocol: 'anthropic' }]) : page([model]));
  });
  const user = userEvent.setup(); render(<ModelSettings client={client} connection={{ ...connection, protocol: 'anthropic' }} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  expect(screen.queryByLabelText('输出上限参数')).toBeNull();
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0].data).not.toHaveProperty('openai_max_tokens_field');
});

it('模型在途保存仍阻止重复提交、取消和切换设置', async () => {
  const bodies: SaveModelCommand[] = [];
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') { bodies.push(JSON.parse(init.body as string)); return new Promise<Response>(resolve => { finish = resolve; }); }
    return Response.json(url.includes('/model-connections') ? page([connection]) : page([model]));
  });
  const user = userEvent.setup();
  render(<Settings client={client} />);
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.click(screen.getByRole('button', { name: '模型设置' }));
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  const form = screen.getByRole('button', { name: '保存模型' }).closest('form')!;
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect((screen.getByRole('button', { name: '取消编辑' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '连接详情' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: /explicit-model/ }) as HTMLButtonElement).disabled).toBe(true);
  finish(Response.json({ ...model, version: 2 }));
  await screen.findByText('模型配置已保存；仅对新运行生效');
  expect((screen.getByRole('button', { name: '连接详情' }) as HTMLButtonElement).disabled).toBe(false);
});

it('模型保存只写所属连接与模型配置，不接触 Key；已建型号和连接不可编辑', async () => {
  const bodies: SaveModelCommand[] = [];
  const existing = { ...model, openai_max_tokens_field: 'max_completion_tokens' as const };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body as string); bodies.push(body);
      return Response.json({ openai_max_tokens_field: null, ...body.data, version: 2 });
    }
    return Response.json(url.includes('/model-connections') ? page([connection]) : page([existing]));
  });
  const user = userEvent.setup();
  render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  expect((screen.getByLabelText('Model ID') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('所属连接') as HTMLSelectElement).disabled).toBe(true);
  expect(screen.queryByLabelText('Endpoint')).toBeNull();
  expect(screen.queryByLabelText('API Key（仅保存到系统凭据）')).toBeNull();
  await user.type(screen.getByLabelText('模型显示名称'), '我的型号');
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await screen.findByText('模型配置已保存；仅对新运行生效');
  expect(bodies[0].data).toEqual({ ...existing, display_name: '我的型号' });
  expect(invoke).not.toHaveBeenCalled();
});

it('同一连接新增第二模型无需输入凭据，空白覆盖保留 unknown', async () => {
  const bodies: SaveModelCommand[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') { const body = JSON.parse(init.body as string); bodies.push(body); return Response.json({ openai_max_tokens_field: null, ...body.data }); }
    return Response.json(url.includes('/model-connections') ? page([connection]) : page([model]));
  });
  const user = userEvent.setup();
  render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: '新建模型' }));
  expect(screen.getByLabelText('所属连接')).toHaveProperty('disabled', true);
  await user.type(screen.getByLabelText('Model ID'), 'second-model');
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0].data).toMatchObject({ connection_id: connection.id, model_id: 'second-model', context_window_tokens: null,
    capabilities: { tools: null, thinking: null, structured_output: null } });
  expect(invoke).not.toHaveBeenCalled();
});

it('模型分页合并最新版本并保留显示名称草稿；取消编辑恢复已提交值', async () => {
  const bodies: SaveModelCommand[] = [];
  let reads = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (url.includes('/model-connections')) return Response.json(page([connection]));
    if (init.method === 'PUT') { const body = JSON.parse(init.body as string); bodies.push(body); return Response.json({ openai_max_tokens_field: null, ...body.data, version: 3 }); }
    reads++;
    return Response.json(reads === 1 ? { ...page([model]), next_cursor: 'old' } : { ...page([{ ...model, version: 2 }]), next_cursor: 'next' });
  });
  const user = userEvent.setup();
  render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  await user.click(screen.getByRole('button', { name: '更多模型' }));
  expect(screen.getAllByRole('button', { name: /explicit-model/ })).toHaveLength(1);
  await user.type(screen.getByLabelText('模型显示名称'), '草稿');
  await user.click(screen.getByRole('button', { name: '更多模型' }));
  expect((screen.getByLabelText('模型显示名称') as HTMLInputElement).value).toBe('草稿');
  await user.click(screen.getByRole('button', { name: '取消编辑' }));
  expect((screen.getByLabelText('模型显示名称') as HTMLInputElement).value).toBe('');
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0].meta.expected_version).toBe(2);
});

it('候选与自由型号共存，当前生效值/来源/unknown 来自 resolved 而非输入推断', async () => {
  const requests: string[] = [];
  const official = { ...connection, provider_preset_id: 'test-provider' };
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(url); const path = new URL(url).pathname;
    if (path.endsWith('/model-catalog')) return Response.json([{ model_id: 'catalog-model', provider_preset_id: 'test-provider', display_name: '目录候选', context_window_tokens: null, capabilities: { tools: true, thinking: null, structured_output: null }, metadata_sources: { 'capabilities.tools': { kind: 'catalog', source: 'synthetic-catalog', version: 'v1', verified_at: '2026-11-12', note: null } } }]);
    if (path.endsWith('/resolved')) return Response.json({ ...model, connection_version: 1, protocol: connection.protocol, endpoint: connection.endpoint, secret_ref: null, provider_preset_id: 'test-provider', context_window_tokens: null, metadata_sources: { context_window_tokens: { kind: 'unknown', source: null, version: null, verified_at: null, note: null } }, model_pricing: null, pricing_unknown_reason: '无明确价格映射', blockers: ['context_window_unknown'] });
    return Response.json(path.endsWith('/model-connections') ? page([official]) : page([model]));
  });
  const user = userEvent.setup(); render(<ModelSettings client={client} connection={official} />);
  await user.click(await screen.findByRole('button', { name: '新建模型' }));
  await user.selectOptions(await screen.findByLabelText('目录候选'), 'catalog-model');
  expect((screen.getByLabelText('所属连接') as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('catalog-model');
  expect(await screen.findByText(/synthetic-catalog/)).toBeTruthy();
  await user.clear(screen.getByLabelText('Model ID')); await user.type(screen.getByLabelText('Model ID'), 'free-model');
  expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('free-model');
  expect(screen.queryByText(/synthetic-catalog/)).toBeNull();
  await user.click(screen.getByRole('button', { name: /explicit-model/ }));
  expect(await screen.findByRole('region', { name: '当前生效配置' })).toHaveProperty('textContent', expect.stringContaining('上下文容量：未知'));
  expect(screen.getByText('价格未知：无明确价格映射；不代表免费')).toBeTruthy();
  expect(requests.some(url => url.includes(`connection_id=${connection.id}`))).toBe(true);
});
