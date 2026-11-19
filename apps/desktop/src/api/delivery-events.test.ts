import { expect, it } from 'vitest';
import { applyDeletion, emptyProjection, mergeDeliveries, mergeResultPage, reduceStream } from './events';
import { event, id, page, secondId } from '../test/fixtures';
import type { SessionInboxEntry, StreamEvent } from '../generated/contracts';

const entry: SessionInboxEntry = { id, version: 1, source_event_id: event.event_id, target_session_id: id,
  result: { run_id: id, task_id: secondId, lifetime: 'managed', submitted_state: 'completed' }, result_version: 1,
  source_valid: true, consumers: [], delivery_state: 'delivered', viewed_at: null, dependencies: [], attempts: 1, last_error: null };
it('新delivery/admission/session事件按真实联合投影；同version来源/消费者按水位刷新，旧页不复活', () => {
  let state = mergeResultPage(emptyProjection(), id, page([entry]));
  const position = (BigInt(event.event_id) + 1n).toString();
  state = reduceStream(state, { kind: 'durable', event_id: position, event: { ...event, kind: 'delivery.changed', event_id: position, payload: { deliveries: [{ ...entry, source_valid: false }] } } });
  state = mergeDeliveries(state, [entry], event.event_id);
  expect(state.deliveries[id].source_valid).toBe(false);
  state = mergeDeliveries(state, [{ ...entry, source_valid: false, consumers: [{
    id: secondId, run_id: id, task_id: id, execution_session_id: id, target_task_id: secondId,
    result_version: 1, message_boundary: 4, inbox_entry_id: id,
  }] }], position);
  expect(state.deliveries[id].version).toBe(1);
  expect(state.deliveries[id].consumers).toHaveLength(1);
  state = reduceStream(state, { kind: 'durable', event_id: position, event: { ...event, kind: 'admission.stopped', event_id: position,
    payload: { admission_fences: [{ generation: 3, scope: { kind: 'session', workspace_id: id, session_id: id } }] } } });
  expect(state.admissions[id].generation).toBe(3);
  state = applyDeletion(state, { scope: { kind: 'session', workspace_id: id, session_id: id }, epoch: 2, status: 'deleted' });
  state = mergeResultPage(state, id, page([entry]));
  expect(state.deliveries).toEqual({});
});

it('同一delivery事实跨事件/查询重放是真正no-op；较新水位只更新防旧元数据，不替换相同条目/集合', () => {
  const wire: StreamEvent = { kind: 'durable', event_id: event.event_id, event: { ...event, kind: 'delivery.changed', payload: { deliveries: [entry] } } };
  const state = reduceStream(emptyProjection(), wire);
  const replay: StreamEvent = JSON.parse(JSON.stringify(wire));
  expect(reduceStream(state, replay)).toBe(state);
  const queried = mergeResultPage(state, id, page([entry]));
  expect(mergeResultPage(queried, id, page([JSON.parse(JSON.stringify(entry))]))).toBe(queried);
  const advanced = mergeDeliveries(state, [JSON.parse(JSON.stringify(entry))], (BigInt(event.event_id) + 2n).toString());
  expect(advanced.deliveries).toBe(state.deliveries);
  expect(advanced.deliveries[id]).toBe(state.deliveries[id]);
  expect(advanced.deliveryWatermarks[id]).toBe((BigInt(event.event_id) + 2n).toString());
  expect(mergeDeliveries(advanced, [{ ...entry, source_valid: false }], (BigInt(event.event_id) + 1n).toString())).toBe(advanced);
  const emptyWire: StreamEvent = { kind: 'durable', event_id: event.event_id, event: { ...event, kind: 'delivery.changed', payload: { deliveries: [] } } };
  expect(reduceStream(state, emptyWire)).toBe(state);
});

it('全局cursor较新不能吞另一项目迟到通知；同version新消费者/来源事实更新，旧事实/删除后重放不复活', () => {
  const wire = (value: SessionInboxEntry, position: string): StreamEvent => ({ kind: 'durable', event_id: position,
    event: { ...event, workspace_id: secondId, kind: 'delivery.changed', event_id: position, payload: { deliveries: [value] } } });
  let state = { ...emptyProjection(), cursor: (BigInt(event.event_id) + 10n).toString() };
  state = reduceStream(state, wire(entry, event.event_id));
  expect(state.deliveries[id]).toEqual(entry);
  const consumer = { id: secondId, run_id: id, task_id: id, execution_session_id: id, target_task_id: secondId, result_version: 1, message_boundary: 3, inbox_entry_id: id };
  state = reduceStream(state, wire({ ...entry, consumers: [consumer] }, (BigInt(event.event_id) + 1n).toString()));
  expect(state.deliveries[id].consumers).toEqual([consumer]);
  state = reduceStream(state, wire({ ...entry, consumers: [consumer], source_valid: false }, (BigInt(event.event_id) + 2n).toString()));
  const invalid = state;
  expect(state.deliveries[id].source_valid).toBe(false);
  expect(reduceStream(state, wire(entry, event.event_id))).toBe(invalid);
  state = applyDeletion(state, { scope: { kind: 'session', workspace_id: secondId, session_id: id }, epoch: 2, status: 'deleted' });
  expect(state.deliveries[id]).toBeUndefined();
  expect(reduceStream(state, wire(entry, event.event_id))).toBe(state);
  expect(mergeResultPage(state, id, page([entry]))).toBe(state);
});

it('不可变消费者同集合的重排/重新反序列化不制造新投递事实或引用', () => {
  const first = { id: '00000000-0000-4000-8000-000000000010', run_id: id, task_id: id, execution_session_id: id,
    target_task_id: secondId, result_version: 1, message_boundary: 3, inbox_entry_id: id };
  const second = { ...first, id: '00000000-0000-4000-8000-000000000011', task_id: secondId };
  const state = mergeDeliveries(emptyProjection(), [{ ...entry, consumers: [first, second] }], event.event_id);
  const reordered: SessionInboxEntry = JSON.parse(JSON.stringify({ ...entry, consumers: [second, first] }));
  expect(mergeDeliveries(state, [reordered], event.event_id)).toBe(state);
  expect(state.deliveries[id].consumers).toEqual([first, second]);
});
