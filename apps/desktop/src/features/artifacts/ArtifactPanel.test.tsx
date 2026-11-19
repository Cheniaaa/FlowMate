import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { RuntimeClient } from '../../api/client';
import type { ArtifactRef, TextSlice } from '../../generated/contracts';
import { id, secondId } from '../../test/fixtures';
import ArtifactPanel from './ArtifactPanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'public-token', protocol_version: 3 });
const artifact: ArtifactRef = { id, version: 1, media_type: 'text/markdown', content_hash: 'sha256:source', task_id: secondId, activity_id: id, dependencies: [] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const slice = (text: string): TextSlice => ({ text, start: 0, end: text.length, total_chars: text.length, source_version: artifact.content_hash });
function preview() { return screen.getByTitle('产物预览') as HTMLIFrameElement; }

it('同一事件批次导出只开始一次；待核对期间不能另开导出选择', async () => {
  vi.stubGlobal('fetch', async () => json(slice('正文')));
  const onExport = vi.fn(() => new Promise<void>(() => {}));
  const view = render(<ArtifactPanel artifact={artifact} client={client} onExport={onExport} />);
  const button = screen.getByRole('button', { name: '导出产物' });
  act(() => { fireEvent.click(button); fireEvent.click(button); }); expect(onExport).toHaveBeenCalledOnce();
  view.rerender(<ArtifactPanel artifact={{ ...artifact, version: 2 }} client={client} onExport={onExport} exportBlocked />);
  expect((screen.getByRole('button', { name: '导出产物' }) as HTMLButtonElement).disabled).toBe(true);
});

describe('产物预览', () => {
  it('按真实客户端读取分段，展示来源与无权限 iframe，外链留在宿主受控按钮中', async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, authorization: new Headers(init.headers).get('Authorization') });
      return json(slice('# 报告\n\n[资料](https://example.invalid/doc)\n\n<script>alert(1)</script>'));
    });
    vi.mocked(invoke).mockResolvedValue(undefined);
    const selectSource = vi.fn();
    const user = userEvent.setup();
    render(<ArtifactPanel artifact={artifact} client={client} onSelectSource={selectSource} />);
    await waitFor(() => expect(preview().srcdoc).toContain('报告'));
    expect(requests).toEqual([{ url: `http://127.0.0.1:54321/v3/artifacts/${id}/content?offset=0`, authorization: 'Bearer public-token' }]);
    expect(preview().getAttribute('sandbox')).toBe('');
    expect(preview().hasAttribute('allow')).toBe(false);
    const document = new DOMParser().parseFromString(preview().srcdoc, 'text/html');
    expect(document.querySelector('a[href],script')).toBeNull();
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
    expect(screen.getByText(artifact.content_hash)).toBeTruthy();
    expect(screen.getByText(artifact.content_hash).closest('details')?.open).toBe(false);
    expect(screen.getByText(artifact.task_id)).toBeTruthy();
    expect(screen.getByText(artifact.activity_id)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '定位来源' }));
    expect(selectSource).toHaveBeenCalledExactlyOnceWith(artifact.task_id, artifact.activity_id);
    await user.click(screen.getByRole('button', { name: '打开外部链接：资料' }));
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_external', { url: 'https://example.invalid/doc' });
  });

  it('前后翻页只展示已返回分段，不拼接旧文本或自行下载全文', async () => {
    const offsets: number[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      offsets.push(offset);
      return json({ text: offset === 0 ? '前段' : '后段', start: offset, end: offset + 2, total_chars: 4, source_version: 'sha256:source' });
    });
    const user = userEvent.setup();
    render(<ArtifactPanel artifact={artifact} client={client} />);
    await waitFor(() => expect(preview().srcdoc).toContain('前段'));
    await user.click(screen.getByRole('button', { name: '下一段' }));
    await waitFor(() => expect(preview().srcdoc).toContain('后段'));
    expect(preview().srcdoc).not.toContain('前段');
    expect((screen.getByRole('button', { name: '下一段' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '前文' }));
    await waitFor(() => expect(preview().srcdoc).toContain('前段'));
    expect(offsets).toEqual([0, 2, 0]);
  });

  it('A→B→A 与删除均隔离旧请求，迟到正文不能进入新选择', async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { pending.push(resolve); }));
    const other = { ...artifact, id: secondId };
    const { rerender } = render(<ArtifactPanel artifact={artifact} client={client} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender(<ArtifactPanel artifact={other} client={client} />);
    await waitFor(() => expect(pending).toHaveLength(2));
    rerender(<ArtifactPanel artifact={artifact} client={client} />);
    await waitFor(() => expect(pending).toHaveLength(3));
    await act(async () => { pending[2](json(slice('当前 A'))); });
    await waitFor(() => expect(preview().srcdoc).toContain('当前 A'));
    await act(async () => { pending[0](json(slice('过期 A'))); pending[1](json(slice('过期 B'))); });
    expect(preview().srcdoc).not.toContain('过期');
    rerender(<ArtifactPanel artifact={other} client={client} />);
    await waitFor(() => expect(pending).toHaveLength(4));
    rerender(<ArtifactPanel artifact={null} client={client} />);
    await act(async () => { pending[3](json(slice('已删除正文'))); });
    expect(screen.queryByTitle('产物预览')).toBeNull();
    expect(screen.getByText('选择产物以预览')).toBeTruthy();
  });

  it('导出等待受控回调完成，忙碌时不重复提交，错误安全可见', async () => {
    vi.stubGlobal('fetch', async () => json(slice('正文')));
    let reject!: (reason: unknown) => void;
    const exportArtifact = vi.fn(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const user = userEvent.setup();
    render(<ArtifactPanel artifact={artifact} client={client} onExport={exportArtifact} />);
    await waitFor(() => expect(preview().srcdoc).toContain('正文'));
    await user.dblClick(screen.getByRole('button', { name: '导出产物' }));
    expect(exportArtifact).toHaveBeenCalledExactlyOnceWith(artifact);
    expect((screen.getByRole('button', { name: '正在导出…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { reject(new Error('private export path')); });
    expect(screen.getByRole('alert').textContent).toContain('产物导出失败');
    expect(screen.queryByText(/private export path/)).toBeNull();
  });

  it('撤权读取错误与外链失败可见，不显示旧正文或原生诊断', async () => {
    vi.stubGlobal('fetch', async () => json({ error: { code: 'scope_revoked', safe_message: '资料范围已撤销', retryable: false, related_ids: [id] } }, 403));
    const { rerender } = render(<ArtifactPanel artifact={artifact} client={client} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('产物内容加载失败'));
    expect(screen.queryByTitle('产物预览')).toBeNull();
    vi.stubGlobal('fetch', async () => json(slice('[资料](https://example.invalid/doc)')));
    vi.mocked(invoke).mockRejectedValue('private native error');
    rerender(<ArtifactPanel artifact={{ ...artifact, id: secondId }} client={client} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '打开外部链接：资料' }));
    expect(screen.getByRole('alert').textContent).toContain('无法打开外部链接');
    expect(screen.queryByText(/private native error/)).toBeNull();
  });
});
