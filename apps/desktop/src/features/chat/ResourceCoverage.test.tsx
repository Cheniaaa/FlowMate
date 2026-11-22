import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { createDraftStore } from '../../state/draft-store';
import { agent, connection, event, grant, id, model, page, run, secondId } from '../../test/fixtures';
import { Conversation } from './Conversation';
import { Toaster } from '../../components/ui/sonner';
import { toast } from 'sonner';

afterEach(() => { toast.dismiss(); vi.unstubAllGlobals(); });

it.each(['allowed', 'revoked', 'revoked-after-grant', 'destination-changed-after-grant'] as const)(
  '发送前按原附件和接收方核对授权 %s', async scenario => {
  const workspace = { id, version: 1, name: '合成项目', directory_resource_id: null };
  const session = { id, version: 1, workspace_id: id, title: '合成会话', agent_profile_id: agent.id,
    kind: 'interaction', archived: false };
  const resource = { id: secondId, version: 1, label: '合成附件', kind: 'file', source_version: null,
    scope: { kind: 'workspace', workspace_id: id, session_id: null } };
  const drafts = createDraftStore();
  drafts.update({ workspaceId: id, sessionId: id }, { text: '总结附件', modelId: model.id, resourceIds: [secondId] });
  const calls: string[] = [];
  const sent: unknown[] = [];
  let checks = 0;
  let grantSaved = false;
  const requiresGrant = scenario.endsWith('after-grant');
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/v3', '');
    if (path.endsWith('/events')) return new Response(new ReadableStream());
    if (path.endsWith('/resource-coverage')) {
      calls.push('coverage');
      checks++;
      expect(JSON.parse(init!.body as string)).toEqual({ resource_ids: [secondId], model_profile_id: model.id });
      const allowed = requiresGrant
        ? grantSaved && scenario === 'destination-changed-after-grant'
        : scenario === 'allowed' || checks === 1;
      const destination = grantSaved && scenario === 'destination-changed-after-grant'
        ? 'https://changed.example.invalid/v1' : connection.endpoint;
      return Response.json({ allowed, destination, missing_read: [],
        missing_model_send: allowed ? [] : [secondId] });
    }
    if (path === '/grants' && init?.method === 'POST') {
      const { data } = JSON.parse(init.body as string);
      expect(data.destination).toBe(connection.endpoint);
      expect(data.scope.session_id).toBe(id);
      expect(data.resource_ids).toEqual([secondId]);
      grantSaved = true;
      calls.push('grant');
      return Response.json({ ...grant, ...data });
    }
    if (path === `/sessions/${id}/runs` && init?.method === 'POST') {
      calls.push('send'); sent.push(JSON.parse(init.body as string));
      return Response.json(run);
    }
    const values: Record<string, unknown> = {
      '/workspaces': page([workspace]), '/profiles': page([agent]), '/models': page([model]),
      '/model-connections': page([connection]),
      '/navigation': { default_workspace_id: id, workspaces: page([{ workspace, sessions: page([session]), pending_count: 0 }]),
        recent_sessions: page([session]), pending_count: 0, watermark: event.event_id },
      [`/workspaces/${id}/directory`]: { workspace_id: id, workspace_version: 1, resource: null, state: 'unlinked', reason: null },
      [`/workspaces/${id}/snapshot`]: { workspace, sessions: page([session]), active_runs: page([]),
        pending_questions: page([]), pending_approvals: page([]), resources: page([resource]), grants: page([]), watermark: event.event_id },
      [`/sessions/${id}/runs`]: page([]), [`/sessions/${id}/messages`]: page([]),
    };
    return Response.json(values[path] ?? page([]));
  });
  render(<><Conversation client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321',
    token: 'synthetic', protocol_version: 3 })} draftStore={drafts} /><Toaster /></>);
  const send = await screen.findByRole('button', { name: /^发送$/ });
  await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(send);
  await waitFor(() => expect(checks).toBeGreaterThanOrEqual(2));
  if (scenario !== 'allowed') {
    expect(await screen.findByText(scenario === 'destination-changed-after-grant'
      ? /接收方已变化/ : /所选资料的读取或发送授权已失效/)).toBeTruthy();
    expect(sent).toHaveLength(0);
    expect(drafts.read({ workspaceId: id, sessionId: id })).toMatchObject({ text: '总结附件', resourceIds: [secondId] });
    if (requiresGrant) {
      expect(calls.filter(call => call === 'grant')).toHaveLength(1);
      expect(calls.slice(calls.indexOf('grant') + 1)).toContain('coverage');
    }
  } else {
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(calls.slice(0, 3)).toEqual(['coverage', 'coverage', 'send']);
  }
});
