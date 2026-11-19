import type { MemoryMaintenanceNotice, MemorySourceBoundary, RunDetail, TaskCenterPage, TaskHandle } from '../generated/contracts';
import { binding, id, limits, model, page, run, runDetailSummary } from './fixtures';
import { memoryPolicy } from './memory-fixtures';

export const maintenancePolicy = { ...memoryPolicy, version: 5, model_profile_id: model.id };
export const maintenanceBudgetConfirmation = { kind: 'new_budget' as const,
  model_profile_id: model.id, model_version: model.version, connection_version: 1,
  limits: maintenancePolicy.maintenance_limits };
export const sourceRun = { ...run, version: 99, state: 'completed' as const };
export const sourceBoundary: MemorySourceBoundary = { run_id: sourceRun.id, event_id: '9007199254741001' };
export const maintenanceRun = { ...run, id: '00000000-0000-4000-8000-000000000071', kind: 'maintenance' as const,
  root_task_id: '00000000-0000-4000-8000-000000000072', execution_session_id: '00000000-0000-4000-8000-000000000073', state: 'queued' as const };
export const maintenanceTask: TaskHandle = { run_id: maintenanceRun.id, task_id: maintenanceRun.root_task_id, lifetime: 'managed', submitted_state: 'queued' };
export const maintenanceNotice: MemoryMaintenanceNotice = { id: '00000000-0000-4000-8000-000000000074',
  scope: maintenancePolicy.scope, policy_version: maintenancePolicy.version, source_boundary: sourceBoundary, task: maintenanceTask, reason: null };
export const sourceItem: TaskCenterPage['items'][number] = { run: sourceRun, pending_count: 0, delivery_state: null, origin_task_id: null,
  root: { id: sourceRun.root_task_id, version: 1, run_id: sourceRun.id, binding, kind: 'agent', executor_id: 'builtin.agent',
    parent_task_id: null, origin_task_id: null, state: 'completed', created_seq: 1, deadline_at: null, result_version: null, reason: null } };
export const maintenanceDetail: RunDetail = { ...runDetailSummary, run: maintenanceRun,
  tasks: page([{ ...sourceItem.root, id: maintenanceRun.root_task_id, run_id: maintenanceRun.id, state: 'queued',
    origin_task_id: sourceRun.root_task_id, binding: { ...binding, execution_session_id: maintenanceRun.execution_session_id } }]),
  activities: page([]), messages: page([]), artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
  budget: { id, run_id: maintenanceRun.id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 },
  watermark: '9007199254741010' };
