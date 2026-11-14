import { render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); window.history.replaceState(null, '', '/'); });
it.each(['settings', 'preview'])('移除的/未知窗口 %s 不渲染设置，也不领取 Runtime 凭据', label => {
  window.history.replaceState(null, '', `/?window=${label}`); render(<App />);
  expect(screen.getByRole('alert').textContent).toContain('已移除'); expect(invoke).not.toHaveBeenCalled();
});
