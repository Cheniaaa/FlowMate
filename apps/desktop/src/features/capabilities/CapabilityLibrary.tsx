import { useEffect, useMemo, useRef, useState } from 'react';
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

export default function CapabilityLibrary({ client, workspaceId, refreshKey = 0, initialRecovery = false, onClose, onUse,
  mcpTarget, compact, onReturnToQuick, mcpRevision = 0 }: {
  client: RuntimeClient; workspaceId?: string; refreshKey?: number; initialRecovery?: boolean; onClose: () => void;
  onUse?: (version: SkillVersion) => Promise<void>;
  mcpTarget?: { server_id: string | null; workspace_id: string | null };
  compact?: boolean; onReturnToQuick?: () => Promise<void>; mcpRevision?: number;
}) {
  const [tab, setTab] = useState<'skills' | 'mcp'>(mcpTarget ? 'mcp' : 'skills');
  const [target, setTarget] = useState(mcpTarget), consumedTarget = useRef(mcpTarget);
  const mcpClient = useMemo(() => new McpClient(client.connection), [client]);
  const [scope, setScope] = useState<ScopeRef>(workspaceId ? { kind: 'workspace', workspace_id: workspaceId, session_id: null }
    : { kind: 'user_global', workspace_id: null, session_id: null });
  const [query, setQuery] = useState(''), [page, setPage] = useState<SkillPage>(), [selected, select] = useState('');
  const [revision, refresh] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ directory: string; text: string; base?: SkillRecord }>();
  const [candidate, setCandidate] = useState<SkillCandidate>();
  const [recovery, setRecovery] = useState(initialRecovery);
  const [receipts, setReceipts] = useState<SkillExportReceipt[]>();
  const [preview, setPreview] = useState<SkillFileSlice>();
  const [pendingStage, freezeStage] = useState<StageSkillCommand>();
  const [pendingImport, freezeImport] = useState<ImportSkillCommand>();
  const [pendingPublish, freezePublish] = useState<PublishSkillCommand>();
  const pending = useRef(false), root = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null);
  useEffect(() => { setReceipts(undefined); }, [recovery, scope]);
  useEffect(() => {
    if (!recovery) return;
    let ignore = false;
    client.skillExports(skillQuery(scope)).then(value => { if (!ignore) setReceipts(value); })
      .catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, recovery, scope, refreshKey]);
  useEffect(() => {
    if (mcpTarget && mcpTarget !== consumedTarget.current && !busy && !editor && !candidate &&
        !pendingStage && !pendingImport && !pendingPublish) {
      consumedTarget.current = mcpTarget; setTarget(mcpTarget); setTab('mcp');
    }
  }, [mcpTarget, busy, editor, candidate, pendingStage, pendingImport, pendingPublish]);
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
  }, [client, scope, query, revision, refreshKey, tab]);
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
  return <section ref={root} role="dialog" aria-modal="true" aria-label="能力库" className="capability-library"
    onKeyDown={event => {
      if (event.key === 'Escape' && !busy && !editor && !candidate) { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const controls = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(item => item.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <header className="panel-header"><div><h1>能力库</h1><p>管理可复用的方法、参考材料与 MCP 连接。</p></div>
      <button ref={close} disabled={busy || !!editor || !!candidate || !!pendingStage || !!pendingImport || !!pendingPublish} onClick={onClose}>返回对话与草稿</button></header>
    <div role="tablist" aria-label="能力类型">
      <button role="tab" disabled={busy || !!editor || !!candidate || !!pendingStage || !!pendingImport || !!pendingPublish}
        aria-selected={tab === 'skills'} onClick={() => setTab('skills')}>Skills</button>
      <button role="tab" disabled={busy || !!editor || !!candidate || !!pendingStage || !!pendingImport || !!pendingPublish}
        aria-selected={tab === 'mcp'} onClick={() => {
          if (compact) void showWorkbench({ kind: 'mcp', server_id: null, workspace_id: workspaceId ?? null });
          else setTab('mcp');
        }}>MCP</button>
    </div>
    {onReturnToQuick && <button disabled={busy || !!editor || !!candidate || !!pendingStage || !!pendingImport || !!pendingPublish}
      onClick={async () => { await onReturnToQuick(); onClose(); }}>返回快捷小窗</button>}
    {tab === 'mcp' && <McpPanel key={`${target?.workspace_id ?? ''}:${target?.server_id ?? ''}`}
      client={mcpClient} workspaceId={target?.workspace_id ?? workspaceId}
      initialServerId={target?.server_id ?? undefined} refreshKey={mcpRevision}
      initialScope={target ? { kind: target.workspace_id ? 'workspace' : 'user_global',
        workspace_id: target.workspace_id, session_id: null } : undefined} onBusyChange={setBusy} />}
    {tab === 'skills' && <>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy || !!editor || !!candidate || !!pendingStage || !!pendingImport || !!pendingPublish} className="library-toolbar">
      <label>能力范围 <select value={scope.kind} onChange={event => setScope(event.target.value === 'workspace'
        ? { kind: 'workspace', workspace_id: workspaceId!, session_id: null }
        : { kind: 'user_global', workspace_id: null, session_id: null })}>
        <option value="user_global">个人</option>{workspaceId && <option value="workspace">当前项目（含个人）</option>}</select></label>
      <label>搜索 Skills <input value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button onClick={() => { setCandidate(undefined); setEditor({ directory: '', text: '---\nname: \ndescription: \n---\n\n' }); }}>创建 Skill</button>
      <button disabled={!workspaceId} onClick={() => void act(() => importPackage('directory'))}>导入目录</button>
      <button disabled={!workspaceId} onClick={() => void act(() => importPackage('file'))}>导入 ZIP</button>
      <button onClick={() => refresh(value => value + 1)}>刷新目录</button>
      <button onClick={() => setRecovery(value => !value)}>保存记录与恢复</button>
    </fieldset>
    {scope.kind === 'user_global' && <p>导入的项目原生选择将在确认后形成个人副本；原包保持不变。</p>}
    {pendingImport && <button disabled={busy} onClick={() => void act(async () => { setCandidate(await client.importSkill(pendingImport)); freezeImport(undefined); })}>按原命令核对导入</button>}
    {editor && !candidate && <form className="skill-editor" onSubmit={event => { event.preventDefault(); void act(() => stage(pendingStage)); }}>
      <h2>{editor.base ? '编辑为新候选' : '创建标准包候选'}</h2>
      <label>包目录名 <input required value={editor.directory} disabled={busy || !!pendingStage || !!editor.base}
        onChange={event => setEditor({ ...editor, directory: event.target.value })} /></label>
      <label>SKILL.md 原文件 <textarea required rows={14} value={editor.text} disabled={busy || !!pendingStage}
        onChange={event => setEditor({ ...editor, text: event.target.value })} /></label>
      <p>校验只产生候选；编辑保留其余包文件。</p>
      <button disabled={busy}>{pendingStage ? '按原命令核对候选' : '校验候选'}</button>
      <button type="button" disabled={busy || !!pendingStage} onClick={() => setEditor(undefined)}>取消编辑</button>
    </form>}
    {candidate && <section aria-label="待发布 Skill 候选" className="skill-candidate">
      <h2>{candidate.name} · 待发布</h2><p>{candidate.description}</p>
      <p>版本 <code>{candidate.content_hash}</code> · {candidate.files.length} 个文件</p>
      <ul>{candidate.files.map(file => <li key={file.path}>{file.path} · {file.size_bytes} bytes</li>)}</ul>
      {preview?.encoding === 'utf-8' && <pre className="skill-body">{preview.content}</pre>}
      {preview && preview.end < preview.total && <button disabled={busy} onClick={() => void act(async () => {
        const next = await client.skillCandidateFile(candidate.staging_ref, { ...skillQuery(candidate.scope), offset: preview.end });
        setPreview({ ...next, content: preview.content + next.content });
      })}>继续预览候选</button>}
      <button disabled={busy || !preview} onClick={() => void act(publish)}>{pendingPublish ? '按原命令核对发布' : '确认发布此版本'}</button>
      <button disabled={busy || !!pendingPublish} onClick={() => void act(async () => {
        await client.discardSkillCandidate(candidate.staging_ref, { meta: commandMeta(), data: { scope: candidate.scope } }); setCandidate(undefined);
      })}>丢弃候选</button>
    </section>}
    {recovery && <>{!receipts ? <p>正在读取保存记录…</p> : <SkillExportRecovery client={client} scope={scope} receipts={receipts}
      onBusyChange={setBusy} onReceipt={receipt => setReceipts(current => current!.map(item => item.command_id === receipt.command_id ? receipt : item))} />}
      <button disabled={busy} onClick={() => setRecovery(false)}>返回 Skill 列表</button></>}
    {!editor && !candidate && !recovery && <div className="library-layout">
      <aside aria-label="Skill 列表" className="skill-list">{!page && <p>正在读取 Skills…</p>}
        {page?.items.length === 0 && <p>没有匹配的 Skill。</p>}
        {page?.items.map(item => <button className="skill-item" key={item.version.skill_id} aria-pressed={selected === item.version.skill_id}
          onClick={() => select(item.version.skill_id)}><strong>{item.version.name}</strong><p>{item.version.description}</p>
          <small>{item.version.scope.kind === 'user_global' ? '个人' : '项目'} · {item.binding?.enabled ? '已启用' : '未启用'} · {item.version.content_hash.slice(0, 12)}</small></button>)}
        {page?.next_cursor && <button disabled={busy} onClick={() => void act(async () => { const next = await client.skills({ ...skillQuery(scope), query, cursor: page.next_cursor! }); setPage({ ...next, items: [...page.items, ...next.items] }); })}>更多 Skills</button>}
      </aside>
      {view && <SkillDetail key={`${view.version.skill_id}:${scope.kind}`} client={client} view={view} scope={scope} workspaceId={workspaceId} refreshKey={refreshKey}
        onChanged={() => refresh(value => value + 1)} onUse={onUse} onEdit={async () => {
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
