import html from '../index.html?raw';
import { createElement } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
});
afterEach(() => { vi.doUnmock('./App'); document.body.innerHTML = ''; });

it('应用依赖未就绪时已有首屏状态，依赖加载完成后才挂载应用', async () => {
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  vi.doMock('./App', async () => {
    await loading;
    return { default: () => createElement('main', null, '已加载的应用内容') };
  });
  const startup = import('./main');
  try {
    expect(screen.getByRole('status').textContent).toMatch(/加载/);
    expect(screen.queryByText('已加载的应用内容')).toBeNull();
  } finally {
    release();
    await act(async () => { await startup; await vi.dynamicImportSettled(); });
  }
  await waitFor(() => expect(screen.getByText('已加载的应用内容')).toBeTruthy());
  expect(screen.queryByRole('status')).toBeNull();
});

it('应用模块加载失败呈现明确错误，不泄露原始错误或一直显示加载', async () => {
  vi.doMock('./App', async () => { throw new Error('synthetic-private-loader-detail'); });
  // 旧静态入口会拒绝整个import；捕获仅用于断言用户是否得到页面错误反馈。
  await act(async () => { await import('./main').catch(() => undefined); await vi.dynamicImportSettled(); });
  expect(screen.getByRole('alert').textContent).toMatch(/加载失败/);
  expect(screen.queryByRole('status')).toBeNull();
  expect(document.body.textContent).not.toContain('synthetic-private-loader-detail');
});
