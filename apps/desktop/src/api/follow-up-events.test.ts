import { expect, it } from 'vitest';
import { applyDeletion, emptyProjection, mergeFollowUpIntents, mergePendingUserCommands, reduceStream, resetWorkspace } from './events';
import { validate } from './validation';
import { event, followUpIntent, id, page, pendingUserCommand, secondId } from '../test/fixtures';
import type { StreamEvent } from '../generated/contracts';

it('无run_id的命令事件投影queued/applied/cancelled；旧查询与重放不能覆盖较新状态', () => {
  const wire = (position: string, state: 'queued' | 'applied' | 'cancelled'): StreamEvent => ({
    kind: 'durable', event_id: position, event: { ...event, event_id: position, kind: `command.${state}`, run_id: null,
      payload: { ...event.payload, runs: [], pending_commands: [{ ...pendingUserCommand, state, command_id: state === 'cancelled' ? secondId : pendingUserCommand.command_id,
        run_id: state === 'applied' ? secondId : null, reason: state === 'cancelled' ? 'deadline_exceeded' : null }] } },
  });
  let state = reduceStream(emptyProjection(), validate('StreamEvent', wire('101', 'queued')));
  expect(state.pendingUserCommands[pendingUserCommand.command_id].state).toBe('queued');
  state = reduceStream(state, validate('StreamEvent', wire('103', 'applied')));
  state = mergePendingUserCommands(state, [pendingUserCommand], '102');
  state = reduceStream(state, wire('101', 'queued'));
  expect(state.pendingUserCommands[pendingUserCommand.command_id].state).toBe('applied');
  expect(state.pendingUserCommands[pendingUserCommand.command_id].run_id).toBe(secondId);
  state = reduceStream(state, wire('104', 'cancelled'));
  expect(state.pendingUserCommands[secondId].reason).toBe('deadline_exceeded');
  expect(state.pendingUserCommands[pendingUserCommand.command_id].state).toBe('applied');
});

it('同Run意图active→paused→active依事件水位合并；policy_version不充当生命周期版本', () => {
  let state = mergeFollowUpIntents(emptyProjection(), [followUpIntent], '101');
  const paused = { ...followUpIntent, status: 'paused' as const, paused_task_ids: [secondId], reason: 'yield_to_user' };
  state = reduceStream(state, validate('StreamEvent', { kind: 'durable', event_id: '103', event: { ...event,
    kind: 'run.yielded', event_id: '103', payload: { ...event.payload, runs: [], follow_up_intents: [paused] } } }));
  state = mergeFollowUpIntents(state, [followUpIntent], '102');
  expect(state.followUpIntents[followUpIntent.id]).toEqual(paused);
  state = mergeFollowUpIntents(state, [followUpIntent], '104');
  expect(Object.values(state.followUpIntents)).toEqual([followUpIntent]);
  expect(state.followUpIntents[followUpIntent.id].policy_version).toBe(1);
});

it('已加载命令/意图随快照保留水位，删除后迟到查询和事件不能恢复正文', () => {
  let state = mergePendingUserCommands(emptyProjection(), [pendingUserCommand], event.event_id);
  state = mergeFollowUpIntents(state, [followUpIntent], event.event_id);
  state = resetWorkspace(state, { workspace: { id, version: 1, name: '项目', directory_resource_id: null },
    sessions: page([{ id, workspace_id: id, version: 1, kind: 'interaction', archived: false, title: '会话', agent_profile_id: id }]),
    active_runs: page([]), pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: event.event_id });
  expect(state.pendingUserCommands[pendingUserCommand.command_id].start.text).toBe('新的用户目标');
  state = applyDeletion(state, { scope: { kind: 'workspace', workspace_id: id, session_id: null }, status: 'deleted', epoch: 2 });
  expect(state.pendingUserCommands).toEqual({});
  expect(state.followUpIntents).toEqual({});
  state = mergePendingUserCommands(state, [pendingUserCommand], '9007199254740994');
  state = mergeFollowUpIntents(state, [followUpIntent], '9007199254740994');
  expect(state.pendingUserCommands).toEqual({});
  expect(state.followUpIntents).toEqual({});
});

it('Session尚未加载的命令事件也归属真实工作区，工作区删除会清正文并阻挡重放', () => {
  const wire = validate('StreamEvent', { kind: 'durable', event_id: '101', event: { ...event, kind: 'command.queued', run_id: null,
    event_id: '101', payload: { ...event.payload, runs: [], pending_commands: [pendingUserCommand], follow_up_intents: [followUpIntent] } } });
  let state = reduceStream(emptyProjection(), wire);
  state = applyDeletion(state, { scope: { kind: 'workspace', workspace_id: id, session_id: null }, status: 'deleted', epoch: 2 });
  expect(state.pendingUserCommands).toEqual({});
  expect(state.followUpIntents).toEqual({});
  expect(reduceStream(state, wire)).toBe(state);
});
