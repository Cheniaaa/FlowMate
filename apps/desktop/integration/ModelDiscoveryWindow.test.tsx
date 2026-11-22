import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { expect, it, vi } from 'vitest';
import App from '../src/App';
import { RuntimeClient, type RuntimeConnection } from '../src/api/client';
import { expectComposerModel, selectComposerModel } from '../src/test/composer-model';
import type { ModelConnection, ModelProfile, RunDetail } from '../src/generated/contracts';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

interface Fixture {
  connection: RuntimeConnection; workspace_id: string; endpoint: string;
  aliases: string[]; synthetic_key: string; directory: string;
}
interface Receipt {
  method: string; url: string; authorization: string; x_api_key: string | null;
  body: { model: string; messages: unknown[]; stream: boolean } | null;
}
const nativeFetch = globalThis.fetch;

it('正式设置保存一份 URL/Key、发现两页别名后，聊天切换产生两个真实 SDK Run',
  { timeout: 120_000 }, async () => {
    const server = spawn(resolve('../../.venv/Scripts/python.exe'), ['tests/m2/model_discovery_window_ui_server.py'], {
      cwd: resolve('../..'), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
        PYTHONIOENCODING: 'utf-8', PYTHONPATH: `${resolve('../../packages')};${resolve('../..')}` },
    });
    let stderr = '', fixture: Fixture | undefined, view: ReturnType<typeof render> | undefined;
    let stage = 'fixture-startup', sequence = 0;
    const requests: { method: string; path: string; body?: unknown }[] = [];
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const exited = new Promise<number | null>(done => server.once('exit', done));
    server.stderr.on('data', chunk => { stderr += String(chunk); });
    const ready = new Promise<Fixture>((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`夹具启动超时：${stderr}`)), 45_000);
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => {
        clearTimeout(timer);
        const error = new Error(`夹具退出 ${code}：${stderr}`);
        reject(error);
        for (const waiter of pending.values()) waiter.reject(error);
      });
      createInterface({ input: server.stdout }).on('line', line => {
        const value = JSON.parse(line);
        if (value.kind === 'ready') { clearTimeout(timer); done(value); return; }
        const waiter = pending.get(value.id);
        if (!waiter) throw new Error(`未配对的合成宿主应答：${line}`);
        pending.delete(value.id);
        if (value.error) waiter.reject(new Error(value.error)); else waiter.resolve(value.result);
      });
    });
    function hostInvoke(command: string, args: unknown) {
      return new Promise((done, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve: done, reject });
        server.stdin.write(JSON.stringify({ id, command, args }) + '\n');
      });
    }
    try {
      fixture = await ready;
      const files = (name: string) => resolve(fixture!.directory, name);
      const receipts = (): Receipt[] => JSON.parse(readFileSync(files('gateway-receipts.json'), 'utf-8'));
      vi.mocked(invoke).mockImplementation(async (command, args) => {
        if (command === 'runtime_connection') return fixture!.connection;
        if (command === 'window_settings') return {
          quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null,
        };
        if (['pending_counts', 'take_workbench_navigation', 'take_settings_navigation',
          'set_quick_form_active'].includes(command)) return null;
        if (['save_credential', 'credential_status'].includes(command)) return hostInvoke(command, args);
        throw new Error(`联合验收未定义的宿主 IPC：${command}`);
      });
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (!String(input).startsWith(fixture!.connection.base_url + '/v3/')) throw new Error(`禁止外部请求：${input}`);
        requests.push({ path: new URL(String(input)).pathname, method: init.method ?? 'GET',
          body: init.body ? JSON.parse(String(init.body)) : undefined });
        return nativeFetch(input, { ...init, headers: {
          ...Object.fromEntries(new Headers(init.headers)), Origin: 'http://tauri.localhost',
        } });
      });
      const client = new RuntimeClient(fixture.connection), user = userEvent.setup();
      expect((await client.connections()).items).toEqual([]);
      expect((await client.models()).items).toEqual([]);
      expect(receipts()).toEqual([]);
      window.history.replaceState(null, '', '/?window=main');
      view = render(<App />);
      await screen.findByText('本机事件流已连接', {}, { timeout: 8_000 });
      stage = 'settings-save-url-key';
      await user.click(screen.getByTitle('设置'));
      const settings = await screen.findByRole('dialog', { name: '设置' });
      await user.click(await within(settings).findByRole('button', { name: '新建连接' }));
      await user.type(within(settings).getByLabelText('连接名称'), '单连接双别名离线网关');
      await user.type(within(settings).getByLabelText('Endpoint'), fixture.endpoint);
      await user.type(within(settings).getByLabelText('API Key（仅保存到系统凭据）'), fixture.synthetic_key);
      await user.selectOptions(within(settings).getByLabelText('协议'), 'openai_compatible');
      await user.click(within(settings).getByRole('button', { name: '保存连接' }));
      await within(settings).findByText('连接已保存；仅对新运行生效');
      expect(within(settings).getByLabelText('API Key（仅保存到系统凭据）')).toHaveProperty('value', '');
      const connections = (await client.connections()).items;
      expect(connections).toHaveLength(1);
      const connection: ModelConnection = connections[0];
      expect(connection).toMatchObject({ endpoint: fixture.endpoint, protocol: 'openai_compatible' });
      expect(connection.secret_ref).toBeTruthy();
      stage = 'settings-discover-paginated-models';
      // 发现必须由产品 UI 在保存凭据后发起，不通过 API 补做或手填别名。
      await waitFor(() => expect(receipts().filter(item => item.method === 'GET')).toHaveLength(2));
      const catalogs = receipts();
      expect(catalogs.every(item => item.method === 'GET')).toBe(true);
      expect(catalogs.map(item => new URL(item.url).pathname)).toEqual([
        '/gateway/custom/v1/models', '/gateway/custom/v1/models',
      ]);
      expect(new URL(catalogs[0].url).search).toBe('');
      expect(new URL(catalogs[1].url).searchParams.get('after')).toBe('GPT-FlowMate-custom-A');
      await user.click(await within(settings).findByRole('button', { name: '选择本站型号（2）' }));
      const profiles: ModelProfile[] = [];
      for (const alias of fixture.aliases) {
        stage = `settings-select-${alias}`;
        const createModel = within(settings).getByRole('button', { name: '新建模型' });
        await waitFor(() => expect(createModel).toHaveProperty('disabled', false));
        await user.click(createModel);
        const candidates = await within(settings).findByLabelText('本站型号');
        await user.selectOptions(candidates, alias);
        expect(within(settings).getByLabelText('Model ID')).toHaveProperty('value', alias);
        await user.click(within(settings).getByRole('button', { name: '保存模型' }));
        await waitFor(async () => {
          expect((await client.models()).items.find(item => item.model_id === alias)).toBeTruthy();
        });
        const profile = (await client.models()).items.find(item => item.model_id === alias)!;
        expect(profile.connection_id).toBe(connection.id);
        expect(profile.context_window_tokens).toBeNull();
        expect(profile.capabilities).toEqual({ tools: null, thinking: null, vision: null, structured_output: null });
        profiles.push(profile);
      }
      expect(receipts().filter(item => item.method === 'POST')).toEqual([]);
      const credentials = JSON.parse(readFileSync(files('credential-receipts.json'), 'utf-8'));
      expect(credentials.filter((item: { operation: string }) => item.operation === 'save')).toHaveLength(1);
      await user.click(within(settings).getByRole('button', { name: '完成' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull());
      stage = 'chat-create-session';
      await user.click(screen.getByRole('button', { name: '新建会话' }));
      await user.type(screen.getByLabelText('新会话标题'), '同一网关两个真实型号');
      await user.click(screen.getByRole('button', { name: '创建会话' }));
      await screen.findByRole('heading', { name: '同一网关两个真实型号' });
      const details: RunDetail[] = [];
      for (const profile of profiles) {
        stage = `chat-send-${profile.model_id}`;
        // 保存设置后自动刷新可选项；不使用聊天里的“刷新模型／刷新连接”绕过同步。
        await selectComposerModel(user, profile.id, screen, 8_000);
        await expectComposerModel(user, profile.id);
        await user.type(screen.getByLabelText('消息'), `请用当前型号答复本轮：${profile.model_id}`);
        await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toHaveProperty('disabled', false));
        await user.click(screen.getByRole('button', { name: '发送' }));
        const answer = `离线型号核验完成：${profile.model_id}`;
        const session = (await client.sessions(fixture.workspace_id)).items.find(item => item.title === '同一网关两个真实型号')!;
        let detail: RunDetail | undefined;
        await waitFor(async () => {
          const run = (await client.sessionRuns(session.id)).items.find(item => item.config.model_profile.id === profile.id)!;
          detail = await client.run(run.id);
          expect(['completed', 'failed', 'waiting_user', 'waiting_approval', 'blocked_incompatible'])
            .toContain(detail.run.state);
        }, { timeout: 30_000 });
        writeFileSync(files(`run-${profile.model_id}.json`), JSON.stringify(detail, null, 2));
        expect.soft(detail!.run.state, `${profile.model_id}: ${detail!.run.reason}`).toBe('completed');
        if (detail!.run.state === 'completed') {
          await screen.findByText(answer, {}, { timeout: 8_000 });
          expect(screen.getAllByText(answer)).toHaveLength(1);
        }
        expect(detail!.run.config.model_profile).toMatchObject({
          model_id: profile.model_id, connection_id: connection.id, endpoint: fixture.endpoint,
          protocol: 'openai_compatible', secret_ref: connection.secret_ref,
        });
        expect(detail!.run.config.model_profile.metadata_sources.context_window_tokens.kind).toBe('application');
        expect.soft(detail!.budget.model_requests).toBe(1);
        expect(detail!.activities.items.filter(item => item.kind === 'model')).toHaveLength(1);
        expect(detail!.activities.items.filter(item => item.kind === 'tool')).toHaveLength(0);
        details.push(detail!);
      }
      stage = 'audit-sdk-model-and-shared-key';
      const posts = receipts().filter(item => item.method === 'POST');
      writeFileSync(files('window-evidence.json'), JSON.stringify({ stage, connection, profiles, details, requests }, null, 2));
      const bindings = JSON.parse(readFileSync(files('credential-receipts.json'), 'utf-8'));
      expect(bindings.filter((item: { operation: string }) => item.operation === 'save')).toHaveLength(1);
      expect(bindings.length).toBeGreaterThan(2);
      for (const item of bindings) expect(item.binding).toEqual({
        kind: 'model', connection_id: connection.id, connection_version: connection.version,
        protocol: 'openai_compatible', endpoint: fixture.endpoint, secret_ref: connection.secret_ref,
      });
      const mutations = requests.filter(item => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(item.method));
      expect(mutations.filter(item => /\/model-connections\/[^/]+$/.test(item.path))).toHaveLength(1);
      expect(mutations.filter(item => /\/models\/[^/]+$/.test(item.path))).toHaveLength(2);
      expect(mutations.filter(item => /\/sessions\/[^/]+\/runs$/.test(item.path))).toHaveLength(2);
      expect(JSON.stringify(requests)).not.toContain(fixture.synthetic_key);
      expect(posts.map(item => item.body!.model)).toEqual(['GPT-FlowMate-custom-A', 'Claude-FlowMate-custom-B']);
      expect(posts.map(item => item.url)).toEqual([fixture.endpoint, fixture.endpoint]);
      expect(receipts().every(item => item.authorization === `Bearer ${fixture!.synthetic_key}` && item.x_api_key === null)).toBe(true);
      expect(posts.every(item => item.body!.stream === true)).toBe(true);
      expect(posts[1].body!.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: '离线型号核验完成：GPT-FlowMate-custom-A' }),
      ]));
      stage = 'completed';
      writeFileSync(files('window-evidence.json'), JSON.stringify({ stage, connection, profiles, details, requests }, null, 2));
    } finally {
      if (fixture) {
        writeFileSync(resolve(fixture.directory, 'ui-last.html'), document.body.outerHTML);
        writeFileSync(resolve(fixture.directory, 'window-requests.json'), JSON.stringify(requests, null, 2));
        writeFileSync(resolve(fixture.directory, 'acceptance-stage.json'), JSON.stringify({ stage }, null, 2));
        console.info(`型号发现联合验收断点 ${stage}；证据：${fixture.directory}`);
      }
      view?.unmount();
      vi.unstubAllGlobals(); vi.mocked(invoke).mockReset();
      window.history.replaceState(null, '', '/');
      if (server.exitCode === null) server.stdin.end(JSON.stringify({ command: 'stop' }) + '\n');
      const code = await exited;
      if (fixture) writeFileSync(resolve(fixture.directory, 'server-stderr.log'), stderr);
      expect(code, stderr).toBe(0);
    }
    const audit = JSON.parse(readFileSync(resolve(fixture!.directory, 'sqlite-audit.json'), 'utf-8'));
    expect(audit.runs).toHaveLength(2);
    expect(audit.runs.every((run: { state: string }) => run.state === 'completed')).toBe(true);
    expect(audit.events.filter((event: { kind: string }) => event.kind === 'run.started')).toHaveLength(2);
    expect(audit.activities).toHaveLength(2);
    expect(audit.grants).toHaveLength(0);
    expect(audit.approvals).toHaveLength(0);
  });
