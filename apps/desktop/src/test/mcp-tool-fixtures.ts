import type { Approval, TaskSnapshot, ToolSpecList } from '../generated/contracts';
import { binding, event, id, run, secondId } from './fixtures';

export const serverId = '00000000-0000-4000-8000-000000000012';
export const remoteOperation = 'mcp.fixed-server.fixed-tool';
export const remoteSnapshot: NonNullable<Approval['mcp']> = {
  server_id: serverId, config_revision: 4, catalog_hash: 'a'.repeat(64),
  original_name: 'notes/search 中文', destination: `mcp:${serverId}:4:https://notes.example.invalid/mcp`,
};
export const remoteTask: TaskSnapshot = {
  id: secondId, version: 1, run_id: id, kind: 'agent', executor_id: 'builtin.agent',
  binding: { ...binding, config: { ...run.config, catalog: { ...run.config.catalog,
    tools: { [remoteOperation]: `4:${remoteSnapshot.catalog_hash}` }, mcp_tools: { [remoteOperation]: remoteSnapshot } } } },
  parent_task_id: null, origin_task_id: null, state: 'running', reason: null,
  created_seq: 1, deadline_at: null, result_version: null,
};
export const remoteApproval: Approval = {
  id, version: 1, workspace_id: id, session_id: id, run_id: id, task_id: secondId,
  activity_id: id, call_id: 'actual-call', tool_name: remoteOperation, tool_version: `4:${remoteSnapshot.catalog_hash}`,
  args_hash: 'parameter-hash', target: remoteSnapshot.destination, export_preview: null,
  mcp: remoteSnapshot, parameters: { query: '本次真实参数' }, dependencies: [],
  expires_at: '2026-12-01T00:00:00Z', status: 'pending',
};
export const remoteTools: ToolSpecList = [{
  name: remoteOperation, version: `4:${remoteSnapshot.catalog_hash}`, description: '真实目录工具',
  mcp: remoteSnapshot, input_schema: { type: 'object' }, result_schema: {},
  background_supported: false, cancellation: 'best_effort', retry_class: 'never',
  required_purposes: ['tool_send'], requires_approval: true, model_visible: true,
}];
export const remoteActivity = {
  id, task_id: secondId, run_id: id, version: 1, kind: 'tool' as const, operation: remoteOperation,
  state: 'uncertain' as const, error: 'transport_lost', usage: null, actual_units: '0', dependencies: [],
  script_execution: null,
};
export const remoteTrace = { event_id: event.event_id, seq: 1, kind: 'activity.finished',
  task_id: secondId, activity_id: id, activities: [remoteActivity] };
