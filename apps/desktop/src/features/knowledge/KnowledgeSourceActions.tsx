import { useEffect, useRef, useState } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { validate } from '../../api/validation';
import { windowError } from '../../api/windows';
import type { KnowledgeSource, KnowledgeSourceActionCommand } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';

type Action = KnowledgeSourceActionCommand['data']['action'];
type Pending = { sourceId: string; label: string; command: KnowledgeSourceActionCommand };
const actionKey = (workspaceId: string) => `flowmate:knowledge-action:${workspaceId}`;
function readPending(workspaceId: string): Pending | undefined {
  const encoded = localStorage.getItem(actionKey(workspaceId));
  if (!encoded) return;
  const value = JSON.parse(encoded) as Pending;
  validate('KnowledgeSourceActionCommand', value.command);
  return value;
}
const cleanupReasons: Record<NonNullable<KnowledgeSource['cleanup_reason']>, string> = {
  index_cleanup_failed: '索引清理未完成，可重试。',
  content_cleanup_failed: '资料副本清理未完成，可重试。',
  storage_checkpoint_pending: '存储清理尚未完成，可稍后重试。',
};

export default function KnowledgeSourceActions({ client, source, originHint, addedAt, onChanged, onUpdate }: {
  client: RuntimeClient; source: KnowledgeSource; onChanged: () => void; onUpdate: () => void;
  originHint?: string | null; addedAt?: string | null;
}) {
  const [pending, setPending] = useState(() => readPending(source.workspace_id));
  const [confirmation, setConfirmation] = useState<'revoke' | 'delete'>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const inflight = useRef(false);
  function accepted(original: Pending) {
    localStorage.removeItem(actionKey(source.workspace_id)); setPending(undefined); setConfirmation(undefined);
    setStatus(`「${original.label}」操作已确认。`); onChanged();
  }
  useEffect(() => {
    const original = readPending(source.workspace_id);
    if (!original) return;
    let ignore = false;
    client.actOnKnowledgeSource(original.sourceId, original.command).then(() => {
      if (!ignore) accepted(original);
    }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, source.workspace_id]);
  async function perform(original: Pending) {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); setError(''); setStatus('');
    localStorage.setItem(actionKey(source.workspace_id), JSON.stringify(original)); setPending(original);
    try { await client.actOnKnowledgeSource(original.sourceId, original.command); accepted(original); }
    catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        localStorage.removeItem(actionKey(source.workspace_id)); setPending(undefined);
      }
      setConfirmation(undefined); setError(windowError(error));
    } finally { inflight.current = false; setBusy(false); }
  }
  function submit(action: Action) {
    void perform({ sourceId: source.id, label: source.label,
      command: { meta: commandMeta(source.revision), data: { action } } });
  }
  const stopped = source.status === 'removed' || source.status === 'revoked' || source.status === 'deleted';
  const repeatAction: Action | undefined = source.status === 'removed' ? 'remove' : source.status === 'revoked' ? 'revoke' : source.status === 'deleted' ? 'delete' : undefined;
  return <section className="grid gap-2 text-sm" aria-label="资料操作">
    {status && <p role="status" className="m-0">{status}</p>}{error && <p role="alert" className="m-0">{error}</p>}
    {source.status === 'removed' && <p className="m-0">已移出新任务的检索范围；有读取许可的历史引用仍可核对。</p>}
    {source.status === 'revoked' && <p className="m-0">已停止使用，历史原文不再开放。</p>}
    {source.status === 'deleted' && <p className="m-0">已隐私删除项目内资料，历史原文不再开放；原文件保留。</p>}
    {source.cleanup_status === 'pending' && <p className="m-0">已停止使用，后台正在清理。</p>}
    {source.cleanup_status === 'failed' && <div>
      <p className="m-0">已停止使用，清理未完成。</p>
      {source.cleanup_reason && <p className="m-0 text-muted-foreground">{cleanupReasons[source.cleanup_reason]}</p>}
    </div>}
    {source.cleanup_status === 'complete' && <p className="m-0">清理已完成，原文件保留。</p>}
    <div className="flex flex-wrap gap-2">
      {!stopped && <>
        <Button size="sm" disabled={busy || !!pending} onClick={onUpdate}>更新文件</Button>
        <Button size="sm" disabled={busy || !!pending} onClick={() => submit('remove')}>移出项目资料</Button>
      </>}
      {source.status !== 'revoked' && source.status !== 'deleted' && <Button size="sm" disabled={busy || !!pending}
        onClick={() => setConfirmation('revoke')}>停止使用</Button>}
      {source.status !== 'deleted' && <Button size="sm" variant="destructive" disabled={busy || !!pending}
        onClick={() => setConfirmation('delete')}>隐私删除</Button>}
      {source.cleanup_status === 'failed' && repeatAction && <Button size="sm" disabled={busy || !!pending}
        onClick={() => submit(repeatAction)}>重试清理</Button>}
    </div>
    {pending && <section><p className="m-0">「{pending.label}」操作结果待核对，可重试。</p>
      <Button size="sm" disabled={busy} onClick={() => void perform(pending)}>重试</Button></section>}
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open && !busy) setConfirmation(undefined); }}>
      <DialogContent className="grid w-[min(92vw,480px)] gap-4">
        <DialogTitle className="m-0 text-lg font-semibold">{confirmation === 'delete' ? '隐私删除资料' : '停止使用资料'}</DialogTitle>
        <DialogDescription className="m-0 text-sm text-muted-foreground">{confirmation === 'delete'
          ? `隐私删除「${source.label}」的项目内副本和历史原文，已有引用将无法读取；不会删除原文件。`
          : `停止使用「${source.label}」并收回历史原文访问。原文件保留。`}</DialogDescription>
        {(originHint || addedAt) && <p className="m-0 text-sm text-muted-foreground">
          {originHint}{originHint && addedAt && ' · '}
          {addedAt && <>加入于 <time dateTime={addedAt}>{new Date(addedAt).toLocaleString('zh-CN')}</time></>}
        </p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" disabled={busy} onClick={() => submit(confirmation!)}>{confirmation === 'delete' ? '确认隐私删除' : '确认停止使用'}</Button>
          <Button disabled={busy} onClick={() => setConfirmation(undefined)}>取消</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
