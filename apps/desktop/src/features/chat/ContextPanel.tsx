import { useEffect, useState, type CSSProperties } from 'react';
import { FileText } from 'lucide-react';
import { ApiError, type RuntimeClient } from '../../api/client';
import { formatUsd } from '../../api/pricing';
import type { SessionContext, SessionContextSchema, SessionContextUsage } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import Status from '../../components/Status';
import ContextNotice from './ContextNotice';
import './context-panel.css';

const count = (value: number) => value.toLocaleString('zh-CN');
const tokens = (value: number | null | undefined) => value == null ? '未报告' : `${count(value)} tokens`;
const percent = (value: number, limit: number) => `${(value / limit * 100).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;

function FileList({ files }: { files: SessionContextSchema.ContextFile[] }) {
  return <ul className="context-files">{files.map((file, position) => <li key={position}>
    <FileText size={14} aria-hidden="true" />
    <div><span>{file.name}</span>
      {file.origin && <small>{file.origin === 'attached' ? '本轮附件' : '继承自本会话'}</small>}
      {file.changed && <small>来源版本已变化</small>}
      {file.size_bytes != null && <small>{count(file.size_bytes)} 字节 · {count(file.line_count!)} 行</small>}
      {file.start != null && <small>已读 {count(file.end! - file.start)} 字符 · 区间 [{count(file.start)}, {count(file.end!)}) / {count(file.total_chars!)}</small>}
    </div>
  </li>)}</ul>;
}

function RequestDetails({ item, scale }: { item: SessionContextSchema.ContextActivity; scale?: string }) {
  const { input_limit: limit, input_tokens: input, cached_input_tokens: cache } = item;
  return <>
    {item.model && <p className="context-muted">{item.model}</p>}
    {limit != null && input != null ? <div className="context-capacity">
      <div className="context-line"><span>输入容量</span>
        <strong><meter className="sr-only" min={0} max={limit} value={Math.min(input, limit)}
          aria-label="输入容量占比" aria-valuetext={percent(input, limit)} />
          <span className="context-capacity-ring" aria-hidden="true"
          style={{ '--context-fill': `${Math.min(input / limit * 100, 100)}%` } as CSSProperties} />
          {percent(input, limit)}</strong>
      </div>
      <small>{count(input)} / {count(limit)} tokens</small>
    </div> : <p className="context-muted">{limit == null ? '输入容量未确认'
      : item.cost_pending ? '输入容量等待用量回执' : '输入用量未报告'}</p>}
    <dl className="context-facts">
      <dt>输入</dt><dd>{tokens(input)}</dd>
      <dt>输出</dt><dd>{tokens(item.output_tokens)}</dd>
      <dt>输入缓存</dt><dd>{cache == null ? '无缓存读数' : cache === 0 ? '未命中 · 0 tokens' : `命中 · ${tokens(cache)}`}</dd>
      {cache != null && input != null && input > 0 && <><dt>缓存命中率</dt><dd>{percent(cache, input)}</dd></>}
      {scale && <><dt>费用</dt><dd>{item.calculated_units == null ? item.cost_pending ? '等待回执' : '未确认' : formatUsd(item.calculated_units, scale)}</dd></>}
    </dl>
  </>;
}

function ModelRequest({ item, index, scale }: { item: SessionContextSchema.ContextActivity; index: number; scale: string }) {
  return <li className="context-entry">
    <div className="context-line"><strong>第 {index} 次请求{item.compaction && ' · 压缩'}</strong><Status state={item.state} /></div>
    <RequestDetails item={item} scale={scale} />
  </li>;
}

function Usage({ usage }: { usage: SessionContextUsage }) {
  const { requests, input_reported_requests: inputs, output_reported_requests: outputs, cache_reported_requests: cached,
    cache_reported_input_tokens: cacheInput, pending_cost_requests: pending, unknown_cost_requests: unknown } = usage;
  function coverage(reported: number) {
    return reported < requests ? ` · ${reported}/${requests} 次已报告` : '';
  }
  return <div className="context-entry">
    <dl className="context-facts">
      <dt>模型请求</dt><dd>{count(requests)} 次</dd>
      <dt>已知输入</dt><dd>{tokens(inputs > 0 ? usage.input_tokens : null)}{coverage(inputs)}</dd>
      <dt>已知输出</dt><dd>{tokens(outputs > 0 ? usage.output_tokens : null)}{coverage(outputs)}</dd>
      <dt>缓存命中</dt><dd>{cached > 0 ? tokens(usage.cached_input_tokens) + coverage(cached) : '无缓存读数'}</dd>
      {cacheInput > 0 && <><dt>缓存率</dt><dd>{percent(usage.cached_tokens_with_reported_input, cacheInput)}</dd></>}
      <dt>已计算总费用</dt><dd>{requests + usage.embedding_requests > pending + unknown
        + usage.embedding_pending_cost_requests + usage.embedding_unknown_cost_requests
        ? formatUsd(usage.calculated_units, usage.units_per_currency) : '未确认'}</dd>
    </dl>
    {cacheInput > 0 && <p className="context-muted">缓存率仅计入同时报告输入和缓存的请求。</p>}
    {(pending > 0 || unknown > 0) && <p className="context-muted">{pending > 0 && `${pending} 次等待费用回执`}{pending > 0 && unknown > 0 && ' · '}{unknown > 0 && `${unknown} 次费用未确认`}</p>}
    {usage.embedding_requests > 0 && <section aria-label="会话向量用量">
      <h4>向量用量</h4><dl className="context-facts">
        <dt>向量操作</dt><dd>{count(usage.embedding_requests)} 次</dd>
        <dt>已知输入</dt><dd>{tokens(usage.embedding_input_reported_requests > 0 ? usage.embedding_input_tokens : null)}
          {usage.embedding_input_reported_requests < usage.embedding_requests
            && ` · ${usage.embedding_input_reported_requests}/${usage.embedding_requests} 次已报告`}</dd>
        <dt>向量已计算费用</dt><dd>{usage.embedding_requests > usage.embedding_unknown_cost_requests + usage.embedding_pending_cost_requests
          ? formatUsd(usage.embedding_calculated_units, usage.units_per_currency) : '未确认'}</dd>
      </dl>
      {usage.embedding_unknown_cost_requests > 0 && <p>{usage.embedding_unknown_cost_requests} 次向量费用未知</p>}
      {usage.embedding_pending_cost_requests > 0 && <p>{usage.embedding_pending_cost_requests} 次向量等待费用回执</p>}
    </section>}
    <p className="context-muted"><span>截至最近一次查询。</span><span>费用按记录用量和固定价格估算。</span></p>
  </div>;
}

function SessionUsage({ client, sessionId, accountingRevision }: { client: RuntimeClient; sessionId: string; accountingRevision: string }) {
  const [result, setResult] = useState<{ usage?: SessionContextUsage; error?: string }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let ignore = false;
    client.sessionContextUsage(sessionId).then(usage => {
      if (!ignore) setResult({ usage });
    }, error => {
      if (!ignore) setResult({ error: error instanceof Error ? error.message : String(error) });
    });
    return () => { ignore = true; };
  }, [client, sessionId, retry, accountingRevision]);
  if (result?.usage) return <Usage usage={result.usage} />;
  if (result?.error) return <div role="alert" className="context-entry">
    <p>{result.error}</p><Button size="sm" variant="outline" onClick={() => { setResult(undefined); setRetry(value => value + 1); }}>重试</Button>
  </div>;
  return <p role="status" className="context-muted">正在加载会话用量…</p>;
}

export default function ContextPanel({ client, sessionId, revision, accountingRevision, authorization, onInspect, onResources,
  onUseFileVersion, fileSelectionDisabled, onOpenEvidence }: {
  client: RuntimeClient; sessionId: string; revision: string; authorization: string;
  accountingRevision: string;
  onInspect: (id: string) => void; onResources: () => void;
  onUseFileVersion: (trigger: HTMLButtonElement, runId: string, resourceIds: readonly string[]) => void;
  fileSelectionDisabled: boolean;
  onOpenEvidence?: (id: string) => void;
}) {
  const [pagination, setPagination] = useState<{ runId: string; depth: number }>();
  const [usageOpen, setUsageOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<{ authorization: string; revision: string; data: SessionContext }>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(undefined);
    async function load() {
      const data = await client.sessionContext(sessionId);
      const items = [...data.activities.items];
      let cursor = data.activities.next_cursor;
      const depth = pagination && pagination.runId === data.round?.run_id ? pagination.depth : 1;
      try {
        for (let index = 1; !ignore && cursor && index < depth; index++) {
          const next = await client.sessionContext(sessionId, cursor);
          if (next.round?.run_id !== data.round?.run_id || next.activities.watermark !== data.activities.watermark) {
            if (!ignore) {
              setSnapshot(undefined);
              setPagination(undefined);
            }
            return;
          }
          items.push(...next.activities.items);
          cursor = next.activities.next_cursor;
        }
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'invalid_cursor') throw error;
        if (!ignore) {
          setSnapshot(undefined);
          setPagination(undefined);
        }
        return;
      }
      if (!ignore) setSnapshot({ authorization, revision,
        data: { ...data, activities: { ...data.activities, items, next_cursor: cursor } } });
    }
    void load().catch(error => {
      if (!ignore) setError(error instanceof Error ? error : new Error(String(error)));
    }).finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [authorization, client, pagination, revision, sessionId, retry]);
  const data = snapshot?.authorization === authorization && snapshot.revision === revision ? snapshot.data : undefined;
  const round = data?.round;
  const requests = data?.activities.items.filter(item => item.kind === 'model') ?? [];
  const fileOperations = data?.activities.items.filter(item => item.kind === 'read' || item.kind === 'inspect') ?? [];
  const embeddings = data?.activities.items.filter(item => item.kind === 'embedding') ?? [];
  const changed = round?.file_changed || fileOperations.some(item => item.file_changed);
  return <section className="context-panel" aria-label="上下文详情">
    {error && <div role="alert" className="context-entry"><p>{error.message}</p><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>重试</Button></div>}
    {!data && !error && <p role="status" className="context-muted">正在加载上下文…</p>}
    {data && !round && <p className="context-muted">本会话尚无对话轮次。</p>}
    {data && round && <>
      <section className="context-group" aria-label="本轮来源">
        <h3>本轮来源</h3>
        {(data.knowledge.length > 0 || data.hidden_knowledge_count > 0) && <section aria-label="已用于模型的项目资料" className="flex flex-col gap-2">
          <h4>已用于模型的项目资料</h4>
          {data.knowledge.length > 0 && <ul className="flex flex-col gap-3">{data.knowledge.map(item => <li key={item.evidence_id}
            className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1"><span className="wrap-anywhere">{item.name}</span>
              <small className="text-muted-foreground">{item.start_line === item.end_line
                ? `${item.start_line} 行` : `${item.start_line}–${item.end_line} 行`}</small>
              {item.historical && <small className="text-muted-foreground">历史原文</small>}
            </div>
            {onOpenEvidence && <Button size="sm" variant="ghost" aria-label={`打开 ${item.name}`}
              onClick={() => onOpenEvidence(item.evidence_id)}>打开</Button>}
          </li>)}</ul>}
          {data.hidden_knowledge_count > 0 && <p className="context-muted">{data.hidden_knowledge_count} 项资料已不可用。</p>}
        </section>}
        {data.files.length > 0 && <><p className="context-muted">本轮固定文件</p><FileList files={data.files} /></>}
        {data.hidden_file_count > 0 && <p className="context-muted">{data.hidden_file_count} 个文件的历史来源不可见。</p>}
        {fileOperations.length > 0 && <ol className="context-entries">{fileOperations.map(item => <li className="context-entry" key={item.id}>
          <div className="context-line"><strong>{item.kind === 'read' ? '读取文本' : '检查文件'}</strong><Status state={item.state} /></div>
          {!!item.files?.length && <FileList files={item.files} />}
          {!!item.hidden_file_count && <p className="context-muted">{item.hidden_file_count} 个文件的历史来源不可见。</p>}
          {item.file_changed && <p className="context-muted">来源已变化，操作未采用原文件版本。</p>}
        </li>)}</ol>}
        {data.knowledge.length === 0 && data.hidden_knowledge_count === 0 && data.files.length === 0
          && data.hidden_file_count === 0 && fileOperations.length === 0 && <p className="context-muted">本轮尚无已使用的资料。</p>}
        {changed && <>
          <p className="context-muted">来源版本已变化。重新选择文件可使用新版。</p>
          <Button size="sm" variant="outline" disabled={fileSelectionDisabled}
            onClick={event => onUseFileVersion(event.currentTarget, round.run_id, round.replacement_file_ids ?? [])}>重新选择以使用新版</Button>
        </>}
        {(round.source_attention || fileOperations.some(item => item.file_changed || item.hidden_file_count > 0)) &&
          <Button size="sm" variant="outline" onClick={onResources}>查看当前授权</Button>}
        <ContextNotice usage={data.history} disclosureName={`context-history-${sessionId}`} onInspectRun={() => onInspect(round.run_id)} />
      </section>
      {embeddings.length > 0 && <section className="context-group" aria-label="本轮向量用量">
        <h3>向量用量</h3><ol className="context-entries">{embeddings.map(item => <li key={item.id} className="context-entry">
          <div className="context-line"><strong>{item.embedding_kind === 'query' ? '资料检索向量' : '资料处理向量'}</strong><Status state={item.state} /></div>
          <p className="context-muted">{item.model}</p><dl className="context-facts">
            <dt>输入</dt><dd>{tokens(item.input_tokens)}</dd>
            <dt>费用</dt><dd>{item.calculated_units != null ? formatUsd(item.calculated_units, data.units_per_currency)
              : item.cost_pending ? '等待费用回执' : '费用未知'}</dd>
          </dl>
        </li>)}</ol>
      </section>}
      <section className="context-group" aria-label="最近一次模型请求">
        <h3>最近一次模型请求</h3>
        {data.latest_request ? <div className="context-entry">
          <div className="context-line"><strong>{data.latest_request.compaction ? '压缩请求' : '输入容量与用量'}</strong><Status state={data.latest_request.state} /></div>
          <RequestDetails item={data.latest_request} />
        </div> : <p className="context-muted">本轮暂无已派发的模型请求。</p>}
      </section>
    </>}
    <details className="context-group">
      <summary>模型请求{data && <span>{requests.length}{data.activities.next_cursor ? '+' : ''} 次</span>}</summary>
      {data && (requests.length ? <ol className="context-entries">{requests.map((item, index) => <ModelRequest key={item.id}
        item={item} index={index + 1} scale={data.units_per_currency} />)}</ol> :
        <p className="context-muted">当前记录无已派发请求。</p>)}
    </details>
    {round && data.activities.next_cursor && <Button variant="outline" size="sm" disabled={loading}
      onClick={() => setPagination({ runId: round.run_id, depth: (pagination?.runId === round.run_id ? pagination.depth : 1) + 1 })}>
        {loading ? '正在加载…' : '更多本轮记录'}
      </Button>}
    <details className="context-group" onToggle={event => setUsageOpen(event.currentTarget.open)}>
      <summary>会话用量与费用</summary>
      {usageOpen && <SessionUsage client={client} sessionId={sessionId} accountingRevision={accountingRevision} />}
    </details>
  </section>;
}
