import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { RunSnapshot } from '../../generated/contracts';
import { agent, connection, event, id, limits, model, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import { Conversation } from './Conversation';

afterEach(() => vi.unstubAllGlobals());

it.each([
  [false, 'waiting_user', false], [true, 'waiting_user', false],
  [false, 'blocked_incompatible', false], [true, 'blocked_incompatible', false],
  [false, 'waiting_user', true], [true, 'waiting_user', true],
] as const)('compact=%s 暂停=%s 有问题=%s 只对条件暂停显式重新检查，保留草稿及固定Run', async (compact, state, hasQuestion) => {
  let current: RunSnapshot = { ...run, state, version: 7, reason: state === 'blocked_incompatible' ? 'executor_version_unavailable' : 'source_invalid' };
  const writes: { path: string; body: unknown }[] = [];
  const workspace = { id, version: 1, name: '合成项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '条件暂停', agent_profile_id: id };
  const question = { id: secondId, version: 1, run_id: id, task_id: run.root_task_id, call_id: 'ask', message_id: id,
    question: '请选择范围', answer_schema: { type: 'string' }, status: 'pending' as const, answer_message_id: null, dependencies: [] };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v2', '');
    if (init.method === 'POST') {
      writes.push({ path, body: JSON.parse(init.body as string) });
      current = { ...current, state: 'running', version: 8, reason: null }; return Response.json(current);
    }
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([agent]), '/models': page([model]), '/model-connections': page([connection]),
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([current]), pending_questions: page(hasQuestion ? [question] : []), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/runs`]: page([current]), [`/sessions/${id}/messages`]: page([]), [`/runs/${id}/export-recovery`]: [],
      [`/runs/${id}`]: { ...runDetailSummary, run: current, tasks: page([]), activities: page([]), messages: page([]), artifacts: page([]), questions: page(hasQuestion ? [question] : []), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
        budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, task_count: 1, steps: 1 }, watermark: event.event_id },
    };
    return Response.json(values[path]);
  });
  const user = userEvent.setup();
  render(<Conversation compact={compact} client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test-token', protocol_version: 2 })} />);
  await screen.findByText(current.reason!);
  if (hasQuestion) {
    await screen.findByLabelText('回答');
    expect(screen.queryByRole('button', { name: '重新检查并继续' })).toBeNull();
    return;
  }
  await user.type(screen.getByLabelText('消息'), '保留后续草稿');
  await user.click(screen.getByRole('button', { name: '重新检查并继续' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重新检查并继续' })).toBeNull());
  expect(writes).toEqual([{ path: `/runs/${id}/resume`, body: { command_id: expect.any(String), expected_version: 7 } }]);
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('保留后续草稿');
  expect(current.deadline_at).toBe(run.deadline_at);
});
