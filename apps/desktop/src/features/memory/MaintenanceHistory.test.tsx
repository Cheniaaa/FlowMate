import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeClient } from '../../api/client';
import { page } from '../../test/fixtures';
import { memory } from '../../test/memory-fixtures';
import { maintenanceNotice, maintenanceTask } from '../../test/maintenance-fixtures';
import MaintenanceHistory from './MaintenanceHistory';
afterEach(() => vi.unstubAllGlobals());

it('候选关联仅取records/{id}/maintenance，分页后用真实TaskHandle打开；失效代次隐藏旧关联', async () => {
  const queries: URL[] = [], open = vi.fn();
  let available = true;
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url); queries.push(parsed);
    if (!available) return Response.json(page([]));
    return Response.json(parsed.searchParams.has('cursor') ? page([maintenanceNotice]) : { ...page([]), next_cursor: 'record-tail' });
  });
  const client = new RuntimeClient({ base_url: 'http://127.0.0.1:54321', token: 'test', protocol_version: 3 }), user = userEvent.setup();
  const view = render(<MaintenanceHistory client={client} scope={memory.scope} recordId={memory.id} revision="0" onOpenTask={open} />);
  await user.click(await screen.findByRole('button', { name: '更多整理记录' }));
  await user.click(await screen.findByRole('button', { name: '查看此候选的维护任务' }));
  expect(open).toHaveBeenCalledWith(maintenanceTask);
  expect(queries.every(query => query.pathname === `/v3/memory/records/${memory.id}/maintenance`)).toBe(true);
  expect(queries[1].searchParams.get('cursor')).toBe('record-tail');
  available = false;
  view.rerender(<MaintenanceHistory client={client} scope={memory.scope} recordId={memory.id} revision="1" onOpenTask={open} />);
  expect(screen.queryByRole('button', { name: '查看此候选的维护任务' })).toBeNull();
  await screen.findByText('此记忆暂无整理任务关联。');
});
