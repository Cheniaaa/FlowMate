import { invoke } from '@tauri-apps/api/core';
import type { Fixture, Receipt, Root, RunEvent, RuntimeConnection } from './generated/probe-contracts';

export class RuntimeClient {
  constructor(readonly connection: RuntimeConnection) {}

  static async connect() {
    return new RuntimeClient(await invoke<RuntimeConnection>('runtime_connection'));
  }

  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(this.connection.base_url + path, {
      ...init, headers: { Authorization: `Bearer ${this.connection.token}`, ...init.headers },
    });
    if (!response.ok) throw new Error(`Runtime HTTP ${response.status}`);
    return response.json();
  }

  health(): Promise<{ root: Root }> { return this.request('/health'); }

  submit(root: Root, fixture: Fixture, key: string): Promise<Receipt> {
    return this.request('/probe/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin_run_id: root.run_id, origin_task_id: root.task_id,
        key, payload: { fixture }, lifetime: 'managed', reserve_units: 3 }) });
  }

  cancel(runId: string) { return this.request(`/probe/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }); }

  async events(runId: string, cursor: number, onEvent: (event: RunEvent) => boolean) {
    const abort = new AbortController();
    try {
      const response = await fetch(`${this.connection.base_url}/probe/events?run_id=${encodeURIComponent(runId)}`, {
        headers: { Authorization: `Bearer ${this.connection.token}`, 'Last-Event-ID': String(cursor) }, signal: abort.signal });
      if (!response.ok || !response.body) throw new Error(`Stream HTTP ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      const timeout = setTimeout(() => abort.abort(), 15000);
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error('Stream ended');
          buffer += chunk.value.replace(/\r\n/g, '\n');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = frame.split('\n').find(line => line.startsWith('data: '));
            if (data && onEvent(JSON.parse(data.slice(6)))) return;
          }
        }
      } finally { clearTimeout(timeout); await reader.cancel(); }
    } finally { abort.abort(); }
  }
}

export async function diagnose(client: RuntimeClient, log: (line: string) => void) {
  const checks: Record<string, boolean> = {};
  const root = (await client.health()).root;
  checks.handshake = client.connection.protocol_version === 1;
  checks.auth_rejected = (await fetch(client.connection.base_url + '/health')).status === 401;
  const key = 'desktop-' + crypto.randomUUID();
  const receipt = await client.submit(root, 'complete', key);
  let cursor = 0;
  await client.events(receipt.run_id, 0, event => { cursor = event.seq; log(`event #${event.seq}`); return true; });
  checks.stream = cursor > 0;
  let next = cursor;
  await client.events(receipt.run_id, cursor, event => { next = event.seq; log(`reconnected #${event.seq}`); return true; });
  checks.reconnect = next > cursor;
  const held = await client.submit(root, 'gated', key + '-cancel');
  await client.cancel(held.run_id);
  const view = await client.request(`/probe/snapshot?run_id=${held.run_id}`);
  checks.cancel = Object.values(view.snapshot.tasks as Record<string, { state: string }>).some(t => t.state === 'cancelled');
  // 留下固定、不重发的合成活动，用下一次真实安装版启动验证恢复围栏。
  await client.submit(root, 'uncertain_write', key + '-recover');
  await client.request('/probe/desktop-checks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(checks) });
  if (!Object.values(checks).every(Boolean)) throw new Error('诊断检查失败');
  log('WebView 鉴权、流、重连与取消已完成；日志：data_dir/desktop-host.jsonl');
  return checks;
}
