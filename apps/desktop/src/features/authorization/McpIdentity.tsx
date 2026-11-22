import type { Approval } from '../../generated/contracts';
import { mcpDestinationLabel } from '../../api/mcp';

export type McpIdentitySnapshot = NonNullable<Approval['mcp']>;

export default function McpIdentity({ value }: { value: McpIdentitySnapshot }) {
  return <details className="wrap-anywhere"><summary className="cursor-pointer">MCP 调用详情</summary><dl>
    <dt>工具</dt><dd>{value.original_name}</dd>
    <dt>服务地址</dt><dd>{mcpDestinationLabel(value.destination)}</dd>
  </dl></details>;
}
