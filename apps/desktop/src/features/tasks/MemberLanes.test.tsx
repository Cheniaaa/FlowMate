import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { MemberLane } from '../../generated/contracts';
import { agent, binding, id, secondId } from '../../test/fixtures';
import MemberLanes from './MemberLanes';

export const lane: MemberLane = { profile: { ...agent, display_name: '固定研究成员', version: 4 },
  task: { id: secondId, run_id: id, version: 1, kind: 'agent', executor_id: 'builtin.agent', parent_task_id: id, origin_task_id: id, created_seq: 2,
    state: 'waiting_user', deadline_at: null, result_version: null, reason: 'context_authorization_required',
    binding: { ...binding, config: { ...binding.config, agent_profile: { ...agent, display_name: '固定研究成员', version: 4 },
      model_profile: { ...binding.config.model_profile, model_id: 'fixed-member-model', endpoint: 'https://member.invalid' } },
      agent_work: { kind: 'agent', profile_id: agent.id, goal: '核对证据', input_refs: [], output_schema: {}, success_criteria: ['保留引用'] } } },
  activities: [{ id, task_id: secondId, run_id: id, version: 1, kind: 'tool', operation: '实际工具', state: 'succeeded',
    actual_units: '123', usage: null, dependencies: [], error: null, script_execution: null }], handoffs: [{ task_id: id, run_id: secondId, lifetime: 'managed', submitted_state: 'running' }] };

it('只按真实成员Task/Activity和交接画顺序；模型取固定binding，不虚构时长或把managed画成从属', async () => {
  const select = vi.fn(), open = vi.fn();
  render(<MemberLanes lanes={[lane]} onSelect={select} onOpen={open} />);
  expect(screen.getByText('固定研究成员')).toBeTruthy();
  expect(screen.getByText(/fixed-member-model/)).toBeTruthy();
  expect(screen.getByText(/https:\/\/member.invalid/)).toBeTruthy();
  expect(screen.getByText('context_authorization_required')).toBeTruthy();
  expect(screen.queryByText(/耗时/)).toBeNull();
  const activity = screen.getByRole('button', { name: /工具调用/ });
  expect(activity.closest('article')).toBe(screen.getByRole('article'));
  await userEvent.click(activity); expect(select).toHaveBeenCalledWith(id, 'activity');
  await userEvent.click(screen.getByRole('button', { name: '查看后台交接' }));
  expect(open).toHaveBeenCalledWith(secondId);
  expect(within(screen.getByRole('article')).getByText(/不是取消从属关系/)).toBeTruthy();
});
