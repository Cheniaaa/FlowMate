import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { expect, it, vi } from 'vitest';
import App from '../src/App';
import { RuntimeClient, type RuntimeConnection } from '../src/api/client';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

interface Fixture {
  connection: RuntimeConnection;
  directory: string;
  session_id: string;
  prompt: string;
  coordinator: string;
  leaf: string;
  early_candidate: string;
  private_draft: string;
}

type WindowLabel = 'main' | 'quick';
const nativeFetch = globalThis.fetch;
const sessionTitle = '第三批成员逐级交付验收';

it('两窗从原会话读取同一份双层委派报告，刷新成员进度保留各自草稿',
  { timeout: 120_000 }, async () => {
    const root = resolve('../..');
    const server = spawn(resolve(root, '.venv/Scripts/python.exe'),
      ['-m', 'tests.m2.batch_three_acceptance.ui_server'], {
        cwd: root, env: {
          ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8',
          PYTHONPATH: [resolve(root, 'packages'), resolve(root, 'tests/m2'), root].join(delimiter),
        },
      });
    let stderr = '';
    server.stderr.on('data', chunk => { stderr += String(chunk); });
    const exited = new Promise<number | null>(done => server.once('close', done));
    const requests: { path: string; method: string; status?: number }[] = [];
    const views: Partial<Record<WindowLabel, ReturnType<typeof render>>> = {};
    const observed: Partial<Record<WindowLabel, string[]>> = {};
    const observers: MutationObserver[] = [];
    let fixture: Fixture | undefined;
    try {
      fixture = await new Promise<Fixture>((done, reject) => {
        let text = '';
        const timeout = setTimeout(() => reject(new Error(`夹具启动超时：${stderr}`)), 45_000);
        server.once('error', error => { clearTimeout(timeout); reject(error); });
        server.once('close', code => { clearTimeout(timeout); reject(new Error(`夹具退出 ${code}：${stderr}`)); });
        server.stdout.on('data', chunk => {
          text += String(chunk);
          if (text.includes('\n')) { clearTimeout(timeout); done(JSON.parse(text.split('\n')[0])); }
        });
      });
      const setup = fixture;
      const save = (name: string, value: unknown) =>
        writeFileSync(resolve(setup.directory, `${name}.json`), JSON.stringify(value, null, 2));
      const load = (name: string) => readFileSync(resolve(setup.directory, `${name}.json`), 'utf-8');
      const sdk = () => JSON.parse(load('sdk-requests')) as { role: string; round: number; body: unknown }[];
      const visible = (label: WindowLabel) => within(views[label]!.container);
      const thread = (label: WindowLabel) => visible(label).getByRole('region', { name: '持久对话' });
      // 两个 JSDOM 挂载点共享文档，实际双窗各自拥有一个 message-input。
      const draft = (label: WindowLabel) => views[label]!.container.querySelector<HTMLTextAreaElement>('#message-input')!;
      const user = userEvent.setup();
      vi.mocked(invoke).mockImplementation(async command => {
        if (command === 'runtime_connection') return setup.connection;
        if (command === 'window_settings') return {
          quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null,
        };
        if (['pending_counts', 'take_workbench_navigation', 'take_settings_navigation',
          'set_quick_form_active'].includes(command)) return null;
        throw new Error(`联合验收未定义的宿主 IPC：${command}`);
      });
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (!String(input).startsWith(setup.connection.base_url + '/v3/')) throw new Error(`禁止外部请求：${input}`);
        const entry: typeof requests[number] = { path: new URL(String(input)).pathname, method: init.method ?? 'GET' };
        requests.push(entry);
        const response = await nativeFetch(input, { ...init, headers: {
          ...Object.fromEntries(new Headers(init.headers)), Origin: 'http://tauri.localhost',
        } });
        entry.status = response.status;
        return response;
      });

      const forbidden = [setup.early_candidate, setup.private_draft];
      for (const label of ['main', 'quick'] as const) {
        window.history.replaceState(null, '', `/?window=${label}`);
        views[label] = render(<App />);
        const app = visible(label);
        await app.findByText('本机事件流已连接', {}, { timeout: 10_000 });
        expect(views[label]!.container.querySelector(label === 'main' ? '.workbench-window' : '.quick-assistant')).toBeTruthy();
        await user.click(await app.findByRole('button', { name: sessionTitle }));
        await app.findByRole('heading', { name: sessionTitle });
        const shown = observed[label] = [];
        const conversation = thread(label);
        const observer = new MutationObserver(records => {
          const changedText = [conversation.textContent, ...records.flatMap(record => [
            record.target.textContent, ...Array.from(record.addedNodes, node => node.textContent),
          ])].join('\n');
          for (const text of forbidden) if (changedText.includes(text) && !shown.includes(text)) shown.push(text);
        });
        observer.observe(conversation, { childList: true, characterData: true, subtree: true });
        observers.push(observer);
      }
      const client = new RuntimeClient(setup.connection);
      await user.type(draft('main'), setup.prompt);
      const send = visible('main').getByRole('button', { name: '发送' });
      await waitFor(() => expect(send).toHaveProperty('disabled', false));
      await user.click(send);
      const run = await waitFor(async () => {
        const { items } = await client.sessionRuns(setup.session_id);
        expect(items).toHaveLength(1);
        return items[0];
      }, { timeout: 15_000 });
      await waitFor(async () => {
        const lanes = await client.memberLanes(run.id);
        expect(lanes).toHaveLength(4);
        expect(lanes.find(lane => lane.task.id === run.root_task_id)?.task.state).toBe('waiting_children');
        expect(lanes.find(lane => lane.profile.display_name === setup.coordinator)?.task.state).toBe('waiting_children');
        expect(lanes.filter(lane => lane.activities.some(activity => activity.kind === 'tool' && activity.state === 'dispatched'))).toHaveLength(2);
      }, { timeout: 20_000, interval: 100 });

      const beforeRefresh = sdk().length;
      const completedGets = (path: string) => requests.filter(entry => entry.method === 'GET'
        && entry.path === path && entry.status === 200).length;
      const inspectProgress = async (label: WindowLabel) => {
        await user.click(within(visible(label).getByRole('navigation', { name: '会话详情入口' }))
          .getByRole('button', { name: '任务' }));
        const dialog = await screen.findByRole('dialog', { name: '任务详情' });
        const panel = within(dialog);
        await panel.findByRole('region', { name: '任务图' });
        writeFileSync(resolve(setup.directory, `${label}-progress.html`), dialog.outerHTML);
        const tracePath = `/v3/runs/${run.id}/trace`;
        const previous = completedGets(tracePath);
        await user.click(panel.getByRole('button', { name: '查看 Trace' }));
        const trace = within(await panel.findByRole('region', { name: '公开事件' }));
        await trace.findByText('运行开始', {}, { timeout: 10_000 });
        expect(completedGets(tracePath)).toBeGreaterThan(previous);
        await user.click(panel.getByRole('button', { name: '关闭详情' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      };
      const refreshMemberLanes = async () => {
        const main = visible('main');
        await user.click(within(main.getByRole('complementary', { name: '项目导航' })).getByTitle('任务'));
        const management = within(await main.findByRole('region', { name: '任务管理页面' }));
        await user.click(await management.findByRole('button', { name: '查看任务详情' }));
        const detail = within(await management.findByRole('region', { name: '任务详情' }));
        await user.click(await detail.findByRole('button', { name: '成员泳道' }));
        const lanes = await detail.findByRole('region', { name: '成员泳道' });
        await within(lanes).findByRole('heading', { name: setup.leaf });
        const lanesPath = `/v3/runs/${run.id}/member-lanes`;
        const previous = completedGets(lanesPath);
        await user.click(detail.getByRole('button', { name: '刷新详情' }));
        await waitFor(() => expect(completedGets(lanesPath)).toBeGreaterThan(previous));
        writeFileSync(resolve(setup.directory, 'main-member-lanes.html'), lanes.outerHTML);
        await user.click(management.getByRole('button', { name: '返回任务中心' }));
        await management.findByRole('heading', { name: '任务中心' });
        await user.click(management.getByRole('button', { name: '返回对话与草稿' }));
      };
      const drafts = { main: '主窗尚未发送的输入', quick: '小窗尚未发送的输入' };
      for (const label of ['main', 'quick'] as const) {
        await user.type(draft(label), drafts[label]);
        await inspectProgress(label);
        if (label === 'main') await refreshMemberLanes();
        expect(draft(label).value).toBe(drafts[label]);
        writeFileSync(resolve(setup.directory, `${label}-waiting.html`), views[label]!.container.outerHTML);
      }
      const afterRefresh = sdk().length;
      expect(afterRefresh).toBe(beforeRefresh);
      server.stdin.write('release\n');
      const completed = await waitFor(async () => {
        const detail = await client.run(run.id);
        expect(detail.run.state).toBe('completed');
        return detail;
      }, { timeout: 25_000, interval: 120 });
      const markers = Object.fromEntries((JSON.parse(load('marker-receipts')) as { branch: string; marker: string }[])
        .map(item => [item.branch, item.marker]));
      expect(markers.left).toMatch(/^B3-left-[0-9a-f]{32}$/);
      expect(markers.right).toMatch(/^B3-right-[0-9a-f]{32}$/);
      const finalRequests = sdk();
      expect(finalRequests).toHaveLength(completed.budget.model_requests);
      expect(JSON.stringify(finalRequests.find(item => item.role === 'leaf' && item.round === 2)?.body))
        .toContain(setup.private_draft);
      expect(JSON.stringify(finalRequests.filter(item => item.role !== 'leaf'))).not.toContain(setup.private_draft);
      const windowEvidence = [];
      for (const label of ['main', 'quick'] as const) {
        const chat = within(thread(label));
        const left = await chat.findByText(`左侧：${markers.left}`, { exact: false }, { timeout: 12_000 });
        const answer = left.closest('article')!;
        expect(answer.textContent).toContain(`右侧：${markers.right}`);
        const replies = chat.getAllByRole('article', { name: /的回复$|^正式答复$/ })
          .filter(article => article.querySelector('.message-content > .markdown-body'));
        expect.soft(replies, `${label} 可见的助理正文`).toEqual([answer]);
        expect(draft(label).value).toBe(drafts[label]);
        expect.soft(observed[label], `${label} 对话曾显示候选或成员私人正文`).toEqual([]);
        const text = thread(label).textContent ?? '';
        for (const marker of forbidden) expect.soft(text, `${label} 持久对话泄露正文`).not.toContain(marker);
        windowEvidence.push({
          label, answer: answer.textContent, answerCount: replies.length,
          draft: draft(label).value, observed: observed[label],
        });
        writeFileSync(resolve(setup.directory, `${label}-completed.html`), views[label]!.container.outerHTML);
      }
      const messages = (await client.messages(setup.session_id)).items;
      save('window-evidence', {
        run: run.id, markers, beforeRefresh, afterRefresh,
        complete: finalRequests.length, windows: windowEvidence, messages,
      });
      const replies = messages.filter(message => message.role === 'assistant' && message.parts.some(part => part.kind === 'text'));
      expect(replies.map(message => message.parts)).toEqual([
        [{ kind: 'text', text: `核验报告\n左侧：${markers.left}\n右侧：${markers.right}` }],
      ]);
      expect(requests.filter(entry => entry.method === 'POST')).toEqual([
        { method: 'POST', path: `/v3/sessions/${setup.session_id}/runs`, status: 202 },
      ]);
    } finally {
      for (const observer of observers) observer.disconnect();
      for (const view of Object.values(views)) view.unmount();
      vi.unstubAllGlobals();
      vi.mocked(invoke).mockReset();
      window.history.replaceState(null, '', '/');
      server.stdin.end('stop\n');
      const code = await exited;
      if (fixture) {
        writeFileSync(resolve(fixture.directory, 'server-stderr.log'), stderr);
        writeFileSync(resolve(fixture.directory, 'window-requests.json'), JSON.stringify(requests, null, 2));
        console.info(`双窗委派证据目录 ${fixture.directory}`);
      }
      expect(code, stderr).toBe(0);
    }
  });
