import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { connection, grant, id, model, page, resource } from '../../test/fixtures';
import GrantForm from '../authorization/GrantForm';
import { embeddingProfile, embeddingView, projectKnowledge } from './embedding-fixtures';
import { source, sourcePage } from './knowledge-fixtures';

afterEach(() => vi.unstubAllGlobals());
function boundary() {
  const writes: any[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push(body);
      return Response.json({ ...grant, ...body.data });
    }
    if (path.endsWith('/knowledge/sources')) return Response.json(sourcePage([source]));
    if (path.endsWith('/knowledge/settings')) return Response.json(projectKnowledge);
    if (path.endsWith('/embedding-profiles')) return Response.json(page([embeddingProfile]));
    if (path.includes('/embedding-profiles/')) return Response.json(embeddingView);
    if (path.endsWith('/models')) return Response.json(page([model]));
    if (path.endsWith('/model-connections')) return Response.json(page([connection]));
    if (path.endsWith('/tools')) return Response.json([]);
    if (path.endsWith('/mcp')) return Response.json(page([]));
    throw new Error(path);
  });
  return { writes, client: new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'synthetic', protocol_version: 4 }) };
}

it('项目知识向生成模型集中授权仅包含当前需要的 model_send 和明确来源', async () => {
  const api = boundary(), user = userEvent.setup();
  render(<GrantForm client={api.client} workspaceId={id} sessionId={null} resources={[]}
    initialSource="knowledge" allowedPurposes={['model_send']} onGranted={vi.fn()} />);
  await screen.findByRole('option', { name: /explicit-model/ });
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), connection.endpoint);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0].data).toMatchObject({ purposes: ['model_send'], resource_ids: [], memory_scopes: [],
    destination: connection.endpoint, knowledge_scopes: [{ kind: 'workspace', workspace_id: id, session_id: null }] });
  expect(screen.queryByRole('option', { name: '发送到向量模型' })).toBeNull();
});

it.each(['file', 'memory'] as const)('%s query 来源的 embedding_send 不借用目标知识集合许可，使用固定目的地', async kind => {
  const api = boundary(), user = userEvent.setup();
  render(<GrantForm client={api.client} workspaceId={id} sessionId={null} resources={[resource]} onGranted={vi.fn()} />);
  await screen.findByLabelText('授权来源');
  if (kind === 'memory') await user.selectOptions(screen.getByLabelText('授权来源'), 'memory');
  else await user.click(screen.getByLabelText(resource.label));
  await user.selectOptions(screen.getByLabelText('发送用途'), 'embedding_send');
  await screen.findByRole('option', { name: /项目检索/ });
  await user.selectOptions(screen.getByLabelText('实际接收目的地'), embeddingView.destination!);
  await user.click(screen.getByRole('button', { name: '确认创建用途授权' }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0].data).toMatchObject({ purposes: ['embedding_send'], destination: embeddingView.destination,
    resource_ids: kind === 'file' ? [resource.id] : [],
    memory_scopes: kind === 'memory' ? [{ kind: 'workspace', workspace_id: id, session_id: null }] : [] });
  expect(api.writes[0].data.knowledge_scopes ?? []).toEqual([]);
});
