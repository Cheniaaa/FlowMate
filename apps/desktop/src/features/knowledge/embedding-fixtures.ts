import type { EmbeddingProfile, EmbeddingProfileView, KnowledgeSettings } from '../../generated/contracts';
import { id, secondId } from '../../test/fixtures';
import { generationId } from './knowledge-fixtures';

export const embeddingProfile: EmbeddingProfile = { id: secondId, revision: 2, display_name: '项目检索',
  provider: 'openai', model_id: 'synthetic-embedding', dimensions: 128, request_dimensions: false, model_revision: null,
  query_prefix: '', document_prefix: '', connection_id: id, local_resource_id: null, request_timeout_seconds: 60,
  pricing: { currency: 'USD', provider_id: null, model_id: null, multiplier: null, input_per_million: null } };
export const embeddingView: EmbeddingProfileView = { profile: embeddingProfile,
  destination: 'https://fixed.example.invalid/v1/embeddings', local_runtime_available: null };
export const projectKnowledge: KnowledgeSettings = { workspace_id: id, revision: 1, active_profile: null,
  desired_profile: null, index_generation: generationId, rebuild_job_id: null };
