import { expect, it } from 'vitest';
import { emptyProjection, reduceStream } from './events';
import { event } from '../test/fixtures';
import { memory, memoryPolicy } from '../test/memory-fixtures';
import { validate } from './validation';

it('全局Memory事件沿原投影唤醒，不存储正文，也不漏掉workspace_id=null的通知', () => {
  let state = emptyProjection();
  for (const [offset, kind] of [[1, 'memory.changed'], [2, 'memory.policy_changed']] as const) {
    const position = String(BigInt(event.event_id) + BigInt(offset));
    const wire = validate('StreamEvent', { kind: 'durable', event_id: position, event: { ...event, event_id: position, kind,
      workspace_id: null, session_id: null, run_id: null, seq: null, payload: { records: [{ id: memory.id, scope: memory.scope,
        revision: 4, status: 'confirmed' }], policies: [memoryPolicy] } } });
    state = reduceStream(state, wire);
    expect(state.memoryRevision).toBe(offset);
  }
  expect(JSON.stringify(state)).not.toContain(memory.text);
});
