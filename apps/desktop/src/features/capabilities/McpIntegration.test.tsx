import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { emptyProjection, reduceStream, resetWorkspace } from '../../api/events';
import { McpClient } from '../../api/mcp';
import { mcpConnection, mcpPage, mcpView } from '../../test/mcp-fixtures';
import { id, page } from '../../test/fixtures';
import CapabilityLibrary from './CapabilityLibrary';
import McpPanel from './McpPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({ configured: false })) }));
afterEach(() => vi.unstubAllGlobals());

it('MCP 通知使用独立水位，重放不二次刷新且断流恢复仍失效', () => {
  const notice = { kind: 'durable', event_id: '10', event: { event_id: '10', kind: 'mcp.changed',
    event_version: 1, workspace_id: null, session_id: null, run_id: null, task_id: null,
    activity_id: null, causation_id: null, seq: null, created_at: '2026-11-19T00:00:00Z',
    payload: { server_id: mcpView.config.id, config_revision: 1, scope: mcpView.config.scope } } } as const;
  const state = reduceStream(emptyProjection(), notice);
  expect(state.mcpRevision).toBe(1);
  expect(state.skillsRevision).toBe(0);
  expect(state.environmentsRevision).toBe(0);
  expect(reduceStream(state, notice).mcpRevision).toBe(1);
  expect(resetWorkspace(state, { workspace: { id, version: 1, name: '项目', directory_resource_id: null },
    sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]),
    resources: page([]), grants: page([]), watermark: '12' }).mcpRevision).toBe(2);
});

it('D 能力库接入 MCP 页签，并在 MCP 编辑时保持用户确认流程', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).includes('/mcp') ? mcpPage([mcpView]) :
    { items: [], next_cursor: null, watermark: '0' })));
  render(<CapabilityLibrary client={new RuntimeClient(mcpConnection)} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('tab', { name: 'MCP' }));
  await screen.findByRole('button', { name: /Local Notes/ });
  fireEvent.click(screen.getByRole('button', { name: '编辑配置' }));
  expect(screen.getByRole('tab', { name: 'Skills' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '返回对话与草稿' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '取消配置' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Skills' })).toHaveProperty('disabled', false));
});

it('外窗通知刷新 MCP 列表，编辑未确认内容跨失效保留且取消后取新版本', async () => {
  let revision = 1;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(mcpPage([{
    ...mcpView, config: { ...mcpView.config, revision },
  }]))));
  const client = new McpClient(mcpConnection);
  const view = render(<McpPanel client={client} refreshKey={0} />);
  await screen.findByText('配置修订 1');
  fireEvent.click(screen.getByRole('button', { name: '编辑配置' }));
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '未确认本机草稿' } });
  revision = 2;
  await act(async () => view.rerender(<McpPanel client={client} refreshKey={1} />));
  expect(screen.getByLabelText('名称')).toHaveProperty('value', '未确认本机草稿');
  fireEvent.click(screen.getByRole('button', { name: '取消配置' }));
  await screen.findByText('配置修订 2');
});

it('能力库已打开时接收新的 MCP 导航仍定位页签，当前编辑先明确取消', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).includes('/mcp') ? mcpPage([mcpView]) :
    { items: [], next_cursor: null, watermark: '0' })));
  const client = new RuntimeClient(mcpConnection), close = () => {};
  const view = render(<CapabilityLibrary client={client} onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: '创建 Skill' }));
  fireEvent.change(screen.getByLabelText('包目录名'), { target: { value: '保留本地候选' } });
  const target = { server_id: mcpView.config.id, workspace_id: null };
  view.rerender(<CapabilityLibrary client={client} onClose={close} mcpTarget={target} />);
  expect(screen.getByLabelText('包目录名')).toHaveProperty('value', '保留本地候选');
  fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'MCP' }).getAttribute('aria-selected')).toBe('true'));
  await screen.findByRole('button', { name: /Local Notes/ });
});
