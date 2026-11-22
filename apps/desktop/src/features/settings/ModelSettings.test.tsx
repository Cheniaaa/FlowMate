import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import type { ModelConnection, ModelProfile, ModelResolution, SaveModelCommand } from '../../generated/contracts';
import { connection, model, modelDiscovery, modelResolution, page } from '../../test/fixtures';
import ModelSettings from './ModelSettings';
import Settings from './Settings';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'public-token', protocol_version: 4 });

it('同名型号可按实际型号选择，续页和保存冲突保留原模型草稿', async () => {
  const first: ModelProfile = { ...model, display_name: '同名模型', model_id: 'Team/Custom-Model',
    capabilities: { ...model.capabilities, reasoning_efforts: ['low'] } };
  const second = { ...first, id: '00000000-0000-4000-8000-000000000015', model_id: 'Team/Alternate' };
  let current = first;
  const writes: SaveModelCommand[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith('/discover')) return Response.json(modelDiscovery);
    if (pathname.endsWith('/provider-presets')) return Response.json([]);
    if (pathname.endsWith('/model-connections')) return Response.json(page([connection]));
    if (pathname.endsWith('/resolved')) return Response.json(modelResolution);
    if (init.method === 'PUT') {
      const command = JSON.parse(String(init.body)); writes.push(command);
      if (command.meta.expected_version !== current.version) return Response.json({
        error: { code: 'version_conflict', safe_message: '配置已改变', retryable: false, related_ids: [] },
      }, { status: 409 });
      return Response.json({ ...command.data, version: current.version + 1 });
    }
    if (searchParams.has('cursor')) return Response.json(page([second]));
    return Response.json({ ...page([current]), next_cursor: 'second' });
  });
  const user = userEvent.setup();
  render(<Settings client={client} />);
  await user.click(await screen.findByRole('button', { name: new RegExp(connection.display_name) }));
  await user.click(screen.getByRole('button', { name: '模型设置' }));
  await user.click(await screen.findByRole('button', { name: /同名模型.*Team\/Custom-Model/ }));
  const name = screen.getByLabelText('模型显示名称');
  await user.clear(name); await user.type(name, '待保存型号');
  await user.click(screen.getByRole('button', { name: '更多模型' }));
  expect(await screen.findByRole('button', { name: /同名模型.*Team\/Alternate/ })).toBeTruthy();
  expect(screen.getByLabelText('模型显示名称')).toHaveProperty('value', '待保存型号');
  current = { ...first, version: 2, display_name: '最新型号名', max_output_tokens: 789,
    capabilities: { ...first.capabilities, thinking: true, reasoning_efforts: ['medium'] } };
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await user.click(await screen.findByRole('button', { name: '读取最新模型配置' }));
  await screen.findByText('最新型号名');
  expect(screen.getByRole('textbox', { name: '模型显示名称' })).toHaveProperty('value', '待保存型号');
  expect(within(screen.getByRole('region', { name: '模型配置冲突' })).queryByRole('group', { name: '思考强度档位' })).toBeNull();
  const conflict = screen.getByRole('group', { name: '模型显示名称' });
  await user.click(within(conflict).getByRole('radio', { name: '保留已保存值' }));
  await user.click(screen.getByRole('button', { name: '保存合并后的模型' }));
  await screen.findByText('模型配置已保存；仅对新运行生效');
  expect(writes[1]).toMatchObject({ meta: { expected_version: 2 },
    data: { id: first.id, version: 2, model_id: 'Team/Custom-Model', display_name: '最新型号名',
      max_output_tokens: 789, capabilities: { thinking: true, reasoning_efforts: ['medium'] } } });
});

it('合并后超出模型预算时可修正输出上限，保留两窗的其他设置', async () => {
  let current = { ...model, context_window_tokens: 10000, max_output_tokens: 2048 };
  const writes: SaveModelCommand[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/discover')) return Response.json(modelDiscovery);
    if (url.endsWith('/provider-presets')) return Response.json([]);
    if (url.endsWith('/resolved')) return Response.json(modelResolution);
    if (init.method === 'PUT') {
      const command: SaveModelCommand = JSON.parse(String(init.body));
      writes.push(command);
      if (command.meta.expected_version === current.version && Number(command.data.max_output_tokens) < current.context_window_tokens) {
        return Response.json({ ...command.data, version: current.version + 1 });
      }
      const stale = command.meta.expected_version !== current.version;
      return Response.json({ error: { code: stale ? 'version_conflict' : 'invalid_request',
        safe_message: stale ? '配置已改变' : '输出上限须小于预算', retryable: false, related_ids: [] } },
      { status: stale ? 409 : 422 });
    }
    return Response.json(page([current]));
  });
  const user = userEvent.setup();
  render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  await user.type(screen.getByLabelText('模型显示名称'), '本窗名称');
  await user.clear(screen.getByLabelText('最大输出（tokens）'));
  await user.type(screen.getByLabelText('最大输出（tokens）'), '6000');
  current = { ...current, version: 2, context_window_tokens: 4096,
    capabilities: { ...current.capabilities, thinking: true } };
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await user.click(await screen.findByRole('button', { name: '读取最新模型配置' }));
  await user.click(await screen.findByRole('button', { name: '保存合并后的模型' }));
  await screen.findByText('输出上限须小于预算');
  const output = screen.getByLabelText('最大输出（tokens）');
  expect(output.matches(':disabled')).toBe(false);
  expect(screen.getByLabelText('本地上下文预算（tokens）')).toHaveProperty('value', '4096');
  expect(output).toHaveProperty('value', '6000');
  await user.clear(output);
  await user.type(output, '3000');
  await user.click(screen.getByRole('button', { name: '保存合并后的模型' }));
  await screen.findByText('模型配置已保存；仅对新运行生效');
  expect(writes[2]).toMatchObject({ meta: { expected_version: 2 }, data: {
    version: 2, display_name: '本窗名称', max_output_tokens: 3000, context_window_tokens: 4096,
    capabilities: { thinking: true },
  } });
});

it('兼容模型可选择 max_tokens，保存重开后保留并能清除覆盖', async () => {
  let saved = model;
  const bodies: SaveModelCommand[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/discover')) return Response.json(modelDiscovery);
    if (url.endsWith('/provider-presets')) return Response.json([]);
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body as string); bodies.push(body);
      saved = { ...body.data, version: saved.version + 1 }; return Response.json(saved);
    }
    if (url.endsWith('/resolved')) return Response.json({ ...modelResolution, ...saved });
    return Response.json(url.includes('/model-connections') ? page([connection]) : page([saved]));
  });
  const user = userEvent.setup();
  const first = render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  await user.click(screen.getByText('高级覆盖 · 留空自动解析或保持未知'));
  await user.selectOptions(screen.getByLabelText('输出上限参数'), 'max_tokens');
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await screen.findByText('模型配置已保存；仅对新运行生效');
  expect(bodies[0].data.openai_max_tokens_field).toBe('max_tokens');
  first.unmount(); render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  expect((screen.getByLabelText('输出上限参数') as HTMLSelectElement).value).toBe('max_tokens');
  await user.click(screen.getByText('高级覆盖 · 留空自动解析或保持未知'));
  await user.selectOptions(screen.getByLabelText('输出上限参数'), '');
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1].data.openai_max_tokens_field).toBeNull();
});

it('Anthropic 模型不展示或提交 OpenAI 输出参数覆盖', async () => {
  const bodies: SaveModelCommand[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/discover')) return Response.json(modelDiscovery);
    if (url.endsWith('/provider-presets')) return Response.json([]);
    if (init.method === 'PUT') { const body = JSON.parse(init.body as string); bodies.push(body); return Response.json({ ...model, ...body.data }); }
    if (url.endsWith('/resolved')) return Response.json({ ...modelResolution, protocol: 'anthropic' });
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
    if (url.endsWith('/discover')) return Response.json(modelDiscovery);
    if (url.endsWith('/provider-presets')) return Response.json([]);
    if (url.endsWith('/resolved')) return Response.json(modelResolution);
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
  const existing: ModelProfile = { ...model, openai_max_tokens_field: 'max_completion_tokens',
    capabilities: { ...model.capabilities, reasoning_efforts: ['high', 'low'] } };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/discover')) return Response.json(modelDiscovery);
    if (url.endsWith('/provider-presets')) return Response.json([]);
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body as string); bodies.push(body);
      return Response.json({ openai_max_tokens_field: null, ...body.data, version: 2 });
    }
    if (url.endsWith('/resolved')) return Response.json({ ...modelResolution, openai_max_tokens_field: existing.openai_max_tokens_field });
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
    if (url.endsWith('/discover')) return Response.json(modelDiscovery);
    if (url.endsWith('/provider-presets')) return Response.json([]);
    if (url.endsWith('/resolved')) return Response.json(modelResolution);
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
    capabilities: { tools: null, thinking: null, structured_output: null, vision: null } });
  expect(invoke).not.toHaveBeenCalled();
});

it('模型分页合并最新版本并保留显示名称草稿；取消编辑恢复已提交值', async () => {
  const bodies: SaveModelCommand[] = [];
  let reads = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/discover')) return Response.json(modelDiscovery);
    if (url.endsWith('/provider-presets')) return Response.json([]);
    if (url.includes('/model-connections')) return Response.json(page([connection]));
    if (url.endsWith('/resolved')) return Response.json(modelResolution);
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
    if (path.endsWith('/discover')) return Response.json(modelDiscovery);
    if (path.endsWith('/model-catalog')) return Response.json([{ model_id: 'catalog-model', provider_preset_id: 'test-provider', display_name: '目录候选', context_window_tokens: null, max_input_tokens: null, max_output_tokens: null, capabilities: { tools: true, thinking: null, structured_output: null, vision: null }, metadata_sources: { 'capabilities.tools': { kind: 'catalog', source: 'synthetic-catalog', version: 'v1', verified_at: '2026-11-12', note: null } } }]);
    if (path.endsWith('/resolved')) return Response.json({ ...modelResolution, provider_preset_id: 'test-provider' });
    return Response.json(path.endsWith('/model-connections') ? page([official]) : page([model]));
  });
  const user = userEvent.setup(); render(<ModelSettings client={client} connection={official} />);
  await user.click(await screen.findByRole('button', { name: '新建模型' }));
  await user.selectOptions(await screen.findByLabelText('目录候选'), 'catalog-model');
  expect((screen.getByLabelText('所属连接') as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('catalog-model');
  const source = await screen.findByText('型号元数据来源');
  await user.click(source);
  expect(source.closest('details')).toHaveProperty('open', true);
  expect(screen.getByText(/工具调用：型号目录.*2026-11-12/)).toBeTruthy();
  expect(source.closest('details')?.textContent).not.toMatch(/synthetic-catalog|v1/);
  await user.clear(screen.getByLabelText('Model ID')); await user.type(screen.getByLabelText('Model ID'), 'free-model');
  expect((screen.getByLabelText('Model ID') as HTMLInputElement).value).toBe('free-model');
  expect(screen.queryByText('型号元数据来源')).toBeNull();
  await user.click(screen.getByRole('button', { name: /explicit-model/ }));
  expect(await screen.findByRole('region', { name: '当前生效配置' })).toHaveProperty('textContent', expect.stringContaining('上下文容量：未知'));
  expect(screen.getByText(/价格未知：.*价格目录映射.*不代表免费/)).toBeTruthy();
  expect(requests.some(url => url.includes(`connection_id=${connection.id}`))).toBe(true);
});

function mockReasoningSettings(initial: ModelProfile, link: ModelConnection, resolved: ModelResolution['capabilities']['reasoning_efforts'] = []) {
  let current = initial;
  const writes: SaveModelCommand[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith('/discover')) return Response.json(modelDiscovery);
    if (pathname.endsWith('/provider-presets')) return Response.json([]);
    if (pathname.endsWith('/resolved')) return Response.json({
      ...modelResolution, id: current.id, version: current.version, protocol: link.protocol, provider_preset_id: link.provider_preset_id,
      capabilities: { ...current.capabilities, reasoning_efforts: current.capabilities.reasoning_efforts ?? resolved },
      metadata_sources: { ...modelResolution.metadata_sources, 'capabilities.reasoning_efforts': {
        kind: current.capabilities.reasoning_efforts != null ? 'user' : link.provider_preset_id ? 'catalog' : 'unknown',
        source: null, version: null, verified_at: null, note: null,
      } },
    });
    if (init.method === 'PUT') {
      const command: SaveModelCommand = JSON.parse(String(init.body));
      writes.push(command);
      if (command.meta.expected_version !== current.version) return Response.json({
        error: { code: 'version_conflict', safe_message: '配置已改变', retryable: false, related_ids: [] },
      }, { status: 409 });
      current = { ...current, capabilities: { ...model.capabilities, ...command.data.capabilities },
        version: current.version + 1 };
      return Response.json(current);
    }
    return Response.json(page([current]));
  });
  return { writes, update: (latest: ModelProfile) => { current = latest; } };
}

it('自定义 Anthropic 型号从未知改为显式档位，保存重开后可恢复自动', async () => {
  const link: ModelConnection = { ...connection, protocol: 'anthropic' };
  const { writes } = mockReasoningSettings(model, link);
  const user = userEvent.setup();
  const view = render(<ModelSettings client={client} connection={link} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  expect(await screen.findByText(/思考强度档位：暂无可选档位/)).toBeTruthy();
  await user.click(screen.getByText('高级覆盖 · 留空自动解析或保持未知'));
  const controls = screen.getByRole('group', { name: '思考强度档位' });
  await user.selectOptions(within(controls).getByRole('combobox', { name: '档位来源' }), 'manual');
  expect(within(controls).getAllByRole('checkbox')).toHaveLength(5);
  await user.click(within(controls).getByRole('checkbox', { name: '低' }));
  await user.click(within(controls).getByRole('checkbox', { name: '最高' }));
  await user.selectOptions(within(controls).getByRole('combobox', { name: '档位来源' }), 'auto');
  expect(within(controls).queryByRole('checkbox')).toBeNull();
  await user.selectOptions(within(controls).getByRole('combobox', { name: '档位来源' }), 'manual');
  expect(within(controls).getByRole('checkbox', { name: '最高', checked: true })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await screen.findByText('模型配置已保存；仅对新运行生效');
  expect(writes[0].data.capabilities?.reasoning_efforts).toEqual(['low', 'max']);
  view.unmount();
  render(<ModelSettings client={client} connection={link} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  expect(await screen.findByText(/思考强度档位：低、最高（用户设置）/)).toBeTruthy();
  await user.click(screen.getByText('高级覆盖 · 留空自动解析或保持未知'));
  expect(screen.getByRole('checkbox', { name: '最高', checked: true })).toBeTruthy();
  await user.selectOptions(screen.getByRole('combobox', { name: '档位来源' }), 'auto');
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await waitFor(() => expect(writes[1]?.data.capabilities?.reasoning_efforts).toBeNull());
});

it('官方型号只展示 resolved 档位和来源，保存其他设置不会将解析结果写成覆盖', async () => {
  const link: ModelConnection = { ...connection, endpoint: 'https://api.openai.com/v1', provider_preset_id: 'openai', protocol: 'openai_responses' };
  const { writes } = mockReasoningSettings(model, link, ['none', 'high']);
  const user = userEvent.setup();
  render(<ModelSettings client={client} connection={link} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  expect(await screen.findByText(/思考强度档位：关闭、高（型号目录）/)).toBeTruthy();
  await user.click(screen.getByText('高级覆盖 · 留空自动解析或保持未知'));
  expect(screen.queryByRole('combobox', { name: '档位来源' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data.capabilities?.reasoning_efforts).toBeUndefined();
});

it('两个窗口更改档位时可选择清空覆盖，保留另一窗的其他配置', async () => {
  const original: ModelProfile = { ...model, capabilities: { ...model.capabilities, reasoning_efforts: ['low'] } };
  const { writes, update } = mockReasoningSettings(original, connection);
  const user = userEvent.setup();
  render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  await user.click(screen.getByText('高级覆盖 · 留空自动解析或保持未知'));
  await user.selectOptions(screen.getByRole('combobox', { name: '档位来源' }), 'auto');
  update({ ...original, version: 2, capabilities: { ...original.capabilities, reasoning_efforts: ['high'], vision: true } });
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await user.click(await screen.findByRole('button', { name: '读取最新模型配置' }));
  const conflict = within(await screen.findByRole('region', { name: '模型配置冲突' }));
  const choice = within(await conflict.findByRole('group', { name: '思考强度档位' }));
  expect(choice.getByText('自动解析')).toBeTruthy();
  expect(choice.getByText('高')).toBeTruthy();
  await user.click(choice.getByRole('radio', { name: '使用我的值' }));
  await user.click(screen.getByRole('button', { name: '保存合并后的模型' }));
  await screen.findByText('模型配置已保存；仅对新运行生效');
  expect(writes[1]).toMatchObject({ meta: { expected_version: 2 },
    data: { capabilities: { reasoning_efforts: null, vision: true } } });
});
