import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, expect, it, vi } from 'vitest';
import { mcpConfig } from '../../test/mcp-fixtures';
import McpCredentials from './McpCredentials';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it.each([false, true])('只按保存的 MCP 修订补存凭据，秘密 finally 清空（失败=%s）', async failed => {
  const config = { ...mcpConfig, env_refs: { SYNTHETIC_TOKEN: crypto.randomUUID() } };
  vi.mocked(invoke).mockImplementation(async (method) => {
    if (method === 'save_credential' && failed) throw new Error('synthetic-private-marker');
    return { configured: method === 'save_credential' };
  });
  render(<McpCredentials config={config} />);
  await screen.findByText('待填写');
  const field = screen.getByLabelText('环境变量 SYNTHETIC_TOKEN');
  fireEvent.change(field, { target: { value: 'synthetic-private-marker' } });
  fireEvent.click(screen.getByRole('button', { name: '保存此修订的凭据' }));
  await waitFor(() => expect(field).toHaveProperty('value', ''));
  expect(invoke).toHaveBeenCalledWith('save_credential', expect.objectContaining({
    binding: expect.objectContaining({ kind: 'mcp', config_revision: 1,
      env_name: 'SYNTHETIC_TOKEN', secret_ref: config.env_refs.SYNTHETIC_TOKEN }),
    value: 'synthetic-private-marker',
  }));
  expect(document.body.textContent).not.toContain('synthetic-private-marker');
  if (!failed) {
    fireEvent.click(screen.getByRole('button', { name: '清除 SYNTHETIC_TOKEN' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('clear_credential', {
      secret_ref: config.env_refs.SYNTHETIC_TOKEN,
    }));
  }
});
