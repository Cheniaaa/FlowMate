import { expect, it } from 'vitest';
import { splitMcpJson } from './mcp-import';

it('JSON 配置的服务器名和环境键按原值拆分，原型同名键不丢失也不泄露秘密', () => {
  const result = splitMcpJson('{"mcpServers":{"__proto__":{"command":"synthetic.exe","args":[],"env":{"__proto__":"synthetic-memory-only"}}}}');
  const output = JSON.parse(result.sanitized_json);
  expect(Object.keys(output.mcpServers)).toEqual(['__proto__']);
  const env = output.mcpServers.__proto__.env;
  expect(Object.keys(env)).toEqual(['__proto__']);
  expect(result.secrets.get(env.__proto__.secret_slot)).toBe('synthetic-memory-only');
  expect(result.sanitized_json).not.toContain('synthetic-memory-only');
});
