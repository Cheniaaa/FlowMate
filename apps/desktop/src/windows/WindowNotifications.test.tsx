import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import type { PendingCounts } from '../api/windows';
import WindowNotifications from './WindowNotifications';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it.each(['main', 'quick'] as const)('%s重开后展示持久未读数，迟到初次查询不覆盖更新通知', async label => {
  let receive!: EventCallback<PendingCounts>, resolve!: (counts: PendingCounts) => void;
  vi.mocked(listen).mockImplementation(async (_name, callback) => { receive = callback; return () => {}; });
  vi.mocked(invoke).mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<WindowNotifications label={label} />);
  await act(async () => {});
  await act(async () => { receive({ event: 'pending-counts', id: 1, payload: { pending_actions: 2, pending_questions: 1, pending_approvals: 1, unviewed_results: 3 } }); });
  expect(screen.getByRole('status').textContent).toBe('待办 2 · 未查看结果 3');
  await act(async () => { resolve({ pending_actions: 0, pending_questions: 0, pending_approvals: 0, unviewed_results: 0 }); });
  expect(screen.getByRole('status').textContent).toContain('未查看结果 3');
  expect(listen).toHaveBeenCalledWith('pending-counts', expect.any(Function), { target: label });
});
