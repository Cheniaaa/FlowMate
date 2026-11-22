import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { id, secondId } from '../../test/fixtures';
import SessionActions from './SessionActions';

it('三种范围不混用；stop-all使用准入generation，archive使用Session.version且不cancel', async () => {
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:1', token: 'test', protocol_version: 3 });
  vi.spyOn(client, 'sessionAdmission').mockResolvedValue({ scope: { kind: 'session', workspace_id: id, session_id: secondId }, generation: 7 });
  vi.spyOn(client, 'workspaceAdmission').mockResolvedValue({ scope: { kind: 'workspace', workspace_id: id, session_id: null }, generation: 9 });
  const command = vi.fn().mockResolvedValue({ status: 'confirmed', sync: 'ready', commandId: id });
  render(<><SessionActions client={client} target={{ id: secondId, workspace_id: id, version: 21, title: '合成会话', agent_profile_id: id, kind: 'interaction', archived: false }} busy={false} onCommand={command} />
    <SessionActions client={client} target={{ id, name: '合成项目', version: 1, directory_resource_id: null }} busy={false} onCommand={command} /></>);
  await userEvent.click(screen.getByRole('button', { name: '会话「合成会话」的更多操作' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '停止本会话全部任务' }));
  expect(command).toHaveBeenLastCalledWith({ type: 'stopSession', args: [secondId, expect.objectContaining({ expected_version: 7 })] },
    { key: { workspaceId: id, sessionId: secondId }, targetName: '合成会话' });
  await userEvent.click(screen.getByRole('button', { name: '项目「合成项目」的更多操作' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '停止本项目全部任务' }));
  expect(command).toHaveBeenLastCalledWith({ type: 'stopWorkspace', args: [id, expect.objectContaining({ expected_version: 9 })] },
    { key: { workspaceId: id, sessionId: '' }, targetName: '合成项目' });
  await userEvent.click(screen.getByRole('button', { name: '会话「合成会话」的更多操作' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '归档会话' }));
  expect(command).toHaveBeenLastCalledWith({ type: 'archiveSession', args: [secondId, { meta: expect.objectContaining({ expected_version: 21 }), data: { archived: true } }] });
  expect(command).toHaveBeenCalledTimes(3);
});
