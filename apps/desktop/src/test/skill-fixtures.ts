import type { SkillView, SkillExportReceipt, SkillCandidate } from '../generated/contracts';
import { id, secondId } from './fixtures';
export const skillHash = 'a'.repeat(64);
export const skillScope = { kind: 'workspace' as const, workspace_id: id, session_id: null };
export const skillView: SkillView = {
  version: { skill_id: secondId, content_hash: skillHash, directory_name: 'release-note', name: 'release-note', description: '整理真实发布说明',
    metadata: { build: '01' }, license: 'MIT', compatibility: null, allowed_tools: null,
    files: [{ path: 'SKILL.md', content_hash: skillHash, size_bytes: 60 }, { path: 'assets/data.bin', content_hash: skillHash, size_bytes: 2 }],
    source: { kind: 'user_created', command_id: id, base_hash: null, resource_id: null, resource_version: null,
      source_version: null, run_id: null, task_id: null, activity_id: null, attempt_id: null }, scope: skillScope, dependencies: [] },
  binding: { id, skill_id: secondId, scope: skillScope, enabled: true, environment_id: null, environment_revision: null, revision: 1 },
  readiness: 'content_available',
};
export const skillCandidate: SkillCandidate = { ...skillView.version, id, staging_ref: id, base_hash: null };
export const skillReceipt: SkillExportReceipt = {
  disposition: 'pending',
  command_id: id, skill_id: secondId, content_hash: skillHash, target_ref: id, target_path: 'C:\\Synthetic\\实际保存.zip', zip_hash: 'b'.repeat(64),
  state: 'saved', target_identity: 'volume:file', target_matches: 'published', stage_path: 'C:\\Synthetic\\.stage', backup_path: null,
  stage_matches: false, backup_matches: null, cleanup_pending: false, reason: null,
};
