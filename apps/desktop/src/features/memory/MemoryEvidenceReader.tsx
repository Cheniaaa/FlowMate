import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { MemoryEvidenceExcerpt, MemoryEvidencePage, MemoryRecord } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';

type Evidence = MemoryRecord['evidence'][number];
const authors = { user: '用户自述', assistant: 'AI主张', tool: '工具实际结果' };
const fields: (keyof Evidence)[] = ['source_kind', 'source_id', 'source_version', 'locator', 'quote_hash', 'author_kind'];
const sameEvidence = (left: Evidence, right: Evidence) => fields.every(field => left[field] === right[field]);
const errorText = (error: unknown) => error instanceof ApiError ? error.message : windowError(error);

interface Props {
  client: RuntimeClient; store: RuntimeStore; record: MemoryRecord; items: MemoryEvidencePage['items'];
  receiptMessageId?: string; refreshKey?: string;
}

function EvidenceQuote({ client, record, item, index, receiptMessageId, verifying }: {
  client: RuntimeClient; record: MemoryRecord; item: MemoryEvidencePage['items'][number]; index: number;
  receiptMessageId?: string; verifying: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ offset: number; value?: MemoryEvidenceExcerpt; error?: string }>();
  useEffect(() => {
    let ignore = false;
    if (item.available) client.memoryEvidenceExcerpt(record.id, index, record.revision, receiptMessageId, offset)
      .then(value => {
        if (value.record_id !== record.id || value.record_revision !== record.revision || !sameEvidence(value.evidence, item.evidence))
          throw new Error('依据响应与当前记录不符，请重新核对记忆');
        if (!ignore) setData({ offset, value });
      }).catch(error => { if (!ignore) setData({ offset, error: errorText(error) }); });
    return () => { ignore = true; };
  }, [client, record.id, record.revision, index, receiptMessageId, offset, item.available]);
  const current = data?.offset === offset ? data : undefined, value = current?.value;
  const slice = value?.excerpt;
  return <section aria-label={`依据 ${index + 1}`}>
    <p>{authors[item.evidence.author_kind]} · {item.evidence.source_kind} · {item.available ? '来源可用' : '来源不可用'}</p>
    <p>来源 ID <code>{item.evidence.source_id}</code></p>
    <p>记录修订 {record.revision} · 来源版本 {item.evidence.source_version} · 定位 <code>{item.evidence.locator}</code></p>
    {!item.available && <p>来源已失效，请重新核对记忆与原任务。</p>}
    {verifying ? <p role="status">正在重新核对依据来源…</p> : <>
      {item.available && !current && <p role="status">正在读取原始依据…</p>}
      {current?.error && <p role="alert">{current.error}</p>}
      {value && <p>{value.source_label}</p>}
      {value?.reason === 'source_not_public' && <p>此依据属于内部材料，仅可在原任务查看已公开的交付或授权。</p>}
      {value?.reason === 'source_unavailable' && <p>来源已撤销、删除或修订，原文不可用。</p>}
      {slice && <><pre>{slice.text}</pre><p>原文第 {slice.start + 1}—{slice.end} 字，共 {slice.total_chars} 字</p>
        <div className="button-row">{slice.end < slice.total_chars
          && <button type="button" onClick={() => setOffset(slice.end)}>查看下一段依据</button>}
          {offset > 0 && <button type="button" onClick={() => setOffset(0)}>返回依据开头</button>}</div></>}
    </>}
  </section>;
}

export default function MemoryEvidenceReader({ client, store, record, items, receiptMessageId, refreshKey = '' }: Props) {
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [open, setOpen] = useState(false), [notice, setNotice] = useState(''), [verification, setVerification] = useState<string>();
  const dependencies = record.dependencies.map(item => [
    projection.scopes[item.scope_id]?.epoch, projection.scopes[item.scope_id]?.status,
    projection.resources[item.scope_id]?.version, projection.grants[item.scope_id]?.version,
  ]);
  const key = `${record.id}:${record.revision}:${receiptMessageId}:${refreshKey}:${projection.memoryRevision}:${projection.snapshotWatermark}:${JSON.stringify(dependencies)}`;
  const verifying = verification === key;
  useEffect(() => {
    if (!open) return;
    let ignore = false, sequence = 0;
    async function recheck() {
      const attempt = ++sequence;
      setVerification(key);
      try {
        // 只复核已展开记录的现有元数据，不轮询原文节选或改变来源授权。
        const [current, evidence] = await Promise.all([client.memoryRecord(record.id, receiptMessageId), client.memoryEvidence(record.id)]);
        if (ignore || attempt !== sequence) return;
        if (current.revision !== record.revision || current.status === 'deleted'
          || evidence.items.length !== items.length
          || evidence.items.some((item, index) => !item.available || !sameEvidence(item.evidence, items[index].evidence))) {
          setOpen(false); setNotice('依据已失效或记录已改变，请重新核对记忆。');
          store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 }));
        }
      } catch (error) {
        if (!ignore && attempt === sequence) { setOpen(false); setNotice(`原文已隐藏：${errorText(error)}`); }
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
  }, [client, store, key, open]);
  return <><details open={open} onToggle={event => {
    setOpen(event.currentTarget.open);
    if (event.currentTarget.open) { setNotice(''); setVerification(undefined); }
  }}>
    <summary>查看依据</summary>
    {open && items.map((item, index) => <EvidenceQuote key={`${key}:${index}:${item.available}:${JSON.stringify(item.evidence)}`}
      client={client} record={record} item={item} index={index} receiptMessageId={receiptMessageId} verifying={verifying} />)}
    {open && items.length === 0 && <p>该记录没有可阅读的依据。</p>}
  </details>{notice && <p role="status">{notice}</p>}</>;
}
