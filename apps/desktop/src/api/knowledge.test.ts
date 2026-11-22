import { afterEach, expect, it, vi } from 'vitest';
import type { EvidencePage, KnowledgeImportCommand, KnowledgeImportReceipt, KnowledgeJob, KnowledgeSettings, KnowledgeSource } from '../generated/contracts';
import { id, limits, page, resource, secondId } from '../test/fixtures';
import { RuntimeClient } from './client';
import { validate } from './validation';
import { embeddingProfile, embeddingView, projectKnowledge } from '../features/knowledge/embedding-fixtures';

afterEach(() => vi.unstubAllGlobals());

it('检索配置独立分页、固定修订目的地与 PUT 命令沿生成根，unknown 只查回原项目命令', async () => {
  const requests: { path: string; method: string; body: any }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ path: parsed.pathname + parsed.search, method: init.method ?? 'GET', body });
    if (parsed.pathname.endsWith('/embedding-profiles')) return Response.json(page([embeddingProfile]));
    if (parsed.pathname.includes('/embedding-profiles/')) return Response.json(init.method === 'PUT' ? embeddingProfile : embeddingView);
    if (parsed.pathname.includes('/commands/')) return Response.json({ status: 'confirmed', result: projectKnowledge });
    if (init.method === 'PUT') throw new TypeError('已接纳后响应丢失');
    throw new Error(parsed.pathname);
  });
  const client = new RuntimeClient(connection);
  expect((await client.embeddingProfiles({ cursor: 'opaque /+', limit: 4 })).items).toEqual([embeddingProfile]);
  expect(await client.embeddingProfile(secondId, 2)).toEqual(embeddingView);
  const profileCommand = { meta: commandMetaForTest(), data: { ...embeddingProfile,
    pricing: { currency: 'USD' as const, input_per_million: '0.02' } } };
  expect(await client.saveEmbeddingProfile(secondId, profileCommand)).toEqual(embeddingProfile);
  const settingCommand = { meta: { command_id: commandId, expected_version: 1 },
    data: { embedding_profile: { id: secondId, revision: 2 }, grants: [] } };
  await expect(client.setProjectKnowledge(id, settingCommand)).rejects.toThrow('Runtime 传输中断');
  expect(validate('KnowledgeSettings', (await client.workspaceCommandStatus(id, commandId)).result)).toEqual(projectKnowledge);
  expect(requests.map(item => [item.path, item.method])).toEqual([
    ['/v4/knowledge/embedding-profiles?cursor=opaque+%2F%2B&limit=4', 'GET'],
    [`/v4/knowledge/embedding-profiles/${secondId}?revision=2`, 'GET'],
    [`/v4/knowledge/embedding-profiles/${secondId}`, 'PUT'],
    [`/v4/workspaces/${id}/knowledge/settings`, 'PUT'],
    [`/v4/workspaces/${id}/commands/${commandId}`, 'GET'],
  ]);
  expect(requests[2].body).toEqual(profileCommand);
  expect(requests[3].body).toEqual(settingCommand);
});
const commandMetaForTest = () => ({ command_id: id, expected_version: null });

it('检索输入价格契约拒绝输出或缓存价格，零外发', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const client = new RuntimeClient(connection);
  const invalid = { meta: commandMetaForTest(), data: { ...embeddingProfile,
    pricing: { ...embeddingProfile.pricing, output_per_million: '0.01' } } };
  await expect(client.saveEmbeddingProfile(secondId, invalid)).rejects.toThrow('Runtime 契约校验失败：SaveEmbeddingProfileCommand');
  expect(fetch).not.toHaveBeenCalled();
});

const connection = { base_url: 'http://127.0.0.1:54321', token: 'synthetic-knowledge-token', protocol_version: 4 };
const commandId = '00000000-0000-4000-8000-000000000091';
const sourceId = '00000000-0000-4000-8000-000000000092';
const jobId = '00000000-0000-4000-8000-000000000093';
const evidenceId = '00000000-0000-4000-8000-000000000094';
const generationId = '00000000-0000-4000-8000-000000000095';
const command: KnowledgeImportCommand = { meta: { command_id: commandId, expected_version: null },
  data: { resource_ids: [resource.id] } };
const source: KnowledgeSource = { id: sourceId, workspace_id: id, revision: 2, label: '项目说明.md',
  status: 'active', active_version: 2, cleanup_status: 'none', cleanup_reason: null };
const job: KnowledgeJob = { id: jobId, workspace_id: id, revision: 1, command_id: commandId,
  kind: 'import', source_id: sourceId, source_version: 2, status: 'queued', task: null, reason: null,
  admission_generations: { [id]: 1 }, limits, created_at: '2026-11-22T12:00:00Z' };
const sourceView = { ...source, latest_job: job, origin_hint: '工作资料', added_at: '2026-11-22T12:00:00Z' };
const receipt: KnowledgeImportReceipt = { command_id: commandId, jobs: [job], rejected: [] };
const settings: KnowledgeSettings = { workspace_id: id, revision: 1, active_profile: null,
  desired_profile: null, index_generation: generationId, rebuild_job_id: null };
const evidence: EvidencePage = { evidence: { id: evidenceId, source_id: sourceId, source_version: 1,
  content_hash: 'a'.repeat(64), chunk_id: 'chunk-1', locator: { start_line: 2, end_line: 2,
    start_char: 12, end_char: 16, heading_path: ['说明'] }, method: 'bm25', excerpt: '原文片段',
  parser_version: 'parser-v1', chunker_version: 'chunker-v1', index_generation: generationId,
  embedding_profile: null }, text: '片段', offset: 2, next_offset: null, total_chars: 4, current_version: 2 };

it('项目知识读取保留 opaque 分页和历史证据版本，证据请求禁用缓存', async () => {
  const seen: { path: string; token: string | null; cache?: RequestCache }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    seen.push({ path: parsed.pathname + parsed.search, token: new Headers(init.headers).get('Authorization'),
      ...(init.cache ? { cache: init.cache } : {}) });
    if (parsed.pathname.endsWith('/sources')) return Response.json({ ...page([sourceView]), next_cursor: 'source-next' });
    if (parsed.pathname.endsWith('/jobs')) return Response.json(page([job]));
    if (parsed.pathname.endsWith(`/jobs/${jobId}`)) return Response.json(job);
    if (parsed.pathname.endsWith('/settings')) return Response.json(settings);
    if (parsed.pathname.endsWith(`/evidence/${evidenceId}`)) return Response.json(evidence);
    throw new Error(`未定义请求 ${parsed.pathname}`);
  });
  const client = new RuntimeClient(connection);
  const sources = await client.knowledgeSources(id, { cursor: 'source/page?x=1', limit: 7 });
  expect(sources.items[0]).toEqual(sourceView);
  expect(sources.next_cursor).toBe('source-next');
  expect(sources.watermark).toBe('9007199254740993');
  expect((await client.knowledgeJobs(id, { cursor: 'jobs-tail', limit: 5 })).items).toEqual([job]);
  expect(await client.knowledgeJob(jobId)).toEqual(job);
  expect(await client.knowledgeSettings(id)).toEqual(settings);
  expect(await client.knowledgeEvidence(id, evidenceId, { offset: 2, limit: 2 })).toEqual(evidence);
  expect(seen).toEqual([
    { path: `/v4/workspaces/${id}/knowledge/sources?cursor=source%2Fpage%3Fx%3D1&limit=7`, token: 'Bearer synthetic-knowledge-token' },
    { path: `/v4/workspaces/${id}/knowledge/jobs?cursor=jobs-tail&limit=5`, token: 'Bearer synthetic-knowledge-token' },
    { path: `/v4/knowledge/jobs/${jobId}`, token: 'Bearer synthetic-knowledge-token', cache: 'no-store' },
    { path: `/v4/workspaces/${id}/knowledge/settings`, token: 'Bearer synthetic-knowledge-token' },
    { path: `/v4/workspaces/${id}/knowledge/evidence/${evidenceId}?offset=2&limit=2`,
      token: 'Bearer synthetic-knowledge-token', cache: 'no-store' },
  ]);
});

it('导入响应丢失后只用原项目与 command ID 查回原回执，其他项目及会话查回不重传', async () => {
  const seen: { path: string; method: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    seen.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null });
    if (init.method === 'POST' && path === `/v4/workspaces/${id}/knowledge/imports`) {
      throw new TypeError('已接纳后响应丢失');
    }
    if (path === `/v4/workspaces/${id}/commands/${commandId}`) return Response.json({ status: 'confirmed', result: receipt });
    if (path === `/v4/workspaces/${secondId}/commands/${commandId}`
      || path === `/v4/sessions/${secondId}/commands/${commandId}`) return Response.json({ status: 'not_found', result: null });
    if (path === `/v4/workspaces/${id}/knowledge/jobs`) return Response.json(page([{ ...job, revision: 2, status: 'completed' }]));
    throw new Error(`未定义请求 ${path}`);
  });
  const client = new RuntimeClient(connection);
  await expect(client.importKnowledge(id, command)).rejects.toThrow('Runtime 传输中断');
  expect((await client.workspaceCommandStatus(secondId, commandId)).status).toBe('not_found');
  expect((await client.commandStatus(secondId, commandId)).status).toBe('not_found');
  const checked = await client.workspaceCommandStatus(id, commandId);
  expect(checked.status).toBe('confirmed');
  const restored = validate('KnowledgeImportReceipt', checked.result);
  expect(restored).toEqual(receipt);
  expect(restored.command_id).toBe(commandId);
  expect(restored.jobs[0].status).toBe('queued');
  expect((await client.knowledgeJobs(id)).items[0].status).toBe('completed');
  expect(seen).toEqual([
    { path: `/v4/workspaces/${id}/knowledge/imports`, method: 'POST', body: command },
    { path: `/v4/workspaces/${secondId}/commands/${commandId}`, method: 'GET', body: null },
    { path: `/v4/sessions/${secondId}/commands/${commandId}`, method: 'GET', body: null },
    { path: `/v4/workspaces/${id}/commands/${commandId}`, method: 'GET', body: null },
    { path: `/v4/workspaces/${id}/knowledge/jobs`, method: 'GET', body: null },
  ]);
});

it('导入与实体操作沿各自生成命令根、返回 DTO 和原始预期版本', async () => {
  const seen: { path: string; method?: string; body: unknown }[] = [];
  const cancelled: KnowledgeJob = { ...job, revision: 2, status: 'cancelled', reason: 'user_cancelled' };
  const removed: KnowledgeSource = { ...source, revision: 3, status: 'removed' };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    seen.push({ path, method: init.method, body: JSON.parse(String(init.body)) });
    if (path.endsWith('/imports')) return Response.json(receipt, { status: 202 });
    if (path.endsWith('/cancel')) return Response.json(cancelled);
    if (path.endsWith('/actions')) return Response.json(removed);
    throw new Error(`未定义请求 ${path}`);
  });
  const client = new RuntimeClient(connection);
  expect(await client.importKnowledge(id, command)).toEqual(receipt);
  const cancellation = { meta: { command_id: id, expected_version: 1 }, data: {} };
  const removal = { meta: { command_id: secondId, expected_version: 2 }, data: { action: 'remove' as const } };
  expect(await client.cancelKnowledgeJob(jobId, cancellation)).toEqual(cancelled);
  expect(await client.actOnKnowledgeSource(sourceId, removal)).toEqual(removed);
  expect(seen).toEqual([
    { path: `/v4/workspaces/${id}/knowledge/imports`, method: 'POST', body: command },
    { path: `/v4/knowledge/jobs/${jobId}/cancel`, method: 'POST', body: cancellation },
    { path: `/v4/knowledge/sources/${sourceId}/actions`, method: 'POST', body: removal },
  ]);
});

it('导入拒绝任意本机路径且零外发；查询 DTO 和 confirmed 原回执仍按生成根校验', async () => {
  const fetch = vi.fn(async () => Response.json([]));
  vi.stubGlobal('fetch', fetch);
  const client = new RuntimeClient(connection);
  const invalid = { ...command, data: { resource_ids: [resource.id], path: 'C:/Synthetic/private.md' } };
  await expect(client.importKnowledge(id, invalid)).rejects.toThrow('Runtime 契约校验失败：KnowledgeImportCommand');
  expect(fetch).not.toHaveBeenCalled();
  await expect(client.knowledgeSources(id)).rejects.toThrow('Runtime 契约校验失败：KnowledgeSourcePage');
  fetch.mockResolvedValue(Response.json({ ...evidence, internal_path: 'C:/Synthetic/private.md' }));
  await expect(client.knowledgeEvidence(id, evidenceId, { offset: 0 })).rejects.toThrow('Runtime 契约校验失败：EvidencePage');
  fetch.mockResolvedValue(Response.json({ status: 'confirmed', result: { command_id: commandId } }));
  const checked = await client.workspaceCommandStatus(id, commandId);
  expect(() => validate('KnowledgeImportReceipt', checked.result)).toThrow('Runtime 契约校验失败：KnowledgeImportReceipt');
});
