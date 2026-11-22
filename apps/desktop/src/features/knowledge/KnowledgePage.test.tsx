import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { emptyProjection, reduceStream } from '../../api/events';
import { id, page, secondId } from '../../test/fixtures';
import { event } from '../../test/fixtures';
import type { KnowledgeJob } from '../../generated/contracts';
import { importReceipt, job, jobId, otherSourceId, selectedFile, source, sourceId, sourcePage } from './knowledge-fixtures';
import KnowledgePage from './KnowledgePage';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear(); });
const runtime = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 });

it('adds_files_once_and_reuses_project_permission：可信清单确认一次，仅发送原资源身份，无同义授权', async () => {
  const writes: { path: string; body: any }[] = [];
  vi.mocked(invoke).mockResolvedValue({ resources: [selectedFile] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push({ path, body });
      return Response.json({ ...importReceipt, command_id: body.meta.command_id,
        jobs: [{ ...job, command_id: body.meta.command_id }] }, { status: 202 });
    }
    if (path.endsWith('/sources')) return Response.json(sourcePage([source], writes.length ? job : null));
    if (path.endsWith('/jobs')) return Response.json(page(writes.length ? [job] : []));
    throw new Error(path);
  });
  const user = userEvent.setup(); render(<KnowledgePage client={runtime()} workspaceId={id} />);
  await screen.findByRole('button', { name: /项目说明.md/ });
  await user.click(screen.getByRole('button', { name: '加入文件' }));
  const dialog = await screen.findByRole('dialog', { name: '加入项目资料' });
  expect(within(dialog).getByText('新增说明.md')).toBeTruthy();
  expect(writes).toHaveLength(0);
  await user.click(within(dialog).getByRole('button', { name: '加入所选 1 个文件' }));
  await screen.findByText('已接收 1 个文件');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ path: `/v4/workspaces/${id}/knowledge/imports`,
    body: { data: { resource_ids: [selectedFile.id] } } });
  expect(invoke).toHaveBeenCalledWith('select_resources', { scope: { kind: 'workspace', workspace_id: id, session_id: null }, kind: 'file' });
  expect(writes.some(write => /grant/.test(write.path))).toBe(false);
});

it('queued_upload_survives_navigation_and_unknown_response：重开仅查回原项目命令，无第二次导入', async () => {
  const writes: any[] = [], checks: string[] = [];
  vi.mocked(invoke).mockResolvedValue({ resources: [selectedFile] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') { writes.push(JSON.parse(String(init.body))); throw new TypeError('响应丢失'); }
    if (path.includes('/commands/')) {
      checks.push(path);
      return Response.json({ status: 'confirmed', result: { ...importReceipt,
        command_id: writes[0].meta.command_id, jobs: [{ ...job, command_id: writes[0].meta.command_id }] } });
    }
    if (path.endsWith('/sources')) return Response.json(sourcePage([source], writes.length ? job : null));
    if (path.endsWith('/jobs')) return Response.json(page(writes.length ? [job] : []));
    throw new Error(path);
  });
  const client = runtime(), user = userEvent.setup();
  const first = render(<KnowledgePage client={client} workspaceId={id} />);
  await user.click(screen.getByRole('button', { name: '加入文件' }));
  await user.click(await screen.findByRole('button', { name: '加入所选 1 个文件' }));
  await screen.findByText(/接收状态待核对/);
  first.unmount();
  render(<KnowledgePage client={client} workspaceId={id} />);
  await screen.findByText('已接收 1 个文件');
  expect(writes).toHaveLength(1);
  expect(checks).toEqual([`/v4/workspaces/${id}/commands/${writes[0].meta.command_id}`]);
});

it('目录清单沿 opaque cursor 逐页选择，加入只含明确选定文件', async () => {
  const directory = { ...selectedFile, id: secondId, label: '文档', kind: 'directory' };
  const secondFile = { ...selectedFile, id: otherSourceId, label: '会议记录.txt' };
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === 'select_resources') return { resources: [directory] };
    if (command === 'expand_knowledge_directory') return args.cursor
      ? { resources: [secondFile], next_cursor: null } : { resources: [selectedFile], next_cursor: 'opaque:更多+/' };
    throw new Error(command);
  });
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') { const body = JSON.parse(String(init.body)); writes.push(body);
      return Response.json({ ...importReceipt, command_id: body.meta.command_id }, { status: 202 }); }
    return Response.json(page([]));
  });
  const user = userEvent.setup(); render(<KnowledgePage client={runtime()} workspaceId={id} />);
  await user.click(screen.getByRole('button', { name: '从目录选择' }));
  await user.click(await screen.findByRole('button', { name: '继续查看目录文件' }));
  await screen.findByText('会议记录.txt');
  await user.click(screen.getByRole('checkbox', { name: '新增说明.md' }));
  await user.click(screen.getByRole('button', { name: '加入所选 1 个文件' }));
  await screen.findByText('已接收 1 个文件');
  expect(writes[0].data.resource_ids).toEqual([secondFile.id]);
  expect(invoke).toHaveBeenCalledWith('expand_knowledge_directory',
    { directoryId: secondId, cursor: 'opaque:更多+/', limit: 50 });
});

it('knowledge_notice_refreshes_only_affected_project_once：通知更新保留所选详情与打开的操作', async () => {
  const client = runtime(), reads: string[] = [];
  const other = { ...source, id: otherSourceId, label: '会议记录.txt' };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname; reads.push(path);
    return Response.json(path.endsWith('/sources') ? sourcePage([source, other]) : page([]));
  });
  let projection = emptyProjection();
  const view = render(<KnowledgePage client={client} workspaceId={id} refreshKey={projection.knowledgeNotices[id]?.watermark} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /会议记录.txt/ }));
  const detail = screen.getByRole('region', { name: '资料详情' });
  await user.click(within(detail).getByText('操作与处理记录'));
  const wire = { kind: 'durable' as const, event_id: event.event_id,
    event: { ...event, kind: 'knowledge.changed' as const, workspace_id: secondId, session_id: null, run_id: null,
      payload: { workspace_id: secondId, source_revisions: { [sourceId]: 3 }, job_revisions: {}, settings_revision: null, profile_revisions: {} } } };
  projection = reduceStream(projection, wire);
  view.rerender(<KnowledgePage client={client} workspaceId={id} refreshKey={projection.knowledgeNotices[id]?.watermark} />);
  expect(reads).toHaveLength(2);
  projection = reduceStream(projection, { ...wire, event: { ...wire.event, workspace_id: id, payload: { ...wire.event.payload, workspace_id: id } } });
  view.rerender(<KnowledgePage client={client} workspaceId={id} refreshKey={projection.knowledgeNotices[id]?.watermark} />);
  await waitFor(() => expect(reads).toHaveLength(4));
  expect(screen.getByRole('region', { name: '资料详情' })).toBe(detail);
  expect(within(detail).getByRole('heading', { name: '会议记录.txt' })).toBeTruthy();
  expect(within(detail).getByText('操作与处理记录').closest('details')!.open).toBe(true);
  const same = reduceStream(projection, { ...wire, event: { ...wire.event, workspace_id: id, payload: { ...wire.event.payload, workspace_id: id } } });
  view.rerender(<KnowledgePage client={client} workspaceId={id} refreshKey={same.knowledgeNotices[id]?.watermark} />);
  expect(reads).toHaveLength(4);
});

it('更新排队保留当前可用版本，可打开真实任务并按任务 revision 取消', async () => {
  let current: KnowledgeJob = job;
  const writes: any[] = [], open = vi.fn();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/cancel')) {
      writes.push(JSON.parse(String(init.body))); current = { ...current, revision: 2, status: 'cancelled' };
      return Response.json(current);
    }
    return Response.json(path.endsWith('/sources') ? sourcePage([source], current) : page([current]));
  });
  render(<KnowledgePage client={runtime()} workspaceId={id} onOpenTask={open} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /项目说明.md/ }));
  expect(screen.getByText(/新版处理中，完成前继续使用当前版本/)).toBeTruthy();
  const detail = screen.getByRole('region', { name: '资料详情' });
  await user.click(within(detail).getByText('操作与处理记录'));
  await user.click(within(detail).getByRole('button', { name: '查看处理任务' }));
  expect(open).toHaveBeenCalledWith(job.task);
  await user.click(within(detail).getByRole('button', { name: '取消处理' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ meta: { expected_version: 1 }, data: {} });
  await waitFor(() => expect(within(detail).queryByRole('button', { name: '取消处理' })).toBeNull());
  expect(within(detail).getByText('可用')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/chunk-internal|generation|sqlite|[a-f0-9]{64}/);
});

it('部分文件失败保留文件名与可理解原因，不重传成功项或显示内部错误码', async () => {
  const rejectedFile = { ...selectedFile, id: otherSourceId, label: '旧文档.pdf' };
  vi.mocked(invoke).mockResolvedValue({ resources: [selectedFile, rejectedFile] });
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push(body);
      return Response.json({ ...importReceipt, command_id: body.meta.command_id,
        rejected: [{ resource_id: otherSourceId, reason: 'file_extension_not_allowed' }] }, { status: 202 });
    }
    return Response.json(page([]));
  });
  const user = userEvent.setup(); render(<KnowledgePage client={runtime()} workspaceId={id} />);
  await user.click(screen.getByRole('button', { name: '加入文件' }));
  await user.click(await screen.findByRole('button', { name: '加入所选 2 个文件' }));
  await screen.findByText('已接收 1 个文件');
  expect(screen.getByRole('alert').textContent).toContain('旧文档.pdf');
  expect(screen.getByRole('alert').textContent).toContain('仅支持 MD、TXT');
  expect(screen.queryByText(/file_extension_not_allowed/)).toBeNull();
  expect(writes).toHaveLength(1);
});

it('not_found 重开后可明确重试原命令，重复核对不自动发送或更换 ID', async () => {
  const writes: any[] = [], checks: string[] = [];
  vi.mocked(invoke).mockResolvedValue({ resources: [selectedFile] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push(body);
      if (writes.length === 1) throw new TypeError('请求未发送');
      return Response.json({ ...importReceipt, command_id: body.meta.command_id });
    }
    if (path.includes('/commands/')) { checks.push(path); return Response.json({ status: 'not_found', result: null }); }
    return Response.json(page([]));
  });
  const user = userEvent.setup(), client = runtime();
  const view = render(<KnowledgePage client={client} workspaceId={id} />);
  await user.click(screen.getByRole('button', { name: '加入文件' }));
  await user.click(await screen.findByRole('button', { name: '加入所选 1 个文件' }));
  await user.click(await screen.findByRole('button', { name: '核对接收状态' }));
  await screen.findByText(/暂未查到接收回执/);
  await user.click(screen.getByRole('button', { name: '核对接收状态' }));
  await waitFor(() => expect(checks).toHaveLength(2));
  expect(new Set(checks).size).toBe(1);
  expect(writes).toHaveLength(1);
  expect((screen.getByRole('button', { name: '加入文件' }) as HTMLButtonElement).disabled).toBe(true);
  view.unmount(); render(<KnowledgePage client={client} workspaceId={id} />);
  await screen.findByText(/暂未查到接收回执/);
  await user.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('已接收 1 个文件');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect((screen.getByRole('button', { name: '加入文件' }) as HTMLButtonElement).disabled).toBe(false);
});

it('新版处理失败在列表明确标示，继续展示实际可用旧版本', async () => {
  vi.stubGlobal('fetch', async (url: string) => Response.json(new URL(url).pathname.endsWith('/sources')
    ? sourcePage([source], { ...job, status: 'failed', reason: 'knowledge_index_write_failed' })
    : page([{ ...job, status: 'failed', reason: 'knowledge_index_write_failed' }])));
  render(<KnowledgePage client={runtime()} workspaceId={id} />);
  const user = userEvent.setup();
  const row = await screen.findByRole('button', { name: /项目说明.md/ });
  expect(row.textContent).toContain('更新失败');
  expect(row.textContent).not.toContain('v1');
  await user.click(row);
  await user.click(screen.getByText('操作与处理记录'));
  expect(screen.getByText(/更新未完成，当前资料仍可用/)).toBeTruthy();
  expect(document.body.textContent).not.toContain('knowledge_index_write_failed');
});

it.each([false, true])('更新默认复用原位置，明确选择其他文件=%s 才打开可信选择器', async replacement => {
  const writes: any[] = [];
  vi.mocked(invoke).mockResolvedValue({ resources: [selectedFile] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push(body);
      return Response.json({ ...importReceipt, command_id: body.meta.command_id });
    }
    return Response.json(new URL(url).pathname.endsWith('/sources') ? sourcePage([source]) : page([]));
  });
  const user = userEvent.setup(); render(<KnowledgePage client={runtime()} workspaceId={id} />);
  await user.click(await screen.findByRole('button', { name: /项目说明.md/ }));
  await user.click(screen.getByText('操作与处理记录'));
  await user.click(screen.getByRole('button', { name: '更新文件' }));
  await screen.findByRole('dialog', { name: '更新项目资料' });
  expect(invoke).not.toHaveBeenCalled();
  if (replacement) {
    await user.click(screen.getByRole('button', { name: '选择其他文件' }));
    await screen.findByText(selectedFile.label);
  }
  await user.click(await screen.findByRole('button', { name: '更新此资料' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ meta: { expected_version: source.revision },
    data: { source_id: source.id, resource_ids: replacement ? [selectedFile.id] : [] } });
});

it('原位置已失效时保留更新操作，用户选择替代文件后完成同一资料更新', async () => {
  const writes: any[] = [], user = userEvent.setup();
  vi.mocked(invoke).mockResolvedValue({ resources: [selectedFile] });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push(body);
      if (writes.length === 1) return Response.json({ error: { code: 'file_identity_changed',
        safe_message: '原文件已被替换，请重新选择。', retryable: false, related_ids: [] } }, { status: 409 });
      return Response.json({ ...importReceipt, command_id: body.meta.command_id });
    }
    return Response.json(new URL(url).pathname.endsWith('/sources') ? sourcePage([source]) : page([]));
  });
  render(<KnowledgePage client={runtime()} workspaceId={id} />);
  await user.click(await screen.findByRole('button', { name: /项目说明.md/ }));
  await user.click(screen.getByText('操作与处理记录'));
  await user.click(screen.getByRole('button', { name: '更新文件' }));
  await user.click(await screen.findByRole('button', { name: '更新此资料' }));
  await screen.findByRole('alert');
  expect(invoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '选择其他文件' }));
  await screen.findByText(selectedFile.label);
  await user.click(screen.getByRole('button', { name: '更新此资料' }));
  await screen.findByText('已接收 1 个文件');
  expect(writes.map(item => item.data)).toEqual([
    { source_id: source.id, resource_ids: [] }, { source_id: source.id, resource_ids: [selectedFile.id] },
  ]);
});

it('超过100条历史且最新 job 不在首屏时，列表和所选详情仍可取消权威当前任务，翻历史不改变当前状态', async () => {
  const history = Array.from({ length: 100 }, (_, index) => ({ ...job,
    id: `00000000-0000-4000-8000-${String(300 + index).padStart(12, '0')}`, status: 'completed' as const }));
  const reads: URL[] = [], commands: any[] = [];
  let current = { ...job, revision: 9, status: 'running' as KnowledgeJob['status'] };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url); reads.push(parsed);
    if (parsed.pathname.endsWith('/cancel')) {
      commands.push(JSON.parse(String(init.body))); current = { ...current, status: 'cancelled', revision: 10 };
      return Response.json(current);
    }
    if (parsed.pathname.endsWith('/sources')) return Response.json(sourcePage([source], current));
    if (parsed.pathname.endsWith('/jobs')) return Response.json(parsed.searchParams.has('cursor')
      ? page([{ ...current, status: 'completed' }]) : { ...page(history), next_cursor: 'history:101' });
    throw new Error(parsed.pathname);
  });
  const user = userEvent.setup(), open = vi.fn();
  render(<KnowledgePage client={runtime()} workspaceId={id} onOpenTask={open} />);
  const row = await screen.findByRole('button', { name: /项目说明.md/ });
  expect(row.textContent).toContain('更新中');
  await user.click(row);
  await user.click(within(screen.getByRole('group', { name: '当前处理任务' })).getByRole('button', { name: '查看处理任务' }));
  expect(open).toHaveBeenCalledWith(job.task);
  await user.click(screen.getByRole('button', { name: '更多处理记录' }));
  expect(screen.getByRole('button', { name: '取消处理' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '取消处理' }));
  await waitFor(() => expect(row.textContent).toContain('可用'));
  expect(commands).toHaveLength(1);
  expect(commands[0].meta.expected_version).toBe(9);
  expect(reads.some(url => url.searchParams.get('cursor') === 'history:101')).toBe(true);
});
