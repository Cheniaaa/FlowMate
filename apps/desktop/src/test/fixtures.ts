import type { AgentProfile, DataUseGrant, ModelConnection, ModelProfile, PublicationView, ResourceRef, RunDetail, RunSnapshot, PublicEvent } from '../generated/contracts';

export const id = '00000000-0000-4000-8000-000000000001';
export const secondId = '00000000-0000-4000-8000-000000000002';
export const agent: AgentProfile = { id, version: 1, display_name: 'FlowMate', icon_id: 'assistant', communication_style: '', instructions: '', default_model_profile_id: null };
export const connection: ModelConnection = {
  id: '00000000-0000-4000-8000-000000000003', version: 1, display_name: '测试连接',
  protocol: 'openai_compatible', endpoint: 'https://example.invalid/v1', secret_ref: null, provider_preset_id: null,
};
export const model: ModelProfile = {
  id: secondId, version: 1, connection_id: connection.id, model_id: 'explicit-model', display_name: null, openai_max_tokens_field: null,
  capabilities: { tools: true, thinking: false, structured_output: false }, context_window_tokens: 8192, max_output_tokens: 2048, request_timeout_seconds: 60,
  pricing: { provider_id: null, model_id: null, multiplier: null, input_per_million: '1.25', output_per_million: '2.5', cache_read_per_million: null, cache_write_per_million: null, currency: 'USD' },
};
export const limits = { max_steps: 64, max_model_requests: 24, max_tasks: 64, deadline_seconds: 900, max_cost_units: null };
export const run: RunSnapshot = {
  id, version: 1, workspace_id: id, session_id: id, root_task_id: secondId, budget_id: secondId, state: 'running',
  config: { agent_profile: agent, model_profile: { ...model, context_window_tokens: 8192,
    connection_version: connection.version, protocol: connection.protocol, endpoint: connection.endpoint,
    secret_ref: connection.secret_ref, provider_preset_id: connection.provider_preset_id, metadata_sources: {} },
    model_pricing: null, pricing_unknown_reason: '合成测试未解析价格',
    catalog: { tools: {}, plugins: {}, agent_executor_id: 'builtin.agent' } },
  scope_dependencies: [], deadline_at: '2026-11-07T12:00:00Z', output: null, reason: null, resource_ids: [],
};
export const event: PublicEvent = {
  kind: 'run.started', event_id: '9007199254740993', seq: 1, event_version: 1, workspace_id: id, session_id: id,
  run_id: id, task_id: null, activity_id: null, causation_id: null, created_at: '2026-11-07T12:00:00Z',
  payload: { runs: [run], tasks: [], activities: [], budgets: [], messages: [], artifacts: [], questions: [], waits: [], consumptions: [], joins: [] },
};
export const page = <T,>(items: T[]) => ({ items, next_cursor: null, watermark: '9007199254740993' });
export const resource: ResourceRef = { id: '00000000-0000-4000-8000-000000000010', version: 1,
  scope: { workspace_id: id, session_id: null }, label: '共享资料.md', kind: 'file', source_version: null };
export const grant: DataUseGrant = { id: '00000000-0000-4000-8000-000000000011', version: 1, epoch: 1,
  scope: resource.scope, resource_ids: [resource.id], purposes: ['read', 'model_send'], destination: connection.endpoint, status: 'active' };
export const publication: PublicationView = { id: '00000000-0000-4000-8000-000000000020', version: 1, state: 'needs_restore',
  workspace_id: id, session_id: id, run_id: id, task_id: secondId, activity_id: secondId, attempt_id: secondId,
  target_path: 'synthetic-report.txt', stage_path: 'synthetic-stage.txt', backup_path: 'synthetic-backup.txt',
  target_matches: 'missing', stage_matches: true, backup_matches: true, last_checked: null, maintenance_reason: null };
export const runDetailSummary: Pick<RunDetail, 'cost_summary' | 'context_usage'> = {
  cost_summary: { calculated_units: '0', reserved_units: '0', unknown_request_count: 0, pending_request_count: 0,
    currency: 'USD', units_per_currency: '1000000000', pricing_basis: { source: null, snapshot_id: null,
      catalog_version: null, effective_multiplier: null, assumptions: [], unknown_reason: '合成测试未解析价格' } },
  context_usage: null,
};
