import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useSyncExternalStore } from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../src/api/client';
import { McpClient } from '../src/api/mcp';
import { createRuntimeStore } from '../src/state/runtime-store';
import McpPanel from '../src/features/capabilities/McpPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({ configured: false })) }));
let server: ChildProcessWithoutNullStreams, exited: Promise<unknown>;
let fixture: { connection: ConstructorParameters<typeof RuntimeClient>[0]; server_id: string; workspace_id: string; directory: string };
beforeAll(async () => {
  server = spawn(resolve('../../.venv/Scripts/python.exe'), ['tests/m2/mcp_management_ui_server.py'], {
    cwd: resolve('../..'), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
      PYTHONIOENCODING: 'utf-8', PYTHONPATH: `${resolve('../../packages')};${resolve('../..')}` },
  });
  exited = new Promise(done => server.once('exit', done));
  fixture = await new Promise((done, reject) => {
    let text = '', errors = '';
    server.stderr.on('data', chunk => { errors += String(chunk); });
    server.once('error', reject);
    server.once('exit', () => reject(new Error(errors)));
    server.stdout.on('data', chunk => {
      text += String(chunk);
      if (text.includes('\n')) done(JSON.parse(text.split('\n')[0]));
    });
  });
}, 30_000);
afterAll(async () => { server?.stdin.end('\n'); await exited; }, 20_000);

it('真实发现后显式保存选择，另一窗通知更新；本窗修改保持、空选择持久化且不重复发现', { timeout: 30_000 }, async () => {
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => nativeFetch(input, {
    ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Origin: 'http://tauri.localhost' },
  }));
  const client = new RuntimeClient(fixture.connection), mcp = new McpClient(fixture.connection);
  const stores = [createRuntimeStore(client), createRuntimeStore(client)];
  const controllers = [new AbortController(), new AbortController()];
  const streams: Promise<void>[] = [], connected = new Set<number>();
  function Panel({ index }: { index: number }) {
    const refreshKey = useSyncExternalStore(stores[index].subscribe, () => stores[index].getSnapshot().mcpRevision);
    return <McpPanel client={mcp} refreshKey={refreshKey} initialServerId={fixture.server_id} />;
  }
  const main = render(<Panel index={0} />), observer = render(<Panel index={1} />);
  const mainUi = within(main.container), observerUi = within(observer.container);
  try {
    for (let index = 0; index < 2; index++) streams.push(stores[index].loadWorkspace(fixture.workspace_id, {
      snapshot: async () => {}, event: async () => {},
      connection: async state => { if (state === 'connected') connected.add(index); },
    }, controllers[index].signal));
    await waitFor(() => expect(connected.size).toBe(2));
    fireEvent.click(await mainUi.findByRole('button', { name: '连接并发现工具' }));
    const echo = await mainUi.findByRole('checkbox', { name: '允许工具 echo' }, { timeout: 10_000 });
    await observerUi.findByRole('checkbox', { name: '允许工具 echo' });
    const lists = () => readFileSync(resolve(fixture.directory, 'remote/receipts.jsonl'), 'utf-8')
      .trim().split('\n').map(line => JSON.parse(line));
    const listCount = lists().filter(item => item.method === 'list').length;
    expect(echo).toHaveProperty('checked', false);
    // 两个真实 SSE 订阅会重建查询视图，操作时重新定位当前 DOM。
    fireEvent.click(await mainUi.findByRole('checkbox', { name: '允许工具 echo' }));
    await waitFor(() => expect(mainUi.getByRole('checkbox', { name: '允许工具 echo' })).toHaveProperty('checked', true));
    fireEvent.click(mainUi.getByRole('button', { name: '保存允许的工具' }));
    await mainUi.findByText('当前固定选择：echo');
    await observerUi.findByText('当前固定选择：echo');
    fireEvent.click(observerUi.getByRole('checkbox', { name: '允许工具 number' }));
    fireEvent.click(await mainUi.findByRole('checkbox', { name: '允许工具 echo' }));
    fireEvent.click(mainUi.getByRole('button', { name: '保存允许的工具' }));
    await mainUi.findByText('当前固定选择：无');
    expect(observerUi.getByRole('checkbox', { name: '允许工具 number' })).toHaveProperty('checked', true);
    fireEvent.click(observerUi.getByRole('button', { name: '放弃工具选择修改' }));
    await observerUi.findByText('当前固定选择：无');
    expect((await mcp.mcpServer(fixture.server_id)).selection?.selected_names).toEqual([]);
    expect(lists().filter(item => item.method === 'list')).toHaveLength(listCount);
    expect(lists().filter(item => item.method === 'call')).toHaveLength(0);
  } finally {
    main.unmount(); observer.unmount(); controllers.forEach(controller => controller.abort());
    await Promise.all(streams); vi.unstubAllGlobals();
  }
});
