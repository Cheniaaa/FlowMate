import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { ContextUsageSummary, RunDetail } from '../../generated/contracts';
import { agent, connection, contextUsage, event, id, limits, model, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import { Conversation } from './Conversation';
import { invoke } from '@tauri-apps/api/core';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function server(usage: ContextUsageSummary) {
  const reads: string[] = [];
  const state = usage.compaction_state === 'blocked' ? 'waiting_user' as const : 'running' as const;
  const currentRun = { ...run, state, reason: usage.compaction_reason };
  const root = { id: run.root_task_id, version: 1, run_id: id, kind: 'agent' as const, executor_id: 'builtin.agent',
    parent_task_id: null, origin_task_id: null, created_seq: 1, deadline_at: null, result_version: null, reason: usage.compaction_reason,
    state, binding: { agent_work: null, input_artifacts: [], input_result: null, config: run.config,
      sources: run.sources, execution_session_id: id, interaction_session_id: id, delegation_depth: 0 } };
  const detail: RunDetail = { ...runDetailSummary, run: currentRun, context_usage: usage, tasks: page([root]), activities: page([]), messages: page([]),
    artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
    budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', steps: 0, model_requests: 0,
      task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id };
  const workspace = { id, version: 1, name: '上下文项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '原上下文目标', agent_profile_id: id, kind: 'interaction', archived: false };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', ''); reads.push(path);
    if (init.method && init.method !== 'GET') throw new Error('查看状态不应重交、恢复或授权');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/messages') || path.endsWith('/results')) return Response.json(page([]));
    if (path.endsWith('/export-recovery')) return Response.json([]);
    if (path === `/runs/${id}`) return Response.json(detail);
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([{ ...agent, default_model_profile_id: model.id }]), '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      '/tasks': page([]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([currentRun]), pending_questions: page([]), pending_approvals: page([]),
        resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/runs`]: page([currentRun]),
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null },
    };
    if (!(path in values)) throw new Error(`未定义 ${path}`);
    return Response.json(values[path]);
  });
  return reads;
}

it.each([
  ['running', '正在压缩上下文', null],
  ['committed', '已采用上下文摘要', null],
  ['blocked', '上下文压缩受阻', 'context_limit'],
  ['invalidated', '上下文压缩已失效', 'source_changed'],
] as const)('真实RunDetail的%s经RuntimeClient/Store到页面，父级不屏蔽零省略', async (compaction_state, title, compaction_reason) => {
  const reads = server({ ...contextUsage, activity_id: compaction_state === 'running' ? secondId : null,
    state: compaction_state === 'running' ? 'prepared' : null, compaction_state, compaction_reason,
    summary_count: compaction_state === 'committed' ? 1 : 0, compacted_message_count: compaction_state === 'committed' ? 20 : 0 });
  const user = userEvent.setup();
  render(<Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 })} />);
  const notice = await screen.findByRole('complementary', { name: '历史使用说明' });
  expect(within(notice).getByText(title)).toBeTruthy();
  expect(reads).toContain(`/runs/${id}`);
  expect(document.querySelectorAll('.context-notice')).toHaveLength(1);
  expect(screen.queryByRole('alert')).toBeNull();
  if (compaction_state === 'blocked') {
    await user.click(within(notice).getByText(title));
    await user.click(within(notice).getByRole('button', { name: '查看原运行与待办' }));
    expect((await screen.findByRole('region', { name: '任务详情' })).textContent).toContain(id);
  }
});

it('小窗同样显示零省略/无Activity阻塞，既有Task导航使用RunDetail真实根任务，原输入保留', async () => {
  server({ ...contextUsage, compaction_state: 'blocked', compaction_reason: 'context_authorization_required' });
  const user = userEvent.setup();
  render(<Conversation compact client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 })} />);
  const notice = await screen.findByRole('complementary', { name: '历史使用说明' });
  const input = screen.getByLabelText('消息'); await user.type(input, '保留的原对话输入');
  await user.click(within(notice).getByText('上下文压缩受阻'));
  expect(within(notice).getByText(/context_authorization_required/)).toBeTruthy();
  await user.click(within(notice).getByRole('button', { name: '查看原运行与待办' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('show_workbench', { target: { kind: 'task', task_id: run.root_task_id } }));
  expect((input as HTMLTextAreaElement).value).toBe('保留的原对话输入');
});
