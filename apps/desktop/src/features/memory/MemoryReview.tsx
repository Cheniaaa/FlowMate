import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { MemoryDecisionCommand, MemoryEvidencePage, MemoryRecord, RunSnapshot, TaskHandle } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';
import Dialog from '../../components/Dialog';
import { Button } from '../../components/ui/button';
import { FieldLabel } from '../../components/ui/field';
import { Textarea } from '../../components/ui/textarea';
import IconButton from '../../components/IconButton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import MemoryCommands from './MemoryCommands';
import MaintenanceHistory from './MaintenanceHistory';
import MemoryEvidenceReader from './MemoryEvidenceReader';
import './memory.css';

const statuses = { candidate: '待确认', confirmed: '已记住', rejected: '已拒绝', deleted: '已删除' };
const authors = { user: '用户提供', assistant: '助理推断', tool: '工具结果' };
const kinds = { fact: '事实', preference: '偏好', instruction: '指导', episode: '经历' };

function RevisionInput({ inputRef, text, concealed, readOnly, onChange }: {
  inputRef: RefObject<HTMLTextAreaElement | null>; text: string; concealed: boolean;
  readOnly: boolean; onChange: (text: string) => void;
}) {
  const selection = useRef<[number, number, HTMLTextAreaElement['selectionDirection']] | undefined>(undefined);
  useLayoutEffect(() => {
    const input = inputRef.current!;
    if (concealed) {
      if (input.value) {
        selection.current = [input.selectionStart, input.selectionEnd, input.selectionDirection];
        input.value = '';
      }
      return;
    }
    if (input.value !== text) input.value = text;
    if (selection.current) {
      input.setSelectionRange(...selection.current);
      selection.current = undefined;
    }
  }, [concealed, inputRef, text]);
  return <FieldLabel>记忆内容 <Textarea ref={inputRef} autoFocus required maxLength={16000}
    readOnly={readOnly} onChange={event => onChange(event.target.value)} /></FieldLabel>;
}

export default function MemoryReview({ client, store, id, receiptMessageId, savedInChat, runState, scopeLabel, disabled = false,
  onEditChange, onReturnFocus, onOpenTask }: {
  client: RuntimeClient; store: RuntimeStore; id: string; receiptMessageId?: string; scopeLabel?: string; disabled?: boolean;
  savedInChat?: 'new' | 'corrected'; runState?: RunSnapshot['state'];
  onOpenTask?: (task: TaskHandle) => void; onEditChange?: (open: boolean) => void; onReturnFocus?: () => void;
}) {
  const chat = receiptMessageId !== undefined;
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [generation, refresh] = useState(0), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [data, setData] = useState<{ key: string; value: { record: MemoryRecord; evidence: MemoryEvidencePage } }>();
  const [readFailure, setReadFailure] = useState<{ key: string; error?: string; resolved: boolean; waiting: boolean; unavailable: boolean }>();
  const [editing, setEditing] = useState<MemoryRecord>(), [text, setText] = useState(''), [deleting, setDeleting] = useState<MemoryRecord>();
  const [saveCommandId, setSaveCommandId] = useState<string>();
  const [sourceRejected, setSourceRejected] = useState(false);
  const [discarding, setDiscarding] = useState(false), [history, setHistory] = useState(false);
  const root = useRef<HTMLElement>(null), modify = useRef<HTMLButtonElement>(null), more = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null), switchingPanel = useRef(false);
  const [busy, setBusy] = useState(false), pending = useRef(false);
  const key = `${id}:${receiptMessageId}:${projection.memoryRevision}:${generation}:${savedInChat ? runState : ''}`;
  const failure = readFailure?.key === key ? readFailure : undefined;
  const current = data?.key === key ? data.value : undefined;
  const checking = !current && !failure;
  const record = data?.value.record;
  const sourceMissing = data?.value.evidence.items.some(item => !item.available);
  const sourceValid = !!current && !sourceMissing;
  const readable = record?.status === 'confirmed' || record?.status === 'candidate';
  const editorUnavailable = sourceRejected || failure?.unavailable || sourceMissing || (!!record && !readable);
  const liveRecord = current?.record;
  useEffect(() => { let ignore = false;
    Promise.all([client.memoryRecord(id, receiptMessageId), client.memoryEvidence(id)]).then(([record, evidence]) => {
      if (!ignore) setData({ key, value: { record, evidence } });
    }).catch(error => {
      if (ignore) return;
      const code = error instanceof ApiError ? error.code : undefined;
      const resolved = code === 'memory_candidate_resolved';
      const waiting = code === 'memory_write_pending';
      const writeFeedback = savedInChat && code === 'memory_write_existing' ? '相同记忆已经存在'
        : savedInChat && code === 'memory_write_conflict' ? '记忆依据或目标已改变，本轮未保存' : undefined;
      const unavailable = code === 'not_found' || code === 'scope_revoked' || code === 'scope_deleted';
      setReadFailure({ key, resolved, waiting, unavailable,
        error: resolved || waiting ? undefined : writeFeedback || windowError(error) });
    });
    return () => { ignore = true; };
  }, [client, key, savedInChat]);
  const resolved = chat && failure?.resolved && projection.memoryNotices[id]?.status !== 'candidate' ? projection.memoryNotices[id] : undefined;
  const blocked = !current || disabled || busy || commands.some(command => command.type === 'decideMemory' && command.targetId === id);
  function closeEditor() {
    setEditing(undefined); setText(''); setDiscarding(false); setError(''); setSaveCommandId(undefined);
    setSourceRejected(false);
    onEditChange?.(false);
  }
  function requestEditorClose() {
    if (!editing || busy) return;
    if (saveCommandId || editorUnavailable || text === editing.text) closeEditor();
    else setDiscarding(true);
  }
  function returnFocus(preferred: HTMLButtonElement | null) {
    if (preferred?.isConnected) preferred.focus();
    else if (root.current?.isConnected) root.current.focus();
    else onReturnFocus?.();
  }
  async function decide(action: MemoryDecisionCommand['data']['action']) {
    const bound = action === 'revise' ? editing : action === 'delete' ? deleting : liveRecord;
    const retry = action === 'revise' ? saveCommandId : undefined;
    if (pending.current || !bound || (!retry && blocked)) return;
    if (action === 'revise' && !retry && (!sourceValid || !readable || !text.trim())) {
      setError('当前记忆或来源不可用，请重新核对或放弃编辑'); return;
    }
    const origin = document.activeElement;
    pending.current = true; setBusy(true); setError(''); setStatus('');
    try {
      const outcome = await (retry ? store.retry(retry) : (() => {
        const command: MemoryDecisionCommand = { meta: commandMeta(bound.revision),
          data: { action, scope: bound.scope, ...(action === 'revise' ? { text } : {}) } };
        return store.dispatch({ type: 'decideMemory', args: receiptMessageId ? [id, command, receiptMessageId] : [id, command] });
      })());
      if (outcome.status === 'confirmed') {
        if (editing) closeEditor();
        setDeleting(undefined);
        if ((action === 'accept' || action === 'reject' || action === 'undo') && (
          (document.activeElement === origin && root.current?.contains(origin)) || document.activeElement === more.current
        )) root.current?.focus();
        setStatus({ accept: '决定已保存', reject: '已拒绝候选', revise: '已修改记忆',
          delete: '已删除记忆', undo: '已撤销记忆变更' }[action]);
      } else if (action === 'revise') setSaveCommandId(outcome.commandId);
    } catch (error) {
      setSaveCommandId(undefined);
      setError(windowError(error));
      if (action === 'revise' && error instanceof ApiError && error.code === 'memory_source_invalid') {
        setSourceRejected(true);
      } else refresh(value => value + 1);
    }
    finally { pending.current = false; setBusy(false); }
  }
  if (savedInChat && !current && !checking) {
    const text = status || (failure?.resolved ? '这条记忆已变更' : failure?.waiting
      ? runState && ['completed', 'cancelled', 'failed'].includes(runState) ? '本轮未保存记忆' : '将在本轮完成时保存'
      : failure?.error || '正在核对记忆');
    return <><p role="status">{text}</p>{failure?.error && <Button variant="outline" onClick={() => refresh(value => value + 1)}>重试读取记忆</Button>}</>;
  }
  return <section ref={root} tabIndex={-1} className="card memory-card" aria-label="记忆审阅">
    {error && !editing && !deleting && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {failure?.error && !resolved && <div><p role="alert">{failure.error}</p>
      <Button variant="outline" onClick={() => { root.current?.focus(); refresh(value => value + 1); }}>重试读取记忆</Button></div>}
    {checking && <p role="status">正在核对记忆与来源…</p>}
    {!current && chat && projection.memoryNotices[id] && projection.memoryNotices[id].status !== 'candidate'
      && <p>{statuses[projection.memoryNotices[id].status]}</p>}
    {record && <>{current && <>
      {readable && (sourceValid ? <p className="memory-record-text">{record.text}</p> : <p>来源已失效，记忆正文不可用</p>)}
      <div className="memory-record-meta flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{savedInChat === 'corrected' && record.status === 'confirmed' ? '已纠正记忆' : statuses[record.status]}</span>
        <span>适用范围：{record.scope.kind === 'user_global' ? '个人' : scopeLabel ?? (projection.workspaces[record.scope.workspace_id!]?.name
          ? `项目「${projection.workspaces[record.scope.workspace_id!].name}」` : '当前项目')}</span>
        <span>{kinds[record.kind]} · {authors[record.author_kind]}</span>
      </div>
      {readable && record.expires_at && <p>有效期至 {record.expires_at}</p>}
    </>}
      <div className="memory-record-actions flex flex-wrap gap-2">
        {record.status === 'candidate' && (checking || sourceValid) && <>
          <Button variant="default" aria-disabled={blocked} onClick={() => void decide('accept')}>{chat && record.supersedes ? '确认纠正' : '记住'}</Button>
          {!chat && <Button variant="outline" aria-disabled={blocked} onClick={() => void decide('reject')}>拒绝</Button>}
        </>}
        {record.status === 'confirmed' && savedInChat && (checking || sourceValid) && <Button variant="outline"
          aria-disabled={blocked || !!status} onClick={() => { if (!status) void decide('undo'); }}>撤销</Button>}
        {!chat && record.status === 'confirmed' && (checking || sourceValid) && <Button ref={modify} variant="default" aria-disabled={blocked}
          onClick={() => { if (!blocked) { setEditing(record); setText(record.text); setError(''); onEditChange?.(true); } }}>修改</Button>}
        {!chat && record.status !== 'deleted' && <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild><IconButton ref={more} icon="more" label="更多" disabled={busy} /></DropdownMenuTrigger>
          <DropdownMenuContent align="start" onCloseAutoFocus={event => {
            if (switchingPanel.current) { event.preventDefault(); switchingPanel.current = false; }
          }}>
            {record.status === 'confirmed' && <DropdownMenuItem disabled={blocked || !sourceValid} onSelect={() => void decide('undo')}>撤销</DropdownMenuItem>}
            <DropdownMenuItem disabled={blocked} onSelect={() => { switchingPanel.current = true; setError(''); setDeleting(record); }}>删除</DropdownMenuItem>
            {onOpenTask && <DropdownMenuItem onSelect={() => { switchingPanel.current = true; setHistory(true); }}>查看关联整理任务</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      {readable && <MemoryEvidenceReader client={client} store={store} record={record}
        items={data.value.evidence.items} receiptMessageId={receiptMessageId} refreshKey={key} checking={!current} />}
    </>}
    {editing && <Dialog title="修改记忆" onReturnFocus={() => returnFocus(editorUnavailable ? null : modify.current)} onClose={requestEditorClose}>
      <form className="memory-editor" onSubmit={event => { event.preventDefault(); void decide('revise'); }}>
          {!editorUnavailable && (checking || sourceValid) && <RevisionInput inputRef={editor} text={text}
           concealed={checking} readOnly={busy || checking || !!saveCommandId} onChange={setText} />}
        {!editorUnavailable && checking && <p role="status">正在核对编辑所依据的记忆…</p>}
        {!editorUnavailable && failure?.error && <div><p role="alert">{failure.error}</p><Button variant="outline" onClick={() => refresh(value => value + 1)}>重试读取记忆</Button></div>}
        {editorUnavailable && !sourceRejected && <p>来源已失效或记忆已移除，无法保存修改。</p>}
        {!editorUnavailable && current && editing.revision !== record?.revision && <p>当前记忆已被修改。草稿仍保留，保存前请核对。</p>}
        {error && <p role="alert">{error}</p>}
        {saveCommandId ? <section aria-label="保存回执">
          <p role="status">保存结果尚未确认。</p>
          <p>关闭后可在记忆页的命令状态中重试原请求。</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={closeEditor}>稍后处理</Button>
            <Button variant="default" disabled={busy} onClick={() => void decide('revise')}>重试保存</Button>
          </div>
        </section> : editorUnavailable ? <IconButton size="icon-sm" icon="close" label="关闭编辑器" onClick={requestEditorClose} disabled={busy} /> :
          discarding ? <section aria-label="未保存记忆"><p>有未保存的记忆内容</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { editor.current?.focus(); setDiscarding(false); }}>继续编辑</Button>
            <Button variant="outline" onClick={closeEditor}>放弃更改</Button>
          </div>
        </section> : <div className="flex flex-wrap gap-2">
           {(checking || sourceValid) && <Button variant="default" type="submit" aria-disabled={blocked || !text.trim()}>保存修改</Button>}
           <Button variant="outline" disabled={busy} onClick={requestEditorClose}>取消修改</Button>
        </div>}
      </form>
    </Dialog>}
    {deleting && <Dialog title="删除记忆" onReturnFocus={() => returnFocus(more.current)} onClose={() => { if (!busy) { setDeleting(undefined); setError(''); } }}>
      <p>删除后，助理不会再使用这条记忆。</p>
      {error && <p role="alert">{error}</p>}
      {failure?.error && <><p role="alert">{failure.error}</p><Button variant="outline" onClick={() => refresh(value => value + 1)}>重试读取记忆</Button></>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { setDeleting(undefined); setError(''); }}>取消删除</Button>
        <Button variant="destructive" aria-disabled={blocked} onClick={() => void decide('delete')}>确认删除记忆</Button></div>
    </Dialog>}
    {history && record && onOpenTask && <Dialog title="关联整理任务" onReturnFocus={() => returnFocus(more.current)} onClose={() => setHistory(false)}>
      <MaintenanceHistory client={client} scope={record.scope} recordId={record.id}
        revision={`${projection.maintenanceRevision}:${projection.memoryRevision}`} onOpenTask={onOpenTask} />
    </Dialog>}
    {chat && <MemoryCommands store={store} targetId={id} />}
  </section>;
}
