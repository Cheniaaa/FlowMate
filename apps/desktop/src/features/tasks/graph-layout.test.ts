import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ActivityView, Approval, JoinFact, Question, ResultConsumption, TaskSnapshot, TracePageSchema, WaitRecord,
} from '../../generated/contracts';
import { binding, event, run } from '../../test/fixtures';
import { buildTaskGraph } from './graph-layout';
import { TaskGraph } from './TaskGraph';
import { TaskList } from './TaskList';
import { TracePanel } from '../trace/TracePanel';
import { Inbox } from '../notifications/Inbox';

const rootId = '10000000-0000-4000-8000-000000000001';
const childId = '10000000-0000-4000-8000-000000000002';
const siblingId = '10000000-0000-4000-8000-000000000003';
const leafId = '10000000-0000-4000-8000-000000000004';
const missingId = '10000000-0000-4000-8000-000000000099';
const resolvedWaitId = '30000000-0000-4000-8000-000000000002';
const activityId = '20000000-0000-4000-8000-000000000002';
const earlierActivityId = '20000000-0000-4000-8000-000000000001';
const root: TaskSnapshot = {
  binding,
  id: rootId, run_id: run.id, version: 7, created_seq: 1, parent_task_id: null, origin_task_id: null,
  kind: 'agent', executor_id: 'builtin.agent', state: 'waiting_children', deadline_at: null,
  result_version: null, reason: null,
};
const child: TaskSnapshot = {
  binding,
  id: childId, run_id: run.id, version: 9, created_seq: 2, parent_task_id: rootId, origin_task_id: rootId,
  kind: 'tool', executor_id: 'files.read', state: 'completed', deadline_at: null, result_version: 3, reason: null,
};
const sibling: TaskSnapshot = {
  binding: { ...binding, execution_session_id: siblingId },
  id: siblingId, run_id: run.id, version: 1, created_seq: 3, parent_task_id: rootId, origin_task_id: childId,
  kind: 'agent', executor_id: 'builtin.agent', state: 'running', deadline_at: null, result_version: null, reason: null,
};
const leaf: TaskSnapshot = {
  binding,
  id: leafId, run_id: run.id, version: 1, created_seq: 4, parent_task_id: childId, origin_task_id: childId,
  kind: 'tool', executor_id: 'files.list', state: 'cancelled', deadline_at: null, result_version: 1, reason: null,
};
const activity: ActivityView = {
  id: activityId, run_id: run.id, task_id: childId, version: 2, kind: 'tool', operation: 'files.read',
  state: 'uncertain', actual_units: null, dependencies: [], error: null, usage: null, script_execution: null,
};
const wait: WaitRecord = {
  id: '30000000-0000-4000-8000-000000000001', run_id: run.id, version: 1, owner_task_id: rootId,
  target_task_id: childId, continuation_id: 'wait-continuation', state: 'pending', deadline_at: null, result_version: null,
};
const consumption: ResultConsumption = {
  inbox_entry_id: null,
  execution_session_id: run.execution_session_id,
  id: '40000000-0000-4000-8000-000000000001', run_id: run.id, task_id: rootId,
  target_task_id: childId, result_version: 2, message_boundary: 4,
};
const join: JoinFact = {
  id: '50000000-0000-4000-8000-000000000001', run_id: run.id, root_task_id: rootId,
  child_task_id: childId, child_result_version: 3, event_id: '9007199254740994',
};
const question: Question = {
  id: '60000000-0000-4000-8000-000000000001', version: 1, run_id: run.id, task_id: rootId,
  call_id: 'ask-1', message_id: rootId, question: '报告需要什么范围？', answer_schema: { type: 'string' },
  status: 'pending', answer_message_id: null, dependencies: [],
};
const approval: Approval = {
  mcp: null,
  id: '70000000-0000-4000-8000-000000000001', version: 1, workspace_id: run.workspace_id,
  session_id: run.interaction_session_id, run_id: run.id, task_id: childId, activity_id: activityId, call_id: 'export-1',
  tool_name: 'artifacts.export', tool_version: '1', args_hash: 'abc', target: childId,
  export_preview: { target_path: 'C:\\Synthetic\\report.md', target_exists: false, artifact_id: rootId, artifact_version: 1 },
  parameters: { target_ref: missingId }, dependencies: [], expires_at: '2026-11-07T13:00:00Z', status: 'pending',
};
const noCollapse = new Set<string>();

describe('真实 Task/Activity 图布局', () => {
  it('空集合不制造节点或边', () => {
    expect(buildTaskGraph([], [], [], [], [], noCollapse)).toEqual({ nodes: [], edges: [] });
  });

  it('父关系只取 parent_task_id，Activity 是独立实体而不是 Task 或猜测出来的分支', () => {
    const model = buildTaskGraph([root, child, sibling], [activity], [], [], [], noCollapse);
    expect(model.nodes.map(node => [node.id, node.entity_kind, node.state])).toEqual([
      [rootId, 'task', 'waiting_children'], [childId, 'task', 'completed'],
      [activityId, 'activity', 'uncertain'], [siblingId, 'task', 'running'],
    ]);
    expect(model.edges.map(edge => [edge.kind, edge.from, edge.to])).toEqual([
      ['parent', rootId, childId], ['parent', rootId, siblingId], ['parent', childId, activityId],
    ]);
    expect(model.nodes.find(node => node.id === activityId)?.label).toBe('工具调用');
    expect(model.nodes.find(node => node.id === activityId)?.x).toBeGreaterThan(model.nodes.find(node => node.id === childId)!.x);
  });

  it('operation 中的聊天式文字和 scope dependencies 不会被猜成依赖或时序边', () => {
    const model = buildTaskGraph([root, { ...child, parent_task_id: null }], [{ ...activity,
      operation: `等待 ${rootId} 然后 join`, dependencies: [{ scope_id: rootId, epoch: 1 }],
    }], [], [], [], noCollapse);
    expect(model.edges.map(edge => [edge.kind, edge.from, edge.to])).toEqual([['parent', childId, activityId]]);
  });

  it('wait 为 owner→target、consumed 为 target→consumer，仅 pending wait 活跃且保留旧版本消费事实', () => {
    const model = buildTaskGraph([root, child], [], [wait, { ...wait, id: resolvedWaitId, state: 'ready', result_version: 3 }],
      [consumption], [], noCollapse);
    expect(model.edges.filter(edge => edge.kind !== 'parent')).toEqual([
      { id: `wait:${wait.id}`, kind: 'wait', from: rootId, to: childId, active: true },
      { id: `wait:${resolvedWaitId}`, kind: 'wait', from: rootId, to: childId, active: false },
      { id: `consumed:${consumption.id}`, kind: 'consumed', from: childId, to: rootId },
    ]);
  });

  it('join 为 child→root 且精确匹配 child.result_version，不误用 snapshot version 或过期结果', () => {
    const model = buildTaskGraph([root, child], [], [], [], [join,
      { ...join, id: missingId, child_result_version: 9 },
      { ...join, id: leafId, child_result_version: 2 },
    ], noCollapse);
    expect(model.edges.filter(edge => edge.kind === 'join')).toEqual([
      { id: `join:${join.id}`, kind: 'join', from: childId, to: rootId },
    ]);
  });

  it('相同持久事实 ID 只画一条，不合并不同 ID 的真实记录', () => {
    const model = buildTaskGraph([root, child], [], [wait, wait], [consumption, consumption], [join, join], noCollapse);
    expect(model.edges.filter(edge => edge.kind !== 'parent').map(edge => edge.id)).toEqual([
      `wait:${wait.id}`, `consumed:${consumption.id}`, `join:${join.id}`,
    ]);
  });

  it('Task 按 created_seq 再按 ID，Activity 在所属 Task 下按 ID 稳定展示而非宣称创建时间', () => {
    const tasks = [sibling, { ...child, created_seq: 3 }, root];
    const activities = [activity, { ...activity, id: earlierActivityId }];
    const model = buildTaskGraph(tasks, activities, [wait], [consumption], [join], noCollapse);
    expect(model.nodes.map(node => node.id)).toEqual([rootId, childId, earlierActivityId, activityId, siblingId]);
    expect(buildTaskGraph([...tasks].reverse(), [...activities].reverse(), [wait], [consumption], [join], noCollapse)).toEqual(model);
    expect(tasks.map(task => task.id)).toEqual([siblingId, childId, rootId]);
    expect(activities.map(item => item.id)).toEqual([activityId, earlierActivityId]);
  });

  it('所有事实页输入乱序时完整节点和边顺序相同，持久边 ID 不随分页次序漂移', () => {
    const waits = [wait, { ...wait, id: resolvedWaitId, owner_task_id: siblingId }];
    const consumptions = [consumption, { ...consumption, id: '40000000-0000-4000-8000-000000000002', task_id: siblingId }];
    const joins = [join, { ...join, id: '50000000-0000-4000-8000-000000000002' }];
    const model = buildTaskGraph([root, child, sibling], [activity], waits, consumptions, joins, noCollapse);
    expect(model.edges.filter(edge => edge.kind !== 'parent').map(edge => edge.id)).toEqual([
      `wait:${wait.id}`, `wait:${resolvedWaitId}`, `consumed:${consumption.id}`,
      'consumed:40000000-0000-4000-8000-000000000002', `join:${join.id}`, 'join:50000000-0000-4000-8000-000000000002',
    ]);
    expect(buildTaskGraph([sibling, child, root], [activity], [...waits].reverse(), [...consumptions].reverse(),
      [...joins].reverse(), noCollapse)).toEqual(model);
  });

  it('折叠隐藏整个后代子树和所属 Activity，未隐藏节点位置与完整图相同', () => {
    const tasks = [root, child, sibling, leaf];
    const full = buildTaskGraph(tasks, [activity], [wait], [consumption], [join], noCollapse);
    const collapsed = buildTaskGraph(tasks, [activity], [wait], [consumption], [join], new Set([childId]));
    expect(collapsed.nodes.map(node => node.id)).toEqual([rootId, childId, siblingId]);
    expect(collapsed.nodes).toEqual(full.nodes.filter(node => [rootId, childId, siblingId].includes(node.id)));
    expect(collapsed.edges.some(edge => edge.from === activityId || edge.to === leafId)).toBe(false);
    const collapsedRoot = buildTaskGraph(tasks, [activity], [wait], [consumption], [join], new Set([rootId]));
    expect(collapsedRoot.nodes.map(node => node.id)).toEqual([rootId]);
    expect(collapsedRoot.edges).toEqual([]);
  });

  it('分页缺少 parent 或依赖端点时不制造伪节点，不连不存在的边', () => {
    const model = buildTaskGraph([{ ...child, parent_task_id: missingId }], [{ ...activity, task_id: missingId }],
      [wait], [consumption], [join], noCollapse);
    expect(model.nodes.map(node => node.id)).toEqual([childId, activityId]);
    expect(model.edges).toEqual([]);
  });

  it('只有正在运行的父连接和 dispatched Activity 连接可标成活跃，终态不动效', () => {
    const model = buildTaskGraph([root, child, sibling], [activity,
      { ...activity, id: earlierActivityId, task_id: siblingId, state: 'dispatched' },
    ], [], [consumption], [join], noCollapse);
    expect(model.edges.filter(edge => edge.active).map(edge => [edge.from, edge.to])).toEqual([
      [rootId, siblingId], [siblingId, earlierActivityId],
    ]);
  });
});

describe('TaskGraph 和 TaskList 可访问交互', () => {
  const props = { tasks: [root, child], activities: [activity], waits: [wait], consumptions: [consumption],
    joins: [join], collapsedIds: noCollapse };

  it('SVG 节点可点击或用 Enter/Space 选择，区分 task/activity 并呈现文字状态', () => {
    const onSelect = vi.fn();
    render(createElement(TaskGraph, { ...props, selectedId: activityId, onSelect, onToggle: vi.fn() }));
    const selected = screen.getByRole('button', { name: new RegExp(`过程.*${activityId}.*结果不确定`) });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(selected.classList.contains('graph-node--selected')).toBe(true);
    fireEvent.keyDown(selected, { key: 'Enter' });
    fireEvent.keyDown(selected, { key: ' ' });
    fireEvent.click(selected);
    fireEvent.keyDown(selected, { key: 'ArrowDown' });
    expect(onSelect.mock.calls).toEqual([[activityId, 'activity'], [activityId, 'activity'], [activityId, 'activity']]);
    expect(screen.getByRole('button', { name: new RegExp(`任务.*${rootId}.*等待子任务`) }).getAttribute('tabindex')).toBe('0');
  });

  it('折叠控制带 aria-expanded，不触发选择；折叠由 props 驱动', () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const { rerender } = render(createElement(TaskGraph, { ...props, onSelect, onToggle }));
    const toggle = screen.getByRole('button', { name: `折叠任务 ${rootId}` });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(toggle, { key: ' ' });
    fireEvent.click(toggle);
    expect(onToggle.mock.calls).toEqual([[rootId], [rootId]]);
    expect(onSelect).not.toHaveBeenCalled();
    rerender(createElement(TaskGraph, { ...props, collapsedIds: new Set([rootId]), onSelect, onToggle }));
    expect(screen.getByRole('button', { name: `展开任务 ${rootId}` }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: new RegExp(`过程.*${activityId}`) })).toBeNull();
  });

  it('图例明确区分父关系实线与等待/消费/join 虚线，只有 pending wait 使用活跃 class', () => {
    const { container } = render(createElement(TaskGraph, { ...props, onSelect: vi.fn(), onToggle: vi.fn() }));
    const legend = screen.getByRole('list', { name: '任务图图例' });
    expect(within(legend).getByText(/父关系.*实线/)).toBeTruthy();
    expect(within(legend).getByText(/等待.*虚线/)).toBeTruthy();
    expect(within(legend).getByText(/结果消费.*虚线/)).toBeTruthy();
    expect(within(legend).getByText(/结果合流.*虚线/)).toBeTruthy();
    expect(container.querySelectorAll('.graph-edge--active')).toHaveLength(1);
    expect(container.querySelector('.graph-edge--wait')?.classList.contains('graph-edge--active')).toBe(true);
    expect(container.querySelector('.graph-edge--consumed')?.getAttribute('stroke-dasharray')).not.toBeNull();
    expect(container.querySelector('.graph-edge--join')?.classList.contains('graph-edge--active')).toBe(false);
  });

  it('同一对 Task 的父、等待、消费和 join 关系使用分离路径，虚线不会被底下实线填满', () => {
    const { container } = render(createElement(TaskGraph, { ...props, activities: [], onSelect: vi.fn(), onToggle: vi.fn() }));
    const paths = [...container.querySelectorAll('.graph-edge')].map(edge => edge.getAttribute('d'));
    expect(paths).toHaveLength(4);
    expect(new Set(paths).size).toBe(4);
  });

  it('TaskList 保留同一实体顺序，原生键盘选择传递真实实体类型', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(createElement(TaskList, { tasks: [child, root], activities: [activity], selectedId: childId, onSelect }));
    const list = screen.getByRole('list', { name: '任务与过程列表' });
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map(button => button.getAttribute('data-entity-id'))).toEqual([rootId, childId, activityId]);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    buttons[2].focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(activityId, 'activity');
    expect(within(list).getByText('结果不确定')).toBeTruthy();
  });

  it('空图和空列表有可读空态', () => {
    render(createElement(TaskGraph, { ...props, tasks: [], activities: [], onSelect: vi.fn(), onToggle: vi.fn() }));
    render(createElement(TaskList, { tasks: [], activities: [], onSelect: vi.fn() }));
    expect(screen.getAllByText('暂无任务或过程')).toHaveLength(2);
  });
});

describe('公开 Trace 与持久待办', () => {
  const changed: TracePageSchema.TraceItem = { event_id: event.event_id, seq: 2, task_id: rootId,
    activity_id: null, kind: 'activity.received', activities: [activity] };

  it('Trace 用所选 Activity 的明确投影过滤，只显示事件 ID/seq/kind 和公开过程摘要', () => {
    const onSelect = vi.fn();
    render(createElement(TracePanel, { events: [changed, { event_id: '9007199254740995', seq: 3,
      task_id: null, activity_id: null, kind: 'run.started', activities: [] }], selectedId: activityId, onSelect }));
    expect(screen.getByText(changed.event_id)).toBeTruthy();
    expect(screen.getByText('activity.received')).toBeTruthy();
    expect(screen.queryByText('9007199254740995')).toBeNull();
    expect(screen.getByText('序号 2')).toBeTruthy();
    expect(screen.getByText(/files.read/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `定位过程 ${activityId}` }));
    expect(onSelect).toHaveBeenCalledWith(activityId, 'activity');
  });

  it('Trace 识别 task_id 和公开的关联 Task/Activity，分页只调用已有回调', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(createElement(TracePanel, { events: [changed], selectedId: childId,
      nextCursor: 'next-page', onLoadMore, loading: true }));
    expect(screen.getByText('activity.received')).toBeTruthy();
    expect((screen.getByRole('button', { name: '加载更多事件' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(createElement(TracePanel, { events: [changed], selectedId: rootId, nextCursor: 'next-page', onLoadMore }));
    fireEvent.click(screen.getByRole('button', { name: '加载更多事件' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    rerender(createElement(TracePanel, { events: [changed], selectedId: missingId }));
    expect(screen.getByText('暂无对应公开事件')).toBeTruthy();
  });

  it('Trace 的 activity_id 可独立定位；没有回调时只读展示，不要求重建完整事件', () => {
    render(createElement(TracePanel, { events: [{ event_id: '9007199254740996', seq: null,
      task_id: null, activity_id: activityId, activities: [], kind: 'activity.dispatched' }], selectedId: activityId }));
    expect(screen.getByText('activity.dispatched')).toBeTruthy();
    expect(screen.getByText(activityId)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/序号/)).toBeNull();
  });

  it('Inbox 按真实 run_id 汇总 pending 记录，不从 Run.state 生成待办，更新后立即重建数量', () => {
    const onSelect = vi.fn();
    const { rerender } = render(createElement(Inbox, { questions: [question, { ...question, id: missingId, status: 'answered' }],
      approvals: [approval, { ...approval, id: missingId, status: 'denied' }], runs: [run], onSelect }));
    expect(screen.getByRole('heading', { name: '待处理（2）' })).toBeTruthy();
    expect(screen.getByText('待回答 1 · 待审批 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `定位运行 ${run.id}` }));
    expect(onSelect).toHaveBeenCalledWith(run.id);
    rerender(createElement(Inbox, { questions: [{ ...question, status: 'answered' }], approvals: [],
      runs: [{ ...run, state: 'waiting_user' }], onSelect }));
    expect(screen.getByRole('heading', { name: '待处理（0）' })).toBeTruthy();
    expect(screen.getByText('暂无待处理事项')).toBeTruthy();
  });

  it('Inbox 保留未分页Run的持久待办，但等归属加载后才允许定位', () => {
    const onSelect = vi.fn();
    render(createElement(Inbox, { questions: [question], approvals: [], runs: [], onSelect }));
    fireEvent.click(screen.getByRole('button', { name: `定位运行 ${run.id}` }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('待回答 1 · 待审批 0')).toBeTruthy();
  });
});
