import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { id, secondId, resource } from '../../test/fixtures';
import ProjectDirectory from './ProjectDirectory';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it('失效目录可读，选择目录只关联项目，不授权或添加附件；取消无命令', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ workspace_id: id, workspace_version: 2, state: 'unavailable', resource: { ...resource, kind: 'directory' }, reason: '来源不可用' }));
  vi.mocked(invoke).mockResolvedValueOnce({ resources: [] }).mockResolvedValueOnce({ resources: [{ ...resource, kind: 'directory' }] });
  const link = vi.fn().mockResolvedValue(undefined); const user = userEvent.setup();
  render(<ProjectDirectory client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} workspace={{ id, version: 2, name: '项目', directory_resource_id: resource.id }} onLink={link} />);
  await screen.findByText(/来源不可用/); await user.click(screen.getByRole('button', { name: '关联/更换目录' }));
  expect(link).not.toHaveBeenCalled(); await user.click(screen.getByRole('button', { name: '关联/更换目录' }));
  expect(link).toHaveBeenCalledWith(resource.id, 2); expect(invoke).toHaveBeenLastCalledWith('select_resources', { scope: { kind: 'workspace', workspace_id: id, session_id: null }, kind: 'directory' });
  await user.click(screen.getByRole('button', { name: '解除关联' })); expect(link).toHaveBeenLastCalledWith(null, 2);
});
it('目录命令待确认时禁止重新选择/生成新命令', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ workspace_id: id, workspace_version: 1, state: 'unlinked', resource: null, reason: null }));
  render(<ProjectDirectory client={new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 })} workspace={{ id, version: 1, name: '项目', directory_resource_id: null }} blocked onLink={async () => {}} />);
  await screen.findByText('目录：未关联');
  expect((screen.getByRole('button', { name: '关联/更换目录' }) as HTMLButtonElement).disabled).toBe(true);
});
it('原生选择跨项目往返后返回，不把旧选择关联到新视图', async () => {
  vi.stubGlobal('fetch', async (url: string) => Response.json({ workspace_id: url.includes(secondId) ? secondId : id, workspace_version: 1, state: 'unlinked', resource: null, reason: null }));
  let finish!: (selection: unknown) => void; vi.mocked(invoke).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 4 });
  const workspace = { id, version: 1, name: '项目', directory_resource_id: null }; const link = vi.fn(); const user = userEvent.setup();
  const view = render(<ProjectDirectory client={client} workspace={workspace} onLink={link} />);
  await screen.findByText('目录：未关联'); await user.click(screen.getByRole('button', { name: '关联/更换目录' }));
  view.rerender(<ProjectDirectory client={client} workspace={{ ...workspace, id: secondId }} onLink={link} />);
  view.rerender(<ProjectDirectory client={client} workspace={workspace} onLink={link} />);
  await act(async () => finish({ resources: [{ ...resource, kind: 'directory' }] }));
  expect(link).not.toHaveBeenCalled();
});
