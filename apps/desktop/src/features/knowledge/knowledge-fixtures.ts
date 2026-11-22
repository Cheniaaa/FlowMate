import type { EvidencePage, KnowledgeImportReceipt, KnowledgeJob, KnowledgeSource } from '../../generated/contracts';
import { id, limits, page, resource, secondId } from '../../test/fixtures';

export const sourceId = '00000000-0000-4000-8000-000000000081';
export const otherSourceId = '00000000-0000-4000-8000-000000000082';
export const jobId = '00000000-0000-4000-8000-000000000083';
export const evidenceId = '00000000-0000-4000-8000-000000000084';
export const generationId = '00000000-0000-4000-8000-000000000085';
export const source: KnowledgeSource = { id: sourceId, workspace_id: id, revision: 2, label: '项目说明.md',
  active_version: 1, status: 'active', cleanup_status: 'none', cleanup_reason: null };
export const job: KnowledgeJob = { id: jobId, workspace_id: id, revision: 1, command_id: secondId,
  kind: 'import', source_id: sourceId, source_version: 2, created_at: '2026-11-22T12:00:00Z',
  status: 'queued', task: { run_id: secondId, task_id: jobId, lifetime: 'managed', submitted_state: 'queued' },
  reason: null, limits, admission_generations: { [id]: 1 } };
export function sourcePage(items: KnowledgeSource[], latestJob: KnowledgeJob | null = null) {
  return page(items.map(item => ({ latest_job: latestJob, origin_hint: null, added_at: null, ...item })));
}
export const selectedFile = { ...resource, label: '新增说明.md' };
export const importReceipt: KnowledgeImportReceipt = { command_id: secondId, jobs: [job], rejected: [] };
export const evidence: EvidencePage = { evidence: { id: evidenceId, source_id: sourceId, source_version: 1,
  content_hash: 'a'.repeat(64), chunk_id: 'chunk-internal', index_generation: generationId,
  parser_version: 'parser-internal', chunker_version: 'chunker-internal', embedding_profile: null,
  method: 'bm25', excerpt: '第一段原文', locator: { start_line: 18, end_line: 20, start_char: 100, end_char: 160,
    heading_path: ['设计说明'] } }, text: '第一段原文\r\n[本机链接](file:///C:/private.txt)\r\n<script>执行</script>',
  offset: 0, next_offset: 52, total_chars: 60, current_version: 2 };
