import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { connection, event, id, page, resource, secondId } from '../../test/fixtures';
import { embeddingProfile, embeddingView } from '../knowledge/embedding-fixtures';
import EmbeddingSettings from './EmbeddingSettings';
import Settings from './Settings';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear(); });
const runtime = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 });
function boundary(unknown = false) {
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'PUT') {
      const body = JSON.parse(String(init.body)); writes.push(body);
      if (unknown && writes.length === 1) throw new TypeError('response lost');
      return Response.json({ ...embeddingProfile, ...body.data, pricing: embeddingProfile.pricing });
    }
    if (path.endsWith('/embedding-profiles')) return Response.json(page([]));
    if (path.includes('/embedding-profiles/')) return Response.json(embeddingView);
    if (path.endsWith('/navigation')) return Response.json({ default_workspace_id: id, workspaces: page([]),
      recent_sessions: page([]), pending_count: 0, watermark: event.event_id });
    if (path.endsWith('/model-connections')) return Response.json(page([
      { ...connection, id, display_name: '硅基流动', endpoint: 'https://api.siliconflow.cn/v1' },
      { ...connection, id: secondId, protocol: 'anthropic', display_name: '不兼容连接' },
    ]));
    throw new Error(path);
  });
  return writes;
}

it('独立云端检索配置显式选择兼容连接，无聊天协议/模型复用，默认不要求价格', async () => {
  const writes = boundary(), user = userEvent.setup();
  render(<EmbeddingSettings client={runtime()} />);
  await user.click(await screen.findByRole('button', { name: '新建检索模型' }));
  expect((screen.getByLabelText('复用连接') as HTMLSelectElement).value).toBe('');
  expect(screen.queryByRole('option', { name: /不兼容连接/ })).toBeNull();
  expect(screen.getByRole('option', { name: '云端（OpenAI 兼容）' })).toBeTruthy();
  await user.type(screen.getByLabelText('配置名称'), '硅基检索');
  await user.selectOptions(screen.getByLabelText('复用连接'), id);
  await user.type(screen.getByLabelText('检索专用型号'), 'Qwen/Qwen3-Embedding-4B');
  await user.type(screen.getByLabelText('向量维度'), '1024');
  await user.click(screen.getByRole('button', { name: '保存检索模型' }));
  await screen.findByText(/已保存检索模型.*尚未验证服务调用/);
  expect(writes[0]).toMatchObject({ meta: { expected_version: null }, data: {
    provider: 'openai', connection_id: id, model_id: 'Qwen/Qwen3-Embedding-4B', dimensions: 1024,
  } });
  expect(JSON.stringify(writes[0])).not.toMatch(/model_profile|api_key|secret_ref|temperature|output_per_million|cache_/);
  expect(writes[0].data.pricing?.input_per_million ?? null).toBeNull();
});

it('profile unknown 重试保持原命令与内容，不保存到另一个配置', async () => {
  const writes = boundary(true), user = userEvent.setup();
  render(<EmbeddingSettings client={runtime()} />);
  await user.click(await screen.findByRole('button', { name: '新建检索模型' }));
  await user.type(screen.getByLabelText('配置名称'), '原始配置');
  await user.selectOptions(screen.getByLabelText('复用连接'), id);
  await user.type(screen.getByLabelText('检索专用型号'), 'embedding-custom');
  await user.type(screen.getByLabelText('向量维度'), '128');
  await user.click(screen.getByRole('button', { name: '保存检索模型' }));
  await user.click(await screen.findByRole('button', { name: '重试' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual(writes[0]);
});

it('高级输入价只发送输入单价，不出现输出/缓存价格或默认免费', async () => {
  const writes = boundary(), user = userEvent.setup();
  render(<EmbeddingSettings client={runtime()} />);
  await user.click(await screen.findByRole('button', { name: '新建检索模型' }));
  await user.type(screen.getByLabelText('配置名称'), '自定义服务');
  await user.selectOptions(screen.getByLabelText('复用连接'), id);
  await user.type(screen.getByLabelText('检索专用型号'), 'custom-embedding');
  await user.type(screen.getByLabelText('向量维度'), '128');
  await user.click(screen.getByText('高级设置'));
  await user.type(screen.getByLabelText('自定义输入单价（USD/百万输入 token，可选）'), '0.02');
  expect(screen.queryByLabelText(/输出.*单价|缓存.*单价/)).toBeNull();
  await user.click(screen.getByRole('button', { name: '保存检索模型' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data.pricing).toEqual({ currency: 'USD', input_per_million: '0.02' });
});

it.each([['Qwen/Qwen3-Embedding-4B', true], ['BAAI/bge-m3', false]] as const)('指定维度仅显式启用，%s 不按型号名称推断', async (modelId, enabled) => {
  const writes = boundary(), user = userEvent.setup();
  render(<EmbeddingSettings client={runtime()} />);
  await user.click(await screen.findByRole('button', { name: '新建检索模型' }));
  await user.type(screen.getByLabelText('配置名称'), '明确维度配置');
  await user.selectOptions(screen.getByLabelText('复用连接'), id);
  await user.type(screen.getByLabelText('检索专用型号'), modelId);
  await user.type(screen.getByLabelText('向量维度'), '1024');
  await user.click(screen.getByText('高级设置'));
  const dimensions = screen.getByRole('checkbox', { name: '按指定维度生成（需模型支持）' }) as HTMLButtonElement;
  expect(dimensions.getAttribute('aria-checked')).toBe('false');
  if (enabled) await user.click(dimensions);
  await user.click(screen.getByRole('button', { name: '保存检索模型' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data.dimensions).toBe(1024);
  expect(writes[0].data.request_dimensions).toBe(enabled);
});

it('编辑已保存修订保留显式请求维度，不因修改名称恢复默认', async () => {
  const writes = boundary(), base = fetch, user = userEvent.setup();
  const profile = { ...embeddingProfile, request_dimensions: true };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (!init?.method && new URL(url).pathname.endsWith('/embedding-profiles')) return Response.json(page([profile]));
    if (!init?.method && new URL(url).pathname.includes('/embedding-profiles/')) return Response.json({ ...embeddingView, profile });
    return base(url, init);
  });
  render(<EmbeddingSettings client={runtime()} />);
  await user.click(await screen.findByRole('button', { name: new RegExp(profile.display_name) }));
  const name = await screen.findByLabelText('配置名称');
  await user.clear(name); await user.type(name, '保留请求维度');
  await user.click(screen.getByText('高级设置'));
  expect(screen.getByRole('checkbox', { name: '按指定维度生成（需模型支持）' }).getAttribute('aria-checked')).toBe('true');
  await user.click(screen.getByRole('button', { name: '保存检索模型' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ meta: { expected_version: profile.revision }, data: {
    id: profile.id, display_name: '保留请求维度', request_dimensions: true,
  } });
});

it('本地仅使用可信目录 ID，缺少运行库不冒充模型已验证，不下载或转云', async () => {
  boundary(); vi.mocked(invoke).mockResolvedValue({ resources: [{ ...resource, kind: 'directory', label: '本地检索模型' }] });
  const user = userEvent.setup();
  render(<EmbeddingSettings client={runtime()} />);
  await user.click(await screen.findByRole('button', { name: '新建检索模型' }));
  await user.selectOptions(screen.getByLabelText('运行位置'), 'fastembed');
  await user.click(screen.getByRole('button', { name: '选择本地模型目录' }));
  await screen.findByText('本地检索模型');
  expect(screen.queryByLabelText('模型路径')).toBeNull();
  expect(screen.queryByRole('button', { name: /下载/ })).toBeNull();
  expect(invoke).toHaveBeenCalledWith('select_resources', { scope: { kind: 'workspace', workspace_id: id, session_id: null }, kind: 'directory' });
});

it('正式设置目录独立进入检索模型，编辑离开沿现有未保存保护', async () => {
  boundary(); const user = userEvent.setup();
  render(<Settings client={runtime()} section="retrieval" />);
  await screen.findByRole('button', { name: '新建检索模型' });
  expect(screen.getByRole('button', { name: '检索模型' }).getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByRole('button', { name: '新建检索模型' }));
  await user.type(screen.getByLabelText('配置名称'), '保留这条编辑');
  await user.click(screen.getByRole('button', { name: '外观与主题' }));
  await screen.findByRole('region', { name: '未保存设置' });
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  expect((screen.getByLabelText('配置名称') as HTMLInputElement).value).toBe('保留这条编辑');
});

it('仅更换原生模型目录也触发既有未保存保护，继续编辑保留选择，保存后继续使用新目录', async () => {
  const writes = boundary(), base = fetch, user = userEvent.setup();
  const local = { ...embeddingProfile, provider: 'fastembed', connection_id: null, local_resource_id: secondId };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (!init?.method && path.endsWith('/embedding-profiles')) return Response.json(page([local]));
    if (!init?.method && path.includes('/embedding-profiles/')) return Response.json({
      profile: local, destination: null, local_runtime_available: false,
    });
    return base(url, init);
  });
  vi.mocked(invoke).mockResolvedValue({ resources: [{ ...resource, kind: 'directory', label: '新模型目录' }] });
  render(<Settings client={runtime()} section="retrieval" />);
  await user.click(await screen.findByRole('button', { name: new RegExp(local.display_name) }));
  await user.click(await screen.findByRole('button', { name: '选择本地模型目录' }));
  await screen.findByText('新模型目录');
  await user.click(screen.getByRole('button', { name: '外观与主题' }));
  await screen.findByRole('region', { name: '未保存设置' });
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByText('新模型目录')).toBeTruthy();
  expect(writes).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '外观与主题' }));
  await user.click(await screen.findByRole('button', { name: '保存后继续' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '外观与主题' }).getAttribute('aria-pressed')).toBe('true'));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ meta: { expected_version: local.revision }, data: { local_resource_id: resource.id } });
  expect(invoke).toHaveBeenCalledWith('select_resources', {
    scope: { kind: 'workspace', workspace_id: id, session_id: null }, kind: 'directory',
  });
});
