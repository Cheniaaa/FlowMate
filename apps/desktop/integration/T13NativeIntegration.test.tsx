import { readFileSync } from 'node:fs';
import { useSyncExternalStore } from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RuntimeClient } from '../src/api/client';
import { McpClient } from '../src/api/mcp';
import CapabilityLibrary from '../src/features/capabilities/CapabilityLibrary';
import { createRuntimeStore } from '../src/state/runtime-store';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async command => {
  if (command === 'credential_status') return { configured: true };
  throw new Error('此联合用例只查询已在 Rust 新建的合成凭据状态');
}) }));
const fixturePath = process.env.FLOWMATE_T13_NATIVE_FIXTURE;
it.skipIf(!fixturePath)('真实宿主下能力库确认保存与显式发现使用实际 API/私有绑定', { timeout: 25_000 }, async () => {
  const fixture = JSON.parse(readFileSync(fixturePath!, 'utf-8'));
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Origin', 'http://127.0.0.1:5173');
    // Node 可能复用即将被 Runtime 一秒空闲超时回收的 socket；SSE 保持长连接。
    if (headers.get('Accept') !== 'text/event-stream') headers.set('Connection', 'close');
    return nativeFetch(input, { ...init, headers });
  });
  const controllers = [new AbortController(), new AbortController()];
  const streams: Promise<void>[] = [];
  try {
    const client = new RuntimeClient(fixture.connection), mcp = new McpClient(fixture.connection);
    const stores = [createRuntimeStore(client), createRuntimeStore(client)];
    const workspace = (await client.workspaces()).items[0], connected = new Set<number>(), notices: unknown[] = [];
    const target = { server_id: fixture.config.id, workspace_id: null };
    function Library({ index }: { index: number }) {
      const revision = useSyncExternalStore(stores[index].subscribe, () => stores[index].getSnapshot().mcpRevision);
      return <CapabilityLibrary client={client} onClose={() => {}} mcpTarget={target} mcpRevision={revision} />;
    }
    for (let index = 0; index < 2; index++) streams.push(stores[index].loadWorkspace(workspace.id, {
      snapshot: async () => {},
      event: async event => { if (event.kind === 'durable' && event.event.kind === 'mcp.changed') notices.push(event.event.payload); },
      connection: async state => { if (state === 'connected') connected.add(index); },
    }, controllers[index].signal));
    const main = render(<Library index={0} />), observer = render(<Library index={1} />);
    const mainUi = within(main.container), observerUi = within(observer.container);
    await waitFor(() => expect(connected.size).toBe(2), { timeout: 7000 });
    const mainDetail = within(await mainUi.findByRole('region', { name: 'MCP 配置详情' }));
    await mainDetail.findByText('已保存 · 工具数量未知');
    expect(mainDetail.queryByText(fixture.config.id)).toBeNull();
    fireEvent.click(mainUi.getByRole('button', { name: '连接并发现工具' }));
    await waitFor(() => within(mainUi.getByRole('region', { name: 'MCP 配置详情' }))
      .getByText('已连接 · 1 个工具'), { timeout: 15_000 });
    await waitFor(() => within(observerUi.getByRole('region', { name: 'MCP 配置详情' }))
      .getByText('已连接 · 1 个工具'), { timeout: 7000 });
    const observerDetail = within(await observerUi.findByRole('region', { name: 'MCP 配置详情' }));
    expect(observerDetail.queryByText(fixture.config.id)).toBeNull();
    const echo = await mainUi.findByRole('checkbox', { name: '允许工具 echo' });
    expect(echo.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(mainUi.getByRole('button', { name: '保存允许的工具' }));
    await mainUi.findByText('当前固定选择：echo');
    await observerUi.findByText('当前固定选择：echo', {}, { timeout: 7000 });
    expect((await mcp.mcpServer(fixture.config.id)).selection?.selected_names).toEqual(['echo']);
    fireEvent.click(mainUi.getByRole('button', { name: '添加 MCP' }));
    fireEvent.change(mainUi.getByLabelText('名称'), { target: { value: '只保存合成 stdio' } });
    fireEvent.change(mainUi.getByLabelText('Command'), { target: { value: 'not-started.exe' } });
    fireEvent.change(mainUi.getByLabelText('Args（JSON 字符串数组）'), { target: { value: '["中文 参数", ""]' } });
    const enabled = mainUi.getByRole('checkbox', { name: '启用此配置' });
    expect(enabled.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(enabled);
    fireEvent.click(mainUi.getByRole('button', { name: '预览配置' }));
    await mainUi.findByRole('button', { name: '确认保存配置' });
    expect((await mcp.mcpServers({ scope_kind: 'user_global' })).items).toHaveLength(1);
    fireEvent.click(mainUi.getByRole('button', { name: '确认保存配置' }));
    await mainUi.findByRole('button', { name: /只保存合成 stdio/ });
    await observerUi.findByRole('button', { name: /只保存合成 stdio/ });
    const saved = (await mcp.mcpServers({ scope_kind: 'user_global' })).items.find(item => item.config.display_name === '只保存合成 stdio')!;
    expect(saved.config.enabled).toBe(false);
    expect(saved.state).toBe('stopped');
    expect(saved.catalog).toBeNull();
    expect(saved.config.args).toEqual(['中文 参数', '']);
    expect(notices.length).toBeGreaterThanOrEqual(4);
    expect(notices.every(value => Object.keys(value as object).sort().join() === 'config_revision,scope,server_id')).toBe(true);
    main.unmount(); observer.unmount();
  } finally {
    controllers.forEach(controller => controller.abort());
    await Promise.all(streams);
    vi.unstubAllGlobals();
  }
});
