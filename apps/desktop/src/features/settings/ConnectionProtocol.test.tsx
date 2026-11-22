import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuntimeClient } from '../../api/client';
import { connection, model, modelDiscovery, modelResolution, page } from '../../test/fixtures';
import ConnectionSettings from './ConnectionSettings';

afterEach(() => vi.unstubAllGlobals());
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });

it.each([
  ['openai_compatible', 'OpenAI Chat Completions'],
  ['openai_responses', 'OpenAI Responses'],
  ['anthropic', 'Anthropic Messages'],
] as const)('%s 在连接卡片、协议选项和模型标题中保持相同协议身份', async (protocol, title) => {
  const selected = { ...connection, protocol };
  vi.stubGlobal('fetch', async (url: string) => Response.json(url.endsWith('/provider-presets') ? []
    : url.endsWith('/discover') ? modelDiscovery
    : url.endsWith('/resolved') ? { ...modelResolution, protocol }
    : url.includes('/model-connections') ? page([selected]) : page([model])));
  const user = userEvent.setup();
  render(<ConnectionSettings client={client} />);
  const card = await screen.findByRole('button', { name: new RegExp(connection.display_name) });
  expect(within(card).getByText(title)).toBeTruthy();
  await user.click(card);
  expect(screen.getByRole('option', { name: title })).toHaveProperty('value', protocol);
  await user.click(screen.getByRole('button', { name: '模型设置' }));
  expect(screen.getByText(`${title} · ${connection.endpoint}`)).toBeTruthy();
});

it('自定义连接默认建议通用基础地址，三协议可直接选择且地址由用户明确填写', async () => {
  vi.stubGlobal('fetch', async (url: string) => Response.json(url.endsWith('/provider-presets') ? [] : page([])));
  const user = userEvent.setup();
  render(<ConnectionSettings client={client} />);
  await user.click(await screen.findByRole('button', { name: '新建连接' }));
  const protocol = screen.getByLabelText('协议');
  expect(protocol).toHaveProperty('value', 'openai_compatible');
  expect(screen.getByLabelText('Endpoint')).toHaveProperty('value', '');
  expect(screen.getByPlaceholderText('https://api.example.com/v1')).toBeTruthy();
  await user.selectOptions(protocol, 'openai_responses');
  expect(protocol).toHaveProperty('value', 'openai_responses');
  await user.selectOptions(protocol, 'anthropic');
  expect(protocol).toHaveProperty('value', 'anthropic');
});
