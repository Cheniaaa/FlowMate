import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { SaveAgentCommand, ToolSpecList } from '../../generated/contracts';
import { agent, connection, id, model, page } from '../../test/fixtures';
import AssistantsPage from './AssistantsPage';

afterEach(() => vi.unstubAllGlobals());
const tools: ToolSpecList = [{ name: 'dynamic.real_tool', version: '7', description: null, mcp: null, model_visible: true, background_supported: true,
  cancellation: 'cooperative', retry_class: 'read_only', requires_approval: false, required_purposes: ['read'], input_schema: {}, result_schema: {} }];
it('管理真实Profile/目录工具，保留未装配允许名与Skill；脏表单离开须确认，新助理创建不覆盖原身份', async () => {
  const saved: SaveAgentCommand[] = [], close = vi.fn();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') {
      const command: SaveAgentCommand = JSON.parse(init.body as string); saved.push(command);
      return Response.json({ ...command.data, version: command.meta.expected_version === null ? 1 : command.data.version! + 1 });
    }
    if (url.endsWith('/tools')) return Response.json(tools);
    if (url.endsWith('/profiles')) return Response.json(page([{ ...agent, allowed_tools: ['unmounted.old'], skill_ids: [id] }]));
    return Response.json(url.includes('/model-connections') ? page([connection]) : page([model]));
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 4 });
  render(<AssistantsPage client={client} onClose={close} />);
  await screen.findByLabelText('显示名称');
  expect(screen.getByLabelText(/unmounted.old/)).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: /unmounted.old/, checked: true })).toBeTruthy();
  await userEvent.click(screen.getByLabelText(/dynamic.real_tool/));
  await userEvent.click(screen.getByLabelText('允许作为委派成员'));
  await userEvent.selectOptions(screen.getByLabelText('默认模型'), model.id);
  await userEvent.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  await screen.findByRole('region', { name: '未保存助理' });
  expect(close).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '保存后继续' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(saved[0].data.allowed_tools).toEqual(['dynamic.real_tool', 'unmounted.old']);
  expect(saved[0].data.skill_ids).toEqual([id]);
  expect(saved[0].data.delegatable).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: '新建助理' }));
  await userEvent.type(screen.getByLabelText('显示名称'), '核验成员');
  await userEvent.selectOptions(screen.getByLabelText('默认模型'), model.id);
  await userEvent.click(screen.getByLabelText('允许作为委派成员'));
  await userEvent.click(screen.getByRole('button', { name: '保存助理' }));
  await waitFor(() => expect(saved).toHaveLength(2));
  expect(saved[1].meta.expected_version).toBeNull();
  expect(saved[1].data.id).not.toBe(agent.id);
  expect(saved[1].data.version).toBe(1);
});

it('agent.saved唤醒配置查询但不覆盖正在编辑的Profile草稿，明确取消后读取新版本', async () => {
  let version = 1;
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/tools')) return Response.json(tools);
    if (url.endsWith('/profiles')) return Response.json(page([{ ...agent, version, display_name: version === 1 ? '原配置' : '新版本配置' }]));
    return Response.json(url.includes('/model-connections') ? page([connection]) : page([model]));
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 4 });
  const props = { client, onClose: vi.fn() };
  const view = render(<AssistantsPage {...props} refreshKey="profile:1" />);
  await screen.findByLabelText('显示名称');
  await userEvent.type(screen.getByLabelText('工作指导'), '未提交的成员指导');
  version = 2;
  view.rerender(<AssistantsPage {...props} refreshKey="profile:2" />);
  expect((screen.getByLabelText('工作指导') as HTMLTextAreaElement).value).toBe('未提交的成员指导');
  expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('原配置');
  await userEvent.click(screen.getByRole('button', { name: '取消编辑' }));
  await waitFor(() => expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('新版本配置'));
});
