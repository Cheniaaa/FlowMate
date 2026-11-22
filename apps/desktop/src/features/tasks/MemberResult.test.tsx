import { render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { RuntimeClient } from '../../api/client';
import { agent, binding, id, secondId } from '../../test/fixtures';
import type { ArtifactRef, MemberLane } from '../../generated/contracts';
import MemberResult from './MemberResult';

afterEach(() => vi.unstubAllGlobals());
const lane: MemberLane = { profile: agent, activities: [], handoffs: [], task: { id: secondId, version: 2, run_id: id, kind: 'agent', executor_id: 'builtin.agent', parent_task_id: id, origin_task_id: id,
  state: 'completed', created_seq: 2, result_version: 1, reason: null, deadline_at: null, binding: { ...binding, agent_work: { kind: 'agent', profile_id: id, goal: '交付', input_refs: [], output_schema: {}, success_criteria: [] } } } };
it('成员交付沿真实CitationRef打开原文，不把evidence_refs或父子ID补成引用资格', async () => {
  const open = vi.fn();
  vi.stubGlobal('fetch', async () => Response.json({
    handle: { task_id: secondId, run_id: id, lifetime: 'run_bound', submitted_state: 'completed' }, result_version: 1,
    state: 'completed', artifacts: [], dependencies: [], error: null,
    result: { status: 'completed', summary: '已核对[1]；编号[2]没有引用。', artifact_ids: [],
      evidence_refs: [id], citations: [{ marker: 1, evidence_id: secondId }], structured_result: null,
      unresolved: [], verification: [], handled_failures: [] },
  }));
  render(<MemberResult client={new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 4 })}
    lane={lane} onOpenEvidence={open} />);
  await userEvent.click(await screen.findByRole('button', { name: '查看引用 1' }));
  expect(open).toHaveBeenCalledExactlyOnceWith(secondId);
  expect(screen.queryByRole('button', { name: '查看引用 2' })).toBeNull();
});
it('Task completed的partial仍明确部分交付；展示完整AgentResult而不是私有聊天或父完成', async () => {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { paths.push(new URL(url).pathname); return Response.json({
    handle: { task_id: secondId, run_id: id, lifetime: 'run_bound', submitted_state: 'completed' }, result_version: 1, state: 'completed', artifacts: [], dependencies: [], error: null,
    result: { status: 'partial', summary: '已核对部分资料', artifact_ids: [id], evidence_refs: [secondId], structured_result: { checked: 2 }, unresolved: ['缺少第三份材料'], verification: ['成员声明已复核'], handled_failures: [] },
  }); });
  render(<MemberResult client={new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 4 })} lane={lane} />);
  expect(await screen.findByRole('heading', { name: '部分交付' })).toBeTruthy();
  expect(screen.getByText('缺少第三份材料')).toBeTruthy();
  expect(screen.getByText(/不代表父任务目标已完成/)).toBeTruthy();
  expect(screen.getByText(/不等同已执行工具事实/)).toBeTruthy();
  expect(paths).toEqual([`/v4/tasks/${secondId}/result`]);
});

it('成员交付用产生文件的脚本投影命名，预览固定产物', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 4 });
  const activityId = '00000000-0000-4000-8000-000000000015';
  const artifact: ArtifactRef = { id: '00000000-0000-4000-8000-000000000020', task_id: secondId, activity_id: activityId, version: 1, media_type: 'text/plain',
    content_hash: 'b'.repeat(64), dependencies: [] };
  vi.stubGlobal('fetch', async (url: string) => {
    const { pathname, search } = new URL(url);
    const path = pathname + search;
    if (path === `/v4/tasks/${secondId}/result`) return Response.json({
      handle: { task_id: secondId, run_id: id, lifetime: 'run_bound', submitted_state: 'completed' },
      result_version: 1, state: 'completed', artifacts: [artifact], dependencies: [], error: null,
      result: { status: 'completed', summary: '已完成成员报告', structured_result: null, artifact_ids: [artifact.id], evidence_refs: [],
        unresolved: [], verification: [], handled_failures: [] },
    });
    if (path === `/v4/artifacts/${artifact.id}/content?offset=0`) return Response.json({
      text: '成员产物正文', start: 0, end: 6, total_chars: 6, source_version: 'v1',
    });
    throw new Error(`未定义HTTP ${path}`);
  });
  const content = vi.spyOn(client, 'artifactContent');
  render(<MemberResult client={client} lane={{ ...lane, activities: [{ id: activityId, version: 1, task_id: secondId, run_id: id,
    kind: 'tool', operation: 'skills.run_script', state: 'succeeded', error: null, usage: null, dependencies: [], actual_units: null,
    script_execution: { skill_id: id, content_hash: 'b'.repeat(64), script_relative_path: 'scripts/write.py', environment_id: id,
      environment_revision: 1, attempt_id: id, exit_code: 0, termination_reason: 'exited', truncated: false,
      outputs: [{ relative_path: '研究结论.txt', artifact }], collection_error: null, external_costs: 'unknown' },
  }] }} />);
  await userEvent.click(await screen.findByRole('button', { name: '研究结论.txt' }));
  const detail = screen.getByRole('region', { name: '产物详情' });
  expect(within(detail).getByRole('heading', { name: '研究结论.txt' })).toBeTruthy();
  expect((await within(detail).findByTitle('产物预览')).getAttribute('srcdoc')).toContain('成员产物正文');
  expect(content).toHaveBeenCalledExactlyOnceWith(artifact.id, 0, 'text');
});
