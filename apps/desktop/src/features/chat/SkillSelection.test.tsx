import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { agent, connection, event, id, limits, model, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import { createDraftStore } from '../../state/draft-store';
import { Conversation } from './Conversation';
import type { SkillView } from '../../generated/contracts';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
const hash = 'a'.repeat(64);
const scope = { kind: 'workspace' as const, workspace_id: id, session_id: null };
export const skill: SkillView = { version: { skill_id: secondId, content_hash: hash, directory_name: 'release-note', name: 'release-note',
  description: '整理真实发布说明', metadata: {}, license: null, compatibility: null, allowed_tools: null, files: [],
  source: { kind: 'user_created', command_id: id, base_hash: null, resource_id: null, resource_version: null,
    source_version: null, run_id: null, task_id: null, activity_id: null, attempt_id: null }, scope, dependencies: [] },
  binding: { id, skill_id: secondId, scope, enabled: true, environment_id: null, environment_revision: null, revision: 1 },
  readiness: 'content_available' };

function server(active = false) {
  const writes: { path: string; body: any }[] = [];
  let finish: ((response: Response) => void) | undefined;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path === '/capabilities/skills/resolve') return new Promise<Response>(resolve => { finish = resolve; });
    if (init.method === 'POST') { writes.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json(path.endsWith('/steering') ? { message_id: id, run_id: id, version: 2 } : run); }
    if (path === '/capabilities/skills') return Response.json(page([skill]));
    if (path === '/capabilities/skill-exports') return Response.json([]);
    if (path.endsWith('/file')) return Response.json({ skill_id: secondId, content_hash: hash, path: 'SKILL.md',
      file_hash: hash, encoding: 'utf-8', content: '正文', start: 0, end: 2, total: 2 });
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/directory')) return Response.json({ workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null });
    if (path.endsWith('/commands') || path.endsWith('/follow-ups') || path.endsWith('/messages')) return Response.json(page([]));
    if (path.endsWith('/export-recovery')) return Response.json([]);
    const values: Record<string, unknown> = {
      '/workspaces': page([{ id, version: 1, name: '项目', directory_resource_id: null }]),
      '/profiles': page([{ ...agent, default_model_profile_id: model.id }]), '/models': page([model]), '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([]), recent_sessions: page([]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/snapshot`]: { workspace: { id, version: 1, name: '项目', directory_resource_id: null },
        sessions: page([{ id, version: 1, workspace_id: id, title: '会话甲', agent_profile_id: id, kind: 'interaction', archived: false },
          { id: secondId, version: 1, workspace_id: id, title: '会话乙', agent_profile_id: id, kind: 'interaction', archived: false }]),
        active_runs: page(active ? [run] : []), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/runs`]: page(active ? [run] : []), [`/sessions/${secondId}/runs`]: page([]),
      [`/runs/${id}`]: { ...runDetailSummary, run, tasks: page([{ id: run.root_task_id, version: 1, run_id: id, kind: 'agent', executor_id: 'builtin.agent',
        binding: { agent_work: null, input_artifacts: [], input_result: null, config: run.config, sources: run.sources,
          execution_session_id: id, interaction_session_id: id, delegation_depth: 0 }, parent_task_id: null, origin_task_id: null,
        state: 'running', reason: null, created_seq: 1, deadline_at: null, result_version: null }]),
        activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
        budget: { id: run.budget_id, run_id: id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0,
          steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: event.event_id },
    };
    if (!(path in values)) throw new Error(`未定义 ${path}`);
    return Response.json(values[path]);
  });
  return { writes, complete: async () => { await waitFor(() => expect(finish).toBeTruthy()); await act(async () => finish!(Response.json({
    versions: { [secondId]: hash }, dependencies: [], entries: [{ skill_id: secondId, content_hash: hash, name: 'release-note', description: '整理真实发布说明' }],
  }))); } };
}
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });

it('能力库异步选择固定打开时会话；切换后只更新原key且名称/版本可移除', { timeout: 15_000 }, async () => {
  const api = server(), drafts = createDraftStore(), user = userEvent.setup();
  render(<Conversation client={client()} draftStore={drafts} />);
  await screen.findByRole('heading', { name: '会话甲' });
  await user.click(screen.getByRole('button', { name: '选择 Skill' }));
  await user.click(await screen.findByRole('button', { name: '用于原会话的新目标' }));
  expect((screen.getByRole('button', { name: '返回对话与草稿' }) as HTMLButtonElement).disabled).toBe(true);
  await api.complete();
  expect(drafts.read({ workspaceId: id, sessionId: id }).skillVersions).toEqual({ [secondId]: hash });
  expect(drafts.read({ workspaceId: id, sessionId: secondId }).skillVersions).toEqual({});
  expect(await screen.findByText(/release-note · aaaaaaaaaaaa/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '移除 Skill release-note' }));
  expect(drafts.read({ workspaceId: id, sessionId: id }).skillVersions).toEqual({});
});

it('steering保留新目标Skills且请求只有文字，主小窗草稿互不覆盖', async () => {
  const api = server(true), drafts = createDraftStore(), quickDrafts = createDraftStore();
  drafts.update({ workspaceId: id, sessionId: id }, { skillVersions: { [secondId]: hash }, text: '补充原运行' });
  const user = userEvent.setup(), main = render(<Conversation client={client()} draftStore={drafts} />);
  const quick = render(<Conversation compact client={client()} draftStore={quickDrafts} />);
  await within(main.container).findByRole('button', { name: '补充指令' });
  await user.click(within(main.container).getByRole('button', { name: '补充指令' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0].body.data).toEqual({ text: '补充原运行' });
  expect(drafts.read({ workspaceId: id, sessionId: id }).skillVersions).toEqual({ [secondId]: hash });
  expect(quickDrafts.read({ workspaceId: id, sessionId: id }).skillVersions).toEqual({});
  expect(within(quick.container).queryByText(/release-note · aaaaaaaaaaaa/)).toBeNull();
});
