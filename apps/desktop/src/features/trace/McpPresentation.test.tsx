import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import { id, page, secondId } from '../../test/fixtures';
import { remoteApproval, remoteSnapshot, remoteTask, remoteTrace } from '../../test/mcp-tool-fixtures';
import ApprovalCard from '../chat/ApprovalCard';
import ArtifactPanel from '../artifacts/ArtifactPanel';
import { TracePanel } from './TracePanel';

afterEach(() => vi.unstubAllGlobals());
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

it('审批显示固定MCP原名、实际目的地与参数，审批不代表资料外发授权', () => {
  render(<ApprovalCard approval={remoteApproval} busy={false} onDecision={async () => {}} />);
  expect(screen.getByRole('heading', { name: /notes\/search 中文/ })).toBeTruthy();
  expect(screen.getByText(remoteSnapshot.destination)).toBeTruthy();
  expect(screen.getByText(/本次真实参数/)).toBeTruthy();
  expect(screen.getByText(/审批不会创建资料发送授权/)).toBeTruthy();
});

it('现有未传client的Trace入口通过真实Runtime连接接口读取固定Task，不需要改对话组件', async () => {
  vi.mocked(invoke).mockResolvedValue({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
  vi.stubGlobal('fetch', async (url: string) => {
    if (new URL(url).pathname === `/v3/tasks/${secondId}`) return Response.json(remoteTask);
    throw new Error(url);
  });
  render(<TracePanel events={[remoteTrace]} />);
  await screen.findByText(remoteSnapshot.original_name);
  expect(screen.getByText(remoteSnapshot.destination)).toBeTruthy();
});

it('Trace从Task固定目录解析原名，未知结果不重发且外部费用未知', async () => {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    paths.push(new URL(url).pathname);
    if (new URL(url).pathname === `/v3/tasks/${secondId}`) return Response.json(remoteTask);
    throw new Error('不得读取当前工具目录解释历史');
  });
  render(<TracePanel events={[remoteTrace]} client={client()} />);
  await screen.findByText(remoteSnapshot.original_name);
  expect(screen.getByText(remoteSnapshot.destination)).toBeTruthy();
  expect(screen.getByText(/结果未确认，不自动重发/)).toBeTruthy();
  expect(screen.getByText(/外部费用未知/)).toBeTruthy();
  expect(paths).toEqual([`/v3/tasks/${secondId}`]);
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
  expect(screen.getByText(remoteSnapshot.destination)).toBeTruthy();
});
