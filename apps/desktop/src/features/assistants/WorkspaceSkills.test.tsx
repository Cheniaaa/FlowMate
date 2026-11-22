import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { SaveAgentCommand, SkillView } from '../../generated/contracts';
import { agent, connection, id, model, page, secondId } from '../../test/fixtures';
import { skillView } from '../../test/skill-fixtures';
import AssistantsPage from './AssistantsPage';

afterEach(() => vi.unstubAllGlobals());
const personalId = '00000000-0000-4000-8000-000000000071';
const projectId = '00000000-0000-4000-8000-000000000072';
const otherId = '00000000-0000-4000-8000-000000000073';
const lateId = '00000000-0000-4000-8000-000000000074';
function skill(skillId: string, name: string, workspaceId: string | null): SkillView {
  const scope = { kind: workspaceId ? 'workspace' as const : 'user_global' as const, workspace_id: workspaceId, session_id: null };
  return { ...skillView, version: { ...skillView.version, skill_id: skillId, name, scope },
    binding: { ...skillView.binding!, skill_id: skillId, scope } };
}
function setup({ existing = [otherId], delayedPage }: { existing?: string[]; delayedPage?: Promise<void> } = {}) {
  const writes: SaveAgentCommand[] = [], reads: URL[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = new URL(input); reads.push(url);
    if (init.method === 'PUT') {
      const command: SaveAgentCommand = JSON.parse(String(init.body)); writes.push(command);
      return Response.json({ ...command.data, version: (command.meta.expected_version ?? 0) + 1 });
    }
    if (url.pathname.endsWith('/profiles')) return Response.json(page([{ ...agent, skill_ids: existing }]));
    if (url.pathname.endsWith('/models')) return Response.json(page([model]));
    if (url.pathname.endsWith('/model-connections')) return Response.json(page([connection]));
    if (url.pathname.endsWith('/tools')) return Response.json([]);
    if (url.pathname.endsWith('/workspaces')) return Response.json(url.searchParams.has('cursor') ? page([
      { id: secondId, name: '项目乙', version: 1, directory_resource_id: null },
    ]) : { ...page([{ id, name: '项目甲', version: 1, directory_resource_id: null }]), next_cursor: 'workspaces-next' });
    if (url.pathname.endsWith('/skills')) {
      const workspace = url.searchParams.get('workspace_id');
      if (!workspace) return Response.json(page([skill(personalId, '个人方法', null)]));
      if (workspace === secondId) return Response.json(page([skill(personalId, '个人方法', null), skill(otherId, '项目乙秘密方法', secondId)]));
      if (url.searchParams.has('cursor')) {
        await delayedPage;
        return Response.json(page([skill(lateId, '项目甲续页方法', id)]));
      }
      return Response.json({ ...page([skill(personalId, '个人方法', null), skill(projectId, '项目甲方法', id)]), next_cursor: 'skills-next' });
    }
    throw new Error(url.pathname);
  });
  return { writes, reads, client: new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 4 }) };
}

it('普通页面明确选项目后提供个人/项目能力，保存新成员保留ID上界、不写版本', async () => {
  const { writes, reads, client } = setup(), user = userEvent.setup();
  render(<AssistantsPage client={client} onClose={() => {}} />);
  await user.selectOptions(await screen.findByLabelText('能力所属项目'), id);
  await screen.findByLabelText('项目甲方法 · 项目');
  expect(screen.getByLabelText('个人方法 · 个人')).toBeTruthy();
  expect(screen.queryByText(/项目乙秘密方法/)).toBeNull();
  await user.click(screen.getByRole('button', { name: '新建助理' }));
  await user.type(screen.getByLabelText('显示名称'), '项目甲成员');
  await user.click(screen.getByLabelText('允许作为委派成员'));
  await user.selectOptions(screen.getByLabelText('默认模型'), model.id);
  await user.click(screen.getByLabelText('项目甲方法 · 项目'));
  await user.click(screen.getByRole('button', { name: '保存助理' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].meta.expected_version).toBeNull();
  expect(writes[0].data.skill_ids).toEqual([projectId]);
  expect(writes[0].data).not.toHaveProperty('skill_versions');
  expect(reads.some(url => url.pathname.endsWith('/skills') && url.searchParams.get('scope_kind') === 'workspace'
    && url.searchParams.get('workspace_id') === id)).toBe(true);
});

it('分页不恢复已取消的ID，保存已有项保留不可见项目ID且不查询其内容', async () => {
  const { writes, reads, client } = setup({ existing: [otherId, lateId] }), user = userEvent.setup();
  render(<AssistantsPage client={client} onClose={() => {}} />);
  await user.selectOptions(await screen.findByLabelText('能力所属项目'), id);
  await screen.findByLabelText('项目甲方法 · 项目');
  const unavailable = screen.getAllByRole('checkbox', { name: /尚未加载的 Skill.*保留原配置/ });
  const late = unavailable.find(control => (control as HTMLInputElement).value === lateId);
  expect(late).toBeDefined();
  await user.click(late!);
  await user.click(screen.getByLabelText('项目甲方法 · 项目'));
  await user.click(screen.getByRole('button', { name: '更多允许 Skill' }));
  expect(await screen.findByRole('checkbox', { name: '项目甲续页方法 · 项目', checked: false })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '保存助理' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data.skill_ids).toEqual([otherId, projectId]);
  expect(screen.queryByText(/项目乙秘密方法/)).toBeNull();
  expect(reads.filter(url => url.pathname.includes('/skills/'))).toEqual([]);
  expect(reads.some(url => url.searchParams.get('cursor') === 'skills-next' && url.searchParams.get('workspace_id') === id)).toBe(true);
});

it('项目切换沿脏表单确认，保存原选择后加载新范围；旧续页回执不能串回', async () => {
  let release!: () => void;
  const delayedPage = new Promise<void>(resolve => { release = resolve; });
  const { writes, client } = setup({ delayedPage }), user = userEvent.setup();
  render(<AssistantsPage client={client} onClose={() => {}} />);
  await user.selectOptions(await screen.findByLabelText('能力所属项目'), id);
  await screen.findByLabelText('项目甲方法 · 项目');
  await user.click(screen.getByRole('button', { name: '更多能力项目' }));
  await user.click(screen.getByLabelText('项目甲方法 · 项目'));
  await user.selectOptions(screen.getByLabelText('能力所属项目'), secondId);
  await screen.findByRole('region', { name: '未保存助理' });
  expect((screen.getByLabelText('能力所属项目') as HTMLSelectElement).value).toBe(id);
  await user.click(screen.getByRole('button', { name: '保存后继续' }));
  await screen.findByLabelText('项目乙秘密方法 · 项目');
  expect(writes[0].data.skill_ids).toEqual([otherId, projectId]);
  expect(screen.queryByLabelText('项目甲方法 · 项目')).toBeNull();
  await user.selectOptions(screen.getByLabelText('能力所属项目'), id);
  await screen.findByLabelText('项目甲方法 · 项目');
  await user.click(screen.getByRole('button', { name: '更多允许 Skill' }));
  await user.selectOptions(screen.getByLabelText('能力所属项目'), secondId);
  await screen.findByLabelText('项目乙秘密方法 · 项目');
  await act(async () => release());
  expect(screen.queryByLabelText('项目甲续页方法 · 项目')).toBeNull();
});
