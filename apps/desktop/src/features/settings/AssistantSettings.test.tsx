import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuntimeClient } from '../../api/client';
import type { SaveAgentCommand } from '../../generated/contracts';
import { agent, connection, model, page, secondId } from '../../test/fixtures';
import { skillHash, skillView } from '../../test/skill-fixtures';
import AssistantsPage from '../assistants/AssistantsPage';
import Settings from './Settings';
import AssistantSettings from './AssistantSettings';

afterEach(() => { vi.unstubAllGlobals(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'public-token', protocol_version: 4 });

describe('共享主助理设置', () => {
  it('连接与模型先显示标题与新建入口，固定模型在所选助理下保存', async () => {
    const writes: SaveAgentCommand[] = [];
    const earlierMember = { ...agent, id: secondId, display_name: '会议助理' };
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') {
        const command = JSON.parse(String(init.body)); writes.push(command);
        return Response.json({ ...command.data, version: 2 });
      }
      if (url.endsWith('/profiles')) return Response.json(page([earlierMember, agent]));
      if (url.endsWith('/models')) return Response.json(page([model]));
      if (url.endsWith('/model-connections')) return Response.json(page([connection]));
      return Response.json([]);
    });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    const home = await screen.findByRole('region', { name: '连接与模型' });
    const header = home.firstElementChild!;
    expect(within(header as HTMLElement).getByRole('heading', { name: '连接与模型' })).toBeTruthy();
    expect(within(header as HTMLElement).getByRole('button', { name: '新建连接' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '设置新会话默认模型' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '助理设置' }));
    await user.selectOptions(await screen.findByLabelText('编辑助理'), agent.id);
    const defaultModel = await screen.findByLabelText('默认模型');
    expect(within(defaultModel).getByRole('option', { name: /沿用项目最近使用/ })).toBeTruthy();
    await user.selectOptions(defaultModel, model.id);
    await user.click(screen.getByRole('button', { name: '保存助理' }));
    expect(writes[0]).toMatchObject({ meta: { expected_version: agent.version },
      data: { id: agent.id, default_model_profile_id: model.id } });
  });

  it('keyset 续页合并助理和模型的最新版本', async () => {
    const reads = { profiles: 0, models: 0 };
    const bodies: SaveAgentCommand[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (url.includes('/model-connections')) return Response.json(page([connection]));
      if (init.method === 'PUT') {
        const body: SaveAgentCommand = JSON.parse(init.body as string); bodies.push(body);
        return Response.json({ ...body.data, version: 3 });
      }
      const kind = url.includes('/profiles') ? 'profiles' : 'models';
      reads[kind]++;
      const item = kind === 'profiles' ? agent : model;
      return Response.json(reads[kind] === 1 ? { ...page([item]), next_cursor: 'old' } : page([{ ...item, version: 2 }]));
    });
    const user = userEvent.setup();
    render(<AssistantSettings client={client} />);
    await screen.findByLabelText('显示名称');
    await user.click(screen.getByRole('button', { name: '更多助理' }));
    await user.click(screen.getByRole('button', { name: '更多模型' }));
    expect(screen.getAllByRole('option', { name: 'FlowMate' })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: /explicit-model/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '保存助理' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].meta.expected_version).toBe(2);
  });

  it('编辑真实 Profile 的身份与指导，按同一 id/version 保存且后续使用返回版本', async () => {
    const requests: { url: string; body: SaveAgentCommand }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') {
        const body: SaveAgentCommand = JSON.parse(init.body as string); requests.push({ url, body });
        return Response.json({ ...body.data, version: body.data.version! + 1 });
      }
      return Response.json(url.endsWith('/profiles') ? page([agent]) : url.includes('/model-connections') ? page([connection]) : page([model]));
    });
    const user = userEvent.setup();
    render(<AssistantSettings client={client} />);
    const name = await screen.findByLabelText('显示名称');
    expect(screen.getByText(/对新运行生效/)).toBeDefined();
    await user.clear(name); await user.type(name, '我的助理');
    await user.selectOptions(screen.getByLabelText('内置图标'), 'compass');
    await user.type(screen.getByLabelText('沟通方式'), '简洁、直接');
    await user.type(screen.getByLabelText('工作指导'), '先核对来源');
    await user.selectOptions(screen.getByLabelText('默认模型'), model.id);
    await user.click(screen.getByRole('button', { name: '保存助理' }));
    await screen.findByText('助理配置已保存；仅对新运行生效');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('http://127.0.0.1:54321/v4/profiles/00000000-0000-4000-8000-000000000001');
    expect(requests[0].body.meta.expected_version).toBe(1);
    expect(requests[0].body.data).toEqual({ ...agent, version: 1, display_name: '我的助理', icon_id: 'compass', communication_style: '简洁、直接', instructions: '先核对来源', default_model_profile_id: model.id });
    await user.click(screen.getByRole('button', { name: '保存助理' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body.meta.expected_version).toBe(2);
    expect(requests[1].body.data.version).toBe(2);
    expect(requests[1].body.data.id).toBe(agent.id);
  });

  it('更多模型和 Profile 保留已选真实身份、默认模型与编辑草稿', async () => {
    const firstModel = { ...model, display_name: '同名模型' };
    const laterModel = { ...firstModel, id: '00000000-0000-4000-8000-000000000003', model_id: 'Team/Custom-A', connection_id: secondId };
    const laterAgent = { ...agent, id: '00000000-0000-4000-8000-000000000004', display_name: '另一个已有助理' };
    const otherConnection = { ...connection, id: secondId, display_name: '备用站点', endpoint: 'https://other.example.test/v1' };
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/model-connections?')) return Response.json(page([otherConnection]));
      if (url.includes('/model-connections')) return Response.json({ ...page([connection]), next_cursor: 'connections-next' });
      if (url.includes('/profiles?')) return Response.json(page([laterAgent]));
      if (url.endsWith('/profiles')) return Response.json({ ...page([{ ...agent, default_model_profile_id: laterModel.id }]), next_cursor: 'agents-next' });
      if (url.includes('/models?')) return Response.json(page([laterModel]));
      return Response.json({ ...page([firstModel]), next_cursor: 'models-next' });
    });
    const user = userEvent.setup();
    render(<Settings client={client} section="assistant" />);
    await screen.findByLabelText('显示名称');
    expect((screen.getByLabelText('默认模型') as HTMLSelectElement).value).toBe(laterModel.id);
    expect(screen.getByRole('combobox', { name: '默认模型' }).textContent).not.toContain(laterModel.id);
    await user.type(screen.getByLabelText('工作指导'), '未提交草稿');
    await user.click(screen.getByRole('button', { name: '更多模型' }));
    await screen.findByRole('option', { name: /同名模型.*Team\/Custom-A/ });
    await user.click(screen.getByRole('button', { name: '更多连接' }));
    await screen.findByRole('option', { name: /同名模型.*Team\/Custom-A.*备用站点.*other\.example\.test/ });
    expect((screen.getByLabelText('默认模型') as HTMLSelectElement).value).toBe(laterModel.id);
    await user.click(screen.getByRole('button', { name: '更多助理' }));
    await screen.findByRole('option', { name: '另一个已有助理' });
    expect(screen.getByRole('option', { name: 'FlowMate' })).toBeDefined();
    expect(screen.getByRole('option', { name: /explicit-model/ })).toBeDefined();
    expect((screen.getByLabelText('编辑助理') as HTMLSelectElement).value).toBe(agent.id);
    expect((screen.getByLabelText('工作指导') as HTMLTextAreaElement).value).toBe('未提交草稿');
  });

  it('从助理入口展开身份详情时，仅以助理名和 Skill 名称显示已选能力', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/profiles')) return Response.json(page([{ ...agent, skill_ids: [skillView.version.skill_id] }]));
      if (path.endsWith('/models')) return Response.json(page([model]));
      if (path.endsWith('/model-connections')) return Response.json(page([connection]));
      if (path.endsWith('/tools')) return Response.json([]);
      if (path.endsWith('/skills')) return Response.json(page([skillView]));
      throw new Error(path);
    });
    const user = userEvent.setup();
    render(<AssistantsPage client={client} onClose={() => {}} />);
    const panel = await screen.findByRole('region', { name: '助理配置' });
    const identity = await within(panel).findByText('身份详情');
    await user.click(identity);
    expect(identity.closest('details')?.open).toBe(true);
    expect(identity.closest('details')?.textContent).toContain(agent.display_name);
    const skill = await within(panel).findByRole('checkbox', { name: /release-note.*项目/ });
    expect(skill.getAttribute('aria-checked')).toBe('true');
    expect(panel.textContent).not.toMatch(new RegExp(`${agent.id}|${skillHash.slice(0, 12)}`));
    expect(within(panel).queryByRole('checkbox', { name: new RegExp(skillHash.slice(0, 12)) })).toBeNull();
  });

  it('无 Profile 时不伪造默认身份，也不提供可保存的表单', async () => {
    const puts: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') puts.push(url);
      return Response.json(page([]));
    });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    await user.click(screen.getByRole('button', { name: '助理设置' }));
    await screen.findByText('暂无主助理配置');
    expect(screen.queryByRole('button', { name: '保存助理' })).toBeNull();
    expect(puts).toHaveLength(0);
  });

  it('首个分页为空时继续从后续页选用真实 Profile', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/model-connections')) return Response.json(page([connection]));
      if (url.includes('/profiles?')) return Response.json(page([agent]));
      if (url.endsWith('/profiles')) return Response.json({ ...page([]), next_cursor: 'agents-next' });
      return Response.json(page([model]));
    });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    await user.click(screen.getByRole('button', { name: '助理设置' }));
    await screen.findByText('暂无主助理配置');
    await user.click(screen.getByRole('button', { name: '更多助理' }));
    expect((await screen.findByLabelText('显示名称') as HTMLInputElement).value).toBe('FlowMate');
    expect((screen.getByLabelText('编辑助理') as HTMLSelectElement).value).toBe(agent.id);
  });

  it('在途助理保存只发送一次，失败保留真实版本并允许取消草稿', async () => {
    const bodies: SaveAgentCommand[] = [];
    let current = agent;
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') {
        bodies.push(JSON.parse(init.body as string));
        if (bodies.at(-1)!.meta.expected_version === current.version && current.version > 1) {
          return Response.json({ ...bodies.at(-1)!.data, version: current.version + 1 });
        }
        return new Promise<Response>(resolve => { finish = resolve; });
      }
      return Response.json(url.endsWith('/profiles') ? page([current]) : url.includes('/model-connections') ? page([connection]) : page([model]));
    });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    await user.click(screen.getByRole('button', { name: '助理设置' }));
    await user.type(await screen.findByLabelText('工作指导'), '草稿');
    const form = screen.getByRole('button', { name: '保存助理' }).closest('form')!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((screen.getByRole('button', { name: '连接与模型' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '取消编辑' }) as HTMLButtonElement).disabled).toBe(true);
    current = { ...agent, version: 2, display_name: '其他窗口已改名', instructions: '另一窗指导', communication_style: '其他窗口语气', allowed_tools: ['preserved.tool'] };
    finish(Response.json({ error: { code: 'version_conflict', safe_message: '配置已改变', retryable: false, related_ids: [] } }, { status: 409 }));
    expect((await screen.findByRole('alert')).textContent).not.toContain('version_conflict');
    expect(bodies[0].meta.expected_version).toBe(1);
    await user.click(screen.getByRole('button', { name: '读取最新助理配置' }));
    await screen.findByText(/其他窗口已改名/);
    expect(screen.getByRole('textbox', { name: '工作指导' })).toHaveProperty('value', '草稿');
    expect(bodies).toHaveLength(1);
    const conflict = screen.getByRole('group', { name: '工作指导' });
    expect(within(conflict).getByText('另一窗指导')).toBeTruthy();
    expect(within(conflict).getByText('草稿')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存合并后的助理' })).toHaveProperty('disabled', true);
    await user.click(within(conflict).getByRole('radio', { name: '使用我的值' }));
    await user.click(screen.getByRole('button', { name: '保存合并后的助理' }));
    await screen.findByText('助理配置已保存；仅对新运行生效');
    expect(bodies[1]).toMatchObject({ meta: { expected_version: 2 }, data: {
      id: agent.id, version: 2, instructions: '草稿', display_name: '其他窗口已改名', communication_style: '其他窗口语气', allowed_tools: ['preserved.tool'],
    } });
  });
});

it('旧设置编辑身份仍保留成员能力/Skill字段，不静默覆盖', async () => {
  const configured = { ...agent, delegatable: true, allowed_tools: ['existing.tool'], skill_ids: ['00000000-0000-4000-8000-000000000099'], default_model_profile_id: model.id };
  let saved: SaveAgentCommand | undefined;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') { saved = JSON.parse(init.body as string); return Response.json({ ...saved!.data, version: 2 }); }
    return Response.json(url.endsWith('/profiles') ? page([configured]) : url.includes('/model-connections') ? page([connection]) : page([model]));
  });
  render(<AssistantSettings client={client} />);
  await screen.findByLabelText('显示名称');
  await userEvent.click(screen.getByRole('button', { name: '保存助理' }));
  await waitFor(() => expect(saved).toBeDefined());
  expect(saved!.data.allowed_tools).toEqual(['existing.tool']);
  expect(saved!.data.skill_ids).toEqual(configured.skill_ids);
  expect(saved!.data.delegatable).toBe(true);
});
