import { useEffect, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import { memoryQuery, type MemoryScope } from '../../api/memory';
import { windowError } from '../../api/windows';
import type { MemoryMaintenancePage, TaskHandle } from '../../generated/contracts';
import Status from '../../components/Status';

const reasons: Record<string, string> = {
  allocation_exceeded: '原因果组没有剩余整理额度', deadline_exceeded: '原授权组期限已过',
  maintenance_no_sources: '所选边界没有可用来源', maintenance_source_limit: '来源超过单批边界',
  maintenance_source_invalid: '来源边界不可用于整理', maintenance_model_missing: '整理模型未就绪',
  grant_required: '整理模型目的地尚未获得有效授权', scope_deleted: '来源范围已删除', source_version_conflict: '来源版本已改变',
};
export default function MaintenanceHistory({ client, scope, recordId, revision, onOpenTask }: {
  client: RuntimeClient; scope: MemoryScope; recordId?: string; revision: string; onOpenTask: (task: TaskHandle) => void;
}) {
  const [data, setData] = useState<{ key: string; page: MemoryMaintenancePage }>(), [error, setError] = useState('');
  const key = `${scope.kind}:${scope.workspace_id}:${recordId}:${revision}`;
  const read = (cursor?: string) => recordId ? client.recordMaintenance(recordId, { limit: 50, cursor })
    : client.memoryMaintenance({ ...memoryQuery(scope), limit: 50, cursor });
  useEffect(() => { let ignore = false; setError('');
    read().then(page => { if (!ignore) setData({ key, page }); }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, key]);
  const current = data?.key === key ? data.page : undefined;
  return <section aria-label={recordId ? '关联维护任务' : '记忆整理记录'}>
    <h3>{recordId ? '关联维护任务' : '记忆整理记录'}</h3>
    {error && <p role="alert">{error}</p>}
    {!current && !error && <p>正在读取整理记录…</p>}
    {current?.items.length === 0 && <p>{recordId ? '此记忆暂无整理任务关联。' : '此范围暂无整理记录。'}</p>}
    {current?.items.map(notice => <article key={notice.id}>
      <p>来源运行 <code>{notice.source_boundary.run_id}</code> · 已提交边界 {notice.source_boundary.event_id} · 策略版本 {notice.policy_version}</p>
      {notice.task ? <><p>提交时状态：<Status state={notice.task.submitted_state} /></p>
        <button onClick={() => onOpenTask(notice.task!)}>{recordId ? '查看此候选的维护任务' : '查看维护任务'}</button></>
        : <p>未提交维护任务：{notice.reason && reasons[notice.reason]}（{notice.reason}）</p>}
    </article>)}
    {current?.next_cursor && <button onClick={() => {
      void read(current.next_cursor!).then(page => setData(previous => previous?.key === key ? { key, page: { ...page,
        items: [...new Map([...previous.page.items, ...page.items].map(item => [item.id, item])).values()] } } : previous))
        .catch(error => setError(windowError(error)));
    }}>更多整理记录</button>}
  </section>;
}
