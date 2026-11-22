import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import { laterCursor, mergeVersioned } from '../../api/events';
import type { InboxPage, NavigationView, PendingAction, Session, SessionPage, Workspace } from '../../generated/contracts';
import { PendingActionList } from '../notifications/Inbox';
import IconButton, { UiIcon } from '../../components/IconButton';
import Dialog from '../../components/Dialog';
import { Button } from '../../components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '../../components/ui/sheet';
import ProjectNameForm from './ProjectNameForm';

export interface ProjectNavigation { workspaceId: string; sessionId?: string; runId?: string }

function mergeNavigation(current: NavigationView | undefined, incoming: NavigationView, append = false): NavigationView {
  if (!current) return incoming;
  const newer = BigInt(incoming.watermark) >= BigInt(current.watermark);
  const items = new Map(current.workspaces.items.map(item => [item.workspace.id, item]));
  const incomingIds = new Set(incoming.workspaces.items.map(item => item.workspace.id));
  for (const item of incoming.workspaces.items) {
    const previous = items.get(item.workspace.id);
    if (!previous) items.set(item.workspace.id, item);
    else if (newer) items.set(item.workspace.id, { ...item, sessions: { ...previous.sessions,
      items: Object.values(mergeVersioned(Object.fromEntries(previous.sessions.items.map(session => [session.id, session])), item.sessions.items)),
      watermark: laterCursor(previous.sessions.watermark, item.sessions.watermark),
      next_cursor: previous.sessions.items.some(session => !item.sessions.items.some(value => value.id === session.id))
        ? previous.sessions.next_cursor : item.sessions.next_cursor,
    } });
  }
  return { ...(newer ? incoming : current), workspaces: { ...current.workspaces, items: [...items.values()],
    watermark: laterCursor(current.workspaces.watermark, incoming.workspaces.watermark),
    next_cursor: append || newer && current.workspaces.items.every(item => incomingIds.has(item.workspace.id))
      ? incoming.workspaces.next_cursor : current.workspaces.next_cursor,
  } };
}

export default function ProjectSidebar({ client, onNavigate, onCreated, onSettings, children, renderScopeActions, allowDirectoryCreation = true, onDefaultWorkspace, onNewSession, deletedWorkspaceIds = [], deletedSessionIds = [], onFormActiveChange, onTaskCenter, onAssistants, onMemory, onCapabilities, onPendingOpen, onPendingAction, onOpenInbox, refreshKey, workspaceId, sessionId, activePage, drawerToggleRef, sessionVersions }: {
  client: RuntimeClient; onNavigate: (target: ProjectNavigation) => void; onCreated: (workspace: Workspace) => void;
  onSettings: () => void; children?: ReactNode;
  renderScopeActions?: (target: Session | Workspace, createSession?: (trigger: HTMLButtonElement) => void) => ReactNode;
  allowDirectoryCreation?: boolean; onDefaultWorkspace?: (id: string | null) => void;
  onNewSession?: (workspaceId?: string, returnFocus?: () => void) => void; workspaceId?: string; sessionId?: string;
  deletedWorkspaceIds?: readonly string[]; deletedSessionIds?: readonly string[];
  onFormActiveChange?: (active: boolean) => void;
  onTaskCenter?: () => void; onPendingOpen?: (item: InboxPage['items'][number], returnToInbox: () => void) => void;
  onAssistants?: () => void;
  onMemory?: () => void;
  onCapabilities?: () => void;
  onPendingAction?: (item: PendingAction, action: PendingAction['allowed_actions'][number], returnToInbox: () => void) => Promise<unknown>;
  onOpenInbox?: (open: () => void) => void;
  refreshKey?: string;
  activePage?: 'tasks' | 'assistants' | 'memory' | 'capabilities';
  drawerToggleRef?: React.RefObject<HTMLButtonElement | null>;
  sessionVersions?: Readonly<Record<string, Session>>;
}) {
  const [navigation, setNavigation] = useState<NavigationView>();
  const navigationClient = useRef(client);
  const navigationCursors = useRef<string[]>([]);
  const [section, setSection] = useState<'projects' | 'recent'>('projects');
  const [recent, setRecent] = useState<SessionPage>();
  const [inbox, setInbox] = useState<InboxPage>();
  const [inboxOpen, setInboxOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('flowmate.sidebar.collapsed') === 'true');
  const [foldedProjects, setFoldedProjects] = useState<Set<string>>(() => new Set());
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const formActive = creating || busy;
  useEffect(() => { onFormActiveChange?.(formActive); }, [formActive, onFormActiveChange]);
  const localDrawerToggle = useRef<HTMLButtonElement>(null);
  const drawerToggle = drawerToggleRef ?? localDrawerToggle;
  const inboxTrigger = useRef<HTMLButtonElement>(null);
  const inboxOrigin = useRef<HTMLButtonElement | null>(null);
  const inboxDismissed = useRef(false);
  const sheetTransfer = useRef(false);
  const projectPlus = useRef<HTMLButtonElement>(null);
  function newSession(target: string | undefined, trigger: HTMLButtonElement) {
    onNewSession?.(target, () => {
      if (trigger.isConnected) trigger.focus();
      else drawerToggle.current?.focus();
    });
    setDrawer(false);
  }
  const deletionKey = [...deletedWorkspaceIds, ...deletedSessionIds].join(',');
  const visible = (workspaceId: string, sessionId?: string) => !deletedWorkspaceIds.includes(workspaceId) && (!sessionId || !deletedSessionIds.includes(sessionId));
  function displayedSession(session: Session) {
    const latest = sessionVersions?.[session.id];
    return latest && latest.version > session.version ? latest : session;
  }
  async function readNavigation() {
    // 重读已加载项目页，尾页项目徽标也来自同一权威查询；不重置用户的续页位置。
    const pages = await Promise.all([client.navigation(), ...navigationCursors.current.map(cursor => client.navigation({ cursor }))]);
    return pages.sort((a, b) => BigInt(a.watermark) < BigInt(b.watermark) ? -1 : BigInt(a.watermark) > BigInt(b.watermark) ? 1 : 0);
  }
  useEffect(() => {
    let ignore = false;
    if (navigationClient.current !== client) {
      navigationClient.current = client; navigationCursors.current = []; setNavigation(undefined);
    }
    readNavigation().then(pages => {
      if (ignore) return;
      setNavigation(current => pages.reduce((value, page) => mergeNavigation(value, page), current));
      const latest = pages[pages.length - 1];
      onDefaultWorkspace?.(latest.default_workspace_id && visible(latest.default_workspace_id) ? latest.default_workspace_id : null);
    }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, deletionKey, refreshKey]);
  useEffect(() => {
    if (!inboxOpen) return;
    let ignore = false;
    client.inbox({ limit: 50 }).then(value => { if (!ignore) setInbox(value); }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, inboxOpen, refreshKey]);
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
  }
  function showInbox(trigger: HTMLButtonElement) {
    inboxOrigin.current = drawer ? drawerToggle.current : trigger;
    if (drawer) sheetTransfer.current = true;
    inboxDismissed.current = false;
    setError(''); setDrawer(false); setInboxOpen(true);
  }
  function requestInbox(trigger: HTMLButtonElement) {
    if (drawer) {
      sheetTransfer.current = true;
      setDrawer(false);
    }
    const openInbox = () => showInbox(trigger);
    if (onOpenInbox) onOpenInbox(openInbox);
    else openInbox();
  }
  function reopenInbox() { setInboxOpen(true); }
  const sidebar = <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${drawer ? 'sidebar--open' : ''}`} aria-label="项目导航">
      {drawer && <IconButton className="sidebar-drawer-close" icon="close" label="关闭项目导航" onClick={() => { setDrawer(false); drawerToggle.current?.focus(); }} />}
      <header className="sidebar-brand"><span className="brand-mark" aria-hidden="true">F</span><strong>FlowMate</strong>{!drawer && <IconButton icon={collapsed ? 'openSidebar' : 'closeSidebar'} label={collapsed ? '展开侧栏' : '折叠侧栏'} aria-expanded={!collapsed} onClick={() => {
        setCollapsed(!collapsed); localStorage.setItem('flowmate.sidebar.collapsed', String(!collapsed));
      }} />}</header>
      <nav className="global-navigation">
        <Button variant="ghost" size="sm" className="justify-start" aria-label="新建会话" title="新建会话" onClick={event => { setCollapsed(false); newSession(workspaceId || navigation?.default_workspace_id || undefined, event.currentTarget); }}><UiIcon name="newSession" /><span>新建会话</span></Button>
        <Button variant="ghost" size="sm" className="justify-start" title="日常助理" aria-label="日常助理" disabled={!navigation?.default_workspace_id || !visible(navigation.default_workspace_id)} onClick={() => navigate({ workspaceId: navigation!.default_workspace_id! })}><UiIcon name="assistant" /><span>日常助理</span></Button>
        <Button variant="ghost" size="sm" className="justify-start" title="最近创建" aria-label="最近创建" aria-pressed={section === 'recent'} onClick={() => void act(() => open('recent'))}><UiIcon name="recent" /><span>最近创建</span></Button>
        <Button variant="ghost" size="sm" className="justify-start" ref={inboxTrigger} title="待办" aria-label={`待办 ${navigation?.pending_count ?? ''}`.trim()} aria-haspopup="dialog" onClick={event => requestInbox(event.currentTarget)}><UiIcon name="inbox" /><span>待办 {navigation?.pending_count ?? ''}</span></Button>
        <Button variant="ghost" size="sm" className="justify-start" title="任务" aria-label="任务" aria-pressed={activePage === 'tasks'} onClick={() => { onTaskCenter?.(); setDrawer(false); }}><UiIcon name="tasks" /><span>任务中心</span></Button>
        <Button variant="ghost" size="sm" className="justify-start" title="我的助理" aria-label="我的助理" aria-pressed={activePage === 'assistants'} onClick={() => { onAssistants?.(); setDrawer(false); }}><UiIcon name="members" /><span>我的助理</span></Button>
        {onMemory && <Button variant="ghost" size="sm" className="justify-start" title="记忆与成长" aria-label="记忆与成长" aria-pressed={activePage === 'memory'} onClick={() => { onMemory(); setDrawer(false); }}><UiIcon name="memory" /><span>记忆与成长</span></Button>}
        {onCapabilities && <Button variant="ghost" size="sm" className="justify-start" title="能力库" aria-label="能力库" aria-pressed={activePage === 'capabilities'} onClick={() => { onCapabilities(); setDrawer(false); }}><UiIcon name="library" /><span>能力库</span></Button>}
      </nav>
      <div className="sidebar-content">
         <div className="sidebar-section-heading"><Button variant="ghost" size="sm" onClick={() => setSection('projects')}>项目</Button><IconButton ref={projectPlus} icon="add" label="新建项目" onClick={() => setCreating(true)} /></div>
        {error && !creating && <p role="alert">{error}</p>}
        {creating && <ProjectNameForm client={client} allowDirectory={allowDirectoryCreation}
          onClose={() => setCreating(false)} onReturnFocus={() => (projectPlus.current ?? drawerToggle.current)?.focus()}
          onCreated={workspace => { onCreated(workspace); setCreating(false); navigate({ workspaceId: workspace.id }); }} />}
        {section === 'projects' && navigation?.workspaces.items.filter(item => visible(item.workspace.id)).map(item => <section className="project-group" key={item.workspace.id}>
          <div className="project-heading"><IconButton className="project-disclosure" size="icon-xs"
            icon={foldedProjects.has(item.workspace.id) ? 'folded' : 'expand'} aria-expanded={!foldedProjects.has(item.workspace.id)}
            aria-controls={`sessions-${item.workspace.id}`} label={`${foldedProjects.has(item.workspace.id) ? '展开' : '收起'}${item.workspace.name}的会话`}
            onClick={() => setFoldedProjects(current => { const next = new Set(current); if (next.has(item.workspace.id)) next.delete(item.workspace.id); else next.add(item.workspace.id); return next; })} />
            <Button variant="ghost" size="sm" className="project-name justify-between gap-1 px-0.5" aria-label={item.workspace.name} aria-current={workspaceId === item.workspace.id ? 'true' : undefined} onClick={() => navigate({ workspaceId: item.workspace.id })}><span className="truncate">{item.workspace.name}</span>{item.pending_count > 0 && <small>{item.pending_count}</small>}</Button>
            {renderScopeActions?.(item.workspace, trigger => newSession(item.workspace.id, trigger))}</div>
          <div id={`sessions-${item.workspace.id}`} hidden={foldedProjects.has(item.workspace.id)}>
           {item.sessions.items.filter(session => visible(session.workspace_id, session.id)).map(displayedSession).map(session => <div className="session-nav-row" key={session.id}>
            <Button variant="ghost" size="sm" className="session-nav justify-start" aria-current={sessionId === session.id ? 'page' : undefined} onClick={() => navigate({ workspaceId: session.workspace_id, sessionId: session.id })}><span className="truncate">{session.title}</span></Button>
            {renderScopeActions?.(session)}</div>)}
          {item.sessions.next_cursor && <Button variant="ghost" size="sm" onClick={() => void act(async () => { const next = await client.sessions(item.workspace.id, { cursor: item.sessions.next_cursor! }); setNavigation(current => current && ({ ...current, workspaces: { ...current.workspaces, items: current.workspaces.items.map(value => value.workspace.id === item.workspace.id ? { ...value, sessions: { ...next, items: Object.values(mergeVersioned(Object.fromEntries(value.sessions.items.map(session => [session.id, session])), next.items)) } } : value) } })); })}>更多项目会话</Button>}
          </div></section>)}
        {section === 'projects' && navigation?.workspaces.next_cursor && <Button variant="ghost" size="sm" onClick={() => void act(async () => {
          const cursor = navigation.workspaces.next_cursor!, next = await client.navigation({ cursor });
          if (!navigationCursors.current.includes(cursor)) navigationCursors.current.push(cursor);
          setNavigation(current => mergeNavigation(current, next, true));
        })}>更多项目</Button>}
        {section === 'recent' && <section aria-label="最近创建会话"><h2>最近创建</h2>{recent?.items.filter(session => visible(session.workspace_id, session.id)).map(displayedSession).map(session => <div className="session-nav-row" key={session.id}>
          <Button variant="ghost" size="sm" className="session-nav justify-start" onClick={() => navigate({ workspaceId: session.workspace_id, sessionId: session.id })}><span className="truncate">{session.title}</span></Button>
          {renderScopeActions?.(session)}</div>)}
          {recent?.next_cursor && <Button variant="ghost" size="sm" onClick={() => void act(async () => { const next = await client.recentSessions({ cursor: recent.next_cursor! }); setRecent({ ...next, items: [...recent.items, ...next.items] }); })}>更多最近创建</Button>}</section>}
        {children}
      </div><footer className="sidebar-footer"><Button variant="ghost" size="sm" title="设置" aria-label="设置" onClick={() => {
        setDrawer(false);
        onSettings();
      }}><UiIcon name="settings" /><span>设置</span></Button><IconButton icon="refresh" label="刷新导航" disabled={busy} onClick={() => void act(async () => {
        const pages = await readNavigation();
        setNavigation(current => pages.reduce((value, page) => mergeNavigation(value, page), current));
      })} /></footer>
    </aside>;
  return <>
    <IconButton ref={drawerToggle} className="sidebar-drawer-toggle" icon="openSidebar" label="打开项目导航" onClick={() => setDrawer(true)} />
    {!drawer && sidebar}
    <Sheet open={drawer} onOpenChange={setDrawer}><SheetContent className="sidebar-sheet" onCloseAutoFocus={event => {
      event.preventDefault();
      if (!sheetTransfer.current && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) drawerToggle.current?.focus();
      sheetTransfer.current = false;
    }} onEscapeKeyDown={event => { if (event.isComposing || event.keyCode === 229) event.preventDefault(); }}>
      <SheetTitle className="sr-only">项目导航</SheetTitle>{drawer && sidebar}</SheetContent></Sheet>
    {inboxOpen && <Dialog title="待办" onClose={() => { inboxDismissed.current = true; setInboxOpen(false); }} onReturnFocus={() => {
      if (!inboxDismissed.current) return;
      inboxDismissed.current = false;
      const origin = inboxOrigin.current;
      if (origin?.isConnected) origin.focus();
      else inboxTrigger.current?.focus();
    }}>
      {error && <p role="alert">{error}</p>}
      {!inbox && !error && <p role="status">正在读取待办…</p>}
      {inbox && <PendingActionList items={inbox.items.filter(item => visible(item.workspace_id, item.session_id ?? undefined))} busy={busy}
        workspaceNames={Object.fromEntries(navigation?.workspaces.items.map(item => [item.workspace.id, item.workspace.name]) ?? [])}
        onOpen={item => {
          setInboxOpen(false);
          if (onPendingOpen) onPendingOpen(item, reopenInbox);
          else navigate({ workspaceId: item.workspace_id, sessionId: item.session_id ?? undefined, runId: item.run_id });
        }}
        onAction={(item, action) => void act(async () => {
          const opensDetail = !!onPendingAction && (action.kind === 'view_task' || action.kind === 'inspect_export_recovery');
          if (opensDetail) setInboxOpen(false);
          try { await onPendingAction?.(item, action, reopenInbox); }
          catch (error) { setInbox(await client.inbox({ limit: 50 })); if (opensDetail) reopenInbox(); throw error; }
          setInbox(await client.inbox({ limit: 50 }));
        })} />}
      {inbox?.next_cursor && <Button variant="outline" size="sm" onClick={() => void act(async () => { const next = await client.inbox({ cursor: inbox.next_cursor! }); setInbox({ ...next, items: [...inbox.items, ...next.items] }); })}>更多全局待办</Button>}
    </Dialog>}
  </>;
}
