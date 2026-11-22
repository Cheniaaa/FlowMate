import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { MemoryEvidenceExcerpt, MemoryEvidencePage, MemoryRecord } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';
import { Button } from '../../components/ui/button';
import IconButton from '../../components/IconButton';

type Evidence = MemoryRecord['evidence'][number];
const authors = { user: '用户原话', assistant: '助理陈述', tool: '工具结果' };
const sourceKinds = { message: '对话消息', artifact: '产物', event: '工具活动', user_edit: '记忆编辑' };
const fields: (keyof Evidence)[] = ['source_kind', 'source_id', 'source_version', 'locator', 'quote_hash', 'author_kind'];
const sameEvidence = (left: Evidence, right: Evidence) => fields.every(field => left[field] === right[field]);
const errorText = (error: unknown) => error instanceof ApiError ? error.message : windowError(error);

interface Props {
  client: RuntimeClient; store: RuntimeStore; record: MemoryRecord; items: MemoryEvidencePage['items'];
  receiptMessageId?: string; refreshKey?: string; checking?: boolean;
}

function EvidenceQuote({ client, record, item, index, receiptMessageId, requestKey, checking, verifying }: {
  client: RuntimeClient; record: MemoryRecord; item: MemoryEvidencePage['items'][number]; index: number;
  receiptMessageId?: string; requestKey: string; checking: boolean; verifying: boolean;
}) {
  const [offset, setOffset] = useState(0), [retry, setRetry] = useState(0);
  const [data, setData] = useState<{ key: string; value?: MemoryEvidenceExcerpt; error?: string }>();
  const heading = useRef<HTMLHeadingElement>(null);
  const key = `${requestKey}:${offset}:${retry}`;
  useEffect(() => {
    let ignore = false;
    if (!item.available) setData(undefined);
    if (item.available && !checking) client.memoryEvidenceExcerpt(record.id, index, record.revision, receiptMessageId, offset)
      .then(value => {
        if (value.record_id !== record.id || value.record_revision !== record.revision || !sameEvidence(value.evidence, item.evidence))
          throw new Error('依据响应与当前记录不符，请重新核对记忆');
        if (!ignore) setData({ key, value });
      }).catch(error => { if (!ignore) setData({ key, error: errorText(error) }); });
    return () => { ignore = true; };
  }, [client, key, item.available, checking]);
  const current = !checking && item.available && data?.key === key ? data : undefined;
  const value = current?.value;
  const slice = !verifying ? value?.excerpt : undefined;
  const lastSlice = data?.value?.excerpt;
  const messagePart = item.evidence.source_kind === 'message' && /^\/parts\/(\d+)(?:\/|$)/.exec(item.evidence.locator);
  return <section className="memory-evidence" aria-label={`依据 ${index + 1}`}>
    <h4 tabIndex={-1} ref={heading}>{value?.source_label ?? sourceKinds[item.evidence.source_kind]}</h4>
    <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
      <span>{authors[item.evidence.author_kind]}</span>
      {messagePart && <span>消息第 {Number(messagePart[1]) + 1} 段</span>}
    </div>
    {checking || verifying ? <p role="status">正在重新核对依据来源…</p> : <>
      {!item.available && <p>来源已失效，无法查看原文。</p>}
      {item.available && !current && <p role="status">正在读取原始依据…</p>}
      {current?.error && <><p role="alert">{current.error}</p>
        <Button variant="outline" onClick={() => { heading.current?.focus(); setRetry(value => value + 1); }}>重试读取依据</Button></>}
      {value?.reason === 'source_not_public' && <p>此依据属于内部材料，仅可在原任务查看已公开的交付或授权。</p>}
      {value?.reason === 'source_unavailable' && <p>来源已撤销、删除或修订，原文不可用。</p>}
      {slice && <><blockquote>{slice.text}</blockquote><p>原文第 {slice.start + 1}—{slice.end} 字，共 {slice.total_chars} 字</p></>}
    </>}
    {item.available && (lastSlice || offset > 0) && <div className="flex flex-wrap gap-2">
      {lastSlice && lastSlice.end < lastSlice.total_chars
        && <Button size="sm" variant="outline" aria-disabled={!slice} onClick={() => { if (slice) { heading.current?.focus(); setOffset(slice.end); } }}>查看下一段依据</Button>}
      {offset > 0 && <IconButton type="button" icon="back" size="icon-sm" label="返回依据开头" aria-disabled={!slice}
        onClick={() => { if (slice) { heading.current?.focus(); setOffset(0); } }} />}
    </div>}
  </section>;
}

export default function MemoryEvidenceReader({ client, store, record, items, receiptMessageId, refreshKey = '', checking = false }: Props) {
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [open, setOpen] = useState(false), [notice, setNotice] = useState(''), [verification, setVerification] = useState<string>();
  const summary = useRef<HTMLElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const dependencies = record.dependencies.map(item => [
    projection.scopes[item.scope_id]?.epoch, projection.scopes[item.scope_id]?.status,
    projection.resources[item.scope_id]?.version, projection.grants[item.scope_id]?.version,
  ]);
  const key = `${record.id}:${record.revision}:${receiptMessageId}:${refreshKey}:${projection.memoryRevision}:${projection.snapshotWatermark}:${JSON.stringify(dependencies)}`;
  const verifying = verification === key;
  useEffect(() => {
    if (!open || checking) return;
    let ignore = false, sequence = 0;
    async function recheck() {
      const attempt = ++sequence;
      setVerification(key);
      try {
        // 只复核已展开记录的现有元数据，不轮询原文节选或改变来源授权。
        const [current, evidence] = await Promise.all([client.memoryRecord(record.id, receiptMessageId), client.memoryEvidence(record.id)]);
        if (ignore || attempt !== sequence) return;
        if (current.revision !== record.revision || current.status === 'deleted' || current.status === 'rejected'
          || evidence.items.length !== items.length
          || evidence.items.some((item, index) => !item.available || !sameEvidence(item.evidence, items[index].evidence))) {
          if (details.current?.contains(document.activeElement)) summary.current?.focus();
          setOpen(false); setNotice('依据已失效或记忆已改变，原文已收回。');
          store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 }));
        }
      } catch (error) {
        if (!ignore && attempt === sequence) {
          if (details.current?.contains(document.activeElement)) summary.current?.focus();
          setOpen(false); setNotice(`原文已隐藏：${errorText(error)}`);
          store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 }));
        }
      } finally { if (!ignore && attempt === sequence) setVerification(undefined); }
    }
    const timer = window.setInterval(() => { void recheck(); }, 5000);
    const focus = () => { void recheck(); };
    const visible = () => { if (document.visibilityState === 'visible') void recheck(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible);
    return () => {
      ignore = true; window.clearInterval(timer);
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible);
    };
  }, [client, store, key, open, checking]);
  return <><details ref={details} open={open} onToggle={event => {
    setOpen(event.currentTarget.open);
    if (event.currentTarget.open) { setNotice(''); setVerification(undefined); }
  }}>
    <summary ref={summary}>查看来源</summary>
    {open && items.map((item, index) => <EvidenceQuote key={`${record.id}:${record.revision}:${index}:${JSON.stringify(item.evidence)}`}
      client={client} record={record} item={item} index={index} receiptMessageId={receiptMessageId} requestKey={key}
      checking={checking} verifying={verifying} />)}
    {open && items.length === 0 && <p>该记录没有可阅读的依据。</p>}
  </details>{notice && <p role="status">{notice}</p>}</>;
}
