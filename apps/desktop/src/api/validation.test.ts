import { describe, expect, it } from 'vitest';
import { validate } from './validation';
import { event, id, limits, model, run } from '../test/fixtures';

describe('真实生成 Schema 的边界校验', () => {
  it('拒绝同时缺少价格快照与unknown原因', () => {
    expect(() => validate('RunSnapshot', { ...run, config: { ...run.config,
      model_pricing: null, pricing_unknown_reason: null,
    } })).toThrow();
  });
  it('接收真实公开事件、nullable 价格与省略默认字段的命令', () => {
    expect(validate('PublicEvent', event)).toEqual(event);
    expect(validate('ModelProfile', model)).toEqual(model);
    const command = { meta: { command_id: id }, data: { agent_profile_id: id, model_profile_id: id, text: 'hi' } };
    expect(validate('StartRunCommand', command)).toEqual(command);
    expect(command).not.toHaveProperty('data.resource_ids');
  });
  it('拒绝 kind/payload 不匹配与额外/内部字段，不删除或改写输入', () => {
    expect(() => validate('PublicEvent', { ...event, kind: 'workspace.created' })).toThrow();
    expect(() => validate('PublicEvent', { ...event, payload: { ...event.payload, checkpoints: [] } })).toThrow();
    const extra = { ...model, api_key: 'public-test-key-not-a-secret' };
    expect(() => validate('ModelProfile', extra)).toThrow();
    expect(extra.api_key).toBe('public-test-key-not-a-secret');
  });
  it.each([12, '01', '-1', '1.5', 'oops'])('拒绝金额/事件游标 %s，仅允许无损十进制字符串', value => {
    expect(() => validate('PublicEvent', { ...event, event_id: value })).toThrow();
    expect(() => validate('BudgetSnapshot', { id, version: 1, run_id: id, limits, spent_units: value, reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 })).toThrow();
  });
  it('保留超过安全整数的合法金额', () => {
    const command = { meta: { command_id: id }, data: { agent_profile_id: id, model_profile_id: id, text: 'hi', limits: { max_cost_units: '9007199254740993' } } };
    expect(validate('StartRunCommand', command)).toEqual(command);
  });
  it('拒绝错误 uuid/date-time 与不能强制转换的容量', () => {
    expect(() => validate('PublicEvent', { ...event, workspace_id: 'not-uuid' })).toThrow();
    expect(() => validate('PublicEvent', { ...event, created_at: 'yesterday' })).toThrow();
    expect(() => validate('PublicEvent', { ...event, created_at: '2026-11-07T12:00:00' })).toThrow();
    expect(() => validate('ModelProfile', { ...model, context_window_tokens: '8192' })).toThrow();
  });
  it.each(['bad', '-1', 'NaN', 'Infinity', 1.5])('拒绝非 wire 价格 %s', price => {
    expect(() => validate('ModelProfile', { ...model, pricing: { ...model.pricing, input_per_million: price } })).toThrow();
  });
});
