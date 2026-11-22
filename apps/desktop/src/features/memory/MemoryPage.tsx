import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { MemoryRecordPage, MemoryRecord, RunSnapshot, TaskHandle } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';
import { memoryQuery, personalScope, type MemoryScope } from '../../api/memory';
import Dialog from '../../components/Dialog';
import { Button } from '../../components/ui/button';
import { FieldLabel } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { Textarea } from '../../components/ui/textarea';
import IconButton from '../../components/IconButton';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import MemoryScopePicker from './MemoryScopePicker';
import MemoryReview from './MemoryReview';
import MemoryCommands from './MemoryCommands';
import MemoryMaintenance from './MemoryMaintenance';
import { cn } from '../../lib/utils';

export default function MemoryPage({ client, store, onClose, onSettings, onReturnToQuick, initialSource, onOpenTask, embedded }: {
  client: RuntimeClient; store: RuntimeStore; onClose: () => void; onSettings: (scope: MemoryScope) => void; onReturnToQuick?: () => Promise<void>;
  initialSource?: RunSnapshot; onOpenTask: (task: TaskHandle) => void; embedded?: boolean;
}) {
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [scope, setScope] = useState(personalScope), [filter, setFilter] = useState<MemoryRecord['status'] | ''>('');
  const [projectName, setProjectName] = useState('');
  const [page, setPage] = useState<{ identity: string; key: string; depth: number; items: string[];
    next: MemoryRecordPage['next_cursor']; watermark: string }>();
  const [generation, retry] = useState(0), [listError, setListError] = useState<{ key: string; text: string }>();
  const [pageError, setPageError] = useState(''), [paging, setPaging] = useState(false);
  const [error, setError] = useState(''), [text, setText] = useState(''), [kind, setKind] = useState<MemoryRecord['kind']>('fact');
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState<string>();
  const [panel, setPanel] = useState<'create' | 'maintenance' | undefined>(initialSource ? 'maintenance' : undefined);
  const [confirming, setConfirming] = useState(false);
  const [saveCommandId, setSaveCommandId] = useState<string>();
  const [workspaceStream, setWorkspaceStream] = useState<{ id: string; watermark: string }>();
  const close = useRef<HTMLButtonElement>(null), more = useRef<HTMLButtonElement>(null), filterControl = useRef<HTMLSelectElement>(null);
  const root = useRef<HTMLElement>(null);
  const composing = useRef(false);
  const sequence = useRef(0);
  const depth = useRef({ identity: '', value: 1 });
  const openingDialog = useRef(false);
  function closePanel() {
    if (busy) return;
    if (saveCommandId) { resetCreate(); return; }
    if (panel === 'create' && (text || kind !== 'fact')) { setConfirming(true); return; }
    setPanel(undefined);
  }
  const identity = `${scope.kind}:${scope.workspace_id}:${filter}`;
  const key = `${identity}:${projection.memoryRevision}:${generation}`;
  const query = { ...memoryQuery(scope), ...(filter ? { status: filter } : {}), limit: 50 };
  const current = page?.identity === identity ? page : undefined;
  const failed = listError?.key === key ? listError.text : undefined;
  const scopeLabel = scope.kind === 'user_global' ? '个人' : projectName ? `项目「${projectName}」` : '当前项目';
  useEffect(() => { if (!initialSource) close.current?.focus(); }, []);
  useEffect(() => {
    const attempt = ++sequence.current;
    if (depth.current.identity !== identity) depth.current = { identity, value: 1 };
    setPaging(false); setPageError('');
    async function read() {
      const items = new Set<string>();
      let cursor: string | undefined;
      let watermark = '0';
      let loaded = 0;
      do {
        const value = await client.memoryRecords({ ...query, cursor });
        if (attempt !== sequence.current) return;
        if (loaded === 0) watermark = value.watermark;
        for (const record of value.items) items.add(record.id);
        cursor = value.next_cursor ?? undefined;
        loaded++;
      } while (cursor && loaded < depth.current.value);
      setPage({ identity, key, depth: loaded, items: [...items], next: cursor ?? null, watermark });
    }
    void read().catch(error => { if (attempt === sequence.current) setListError({ key, text: windowError(error) }); });
    return () => { sequence.current++; };
  }, [client, key]);
  useEffect(() => {
    const workspaceId = scope.workspace_id;
    if (!workspaceId) { setWorkspaceStream(undefined); return; }
    if (current && workspaceStream?.id !== workspaceId) setWorkspaceStream({ id: workspaceId, watermark: current.watermark });
  }, [scope.workspace_id, current, workspaceStream]);
  useEffect(() => {
    if (!workspaceStream || workspaceStream.id !== scope.workspace_id) return;
    const abort = new AbortController();
    const invalidate = () => { store.update(state => ({ ...state, memoryRevision: state.memoryRevision + 1 })); };
    void client.watchWorkspace(workspaceStream.id, workspaceStream.watermark, {
      snapshot: invalidate,
      event: event => {
        if (event.kind === 'durable' && event.event.workspace_id === workspaceStream.id
            && ['scope.revoked', 'scope.deleted', 'grant.revoked', 'grant.created', 'memory.changed',
              'memory.policy_changed', 'memory.maintenance_changed'].includes(event.event.kind)) invalidate();
      },
    }, abort.signal).catch(error => {
      if (!abort.signal.aborted) { invalidate(); setError(windowError(error)); }
    });
    return () => abort.abort();
  }, [client, scope.workspace_id, store, workspaceStream]);
  async function loadMore() {
    if (current?.key !== key || !current.next || paging) return;
    const attempt = sequence.current;
    setPaging(true); setPageError('');
    try {
      const value = await client.memoryRecords({ ...query, cursor: current.next });
      if (attempt !== sequence.current) return;
      depth.current = { identity, value: current.depth + 1 };
      setPage({ ...current, depth: depth.current.value, next: value.next_cursor,
        items: [...new Set([...current.items, ...value.items.map(record => record.id)])] });
      if (!value.next_cursor && root.current?.querySelector('[data-memory-more]') === document.activeElement) filterControl.current?.focus();
    } catch (error) { if (attempt === sequence.current) setPageError(windowError(error)); }
    finally { if (attempt === sequence.current) setPaging(false); }
  }
  function openPanel(value: typeof panel) {
    openingDialog.current = true;
    setPanel(value);
  }
  function resetCreate() {
    setText(''); setKind('fact'); setConfirming(false); setError(''); setPanel(undefined); setSaveCommandId(undefined);
  }
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const outcome = saveCommandId ? await store.retry(saveCommandId)
        : await store.dispatch({ type: 'createMemory', args: [{ meta: commandMeta(), data: { text, scope, kind } }] });
      if (outcome.status === 'confirmed') resetCreate();
      else setSaveCommandId(outcome.commandId);
    } catch (error) { setSaveCommandId(undefined); setError(windowError(error)); }
    finally { setBusy(false); }
  }
  const ids = current?.items ?? [];
  return <section ref={root} className={cn('memory-page', embedded && 'workbench-page ui-page-motion')}
    role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-label="记忆与成长"
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      if (event.defaultPrevented || !root.current!.contains(event.target as Node)) return;
      if (event.key === 'Escape' && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); if (!busy) onClose();
      }
      if (!embedded && event.key === 'Tab') {
        const controls = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')].filter(element => element.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <header className="panel-header"><h1>记忆与成长</h1><IconButton ref={close} icon={embedded || initialSource ? 'back' : 'close'} size="icon-sm"
      label={initialSource ? '返回任务中心' : '返回对话与草稿'} disabled={busy} onClick={onClose} /></header>
    <div className="memory-list-filters flex flex-wrap items-end gap-3">
      <MemoryScopePicker client={client} scope={scope} disabled={busy} onChange={(next, name) => { setScope(next); setProjectName(name); }} />
      <FieldLabel>记录状态 <NativeSelect ref={filterControl} value={filter} disabled={busy} onChange={event => setFilter(event.target.value as typeof filter)}>
        <NativeSelectOption value="">全部状态</NativeSelectOption>
        <NativeSelectOption value="confirmed">已记住</NativeSelectOption>
        <NativeSelectOption value="candidate">待确认</NativeSelectOption>
        <NativeSelectOption value="rejected">已拒绝</NativeSelectOption>
        <NativeSelectOption value="deleted">已删除</NativeSelectOption>
      </NativeSelect></FieldLabel>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><IconButton ref={more} variant="outline" icon="more" label="更多记忆管理" disabled={busy} /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={event => {
          if (openingDialog.current) {
            event.preventDefault();
            openingDialog.current = false;
          }
        }}>
          <DropdownMenuItem onSelect={() => openPanel('create')}>新建记忆</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openPanel('maintenance')}>整理记忆</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => {
            openingDialog.current = true;
            // 工作台在打开设置时记录当前焦点，先让触发按钮接管焦点。
            more.current?.focus();
            onSettings(scope);
          }}>管理读取与整理设置</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {failed && <div><p role="alert">{failed}</p><Button variant="outline" onClick={() => { filterControl.current?.focus(); retry(value => value + 1); }}>重试读取记忆列表</Button></div>}
    {!panel && !editing && <MemoryCommands store={store} />}
    {!current && !failed && <p role="status">正在读取记忆…</p>}
    {current?.items.length === 0 && !current.next && !failed && <p>此范围暂无记忆。</p>}
    <div className="memory-grid">{(editing && !ids.includes(editing) ? [...ids, editing] : ids).map(id => <MemoryReview key={id} id={id} client={client} store={store}
      scopeLabel={scopeLabel} disabled={busy} onEditChange={open => setEditing(open ? id : undefined)}
      onReturnFocus={() => filterControl.current?.focus()} onOpenTask={onOpenTask} />)}</div>
    {current?.next && <Button data-memory-more variant="outline" aria-disabled={current.key !== key || paging} onClick={() => void loadMore()}>{pageError ? '重试读取更多记忆' : '更多记忆'}</Button>}
    {pageError && <p role="alert">{pageError}</p>}
    {panel === 'maintenance' && <Dialog title="整理记忆" onClose={closePanel} onReturnFocus={() => more.current?.focus()}>
      <MemoryMaintenance client={client} store={store} scope={scope} scopeLabel={scopeLabel} initialSource={initialSource}
        disabled={busy} onBusyChange={setBusy} onOpenTask={onOpenTask} />
    </Dialog>}
    {panel === 'create' && <Dialog title="新建长期记忆" onClose={closePanel} onReturnFocus={() => more.current?.focus()}>
    {error && <p role="alert">{error}</p>}
    <form className="memory-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p>适用范围：{scopeLabel}</p>
      <FieldLabel>新记忆内容 <Textarea autoFocus required maxLength={16000} readOnly={busy || !!saveCommandId} value={text} onChange={event => setText(event.target.value)} /></FieldLabel>
      <FieldLabel>记忆类型 <NativeSelect disabled={busy || !!saveCommandId} value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
        <NativeSelectOption value="fact">事实</NativeSelectOption>
        <NativeSelectOption value="preference">偏好</NativeSelectOption>
        <NativeSelectOption value="instruction">指导</NativeSelectOption>
        <NativeSelectOption value="episode">经历</NativeSelectOption>
      </NativeSelect></FieldLabel>
      {saveCommandId ? <section aria-label="保存回执">
        <p role="status">保存结果尚未确认。</p>
        <p>关闭后可在记忆页的命令状态中重试原请求。</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={closePanel} disabled={busy}>稍后处理</Button>
          <Button variant="default" type="submit" disabled={busy}>重试保存</Button>
        </div>
      </section> :
        !confirming && <Button variant="default" type="submit" disabled={busy || !text.trim() || commands.some(command => command.type === 'createMemory')}>保存新记忆</Button>}
      {confirming && !saveCommandId && <section aria-label="未保存记忆"><p>有未保存的记忆内容</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={event => { event.currentTarget.form?.querySelector('textarea')?.focus(); setConfirming(false); }}>继续编辑</Button>
          <Button variant="outline" onClick={resetCreate}>放弃更改</Button>
          <Button variant="default" type="submit" disabled={busy || !text.trim() || commands.some(command => command.type === 'createMemory')}>保存后继续</Button>
        </div>
      </section>}
    </form>
    </Dialog>}
    {!panel && error && <p role="alert">{error}</p>}
    {onReturnToQuick && <IconButton icon="quick" label="返回快捷小窗" disabled={busy} onClick={() => { void onReturnToQuick().catch(error => setError(windowError(error))); }} />}
  </section>;
}
