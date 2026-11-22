import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { InboxPage, PendingAction, RunSnapshot } from '../../generated/contracts';
import { agent, connection, event, id, limits, model, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import { Conversation } from './Conversation';
import McpQueryRecovery from './McpQueryRecovery';

afterEach(() => vi.unstubAllGlobals());

it('同版本查询恢复动作在复查期间仍可点击，服务端取消动作后移除', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 4 });
  const interrupted: RunSnapshot = { ...run, state: 'interrupted', version: 7, reason: 'mcp_query_uncertain' };
  const recovery: PendingAction = { id, kind: 'recovery', workspace_id: id, session_id: id, run_id: id,
    task_id: run.root_task_id, version: 7, reason: 'mcp_query_uncertain',
    allowed_actions: [{ kind: 'resume', target_id: id, expected_version: 7 }] };
  let release!: (value: InboxPage) => void;
  const refresh = new Promise<InboxPage>(resolve => { release = resolve; });
  vi.spyOn(client, 'inbox').mockResolvedValueOnce(page([recovery])).mockReturnValueOnce(refresh);
  const onResume = vi.fn();
  const card = (revision: string) => <McpQueryRecovery client={client} run={interrupted} busy={false}
    revision={revision} onResume={onResume} onInspect={() => {}} />;
  const view = render(card('1'));
  const resume = await screen.findByRole('button', { name: '按已有材料继续' });
  view.rerender(card('2'));
  await userEvent.click(resume);
  expect(onResume).toHaveBeenCalledExactlyOnceWith(7);

  await act(async () => release(page([{ ...recovery, allowed_actions: [] }])));
  expect(screen.queryByRole('button', { name: '按已有材料继续' })).toBeNull();
});

it.each([
  [false, 'waiting_user', false], [true, 'waiting_user', false],
  [false, 'blocked_incompatible', false], [true, 'blocked_incompatible', false],
  [false, 'waiting_user', true], [true, 'waiting_user', true],
  [false, 'interrupted', false], [true, 'interrupted', false],
  [false, 'interrupted', false, true],
] as const)('compact=%s 暂停=%s 有问题=%s 恢复仍绑定固定Run并保留草稿', async (compact, state, hasQuestion, retryReadonly: boolean = false) => {
  const interrupted = state === 'interrupted';
  let current: RunSnapshot = { ...run, state, version: 7, reason: interrupted ? 'mcp_query_uncertain' :
    state === 'blocked_incompatible' ? 'executor_version_unavailable' : 'source_invalid' };
  const writes: { path: string; query: string; body: unknown }[] = [];
  const workspace = { id, version: 1, name: '合成项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '条件暂停', agent_profile_id: id, kind: 'interaction', archived: false };
  const question = { id: secondId, version: 1, run_id: id, task_id: run.root_task_id, call_id: 'ask', message_id: id,
    question: '请选择范围', answer_schema: { type: 'string' }, status: 'pending' as const, answer_message_id: null, dependencies: [] };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v4', '');
    if (init.method === 'POST') {
      writes.push({ path, query: new URL(url).search, body: JSON.parse(init.body as string) });
      current = { ...current, state: 'running', version: 8, reason: null }; return Response.json(current);
    }
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return Response.json(page([]));
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([agent]), '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 1, watermark: event.event_id },
      '/inbox': page(current.state === 'running' ? [] : hasQuestion ? [{ id: question.id, kind: 'question', workspace_id: id, session_id: id, run_id: id, question }] : [{
        id, kind: state === 'blocked_incompatible' ? 'blocked' : 'recovery', workspace_id: id, session_id: id, run_id: id, task_id: run.root_task_id, version: 3,
        reason: retryReadonly ? 'mcp_query_uncertain_retry_available' : current.reason,
        allowed_actions: state === 'blocked_incompatible' ? [{ kind: 'view_task', target_id: id, expected_version: null }] : [{ kind: 'resume', target_id: id, expected_version: 7 }],
      }]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([current]), pending_questions: page(hasQuestion ? [question] : []), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/runs`]: page([current]), [`/sessions/${id}/messages`]: page([]), [`/runs/${id}/export-recovery`]: [],
      [`/runs/${id}`]: { ...runDetailSummary, run: current, tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]), questions: page(hasQuestion ? [question] : []), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
        budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, task_count: 1, steps: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id },
    };
    return Response.json(values[path]);
  });
  const user = userEvent.setup();
  render(<Conversation compact={compact} client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 4 })} />);
  if (interrupted) {
    await screen.findByText(/查询已发送，未收到结果/);
  } else {
    await screen.findByText(/可在待办中查看处理方式/);
  }
  if (!hasQuestion && state !== 'blocked_incompatible') await user.type(screen.getByLabelText('消息'), '保留后续草稿');
  if (!interrupted) await user.click(screen.getByTitle('待办'));
  if (hasQuestion || state === 'blocked_incompatible') {
    if (hasQuestion) await screen.findByLabelText('回答');
    expect(screen.queryByRole('button', { name: '恢复本任务中的条件等待' })).toBeNull();
    return;
  }
  const label = retryReadonly ? '另发一次只读查询' : interrupted ? '按已有材料继续' : '恢复本任务中的条件等待';
  await user.click(await screen.findByRole('button', { name: label }));
  await waitFor(() => expect(screen.queryByRole('button', { name: label })).toBeNull());
  expect(writes).toEqual([{ path: `/runs/${id}/resume`, query: retryReadonly ? '?retry_readonly=true' : '',
    body: { command_id: expect.any(String), expected_version: 7 } }]);
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('保留后续草稿');
  expect(current.deadline_at).toBe(run.deadline_at);
});
