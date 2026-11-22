import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { connection, id, model, page, secondId } from '../../test/fixtures';
import TitleSettings from './TitleSettings';

const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
afterEach(() => vi.unstubAllGlobals());

it('按项目显示默认本地规则，确认模型目的地和预算后才保存授权', async () => {
  const projects = [{ id, name: '日常助理', version: 1, directory_resource_id: null },
    { id: secondId, name: '研究项目', version: 1, directory_resource_id: null }];
  const writes: { path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      writes.push({ path, body });
      return Response.json({ workspace_id: secondId, version: 1, binding: body.data.binding });
    }
    if (path === '/v3/workspaces') return Response.json(page(projects));
    if (path === '/v3/models') return Response.json(page([model]));
    if (path === '/v3/model-connections') return Response.json(page([connection]));
    if (path.endsWith('/title-policy')) return Response.json({ workspace_id: path.split('/')[3], version: null, binding: null });
    throw new Error(`未定义查询 ${path}`);
  });
  const user = userEvent.setup();
  render(<TitleSettings client={client} />);
  expect((await screen.findByRole<HTMLSelectElement>('combobox', { name: '标题模型' })).value).toBe('');
  await user.selectOptions(screen.getByRole('combobox', { name: '适用项目' }), secondId);
  await user.selectOptions(await screen.findByRole('combobox', { name: '标题模型' }), model.id);
  expect(screen.getByText(/目标文字将发送到/).textContent).toContain(connection.endpoint);
  expect(writes).toEqual([]);
  await user.click(screen.getByRole('button', { name: '授权并保存' }));
  await screen.findByText('标题设置已保存');
  expect(writes).toEqual([{ path: `/v3/workspaces/${secondId}/title-policy`,
    body: { meta: { command_id: expect.any(String), expected_version: null }, data: { binding: {
      model_profile_id: model.id, model_version: model.version, connection_version: connection.version,
      endpoint: connection.endpoint, max_requests: 10, max_tokens: 4000, max_cost_units: null,
    } } } }]);
});
