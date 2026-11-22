import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { reduceStream } from '../../api/events';
import { createRuntimeStore } from '../../state/runtime-store';
import { event, modelResolution, page, secondId } from '../../test/fixtures';
import { maintenanceDetail, maintenanceNotice, maintenancePolicy, maintenanceRun, maintenanceTask, sourceBoundary, sourceItem } from '../../test/maintenance-fixtures';
import MemoryMaintenance from './MemoryMaintenance';
import MemoryPage from './MemoryPage';
import { memory } from '../../test/memory-fixtures';
afterEach(() => vi.unstubAllGlobals());

function server(conflict = false, modelBlocked = false) {
  const writes: any[] = [], reads: URL[] = [];
  let notices = [maintenanceNotice];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), path = parsed.pathname; reads.push(parsed);
    if (init.method === 'POST') {
      writes.push(JSON.parse(String(init.body)));
      return conflict ? Response.json({ error: { code: 'version_conflict', safe_message: '策略版本已改变', retryable: false, related_ids: [] } }, { status: 409 }) : Response.json(maintenanceTask);
    }
    if (path.endsWith('/settings/memory')) return Response.json({ ...maintenancePolicy, scope: parsed.searchParams.get('scope_kind') === 'workspace'
      ? { kind: 'workspace', workspace_id: parsed.searchParams.get('workspace_id'), session_id: null } : maintenancePolicy.scope });
    if (path.endsWith('/resolved')) return Response.json({ ...modelResolution,
      blockers: modelBlocked ? ['model_unavailable'] : [] });
    if (path.includes('/source-boundaries/')) return Response.json(sourceBoundary);
    if (path.endsWith('/tasks')) return Response.json(page(parsed.searchParams.has('workspace_id') && parsed.searchParams.get('workspace_id') !== sourceItem.run.workspace_id ? [] : [sourceItem]));
    if (path.endsWith(`/runs/${maintenanceRun.id}`)) return Response.json(maintenanceDetail);
    if (path.endsWith('/maintenance')) return Response.json(page(notices));
    throw new Error(`未定义 ${path}`);
  });
  return { writes, reads, blocked: () => { notices = [{ ...maintenanceNotice, task: null, reason: 'allocation_exceeded' }]; } };
}
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });

it('从真实普通Run选择读取正式边界/策略，单次确认提交，不改自动整理并按真实Handle打开任务', async () => {
  const api = server(), runtime = client(), store = createRuntimeStore(runtime), open = vi.fn(), user = userEvent.setup();
  render(<MemoryMaintenance client={runtime} store={store} scope={maintenancePolicy.scope} onOpenTask={open} />);
  await user.selectOptions(await screen.findByLabelText('整理来源运行'), sourceItem.run.id);
  await user.click(screen.getByRole('button', { name: '整理记忆' }));
  const confirm = await screen.findByRole('region', { name: '确认整理记忆' });
  expect(confirm.textContent).not.toContain(sourceBoundary.event_id);
  expect(confirm.textContent).not.toContain(sourceBoundary.run_id);
  expect(confirm.textContent).not.toContain('策略版本');
  expect(confirm.textContent).toContain('适用范围：个人');
  expect(confirm.textContent).toContain('独立维护预算');
  expect(confirm.textContent).toContain('900 秒');
  expect(confirm.textContent).toContain(sourceItem.run.config.model_profile.endpoint);
  expect(api.writes).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '确认提交整理任务' }));
  await screen.findByText('整理任务已提交');
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]).toMatchObject({ meta: { expected_version: 5 }, data: { scope: maintenancePolicy.scope, source_boundary: sourceBoundary } });
  expect(api.writes[0].data.budget_confirmation).toEqual({
    kind: 'new_budget', model_profile_id: sourceItem.run.config.model_profile.id,
    model_version: 1, connection_version: 1, limits: maintenancePolicy.maintenance_limits,
  });
  expect(api.writes[0].data).not.toHaveProperty('automatic');
  await user.click(screen.getByRole('button', { name: '打开已提交的维护任务' }));
  expect(open).toHaveBeenCalledWith(maintenanceTask);
  expect(api.reads.find(url => url.pathname.endsWith('/tasks'))?.searchParams.get('kind')).toBe('user');
});

it('目标改为其他项目后不沿用旧来源；重新核对失败时不能提交隐藏的旧边界', async () => {
  const api = server(), runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  const view = render(<MemoryMaintenance client={runtime} store={store} scope={maintenancePolicy.scope} onOpenTask={vi.fn()} />);
  await user.selectOptions(await screen.findByLabelText('整理来源运行'), sourceItem.run.id);
  await waitFor(() => expect((screen.getByRole('button', { name: '整理记忆' }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => { view.rerender(<MemoryMaintenance client={runtime} store={store} scope={{ kind: 'workspace', workspace_id: secondId, session_id: null }} onOpenTask={vi.fn()} />); });
  await waitFor(() => expect((screen.getByLabelText('整理来源运行') as HTMLSelectElement).value).toBe(''));
  expect((screen.getByRole('button', { name: '整理记忆' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('region', { name: '确认整理记忆' })).toBeNull();
  expect(api.writes).toHaveLength(0);
});

it('用户暂不确认预算时不提交，模型不可用时也不提供旧的预算确认', async () => {
  const api = server(), runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  const view = render(<MemoryMaintenance client={runtime} store={store} scope={maintenancePolicy.scope} onOpenTask={vi.fn()} />);
  await user.selectOptions(await screen.findByLabelText('整理来源运行'), sourceItem.run.id);
  await waitFor(() => expect((screen.getByRole('button', { name: '整理记忆' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: '整理记忆' }));
  await user.click(await screen.findByRole('button', { name: '暂不整理' }));
  expect(api.writes).toHaveLength(0);
  view.unmount();
  const blocked = server(false, true);
  render(<MemoryMaintenance client={runtime} store={store} scope={maintenancePolicy.scope} onOpenTask={vi.fn()} />);
  await user.selectOptions(await screen.findByLabelText('整理来源运行'), sourceItem.run.id);
  await screen.findByText(/整理模型不可用/);
  expect(screen.queryByText(/model_unavailable/)).toBeNull();
  expect((screen.getByRole('button', { name: '整理记忆' }) as HTMLButtonElement).disabled).toBe(true);
  expect(blocked.writes).toHaveLength(0);
});

it('全局持久事件使当前维护历史重读，显示安全阻塞原因且不伪造任务；冲突不自动换版本重交', async () => {
  const api = server(true), runtime = client(), store = createRuntimeStore(runtime), user = userEvent.setup();
  render(<MemoryMaintenance client={runtime} store={store} scope={maintenancePolicy.scope} onOpenTask={vi.fn()} />);
  await user.selectOptions(await screen.findByLabelText('整理来源运行'), sourceItem.run.id);
  await user.click(screen.getByRole('button', { name: '整理记忆' }));
  await user.click(await screen.findByRole('button', { name: '确认提交整理任务' }));
  await screen.findByText('策略版本已改变');
  expect(api.writes).toHaveLength(1);
  api.blocked();
  await act(async () => { store.update(state => reduceStream(state, { kind: 'durable', event_id: event.event_id,
    event: { ...event, kind: 'memory.maintenance_changed', workspace_id: null, run_id: null, seq: null,
      payload: { ...maintenanceNotice, task: null, reason: 'allocation_exceeded' } } })); });
  await screen.findByText(/原因果组没有剩余整理额度/);
  expect(screen.queryByText(/allocation_exceeded/)).toBeNull();
  expect(screen.queryByRole('button', { name: '查看维护任务' })).toBeNull();
  expect(api.writes).toHaveLength(1);
});

it('记忆页候选的维护关联沿真实记录ID读取，打开关联返回的实际Task，不从来源Run猜根任务', async () => {
  const runtime = client(), store = createRuntimeStore(runtime), open = vi.fn(), user = userEvent.setup(), reads: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname; reads.push(path);
    if (path === `/v4/memory/records/${memory.id}/maintenance`) return Response.json(page([maintenanceNotice]));
    if (path.endsWith('/tasks') || path.endsWith('/workspaces') || path === '/v4/memory/maintenance') return Response.json(page([]));
    if (path.endsWith('/records')) return Response.json(page([memory]));
    if (path.endsWith('/evidence')) return Response.json(page(memory.evidence.map(evidence => ({ evidence, available: true, reason: null }))));
    if (path.endsWith(memory.id)) return Response.json(memory);
    throw new Error(`未定义 ${path}`);
  });
  render(<MemoryPage client={runtime} store={store} onClose={() => {}} onSettings={() => {}} onOpenTask={open} />);
  await screen.findByText(memory.text);
  await user.click(screen.getByRole('button', { name: '更多' }));
  await user.click(await screen.findByRole('menuitem', { name: '查看关联整理任务' }));
  await user.click(await screen.findByRole('button', { name: '查看此候选的维护任务' }));
  expect(screen.queryByText(maintenanceNotice.source_boundary.run_id)).toBeNull();
  expect(screen.queryByText(maintenanceNotice.source_boundary.event_id, { exact: false })).toBeNull();
  expect(open).toHaveBeenCalledWith(maintenanceTask);
  expect(reads).toContain(`/v4/memory/records/${memory.id}/maintenance`);
  expect(maintenanceTask.task_id).not.toBe(sourceItem.root.id);
});
