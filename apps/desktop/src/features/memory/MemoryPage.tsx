import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { MemoryRecordPage, MemoryRecord, RunSnapshot, TaskHandle } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';
import { memoryQuery, personalScope, type MemoryScope } from '../../api/memory';
import MemoryScopePicker from './MemoryScopePicker';
import MemoryReview from './MemoryReview';
import MemoryCommands from './MemoryCommands';
import MemoryMaintenance from './MemoryMaintenance';

export default function MemoryPage({ client, store, onClose, onSettings, onReturnToQuick, initialSource, onOpenTask }: {
  client: RuntimeClient; store: RuntimeStore; onClose: () => void; onSettings: (scope: MemoryScope) => void; onReturnToQuick?: () => Promise<void>;
  initialSource?: RunSnapshot; onOpenTask: (task: TaskHandle) => void;
}) {
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const [scope, setScope] = useState(personalScope), [filter, setFilter] = useState<MemoryRecord['status'] | ''>('');
  const [page, setPage] = useState<{ key: string; value: Omit<MemoryRecordPage, 'items'> & { items: string[] } }>(), [generation, refresh] = useState(0);
  const [error, setError] = useState(''), [text, setText] = useState(''), [kind, setKind] = useState<MemoryRecord['kind']>('fact'), [busy, setBusy] = useState(false);
  const close = useRef<HTMLButtonElement>(null), revision = useRef(0), root = useRef<HTMLElement>(null);
  const dirty = useRef(new Set<HTMLFormElement>()), continuation = useRef<(() => void) | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  function guard(action: () => void) {
    if (busy) return;
    for (const form of dirty.current) if (!form.isConnected) dirty.current.delete(form);
    if (dirty.current.size) { continuation.current = action; setConfirming(true); } else action();
  }
  function complete(form: HTMLFormElement) {
    dirty.current.delete(form);
    if (!continuation.current) return;
    if (dirty.current.size) dirty.current.values().next().value!.requestSubmit();
    else { const action = continuation.current; continuation.current = undefined; setConfirming(false); action(); }
  }
  const identity = `${scope.kind}:${scope.workspace_id}:${filter}`;
  const key = `${identity}:${projection.memoryRevision}:${generation}`;
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => { let ignore = false;
    client.memoryRecords({ ...memoryQuery(scope), ...(filter ? { status: filter } : {}), limit: 50 }).then(value => {
      if (!ignore) setPage({ key: identity, value: { ...value, items: value.items.map(record => record.id) } });
    }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, key]);
  const current = page?.key === identity ? page.value : undefined;
  return <section ref={root} className="memory-page" role="dialog" aria-modal="true" aria-label="记忆与成长"
    onChangeCapture={event => { const form = (event.target as HTMLElement).closest('form'); if (form) dirty.current.add(form); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); guard(onClose); }
      if (event.key === 'Tab') {
        const controls = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')].filter(element => element.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <header className="panel-header"><h1>记忆与成长</h1><button ref={close} disabled={busy} onClick={() => guard(onClose)}>{initialSource ? '返回任务中心' : '返回对话与草稿'}</button></header>
    {confirming && <section aria-label="未保存记忆"><h2>有未保存的记忆内容</h2>
      <button disabled={busy} onClick={() => { continuation.current = undefined; setConfirming(false); }}>继续编辑</button>
      <button disabled={busy} onClick={() => { for (const form of dirty.current) form.reset(); dirty.current.clear(); const action = continuation.current; continuation.current = undefined; setConfirming(false); action?.(); }}>放弃更改</button>
      <button disabled={busy} onClick={() => dirty.current.values().next().value?.requestSubmit()}>保存后继续</button>
    </section>}
    <MemoryScopePicker client={client} scope={scope} disabled={busy} onChange={next => guard(() => { setScope(next); setText(''); })} />
    <MemoryMaintenance client={client} store={store} scope={scope} initialSource={initialSource}
      disabled={busy} onBusyChange={setBusy} onOpenTask={task => guard(() => onOpenTask(task))} />
    <label>记录状态 <select value={filter} disabled={busy} onChange={event => { const next = event.target.value as typeof filter; guard(() => setFilter(next)); }}>
      <option value="">全部状态</option><option value="confirmed">已采纳</option><option value="candidate">待确认</option><option value="rejected">已拒绝</option><option value="deleted">已删除</option>
    </select></label>
    <button onClick={() => refresh(value => value + 1)}>刷新记忆</button>
    {error && <p role="alert">{error}</p>}
    {!current ? <p>正在读取记忆…</p> : <>{!current.items.length && <p>此范围暂无记忆。</p>}
      <div className="memory-grid">{current.items.map(id => <MemoryReview key={id} id={id} client={client} store={store}
        refreshKey={generation} disabled={busy} onBusyChange={setBusy} onSaved={complete} onDiscard={form => dirty.current.delete(form)}
        onOpenTask={task => guard(() => onOpenTask(task))} />)}</div>
      {current.next_cursor && <button onClick={() => {
        const expected = identity;
        void client.memoryRecords({ ...memoryQuery(scope), ...(filter ? { status: filter } : {}), limit: 50, cursor: current.next_cursor! })
          .then(value => setPage(previous => previous?.key === expected ? { key: identity, value: { ...value, items: [...new Set([...previous.value.items, ...value.items.map(record => record.id)])] } } : previous))
          .catch(error => setError(windowError(error)));
      }}>更多记忆</button>}</>}
    <form onReset={() => setText('')} onSubmit={event => { event.preventDefault(); if (busy) return; const submitted = revision.current, form = event.currentTarget;
      setBusy(true); setError('');
      void store.dispatch({ type: 'createMemory', args: [{ meta: commandMeta(), data: { text, scope, kind } }] }).then(outcome => {
        if (outcome.status === 'confirmed' && submitted === revision.current) { setText(''); complete(form); }
      }).catch(error => setError(windowError(error))).finally(() => setBusy(false));
    }}><h2>新建长期记忆</h2>
      <label>新记忆内容 <textarea required maxLength={16000} value={text} onChange={event => { revision.current++; setText(event.target.value); }} /></label>
      <label>记忆类型 <select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="fact">事实</option><option value="preference">偏好</option><option value="instruction">指导</option><option value="episode">经历</option></select></label>
      <button disabled={busy || !text.trim() || commands.some(command => command.type === 'createMemory')}>保存新记忆</button>
    </form>
    <MemoryCommands store={store} />
    <button disabled={busy} onClick={() => onSettings(scope)}>管理读取与整理设置</button>
    {onReturnToQuick && <button disabled={busy} onClick={() => guard(() => { void onReturnToQuick().catch(error => setError(windowError(error))); })}>返回快捷小窗</button>}
  </section>;
}
