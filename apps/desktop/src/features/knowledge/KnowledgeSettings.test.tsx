import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { grant, id, page, secondId } from '../../test/fixtures';
import { embeddingProfile, embeddingView, projectKnowledge } from './embedding-fixtures';
import { job, otherSourceId, source, sourcePage } from './knowledge-fixtures';
import KnowledgeSettings from './KnowledgeSettings';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
const runtime = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 });
function boundary(unknown = false, covered = false) {
  const writes: any[] = [], checks: string[] = [], reads: string[] = [];
  let settings = projectKnowledge;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url), path = parsed.pathname; reads.push(path);
    if (init.method === 'PUT') {
      const command = JSON.parse(String(init.body)); writes.push(command);
      settings = { ...settings, revision: 2, desired_profile: command.data.embedding_profile, rebuild_job_id: secondId };
      if (unknown) throw new TypeError('response lost');
      return Response.json(settings);
    }
    if (path.includes('/commands/')) { checks.push(path); return Response.json({ status: 'confirmed', result: settings }); }
    if (path.endsWith('/embedding-profiles')) return Response.json(page([embeddingProfile]));
    if (path.includes('/embedding-profiles/')) return Response.json(embeddingView);
    if (path.endsWith('/knowledge/settings')) return Response.json(settings);
    if (path === `/v4/knowledge/jobs/${secondId}`) return Response.json({ ...job, id: secondId, kind: 'rebuild' });
    if (path.endsWith('/grants')) return Response.json(page(covered ? [{ ...grant, destination: embeddingView.destination,
      purposes: ['embedding_send'], knowledge_scopes: [{ kind: 'workspace', workspace_id: id, session_id: null }] }] : []));
    throw new Error(path);
  });
  return { writes, checks, reads };
}

it('项目检索选择用固定修订目的地，明确授权仅 embedding_send，desired 不冒充 active', async () => {
  const api = boundary(), user = userEvent.setup();
  render(<KnowledgeSettings client={runtime()} workspaceId={id} />);
  await user.selectOptions(await screen.findByLabelText('项目检索方式'), `${secondId}:2`);
  await screen.findByText(embeddingView.destination!);
  expect(screen.queryByText(/https:\/\/example.invalid\/v1$/)).toBeNull();
  await user.click(screen.getByRole('checkbox', { name: '允许本项目资料发送到所选检索服务' }));
  await user.click(screen.getByRole('button', { name: '保存检索选择' }));
  await screen.findByText('检索选择已保存');
  expect(api.writes).toHaveLength(1);
  expect(api.writes[0]).toMatchObject({ meta: { expected_version: 1 }, data: {
    embedding_profile: { id: secondId, revision: 2 }, grants: [{ purposes: ['embedding_send'],
      destination: embeddingView.destination, knowledge_scopes: [{ kind: 'workspace', workspace_id: id, session_id: null }] }],
  } });
  expect(JSON.stringify(api.writes[0])).not.toContain('model_send');
  expect(screen.getByText('当前可用：仅关键词')).toBeTruthy();
  expect(screen.getByText(/已选目标：项目检索/)).toBeTruthy();
});

it('重建状态精确读取绑定 job，不请求历史列表；取消后可保存同一目标重开', async () => {
  const reads: string[] = [], writes: any[] = [], user = userEvent.setup();
  let current = { ...projectKnowledge,
    desired_profile: { id: secondId, revision: 2 }, rebuild_job_id: job.id };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname; reads.push(path);
    if (init.method === 'PUT') {
      const command = JSON.parse(String(init.body)); writes.push(command);
      current = { ...current, revision: 2, rebuild_job_id: otherSourceId };
      return Response.json(current);
    }
    if (path.endsWith('/embedding-profiles')) return Response.json(page([embeddingProfile]));
    if (path.includes('/embedding-profiles/')) return Response.json(embeddingView);
    if (path.endsWith('/knowledge/settings')) return Response.json(current);
    if (path.endsWith('/grants')) return Response.json(page([]));
    if (path === `/v4/knowledge/jobs/${job.id}`) return Response.json({ ...job, kind: 'rebuild', status: 'cancelled', task: null });
    if (path === `/v4/knowledge/jobs/${otherSourceId}`) return Response.json({ ...job, id: otherSourceId, kind: 'rebuild', status: 'queued' });
    throw new Error(path);
  });
  render(<KnowledgeSettings client={runtime()} workspaceId={id} />);
  await screen.findByText(/已取消，继续使用当前配置/);
  expect(screen.getByText('当前可用：仅关键词')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '保存检索选择' }));
  await screen.findByText(/等待处理完成后切换/);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ data: { embedding_profile: { id: secondId, revision: 2 }, grants: [] } });
  expect(reads).toContain(`/v4/knowledge/jobs/${job.id}`);
  expect(reads).toContain(`/v4/knowledge/jobs/${otherSourceId}`);
  expect(reads.some(path => path.endsWith('/knowledge/jobs'))).toBe(false);
});

it('首次云许可说明文档和检索问题及费用，同一勾选保存；主选择保留当前/历史/有更新语义', async () => {
  const api = boundary(), user = userEvent.setup();
  render(<KnowledgeSettings client={runtime()} workspaceId={id} />);
  await user.selectOptions(await screen.findByLabelText('项目检索方式'), `${secondId}:2`);
  const consent = screen.getByRole('checkbox', { name: '允许本项目资料发送到所选检索服务' });
  expect(screen.getByText(/文档和检索问题.*当前固定服务.*可能产生费用/)).toBeTruthy();
  expect(screen.getByRole('option', { name: /项目检索/ }).textContent).not.toContain('修订');
  await user.click(consent);
  await user.click(screen.getByRole('button', { name: '保存检索选择' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0].data.grants).toHaveLength(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['model_send', 'embedding_send'] as const)('项目 %s 知识授权区分指定文件与包含未来资料的整项目范围，名称取自后页', async purpose => {
  boundary();
  const base = fetch, reads: URL[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const parsed = new URL(url); reads.push(parsed);
    if (parsed.pathname.endsWith('/grants')) return Response.json(page([
      { ...grant, resource_ids: [], knowledge_source_ids: [otherSourceId], purposes: [purpose], destination: embeddingView.destination },
      { ...grant, id: secondId, resource_ids: [], knowledge_scopes: [{ kind: 'workspace', workspace_id: id, session_id: null }],
        purposes: [purpose], destination: embeddingView.destination },
    ]));
    if (parsed.pathname.endsWith('/sources')) return Response.json(parsed.searchParams.has('cursor')
      ? sourcePage([{ ...source, id: otherSourceId, label: '唯一授权.txt' }]) : { ...sourcePage([source]), next_cursor: 'names-next' });
    return base(url, init);
  });
  render(<KnowledgeSettings client={runtime()} workspaceId={id} />);
  await userEvent.selectOptions(await screen.findByLabelText('项目检索方式'), `${secondId}:2`);
  const scope = await screen.findByText('唯一授权.txt');
  const card = scope.closest('article')!;
  if (purpose === 'model_send') expect(within(card).getByText(new RegExp(embeddingView.destination!))).toBeTruthy();
  expect(within(card).queryByText(/全部资料/)).toBeNull();
  expect(screen.getByText('本项目全部资料（含以后加入）')).toBeTruthy();
  expect(reads.filter(url => url.pathname.endsWith('/sources')).map(url => url.searchParams.get('cursor'))).toEqual([null, 'names-next']);
  expect(document.body.textContent).not.toContain(otherSourceId);
});

it('已有知识向量许可不再重复授权', async () => {
  const api = boundary(false, true), user = userEvent.setup();
  render(<KnowledgeSettings client={runtime()} workspaceId={id} />);
  await user.selectOptions(await screen.findByLabelText('项目检索方式'), `${secondId}:2`);
  await screen.findByText('本项目资料已有向量发送许可。');
  expect(screen.queryByRole('checkbox', { name: '允许本项目资料发送到所选检索服务' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '保存检索选择' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0].data.grants).toEqual([]);
});

it('active 旧修订不在最新目录时仍读固定目的地；失败不把 desired 当成当前可用', async () => {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url); paths.push(parsed.pathname + parsed.search);
    if (parsed.pathname.endsWith('/embedding-profiles')) return Response.json(page([{ ...embeddingProfile, revision: 3, display_name: '新版检索' }]));
    if (parsed.pathname.includes('/embedding-profiles/')) return Response.json(parsed.searchParams.get('revision') === '2'
      ? { ...embeddingView, profile: { ...embeddingProfile, display_name: '原检索' } }
      : { ...embeddingView, destination: 'https://new-fixed.invalid/embeddings',
        profile: { ...embeddingProfile, revision: 3, display_name: '新版检索' } });
    if (parsed.pathname.endsWith('/settings')) return Response.json({ ...projectKnowledge,
      active_profile: { id: secondId, revision: 2 }, desired_profile: { id: secondId, revision: 3 }, rebuild_job_id: job.id });
    if (parsed.pathname.endsWith('/grants')) return Response.json(page([]));
    if (parsed.pathname === `/v4/knowledge/jobs/${job.id}`) return Response.json({ ...job, kind: 'rebuild', status: 'failed' });
    throw new Error(parsed.pathname);
  });
  render(<KnowledgeSettings client={runtime()} workspaceId={id} />);
  await screen.findByText('当前可用：原检索');
  expect(screen.getByText(/已选目标：新版检索.*更新失败/)).toBeTruthy();
  expect(paths).toContain(`/v4/knowledge/embedding-profiles/${secondId}?revision=2`);
  expect(paths).toContain(`/v4/knowledge/jobs/${job.id}`);
  expect(paths.some(path => path.endsWith('/knowledge/jobs'))).toBe(false);
  expect(screen.getByText('https://new-fixed.invalid/embeddings')).toBeTruthy();
  expect(screen.getByRole('option', { name: '原检索 · 当前使用 · 有更新' })).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText('项目检索方式'), `${secondId}:2`);
  expect(screen.getByText(embeddingView.destination!)).toBeTruthy();
  expect(paths.some(path => path.includes('/model-connections'))).toBe(false);
});

it('拒绝外发仍保存所选目标，不补授权、不循环提示；可明确选仅关键词', async () => {
  const api = boundary(), user = userEvent.setup();
  render(<KnowledgeSettings client={runtime()} workspaceId={id} />);
  await user.selectOptions(await screen.findByLabelText('项目检索方式'), `${secondId}:2`);
  await screen.findByText(embeddingView.destination!);
  await user.click(screen.getByRole('button', { name: '保存检索选择' }));
  await screen.findByText('检索选择已保存');
  expect(api.writes[0].data.grants).toEqual([]);
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.selectOptions(screen.getByLabelText('项目检索方式'), '');
  await user.click(screen.getByRole('button', { name: '保存检索选择' }));
  await waitFor(() => expect(api.writes).toHaveLength(2));
  expect(api.writes[1].data).toEqual({ embedding_profile: null, grants: [] });
});

it('设置 unknown 后重开只查回原 workspace command，不重传 PUT', async () => {
  const api = boundary(true), client = runtime(), user = userEvent.setup();
  const view = render(<KnowledgeSettings client={client} workspaceId={id} />);
  await user.selectOptions(await screen.findByLabelText('项目检索方式'), `${secondId}:2`);
  await user.click(screen.getByRole('button', { name: '保存检索选择' }));
  await screen.findByText(/保存结果待核对/);
  view.unmount(); render(<KnowledgeSettings client={client} workspaceId={id} />);
  await screen.findByText('检索选择已保存');
  expect(api.writes).toHaveLength(1);
  expect(api.checks).toEqual([`/v4/workspaces/${id}/commands/${api.writes[0].meta.command_id}`]);
});

it('未发送的设置 not_found 后重开可明确重试原命令及原授权', async () => {
  boundary();
  const base = fetch, commands: any[] = [], client = runtime(), user = userEvent.setup();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'PUT') {
      commands.push(JSON.parse(String(init.body)));
      if (commands.length === 1) throw new TypeError('请求未发送');
    }
    if (new URL(url).pathname.includes('/commands/')) return Response.json({ status: 'not_found', result: null });
    return base(url, init);
  });
  const view = render(<KnowledgeSettings client={client} workspaceId={id} />);
  await user.selectOptions(await screen.findByLabelText('项目检索方式'), `${secondId}:2`);
  await user.click(screen.getByRole('checkbox', { name: '允许本项目资料发送到所选检索服务' }));
  await user.click(screen.getByRole('button', { name: '保存检索选择' }));
  await screen.findByText(/保存结果待核对/);
  view.unmount(); render(<KnowledgeSettings client={client} workspaceId={id} />);
  await screen.findByText(/暂未查到保存回执/);
  expect(commands).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('检索选择已保存');
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});
