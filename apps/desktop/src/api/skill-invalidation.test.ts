import { expect, it } from 'vitest';
import { emptyProjection, reduceStream, resetWorkspace } from './events';
import { validate } from './validation';
import { event as baseEvent, id, page, secondId } from '../test/fixtures';

it('无正文Skill通知按事件水位失效，相同管理revision的binding变化仍刷新', () => {
  function notice(sequence: string) {
    const event = { ...baseEvent, event_id: sequence, kind: 'skill.changed',
      workspace_id: null, session_id: null, run_id: null, task_id: null,
      payload: { skill_id: secondId, scope: { kind: 'user_global', workspace_id: null, session_id: null }, revision: 1, status: 'active' } };
    return { kind: 'durable' as const, event_id: sequence, event: validate('PublicEvent', event) };
  }
  let state = reduceStream(emptyProjection(), notice('10'));
  expect(state.skillsRevision).toBe(1);
  state = reduceStream(state, notice('11'));
  expect(state.skillsRevision).toBe(2);
  expect(reduceStream(state, notice('10')).skillsRevision).toBe(2);
  const reset = resetWorkspace(state, { workspace: { id, version: 1, name: '项目', directory_resource_id: null },
    sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]),
    resources: page([]), grants: page([]), watermark: '12' });
  expect(reset.skillsRevision).toBe(3);
  expect(() => validate('PublicEvent', { ...notice('13').event, payload: {
    ...notice('13').event.payload, description: '不允许正文',
  } })).toThrow();
});
