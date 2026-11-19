import type { Approval } from '../../generated/contracts';

export type McpIdentitySnapshot = NonNullable<Approval['mcp']>;

export default function McpIdentity({ value }: { value: McpIdentitySnapshot }) {
  return <dl aria-label="固定 MCP 身份">
    <dt>工具原名</dt><dd>{value.original_name}</dd>
    <dt>服务器</dt><dd>{value.server_id} · 配置修订 {value.config_revision}</dd>
    <dt>目的地</dt><dd>{value.destination}</dd>
    <dt>目录 hash</dt><dd><code>{value.catalog_hash}</code></dd>
  </dl>;
}
