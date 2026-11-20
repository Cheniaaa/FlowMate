import { useEffect, useRef, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import AssistantSettings from '../settings/AssistantSettings';
import { windowError } from '../../api/windows';
import type { WorkspacePage } from '../../generated/contracts';
import { mergeVersioned } from '../../api/events';

export default function AssistantsPage({ client, refreshKey, skillsRevision, onClose, onReturnToQuick }: {
  client: RuntimeClient; refreshKey?: string; skillsRevision?: number; onClose: () => void; onReturnToQuick?: () => Promise<void>;
}) {
  const dirty = useRef(new Set<HTMLFormElement>());
  const continuation = useRef<(() => void) | undefined>(undefined);
  const [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(false), [error, setError] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspacePage>();
  const [workspaceId, setWorkspaceId] = useState('');
  useEffect(() => {
    let ignore = false;
    client.workspaces().then(page => { if (!ignore) setWorkspaces(page); })
      .catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client]);
  const root = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  function guard(action: () => void) {
    if (busy) return;
    for (const form of dirty.current) if (!form.isConnected) dirty.current.delete(form);
    if (dirty.current.size) { continuation.current = action; setConfirming(true); } else action();
  }
  function complete(form: HTMLFormElement) {
    dirty.current.delete(form); setHasChanges(dirty.current.size > 0);
    if (continuation.current) { const action = continuation.current; continuation.current = undefined; setConfirming(false); action(); }
  }
  return <section ref={root} className="assistants-page" role="dialog" aria-modal="true" aria-label="我的助理" onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); guard(onClose); }
    if (event.key === 'Tab') {
      const controls = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="panel-header"><h1>我的助理</h1><button ref={close} disabled={busy} onClick={() => guard(onClose)}>返回对话与草稿</button></header>
    <p>这里管理稳定的助理 Profile；任务详情中的成员和模型取自执行时固定快照。</p>
    <label>能力所属项目 <select value={workspaceId} disabled={busy} onChange={event => {
      const id = event.target.value; guard(() => setWorkspaceId(id));
    }}>
      <option value="">仅个人能力</option>
      {workspaces?.items.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
    </select></label>
    <p>选择项目后列出个人及该项目中已启用的能力；其他项目的原选择仅保留 ID。</p>
    {workspaces?.next_cursor && <button type="button" disabled={busy} onClick={async () => {
      try {
        const next = await client.workspaces({ cursor: workspaces.next_cursor! });
        setWorkspaces(current => ({ ...next, items: Object.values(mergeVersioned(
          Object.fromEntries(current!.items.map(item => [item.id, item])), next.items)) }));
      } catch (error) { setError(windowError(error)); }
    }}>更多能力项目</button>}
    {confirming && <section aria-label="未保存助理"><h2>有未保存的助理配置</h2>
      <button disabled={busy} onClick={() => { continuation.current = undefined; setConfirming(false); }}>继续编辑</button>
      <button disabled={busy} onClick={() => { for (const form of dirty.current) form.reset(); dirty.current.clear(); setHasChanges(false); const action = continuation.current; continuation.current = undefined; setConfirming(false); action?.(); }}>放弃更改</button>
      <button disabled={busy} onClick={() => dirty.current.values().next().value?.requestSubmit()}>保存后继续</button>
    </section>}
    <div onChangeCapture={event => { const form = (event.target as HTMLElement).closest('form'); if (form) { dirty.current.add(form); setHasChanges(true); } }}>
      <AssistantSettings client={client} manageMembers workspaceId={workspaceId || undefined} skillsRevision={skillsRevision} deferSkillRefresh={hasChanges || busy}
        refreshKey={hasChanges || busy ? undefined : refreshKey} guard={guard} onBusyChange={setBusy} onSaved={complete} onViewReady={() => {
          if (root.current && !root.current.contains(document.activeElement)) close.current?.focus();
        }} onDiscard={form => { dirty.current.delete(form); setHasChanges(dirty.current.size > 0); }} />
    </div>
    {error && <p role="alert">{error}</p>}
    {onReturnToQuick && <button disabled={busy} onClick={() => guard(() => { void onReturnToQuick().catch(error => setError(windowError(error))); })}>返回快捷小窗</button>}
  </section>;
}
