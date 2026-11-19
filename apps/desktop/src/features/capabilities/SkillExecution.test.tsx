import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { id } from '../../test/fixtures';
import { skillView, skillScope, skillHash } from '../../test/skill-fixtures';
import SkillExecution from './SkillExecution';
import { TracePanel } from '../trace/TracePanel';
import TaskDetail from '../tasks/TaskDetail';
import { createRuntimeStore } from '../../state/runtime-store';
import { limits, page, run, runDetailSummary } from '../../test/fixtures';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const envId = '20000000-0000-4000-8000-000000000002';
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 });
const binding = { ...skillView.binding!, environment_id: envId, environment_revision: 1 };
const settings = { skill_id: skillView.version.skill_id, content_hash: skillHash, scope: skillScope,
  scripts: ['scripts/report.py'], binding, permissions: [] };
const environment = { id: envId, revision: 1, kind: 'python', executable_path: 'C:/chosen/python.exe',
  executable_identity: 'identity', version: 'Python 3.13', cwd_mode: 'package_copy', env_keys: [],
  dependency_coverage: 'unverified', manifest_count: 0, status: 'probed', checked_at: null, diagnostic_code: null };

it('明确绑定环境后才能许可固定版本，撤销独立许可不改内容启停', async () => {
  const writes: { path: string; body: any }[] = [];
  let current: any = settings;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'PUT') {
      const body = JSON.parse(String(init.body)); writes.push({ path, body });
      current = { ...settings, permissions: [{ ...body.data, revision: 1 }] };
      return Response.json(current.permissions[0]);
    }
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push({ path, body });
      current = { ...current, permissions: [{ ...current.permissions[0], revision: 2, status: 'revoked' }] };
      return Response.json(current.permissions[0]);
    }
    if (path.endsWith('/script-settings')) return Response.json(current);
    if (path.endsWith(`/${envId}`)) return Response.json(environment);
    throw new Error(path);
  });
  const user = userEvent.setup();
  render(<SkillExecution client={client()} version={skillView.version} scope={skillScope} onChanged={() => {}} />);
  await screen.findByText('待执行许可');
  expect(writes).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: '允许此版本在绑定环境执行' }));
  await screen.findByText('此版本已有执行许可');
  expect(writes[0].body.data).toMatchObject({ skill_id: skillView.version.skill_id, content_hash: skillHash,
    environment_id: envId, environment_revision: 1, scope: skillScope, status: 'active' });
  expect(writes[0].body.data).not.toHaveProperty('enabled');
  await user.click(screen.getByRole('button', { name: '撤销执行许可' }));
  await screen.findByText('待执行许可');
  expect(writes[1].path).toContain('/revoke');
  expect(writes[1].body.expected_version).toBe(1);
});

it('无绑定显示待环境，只有已检测的用户环境可显式绑定', async () => {
  vi.stubGlobal('fetch', async (url: string) => new URL(url).pathname.endsWith('/script-settings')
    ? Response.json({ ...settings, binding: null })
    : Response.json({ items: [environment], next_cursor: null, watermark: '0' }));
  render(<SkillExecution client={client()} version={skillView.version} scope={skillScope} onChanged={() => {}} />);
  await screen.findByText('待绑定环境');
  expect(screen.queryByRole('button', { name: '允许此版本在绑定环境执行' })).toBeNull();
  expect(await screen.findByRole('option', { name: /python/ })).toBeTruthy();
});

it('丢许可回执后重试保留同一命令和版本', async () => {
  const commands: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'PUT') {
      const body = JSON.parse(String(init.body)); commands.push(body);
      if (commands.length === 1) throw new TypeError('lost receipt');
      return Response.json(body.data);
    }
    if (path.endsWith('/script-settings')) return Response.json(settings);
    return Response.json(environment);
  });
  const user = userEvent.setup();
  render(<SkillExecution client={client()} version={skillView.version} scope={skillScope} onChanged={() => {}} />);
  await user.click(await screen.findByRole('button', { name: '允许此版本在绑定环境执行' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: '按原命令核对许可' }));
  await waitFor(() => expect(commands).toHaveLength(2));
  expect(commands[1]).toEqual(commands[0]);
});

it.each(['dispatched', 'failed', 'succeeded', 'uncertain'] as const)('Trace 展示脚本%s与相对输出 Artifact 关系', state => {
  const artifact = { id, run_id: id, task_id: id, activity_id: id, version: 1, media_type: 'application/octet-stream',
    content_hash: skillHash, byte_size: 6, dependencies: [], status: 'available' };
  const summary = { skill_id: id, content_hash: skillHash, script_relative_path: 'scripts/report.py',
    environment_id: envId, environment_revision: 1, attempt_id: id, exit_code: state === 'failed' ? 7 : 0,
    termination_reason: 'exited', truncated: false, outputs: [{ relative_path: 'result.bin', artifact }], external_costs: 'unknown' };
  const event: any = { event_id: 1, seq: 1, kind: 'activity.received', task_id: id, activity_id: id,
    activities: [{ id, version: 2, run_id: id, task_id: id, kind: 'tool', operation: 'skills.run_script',
      state, script_execution: state === 'dispatched' || state === 'uncertain' ? null : summary, error: null }] };
  render(<TracePanel events={[event]} />);
  const trace = screen.getByRole('region', { name: '公开事件' });
  expect(within(trace).getByText(/skills.run_script/)).toBeTruthy();
  if (state === 'failed' || state === 'succeeded') {
    expect(within(trace).getByText('result.bin')).toBeTruthy();
    expect(within(trace).getByText(/外部费用未知/)).toBeTruthy();
    expect(within(trace).getByText(/scripts\/report.py/)).toBeTruthy();
  } else expect(within(trace).getByText(state === 'dispatched' ? '脚本运行中' : '脚本结果待核对，不自动重试')).toBeTruthy();
});

it('输出引用未在产物首屏时，任务详情仍按脚本实际 ArtifactRef 打开文件', async () => {
  const runtime = client();
  const artifact = { id, version: 1, task_id: id, activity_id: id, media_type: 'application/octet-stream' as const,
    content_hash: skillHash, dependencies: [] };
  const activity: any = { id, version: 1, run_id: run.id, task_id: id, kind: 'tool', operation: 'skills.run_script',
    state: 'succeeded', dependencies: [], error: null, usage: null, actual_units: '0',
    script_execution: { skill_id: id, content_hash: skillHash, script_relative_path: 'scripts/report.py',
      environment_id: envId, environment_revision: 1, attempt_id: id, exit_code: 0, termination_reason: 'exited',
      truncated: false, outputs: [{ relative_path: 'later-page.bin', artifact }], external_costs: 'unknown' } };
  vi.spyOn(runtime, 'run').mockResolvedValue({ ...runDetailSummary, run: { ...run, state: 'completed', interaction_session_id: null },
    tasks: page([]), activities: page([activity]), artifacts: { ...page([]), next_cursor: 'more-artifacts' },
    questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
    budget: { steps: 1, model_requests: 1, limits }, watermark: '1' } as any);
  vi.spyOn(runtime, 'watchWorkspace').mockImplementation(async () => {});
  render(<TaskDetail client={runtime} store={createRuntimeStore(runtime)} runId={run.id}
    onCommand={async () => ({ status: 'confirmed' }) as any} onQuestion={() => {}} onOpen={() => {}} />);
  await userEvent.click(await screen.findByRole('button', { name: 'later-page.bin' }));
  expect(within(screen.getByRole('region', { name: '产物详情' })).getByText('二进制文件，可导出到本机。')).toBeTruthy();
});
