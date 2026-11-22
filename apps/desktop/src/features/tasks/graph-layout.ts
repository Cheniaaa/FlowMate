import type { ActivityView, JoinFact, ResultConsumption, TaskSnapshot, WaitRecord } from '../../generated/contracts';
import { activityLabel } from './operation-label';

export interface GraphNode {
  id: string;
  entity_kind: 'task' | 'activity';
  x: number;
  y: number;
  state: TaskSnapshot['state'] | ActivityView['state'];
  label: string;
}

export interface GraphEdge {
  id: string;
  kind: 'parent' | 'wait' | 'consumed' | 'join';
  from: string;
  to: string;
  active?: boolean;
}

export interface GraphViewModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const graphStateLabels: Record<GraphNode['state'], string> = {
  queued: '排队中', running: '运行中', waiting_user: '等待用户', waiting_approval: '待审批',
  waiting_children: '等待子任务', interrupted: '已中断', blocked_incompatible: '版本不兼容',
  completed: '已完成', failed: '失败', cancelled: '已取消', prepared: '已准备',
  dispatched: '执行中', succeeded: '成功', uncertain: '结果不确定',
};

const compareIds = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function buildTaskGraph(
  tasks: TaskSnapshot[], activities: ActivityView[], waits: WaitRecord[], consumptions: ResultConsumption[],
  joins: JoinFact[], collapsedIds: ReadonlySet<string>,
): GraphViewModel {
  const orderedTasks = [...tasks].sort((a, b) => a.created_seq - b.created_seq || compareIds(a, b));
  const orderedActivities = [...activities].sort(compareIds);
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const activitiesByTask = new Map<string, ActivityView[]>();
  for (const activity of orderedActivities) {
    const owned = activitiesByTask.get(activity.task_id) ?? [];
    owned.push(activity);
    activitiesByTask.set(activity.task_id, owned);
  }

  const depths = new Map<string, number>();
  const hidden = new Map<string, boolean>();
  // parent 无环由服务保证；分页中尚未加载的 parent 不建立伪节点。
  function depth(task: TaskSnapshot): number {
    if (depths.has(task.id)) return depths.get(task.id)!;
    const parent = task.parent_task_id === null ? undefined : taskById.get(task.parent_task_id);
    const value = parent ? depth(parent) + 1 : 0;
    depths.set(task.id, value);
    return value;
  }
  function isHidden(task: TaskSnapshot): boolean {
    if (hidden.has(task.id)) return hidden.get(task.id)!;
    const parent = task.parent_task_id === null ? undefined : taskById.get(task.parent_task_id);
    const value = parent ? collapsedIds.has(parent.id) || isHidden(parent) : false;
    hidden.set(task.id, value);
    return value;
  }

  const allNodes: GraphNode[] = [];
  for (const task of orderedTasks) {
    allNodes.push({ id: task.id, entity_kind: 'task', x: 126 + depth(task) * 16, y: 42 + allNodes.length * 84,
      state: task.state, label: task.kind === 'tool' ? '工具任务' : task.binding.agent_work && task.binding.config.kind === 'agent' ? `成员 · ${task.binding.config.agent_profile.display_name}` : task.parent_task_id === null ? '主任务' : '子任务' });
    // Activity 的 ID 排序只保证稳定展示，不表示创建时间或调用先后。
    for (const activity of activitiesByTask.get(task.id) ?? []) {
      allNodes.push({ id: activity.id, entity_kind: 'activity', x: 126 + (depth(task) + 1) * 16,
        y: 42 + allNodes.length * 84, state: activity.state,
        label: activityLabel(activity, task) });
    }
  }
  for (const activity of orderedActivities.filter(item => !taskById.has(item.task_id))) {
    allNodes.push({ id: activity.id, entity_kind: 'activity', x: 126, y: 42 + allNodes.length * 84,
      state: activity.state, label: activityLabel(activity) });
  }

  // 先布局再过滤，折叠不会改变仍可见节点的坐标。
  const activityById = new Map(activities.map(activity => [activity.id, activity]));
  const nodes = allNodes.filter(node => {
    if (node.entity_kind === 'task') return !isHidden(taskById.get(node.id)!);
    const owner = taskById.get(activityById.get(node.id)!.task_id);
    return !owner || !collapsedIds.has(owner.id) && !isHidden(owner);
  });
  const visibleIds = new Set(nodes.map(node => node.id));
  const edges = new Map<string, GraphEdge>();
  function addEdge(edge: GraphEdge) {
    if (visibleIds.has(edge.from) && visibleIds.has(edge.to)) edges.set(edge.id, edge);
  }
  for (const task of orderedTasks) {
    if (task.parent_task_id !== null) addEdge({ id: `parent:${task.id}`, kind: 'parent',
      from: task.parent_task_id, to: task.id, active: task.state === 'running' });
  }
  for (const activity of orderedActivities) {
    addEdge({ id: `parent:${activity.id}`, kind: 'parent', from: activity.task_id, to: activity.id,
      active: activity.state === 'dispatched' });
  }
  for (const wait of [...waits].sort(compareIds)) {
    addEdge({ id: `wait:${wait.id}`, kind: 'wait', from: wait.owner_task_id, to: wait.target_task_id,
      active: wait.state === 'pending' });
  }
  for (const consumption of [...consumptions].sort(compareIds)) {
    addEdge({ id: `consumed:${consumption.id}`, kind: 'consumed', from: consumption.target_task_id, to: consumption.task_id });
  }
  for (const join of [...joins].sort(compareIds)) {
    if (taskById.get(join.child_task_id)?.result_version === join.child_result_version) {
      addEdge({ id: `join:${join.id}`, kind: 'join', from: join.child_task_id, to: join.root_task_id });
    }
  }
  return { nodes, edges: [...edges.values()] };
}
