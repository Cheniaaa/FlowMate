import { expect, it } from 'vitest';
import type { KnowledgeNotice, StreamEvent, WorkspaceSnapshot } from '../generated/contracts';
import { event, id, page, secondId } from '../test/fixtures';
import { applyDeletion, emptyProjection, reduceStream, resetWorkspace } from './events';
import { validate } from './validation';

const sourceA = '00000000-0000-4000-8000-000000000081';
const sourceB = '00000000-0000-4000-8000-000000000082';
const jobA = '00000000-0000-4000-8000-000000000083';
const jobB = '00000000-0000-4000-8000-000000000084';
const profile = '00000000-0000-4000-8000-000000000085';
const position = (offset: number) => (BigInt(event.event_id) + BigInt(offset)).toString();

function notice(workspaceId: string | null, offset: number,
  revisions: Partial<Omit<KnowledgeNotice, 'workspace_id'>>): StreamEvent {
  return validate('StreamEvent', { kind: 'durable', event_id: position(offset),
    event: { ...event, kind: 'knowledge.changed', event_id: position(offset), workspace_id: workspaceId,
      session_id: null, run_id: null, seq: null, payload: { workspace_id: workspaceId,
        source_revisions: {}, job_revisions: {}, settings_revision: null, profile_revisions: {}, ...revisions } } });
}

it('同一 knowledge 事件双订阅重放保持投影引用，不从通知重建实体', () => {
  const initial = emptyProjection();
  const wire = notice(id, 0, { source_revisions: { [sourceA]: 2 }, job_revisions: { [jobA]: 1 } });
  const state = reduceStream(initial, wire);
  expect(state.knowledgeNotices[id]).toEqual({ workspace_id: id, source_revisions: { [sourceA]: 2 },
    job_revisions: { [jobA]: 1 }, settings_revision: null, profile_revisions: {}, watermark: position(0) });
  expect(state.cursor).toBe('9007199254740993');
  expect(reduceStream(state, validate('StreamEvent', JSON.parse(JSON.stringify(wire))))).toBe(state);
  expect(state.runs).toBe(initial.runs);
  expect(state.tasks).toBe(initial.tasks);
  expect(state.resources).toBe(initial.resources);
  expect(state.memoryRevision).toBe(0);
});

it('A 项目通知不替换 B 项目状态，全局较新游标不吞掉另一项目迟到通知', () => {
  const first = reduceStream(emptyProjection(), notice(secondId, 10, { source_revisions: { [sourceB]: 4 } }));
  const state = reduceStream(first, notice(id, 1, { source_revisions: { [sourceA]: 2 } }));
  expect(state.knowledgeNotices[secondId]).toBe(first.knowledgeNotices[secondId]);
  expect(state.knowledgeNotices[id].source_revisions).toEqual({ [sourceA]: 2 });
  expect(state.knowledgeNotices[secondId].source_revisions).toEqual({ [sourceB]: 4 });
  expect(state.cursor).toBe(position(10));
});

it('连续及交错通知累计受影响的 source/job 身份，每个身份和设置只保留最高修订', () => {
  let state = reduceStream(emptyProjection(), notice(id, 1, {
    source_revisions: { [sourceA]: 3 }, job_revisions: { [jobA]: 2 }, settings_revision: 4,
  }));
  state = reduceStream(state, notice(id, 3, {
    source_revisions: { [sourceB]: 1 }, job_revisions: { [jobB]: 3 }, settings_revision: 5,
  }));
  state = reduceStream(state, notice(id, 2, {
    source_revisions: { [sourceA]: 2 }, job_revisions: { [jobA]: 4 }, settings_revision: 3,
  }));
  expect(state.knowledgeNotices[id]).toEqual({ workspace_id: id,
    source_revisions: { [sourceA]: 3, [sourceB]: 1 }, job_revisions: { [jobA]: 4, [jobB]: 3 },
    settings_revision: 5, profile_revisions: {}, watermark: position(3) });
  expect(reduceStream(state, notice(id, 1, {
    source_revisions: { [sourceA]: 3 }, job_revisions: { [jobA]: 2 }, settings_revision: 4,
  }))).toBe(state);
});

it('应用级 profile 通知使用独立 global 键，连续通知合并且不替换项目通知', () => {
  const project = reduceStream(emptyProjection(), notice(id, 1, { source_revisions: { [sourceA]: 1 } }));
  let state = reduceStream(project, notice(null, 2, { profile_revisions: { [profile]: 3 } }));
  state = reduceStream(state, notice(null, 3, { profile_revisions: { [secondId]: 2 } }));
  state = reduceStream(state, notice(null, 4, { profile_revisions: { [profile]: 2 } }));
  expect(state.knowledgeNotices[id]).toBe(project.knowledgeNotices[id]);
  expect(state.knowledgeNotices.global).toEqual({ workspace_id: null, source_revisions: {},
    job_revisions: {}, settings_revision: null, profile_revisions: { [profile]: 3, [secondId]: 2 },
    watermark: position(4) });
});

it('重连快照推进对应项目与 global 的失效水位，保留已有身份和其他项目引用', () => {
  let state = reduceStream(emptyProjection(), notice(id, 1, { source_revisions: { [sourceA]: 2 } }));
  state = reduceStream(state, notice(secondId, 2, { job_revisions: { [jobB]: 1 } }));
  state = reduceStream(state, notice(null, 3, { profile_revisions: { [profile]: 2 } }));
  const before = state;
  const snapshot: WorkspaceSnapshot = { workspace: { id, version: 1, name: '项目 A', directory_resource_id: null },
    sessions: page([]), active_runs: page([]), pending_questions: page([]), pending_approvals: page([]),
    resources: page([]), grants: page([]), watermark: position(10) };
  state = resetWorkspace(state, snapshot);
  expect(state.knowledgeNotices[id].source_revisions).toEqual({ [sourceA]: 2 });
  expect(state.knowledgeNotices[id].watermark).toBe(position(10));
  expect(state.knowledgeNotices.global.profile_revisions).toEqual({ [profile]: 2 });
  expect(state.knowledgeNotices.global.watermark).toBe(position(10));
  expect(state.knowledgeNotices[secondId]).toBe(before.knowledgeNotices[secondId]);
  expect(reduceStream(state, notice(id, 4, { source_revisions: { [sourceA]: 1 } }))).toBe(state);
});

it('删除项目清理其通知并阻止迟到重放；删除单会话保留项目通知', () => {
  const first = reduceStream(emptyProjection(), notice(id, 1, { source_revisions: { [sourceA]: 2 } }));
  const sessionDeleted = applyDeletion(first, {
    scope: { kind: 'session', workspace_id: id, session_id: secondId }, epoch: 2, status: 'deleted',
  });
  expect(sessionDeleted.knowledgeNotices[id]).toBe(first.knowledgeNotices[id]);
  const deleted = applyDeletion(sessionDeleted, {
    scope: { kind: 'workspace', workspace_id: id, session_id: null }, epoch: 2, status: 'deleted',
  });
  expect(deleted.knowledgeNotices[id]).toBeUndefined();
  expect(reduceStream(deleted, notice(id, 2, { source_revisions: { [sourceA]: 3 } })).knowledgeNotices)
    .toBe(deleted.knowledgeNotices);
});
