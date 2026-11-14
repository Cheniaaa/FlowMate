import { useEffect, useRef, useState, type ReactNode } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { checkWorkspaceDirectoryCommand, createWorkspaceFromDirectory, retryWorkspaceFromDirectory, windowError } from '../../api/windows';
import { mergeVersioned } from '../../api/events';
import type { CommandMeta, InboxPage, NavigationView, RunPage, SessionPage, Workspace, WorkspaceDirectoryResult } from '../../generated/contracts';
import Status from '../../components/Status';

export interface ProjectNavigation { workspaceId: string; sessionId?: string; runId?: string }
export default function ProjectSidebar({ client, onNavigate, onCreated, onSettings, children, allowDirectoryCreation = true, onDefaultWorkspace, onNewSession, deletedWorkspaceIds = [], deletedSessionIds = [], onFormActiveChange }: {
  client: RuntimeClient; onNavigate: (target: ProjectNavigation) => void; onCreated: (workspace: Workspace) => void;
  onSettings: () => void; children?: ReactNode;
  allowDirectoryCreation?: boolean; onDefaultWorkspace?: (id: string | null) => void;
  onNewSession?: () => void;
  deletedWorkspaceIds?: readonly string[]; deletedSessionIds?: readonly string[];
  onFormActiveChange?: (active: boolean) => void;
}) {
  const [navigation, setNavigation] = useState<NavigationView>();
  const [section, setSection] = useState<'projects' | 'recent' | 'tasks' | 'inbox'>('projects');
  const [recent, setRecent] = useState<SessionPage>();
  const [tasks, setTasks] = useState<RunPage>();
  const [inbox, setInbox] = useState<InboxPage>();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('flowmate.sidebar.collapsed') === 'true');
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [frozen, setFrozen] = useState<{ name: string; meta: CommandMeta }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const formActive = creating || !!name || !!frozen || busy;
  useEffect(() => { onFormActiveChange?.(formActive); }, [formActive, onFormActiveChange]);
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const deletionKey = [...deletedWorkspaceIds, ...deletedSessionIds].join(',');
  const visible = (workspaceId: string, sessionId?: string) => !deletedWorkspaceIds.includes(workspaceId) && (!sessionId || !deletedSessionIds.includes(sessionId));
  useEffect(() => {
    let ignore = false; setNavigation(undefined);
    client.navigation().then(value => { if (!ignore) { setNavigation(value); onDefaultWorkspace?.(value.default_workspace_id && visible(value.default_workspace_id) ? value.default_workspace_id : null); } }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, deletionKey]);
  async function act(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) { setError(windowError(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  function navigate(target: ProjectNavigation) { onNavigate(target); setDrawer(false); }
  async function open(next: typeof section) {
    setCollapsed(false); localStorage.setItem('flowmate.sidebar.collapsed', 'false'); setSection(next);
    if (next === 'recent') setRecent(await client.recentSessions());
    if (next === 'tasks') setTasks(await client.globalTasks());
    if (next === 'inbox') setInbox(await client.inbox());
  }
  function installed(value: WorkspaceDirectoryResult | null) {
    if (!value) { setFrozen(undefined); return; }
    onCreated(value.workspace); navigate({ workspaceId: value.workspace.id }); setFrozen(undefined); setCreating(false); setName('');
  }
  return <>
    <button ref={drawerToggle} className="sidebar-drawer-toggle" aria-label="打开项目导航" onClick={() => setDrawer(value => !value)}>☰</button>
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${drawer ? 'sidebar--open' : ''}`} aria-label="项目导航" onKeyDown={event => { if (event.key === 'Escape' && drawer) { setDrawer(false); drawerToggle.current?.focus(); } }}>
      {drawer && <button className="sidebar-drawer-close" aria-label="关闭项目导航" onClick={() => { setDrawer(false); drawerToggle.current?.focus(); }}>×</button>}
      <header className="sidebar-brand"><span className="brand-mark" aria-hidden="true">F</span><strong>FlowMate</strong><button aria-label={collapsed ? '展开侧栏' : '折叠侧栏'} onClick={() => {
        setCollapsed(!collapsed); localStorage.setItem('flowmate.sidebar.collapsed', String(!collapsed));
      }}>{collapsed ? '›' : '‹'}</button></header>
      <nav className="global-navigation">
        <button aria-label="新建会话" title="新建会话" onClick={() => { setCollapsed(false); onNewSession?.(); }}><span>＋</span><span>新建会话</span></button>
        <button title="日常助理" aria-label="日常助理" disabled={!navigation?.default_workspace_id || !visible(navigation.default_workspace_id)} onClick={() => navigate({ workspaceId: navigation!.default_workspace_id! })}><span>✦</span><span>日常助理</span></button>
        <button title="最近创建" aria-label="最近创建" aria-pressed={section === 'recent'} onClick={() => void act(() => open('recent'))}><span>◷</span><span>最近创建</span></button>
        <button title="待办" aria-pressed={section === 'inbox'} onClick={() => void act(() => open('inbox'))}><span>☷</span><span>待办 {navigation?.pending_count ?? ''}</span></button>
        <button title="任务" aria-pressed={section === 'tasks'} onClick={() => void act(() => open('tasks'))}><span>◇</span><span>任务</span></button>
      </nav>
      <div className="sidebar-content">
        <div className="sidebar-section-heading"><button onClick={() => setSection('projects')}>项目</button><button aria-label="新建项目" onClick={() => setCreating(value => !value)}>＋</button></div>
        {error && <p role="alert">{error}</p>}
        {creating && <form className="project-create" onSubmit={event => { event.preventDefault(); void act(async () => {
          const workspace = await client.createWorkspace({ meta: commandMeta(), data: { name } }); onCreated(workspace); navigate({ workspaceId: workspace.id }); setCreating(false); setName('');
        }); }}><label>项目名称 <input required value={name} disabled={!!frozen || busy} onChange={event => setName(event.target.value)} /></label>
          <button disabled={busy || !!frozen}>创建项目</button>{allowDirectoryCreation && <button type="button" disabled={busy || !name.trim() || !!frozen} onClick={() => void act(async () => {
            const command = { name, meta: commandMeta() }; setFrozen(command); installed(await createWorkspaceFromDirectory(command.name, command.meta));
          })}>从目录创建</button>}
          {frozen && <><p>目录创建结果待核对；查不到不表示未提交。</p><button type="button" disabled={busy} onClick={() => void act(async () => {
            const result = await checkWorkspaceDirectoryCommand(frozen.meta.command_id!); if (result.status === 'confirmed') installed(result.result);
          })}>核对目录创建</button><button type="button" disabled={busy} onClick={() => void act(async () => installed(await retryWorkspaceFromDirectory(frozen.name, frozen.meta)))}>重试目录创建</button></>}
        </form>}
        {section === 'projects' && navigation?.workspaces.items.filter(item => visible(item.workspace.id)).map(item => <section className="project-group" key={item.workspace.id}>
          <button className="project-name" onClick={() => navigate({ workspaceId: item.workspace.id })}>▱ {item.workspace.name}<span>{item.pending_count || ''}</span></button>
          {item.sessions.items.filter(session => visible(session.workspace_id, session.id)).map(session => <button className="session-nav" key={session.id} onClick={() => navigate({ workspaceId: session.workspace_id, sessionId: session.id })}>{session.title}</button>)}
          {item.sessions.next_cursor && <button onClick={() => void act(async () => { const next = await client.sessions(item.workspace.id, { cursor: item.sessions.next_cursor! }); setNavigation(current => current && ({ ...current, workspaces: { ...current.workspaces, items: current.workspaces.items.map(value => value.workspace.id === item.workspace.id ? { ...value, sessions: { ...next, items: Object.values(mergeVersioned(Object.fromEntries(value.sessions.items.map(session => [session.id, session])), next.items)) } } : value) } })); })}>更多项目会话</button>}
        </section>)}
        {section === 'projects' && navigation?.workspaces.next_cursor && <button onClick={() => void act(async () => { const next = await client.navigation({ cursor: navigation.workspaces.next_cursor! }); setNavigation(current => ({ ...next, workspaces: { ...next.workspaces, items: [...current!.workspaces.items, ...next.workspaces.items] } })); })}>更多项目</button>}
        {section === 'recent' && <section aria-label="最近创建会话"><h2>最近创建</h2>{recent?.items.filter(session => visible(session.workspace_id, session.id)).map(session => <button key={session.id} onClick={() => navigate({ workspaceId: session.workspace_id, sessionId: session.id })}>{session.title}</button>)}
          {recent?.next_cursor && <button onClick={() => void act(async () => { const next = await client.recentSessions({ cursor: recent.next_cursor! }); setRecent({ ...next, items: [...recent.items, ...next.items] }); })}>更多最近创建</button>}</section>}
        {section === 'tasks' && <section aria-label="全局任务"><h2>任务</h2>{tasks?.items.filter(run => visible(run.workspace_id, run.session_id)).map(run => <button key={run.id} onClick={() => navigate({ workspaceId: run.workspace_id, sessionId: run.session_id, runId: run.id })}>{run.output?.summary ?? `任务 ${run.id.slice(0, 8)}`} <Status state={run.state} /></button>)}
          {tasks?.next_cursor && <button onClick={() => void act(async () => { const next = await client.globalTasks({ cursor: tasks.next_cursor! }); setTasks({ ...next, items: [...tasks.items, ...next.items] }); })}>更多全局任务</button>}</section>}
        {section === 'inbox' && <section aria-label="全局待办"><h2>待办</h2>{inbox?.items.filter(item => visible(item.workspace_id, item.session_id)).map(item => <button key={item.kind === 'question' ? item.question.id : item.approval.id} onClick={() => navigate({ workspaceId: item.workspace_id, sessionId: item.session_id, runId: item.run_id })}>{item.kind === 'question' ? item.question.question : item.approval.export_preview?.target_path ?? item.approval.tool_name}</button>)}
          {inbox?.next_cursor && <button onClick={() => void act(async () => { const next = await client.inbox({ cursor: inbox.next_cursor! }); setInbox({ ...next, items: [...inbox.items, ...next.items] }); })}>更多全局待办</button>}</section>}
        {children}
      </div><footer className="sidebar-footer"><button title="设置" onClick={onSettings}>⚙ <span>设置</span></button><button title="刷新导航" aria-label="刷新导航" disabled={busy} onClick={() => void act(async () => setNavigation(await client.navigation()))}>↻</button></footer>
    </aside>
  </>;
}
