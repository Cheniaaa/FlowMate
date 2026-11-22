import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { createRuntimeStore } from '../../state/runtime-store';
import { event, id, limits, model, modelResolution, page, run, runDetailSummary, secondId } from '../../test/fixtures';
import ToolCard from './ToolCard';
import VisionContinuation from './VisionContinuation';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const client = () => new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 3 });

it('工具图片通过带认证的产物 API 打开原图，正文保留混合顺序', async () => {
  const requested: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic');
    requested.push(url);
    return new Response(new Blob(['synthetic-png-bytes'], { type: 'image/png' }));
  });
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-image');
  URL.revokeObjectURL = vi.fn();
  const view = render(<ToolCard client={client()} sourceOperation="mcp.fixture.draw" part={{ kind: 'tool_result', call_id: 'picture',
    origin_message_id: id, error: null, result: { server_id: id, tool_name: 'draw', call_id: 'picture', texts: ['之前', '之后'], content: [
      { type: 'text', text: '之前' }, { type: 'image', artifact: { id: secondId }, media_type: 'image/png' },
      { type: 'text', text: '之后' },
    ] } }} />);
  const user = userEvent.setup();
  await user.click(screen.getByText('工具结果 · 源调用未加载'));
  await user.click(await screen.findByRole('button', { name: '打开原图' }));
  expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe('blob:synthetic-image');
  expect(requested).toEqual([`http://127.0.0.1:54321/v3/artifacts/${secondId}/image`]);
  expect(view.container.textContent!.indexOf('之前')).toBeLessThan(view.container.textContent!.indexOf('之后'));
  await user.click(screen.getByRole('button', { name: '关闭对话框' }));
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-image');
});

it('选择视觉型号显示实际接收方，并由现有命令存储创建关联原 Run 的新 Run', async () => {
  const created = { ...run, id: secondId, vision_source_run_id: run.id };
  const detail = { ...runDetailSummary, run: created, budget: { id: created.budget_id, run_id: created.id,
    version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0, task_count: 1,
    total_tokens: 0, reserved_tokens: 0 }, tasks: page([]), activities: page([]), messages: page([]),
    artifacts: page([]), questions: page([]), approvals: page([]), waits: page([]), consumptions: page([]),
    joins: page([]), watermark: event.event_id };
  const sent: unknown[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path === '/models') return Response.json(page([model]));
    if (path.endsWith('/resolved')) return Response.json(modelResolution);
    if (path.endsWith('/continue-vision')) {
      sent.push(JSON.parse(String(init?.body))); return Response.json(created);
    }
    if (path === `/runs/${secondId}`) return Response.json(detail);
    throw new Error(`未定义请求：${path}`);
  });
  const runtime = client(), store = createRuntimeStore(runtime);
  render(<VisionContinuation client={runtime} store={store} run={{ ...run, state: 'waiting_user' }} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '选择视觉模型继续' }));
  await user.selectOptions(await screen.findByLabelText('视觉型号'), model.id);
  await screen.findByText(`图片接收方：${modelResolution.endpoint}`);
  await user.click(screen.getByRole('button', { name: '继续处理图片' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(sent).toEqual([{ meta: { command_id: expect.any(String), expected_version: run.version }, data: {
    model_profile_id: model.id, model_profile_version: model.version,
    connection_version: modelResolution.connection_version, endpoint: modelResolution.endpoint,
  } }]);
  expect(store.getSnapshot().runs[secondId].vision_source_run_id).toBe(run.id);
});
