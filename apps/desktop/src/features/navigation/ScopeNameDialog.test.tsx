import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { Session, Workspace } from '../../generated/contracts';
import { id, limits, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import ScopeNameDialog from './ScopeNameDialog';

const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
const session: Session = { id: secondId, workspace_id: id, title: '新会话', version: 2, archived: false,
  agent_profile_id: id, kind: 'interaction', automatic_title: 'pending' };
const workspace: Workspace = { id, name: '手动项目', version: 3, directory_resource_id: null };
afterEach(() => vi.unstubAllGlobals());

it.each([
  { target: session, url: `/v4/sessions/${secondId}/title`, field: '会话标题', response: { ...session, title: '新的名称', version: 4, automatic_title: undefined } },
  { target: workspace, url: `/v4/workspaces/${id}/name`, field: '项目名称', response: { ...workspace, name: '新的名称', version: 4 } },
])('为选择的项目或会话提交用户输入及打开对话框时看到的版本', async ({ target, url, field, response }) => {
  const fetch = vi.fn(async () => Response.json(response));
  vi.stubGlobal('fetch', fetch);
  const saved = vi.fn();
  const user = userEvent.setup();
  render(<ScopeNameDialog client={client} target={target} onRenamed={saved} onClose={() => {}} onReturnFocus={() => {}} />);
  const input = screen.getByRole('textbox', { name: field });
  await user.clear(input);
  await user.type(input, '新的名称');
  await user.click(screen.getByRole('button', { name: '保存名称' }));
  await screen.findByRole('button', { name: '保存名称' });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining(url), expect.objectContaining({ method: 'PUT',
    body: expect.stringContaining(`"expected_version":${target.version}`) }));
  expect(saved).toHaveBeenCalledWith(response);
});

it('项目建议返回后保留已输入的名称，显式采用并保存才写项目', async () => {
  const completed = { ...run, state: 'completed', output: {
    summary: '组件验收', artifact_ids: [], unresolved: [], handled_failures: [],
  } };
  const detail = { ...runDetailSummary, run: completed, tasks: page([]), activities: page([]),
    messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]),
    joins: page([]), consumptions: page([]), watermark: '0',
    budget: { id: run.budget_id, version: 1, run_id: run.id, limits, spent_units: '0', reserved_units: '0',
      model_requests: 1, steps: 0, task_count: 1, total_tokens: 15, reserved_tokens: 0 } };
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path.endsWith('/title-suggestion')) return Response.json(run);
    if (path.startsWith('/v4/runs/')) return Response.json(detail);
    if (path.endsWith('/name')) return Response.json({ ...workspace, version: 4, name: JSON.parse(String(init?.body)).data.name });
    throw new Error(`未定义请求 ${path}`);
  });
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<ScopeNameDialog client={client} target={workspace} suggest onRenamed={saved} onClose={() => {}} onReturnFocus={() => {}} />);
  const adopt = await screen.findByRole('button', { name: '采用建议' });
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: '项目名称' });
  expect(input.value).toBe(workspace.name);
  expect(calls).toEqual([`POST /v4/workspaces/${workspace.id}/title-suggestion`, `GET /v4/runs/${run.id}`]);
  await user.click(adopt);
  expect(input.value).toBe('组件验收');
  expect(saved).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '保存名称' }));
  expect(saved).toHaveBeenCalledWith({ ...workspace, version: 4, name: '组件验收' });
});
