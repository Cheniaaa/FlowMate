import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { connection, grant, id, model, page, resource, secondId } from '../../test/fixtures';
import { remoteSnapshot, remoteTools, serverId } from '../../test/mcp-tool-fixtures';
import { skillView } from '../../test/skill-fixtures';
import ResourcePanel from '../chat/ResourcePanel';

afterEach(() => vi.unstubAllGlobals());
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
function setup({ loseFirst = false, stale = false, paginated = false, afterWrite }: {
  loseFirst?: boolean; stale?: boolean; paginated?: boolean; afterWrite?: () => Promise<void>;
} = {}) {
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      const command = JSON.parse(String(init.body)); writes.push(command);
      if (loseFirst && writes.length === 1) throw new TypeError('controlled response lost');
      await afterWrite?.();
      return Response.json({ ...grant, ...command.data });
    }
    if (path.endsWith('/resources')) return Response.json(page([resource]));
    if (path.endsWith('/grants')) return Response.json(page([]));
    if (path.endsWith('/tools')) return Response.json(remoteTools);
    if (path.endsWith('/skills')) return Response.json(page([{ ...skillView,
      binding: { ...skillView.binding!, environment_id: serverId, environment_revision: 2 } }]));
    if (path.endsWith(`/execution-environments/${serverId}`)) return Response.json({
      id: serverId, revision: 2, kind: 'python', executable_path: 'C:\\selected\\python.exe',
      executable_identity: 'controlled-file', version: '3.13', cwd_mode: 'attempt', env_keys: [],
      dependency_coverage: 'unverified', manifest_count: 0, status: 'probed', checked_at: null, diagnostic_code: null,
    });
    if (path.endsWith('/models')) return Response.json(paginated && !new URL(url).searchParams.has('cursor')
      ? { ...page([]), next_cursor: 'models-more' } : page([model]));
    if (path.endsWith('/model-connections')) return Response.json(paginated && !new URL(url).searchParams.has('cursor')
      ? { ...page([]), next_cursor: 'connections-more' } : page([connection]));
    if (path.endsWith('/mcp') && paginated && !new URL(url).searchParams.has('cursor')) return Response.json({ ...page([]), next_cursor: 'servers-more' });
    if (path.endsWith('/mcp')) return Response.json(page([{
      config: { id: serverId, revision: stale ? 5 : 4, display_name: '真实笔记服务', scope: { kind: 'workspace', workspace_id: id, session_id: null },
        transport: 'http', url: 'https://notes.example.invalid/mcp', command: null, args: [], cwd: null,
        env_refs: {}, credential_ref: null, enabled: true },
      catalog: null, state: 'saved', error_code: null, selection: null, query_grants: [],
    }]));
    throw new Error(path);
  });
  return writes;
}

it.each(['file', 'memory'] as const)('可达授权表单将%s发送到真实tool_send目的地，审批/模型许可不混用', async kind => {
  const writes = setup(), user = userEvent.setup();
  render(<ResourcePanel client={client()} workspaceId={id} sessionId={null} onRevoke={async () => {}} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  if (kind === 'memory') await user.selectOptions(screen.getByLabelText('授权来源'), 'memory');
  else await user.click(screen.getByLabelText(resource.label));
  await user.selectOptions(screen.getByLabelText('发送用途'), 'tool_send');
  await screen.findByRole('option', { name: /真实笔记服务.*notes\.example\.invalid/ });
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), remoteSnapshot.destination);
  expect(screen.getByText('服务地址：https://notes.example.invalid/mcp')).toBeTruthy();
  expect(screen.queryByText(remoteSnapshot.destination)).toBeNull();
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data).toMatchObject({
    scope: { kind: 'workspace', workspace_id: id, session_id: null }, purposes: ['tool_send'],
    destination: remoteSnapshot.destination, mcp_versions: {},
    resource_ids: kind === 'file' ? [resource.id] : [],
    memory_scopes: kind === 'memory' ? [{ kind: 'workspace', workspace_id: id, session_id: null }] : [],
  });
});

it('模型、连接和MCP目录的续页都读取后才列出实际可选目的地', async () => {
  const writes = setup({ paginated: true }), user = userEvent.setup();
  render(<ResourcePanel client={client()} workspaceId={id} sessionId={null} onRevoke={async () => {}} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  await screen.findByRole('option', { name: /explicit-model/ });
  await user.selectOptions(screen.getByLabelText('授权来源'), 'mcp');
  await screen.findByRole('option', { name: /真实笔记服务/ });
  await user.selectOptions(screen.getByLabelText('返回资料的 MCP 配置'), serverId);
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), connection.endpoint);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data.mcp_versions).toEqual({ [serverId]: 4 });
});

it('local_process_send保留实际Skill/hash/环境修订目的地，发送许可不冒充执行许可', async () => {
  const writes = setup(), user = userEvent.setup();
  render(<ResourcePanel client={client()} workspaceId={id} sessionId={null} onRevoke={async () => {}} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  await user.click(screen.getByLabelText(resource.label));
  await user.selectOptions(screen.getByLabelText('发送用途'), 'local_process_send');
  const target = `skill:${skillView.version.skill_id}:${skillView.version.content_hash}:environment:${serverId}:2`;
  await screen.findByRole('option', { name: /release-note.*python\.exe/ });
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), target);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data).toMatchObject({ purposes: ['local_process_send'], destination: target });
});

it('丢回执后使用原scope/目的地/command_id重试，不因切换当前项目重绑定', async () => {
  const writes = setup({ loseFirst: true }), user = userEvent.setup(), runtime = client();
  const view = render(<ResourcePanel client={runtime} workspaceId={id} sessionId={null} onRevoke={async () => {}} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  await user.click(screen.getByLabelText(resource.label));
  await screen.findByRole('option', { name: /explicit-model/ });
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), connection.endpoint);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await screen.findByRole('button', { name: '以原命令重试用途授权' });
  view.rerender(<ResourcePanel client={runtime} workspaceId={serverId} sessionId={null} onRevoke={async () => {}} />);
  await user.click(screen.getByRole('button', { name: '以原命令重试用途授权' }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual(writes[0]);
});

it('切换项目后迟到的创建回执不会把旧项目授权插入当前列表', async () => {
  let release!: () => void;
  const response = new Promise<void>(resolve => { release = resolve; });
  const writes = setup({ afterWrite: () => response }), user = userEvent.setup(), runtime = client();
  const view = render(<ResourcePanel client={runtime} workspaceId={id} sessionId={null} onRevoke={async () => {}} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  await user.click(screen.getByLabelText(resource.label));
  await screen.findByRole('option', { name: /explicit-model/ });
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), connection.endpoint);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  view.rerender(<ResourcePanel client={runtime} workspaceId={serverId} sessionId={null} onRevoke={async () => {}} />);
  await screen.findByText('当前范围没有授权。');
  await act(async () => release());
  await screen.findByText('用途授权已创建');
  expect(screen.queryByRole('button', { name: '撤销这份授权并保留历史' })).toBeNull();
});

it('会话内创建记忆授权成功后仍显示长期授权范围', async () => {
  let release!: () => void;
  const response = new Promise<void>(resolve => { release = resolve; });
  const writes = setup({ afterWrite: () => response }), user = userEvent.setup();
  render(<ResourcePanel client={client()} workspaceId={id} sessionId={secondId} onRevoke={async () => {}} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  await user.selectOptions(screen.getByLabelText('授权来源'), 'memory');
  await screen.findByRole('option', { name: /explicit-model/ });
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), connection.endpoint);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await screen.findByRole('button', { name: '以原命令重试用途授权' });
  await act(async () => release());
  await screen.findByText('用途授权已创建');
  expect(writes[0].data.memory_scopes).toEqual([{ kind: 'workspace', workspace_id: id, session_id: null }]);
  expect((screen.getByLabelText('授权范围') as HTMLSelectElement).value).toBe(id);
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), connection.endpoint);
  expect((screen.getByRole('button', { name: '确认创建用途授权' }) as HTMLButtonElement).disabled).toBe(false);
});

it('当前MCP配置修订已变时不提供旧工具目录目的地', async () => {
  setup({ stale: true }); const user = userEvent.setup();
  render(<ResourcePanel client={client()} workspaceId={id} sessionId={null} onRevoke={async () => {}} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  await screen.findByRole('option', { name: /explicit-model/ });
  await user.selectOptions(screen.getByLabelText('发送用途'), 'tool_send');
  expect(screen.queryByRole('option', { name: /真实笔记服务/ })).toBeNull();
  expect((screen.getByRole('button', { name: '确认创建用途授权' }) as HTMLButtonElement).disabled).toBe(true);
});

it.each([
  ['model_send', connection.endpoint],
  ['tool_send', remoteSnapshot.destination],
  ['local_process_send', `skill:${skillView.version.skill_id}:${skillView.version.content_hash}:environment:${serverId}:2`],
] as const)('MCP 返回资料需要单独选择 %s 的目的地并确认授权', async (purpose, destination) => {
  const writes = setup(), user = userEvent.setup();
  render(<ResourcePanel client={client()} workspaceId={id} sessionId={null} onRevoke={async () => {}} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  await user.selectOptions(screen.getByLabelText('授权来源'), 'mcp');
  await screen.findByRole('option', { name: '真实笔记服务' });
  await user.selectOptions(await screen.findByLabelText('返回资料的 MCP 配置'), serverId);
  await user.selectOptions(screen.getByLabelText('发送用途'), purpose);
  const target = screen.getByLabelText('实际接收目的地') as HTMLSelectElement;
  await waitFor(() => expect(Array.from(target.options, option => option.value)).toContain(destination));
  expect(target.value).toBe('');
  expect((screen.getByRole('button', { name: '确认创建用途授权' }) as HTMLButtonElement).disabled).toBe(true);
  await user.selectOptions(target, destination);
  expect(writes).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data).toEqual({ scope: { kind: 'workspace', workspace_id: id, session_id: null },
    resource_ids: [], memory_scopes: [], mcp_versions: { [serverId]: 4 },
    purposes: [purpose], destination });
});

it('个人记忆可以单独授权给当前项目的实际MCP目的地', async () => {
  const writes = setup(), user = userEvent.setup();
  render(<ResourcePanel client={client()} workspaceId={id} sessionId={null} onRevoke={async () => {}} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  await user.selectOptions(screen.getByLabelText('授权来源'), 'memory');
  await user.selectOptions(screen.getByLabelText('授权范围'), 'personal');
  await user.selectOptions(screen.getByLabelText('发送用途'), 'tool_send');
  await screen.findByRole('option', { name: /真实笔记服务.*notes\.example\.invalid/ });
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), remoteSnapshot.destination);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].data).toMatchObject({
    scope: { kind: 'user_global', workspace_id: null, session_id: null },
    memory_scopes: [{ kind: 'user_global', workspace_id: null, session_id: null }],
    purposes: ['tool_send'], destination: remoteSnapshot.destination,
  });
});

it('目的地未读取或未选择时不会创建授权', async () => {
  const writes = setup(), user = userEvent.setup();
  render(<ResourcePanel client={client()} workspaceId={id} sessionId={null} onRevoke={async () => {}} />);
  await user.click(await screen.findByRole('button', { name: '新增用途授权' }));
  fireEvent.submit(screen.getByRole('form', { name: '用途授权' }));
  expect(writes).toEqual([]);
});
