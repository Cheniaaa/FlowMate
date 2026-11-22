import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from './client';

afterEach(() => { vi.unstubAllGlobals(); });
it.each(['view', 'command-status'])('%s 通用响应验证拒绝混入执行 env 的服务端对象', async kind => {
  const value = {
    id: '00000000-0000-4000-8000-000000000010', revision: 1, kind: 'python',
    executable_path: 'C:\\selected\\python.exe', executable_identity: 'controlled',
    version: null, cwd_mode: 'attempt', env_keys: [], dependency_coverage: 'unverified',
    manifest_count: 0, status: 'unprobed', checked_at: null, diagnostic_code: null,
    env: { PRIVATE: 'must-not-be-accepted' },
  };
  vi.stubGlobal('fetch', async () => Response.json(kind === 'view' ? value : { status: 'confirmed', result: value }));
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:8999', token: 'test', protocol_version: 4 });
  const pending = kind === 'view' ? client.executionEnvironment(value.id) : client.executionEnvironmentCommandStatus(value.id);
  await expect(pending).rejects.toThrow('Runtime 契约校验失败');
});
