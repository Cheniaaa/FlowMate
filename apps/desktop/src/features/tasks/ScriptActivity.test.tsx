import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ActivityView } from '../../generated/contracts';
import { id } from '../../test/fixtures';
import ScriptActivity from './ScriptActivity';

it('单独展示已执行事实与产物采集失败', () => {
  const activity: ActivityView = { id, version: 1, run_id: id, task_id: id, kind: 'tool',
    operation: 'skills.run_script', state: 'failed', error: 'script_output_limit',
    dependencies: [], usage: null, actual_units: null,
    script_execution: { skill_id: id, content_hash: 'a'.repeat(64), script_relative_path: 'scripts/report.py',
      environment_id: id, environment_revision: 1, attempt_id: id, exit_code: 0,
      termination_reason: 'exited', truncated: false, outputs: [], collection_error: 'script_output_limit',
      external_costs: 'unknown' } };
  render(<ScriptActivity activity={activity} />);
  expect(screen.getByText('进程已执行，产物采集失败')).toBeTruthy();
  expect(screen.getByText(/退出码 0/)).toBeTruthy();
});
