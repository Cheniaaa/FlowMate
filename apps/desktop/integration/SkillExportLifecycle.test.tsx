import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../src/api/client';
import WorkbenchWindow from '../src/windows/WorkbenchWindow';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
  close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
});
let process: ChildProcessWithoutNullStreams, exit: Promise<unknown>;
let fixture: { connection: ConstructorParameters<typeof RuntimeClient>[0]; workspace: { id: string; name: string }; session: { id: string } };
const nativeFetch = globalThis.fetch;
beforeAll(async () => {
  process = spawn(resolve('../../.venv/Scripts/python.exe'), ['tests/m2/skill_export_lifecycle_ui_server.py'], {
    cwd: resolve('../..'), env: { ...globalThis.process.env, PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: `${resolve('../../packages')};${resolve('../..')}` },
  });
  exit = new Promise(done => process.once('exit', done));
  let errors = '';
  process.stderr.on('data', data => { errors += String(data); });
  fixture = await new Promise((done, reject) => {
    let text = '';
    process.once('error', reject); process.once('exit', () => reject(new Error(errors)));
    process.stdout.on('data', data => { text += String(data); if (text.includes('\n')) done(JSON.parse(text.split('\n')[0])); });
  });
}, 45_000);
afterAll(async () => { process.stdin.end('\n'); await exit; }, 30_000);
afterEach(() => vi.unstubAllGlobals());

it('真实删除被拦截后自动打开保存回执，显式恢复/处置再删除，原草稿与外部文件保留', { timeout: 30_000 }, async () => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => nativeFetch(input, {
    ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Origin: 'http://tauri.localhost' },
  }));
  const client = new RuntimeClient(fixture.connection), user = userEvent.setup();
  const records = await client.skillExports({ scope_kind: 'workspace', workspace_id: fixture.workspace.id });
  expect(records).toHaveLength(1);
  const receipt = records[0];
  expect(receipt.state).toBe('needs_restore');
  async function deleteProject() {
    await user.click(screen.getByRole('button', { name: `项目「${fixture.workspace.name}」的更多操作` }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: '删除项目' }));
    const confirmation = within(await screen.findByRole('dialog', { name: '确认隐私删除' }));
    expect(confirmation.getByText(`删除“${fixture.workspace.name}”中`, { exact: false })).toBeTruthy();
    await user.click(confirmation.getByRole('button', { name: '确认删除' }));
  }
  render(<WorkbenchWindow client={client} />);
  await user.click(await screen.findByRole('button', { name: 'D 集成会话' }, { timeout: 7000 }));
  await screen.findByRole('heading', { name: 'D 集成会话' }, { timeout: 7000 });
  await user.type(screen.getByLabelText('消息'), '删除失败时保留这条草稿');
  await deleteProject();
  const library = within(await screen.findByRole('region', { name: '能力库' }));
  await library.findByText('保存中断，原文件待恢复');
  expect((await client.workspaceSnapshot(fixture.workspace.id)).workspace.id).toBe(fixture.workspace.id);
  expect(existsSync(receipt.target_path)).toBe(false);
  expect(readFileSync(receipt.backup_path!).toString('hex')).toBe('6f726967696e616c205549205a495000ff');
  await user.click(library.getByRole('button', { name: '恢复原文件' }));
  await library.findByText('原文件完整，未确认保存新版本');
  await user.click(library.getByRole('button', { name: '完成处置并清理所属临时文件' }));
  await library.findByText('已恢复原文件并完成处置');
  expect(readFileSync(receipt.target_path).toString('hex')).toBe('6f726967696e616c205549205a495000ff');
  writeFileSync(receipt.target_path, 'changed after disposal');
  const history = await client.skillExport(receipt.command_id, { scope_kind: 'workspace', workspace_id: fixture.workspace.id });
  expect(history).toMatchObject({ disposition: 'restored', target_matches: 'original' });
  expect(library.getByText('当时核对为原文件')).toBeTruthy();
  expect(library.queryByRole('button', { name: '重新核对' })).toBeNull();
  await user.click(library.getByRole('button', { name: '返回对话与草稿' }));
  expect((screen.getByLabelText('消息') as HTMLTextAreaElement).value).toBe('删除失败时保留这条草稿');
  await deleteProject();
  await waitFor(async () => {
    const response = await fetch(`${fixture.connection.base_url}/v4/workspaces/${fixture.workspace.id}/snapshot`, {
      headers: { Authorization: `Bearer ${fixture.connection.token}` },
    });
    expect(response.status).toBe(404);
  });
  expect(readFileSync(receipt.target_path, 'utf8')).toBe('changed after disposal');
  expect(existsSync(receipt.stage_path)).toBe(false);
  expect(await client.skillExports({ scope_kind: 'user_global' })).toEqual([]);
});
