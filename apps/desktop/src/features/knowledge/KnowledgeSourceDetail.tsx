import type { KnowledgeJob, KnowledgeSource, KnowledgeSourceView, TaskHandle } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import IconButton from '../../components/IconButton';
import type { RuntimeClient } from '../../api/client';
import KnowledgeSourceActions from './KnowledgeSourceActions';

export const sourceStates: Record<KnowledgeSource['status'], string> = {
  pending: '等待处理', active: '可用', failed: '处理失败', removed: '已移出', revoked: '已撤权', deleted: '已删除',
};
export const jobStates: Record<KnowledgeJob['status'], string> = {
  queued: '排队中', running: '处理中', completed: '处理完成', failed: '处理失败', cancelled: '已取消',
};

export function sourceState(source: KnowledgeSourceView) {
  if (['removed', 'revoked', 'deleted'].includes(source.status)) return sourceStates[source.status];
  if (source.latest_job?.status === 'failed') return source.active_version !== null ? '更新失败' : '处理失败';
  if (source.latest_job?.status === 'queued' || source.latest_job?.status === 'running') {
    return source.active_version !== null ? '更新中' : '处理中';
  }
  return sourceStates[source.status];
}

function failureGuidance(reason: string | null) {
  switch (reason) {
    case 'knowledge_encoding_unsupported': return '请将文件转为 UTF-8 编码后更新。';
    case 'grant_required': case 'scope_revoked': return '资料许可不足，请在检索与发送设置中核对许可后更新。';
    case 'knowledge_document_unknown': return '检索服务未确认处理结果，请先查看处理任务，再决定是否更新。';
    case 'knowledge_embedding_unavailable': case 'knowledge_embedding_failed':
    case 'credential_missing': case 'model_authentication_failed': case 'invalid_response':
      return '请检查检索模型的配置与可用性后更新。';
    case 'model_timeout': case 'model_connection_failed': case 'model_provider_error': case 'model_rate_limited':
      return '检索服务暂不可用，请稍后更新。';
    case 'knowledge_index_write_failed': case 'knowledge_unavailable':
      return '索引未完成，请稍后重试更新。';
    default: return '请重试更新文件；仍未完成时可查看处理记录。';
  }
}

export default function KnowledgeSourceDetail({ client, source, jobs, busy, onCancel, onOpenTask, onBack, onChanged, onUpdate }: {
  client: RuntimeClient;
  source: KnowledgeSourceView; jobs: KnowledgeJob[]; busy: boolean;
  onCancel: (job: KnowledgeJob) => void; onOpenTask?: (task: TaskHandle) => void;
  onBack: () => void;
  onChanged: () => void; onUpdate: () => void;
}) {
  const latest = source.latest_job;
  const pending = latest?.status === 'queued' || latest?.status === 'running';
  const stopped = source.status === 'removed' || source.status === 'revoked' || source.status === 'deleted';
  const failed = latest?.status === 'failed' || source.status === 'failed';
  return <section className="flex min-w-0 flex-col gap-3 p-4" aria-label="资料详情">
    <IconButton icon="back" label="返回资料列表" className="self-start md:hidden" onClick={onBack} />
    <header className="flex flex-col gap-1">
      <h2 className="m-0 break-words text-lg font-semibold">{source.label}</h2>
      <p className="m-0 text-sm text-muted-foreground">{sourceState(source)}</p>
      {(source.origin_hint || source.added_at) && <p className="m-0 text-sm text-muted-foreground">
        {source.origin_hint}{source.origin_hint && source.added_at && ' · '}
        {source.added_at && <>加入于 <time dateTime={source.added_at}>{new Date(source.added_at).toLocaleString('zh-CN')}</time></>}
      </p>}
    </header>
    {pending && !stopped && source.active_version !== null && <p className="m-0 text-sm">新版处理中，完成前继续使用当前版本。</p>}
    {failed && !stopped && <div className="grid gap-1 text-sm" role="status">
      <p className="m-0">{source.active_version !== null ? '更新未完成，当前资料仍可用。' : '处理未完成，此文件尚不可用。'}</p>
      <p className="m-0">{failureGuidance(latest?.reason ?? null)}</p>
    </div>}
    {!stopped && (pending || failed) && <div role="group" aria-label="当前处理任务" className="flex flex-wrap gap-2">
      {latest?.task && onOpenTask && <Button size="sm" onClick={() => onOpenTask(latest.task!)}>查看处理任务</Button>}
      {pending && <Button size="sm" disabled={busy} onClick={() => onCancel(latest!)}>取消处理</Button>}
    </div>}
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm">操作与处理记录</summary>
      <div className="mt-3 flex flex-col gap-3">
        <KnowledgeSourceActions client={client} source={source} originHint={source.origin_hint} addedAt={source.added_at}
          onChanged={onChanged} onUpdate={onUpdate} />
        {!jobs.length && <p className="m-0 text-sm text-muted-foreground">{latest ? '当前页没有此资料的历史记录。' : '暂无处理记录。'}</p>}
        {jobs.map(job => <article key={job.id} className="flex flex-col gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0">
          <p className="m-0 text-sm">{job.kind === 'rebuild' ? '重新整理资料' : '加入资料'}
            {job.source_version !== null && ` v${job.source_version}`} · {jobStates[job.status]}</p>
          {job.status === 'failed' && <p className="m-0 text-sm">{failureGuidance(job.reason)}</p>}
          <div className="flex flex-wrap gap-2">
            {job.task && onOpenTask && (job.id !== latest?.id || !pending && !failed || stopped)
              && <Button size="sm" onClick={() => onOpenTask(job.task!)}>查看处理任务</Button>}
          </div>
        </article>)}
      </div>
    </details>
  </section>;
}
