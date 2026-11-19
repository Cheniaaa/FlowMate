import type { MemoryPolicy, MemoryRecord, DataUseGrant } from '../generated/contracts';
import { connection, id, limits, secondId } from './fixtures';

export const personalScope: MemoryRecord['scope'] = { kind: 'user_global', workspace_id: null, session_id: null };
export const projectScope: MemoryRecord['scope'] = { kind: 'workspace', workspace_id: id, session_id: null };
export const memory: MemoryRecord = { id: '00000000-0000-4000-8000-000000000061', owner_id: secondId, scope: personalScope,
  revision: 3, text: '以后使用中文回答', kind: 'preference', author_kind: 'assistant', status: 'candidate', supersedes: null,
  expires_at: null, claim_key: 'a'.repeat(64), dependencies: [{ scope_id: secondId, epoch: 1 }],
  evidence: [{ source_kind: 'message', source_id: id, source_version: 'version-1', locator: '/parts/0/text', quote_hash: 'b'.repeat(64), author_kind: 'user' }] };
export const memoryPolicy: MemoryPolicy = { scope: personalScope, version: 1, read_profile: true, auto_organize: false,
  model_profile_id: null, maintenance_limits: limits };
export const memoryGrant: DataUseGrant = { id: '00000000-0000-4000-8000-000000000062', scope: personalScope, version: 1,
  epoch: 1, status: 'active', resource_ids: [], memory_scopes: [personalScope], mcp_versions: {}, purposes: ['model_send'], destination: connection.endpoint };
