import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { expect, it, vi } from 'vitest';
import App from '../src/App';
import { RuntimeClient, type RuntimeConnection } from '../src/api/client';
import { McpClient } from '../src/api/mcp';
import { expectComposerModel } from '../src/test/composer-model';
import type { ModelMessage, RunSnapshot } from '../src/generated/contracts';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

interface Fixture {
  connection: RuntimeConnection; workspace_id: string; model_id: string;
  agent_name: string; server_id: string; directory: string;
}
interface Receipt { method: string; name?: string; arguments?: unknown; marker?: string }
interface StoredActivity {
  id: string; state: string; attempt_id: string;
  intent: { kind: 'model' | 'tool'; operation: string };
}
const nativeFetch = globalThis.fetch;

it.each(['main', 'quick', 'recovery'])('%s 实际 App → HTTP/SQLite/Scheduler → stdio MCP → SDK 续轮 → 一次可见答复',
  { timeout: 120_000 }, async label => {
    const recovery = label === 'recovery';
    const windowMode = recovery ? 'main' : label;
    const args = ['tests/m2/mcp_marker_window_ui_server.py', ...(recovery ? ['--query-recovery'] : [])];
    const server = spawn(resolve('../../.venv/Scripts/python.exe'), args, {
      cwd: resolve('../..'), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
        PYTHONIOENCODING: 'utf-8', PYTHONPATH: `${resolve('../../packages')};${resolve('../..')}` },
    });
    let stderr = '';
    server.stderr.on('data', chunk => { stderr += String(chunk); });
    const exited = new Promise<number | null>(done => server.once('exit', done));
    let fixture: Fixture | undefined, view: ReturnType<typeof render> | undefined;
    const requests: { path: string; method: string; query: string; body?: unknown }[] = [];
    try {
      fixture = await new Promise<Fixture>((done, reject) => {
        let text = '';
        const timeout = setTimeout(() => reject(new Error(`夹具启动超时：${stderr}`)), 45_000);
        server.once('error', error => { clearTimeout(timeout); reject(error); });
        server.once('exit', code => { clearTimeout(timeout); reject(new Error(`夹具退出 ${code}：${stderr}`)); });
        server.stdout.on('data', chunk => {
          text += String(chunk);
          if (text.includes('\n')) { clearTimeout(timeout); done(JSON.parse(text.split('\n')[0])); }
        });
      });
      const files = (name: string) => resolve(fixture!.directory, name);
      const receipts = (): Receipt[] => readFileSync(files('remote/receipts.jsonl'), 'utf-8')
        .trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      vi.mocked(invoke).mockImplementation(async command => {
        if (command === 'runtime_connection') return fixture!.connection;
        if (command === 'window_settings') return {
          quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null,
        };
        if (['pending_counts', 'take_workbench_navigation', 'take_settings_navigation',
          'set_quick_form_active'].includes(command)) return null;
        throw new Error(`联合验收未定义的宿主 IPC：${command}`);
      });
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => {
        const { pathname: path, search: query } = new URL(String(input));
        if (!String(input).startsWith(fixture!.connection.base_url + '/v4/')) throw new Error(`禁止外部请求：${input}`);
        requests.push({ path, method: init.method ?? 'GET', query, body: init.body ? JSON.parse(String(init.body)) : undefined });
        return nativeFetch(input, { ...init, headers: {
          ...Object.fromEntries(new Headers(init.headers)), Origin: 'http://tauri.localhost',
        } });
      });
      const client = new RuntimeClient(fixture.connection), user = userEvent.setup();
      expect(receipts().filter(item => item.method === 'call')).toHaveLength(0);
      expect((await client.grants(fixture.workspace_id)).items).toHaveLength(0);
      const mcp = await new McpClient(fixture.connection).mcpServer(fixture.server_id);
      expect(mcp.config.enabled).toBe(true);
      expect(mcp.state).toBe('connected');
      expect(mcp.selection).toBeNull();
      expect((await client.activeRuns(fixture.workspace_id)).items).toHaveLength(0);
      window.history.replaceState(null, '', `/?window=${windowMode}`);
      view = render(<App />);
      await screen.findByText('本机事件流已连接', {}, { timeout: 8000 });
      expect(!!document.querySelector('.quick-assistant')).toBe(windowMode === 'quick');
      expect(!!document.querySelector('.workbench-window')).toBe(windowMode === 'main');
      await user.click(screen.getByRole('button', { name: '新建会话' }));
      const title = `${label} 窗口离线工具核验`;
      await user.type(screen.getByLabelText('新会话标题'), title);
      await user.click(screen.getByRole('button', { name: '创建会话' }));
      await screen.findByRole('heading', { name: title });
      await expectComposerModel(user, fixture.model_id);
      const prompt = '查询已启用的本机资料，按返回的新标记给出核验结论。';
      await user.type(screen.getByLabelText('消息'), prompt);
      await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toHaveProperty('disabled', false));
      await user.click(screen.getByRole('button', { name: '发送' }));
      const activity = await screen.findByRole('region', { name: '本轮活动' }, { timeout: 45_000 });
      expect(activity.textContent).toContain('模型回复');
      expect(receipts().filter(item => item.method === 'call')).toHaveLength(0);
      writeFileSync(files('ui-active.html'), view.container.outerHTML);
      server.stdin.write('release-model\n');
      await waitFor(() => expect(receipts().filter(item => item.method === 'call')).toHaveLength(1), { timeout: 15_000 });
      const receipt = receipts().find(item => item.method === 'call')!;
      expect(receipt.name).toBe(recovery ? 'echo' : 'read_marker');
      let interrupted: RunSnapshot | undefined;
      if (recovery) {
        expect(receipt.arguments).toEqual({ text: '读取合成资料' });
        const card = await screen.findByRole('region', { name: '查询恢复' }, { timeout: 15_000 });
        expect(within(card).getByText(/原查询不会自动重复/)).toBeTruthy();
        const { items } = await client.activeRuns(fixture.workspace_id);
        expect(items).toHaveLength(1);
        interrupted = items[0];
        expect(interrupted).toMatchObject({ state: 'interrupted', reason: 'mcp_query_uncertain' });
        await user.click(await within(card).findByRole('button', { name: '按已有材料继续' }));
      } else {
        expect(receipt.arguments).toEqual({ query: '读取合成资料' });
        expect(receipt.marker).toMatch(/^M2-[0-9a-f]{32}$/);
      }
      const answer = recovery ? '根据现有资料继续。预约情况未核实。' : `查询核验完成：${receipt.marker}`;
      const visibleAnswer = await screen.findByText(answer, {}, { timeout: 15_000 });
      expect(visibleAnswer.closest('article')).toBeTruthy();
      expect(screen.getAllByText(answer)).toHaveLength(1);
      if (!recovery) {
        await screen.findByText('read_marker');
        const toolCard = screen.getByText('read_marker').closest('details')!;
        await waitFor(() => expect(within(toolCard).getByText('已返回')).toBeTruthy());
        await user.click(toolCard.querySelector('summary')!);
        expect(toolCard.open).toBe(true);
        expect(within(toolCard).getByText(receipt.marker!)).toBeTruthy();
      }

      // 从真实 API 读取 UI 创建的会话。
      const sessions = (await client.sessions(fixture.workspace_id)).items.filter(item => item.title === title);
      expect(sessions).toHaveLength(1);
      const runs = (await client.sessionRuns(sessions[0].id)).items;
      expect(runs).toHaveLength(1);
      if (interrupted) {
        expect(runs[0].id).toBe(interrupted.id);
        expect(requests.filter(item => item.method === 'POST' && item.path.endsWith('/resume'))).toEqual([{
          path: `/v4/runs/${interrupted.id}/resume`, method: 'POST', query: '',
          body: { command_id: expect.any(String), expected_version: interrupted.version },
        }]);
      }
      const detail = await client.run(runs[0].id);
      expect(detail.run.state).toBe('completed');
      expect(detail.run.config).toMatchObject({ kind: 'agent', model_profile: { id: fixture.model_id } });
      expect(detail.run.output?.summary).toBe(answer);
      expect(detail.budget.model_requests).toBe(2);
      expect(detail.approvals.items).toHaveLength(0);
      const tools = detail.activities.items.filter(item => item.kind === 'tool');
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject(recovery ? { state: 'uncertain', error: 'mcp_call_uncertain' }
        : { state: 'succeeded', error: null });
      expect(detail.activities.items.filter(item => item.kind === 'model')).toHaveLength(2);
      const messages = (await client.messages(sessions[0].id)).items;
      const finals = messages.filter(item => item.role === 'assistant' && item.parts.some(part => part.kind === 'text'));
      expect(finals).toHaveLength(1);
      expect(finals[0].parts).toEqual([{ kind: 'text', text: answer }]);
      expect(messages.filter(item => item.role === 'user')).toHaveLength(1);
      const modelRequests = JSON.parse(readFileSync(files('model-requests.json'), 'utf-8'));
      expect(modelRequests).toHaveLength(2);
      if (recovery) expect(JSON.stringify(modelRequests[1])).toContain('mcp_call_uncertain');
      else {
        expect(JSON.stringify(modelRequests[0])).not.toContain(receipt.marker);
        expect(JSON.stringify(modelRequests[1])).toContain(receipt.marker);
      }
      const submissions = requests.filter(item => item.method === 'POST' && /\/sessions\/[^/]+\/runs$/.test(item.path));
      expect(submissions).toHaveLength(1);
      expect(submissions[0].body).toMatchObject({ data: { model_profile_id: fixture.model_id } });
      expect(requests.filter(item => item.method === 'POST' && /\/(grants|decision)$/.test(item.path))).toHaveLength(0);
      expect(receipts().filter(item => item.method === 'call')).toHaveLength(1);
      expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'show_workbench')).toBe(false);
      writeFileSync(files('ui-completed.html'), view.container.outerHTML);
      writeFileSync(files('window-evidence.json'), JSON.stringify({
        label, answer, ui_answer_count: screen.getAllByText(answer).length,
        receipt, requests, detail, messages,
      }, null, 2));
    } finally {
      if (fixture && view) writeFileSync(resolve(fixture.directory, 'ui-last.html'), view.container.outerHTML);
      view?.unmount();
      vi.unstubAllGlobals();
      vi.mocked(invoke).mockReset();
      window.history.replaceState(null, '', '/');
      server.stdin.end('stop\n');
      const code = await exited;
      if (fixture) {
        writeFileSync(resolve(fixture.directory, 'server-stderr.log'), stderr);
        writeFileSync(resolve(fixture.directory, 'window-requests.json'), JSON.stringify(requests, null, 2));
        console.info(`${label} 验收证据：${fixture.directory}`);
      }
      expect(code, stderr).toBe(0);
    }
    const auditPath = resolve(fixture!.directory, 'sqlite-audit.json');
    expect(existsSync(auditPath)).toBe(true);
    const audit = JSON.parse(readFileSync(auditPath, 'utf-8')) as {
      runs: unknown[]; activities: StoredActivity[]; messages: ModelMessage[];
      events: { kind: string; payload: { activities?: StoredActivity[] } }[];
      grants: unknown[]; approvals: unknown[];
    };
    expect(audit.runs).toHaveLength(1);
    expect(audit.grants).toHaveLength(0);
    expect(audit.approvals).toHaveLength(0);
    expect(audit.events.filter(item => item.kind === 'run.started')).toHaveLength(1);
    const tool = audit.activities.filter(item => item.intent.kind === 'tool');
    expect(tool).toHaveLength(1);
    expect(tool[0].state).toBe(recovery ? 'uncertain' : 'succeeded');
    const dispatched = audit.events.filter(item => item.kind === 'activity.dispatched')
      .flatMap(item => item.payload.activities ?? []);
    expect(dispatched).toHaveLength(3);
    expect(dispatched.filter(item => item.id === tool[0].id && item.intent.kind === 'tool')).toHaveLength(1);
    for (const activity of audit.activities) {
      expect(dispatched.filter(item => item.id === activity.id && item.attempt_id === activity.attempt_id)).toHaveLength(1);
    }
    expect(audit.messages.filter(item => item.role === 'assistant' && item.parts.some(part => part.kind === 'text'))).toHaveLength(1);
  });
