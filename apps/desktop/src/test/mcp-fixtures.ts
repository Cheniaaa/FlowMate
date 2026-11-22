import type { McpConfiguredServer, McpServerView, ScopeRef } from '../generated/contracts';

export const mcpScope: ScopeRef = { kind: 'user_global', workspace_id: null, session_id: null };
export const mcpConfig: McpConfiguredServer = {
  id: '00000000-0000-4000-8000-000000000013', revision: 1, display_name: 'Local Notes',
  scope: mcpScope, transport: 'stdio', command: 'C:\\Program Files\\Notes\\server.exe',
  args: ['server file.py', '中文 参数', ''], cwd: null, env_refs: {}, url: null,
  credential_ref: null, enabled: true,
};
export const mcpView: McpServerView = { config: mcpConfig, state: 'saved', catalog: null, error_code: null, selection: null, query_grants: [] };
export const mcpPage = (items: McpServerView[]) => ({ items, next_cursor: null, watermark: '0' });
export const mcpConnection = { base_url: 'http://127.0.0.1:19013', token: 'synthetic-runtime-token', protocol_version: 4 };
