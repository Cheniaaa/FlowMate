import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { agent, connection, model, page } from '../../test/fixtures';
import { skillView } from '../../test/skill-fixtures';
import AssistantSettings from './AssistantSettings';
import AssistantsPage from '../assistants/AssistantsPage';
afterEach(() => vi.unstubAllGlobals());

it('助理仅从真实启用目录选择允许Skill，保存ID上界不伪造版本或执行许可', async () => {
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'PUT') { const body = JSON.parse(String(init.body)); writes.push(body);
      return Response.json({ ...body.data, version: 2 }); }
    if (path.endsWith('/profiles')) return Response.json(page([agent]));
    if (path.endsWith('/models')) return Response.json(page([model]));
    if (path.endsWith('/model-connections')) return Response.json(page([connection]));
    if (path.endsWith('/tools')) return Response.json([]);
    if (path.endsWith('/capabilities/skills')) return Response.json(page([{ ...skillView,
      version: { ...skillView.version, scope: { kind: 'user_global', workspace_id: null, session_id: null } } }]));
    throw new Error(path);
  });
  const user = userEvent.setup();
  render(<AssistantSettings manageMembers client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 })} />);
  await user.click(await screen.findByRole('checkbox', { name: 'release-note · 个人' }));
  await user.click(screen.getByRole('button', { name: '保存助理' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data.skill_ids).toEqual([skillView.version.skill_id]);
  expect(writes[0].data).not.toHaveProperty('skill_versions');
});

it('Skill失效刷新允许目录，但未保存的助理名字/勾选保留至显式放弃', async () => {
  let enabled = true;
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/profiles')) return Response.json(page([agent]));
    if (path.endsWith('/models')) return Response.json(page([model]));
    if (path.endsWith('/model-connections')) return Response.json(page([connection]));
    if (path.endsWith('/tools')) return Response.json([]);
    if (path.endsWith('/capabilities/skills')) return Response.json(page([{ ...skillView,
      binding: { ...skillView.binding!, enabled } }]));
    throw new Error(path);
  });
  const user = userEvent.setup();
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  const view = render(<AssistantsPage client={client} skillsRevision={0} onClose={() => {}} />);
  await user.click(await screen.findByRole('checkbox', { name: 'release-note · 项目' }));
  const name = screen.getByLabelText('显示名称');
  fireEvent.change(name, { target: { value: '未提交助理名' } });
  enabled = false;
  view.rerender(<AssistantsPage client={client} skillsRevision={1} onClose={() => {}} />);
  expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('未提交助理名');
  expect(screen.getByRole('checkbox', { name: /^release-note · 项目/ }).getAttribute('aria-checked')).toBe('true');
  await user.click(screen.getByRole('button', { name: '返回对话与草稿' }));
  await user.click(screen.getByRole('button', { name: '放弃更改' }));
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: /^release-note · 项目/ })).toBeNull());
});
