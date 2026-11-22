import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { expect, it, vi } from 'vitest';
import App from '../src/App';
import { RuntimeClient, type RuntimeConnection } from '../src/api/client';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

const nativeFetch = globalThis.fetch;
interface Fixture {
  connection: RuntimeConnection; directory: string; visual_model_id: string;
  visual_endpoint: string; workspace_id: string;
}

it.each(['main', 'quick'])('%s 实际窗口打开 MCP 原图并选择新视觉接收方，原工具仅执行一次',
  { timeout: 90_000 }, async label => {
    const server = spawn(resolve('../../.venv/Scripts/python.exe'), ['tests/m2/mcp_vision_window_ui_server.py'], {
      cwd: resolve('../..'), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
        PYTHONIOENCODING: 'utf-8', PYTHONPATH: `${resolve('../../packages')};${resolve('../..')}` },
    });
    let stderr = '';
    server.stderr.on('data', chunk => { stderr += String(chunk); });
    const exited = new Promise(done => server.once('exit', done));
    let view: ReturnType<typeof render> | undefined;
    let fixture: Fixture | undefined;
    try {
      fixture = await new Promise<Fixture>((done, reject) => {
        let text = '';
        const timer = setTimeout(() => reject(new Error(`图片夹具超时：${stderr}`)), 40_000);
        server.once('exit', code => { clearTimeout(timer); reject(new Error(`夹具退出 ${code}：${stderr}`)); });
        server.stdout.on('data', chunk => {
          text += String(chunk);
          if (text.includes('\n')) { clearTimeout(timer); done(JSON.parse(text.split('\n')[0])); }
        });
      });
      vi.mocked(invoke).mockImplementation(async command => {
        if (command === 'runtime_connection') return fixture!.connection;
        if (command === 'window_settings') return { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
        return null;
      });
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (!String(input).startsWith(fixture!.connection.base_url + '/v3/')) throw new Error(`禁止外部请求：${input}`);
        return nativeFetch(input, { ...init, headers: {
          ...Object.fromEntries(new Headers(init.headers)), Origin: 'http://tauri.localhost',
        } });
      });
      URL.createObjectURL = vi.fn(() => 'blob:local-vision-image');
      URL.revokeObjectURL = vi.fn();
      const user = userEvent.setup(), client = new RuntimeClient(fixture.connection);
      window.history.replaceState(null, '', `/?window=${label}`);
      view = render(<App />);
      await screen.findByText('本机事件流已连接', {}, { timeout: 8000 });
      await user.click(screen.getByRole('button', { name: '新建会话' }));
      const title = `图片验收 ${label}`;
      await user.type(screen.getByLabelText('新会话标题'), title);
      await user.click(screen.getByRole('button', { name: '创建会话' }));
      await screen.findByRole('heading', { name: title });
      await user.type(screen.getByLabelText('消息'), '对比工具两张原图');
      await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toHaveProperty('disabled', false));
      await user.click(screen.getByRole('button', { name: '发送' }));
      const continuation = await screen.findByRole('button', { name: '选择视觉模型继续' }, { timeout: 30_000 });
      const tool = screen.getByText('echo').closest('details')!;
      await user.click(tool.querySelector('summary')!);
      await waitFor(() => expect(within(tool).getAllByRole('button', { name: '打开原图' })).toHaveLength(2));
      const open = within(tool).getAllByRole('button', { name: '打开原图' });
      await user.click(open[0]);
      expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe('blob:local-vision-image');
      await user.click(screen.getByRole('button', { name: '关闭对话框' }));
      await user.click(continuation);
      await screen.findByRole('option', { name: '图片型号' });
      await user.selectOptions(await screen.findByLabelText('视觉型号'), fixture.visual_model_id);
      await screen.findByText(`图片接收方：${fixture.visual_endpoint}`);
      await user.click(screen.getByRole('button', { name: '继续处理图片' }));
      const session = (await client.sessions(fixture.workspace_id)).items.find(item => item.title === title)!;
      await waitFor(async () => {
        const runs = (await client.sessionRuns(session.id)).items;
        expect(runs).toHaveLength(2);
        const next = runs.find(run => run.vision_source_run_id)!;
        expect(next.state).toBe('completed');
        expect(next.budget_group_id).toBe(runs.find(run => !run.vision_source_run_id)!.budget_group_id);
      }, { timeout: 20_000 });
      const receipts = readFileSync(resolve(fixture.directory, 'remote/receipts.jsonl'), 'utf-8')
        .trim().split('\n').map(line => JSON.parse(line));
      expect(receipts.filter(item => item.method === 'call')).toHaveLength(1);
      const details = await Promise.all((await client.sessionRuns(session.id)).items.map(run => client.run(run.id)));
      expect(details.flatMap(detail => detail.artifacts.items)).toHaveLength(2);
      expect(details.flatMap(detail => detail.activities.items).filter(item => item.kind === 'tool')).toHaveLength(1);
    } finally {
      if (fixture && view) writeFileSync(resolve(fixture.directory, 'window.html'), view.container.outerHTML);
      view?.unmount(); vi.unstubAllGlobals();
      server.stdin.end('stop\n');
      await exited;
    }
  });
