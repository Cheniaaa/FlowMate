import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import { id, page, secondId } from '../../test/fixtures';
import { remoteApproval, remoteSnapshot, remoteTask, remoteTrace } from '../../test/mcp-tool-fixtures';
import ApprovalCard from '../chat/ApprovalCard';
import ArtifactPanel from '../artifacts/ArtifactPanel';
import { TracePanel } from './TracePanel';

afterEach(() => vi.unstubAllGlobals());
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

it('审批显示固定 MCP 工具名与实际服务地址，审批不代表资料外发授权', async () => {
  render(<ApprovalCard approval={remoteApproval} busy={false} onDecision={async () => {}} />);
  expect(screen.getByRole('heading', { name: /notes\/search 中文/ })).toBeTruthy();
  await userEvent.click(screen.getByText('MCP 调用详情'));
  expect(screen.getByText('https://notes.example.invalid/mcp')).toBeTruthy();
  expect(screen.queryByText(remoteSnapshot.destination)).toBeNull();
  expect(screen.getByText(/只确认以下实际参数的本次调用/)).toBeTruthy();
  expect(screen.getByText(/审批不会创建资料发送授权/)).toBeTruthy();
});

it('现有未传client的Trace入口通过真实Runtime连接接口读取固定Task，不需要改对话组件', async () => {
  vi.mocked(invoke).mockResolvedValue({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
  vi.stubGlobal('fetch', async (url: string) => {
    if (new URL(url).pathname === `/v4/tasks/${secondId}`) return Response.json(remoteTask);
    throw new Error(url);
  });
  render(<TracePanel events={[remoteTrace]} />);
  await screen.findByText(remoteSnapshot.original_name);
  expect(screen.getByText('https://notes.example.invalid/mcp')).toBeTruthy();
});

it('Trace从Task固定目录解析原名，未知结果不重发且外部费用未知', async () => {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    paths.push(new URL(url).pathname);
    if (new URL(url).pathname === `/v4/tasks/${secondId}`) return Response.json(remoteTask);
    throw new Error('不得读取当前工具目录解释历史');
  });
  render(<TracePanel events={[{
    ...remoteTrace,
    activities: remoteTrace.activities.map(activity => ({ ...activity, error: 'mcp_call_uncertain' })),
  }]} client={client()} />);
  await screen.findByText(remoteSnapshot.original_name);
  expect(screen.getByText('https://notes.example.invalid/mcp')).toBeTruthy();
  expect(screen.getByText('调用已发送，未收到结果。原调用不会自动重复。')).toBeTruthy();
  expect(screen.getByText(/外部费用未知/)).toBeTruthy();
  expect(paths).toEqual([`/v4/tasks/${secondId}`]);
});

it('Artifact用来源依赖与所属Task固定server修订展示返回资料，不按当前配置改写来源', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith(`/tasks/${secondId}`)) return Response.json(remoteTask);
    if (path.endsWith('/trace')) return Response.json(page([remoteTrace]));
    throw new Error(path);
  });
  render(<ArtifactPanel client={client()} artifact={{ id, version: 1, media_type: 'application/octet-stream',
    content_hash: 'b'.repeat(64), task_id: secondId, activity_id: id,
    dependencies: [{ scope_id: remoteSnapshot.server_id, epoch: 4 }] }} />);
  await screen.findByText(remoteSnapshot.original_name);
  expect(screen.getByText(/MCP 返回资料/)).toBeTruthy();
  expect(screen.getByText(/向模型继续发送仍需独立授权/)).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'MCP 产物来源' })).getByText('https://notes.example.invalid/mcp')).toBeTruthy();
});
