import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { DataUseGrant, GrantRequest } from '../../generated/contracts';
import { connection, event, grant, id, model, page, resource } from '../../test/fixtures';
import { mcpView } from '../../test/mcp-fixtures';
import { remoteSnapshot, remoteTools } from '../../test/mcp-tool-fixtures';
import Settings from './Settings';

afterEach(() => vi.unstubAllGlobals());

function setup({ failure, gate }: { failure?: 'rejected' | 'transport'; gate?: Promise<void> } = {}) {
  const writes: GrantRequest[] = [], saved = new Map<string, DataUseGrant>();
  const workspace = { id, version: 1, name: '授权项目', directory_resource_id: null };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v3/grants' && init.method === 'POST') {
      const request: GrantRequest = JSON.parse(String(init.body)); writes.push(request);
      await gate;
      if (failure === 'rejected' && writes.length === 1) return Response.json({ error: {
        code: 'scope_mismatch', safe_message: '受控授权保存失败', related_ids: [], retryable: false,
      } }, { status: 409 });
      const commandId = request.meta.command_id!;
      if (!saved.has(commandId)) saved.set(commandId, { ...grant, id: crypto.randomUUID(),
        scope: { kind: 'workspace', workspace_id: id, session_id: null }, resource_ids: [], memory_scopes: [],
        mcp_versions: { [remoteSnapshot.server_id]: remoteSnapshot.config_revision },
        purposes: ['model_send'], destination: connection.endpoint });
      if (failure === 'transport' && writes.length === 1) throw new TypeError('controlled response lost');
      return Response.json(saved.get(commandId));
    }
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/workspaces')) return Response.json(page([workspace]));
    if (path.endsWith('/snapshot')) return Response.json({ workspace, sessions: page([]), active_runs: page([]),
      pending_questions: page([]), pending_approvals: page([]), resources: page([resource]),
      grants: page([...saved.values()]), watermark: event.event_id });
    if (path.endsWith('/resources')) return Response.json(page([resource]));
    if (path.endsWith('/grants')) return Response.json(page([...saved.values()]));
    if (path.endsWith('/tools')) return Response.json(remoteTools);
    if (path.endsWith('/models')) return Response.json(page([model]));
    if (path.endsWith('/model-connections')) return Response.json(page([connection]));
    if (path.endsWith('/provider-presets')) return Response.json([]);
    if (path.endsWith('/mcp')) return Response.json(page([{ ...mcpView, config: { ...mcpView.config,
      id: remoteSnapshot.server_id, revision: remoteSnapshot.config_revision, display_name: '受控 MCP' } }]));
    throw new Error(path);
  });
  return { writes, client: new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 }) };
}

async function editGrant(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  await user.selectOptions(screen.getByLabelText('授权来源'), 'mcp');
  await screen.findByRole('option', { name: /受控 MCP/ });
  await user.selectOptions(screen.getByLabelText('返回资料的 MCP 配置'), remoteSnapshot.server_id);
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), connection.endpoint);
}

it.each(['关闭设置', '完成'])('D-N1：确认创建授权后可直接%s，不再报告当前表单未保存', async entry => {
  const { writes, client } = setup(), close = vi.fn(), user = userEvent.setup();
  render(<Settings client={client} section="resources" onClose={close} />);
  await editGrant(user);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await screen.findByText('用途授权已创建');
  await screen.findByRole('button', { name: '撤销这份授权并保留历史' });
  await user.click(screen.getByRole('button', { name: entry }));
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole('region', { name: '未保存设置' })).toBeNull();
  expect(writes).toHaveLength(1);
});

it.each(['unsaved', 'rejected'] as const)('%s授权仍提示未保存，失败不触发继续关闭', async outcome => {
  const { writes, client } = setup({ failure: outcome === 'rejected' ? 'rejected' : undefined });
  const close = vi.fn(), user = userEvent.setup();
  render(<Settings client={client} section="resources" onClose={close} />);
  await editGrant(user);
  if (outcome === 'rejected') {
    await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
    await screen.findByText(/受控授权保存失败/);
  }
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  expect(screen.getByRole('region', { name: '未保存设置' })).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  expect(writes).toHaveLength(outcome === 'rejected' ? 1 : 0);
});

it('保存后继续提交当前授权表单，确认成功才完成关闭', async () => {
  const { writes, client } = setup(), close = vi.fn(), user = userEvent.setup();
  render(<Settings client={client} section="resources" onClose={close} />);
  await editGrant(user);
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  await user.click(screen.getByRole('button', { name: '保存后继续' }));
  await screen.findByText('用途授权已创建');
  expect(close).toHaveBeenCalledOnce();
  expect(writes).toHaveLength(1);
  expect(writes[0].data.mcp_versions).toEqual({ [remoteSnapshot.server_id]: remoteSnapshot.config_revision });
});

it('保存后继续遇到拒绝时保留提示，重新编辑并确认后才关闭', async () => {
  const { writes, client } = setup({ failure: 'rejected' }), close = vi.fn(), user = userEvent.setup();
  render(<Settings client={client} section="resources" onClose={close} />);
  await editGrant(user);
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  await user.click(screen.getByRole('button', { name: '保存后继续' }));
  await screen.findByText(/受控授权保存失败/);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: '未保存设置' })).toBeTruthy();
  expect((screen.getByRole('button', { name: '关闭设置' }) as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await user.selectOptions(screen.getByLabelText('返回资料的 MCP 配置'), remoteSnapshot.server_id);
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), connection.endpoint);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await screen.findByText('用途授权已创建');
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  expect(close).toHaveBeenCalledOnce();
  expect(writes).toHaveLength(2);
  expect(writes[1].meta.command_id).not.toBe(writes[0].meta.command_id);
});

it('不完整授权从保存后继续入口也不能误标已保存或创建请求', async () => {
  const { writes, client } = setup(), close = vi.fn(), user = userEvent.setup();
  render(<Settings client={client} section="resources" onClose={close} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  await user.selectOptions(screen.getByLabelText('授权来源'), 'mcp');
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  await user.click(screen.getByRole('button', { name: '保存后继续' }));
  expect(screen.getByRole('region', { name: '未保存设置' })).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});

it.each(['以原命令重试用途授权', '保存后继续'])('丢响应后经%s确认同一命令，确认前不关闭、确认后可关闭', async retry => {
  const { writes, client } = setup({ failure: 'transport' }), close = vi.fn(), user = userEvent.setup();
  render(<Settings client={client} section="resources" onClose={close} />);
  await editGrant(user);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await screen.findByRole('button', { name: '以原命令重试用途授权' });
  expect((screen.getByLabelText('授权来源') as HTMLSelectElement).disabled
    || (screen.getByLabelText('授权来源').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  expect(close).not.toHaveBeenCalled();
  if (retry !== '保存后继续') await user.click(screen.getByRole('button', { name: '继续编辑' }));
  await user.click(screen.getByRole('button', { name: retry }));
  await screen.findByText('用途授权已创建');
  if (retry !== '保存后继续') await user.click(screen.getByRole('button', { name: '关闭设置' }));
  expect(close).toHaveBeenCalledOnce();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

it('保存中拒绝关闭、Escape及分类离开；确认后原生分类导航继续', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const { client } = setup({ gate }), close = vi.fn(), user = userEvent.setup();
  const view = render(<Settings client={client} section="resources" onClose={close} />);
  await editGrant(user);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '关闭设置' }) as HTMLButtonElement).disabled).toBe(true));
  await user.click(screen.getByRole('button', { name: '完成' }));
  await user.keyboard('{Escape}');
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: '未保存设置' })).toBeNull();
  view.rerender(<Settings client={client} section="models" onClose={close} />);
  expect(screen.getByRole('form', { name: '用途授权' })).toBeTruthy();
  await act(async () => finish());
  await screen.findByRole('heading', { name: '连接设置' });
  expect(screen.queryByRole('region', { name: '未保存设置' })).toBeNull();
});

it('保存确认只清除当次form dirty，后续编辑仍提示且可再次保存后继续', async () => {
  const { writes, client } = setup(), close = vi.fn(), user = userEvent.setup();
  render(<Settings client={client} section="resources" onClose={close} />);
  await editGrant(user);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await screen.findByText('用途授权已创建');
  await user.selectOptions(screen.getByLabelText('返回资料的 MCP 配置'), remoteSnapshot.server_id);
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), connection.endpoint);
  await user.click(screen.getByRole('button', { name: '关闭设置' }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: '未保存设置' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '保存后继续' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(writes).toHaveLength(2);
  expect(writes[1].meta.command_id).not.toBe(writes[0].meta.command_id);
});
