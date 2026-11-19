import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { binding, id, secondId } from '../../test/fixtures';
import { TaskGraph } from './TaskGraph';

it('成员节点名称来自固定Task binding，不从当前Profile目录造节点或跨Run从属线', () => {
  const task = { id: secondId, version: 1, run_id: id, kind: 'agent' as const, executor_id: 'builtin.agent', parent_task_id: null, origin_task_id: id,
    created_seq: 1, state: 'completed' as const, result_version: 1, deadline_at: null, reason: null,
    binding: { ...binding, config: { ...binding.config, agent_profile: { ...binding.config.agent_profile, display_name: '固定核验成员' } },
      agent_work: { kind: 'agent' as const, profile_id: id, goal: '核验', input_refs: [], output_schema: {}, success_criteria: [] } } };
  render(<TaskGraph tasks={[task]} activities={[]} waits={[]} joins={[]} consumptions={[]} collapsedIds={new Set()} onSelect={vi.fn()} onToggle={vi.fn()} />);
  expect(screen.getByRole('button', { name: /成员 · 固定核验成员/ })).toBeTruthy();
  expect(document.querySelectorAll('.graph-edge--parent')).toHaveLength(0);
  expect(screen.getAllByRole('button')).toHaveLength(1);
});
