import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { MemoryDecisionCommand, MemoryEvidencePage, MemoryRecord, TaskHandle } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';
import { memoryScopeLabel } from '../../api/memory';
import MemoryCommands from './MemoryCommands';
import type { EditorLifecycle } from '../settings/Settings';
import MaintenanceHistory from './MaintenanceHistory';
import MemoryEvidenceReader from './MemoryEvidenceReader';

const statuses = { candidate: '待确认', confirmed: '已采纳', rejected: '已拒绝', deleted: '已删除' };
const authors = { user: '用户自述', assistant: 'AI主张', tool: '工具实际结果' };
const kinds = { fact: '事实', preference: '偏好', instruction: '指导', episode: '经历' };
export default function MemoryReview({ client, store, id, receiptMessageId, refreshKey = 0, disabled = false, onBusyChange, onSaved, onDiscard, onOpenTask }: {
  client: RuntimeClient; store: RuntimeStore; id: string; receiptMessageId?: string; refreshKey?: number; disabled?: boolean;
  onOpenTask?: (task: TaskHandle) => void;
} & EditorLifecycle) {
  const chat = receiptMessageId !== undefined;
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [generation, refresh] = useState(0), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [data, setData] = useState<{ key: string; value?: { record: MemoryRecord; evidence: MemoryEvidencePage }; error?: string; resolved?: boolean }>();
  const [editing, setEditing] = useState<MemoryRecord>(), [text, setText] = useState(''), [deleting, setDeleting] = useState<MemoryRecord>();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false), pending = useRef(false);
  const key = `${id}:${receiptMessageId}:${projection.memoryRevision}:${refreshKey}:${generation}`;
  useEffect(() => { let ignore = false;
    Promise.all([client.memoryRecord(id, receiptMessageId), client.memoryEvidence(id)]).then(([record, evidence]) => {
      if (!ignore) setData({ key, value: { record, evidence } });
    }).catch(error => { if (!ignore) setData({ key, resolved: error instanceof ApiError && error.code === 'memory_candidate_resolved',
      error: error instanceof ApiError ? `${error.code}: ${error.message}` : windowError(error) }); });
    return () => { ignore = true; };
  }, [client, key]);
  const current = data?.key === key ? data : undefined;
  const record = current?.value?.record, sourceValid = !!current?.value && current.value.evidence.items.every(item => item.available);
  const resolved = chat && current?.resolved && projection.memoryNotices[id]?.status !== 'candidate' ? projection.memoryNotices[id] : undefined;
  const blocked = disabled || busy || commands.some(command => command.type === 'decideMemory' && command.targetId === id);
  async function decide(action: MemoryDecisionCommand['data']['action']) {
    const bound = action === 'revise' ? editing : action === 'delete' ? deleting : record;
    if (pending.current || !bound) return;
    if (action === 'revise' && (!record || !sourceValid || record.status === 'deleted')) {
      setError('当前记忆或来源不可用，请重新核对或放弃编辑'); return;
    }
    const element = form.current;
    pending.current = true; setBusy(true); onBusyChange?.(true); setError(''); setStatus('');
    try {
      const command: MemoryDecisionCommand = { meta: commandMeta(bound.revision),
        data: { action, scope: bound.scope, ...(action === 'revise' ? { text } : {}) } };
      const outcome = await store.dispatch({ type: 'decideMemory', args: receiptMessageId ? [id, command, receiptMessageId] : [id, command] });
      if (outcome.status === 'confirmed') {
        setEditing(undefined); setText(''); setDeleting(undefined); setStatus('决定已保存');
        if (element) onSaved?.(element);
      }
    } catch (error) { setError(error instanceof ApiError ? `${error.code}: ${error.message}` : windowError(error)); }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false); refresh(value => value + 1); }
  }
  return <section className="card memory-card" aria-label="记忆审阅">
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {current?.error && !resolved && <p role="alert">{current.error}</p>}
    {!current && <p>正在核对当前记忆与来源…</p>}
    {!record && chat && projection.memoryNotices[id] && projection.memoryNotices[id].status !== 'candidate'
      && <p>{statuses[projection.memoryNotices[id].status]}</p>}
    {record && <><p><span>{statuses[record.status]}</span> · <span>{memoryScopeLabel(record.scope)}</span> · 修订 {record.revision}</p>
      <p>{authors[record.author_kind]} · {kinds[record.kind]}</p>
      {record.status !== 'deleted' && (sourceValid ? <p>{record.text}</p> : <p>来源已失效，记忆正文不可用</p>)}
      {record.expires_at && <p>有效期至 {record.expires_at}</p>}
      {record.status !== 'deleted' && <MemoryEvidenceReader client={client} store={store} record={record}
        items={current!.value!.evidence.items} receiptMessageId={receiptMessageId} refreshKey={key} />}
      {record.status !== 'deleted' && onOpenTask && <MaintenanceHistory client={client} scope={record.scope} recordId={record.id}
        revision={`${projection.maintenanceRevision}:${projection.memoryRevision}:${refreshKey}`} onOpenTask={onOpenTask} />}
      {record.status === 'candidate' && sourceValid && <div className="button-row">
        <button disabled={blocked} onClick={() => void decide('accept')}>{chat ? record.supersedes ? '确认纠正' : '记住' : '采纳'}</button>
        {!chat && <button disabled={blocked} onClick={() => void decide('reject')}>拒绝</button>}
      </div>}
      {!chat && record.status !== 'deleted' && <div className="button-row">
        <button disabled={blocked || !sourceValid} onClick={() => { setEditing(record); setText(record.text); }}>修改</button>
        <button disabled={blocked} onClick={() => setDeleting(record)}>删除</button>
      </div>}
      {deleting && <div><p>删除后不再加载；旧候选不能恢复这条记忆。</p>
        <button disabled={blocked} onClick={() => void decide('delete')}>确认删除记忆</button><button disabled={busy} onClick={() => setDeleting(undefined)}>取消删除</button></div>}
    </>}
    {editing && <form ref={form}
        onReset={() => { setEditing(undefined); setText(''); }}
        onSubmit={event => { event.preventDefault(); void decide('revise'); }}>
        {sourceValid && record?.status !== 'deleted' && <><label>记忆内容 <textarea required maxLength={16000} disabled={busy} value={text} onChange={event => setText(event.target.value)} /></label>
        <p>保存基于修订 {editing.revision}，范围不变。{editing.revision !== record?.revision && '当前记录已改变；请核对后重新编辑。'}</p><button disabled={blocked || !text.trim()}>保存修订</button></>}
        <button type="button" disabled={busy} onClick={() => { onDiscard?.(form.current!); setEditing(undefined); setText(''); }}>取消修改</button>
      </form>}
    <button disabled={busy} onClick={() => { setError(''); refresh(value => value + 1); }}>重新核对记忆</button>
    {chat && <MemoryCommands store={store} targetId={id} />}
  </section>;
}
