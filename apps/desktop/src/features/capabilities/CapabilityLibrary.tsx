import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { showWorkbench, windowError } from '../../api/windows';
import { McpClient } from '../../api/mcp';
import McpPanel from './McpPanel';
import { validate } from '../../api/validation';
import type { SkillCandidate, SkillPage, SkillVersion, SkillRecord, ScopeRef, StageSkillCommand, PublishSkillCommand, ImportSkillCommand, SkillFileSlice, SkillExportReceipt } from '../../generated/contracts';
import SkillDetail from './SkillDetail';
import { skillQuery } from './skill-query';
import SkillExportRecovery from './SkillExportRecovery';
import { Button } from '../../components/ui/button';
import { FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { Textarea } from '../../components/ui/textarea';
import IconButton, { UiIcon } from '../../components/IconButton';
import { useSkillExportReceipts } from './useSkillExportReceipts';
import { deferredSkillExports, forgetSkillExport, rememberSkillExport, watchDeferredSkillExports } from './deferred-skill-exports';
import { cn } from '../../lib/utils';

export default function CapabilityLibrary({ client, workspaceId, refreshKey = 0, initialRecovery = false, onClose, onUse, useInDraft,
  mcpTarget, initialMcpScope, compact, embedded, navigationGuard, onReturnToQuick, mcpRevision = 0 }: {
  client: RuntimeClient; workspaceId?: string; refreshKey?: number; initialRecovery?: boolean; onClose: () => void;
  onUse?: (version: SkillVersion, permissionId?: string) => Promise<void>;
  useInDraft?: boolean;
  mcpTarget?: { server_id: string | null; workspace_id: string | null };
  initialMcpScope?: ScopeRef;
  compact?: boolean; onReturnToQuick?: () => Promise<void>; mcpRevision?: number;
  embedded?: boolean; navigationGuard?: Ref<(action: () => void) => void>;
}) {
  const [tab, setTab] = useState<'skills' | 'mcp'>(mcpTarget ? 'mcp' : 'skills');
  const [target, setTarget] = useState(mcpTarget), consumedTarget = useRef(mcpTarget);
  const mcpClient = useMemo(() => new McpClient(client.connection), [client]);
  const [scope, setScope] = useState<ScopeRef>(workspaceId ? { kind: 'workspace', workspace_id: workspaceId, session_id: null }
    : { kind: 'user_global', workspace_id: null, session_id: null });
  const mcpScope: ScopeRef = target ? { kind: target.workspace_id ? 'workspace' : 'user_global',
    workspace_id: target.workspace_id, session_id: null } : initialMcpScope ?? (workspaceId
      ? { kind: 'workspace', workspace_id: workspaceId, session_id: null }
      : { kind: 'user_global', workspace_id: null, session_id: null });
  const [query, setQuery] = useState(''), [page, setPage] = useState<SkillPage>(), [selected, select] = useState('');
  const [revision, refresh] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
  const locked = busy || childBusy;
  const [observedRefresh, setObservedRefresh] = useState(refreshKey);
  const [editor, setEditor] = useState<{ directory: string; text: string; base?: SkillRecord }>();
  const [candidate, setCandidate] = useState<SkillCandidate>();
  const [recovery, setRecovery] = useState(initialRecovery);
  const [locatedReceipt, setLocatedReceipt] = useState<SkillExportReceipt>();
  const recoveryVisible = recovery && tab === 'skills';
  const [storageRevision, setStorageRevision] = useState(0);
  const { receipts, install, error: receiptError } = useSkillExportReceipts(client, scope, `${refreshKey}:${storageRevision}`, undefined, recoveryVisible);
  const [deferredRevision, setDeferredRevision] = useState(0);
  const deferred = useMemo(() => deferredSkillExports(workspaceId, scope), [workspaceId, scope, deferredRevision, recoveryVisible, storageRevision]);
  useEffect(() => {
    if (!workspaceId) return;
    const reread = () => setStorageRevision(value => value + 1);
    const unwatch = watchDeferredSkillExports(workspaceId, scope, reread);
    if (recoveryVisible) window.addEventListener('focus', reread);
    return () => {
      unwatch();
      if (recoveryVisible) window.removeEventListener('focus', reread);
    };
  }, [workspaceId, scope, recoveryVisible]);
  useEffect(() => {
    if (!workspaceId || !receipts) return;
    const resolved = deferred.filter(entry => receipts.some(receipt => receipt.command_id === entry.command.meta.command_id));
    if (!resolved.length) return;
    for (const entry of resolved) forgetSkillExport(workspaceId, scope, entry.command.meta.command_id!);
    setDeferredRevision(value => value + 1);
  }, [workspaceId, scope, receipts, deferred]);
  const [preview, setPreview] = useState<SkillFileSlice>();
  const [pendingStage, freezeStage] = useState<StageSkillCommand>();
  const [pendingImport, freezeImport] = useState<ImportSkillCommand>();
  const [pendingPublish, freezePublish] = useState<PublishSkillCommand>();
  const navigationLocked = locked || !!editor || !!candidate || !!pendingStage || !!pendingImport || !!pendingPublish;
  useImperativeHandle(navigationGuard, () => action => { if (!navigationLocked) action(); });
  const pending = useRef(false), root = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!locked && !editor && !candidate && !pendingStage && !pendingImport && !pendingPublish) setObservedRefresh(refreshKey);
  }, [locked, editor, candidate, pendingStage, pendingImport, pendingPublish, refreshKey]);
  useEffect(() => {
    if (mcpTarget && mcpTarget !== consumedTarget.current && !locked && !editor && !candidate &&
        !pendingStage && !pendingImport && !pendingPublish) {
      consumedTarget.current = mcpTarget; setTarget(mcpTarget); setTab('mcp');
    }
  }, [mcpTarget, locked, editor, candidate, pendingStage, pendingImport, pendingPublish]);
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => {
    let ignore = false; setPreview(undefined);
    if (candidate) client.skillCandidateFile(candidate.staging_ref, skillQuery(candidate.scope))
      .then(value => { if (!ignore) setPreview(value); }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, candidate]);
  useEffect(() => {
    setPage(undefined);
  }, [scope, query]);
  useEffect(() => {
    if (tab !== 'skills') return;
    let ignore = false; setError('');
    client.skills({ ...skillQuery(scope), query }).then(value => { if (!ignore) { setPage(value); select(current => value.items.some(item => item.version.skill_id === current) ? current : value.items[0]?.version.skill_id ?? ''); } })
      .catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, scope, query, revision, observedRefresh, tab]);
  async function act(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        freezeStage(undefined); freezeImport(undefined); freezePublish(undefined);
      }
      setError(windowError(error));
    }
    finally { pending.current = false; setBusy(false); }
  }
  const view = page?.items.find(item => item.version.skill_id === selected);
  async function stage(command?: StageSkillCommand) {
    const request = command ?? { meta: commandMeta(), data: { scope: editor!.base?.scope ?? scope, directory_name: editor!.directory, files: { 'SKILL.md': editor!.text },
      skill_id: editor!.base?.skill_id ?? null, base_hash: editor!.base?.current_hash ?? null } };
    freezeStage(request); const value = await client.stageSkill(request); setCandidate(value); freezeStage(undefined);
  }
  async function importPackage(kind: 'file' | 'directory') {
    const raw = await invoke<{ resources: unknown[] }>('select_skill_package', { scope: { kind: 'workspace', workspace_id: workspaceId, session_id: null }, kind });
    if (!raw.resources.length) return;
    const resource = validate('ResourceRef', raw.resources[0]);
    const command = { meta: commandMeta(), data: { scope, selection_id: resource.id, skill_id: null, base_hash: null } };
    freezeImport(command); setCandidate(await client.importSkill(command)); freezeImport(undefined);
  }
  async function publish() {
    const command = pendingPublish ?? { meta: commandMeta(editor?.base?.revision ?? null),
      data: { scope: candidate!.scope, staging_ref: candidate!.staging_ref, confirmed_hash: candidate!.content_hash } };
    freezePublish(command);
    const version = await client.publishSkill(command);
    freezePublish(undefined); setCandidate(undefined); setEditor(undefined); select(version.skill_id); refresh(value => value + 1);
  }
  return <section ref={root} role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-label="能力库"
    className={cn('capability-library', embedded && 'workbench-page ui-page-motion')}
    onKeyDown={event => {
       if (event.defaultPrevented || !root.current?.contains(event.target as Node)) return;
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !navigationLocked) { event.preventDefault(); onClose(); }
       if (!embedded && event.key === 'Tab') {
        const controls = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(item => item.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
     <header className="panel-header"><h1>能力库</h1>
        <IconButton ref={close} icon={embedded ? 'back' : 'close'} size="icon-sm" label="返回对话与草稿" disabled={navigationLocked} onClick={onClose} /></header>
     <div role="tablist" aria-label="能力类型" className="capability-tabs">
        <Button role="tab" variant="ghost" disabled={locked || !!editor || !!candidate || !!pendingStage || !!pendingImport || !!pendingPublish}
         aria-selected={tab === 'skills'} onClick={() => setTab('skills')}>Skills</Button>
        <Button role="tab" variant="ghost" disabled={locked || !!editor || !!candidate || !!pendingStage || !!pendingImport || !!pendingPublish}
        aria-selected={tab === 'mcp'} onClick={() => {
          if (compact) void showWorkbench({ kind: 'mcp', server_id: null, workspace_id: mcpScope.workspace_id });
          else setTab('mcp');
         }}>MCP</Button>
    </div>
      {onReturnToQuick && <IconButton icon="quick" label="返回快捷小窗" disabled={locked || !!editor || !!candidate || !!pendingStage || !!pendingImport || !!pendingPublish}
       onClick={async () => { await onReturnToQuick(); onClose(); }} />}
    {tab === 'mcp' && <McpPanel key={`${mcpScope.workspace_id ?? ''}:${target?.server_id ?? ''}`}
      client={mcpClient} workspaceId={target?.workspace_id ?? workspaceId}
      initialServerId={target?.server_id ?? undefined} refreshKey={mcpRevision}
      initialScope={mcpScope} onBusyChange={setBusy} />}
    {tab === 'skills' && <>
    {error && <p role="alert">{error}</p>}
     <fieldset disabled={locked || !!editor || !!candidate || !!pendingStage || !!pendingImport || !!pendingPublish} className="library-toolbar">
       <FieldLabel>能力范围 <NativeSelect value={scope.kind} onChange={event => {
         setLocatedReceipt(undefined);
         setScope(event.target.value === 'workspace'
           ? { kind: 'workspace', workspace_id: workspaceId!, session_id: null }
           : { kind: 'user_global', workspace_id: null, session_id: null });
       }}>
         <NativeSelectOption value="user_global">个人</NativeSelectOption>
         {workspaceId && <NativeSelectOption value="workspace">当前项目（含个人）</NativeSelectOption>}
       </NativeSelect></FieldLabel>
      <FieldLabel>搜索 Skills <Input value={query} onChange={event => setQuery(event.target.value)} /></FieldLabel>
        <Button type="button" variant="default" onClick={() => { setCandidate(undefined); setEditor({ directory: '', text: '---\nname: \ndescription: \n---\n\n' }); }}><UiIcon name="add" />创建 Skill</Button>
       <Button disabled={!workspaceId} onClick={() => void act(() => importPackage('directory'))}>导入目录</Button>
       <Button disabled={!workspaceId} onClick={() => void act(() => importPackage('file'))}>导入 ZIP</Button>
        <IconButton icon="refresh" label="刷新目录" onClick={() => refresh(value => value + 1)} />
        <Button aria-expanded={recovery} onClick={() => { setLocatedReceipt(undefined); setRecovery(value => !value); }}>保存记录与恢复</Button>
        {!recovery && deferred.length > 0 && <span className="text-sm text-muted-foreground">{deferred.length} 项保存结果待核对</span>}
    </fieldset>
    {scope.kind === 'user_global' && <p>导入的项目原生选择将在确认后形成个人副本；原包保持不变。</p>}
    {pendingImport && <Button type="button" disabled={busy} onClick={() => void act(async () => { setCandidate(await client.importSkill(pendingImport)); freezeImport(undefined); })}>按原命令核对导入</Button>}
    {editor && !candidate && <form className="skill-editor" onSubmit={event => { event.preventDefault(); void act(() => stage(pendingStage)); }}>
      <h2>{editor.base ? '编辑为新候选' : '创建标准包候选'}</h2>
      <FieldLabel>包目录名 <Input required value={editor.directory} disabled={busy || !!pendingStage || !!editor.base}
        onChange={event => setEditor({ ...editor, directory: event.target.value })} /></FieldLabel>
      <FieldLabel>SKILL.md 原文件 <Textarea required rows={14} value={editor.text} disabled={busy || !!pendingStage}
        onChange={event => setEditor({ ...editor, text: event.target.value })} /></FieldLabel>
      <p>校验只产生候选；编辑保留其余包文件。</p>
       <Button type="submit" variant="default" disabled={busy}>{pendingStage ? '按原命令核对候选' : '校验候选'}</Button>
       <Button disabled={busy || !!pendingStage} onClick={() => setEditor(undefined)}>取消编辑</Button>
    </form>}
    {candidate && <section aria-label="待发布 Skill 候选" className="skill-candidate">
      <h2>{candidate.name} · 待发布</h2><p>{candidate.description}</p>
       <p>{candidate.metadata.version && `声明版本：${candidate.metadata.version} · `}{candidate.files.length} 个文件</p>
      <ul>{candidate.files.map(file => <li key={file.path}>{file.path} · {file.size_bytes} bytes</li>)}</ul>
      {preview?.encoding === 'utf-8' && <pre className="skill-body">{preview.content}</pre>}
      {preview && preview.end < preview.total && <Button type="button" disabled={busy} onClick={() => void act(async () => {
        const next = await client.skillCandidateFile(candidate.staging_ref, { ...skillQuery(candidate.scope), offset: preview.end });
        setPreview({ ...next, content: preview.content + next.content });
      })}>继续预览候选</Button>}
      <Button type="button" variant="default" disabled={busy || !preview} onClick={() => void act(publish)}>{pendingPublish ? '按原命令核对发布' : '确认发布此版本'}</Button>
      <Button type="button" disabled={busy || !!pendingPublish} onClick={() => void act(async () => {
        await client.discardSkillCandidate(candidate.staging_ref, { meta: commandMeta(), data: { scope: candidate.scope } }); setCandidate(undefined);
      })}>丢弃候选</Button>
    </section>}
    {recovery && <>{receiptError && <p role="alert">读取保存记录失败。</p>}
       {(receipts || deferred.length > 0) && <SkillExportRecovery key={`${scope.kind}:${scope.workspace_id ?? ''}`}
         client={client} scope={scope} receipts={receipts ?? []} deferred={deferred} locatedReceipt={locatedReceipt}
         onBusyChange={setBusy} onReceipt={install} onDeferredReceipt={receipt => { install(receipt); setLocatedReceipt(receipt); }} />}
       {!receipts && !receiptError && <p>正在读取保存记录…</p>}
       <IconButton icon="back" size="icon-sm" label="返回 Skill 列表" disabled={busy} onClick={() => { setLocatedReceipt(undefined); setRecovery(false); }} /></>}
    {!editor && !candidate && !recovery && <div className="library-layout">
      <aside aria-label="Skill 列表" className="skill-list">{!page && <p>正在读取 Skills…</p>}
        {page?.items.length === 0 && <p>没有匹配的 Skill。</p>}
         {page?.items.map(item => <Button type="button" disabled={locked} variant={selected === item.version.skill_id ? 'secondary' : 'ghost'} className="capability-card skill-card"
           key={item.version.skill_id} aria-pressed={selected === item.version.skill_id} onClick={() => select(item.version.skill_id)}>
           <strong title={item.version.name}>{item.version.name}</strong>
           <span className="text-xs text-muted-foreground">
             {item.version.scope.kind === 'user_global' ? '个人' : '项目'} · {item.binding?.enabled ? '已启用' : '未启用'}
             {item.readiness !== 'content_available' && ' · 来源不可用'}
           </span>
         </Button>)}
        {page?.next_cursor && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void act(async () => { const next = await client.skills({ ...skillQuery(scope), query, cursor: page.next_cursor! }); setPage({ ...next, items: [...page.items, ...next.items] }); })}>更多 Skills</Button>}
      </aside>
       {view && <SkillDetail key={`${view.version.skill_id}:${scope.kind}`} client={client} view={view} scope={scope} workspaceId={workspaceId} refreshKey={observedRefresh}
          onLocateExport={receipt => { install(receipt); setLocatedReceipt(receipt); setRecovery(true); }}
          onDeferExport={workspaceId ? draft => { rememberSkillExport(workspaceId, draft); onClose(); } : undefined}
         onBusyChange={setChildBusy} onChanged={() => refresh(value => value + 1)} onUse={onUse} useInDraft={useInDraft} onEdit={async () => {
          await act(async () => {
            const record = await client.skillRecord(view.version.skill_id, skillQuery(view.version.scope));
            let text = '', offset = 0, total = 1;
            while (offset < total) { const part = await client.skillFile(view.version.skill_id, view.version.content_hash, { ...skillQuery(view.version.scope), offset, limit: 16000 });
              if (part.encoding !== 'utf-8') throw new Error('SKILL.md 不是可编辑的 UTF-8 内容');
              text += part.content; offset = part.end; total = part.total; }
            setEditor({ directory: view.version.directory_name, text, base: record });
          });
        }} />}
    </div>}
    </>}
  </section>;
}
