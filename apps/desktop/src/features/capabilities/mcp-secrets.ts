import { invoke } from '@tauri-apps/api/core';
import type { McpConfiguredServer, McpImportPreview } from '../../generated/contracts';

type Slot = McpImportPreview['required_secret_slots'][number];
export async function saveMcpSecret(config: McpConfiguredServer, slot: Slot, value: string) {
  await invoke('save_credential', { binding: {
    kind: 'mcp', server_id: config.id, config_revision: config.revision, transport: config.transport,
    destination: { command: config.command, args: config.args, cwd: config.cwd, url: config.url },
    purpose: slot.purpose, env_name: slot.env_name,
    secret_ref: slot.purpose === 'env' ? config.env_refs[slot.env_name!] : config.credential_ref,
  }, value });
}
