import type { CommandMeta, McpImportRequest, McpSaveCommand, McpSelectToolsCommand } from '../generated/contracts';
import { RuntimeClient, type PageQuery } from './client';

export interface McpQuery extends PageQuery {
  scope_kind: 'user_global' | 'workspace';
  workspace_id?: string;
  query?: string;
}

export function mcpDestinationLabel(destination: string) {
  const target = destination.replace(/^mcp:[^:]+:\d+:/, '');
  return target === 'stdio' ? '本机 MCP 服务' : target;
}

export class McpClient extends RuntimeClient {
  mcpServers(parameters: McpQuery) { return this.page('/capabilities/mcp', 'McpServerPage', parameters); }
  mcpServer(id: string) { return this.request(`/capabilities/mcp/${encodeURIComponent(id)}`, 'McpServerView'); }
  previewMcp(request: McpImportRequest) {
    return this.command('/capabilities/mcp/preview', 'McpImportRequest', 'McpImportPreview', request);
  }
  saveMcp(command: McpSaveCommand) {
    return this.command('/capabilities/mcp', 'McpSaveCommand', 'McpConfiguredServer', command);
  }
  discoverMcp(id: string, meta: CommandMeta) {
    return this.command(`/capabilities/mcp/${encodeURIComponent(id)}/discover`, 'CommandMeta', 'McpServerView', meta);
  }
  prepareMcp(id: string, sessionId: string, meta: CommandMeta, signal: AbortSignal) {
    return this.request(`/capabilities/mcp/${encodeURIComponent(id)}/discover?session_id=${encodeURIComponent(sessionId)}`,
      'McpServerView', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta), signal });
  }
  selectMcpTools(id: string, command: McpSelectToolsCommand) {
    return this.command(`/capabilities/mcp/${encodeURIComponent(id)}/tools`,
      'McpSelectToolsCommand', 'McpToolSelection', command, 'PUT');
  }
}
