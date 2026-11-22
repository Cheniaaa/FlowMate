import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { remoteSnapshot } from '../../test/mcp-tool-fixtures';
import McpIdentity from './McpIdentity';

it('调用详情显示工具原名和固定目的地，并隐藏配置内部标识', async () => {
  const { container } = render(<McpIdentity value={remoteSnapshot} />);
  await userEvent.click(screen.getByText('MCP 调用详情'));
  expect(screen.getByText(remoteSnapshot.original_name)).toBeTruthy();
  expect(screen.getByText('https://notes.example.invalid/mcp')).toBeTruthy();
  expect(container.textContent).not.toContain(remoteSnapshot.server_id);
  expect(container.textContent).not.toContain(remoteSnapshot.catalog_hash);
});
