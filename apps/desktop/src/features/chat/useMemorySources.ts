import { useEffect, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import { memoryQuery, memoryScopeLabel, type MemoryScope } from '../../api/memory';
import { windowError } from '../../api/windows';
import type { MemoryRecord } from '../../generated/contracts';

export function useMemorySources(client: RuntimeClient, selected: MemoryScope[], destination: string | undefined, revision: number) {
  const key = JSON.stringify([selected, destination, revision]);
  const [data, setData] = useState<{ key: string; items: { scope: MemoryScope; included: boolean; reason: string; records: Pick<MemoryRecord, 'id' | 'text'>[] }[]; error?: string }>();
  useEffect(() => {
    let ignore = false;
    async function read() {
      const items = await Promise.all(selected.map(async scope => {
        const policy = await client.memoryPolicy(memoryQuery(scope));
        let cursor: string | undefined, authorized = false;
        do {
          const page = await client.memoryGrants({ ...memoryQuery(scope), cursor });
          authorized ||= page.items.some(grant => grant.status === 'active' && grant.destination === destination
            && grant.purposes.includes('model_send')
            && grant.memory_scopes.some(allowed => allowed.kind === scope.kind && allowed.workspace_id === scope.workspace_id));
          cursor = page.next_cursor ?? undefined;
        } while (cursor);
        const included = policy.read_profile && authorized;
        const records: Pick<MemoryRecord, 'id' | 'text'>[] = [];
        if (included) {
          do {
            const page = await client.memoryRecords({ ...memoryQuery(scope), status: 'confirmed', cursor, limit: 50 });
            for (const record of page.items) {
              const evidence = await client.memoryEvidence(record.id);
              if (record.status === 'confirmed' && evidence.items.every(item => item.available)) records.push({ id: record.id, text: record.text });
            }
            cursor = page.next_cursor ?? undefined;
          } while (cursor);
        }
        return { scope, included, records, reason: !policy.read_profile ? '读取已关闭，本次排除'
          : authorized ? '已选择并授权' : '目标模型未授权，本次排除' };
      }));
      if (!ignore) setData({ key, items });
    }
    if (selected.length) void read().catch(error => { if (!ignore) setData({ key, items: [], error: windowError(error) }); });
    return () => { ignore = true; };
  }, [client, key]);
  const current = data?.key === key ? data : undefined;
  return {
    scopes: current?.items.filter(item => item.included).map(item => item.scope) ?? [],
    records: current?.items.flatMap(item => item.records) ?? [],
    loading: selected.length > 0 && !current,
    error: selected.length ? current?.error : undefined,
    descriptions: selected.map(scope => `${memoryScopeLabel(scope)}：${current?.items.find(item => item.scope.kind === scope.kind)?.reason
      ?? (current?.error ? '状态未同步，本次排除' : '正在核对读取策略与目标授权')}`),
  };
}
