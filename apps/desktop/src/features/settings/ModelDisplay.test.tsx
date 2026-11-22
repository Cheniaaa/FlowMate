import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuntimeClient } from '../../api/client';
import { connection, model, modelDiscovery, modelResolution, page } from '../../test/fixtures';
import ModelSettings from './ModelSettings';

afterEach(() => vi.unstubAllGlobals());
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });

it('真实解析中的未知容量与本地预算分开显示，运行阻塞与价格原因提供可操作说明', async () => {
  vi.stubGlobal('fetch', async (url: string) => Response.json(url.endsWith('/discover') ? modelDiscovery
    : url.endsWith('/provider-presets') ? [] : url.endsWith('/resolved')
    ? { ...modelResolution, pricing_unknown_reason: 'price_incomplete', blockers: ['tools_unsupported', 'output_exceeds_context', 'future_private_blocker'] }
    : page([model])));
  const user = userEvent.setup();
  render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  const effective = await screen.findByRole('region', { name: '当前生效配置' });
  expect(effective.textContent).toContain('上下文容量：未知');
  expect(effective.textContent).toContain('最大输入：未知');
  expect(effective.textContent).toContain('最大输出：未知');
  expect(effective.textContent).toContain('本地请求预算：8,192 token');
  expect(effective.textContent).toContain('图片输入：未知');
  expect(effective.textContent).toContain('请同时填写输入和输出单价');
  expect(effective.textContent).toContain('工具调用');
  expect(effective.textContent).toContain('增大本地上下文预算');
  expect(effective.textContent).toContain('检查模型设置');
  expect(effective.textContent).not.toMatch(/price_incomplete|tools_unsupported|output_exceeds_context|future_private_blocker/);
  expect(effective.textContent).not.toContain('：0');
  expect(within(effective).getByText(/不代表免费/)).toBeTruthy();
});

it('容量按 service/observed 来源展示，清除可选覆盖发送 null，显式 false 与免费价格 0 得以保留', async () => {
  let submitted: any;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/discover')) return Response.json(modelDiscovery);
    if (url.endsWith('/provider-presets')) return Response.json([]);
    if (init.method === 'PUT') {
      submitted = JSON.parse(String(init.body));
      return Response.json({ ...model, ...submitted.data, version: 2 });
    }
    return Response.json(url.endsWith('/resolved') ? { ...modelResolution, context_window_tokens: 65536, max_input_tokens: 32768,
      max_supported_output_tokens: 8192, capabilities: { ...model.capabilities, vision: true },
      metadata_sources: { ...modelResolution.metadata_sources,
        context_window_tokens: { kind: 'service', source: connection.display_name, version: null, verified_at: null, note: null },
        'capabilities.vision': { kind: 'observed', source: connection.display_name, version: null, verified_at: null, note: null } } }
      : page([model]));
  });
  const user = userEvent.setup();
  render(<ModelSettings client={client} connection={connection} />);
  await user.click(await screen.findByRole('button', { name: /explicit-model/ }));
  const effective = await screen.findByRole('region', { name: '当前生效配置' });
  expect(effective.textContent).toContain('上下文容量：65,536（当前服务声明）');
  expect(effective.textContent).toContain('此连接的调用记录');
  await user.clear(screen.getByLabelText('本地上下文预算（tokens）'));
  await user.click(screen.getByText(/高级覆盖/));
  await user.selectOptions(screen.getByLabelText('图片输入'), 'false');
  await user.clear(screen.getByLabelText('输入单价（USD / 百万 tokens）'));
  await user.type(screen.getByLabelText('输入单价（USD / 百万 tokens）'), '0');
  await user.click(screen.getByRole('button', { name: '保存模型' }));
  await screen.findByText('模型配置已保存；仅对新运行生效');
  expect(submitted.data.context_window_tokens).toBeNull();
  expect(submitted.data.capabilities.vision).toBe(false);
  expect(submitted.data.pricing.input_per_million).toBe('0');
});
