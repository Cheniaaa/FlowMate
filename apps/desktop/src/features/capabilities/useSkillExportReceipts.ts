import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { ScopeRef, SkillExportReceipt } from '../../generated/contracts';
import { skillQuery } from './skill-query';

export function useSkillExportReceipts(client: RuntimeClient, scope: ScopeRef, refreshKey: number | string, skillId?: string, enabled = true) {
  const channel = useMemo(() => ({
    sequence: 0, updates: new Map<string, { sequence: number; receipt: SkillExportReceipt }>(),
  }), [client, scope.kind, scope.workspace_id, skillId]);
  const active = useRef<typeof channel | null>(null);
  const [result, setResult] = useState<{ channel: typeof channel; receipts?: SkillExportReceipt[]; error?: string }>();
  useLayoutEffect(() => {
    active.current = channel;
    return () => { active.current = null; };
  }, [channel]);

  useEffect(() => {
    if (!enabled) return;
    let ignore = false;
    const started = channel.sequence;
    client.skillExports({ ...skillQuery(scope), ...(skillId ? { skill_id: skillId } : {}) }).then(receipts => {
      if (ignore) return;
      const latest = new Map(receipts.map(receipt => [receipt.command_id, receipt]));
      // 列表发出后已确认的单笔结果优先，后续主动刷新仍可更新它们。
      for (const update of channel.updates.values()) {
        if (update.sequence > started) latest.set(update.receipt.command_id, update.receipt);
      }
      setResult({ channel, receipts: [...latest.values()] });
    }).catch(error => {
      if (!ignore) setResult(current => ({
        channel, receipts: current?.channel === channel ? current.receipts : undefined, error: windowError(error),
      }));
    });
    return () => { ignore = true; };
  }, [channel, refreshKey, enabled]);

  function install(receipt: SkillExportReceipt) {
    if (active.current !== channel) return;
    channel.updates.set(receipt.command_id, { sequence: ++channel.sequence, receipt });
    setResult(current => {
      const receipts = new Map((current?.channel === channel ? current.receipts ?? [] : [])
        .map(item => [item.command_id, item]));
      receipts.set(receipt.command_id, receipt);
      return { channel, receipts: [...receipts.values()] };
    });
  }

  return { receipts: result?.channel === channel ? result.receipts : undefined,
    error: result?.channel === channel ? result.error : undefined, install };
}
