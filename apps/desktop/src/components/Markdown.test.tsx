import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import Markdown, { artifactDocument } from './Markdown';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); });

describe('受控 Markdown', () => {
  it('从所选代码块复制原行和缩进，多个代码块各自对应自己的内容', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      render(<Markdown>{'```toml\nfirst = true\n```\n\n```py\nif ok:\n    save()\n```'}</Markdown>);
      fireEvent.click(screen.getByRole('button', { name: '复制 py 代码' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith('if ok:\n    save()\n'));
      expect(screen.getByRole('button', { name: '复制 toml 代码' })).toBeTruthy();
      render(<Markdown>{'```js\n```'}</Markdown>);
      fireEvent.click(screen.getByRole('button', { name: '复制 js 代码' }));
      expect(writeText).toHaveBeenLastCalledWith('');
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
  it('呈现中文、代码和 GFM 表格，但不生成原始 HTML、脚本或图片请求节点', () => {
    const { container } = render(<Markdown>{'# 中文说明\n\n```js\nconst value = "中文";\n```\n\n| 项目 | 结果 |\n| --- | --- |\n| 检查 | 完成 |\n\n<script>alert(1)</script>\n\n<iframe src="https://evil.invalid"></iframe>\n\n<img src="https://evil.invalid/raw.png" onerror="alert(1)">\n\n![图片说明](https://evil.invalid/image.png)'}</Markdown>);
    expect(screen.getByRole('heading', { name: '中文说明' })).toBeTruthy();
    expect(screen.getByRole('table').textContent).toContain('检查');
    expect(container.querySelector('pre code')?.textContent).toContain('const value');
    expect(screen.getByText('图片说明')).toBeTruthy();
    expect(container.querySelector('.markdown-body')).not.toBeNull();
    expect(container.querySelector('script,iframe,img,[onerror]')).toBeNull();
  });

  it('只保留有主机名的绝对 http(s)，拒绝相对、协议相对及可执行 URL', () => {
    const blocked = ['//evil.invalid/a', '/relative', 'relative', '#section', 'javascript:alert%281%29', 'file:///C:/secret', 'data:text/html,evil', 'mailto:test@example.invalid', 'https:example.invalid', 'https://'];
    const source = ['[安全](https://example.invalid/path?q=1)', '[HTTP](http://example.invalid/)', ...blocked.map((url, index) => `[拒绝${index}](${url})`)].join('\n\n');
    const { container } = render(<Markdown>{source}</Markdown>);
    expect([...container.querySelectorAll('a[href]')].map(link => link.getAttribute('href'))).toEqual(['https://example.invalid/path?q=1', 'http://example.invalid/']);
    expect(container.querySelectorAll('a')).toHaveLength(2);
  });

  it('阻止默认导航，只把受控地址交给原生命令；失败不反射原生错误', async () => {
    vi.mocked(invoke).mockRejectedValue('sensitive native diagnostic');
    render(<Markdown>{'[打开资料](https://example.invalid/doc)'}</Markdown>);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    fireEvent(screen.getByRole('link', { name: '打开资料' }), event);
    expect(event.defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_external', { url: 'https://example.invalid/doc' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法打开外部链接'));
    expect(screen.queryByText(/sensitive native/)).toBeNull();
  });
});

describe('静态产物文档', () => {
  it('为隔离的 JSON 阅读页保留主题变量与原文，长行使用阅读排版', () => {
    const root = document.documentElement;
    root.style.setProperty('--color-background', '#181819');
    root.style.setProperty('--color-foreground', '#f2f2f0');
    const text = `{"detail":"${'长行'.repeat(120)}"}`;
    try {
      const output = artifactDocument(text, 'application/json', 'dark');
      const page = new DOMParser().parseFromString(output.srcDoc, 'text/html');
      expect(page.documentElement.dataset.theme).toBe('dark');
      expect(page.documentElement.style.getPropertyValue('--color-background')).toBe('#181819');
      expect(page.documentElement.style.getPropertyValue('--color-foreground')).toBe('#f2f2f0');
      expect(page.body.classList.contains('markdown-body')).toBe(true);
      expect(page.querySelector('pre')?.textContent).toBe(text);
      expect(page.querySelector('style')?.textContent).toMatch(/overflow-wrap:\s*anywhere/);
      expect(page.querySelector('link,script')).toBeNull();
    } finally {
      root.style.removeProperty('--color-background');
      root.style.removeProperty('--color-foreground');
    }
  });

  it('复用 Markdown 策略，在生成时移除 href，记录合法链接并封闭网络及表单', () => {
    const output = artifactDocument('# 报告\n\n[**官方**资料](https://example.invalid/doc)\n\n[拒绝](javascript:alert%281%29)\n\n![图片说明](https://evil.invalid/image)\n\n<script>alert(1)</script>\n\n<form action="https://evil.invalid"><input></form>', 'text/markdown');
    const document = new DOMParser().parseFromString(output.srcDoc, 'text/html');
    expect(document.querySelector('h1')?.textContent).toBe('报告');
    expect(document.querySelector('a[href],script,img,iframe,form,input,base')).toBeNull();
    expect(document.body.textContent).toContain('图片说明');
    expect(output.links).toEqual([{ url: 'https://example.invalid/doc', label: '官方资料' }]);
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content');
    expect(policy).toBe("default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'");
    expect(document.querySelector('meta[charset]')).not.toBeNull();
  });

  it('纯文本保持字面内容，不把标签、Markdown 或 URL 变成节点/链接', () => {
    const text = '<script>alert(1)</script>\n# 纯文本\n[资料](https://example.invalid)';
    const output = artifactDocument(text, 'text/plain');
    const document = new DOMParser().parseFromString(output.srcDoc, 'text/html');
    expect(document.querySelector('pre')?.textContent).toBe(text);
    expect(document.querySelector('script,a,h1')).toBeNull();
    expect(output.links).toEqual([]);
  });

  it('图片链接保留可见 alt 作为宿主按钮标签，但不生成图片请求', () => {
    const output = artifactDocument('[![来源说明](https://evil.invalid/image)](https://example.invalid/source)', 'text/markdown');
    const document = new DOMParser().parseFromString(output.srcDoc, 'text/html');
    expect(document.body.textContent).toBe('来源说明');
    expect(document.querySelector('img,a[href],link')).toBeNull();
    expect(output.links).toEqual([{ url: 'https://example.invalid/source', label: '来源说明' }]);
  });
});
