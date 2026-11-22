import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import type { ActivityView, SessionContext, SessionContextSchema, SessionContextUsage, TaskSnapshot } from '../../generated/contracts';
import { binding, contextUsage, id, limits, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import { createRuntimeStore } from '../../state/runtime-store';
import ContextPanel from '../chat/ContextPanel';
import SelectedStep from '../tasks/SelectedStep';
import { buildTaskGraph } from '../tasks/graph-layout';
import { TracePanel } from '../trace/TracePanel';
import TaskDetail from '../tasks/TaskDetail';

afterEach(() => vi.unstubAllGlobals());
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 });
const vector: SessionContextSchema.ContextActivity = { id, kind: 'embedding', embedding_kind: 'query',
  model: '相同显示名', input_tokens: null, output_tokens: null, cached_input_tokens: null,
  input_limit: null, calculated_units: null, compaction: false,
  files: [], hidden_file_count: 0, file_changed: false, state: 'succeeded' };
const context: SessionContext = { round: { run_id: id, state: 'completed', source_attention: false },
  files: [], hidden_file_count: 0, knowledge: [], hidden_knowledge_count: 0,
  history: contextUsage, latest_request: null, activities: page([vector]), units_per_currency: '1000000' };
const usage: SessionContextUsage = { requests: 0, input_tokens: 0, output_tokens: 0, input_reported_requests: 0,
  output_reported_requests: 0, cached_input_tokens: 0, cache_reported_requests: 0, cache_reported_input_tokens: 0,
  cached_tokens_with_reported_input: 0, calculated_units: '2000', pending_cost_requests: 0, unknown_cost_requests: 0,
  embedding_requests: 2, embedding_input_tokens: 12, embedding_input_reported_requests: 1,
  embedding_calculated_units: '2000', embedding_pending_cost_requests: 0, embedding_unknown_cost_requests: 1,
  units_per_currency: '1000000' };

it('上下文向量用量单列，未知输入/费用不作零，纯向量费用不会被生成次数隐藏', async () => {
  vi.stubGlobal('fetch', async (url: string) => Response.json(url.endsWith('/usage') ? usage : context));
  render(<ContextPanel client={client()} sessionId={id} revision="1" accountingRevision="0" authorization="1"
    onInspect={vi.fn()} onResources={vi.fn()} onUseFileVersion={vi.fn()} fileSelectionDisabled={false} />);
  const vectors = await screen.findByRole('region', { name: '本轮向量用量' });
  expect(within(vectors).getByText('资料检索向量')).toBeTruthy();
  expect(within(vectors).getByText('相同显示名')).toBeTruthy();
  expect(within(vectors).queryByText(/输入容量|缓存|输出/)).toBeNull();
  expect(within(vectors).getAllByText('未报告').length).toBeGreaterThan(0);
  expect(within(vectors).getByText('费用未知')).toBeTruthy();
  await userEvent.click(screen.getByText('会话用量与费用'));
  const cumulative = await screen.findByRole('region', { name: '会话向量用量' });
  expect(cumulative.textContent).toContain('2 次');
  expect(cumulative.textContent).toContain('12 tokens');
  expect(cumulative.textContent).toContain('1/2 次已报告');
  expect(cumulative.textContent).toContain('$0.002');
  expect(cumulative.textContent).not.toContain('云请求');
  expect(screen.getAllByText('$0.002').length).toBeGreaterThan(1);
});

it.each(['model', 'tool'] as const)('真实 %s 槽位的向量活动在图/Trace/所选步骤不冒充生成配置', kind => {
  const activity: ActivityView = { id, run_id: run.id, task_id: secondId, version: 1, kind,
    operation: 'embedding.document', state: 'succeeded', actual_units: '15', dependencies: [], error: null,
    usage: { input_tokens: 10, output_tokens: 0, cached_input_tokens: null, cache_write_tokens: null,
      cache_write_1h_tokens: null, source: 'provider_wire', status: 'known' }, script_execution: null };
  const task: TaskSnapshot = { id: secondId, run_id: run.id, version: 1, kind: 'agent', executor_id: 'builtin.agent',
    parent_task_id: null, origin_task_id: null, created_seq: 1, deadline_at: null, result_version: null,
    state: 'completed', reason: null, binding };
  expect(buildTaskGraph([task], [activity], [], [], [], new Set()).nodes.find(node => node.id === id)?.label).toBe('资料处理向量');
  render(<><SelectedStep id={id} tasks={[task]} activities={[activity]} />
    <TracePanel events={[{ event_id: '1', kind: 'activity.received', seq: 1, task_id: secondId, activity_id: id, activities: [activity] }]} /></>);
  expect(within(screen.getByRole('region', { name: '所选步骤' })).queryByText(`模型 ${run.config.model_profile.model_id}`)).toBeNull();
  expect(within(screen.getByRole('region', { name: '所选步骤' })).queryByText('输出 Token 0')).toBeNull();
  expect(screen.queryByText('模型回复')).toBeNull();
  expect(screen.getAllByText('资料处理向量')).toHaveLength(2);
});

it('确定性资料任务展示真实费用和预算，不读取不存在的生成配置', async () => {
  const runtime = client(), deterministic = { ...run, kind: 'knowledge', state: 'completed', interaction_session_id: null,
    config: { kind: 'deterministic', catalog: run.config.catalog } };
  vi.stubGlobal('fetch', async (url: string) => url.endsWith('/events') ? new Response(new ReadableStream()) : Response.json({
    ...runDetailSummary, run: deterministic, tasks: page([]), activities: page([]), messages: page([]),
    questions: page([]), approvals: page([]), artifacts: page([]), waits: page([]), consumptions: page([]), joins: page([]),
    cost_summary: { ...runDetailSummary.cost_summary, calculated_units: '2000', unknown_request_count: 1 },
    watermark: '9007199254740993',
    budget: { id, run_id: id, version: 1, limits, steps: 1, model_requests: 1, task_count: 1,
      total_tokens: 10, reserved_tokens: 0, spent_units: '2000', reserved_units: '0' },
  }));
  render(<TaskDetail client={runtime} store={createRuntimeStore(runtime)} runId={id}
    onCommand={vi.fn()} onQuestion={vi.fn()} onOpen={vi.fn()} />);
  const budget = await screen.findByRole('region', { name: '运行预算' });
  expect(budget.textContent).toContain('已知部分');
  expect(budget.textContent).toContain('待确认费用');
  expect(screen.queryByText(/模型：/)).toBeNull();
});
