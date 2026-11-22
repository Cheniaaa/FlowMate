import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from './client';
import { validate } from './validation';
import { agent, binding, id, secondId } from '../test/fixtures';

afterEach(() => vi.unstubAllGlobals());
it('成员/工具目录沿生成响应根验证；新字段响应缺失不能默认兼容', async () => {
  const paths: string[] = [];
  const lanes = [{ task: { id: secondId, version: 1, run_id: id, binding, parent_task_id: null, origin_task_id: null,
    kind: 'agent', executor_id: 'builtin.agent', state: 'running', created_seq: 1, deadline_at: null, result_version: null, reason: null }, profile: agent, activities: [], handoffs: [] }];
  vi.stubGlobal('fetch', async (url: string) => { const path = new URL(url).pathname; paths.push(path); return Response.json(path.endsWith('/tools') ? [] : lanes); });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 4 });
  expect((await client.memberLanes(id))[0].task.binding.agent_work).toBeNull();
  expect(await client.tools()).toEqual([]);
  expect(paths).toEqual([`/v4/runs/${id}/member-lanes`, '/v4/tools']);
  const { members, ...oldConfig } = binding.config;
  const { delegatable, ...oldProfile } = agent;
  expect(() => validate('AgentProfile', oldProfile)).toThrow();
  expect(() => validate('TaskExecutionBinding', { ...binding, config: oldConfig })).toThrow();
  expect(() => validate('TaskExecutionBinding', { config: binding.config, execution_session_id: id, interaction_session_id: id, sources: binding.sources, delegation_depth: 0 })).toThrow();
});
