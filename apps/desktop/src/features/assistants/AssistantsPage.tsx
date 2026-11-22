import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { RuntimeClient } from '../../api/client';
import AssistantSettings from '../settings/AssistantSettings';
import { windowError } from '../../api/windows';
import type { WorkspacePage } from '../../generated/contracts';
import { mergeVersioned } from '../../api/events';
import IconButton from '../../components/IconButton';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldLabel } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { cn } from '../../lib/utils';

export default function AssistantsPage({ client, refreshKey, skillsRevision, onClose, onReturnToQuick, navigationGuard }: {
  client: RuntimeClient; refreshKey?: string; skillsRevision?: number; onClose: () => void; onReturnToQuick?: () => Promise<void>;
  navigationGuard?: Ref<(action: () => void) => void>;
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
  useImperativeHandle(navigationGuard, () => guard);
  function complete(form: HTMLFormElement) {
    dirty.current.delete(form); setHasChanges(dirty.current.size > 0);
    if (continuation.current) { const action = continuation.current; continuation.current = undefined; setConfirming(false); action(); }
  }
  return <section ref={root} className={cn('assistants-page', navigationGuard && 'workbench-page ui-page-motion')}
    role={navigationGuard ? undefined : 'dialog'} aria-modal={navigationGuard ? undefined : true} aria-label="我的助理" onKeyDown={event => {
    if (event.defaultPrevented || !root.current!.contains(event.target as Node)) return;
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
      event.preventDefault();
      if (confirming) { continuation.current = undefined; setConfirming(false); }
      else guard(onClose);
    }
    if (!navigationGuard && event.key === 'Tab') {
      const controls = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="panel-header"><h1>我的助理</h1><IconButton ref={close} icon={navigationGuard ? 'back' : 'close'} size="icon-sm" label="返回对话与草稿" disabled={busy} onClick={() => guard(onClose)} /></header>
    <p>这里管理稳定的助理 Profile；任务详情中的成员和模型取自执行时固定快照。</p>
    <Field><FieldLabel htmlFor="assistant-project">能力所属项目</FieldLabel>
      <NativeSelect id="assistant-project" value={workspaceId} disabled={busy} onChange={event => {
        const id = event.target.value; guard(() => setWorkspaceId(id));
      }}>
      <NativeSelectOption value="">仅个人能力</NativeSelectOption>
      {workspaces?.items.map(workspace => <NativeSelectOption key={workspace.id} value={workspace.id}>{workspace.name}</NativeSelectOption>)}
      </NativeSelect>
      <FieldDescription>选择项目后列出个人及该项目中已启用的能力。</FieldDescription>
    </Field>
    {workspaces?.next_cursor && <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
      try {
        const next = await client.workspaces({ cursor: workspaces.next_cursor! });
        setWorkspaces(current => ({ ...next, items: Object.values(mergeVersioned(
          Object.fromEntries(current!.items.map(item => [item.id, item])), next.items)) }));
      } catch (error) { setError(windowError(error)); }
    }}>更多能力项目</Button>}
    {confirming && <section aria-label="未保存助理" className="my-3 rounded-control border border-border p-3"><h2>有未保存的助理配置</h2>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => { continuation.current = undefined; setConfirming(false); }}>继续编辑</Button>
        <Button variant="outline" disabled={busy} onClick={() => { for (const form of dirty.current) form.reset(); dirty.current.clear(); setHasChanges(false); const action = continuation.current; continuation.current = undefined; setConfirming(false); action?.(); }}>放弃更改</Button>
        <Button disabled={busy} onClick={() => dirty.current.values().next().value?.requestSubmit()}>保存后继续</Button>
      </div>
    </section>}
    <div onChangeCapture={event => { const form = (event.target as HTMLElement).closest('form'); if (form) { dirty.current.add(form); setHasChanges(true); } }}>
      <AssistantSettings client={client} manageMembers workspaceId={workspaceId || undefined} skillsRevision={skillsRevision} deferSkillRefresh={hasChanges || busy}
        refreshKey={hasChanges || busy ? undefined : refreshKey} guard={guard} onBusyChange={setBusy} onSaved={complete} onViewReady={() => {
          if (root.current && !root.current.contains(document.activeElement)) close.current?.focus();
        }} onDiscard={form => { dirty.current.delete(form); setHasChanges(dirty.current.size > 0); }} />
    </div>
    {error && <p role="alert">{error}</p>}
    {onReturnToQuick && <IconButton icon="quick" label="返回快捷小窗" disabled={busy} onClick={() => guard(() => { void onReturnToQuick().catch(error => setError(windowError(error))); })} />}
  </section>;
}
