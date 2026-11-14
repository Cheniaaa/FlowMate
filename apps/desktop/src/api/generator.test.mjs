// @vitest-environment node
// Node 生成器测试不进入 WebView 的 TypeScript 编译入口。
import { describe, expect, it } from 'vitest';
import { generateContracts } from '../../scripts/generate-contracts.mjs';

describe('独立根 Schema 生成', () => {
  it('本地 $defs 与 nullable union 保留；重复名称仅位于各根 namespace', async () => {
    const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: { Item: { type: 'object', properties: { value: { type: 'string', minLength: 1, maxLength: 1 } }, required: ['value'], additionalProperties: false } }, type: 'object', properties: { item: { anyOf: [{ $ref: '#/$defs/Item' }, { type: 'null' }] } }, required: ['item'], additionalProperties: false };
    const generated = await generateContracts({ schema_version: 2, roots: { First: { mode: 'serialization', schema }, Second: { mode: 'serialization', schema } } });
    expect(generated['contracts.ts']).toContain('namespace FirstSchema');
    expect(generated['contracts.ts']).toContain('namespace SecondSchema');
    expect(generated['contracts.ts']).toMatch(/Item \| null/);
    expect(generated['validators.d.ts']).toContain('value is First');
    const validators = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(generated['validators.js']).toString('base64')}`);
    expect(validators.First({ item: { value: '🙂' } })).toBe(true);
    expect(validators.Second({ item: null })).toBe(true);
    expect(validators.First({ item: { value: 2 } })).toBe(false);
    expect(validators.First({ item: { value: 'ab' } })).toBe(false);
    expect(validators.Second({ item: null, extra: true })).toBe(false);
    expect(generated['validators.js']).not.toMatch(/\bnew Function\b|\beval\(/);
  });
  it('拒绝旧 Schema 代际，不生成兼容层', async () => {
    await expect(generateContracts({ schema_version: 1, roots: {} })).rejects.toThrow('不支持的公共 Schema 版本');
  });
  it('重复和递归引用保持各根类型、必填与额外字段边界', async () => {
    const roots = Object.fromEntries([['TextTree', { type: 'string', minLength: 1, maxLength: 1 }],
      ['NumberTree', { type: 'integer' }]].map(([name, value]) => [name, { mode: 'serialization', schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: { Node: { type: 'object', properties: { value, children: { type: 'array', items: { $ref: '#/$defs/Node' } } },
        required: ['value'], additionalProperties: false } },
      type: 'object', properties: { left: { $ref: '#/$defs/Node' }, right: { $ref: '#/$defs/Node' } },
      required: ['left', 'right'], additionalProperties: false,
    } }]));
    const generated = await generateContracts({ schema_version: 2, roots });
    const validators = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(generated['validators.js']).toString('base64')}`);
    expect(validators.TextTree({ left: { value: '🙂', children: [{ value: '文' }] }, right: { value: 'x' } })).toBe(true);
    expect(validators.NumberTree({ left: { value: 1, children: [{ value: 2 }] }, right: { value: 3 } })).toBe(true);
    expect(validators.TextTree({ left: { value: 'a', children: [{ value: 2 }] }, right: { value: 'b' } })).toBe(false);
    expect(validators.NumberTree({ left: { value: 1 }, right: { value: '2' } })).toBe(false);
    expect(validators.TextTree({ left: { value: 'a' }, right: {} })).toBe(false);
    expect(validators.TextTree({ left: { value: 'a', extra: true }, right: { value: 'b' } })).toBe(false);
    expect(generated['validators.js']).not.toMatch(/\bnew Function\b|\beval\(/);
  });
});
