import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { reduceStream } from '../../api/events';
import { validate } from '../../api/validation';
import { createRuntimeStore } from '../../state/runtime-store';
import type { ExecutionEnvironmentView } from '../../generated/contracts';
import Settings from './Settings';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:8999', token: 'test', protocol_version: 3 });
const environment: ExecutionEnvironmentView = {
  id: '00000000-0000-4000-8000-000000000010', revision: 1, kind: 'python',
  executable_path: 'C:\\用户选择\\existing venv\\Scripts\\python.exe', executable_identity: 'controlled',
  version: '3.13.11', cwd_mode: 'attempt', env_keys: ['USER_CHOICE'], dependency_coverage: 'manifests_only',
  manifest_count: 2, status: 'probed', checked_at: '2026-11-19T00:00:00Z', diagnostic_code: null,
};
function mockApi(items: ExecutionEnvironmentView[] = [environment]) {
  let current = items;
  const writes: any[] = [];
  const requests: string[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname; requests.push(path);
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body as string); writes.push(body);
      const previous = current.find(item => item.id === body.data.id);
      const saved: ExecutionEnvironmentView = { ...environment, ...body.data,
        env_keys: body.data.env === null ? previous?.env_keys ?? [] : Object.keys(body.data.env),
        manifest_count: body.data.dependency_manifest_paths === null ? previous?.manifest_count ?? 0 : body.data.dependency_manifest_paths.length,
        revision: previous ? previous.revision + 1 : 1, status: 'unprobed', version: null, checked_at: null };
      delete (saved as any).env; delete (saved as any).dependency_manifest_paths;
      current = [...current.filter(item => item.id !== saved.id), saved];
      return Response.json(saved);
    }
    if (init.method === 'POST') {
      const updated = { ...current[0], status: 'probed', version: '3.13.11', checked_at: '2026-11-19T00:01:00Z' };
      current = [updated as ExecutionEnvironmentView]; return Response.json(updated);
    }
    const selected = current.find(item => path.endsWith(`/${item.id}`));
    if (selected) return Response.json(selected);
    return Response.json({ items: current, next_cursor: null, watermark: '10' });
  });
  vi.stubGlobal('fetch', fetch);
  return { writes, requests, fetch, setItems: (items: ExecutionEnvironmentView[]) => { current = items; } };
}

it('显示完整选定路径、版本、修订和依赖范围，不把检测等同依赖就绪', async () => {
  mockApi(); render(<Settings client={client()} section="environments" />);
  expect(await screen.findByRole('heading', { name: '运行环境' })).toBeTruthy();
  expect(await screen.findByText(environment.executable_path)).toBeTruthy();
  expect(screen.getByText(/修订 1/)).toBeTruthy();
  expect(screen.getByText(/3.13.11/)).toBeTruthy();
  expect(screen.getByText(/依赖清单.*2/)).toBeTruthy();
  expect(screen.getByText(/版本检测不证明脚本依赖完整/)).toBeTruthy();
});

it.each(['python', 'node', 'powershell', 'bash'])('登记 %s 的用户绝对路径，保存和检测分开', async kind => {
  const api = mockApi([]); const user = userEvent.setup();
  render(<Settings client={client()} section="environments" />);
  await user.click(await screen.findByRole('button', { name: '登记运行环境' }));
  const save = screen.getByRole('button', { name: '保存运行环境' });
  const actions = screen.getByRole('group', { name: '运行环境操作' });
  expect(actions.contains(save) && actions.contains(screen.getByRole('button', { name: '取消编辑' }))).toBe(true);
  await user.selectOptions(screen.getByLabelText('解释器类别'), kind);
  const path = `C:\\用户选择\\${kind} environment\\interpreter.exe`;
  await user.type(screen.getByLabelText('解释器绝对路径'), path);
  await user.click(screen.getByRole('button', { name: '保存运行环境' }));
  await screen.findByText(/运行环境已保存/);
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0].data.executable_path).toBe(path);
  expect(api.writes[0].data.kind).toBe(kind);
  expect(api.requests.some(path => path.endsWith('/probe'))).toBe(false);
  await user.click(screen.getByRole('button', { name: '检测版本' }));
  await screen.findByText(/检测完成/);
  expect(api.requests.some(path => path.endsWith('/probe'))).toBe(true);
});

it('编辑其它设置保留隐藏清单和 env，显式移除才提交空集合', async () => {
  const api = mockApi(); const user = userEvent.setup();
  render(<Settings client={client()} section="environments" />);
  await user.click(await screen.findByRole('button', { name: /编辑 Python/ }));
  expect(screen.getByText(/USER_CHOICE/)).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('工作目录模式'), 'package_copy');
  await user.click(screen.getByRole('button', { name: '保存运行环境' }));
  await screen.findByText(/运行环境已保存/);
  expect(api.writes[0].data.dependency_manifest_paths).toBeNull();
  expect(api.writes[0].data.env).toBeNull();
  expect(api.writes[0].meta.expected_version).toBe(1);
  await user.selectOptions(screen.getByLabelText('依赖清单处理'), 'clear');
  await user.selectOptions(screen.getByLabelText('环境变量处理'), 'clear');
  await user.click(screen.getByRole('button', { name: '保存运行环境' }));
  await waitFor(() => expect(api.writes).toHaveLength(2));
  expect(api.writes[1].data.dependency_manifest_paths).toEqual([]);
  expect(api.writes[1].data.env).toEqual({});
});

it('拒绝相对路径并保留草稿；服务错误显示安全原因', async () => {
  const api = mockApi([]); const user = userEvent.setup();
  render(<Settings client={client()} section="environments" />);
  await user.click(await screen.findByRole('button', { name: '登记运行环境' }));
  await user.type(screen.getByLabelText('解释器绝对路径'), 'Scripts\\python.exe');
  await user.click(screen.getByRole('button', { name: '保存运行环境' }));
  expect((await screen.findByRole('alert')).textContent).toContain('绝对路径');
  expect(api.writes).toHaveLength(0);
  await user.clear(screen.getByLabelText('解释器绝对路径'));
  await user.type(screen.getByLabelText('解释器绝对路径'), environment.executable_path);
  api.fetch.mockImplementationOnce(async () => Response.json({
    error: { code: 'version_conflict', safe_message: '运行环境已改变，请刷新', retryable: false, related_ids: [] },
  }, { status: 409 }));
  await user.click(screen.getByRole('button', { name: '保存运行环境' }));
  expect((await screen.findByRole('alert')).textContent).toContain('运行环境已改变');
  expect((screen.getByLabelText('解释器绝对路径') as HTMLInputElement).value).toBe(environment.executable_path);
});

it('缺解释器和检测失败均显示原因，错误响应不清空编辑内容', async () => {
  const api = mockApi([{ ...environment, status: 'missing_executable', version: null,
    diagnostic_code: 'executable_missing' }]);
  const user = userEvent.setup(); render(<Settings client={client()} section="environments" />);
  expect(await screen.findByText(/缺少解释器/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /编辑 Python/ }));
  api.fetch.mockImplementationOnce(async () => Response.json({
    ...environment, status: 'probe_failed', version: null, diagnostic_code: 'probe_nonzero_exit',
  }));
  await user.click(screen.getByRole('button', { name: '检测版本' }));
  expect(await screen.findByText(/版本命令退出失败/)).toBeTruthy();
  expect((screen.getByLabelText('解释器绝对路径') as HTMLInputElement).value).toBe(environment.executable_path);
});

it('未保存内容通过既有生命周期拦截返回原快捷小窗，放弃后才能返回', async () => {
  mockApi(); const user = userEvent.setup(); const back = vi.fn().mockResolvedValue(undefined);
  render(<Settings client={client()} section="environments" onReturnToQuick={back} />);
  await user.click(await screen.findByRole('button', { name: /编辑 Python/ }));
  await user.type(screen.getByLabelText('解释器绝对路径'), '-draft');
  await user.click(screen.getByRole('button', { name: '返回快捷小窗' }));
  expect(back).not.toHaveBeenCalled();
  expect(screen.getByText('有未保存的设置')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '放弃更改' }));
  await waitFor(() => expect(back).toHaveBeenCalledOnce());
});

it('丢失保存响应后核对专属安全回执，清除 dirty 状态并读取当前版本', async () => {
  const writes: any[] = [];
  const confirmed = { ...environment, revision: 2, cwd_mode: 'package_copy' as const };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'PUT') { writes.push(JSON.parse(init.body as string)); throw new TypeError('controlled disconnect'); }
    if (path.includes('/commands/')) return Response.json({ status: 'confirmed', result: confirmed });
    if (path.endsWith(`/${environment.id}`)) return Response.json(confirmed);
    return Response.json({ items: [environment], next_cursor: null, watermark: '10' });
  });
  const user = userEvent.setup(), close = vi.fn();
  render(<Settings client={client()} section="environments" onClose={close} />);
  await user.click(await screen.findByRole('button', { name: /编辑 Python/ }));
  await user.selectOptions(screen.getByLabelText('工作目录模式'), 'package_copy');
  await user.click(screen.getByRole('button', { name: '保存运行环境' }));
  expect((await screen.findByRole('alert')).textContent).toContain('尚未确认');
  await user.click(screen.getByRole('button', { name: '核对保存结果' }));
  await screen.findByText('已核对运行环境保存结果');
  expect(writes).toHaveLength(1);
  expect((screen.getByLabelText('工作目录模式') as HTMLSelectElement).value).toBe('package_copy');
  await user.click(screen.getByRole('button', { name: '完成' }));
  expect(close).toHaveBeenCalledOnce();
});

it('旧安全保存回执只确认命令，随后读取当前环境而不覆盖已变更配置', async () => {
  const latest = { ...environment, revision: 2, executable_path: 'C:\\用户选择\\updated venv\\Scripts\\python.exe' };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') return Response.json(environment);
    if (new URL(url).pathname.endsWith(`/${environment.id}`)) return Response.json(latest);
    return Response.json({ items: [environment], next_cursor: null, watermark: '10' });
  });
  const user = userEvent.setup(); render(<Settings client={client()} section="environments" />);
  await user.click(await screen.findByRole('button', { name: /编辑 Python/ }));
  await user.click(screen.getByRole('button', { name: '保存运行环境' }));
  await screen.findByText(/运行环境已保存/);
  expect((screen.getByLabelText('解释器绝对路径') as HTMLInputElement).value).toBe(latest.executable_path);
  expect(screen.getByText(/修订 2/)).toBeTruthy();
});

it('检测期间不返回原窗口，完成后沿现有回调返回', async () => {
  const api = mockApi(), user = userEvent.setup(), back = vi.fn().mockResolvedValue(undefined);
  let finish!: (response: Response) => void;
  render(<Settings client={client()} section="environments" onReturnToQuick={back} />);
  await user.click(await screen.findByRole('button', { name: /编辑 Python/ }));
  api.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  await user.click(screen.getByRole('button', { name: '检测版本' }));
  const returning = screen.getByRole('button', { name: '返回快捷小窗' }) as HTMLButtonElement;
  expect(returning.disabled).toBe(true);
  expect(back).not.toHaveBeenCalled();
  finish(Response.json(environment));
  await screen.findByText(/检测完成/);
  await user.click(screen.getByRole('button', { name: '返回快捷小窗' }));
  await waitFor(() => expect(back).toHaveBeenCalledOnce());
});

it('保存回执不伪造全局失效；真实 durable 事件按水位刷新列表且去重', async () => {
  const api = mockApi(); const runtime = client(); const store = createRuntimeStore(runtime);
  const user = userEvent.setup(); render(<Settings client={runtime} runtimeStore={store} section="environments" />);
  await user.click(await screen.findByRole('button', { name: /编辑 Python/ }));
  await user.selectOptions(screen.getByLabelText('工作目录模式'), 'package_copy');
  await user.click(screen.getByRole('button', { name: '保存运行环境' }));
  await screen.findByText(/运行环境已保存/);
  expect(store.getSnapshot().environmentsRevision).toBe(0);
  screen.getByRole('button', { name: '检测版本' }).focus();
  const before = api.requests.length;
  const event = validate('StreamEvent', { kind: 'durable', event_id: '11', event: {
    event_id: '11', seq: null, event_version: 1, kind: 'environment.changed',
    payload: { environment_id: environment.id }, workspace_id: null, session_id: null,
    run_id: null, task_id: null, activity_id: null, causation_id: null, created_at: '2026-11-19T00:02:00Z',
  } });
  await act(async () => { store.update(state => reduceStream(state, event)); });
  await waitFor(() => expect(api.requests.length).toBeGreaterThan(before));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '检测版本' }));
  const revision = store.getSnapshot().environmentsRevision;
  act(() => { store.update(state => reduceStream(state, event)); });
  expect(store.getSnapshot().environmentsRevision).toBe(revision);
});

it.each([false, true])('全局失效刷新编辑器；dirty=%s 时保留本地草稿', async dirty => {
  const api = mockApi(), runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  render(<Settings client={runtime} runtimeStore={store} section="environments" />);
  await user.click(await screen.findByRole('button', { name: /编辑 Python/ }));
  if (dirty) await user.type(screen.getByLabelText('解释器绝对路径'), '-draft');
  const latest = { ...environment, revision: 2, executable_path: 'C:\\selected\\new python.exe' };
  api.setItems([latest]);
  const event = validate('StreamEvent', { kind: 'durable', event_id: '12', event: {
    event_id: '12', seq: null, event_version: 1, kind: 'environment.changed',
    payload: { environment_id: environment.id }, workspace_id: null, session_id: null,
    run_id: null, task_id: null, activity_id: null, causation_id: null, created_at: '2026-11-19T00:03:00Z',
  } });
  const before = api.requests.length;
  act(() => { store.update(state => reduceStream(state, event)); });
  await waitFor(() => expect(api.requests.length).toBeGreaterThan(before));
  await waitFor(() => expect((screen.getByLabelText('解释器绝对路径') as HTMLInputElement).value)
    .toBe(dirty ? environment.executable_path + '-draft' : latest.executable_path));
});
