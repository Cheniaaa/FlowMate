import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { agent, binding, id, secondId } from '../../test/fixtures';
import type { MemberLane } from '../../generated/contracts';
import MemberResult from './MemberResult';

afterEach(() => vi.unstubAllGlobals());
const lane: MemberLane = { profile: agent, activities: [], handoffs: [], task: { id: secondId, version: 2, run_id: id, kind: 'agent', executor_id: 'builtin.agent', parent_task_id: id, origin_task_id: id,
  state: 'completed', created_seq: 2, result_version: 1, reason: null, deadline_at: null, binding: { ...binding, agent_work: { kind: 'agent', profile_id: id, goal: '交付', input_refs: [], output_schema: {}, success_criteria: [] } } } };
it('Task completed的partial仍明确部分交付；展示完整AgentResult而不是私有聊天或父完成', async () => {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { paths.push(new URL(url).pathname); return Response.json({
    handle: { task_id: secondId, run_id: id, lifetime: 'run_bound', submitted_state: 'completed' }, result_version: 1, state: 'completed', artifacts: [], dependencies: [], error: null,
    result: { status: 'partial', summary: '已核对部分资料', artifact_ids: [id], evidence_refs: [secondId], structured_result: { checked: 2 }, unresolved: ['缺少第三份材料'], verification: ['成员声明已复核'], handled_failures: [] },
  }); });
  render(<MemberResult client={new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 })} lane={lane} />);
  expect(await screen.findByRole('heading', { name: '部分交付' })).toBeTruthy();
  expect(screen.getByText('缺少第三份材料')).toBeTruthy();
  expect(screen.getByText(/不代表父任务目标已完成/)).toBeTruthy();
  expect(screen.getByText(/不等同已执行工具事实/)).toBeTruthy();
  expect(paths).toEqual([`/v3/tasks/${secondId}/result`]);
});
