import { useEffect, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { ArtifactRef } from '../../generated/contracts';
import McpIdentity, { type McpIdentitySnapshot } from '../authorization/McpIdentity';

export default function McpArtifactSource({ artifact, client }: { artifact: ArtifactRef; client: RuntimeClient }) {
  const [source, setSource] = useState<{ entries: { serverId: string; revision: number }[]; call?: McpIdentitySnapshot }>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!artifact.dependencies.length) return;
    let ignore = false; setSource(undefined); setError('');
    async function read() {
      const task = await client.task(artifact.task_id);
      const fixed = Object.values(task.binding.config.catalog.mcp_tools);
      const entries = artifact.dependencies.filter(dependency => fixed.some(binding =>
        binding.server_id === dependency.scope_id && binding.config_revision === dependency.epoch))
        .map(dependency => ({ serverId: dependency.scope_id, revision: dependency.epoch }));
      if (!entries.length) return;
      let cursor: string | undefined, call: McpIdentitySnapshot | undefined;
      do {
        const page = await client.trace(task.run_id, { cursor });
        const activity = page.items.flatMap(item => item.activities).find(item => item.id === artifact.activity_id);
        if (activity) {
          const fixedCall = task.binding.config.catalog.mcp_tools[activity.operation];
          if (fixedCall && entries.some(entry => entry.serverId === fixedCall.server_id && entry.revision === fixedCall.config_revision)) call = fixedCall;
          break;
        }
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      if (!ignore) setSource({ entries, call });
    }
    void read().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [artifact, client]);
  if (error) return <p role="alert">产物的固定来源尚未核对：{error}</p>;
  if (!source) return null;
  return <section aria-label="MCP 产物来源">
    <h3>MCP 返回资料</h3>
    {source.entries.map(entry => <p key={entry.serverId}>服务器 {entry.serverId} · 返回资料修订 {entry.revision}</p>)}
    {source.call && <McpIdentity value={source.call} />}
    <p>向模型继续发送仍需独立授权；产物 hash 固定本次内容，来源调用见 Activity。</p>
  </section>;
}
