import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuntimeClient } from '../../api/client';
import type { SaveAgentCommand } from '../../generated/contracts';
import { agent, connection, model, page } from '../../test/fixtures';
import Settings from './Settings';
import AssistantSettings from './AssistantSettings';

afterEach(() => { vi.unstubAllGlobals(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'public-token', protocol_version: 2 });

describe('共享主助理设置', () => {
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
    expect(requests[0].url).toBe('http://127.0.0.1:54321/v2/profiles/00000000-0000-4000-8000-000000000001');
    expect(requests[0].body.meta.expected_version).toBe(1);
    expect(requests[0].body.data).toEqual({ id: agent.id, version: 1, display_name: '我的助理', icon_id: 'compass', communication_style: '简洁、直接', instructions: '先核对来源', default_model_profile_id: model.id });
    await user.click(screen.getByRole('button', { name: '保存助理' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].body.meta.expected_version).toBe(2);
    expect(requests[1].body.data.version).toBe(2);
    expect(requests[1].body.data.id).toBe(agent.id);
  });

  it('更多模型和 Profile 保留已选真实身份、默认模型与编辑草稿', async () => {
    const laterModel = { ...model, id: '00000000-0000-4000-8000-000000000003', model_id: 'later-model' };
    const laterAgent = { ...agent, id: '00000000-0000-4000-8000-000000000004', display_name: '另一个已有助理' };
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/model-connections')) return Response.json(page([connection]));
      if (url.includes('/profiles?')) return Response.json(page([laterAgent]));
      if (url.endsWith('/profiles')) return Response.json({ ...page([{ ...agent, default_model_profile_id: laterModel.id }]), next_cursor: 'agents-next' });
      if (url.includes('/models?')) return Response.json(page([laterModel]));
      return Response.json({ ...page([model]), next_cursor: 'models-next' });
    });
    const user = userEvent.setup();
    render(<AssistantSettings client={client} />);
    await screen.findByLabelText('显示名称');
    expect((screen.getByLabelText('默认模型') as HTMLSelectElement).value).toBe(laterModel.id);
    await user.type(screen.getByLabelText('工作指导'), '未提交草稿');
    await user.click(screen.getByRole('button', { name: '更多模型' }));
    await screen.findByRole('option', { name: /later-model/ });
    expect((screen.getByLabelText('默认模型') as HTMLSelectElement).value).toBe(laterModel.id);
    await user.click(screen.getByRole('button', { name: '更多助理' }));
    await screen.findByRole('option', { name: '另一个已有助理' });
    expect(screen.getByRole('option', { name: 'FlowMate' })).toBeDefined();
    expect(screen.getByRole('option', { name: /explicit-model/ })).toBeDefined();
    expect((screen.getByLabelText('编辑助理') as HTMLSelectElement).value).toBe(agent.id);
    expect((screen.getByLabelText('工作指导') as HTMLTextAreaElement).value).toBe('未提交草稿');
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
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (init.method === 'PUT') {
        bodies.push(JSON.parse(init.body as string));
        return new Promise<Response>(resolve => { finish = resolve; });
      }
      return Response.json(url.endsWith('/profiles') ? page([agent]) : url.includes('/model-connections') ? page([connection]) : page([model]));
    });
    const user = userEvent.setup();
    render(<Settings client={client} />);
    await user.click(screen.getByRole('button', { name: '助理设置' }));
    await user.type(await screen.findByLabelText('工作指导'), '草稿');
    const form = screen.getByRole('button', { name: '保存助理' }).closest('form')!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((screen.getByRole('button', { name: '模型与连接' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '取消编辑' }) as HTMLButtonElement).disabled).toBe(true);
    finish(Response.json({ error: { code: 'version_conflict', safe_message: '配置已改变', retryable: false, related_ids: [] } }, { status: 409 }));
    await screen.findByText('version_conflict: 配置已改变');
    expect(bodies[0].meta.expected_version).toBe(1);
    await user.click(screen.getByRole('button', { name: '取消编辑' }));
    expect((screen.getByLabelText('工作指导') as HTMLTextAreaElement).value).toBe('');
  });
});
