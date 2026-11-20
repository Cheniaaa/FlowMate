import { useEffect, useLayoutEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, commandMeta, RuntimeClient } from '../../api/client';
import { mergeApprovals, mergeGrants, mergeMessages, mergePublications, mergeQuestions, mergeResources, mergeRunDetail, mergeRunFeedback, mergeRunPage, mergeRunSnapshot, mergeSessions, mergeVersioned, mergeWorkspaces, orderedMessageIds, scopeDeleted, terminal, type RunPageInput } from '../../api/events';
import { validate } from '../../api/validation';
import { openSettings, showWorkbench, type WorkbenchTarget } from '../../api/windows';
import type { AgentProfilePage, AnswerCommand, ArtifactRef, InboxPage, ModelConnectionPage, ModelProfilePage, PendingAction, ResourceCoverage, ResourceRef, RunSnapshot, ScopeRef, Session, WorkspaceSnapshot } from '../../generated/contracts';
import { createRuntimeStore, uiCommandId, type CommandOutcome, type UiCommand, type RuntimeStore } from '../../state/runtime-store';
import { createDraftStore, type Draft, type DraftKey } from '../../state/draft-store';
import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import Status from '../../components/Status';
import { assistantIcons } from '../../components/assistant-icons';
import Markdown from '../../components/Markdown';
import ArtifactPanel from '../artifacts/ArtifactPanel';
import { TaskGraph } from '../tasks/TaskGraph';
import { TaskList } from '../tasks/TaskList';
import { TracePanel } from '../trace/TracePanel';
import Composer from './Composer';
import ApprovalCard from './ApprovalCard';
import QuestionForm from './QuestionForm';
import InteractionPanel from './InteractionPanel';
import ResourcePanel from './ResourcePanel';
import MessageList, { modelFailures } from './MessageList';
import RecoveryPanel from './RecoveryPanel';
import RunCostSummary from './RunCostSummary';
import ContextNotice from './ContextNotice';
import ProjectSidebar, { type ProjectNavigation } from '../navigation/ProjectSidebar';
import ProjectDirectory from '../navigation/ProjectDirectory';
import TaskCenter from '../tasks/TaskCenter';
import TaskDetail from '../tasks/TaskDetail';
import ManagedTaskStrip from './ManagedTaskStrip';
import ResultInbox from '../notifications/ResultInbox';
import SessionActions from './SessionActions';
import CommandStatus from '../notifications/CommandStatus';
import PendingUserCommands from './PendingUserCommands';
import { useMemorySources } from './useMemorySources';
import CapabilityLibrary from '../capabilities/CapabilityLibrary';
import { personalScope } from '../../api/memory';
import { Sheet, SheetContent, SheetTitle } from '../../components/ui/sheet';
import { toast } from 'sonner';

type Confirmation = { kind: 'session' | 'workspace'; id: string; version: number; name: string };

export interface WorkbenchNavigation { target: Exclude<WorkbenchTarget, { kind: 'memory' | 'connection' }>; sequence: number }
interface ConversationProps {
  client: RuntimeClient;
  compact?: boolean;
  navigation?: WorkbenchNavigation;
  onSelectedRunChange?: (id: string | null) => void;
  onFormActiveChange?: (active: boolean) => Promise<void>;
  onSettings?: (section: 'models' | 'resources' | 'memory') => void;
  headerActions?: ReactNode;
  onReturnToQuick?: () => Promise<void>;
  onAssistants?: () => void;
  onProfilesChange?: (revision: string) => void;
  runtimeStore?: RuntimeStore;
  draftStore?: ReturnType<typeof createDraftStore>;
  onMemory?: (source?: RunSnapshot) => void;
  obscured?: boolean;
}

export function Conversation({ client, compact = false, navigation, onSelectedRunChange, onFormActiveChange, onSettings, headerActions, onReturnToQuick, onAssistants, onProfilesChange, runtimeStore, draftStore, onMemory, obscured = false }: ConversationProps) {
  const summaryDisclosureName = useId();
  const store = useMemo(() => runtimeStore ?? createRuntimeStore(client), [client, runtimeStore]);
  const drafts = useMemo(() => draftStore ?? createDraftStore(), [client, draftStore]);
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const profileRevision = Object.values(projection.profiles).map(profile => `${profile.id}:${profile.version}`).sort().join(',');
  useEffect(() => { onProfilesChange?.(profileRevision); }, [profileRevision, onProfilesChange]);
  const pendingCommands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const setProjection = store.update;
  const view = useRef({ workspaceId: '', sessionId: '' });
  const defaultWorkspaceId = useRef<string | null | undefined>(undefined);
  const userNavigated = useRef(false);
  const navigationTarget = useRef<{ session: Session; runId?: string } | undefined>(undefined);
  const projectNavigationSequence = useRef(0);
  const [initialized, setInitialized] = useState(false);
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0);
  const [nativeSelecting, setNativeSelecting] = useState(false);
  const [profilePage, setProfilePage] = useState<AgentProfilePage>();
  const [modelPage, setModelPage] = useState<ModelProfilePage>();
  const [modelLookup, setModelLookup] = useState<{ id: string; state: 'loading' | 'failed'; message?: string }>();
  const [modelLookupRevision, retryModelLookup] = useState(0);
  const [connectionPage, setConnectionPage] = useState<ModelConnectionPage>();
  const [todoCursors, setTodoCursors] = useState<Record<'active_runs' | 'pending_approvals' | 'pending_questions', string | null>>();
  const [resourceCursors, setResourceCursors] = useState<Record<'resources' | 'grants', string | null>>();
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [agentId, setAgentId] = useState('');
  const defaultModelId = useRef('');
  const [snapshotGeneration, setSnapshotGeneration] = useState(0);
  const [workReadySession, setWorkReadySession] = useState('');
  const [sidebarFormActive, setSidebarFormActive] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [newSessionWorkspace, setNewSessionWorkspace] = useState<string>();
  const sessionReturnFocus = useRef<(() => void) | undefined>(undefined);
  function newSession(id = workspaceId, returnFocus?: () => void) {
    const origin = document.activeElement as HTMLElement;
    sessionReturnFocus.current = returnFocus ?? (() => { if (origin.isConnected) origin.focus(); });
    setNewSessionWorkspace(id);
  }
  function closeNewSession() { setNewSessionWorkspace(undefined); setSessionTitle(''); }
  const [skillLibrary, setSkillLibrary] = useState<{ key: DraftKey; origin: HTMLElement | null; recovery?: boolean;
    mcpScope?: ScopeRef;
    mcpTarget?: { server_id: string | null; workspace_id: string | null } }>();
  const [skillNames, setSkillNames] = useState<Record<string, string>>({});
  function openSkillLibrary(entry: 'personal' | 'project') {
    setSkillLibrary({ key: { ...view.current }, origin: document.activeElement as HTMLElement,
      mcpScope: entry === 'personal' ? personalScope
        : { kind: 'workspace', workspace_id: view.current.workspaceId, session_id: null } });
  }
  function closeSkillLibrary() { const origin = skillLibrary?.origin; setSkillLibrary(undefined); origin?.focus(); }
  const draftKey = { workspaceId, sessionId };
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.read(draftKey));
  const { text, modelId } = draft;
  const resources = draft.resourceIds.map(id => projection.resources[id]).filter(Boolean);
  const setText = (text: string) => { userNavigated.current = true; drafts.update(draftKey, { text }); };
  const setModelId = (modelId: string) => { userNavigated.current = true; drafts.update(draftKey, { modelId }); };
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, { value: AnswerCommand['data']['answer'] | undefined; revision: number }>>({});
  const [interactionId, setInteractionId] = useState('');
  const [interactionCollapsed, setInteractionCollapsed] = useState(false);
  const commandContexts = useRef(new Map<string, { key: DraftKey; revision?: number; steering?: boolean; targetId?: string;
    submitted?: Draft; acknowledgedRevision?: number; runId?: string; missingHandled?: boolean; afterConfirmed?: () => Promise<void> }>());
  const [artifactId, setArtifactId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [management, setManagement] = useState<'center' | 'detail'>();
  const [centerTarget, setCenterTarget] = useState({ workspaceId: '', sequence: 0 });
  const [managedRunId, setManagedRunId] = useState('');
  const managementOrigin = useRef<HTMLElement | null>(null);
  const managementReturnPending = useRef(false);
  const [backgroundInteraction, setBackgroundInteraction] = useState<string>();
  const backgroundReturn = useRef<{ interactionId: string; management: typeof management; origin: HTMLElement | null } | undefined>(undefined);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<{ id: string; kind: 'task' | 'activity' }>();
  const [panel, setPanel] = useState<'tasks' | 'artifacts' | 'trace' | 'resources' | null>(null);
  const panelOrigin = useRef<HTMLElement | null>(null);
  const conversationHeader = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (management || !managementReturnPending.current) return;
    managementReturnPending.current = false;
    const origin = managementOrigin.current;
    managementOrigin.current = null;
    const active = document.activeElement as HTMLElement | null;
    // 仅显式返回在 inert 移除后回焦；新页面已接管时保留其焦点。
    if (active?.isConnected && !active.matches('body,html,:disabled') && !active.closest('[inert]')) return;
    if (origin?.isConnected && !origin.matches('body,html,:disabled') && !origin.closest('[inert],[hidden],.task-management')) {
      origin.focus();
      if (document.activeElement === origin) return;
    }
    const target = conversationHeader.current?.querySelector<HTMLButtonElement>('[data-conversation-panel="tasks"]');
    if (target && !target.closest('[inert]')) target.focus();
  }, [management]);
  function returnPanelFocus(event: Event) {
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    // 旧 Sheet 的延迟回焦不能覆盖已由输入或新页面接管的焦点。
    if (active?.isConnected && !active.matches('body,html,:disabled') && !active.closest('[inert]')
      && !(event.target as HTMLElement).contains(active)) return;
    const origin = panelOrigin.current;
    if (origin?.isConnected && !origin.matches('body,html,:disabled') && !origin.closest('[inert]')) {
      origin.focus();
      if (document.activeElement === origin) return;
    }
    const target = conversationHeader.current?.querySelector<HTMLButtonElement>('[data-conversation-panel="tasks"]');
    if (target && !target.closest('[inert]')) target.focus();
  }
  useEffect(() => { if (obscured) { setPanel(null); setResultsOpen(false); } }, [obscured]);
  const [graph, setGraph] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [runListCursor, setRunListCursor] = useState<string | null>(null);
  const [runCursors, setRunCursors] = useState<Record<string, Partial<Record<RunPageInput['kind'], string | null>>>>({});
  const [trace, setTrace] = useState<{ runId: string; page: Awaited<ReturnType<RuntimeClient['trace']>> }>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('正在读取本地记录…');
  const [feedbackQuery, setFeedbackQuery] = useState<{ request: typeof view.current; failed: boolean; loading: boolean }>();
  const [feedbackRetry, setFeedbackRetry] = useState(0);
  const messageScroll = useRef<HTMLElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const observedRuns = useRef(new Map<string, string>());
  const [completion, setCompletion] = useState('');
  useEffect(() => {
    for (const run of Object.values(projection.runs)) {
      const previous = observedRuns.current.get(run.id);
      if (previous && previous !== run.state && run.state === 'completed' && run.interaction_session_id === sessionId) {
        const message = run.output?.summary || '任务已完成，可打开结果或任务查看。';
        setCompletion(message); toast.success(message, { id: `completed:${run.id}` });
      }
      observedRuns.current.set(run.id, run.state);
    }
  }, [projection.runs, sessionId]);
  useLayoutEffect(() => {
    if (messageScroll.current) messageScroll.current.scrollTop = scrollPositions.current.get(sessionId) ?? 0;
  }, [sessionId, projection.messages]);
  const [configurationRevision, setConfigurationRevision] = useState(0);
  const configRead = useRef(0);
  // 设置返回或两窗重新聚焦时重读配置，不替换聊天快照和草稿。
  useEffect(() => {
    const refresh = () => setConfigurationRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    window.addEventListener('flowmate:settings-changed', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('flowmate:settings-changed', refresh); };
  }, []);
  useEffect(() => {
    if (!configurationRevision) return;
    const revision = ++configRead.current;
    Promise.all([client.models(), client.connections(), client.profiles()]).then(([models, connections, profiles]) => {
      if (revision !== configRead.current) return;
      setModelPage(models); setConnectionPage(connections); setProfilePage(profiles);
      setProjection(state => ({ ...state, models: mergeVersioned(state.models, models.items),
        connections: mergeVersioned(state.connections, connections.items), profiles: mergeVersioned(state.profiles, profiles.items) }));
    }).catch(report);
  }, [client, configurationRevision]);

  function chooseSession(id: string) {
    navigationTarget.current = undefined;
    view.current = { workspaceId: view.current.workspaceId, sessionId: id };
    const key = { workspaceId: view.current.workspaceId, sessionId: id };
    const profileId = store.getSnapshot().sessions[id]?.agent_profile_id ?? '';
    setAgentId(profileId);
    defaultModelId.current = store.getSnapshot().profiles[profileId]?.default_model_profile_id ?? '';
    if (id && store.getSnapshot().profiles[profileId] && drafts.read(key).revision === 0) drafts.update(key, { modelId: defaultModelId.current });
    setWorkReadySession('');
    setSessionId(id); setHistoryCursor(null); setArtifactId(''); setPanel(null); setResultsOpen(false); setBackgroundInteraction(undefined); backgroundReturn.current = undefined;
    setSelectedRunId(''); setSelectedNode(undefined); setTrace(undefined); setRunCursors({}); setRunListCursor(null); setConfirmation(undefined);
    setFeedbackQuery(undefined);
  }

  function chooseWorkspace(id: string) {
    view.current = { workspaceId: id, sessionId: '' };
    setWorkspaceId(id); chooseSession(''); setTodoCursors(undefined); setResourceCursors(undefined); setSessionTitle('');
  }

  function currentView(request: typeof view.current) {
    return view.current === request && !!store.getSnapshot().sessions[request.sessionId]
      && !scopeDeleted(store.getSnapshot(), { workspace_id: request.workspaceId, session_id: request.sessionId });
  }

  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : '宿主操作失败';
    setError(message); toast.error(message, { id: `conversation:${message}` });
  };
  async function perform(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    try { await action(); } catch (error) { report(error); }
    finally { pending.current = false; setBusy(false); }
  }

  async function applyOutcome(outcome: CommandOutcome) {
    const context = commandContexts.current.get(outcome.commandId)!;
    if (outcome.status === 'confirmed') {
      context.runId = outcome.runId;
      // 排队失败可先于确认到达；已因缺凭据保留的草稿不能再由迟到确认清空。
      if (!context.missingHandled && context.revision !== undefined && drafts.read(context.key).revision === context.revision) {
        drafts.acknowledge(context.key, context.revision, context.steering);
        context.acknowledgedRevision = drafts.read(context.key).revision;
      }
      const afterConfirmed = context.afterConfirmed;
      context.afterConfirmed = undefined;
      await afterConfirmed?.();
    }
    if (view.current.workspaceId === context.key.workspaceId && view.current.sessionId === context.key.sessionId) {
      setStatus(outcome.status === 'unconfirmed' ? '命令待核对' : outcome.sync === 'pending' ? '操作已接收，正在同步状态' : '操作已确认');
    }
  }

  async function dispatchCommand(command: UiCommand, options: { key?: DraftKey; revision?: number; steering?: boolean; submitted?: Draft; afterConfirmed?: () => Promise<void> } = {}) {
    const commandId = uiCommandId(command);
    commandContexts.current.set(commandId, { key: { ...view.current }, targetId: typeof command.args[0] === 'string' ? command.args[0] : undefined, ...options });
    const outcome = await store.dispatch(command);
    await applyOutcome(outcome);
    return outcome;
  }

  function unconfirmed(type: UiCommand['type'], targetId?: string) {
    return pendingCommands.some(command => command.status === 'unconfirmed' && command.type === type
      && commandContexts.current.get(command.commandId)?.targetId === targetId);
  }

  useEffect(() => {
    let ignore = false;
    Promise.all([client.workspaces(), client.profiles(), client.models(), client.connections()]).then(([workspaces, profiles, models, connections]) => {
      if (ignore) return;
      setProfilePage(profiles); setModelPage(models); setConnectionPage(connections);
      const next = setProjection(state => mergeWorkspaces({ ...state, profiles: mergeVersioned(state.profiles, profiles.items), models: mergeVersioned(state.models, models.items), connections: mergeVersioned(state.connections, connections.items) }, workspaces.items));
      chooseWorkspace(defaultWorkspaceId.current ?? Object.keys(next.workspaces)[0] ?? '');
      setStatus('本机连接就绪');
      setInitialized(true);
    }).catch(error => { if (!ignore) report(error); });
    return () => { ignore = true; };
  }, [client]);

  useEffect(() => {
    if (!initialized || !navigation) return;
    userNavigated.current = true;
    let ignore = false;
    async function locate() {
      const target = navigation!.target;
      if (target.kind === 'assistants') { onAssistants?.(); return; }
      if (target.kind === 'mcp') {
        setSkillLibrary({ key: { ...view.current }, origin: document.activeElement as HTMLElement,
          mcpTarget: { server_id: target.server_id, workspace_id: target.workspace_id } }); return;
      }
      if (target.kind === 'capabilities') { openSkillLibrary('personal'); return; }
      if (target.kind === 'tasks') {
        setCenterTarget(current => ({ workspaceId: target.workspace_id ?? '', sequence: current.sequence + 1 }));
        enterManagement('center'); return;
      }
      if (target.kind === 'task') {
        const task = await client.task(target.task_id);
        if (!ignore) { setCenterTarget(current => ({ workspaceId: view.current.workspaceId, sequence: current.sequence + 1 })); setManagedRunId(task.run_id); enterManagement('detail'); }
        return;
      }
      const detail = await client.run(target.run_id);
      if (ignore) return;
      if (detail.run.kind === 'managed') { setCenterTarget(current => ({ workspaceId: view.current.workspaceId, sequence: current.sequence + 1 })); setManagedRunId(detail.run.id); enterManagement('detail'); return; }
      if (detail.run.interaction_session_id === null) return;
      const session = await client.session(detail.run.interaction_session_id);
      if (ignore || scopeDeleted(store.getSnapshot(), { workspace_id: detail.run.workspace_id, session_id: detail.run.interaction_session_id })) return;
      // 归属来自真实Run/Session；快照安装后再补入可能不在首页的目标。
      chooseWorkspace(session.workspace_id);
      navigationTarget.current = { session, runId: detail.run.id };
      setWorkspaceGeneration(value => value + 1);
    }
    locate().catch(error => { if (!ignore) report(error); });
    return () => { ignore = true; };
  }, [client, initialized, navigation]);

  useEffect(() => {
    if (!workspaceId) return;
    const abort = new AbortController();
    async function installSnapshot(snapshot: WorkspaceSnapshot) {
      if (abort.signal.aborted || view.current.workspaceId !== workspaceId
        || scopeDeleted(store.getSnapshot(), { workspace_id: workspaceId, session_id: null })) return;
      let next = store.getSnapshot();
      setTodoCursors({ active_runs: snapshot.active_runs.next_cursor,
        pending_questions: snapshot.pending_questions.next_cursor, pending_approvals: snapshot.pending_approvals.next_cursor });
      setResourceCursors({ resources: snapshot.resources.next_cursor, grants: snapshot.grants.next_cursor });
      const target = navigationTarget.current;
      if (target?.session.workspace_id === workspaceId) {
        next = setProjection(state => mergeSessions(state, [target.session]));
        if (next.sessions[target.session.id]) {
          if (view.current.sessionId !== target.session.id) chooseSession(target.session.id);
          const request = view.current;
          // 导航归属查询可能早于快照水位；在快照之后重读，不能绕过旧详情围栏。
          if (target.runId) {
            const detail = await client.run(target.runId);
            if (abort.signal.aborted || !currentView(request)) return;
            next = setProjection(state => mergeRunDetail(state, detail));
            if (next.runs[target.runId]) { setSelectedRunId(target.runId); if (!compact) setPanel('tasks'); }
          }
        }
        navigationTarget.current = undefined;
      }
      if (!next.sessions[view.current.sessionId]) chooseSession(Object.values(next.sessions)
        .find(session => session.workspace_id === workspaceId)?.id ?? '');
      setSnapshotGeneration(value => value + 1);
      const runIds = new Set([...snapshot.pending_questions.items.map(question => question.run_id), ...snapshot.pending_approvals.items.map(approval => approval.run_id)]
        .filter(id => !next.runs[id]));
      const details = await Promise.all([...runIds].map(id => client.run(id)));
      if (!abort.signal.aborted) setProjection(state => mergeQuestions(details.reduce(mergeRunDetail, state), snapshot.pending_questions.items));
    }
    async function connect() {
      await store.loadWorkspace(workspaceId, {
        snapshot: installSnapshot,
        event: () => {
          if (abort.signal.aborted) return;
          const next = store.getSnapshot();
          if (!next.workspaces[view.current.workspaceId]) {
            chooseWorkspace(Object.keys(next.workspaces)[0] ?? '');
          } else if (view.current.sessionId && !next.sessions[view.current.sessionId]) {
            chooseSession(Object.values(next.sessions).find(session => session.workspace_id === view.current.workspaceId)?.id ?? '');
          }
        },
        connection: state => setStatus(state === 'connected' ? '本机事件流已连接' : '事件流断开，正在从持久游标重连；未重交命令'),
      }, abort.signal);
    }
    connect().catch(error => { if (!abort.signal.aborted) report(error); });
    return () => abort.abort();
  }, [client, store, workspaceId, workspaceGeneration]);

  useEffect(() => {
    if (!sessionId) return;
    let ignore = false;
    const request = view.current;
    client.messages(sessionId).then(page => {
      if (!ignore && currentView(request)) { setHistoryCursor(page.next_cursor); setProjection(state => mergeMessages(state, sessionId, page.items)); }
    }).catch(error => { if (!ignore) report(error); });
    client.sessionRuns(sessionId).then(page => {
      if (!ignore && currentView(request)) {
        setRunListCursor(page.next_cursor);
        setProjection(state => page.items.reduce(mergeRunSnapshot, state));
      }
    }).catch(error => { if (!ignore) report(error); });
    store.refreshSessionWork(sessionId).then(() => {
      if (!ignore && currentView(request)) setWorkReadySession(sessionId);
    }).catch(error => { if (!ignore) report(error); });
    return () => { ignore = true; };
  }, [client, sessionId, snapshotGeneration]);

  const agent = projection.profiles[agentId];
  useEffect(() => {
    if (!agentId || agent || !profilePage?.next_cursor) return;
    let ignore = false;
    client.profiles({ cursor: profilePage.next_cursor }).then(page => {
      if (!ignore) { setProfilePage(page); setProjection(state => ({ ...state, profiles: mergeVersioned(state.profiles, page.items) })); }
    }).catch(error => { if (!ignore) report(error); });
    return () => { ignore = true; };
  }, [client, agentId, agent, profilePage]);
  useEffect(() => {
    if (agent && sessionId && drafts.read({ workspaceId, sessionId }).revision === 0) drafts.update({ workspaceId, sessionId }, { modelId: agent.default_model_profile_id ?? '' });
  }, [agent, sessionId]);
  const model = projection.models[modelId];
  useEffect(() => {
    if (!modelId || model) return;
    let ignore = false;
    setModelLookup({ id: modelId, state: 'loading' });
    async function locate() {
      let cursor = modelPage?.next_cursor;
      while (cursor) {
        const page = await client.models({ cursor });
        if (ignore) return;
        setProjection(state => ({ ...state, models: mergeVersioned(state.models, page.items) }));
        if (page.items.some(item => item.id === modelId)) { setModelPage(page); setModelLookup(undefined); return; }
        cursor = page.next_cursor;
      }
      if (!ignore) setModelLookup({ id: modelId, state: 'failed', message: '默认模型未在当前列表中找到，请选择其他模型或重试。' });
    }
    locate().catch(error => { if (!ignore) setModelLookup({ id: modelId, state: 'failed', message: `默认模型加载失败：${error instanceof Error ? error.message : '无法读取模型列表'}` }); });
    return () => { ignore = true; };
  }, [client, modelId, !!model, modelLookupRevision]);
  const defaultModelLoading = !model && modelLookup?.id === modelId && modelLookup.state === 'loading';
  const defaultModelError = !model && modelLookup?.id === modelId && modelLookup.state === 'failed' ? modelLookup.message : undefined;
  const connection = model && projection.connections[model.connection_id];
  useEffect(() => {
    if (connection && workspaceId && sessionId) {
      try { drafts.applyPreference(draftKey, connection.endpoint); } catch (error) { report(error); }
    }
  }, [drafts, workspaceId, sessionId, connection?.endpoint]);
  const memorySources = useMemorySources(client, draft.memoryScopes, connection?.endpoint, projection.memoryRevision);
  const runs = Object.values(projection.runs).filter(run => run.interaction_session_id === sessionId);
  const activeRun = runs.find(run => run.kind === 'user' && run.execution_session_id === sessionId && !terminal(run.state))
    ?? runs.find(run => run.kind === 'follow_up' && run.execution_session_id === sessionId && !terminal(run.state)
      && !(run.state === 'interrupted' && run.reason === 'yield_to_user'));
  const activeRoot = activeRun && projection.tasks[activeRun.root_task_id];
  const editingSummary = activeRun?.kind === 'follow_up' && draft.summaryRunId === activeRun.id;
  const steering = activeRun?.kind === 'user' || editingSummary;
  const canSteer = steering && activeRoot?.kind === 'agent' && !(activeRun.kind === 'follow_up' && (activeRun.yield_requested || activeRun.follow_up_closed));
  const sessionCommands = Object.values(projection.pendingUserCommands).filter(command => command.session_id === sessionId);
  const queueing = !steering && (activeRun?.kind === 'follow_up' || sessionCommands.some(command => command.state === 'queued'));
  useEffect(() => {
    if (draft.summaryRunId && (activeRun?.kind !== 'follow_up' || activeRun.id !== draft.summaryRunId || activeRun.yield_requested || activeRun.follow_up_closed)) {
      drafts.update(draftKey, { summaryRunId: null });
    }
  }, [drafts, workspaceId, sessionId, draft.summaryRunId, activeRun?.id, activeRun?.kind, activeRun?.yield_requested, activeRun?.follow_up_closed]);
  const sourceResult = draft.sourceResult ? projection.deliveries[draft.sourceResult] : undefined;
  const sourceResultInvalid = !!draft.sourceResult && (!sourceResult?.source_valid || sourceResult.target_session_id !== sessionId || sourceResult.delivery_state === 'invalidated');
  const pendingSubmission = pendingCommands.some(command => {
    const context = commandContexts.current.get(command.commandId);
    return command.status === 'unconfirmed' && (command.type === 'startRun' || command.type === 'enqueueUser'
      || command.type === 'steer' || command.type === 'grant' && !!context?.afterConfirmed)
      && context?.key.workspaceId === workspaceId && context.key.sessionId === sessionId;
  });
  const configurationLocked = !!steering || pendingSubmission;
  const selectedRun = runs.find(run => run.id === selectedRunId) ?? activeRun ?? runs.at(-1);
  const tracePage = trace?.runId === selectedRun?.id ? trace?.page : undefined;
  const tasks = Object.values(projection.tasks).filter(task => task.run_id === selectedRun?.id);
  const activities = Object.values(projection.activities).filter(activity => activity.run_id === selectedRun?.id);
  const artifacts = Object.values(projection.artifacts).filter(artifact => projection.entityScopes[artifact.id]?.session_id === sessionId
    && projection.entityScopes[artifact.id]?.workspace_id === workspaceId);
  const selectedArtifact = artifacts.find(artifact => artifact.id === artifactId) ?? null;
  const questions = Object.values(projection.questions).filter(question => question.status === 'pending'
    && (question.run_id === backgroundInteraction || projection.runs[question.run_id]?.interaction_session_id === sessionId && projection.runs[question.run_id]?.kind !== 'managed'));
  const approvals = Object.values(projection.approvals).filter(approval => approval.status === 'pending'
    && (approval.run_id === backgroundInteraction || approval.session_id === sessionId && projection.runs[approval.run_id]?.kind !== 'managed'));
  const publications = Object.values(projection.publications).filter(item => backgroundInteraction ? item.run_id === backgroundInteraction : item.session_id === sessionId);
  const interactions = [
    ...questions.map(question => ({ kind: 'question' as const, id: question.id, title: '回答问题', question })),
    ...(draft.resourceIds.length ? [{ kind: 'scope' as const, id: 'scope', title: '本次资料范围' }] : []),
    ...approvals.map(approval => ({ kind: 'approval' as const, id: approval.id, title: '批准本次操作', approval })),
    ...(publications.length ? [{ kind: 'recovery' as const, id: 'recovery', title: '导出恢复' }] : []),
  ];
  const interaction = interactions.find(item => item.id === interactionId) ?? interactions[0];
  const summary = selectedRun && projection.runSummaries[selectedRun.id];
  const composerRun = activeRun ?? runs.filter(run => run.kind === 'user' && run.execution_session_id === sessionId).at(-1);
  const composerSummary = composerRun && projection.runSummaries[composerRun.id];
  const messageIds = orderedMessageIds(projection, sessionId);
  const feedbackRequests = [...new Set(messageIds.map(id => projection.messages[id].run_id))]
    .filter(id => !projection.runFeedback[id] || projection.runFeedback[id].version < (projection.runs[id]?.version ?? 0));
  const feedbackRequestKey = feedbackRequests.map(id => `${id}:${projection.runs[id]?.version ?? 0}:${projection.runFeedbackWatermarks[id] ?? '0'}`).join(',');
  useEffect(() => {
    if (!feedbackRequests.length) { setFeedbackQuery(undefined); return; }
    let ignore = false;
    const request = view.current;
    setFeedbackQuery(current => ({ request, failed: current?.request === request && current.failed, loading: true }));
    const batches = [];
    for (let offset = 0; offset < feedbackRequests.length; offset += 100) batches.push(feedbackRequests.slice(offset, offset + 100));
    Promise.all(batches.map(ids => client.runFeedback(sessionId, ids))).then(pages => {
      if (!ignore && currentView(request)) {
        setProjection(state => pages.reduce(mergeRunFeedback, state));
        setFeedbackQuery(undefined);
      }
    }).catch(() => {
      if (!ignore && currentView(request)) setFeedbackQuery({ request, failed: true, loading: false });
    });
    return () => { ignore = true; };
  }, [client, sessionId, snapshotGeneration, feedbackRequestKey, feedbackRetry]);
  useEffect(() => {
    for (const [commandId, context] of commandContexts.current) {
      const runId = context.runId ?? projection.pendingUserCommands[commandId]?.run_id;
      if (!runId || !context.submitted || context.missingHandled) continue;
      const run = projection.runs[runId], feedback = projection.runFeedback[runId];
      if ((feedback?.model_activity?.error ?? run?.reason) !== 'credential_missing') continue;
      if (scopeDeleted(projection, { workspace_id: context.key.workspaceId, session_id: context.key.sessionId })) continue;
      context.missingHandled = true;
      // 仅恢复该命令清空且之后未编辑的草稿；较新的输入始终保留。
      if (context.acknowledgedRevision === drafts.read(context.key).revision) {
        const { revision: _revision, ...submitted } = context.submitted;
        drafts.update(context.key, submitted);
      }
      if (context.key.workspaceId === workspaceId && context.key.sessionId === sessionId) {
        setError('此连接尚未配置密钥，当前输入已保留。配置后可再次发送。');
        void showWorkbench({ kind: 'connection', connection_id: feedback?.connection_id ?? run.config.model_profile.connection_id }).catch(report);
      }
    }
  }, [projection, drafts, workspaceId, sessionId, busy]);
  const [coverageRevision, setCoverageRevision] = useState(0);
  const [coverage, setCoverage] = useState<{ key: string; result?: ResourceCoverage; error?: string }>();
  const policyRevision = useMemo(() => JSON.stringify([projection.resources, projection.grants, projection.scopes]),
    [projection.resources, projection.grants, projection.scopes]);
  const coverageKey = JSON.stringify([workspaceId, sessionId, modelId, connection?.endpoint,
    draft.resourceIds, policyRevision, coverageRevision]);
  const currentCoverage = coverage?.key === coverageKey ? coverage : undefined;
  const coverageLoading = !!connection && !!sessionId && draft.resourceIds.length > 0 && !currentCoverage;
  const resourcesSyncing = !resourceCursors || resourceCursors.resources !== null || resourceCursors.grants !== null || coverageLoading;
  const granted = !!currentCoverage?.result?.allowed && currentCoverage.result.destination === connection?.endpoint;
  useEffect(() => {
    if (!sessionId || !connection || !draft.resourceIds.length || resources.length !== draft.resourceIds.length) return;
    let ignore = false;
    client.resourceCoverage(sessionId, { resource_ids: draft.resourceIds, model_profile_id: modelId })
      .then(result => { if (!ignore) setCoverage({ key: coverageKey, result }); })
      .catch(error => { if (!ignore) setCoverage({ key: coverageKey, error: error instanceof Error ? error.message : '授权核对失败' }); });
    return () => { ignore = true; };
  }, [client, coverageKey]);

  const formActive = busy || nativeSelecting || sidebarFormActive || newSessionWorkspace !== undefined || !!text || !!sessionTitle || resources.length > 0 || !!confirmation
    || draft.allowManaged || draft.allowFollowUp || !!draft.sourceResult || draft.memoryScopes.length > 0 || Object.keys(draft.skillVersions).length > 0
    || Object.values(projection.questions).some(question => question.status === 'pending' && projection.runs[question.run_id]?.interaction_session_id === sessionId)
    || Object.values(projection.approvals).some(approval => approval.status === 'pending' && approval.session_id === sessionId);
  useEffect(() => { onSelectedRunChange?.(selectedRun?.id ?? null); }, [selectedRun?.id, onSelectedRunChange]);
  useEffect(() => {
    if (onFormActiveChange) void onFormActiveChange(formActive).catch(report);
  }, [formActive, onFormActiveChange]);

  useEffect(() => {
    setTrace(undefined);
    if (!selectedRun) return;
    let ignore = false;
    const request = view.current;
    client.run(selectedRun.id).then(detail => {
      if (ignore || !currentView(request)) return;
      setProjection(state => mergeRunDetail(state, detail));
      setRunCursors(current => ({ ...current, [detail.run.id]: Object.fromEntries(
        (['tasks', 'activities', 'artifacts', 'waits', 'consumptions', 'joins'] as const).map(kind => [kind, detail[kind].next_cursor])) }));
    }).catch(error => {
      if (!ignore && !store.getCommandsSnapshot().some(command => command.status === 'confirmed' && command.runId === selectedRun.id)) report(error);
    });
    return () => { ignore = true; };
  }, [client, selectedRun?.id, sessionId]);

  useEffect(() => {
    if (!selectedRun) return;
    let ignore = false; const request = view.current;
    client.exportRecovery(selectedRun.id).then(items => { if (!ignore && currentView(request)) setProjection(state => mergePublications(state, items)); }).catch(error => { if (!ignore) report(error); });
    return () => { ignore = true; };
  }, [client, selectedRun?.id, selectedRun?.version]);

  useEffect(() => {
    if (panel !== 'trace' || !selectedRun) return;
    let ignore = false;
    client.trace(selectedRun.id).then(page => { if (!ignore) setTrace({ runId: selectedRun.id, page }); }).catch(error => { if (!ignore) report(error); });
    return () => { ignore = true; };
  }, [client, panel, selectedRun?.id]);

  function selectRun(id: string) {
    const run = store.getSnapshot().runs[id];
    if (run.kind === 'managed') { openTask(id); return; }
    if (run.interaction_session_id === null) return;
    const interactionSessionId = run.interaction_session_id;
    if (!store.getSnapshot().sessions[interactionSessionId]) {
      void perform(async () => {
        const request = view.current;
        const session = await client.session(interactionSessionId);
        if (view.current !== request) return;
        const next = setProjection(state => mergeSessions(state, [session]));
        if (next.sessions[session.id]) { chooseSession(session.id); setSelectedRunId(id); if (!compact) setPanel('tasks'); }
      });
      return;
    }
    if (run.interaction_session_id !== view.current.sessionId) chooseSession(run.interaction_session_id);
    setSelectedRunId(id); setSelectedNode(undefined); if (!compact) setPanel('tasks');
  }

  function enterManagement(next: 'center' | 'detail', origin: HTMLElement | null = document.activeElement as HTMLElement) {
    managementOrigin.current = origin;
    managementReturnPending.current = false;
    setManagement(next);
  }
  function closeManagement() { managementReturnPending.current = true; setManagement(undefined); }
  function openTaskCenter() {
    if (compact) { void perform(() => showWorkbench({ kind: 'tasks', workspace_id: workspaceId || null })); return; }
    setCenterTarget(current => ({ workspaceId, sequence: current.sequence + 1 }));
    enterManagement('center');
  }
  function openTask(runId: string) {
    setPanel(null); setResultsOpen(false);
    if (compact) {
      void perform(async () => { const detail = await client.run(runId); await showWorkbench({ kind: 'task', task_id: detail.run.root_task_id }); });
      return;
    }
    if (!management) setCenterTarget(current => ({ workspaceId, sequence: current.sequence + 1 }));
    setManagedRunId(runId); enterManagement('detail', management ? managementOrigin.current : document.activeElement as HTMLElement);
  }
  function returnFromBackground() {
    const previous = backgroundReturn.current;
    setBackgroundInteraction(undefined);
    if (previous) { setInteractionId(previous.interactionId); setManagement(previous.management); previous.origin?.focus(); }
    backgroundReturn.current = undefined;
  }
  async function openBackground(runId: string, itemId?: string) {
    const request = view.current;
    const detail = await client.run(runId);
    if (view.current !== request) return;
    setProjection(state => mergeRunDetail(state, detail));
    backgroundReturn.current = { interactionId, management, origin: document.activeElement as HTMLElement };
    setBackgroundInteraction(runId); setManagement(undefined);
    setInteractionId(itemId ?? detail.questions.items.find(question => question.status === 'pending')?.id ?? detail.approvals.items.find(approval => approval.status === 'pending')?.id ?? '');
    setInteractionCollapsed(false);
  }
  function openPending(item: InboxPage['items'][number]) {
    void perform(async () => {
      await openBackground(item.run_id, item.id);
      // 待办可来自RunDetail首页之外；仍绑定Inbox返回的真实原对象及版本。
      if (item.kind === 'question') setProjection(state => mergeQuestions(state, [item.question]));
      else if (item.kind === 'approval') setProjection(state => mergeApprovals(state, [item.approval]));
    });
  }
  async function pendingAction(item: PendingAction, action: PendingAction['allowed_actions'][number]) {
    if (action.kind === 'view_task') { openTask(action.target_id); return; }
    if (action.kind === 'inspect_export_recovery') {
      await openBackground(action.target_id, 'recovery');
      const publications = await client.exportRecovery(action.target_id);
      setProjection(state => mergePublications(state, publications));
      return;
    }
    const key = { workspaceId: item.workspace_id, sessionId: item.session_id ?? '' };
    if (action.kind === 'resume') await dispatchCommand({ type: 'resume', args: [action.target_id, commandMeta(action.expected_version)] }, { key });
    else if (action.kind === 'cancel_run') await dispatchCommand({ type: 'cancel', args: [action.target_id, commandMeta(action.expected_version)] }, { key });
    else await dispatchCommand({ type: 'retryDelivery', args: [action.target_id, commandMeta(action.expected_version)] }, { key });
  }

  function navigateProject(target: ProjectNavigation) {
    if (scopeDeleted(store.getSnapshot(), { workspace_id: target.workspaceId, session_id: target.sessionId ?? null })) { setStatus('目标项目或会话已删除'); return; }
    userNavigated.current = true;
    const sequence = ++projectNavigationSequence.current;
    void (async () => {
      if (target.sessionId) {
        const session = await client.session(target.sessionId);
        if (sequence !== projectNavigationSequence.current) return;
        if (scopeDeleted(store.getSnapshot(), { workspace_id: session.workspace_id, session_id: session.id })) return;
        if (view.current.workspaceId === session.workspace_id && !target.runId) {
          setProjection(state => mergeSessions(state, [session]));
          if (view.current.sessionId !== session.id) chooseSession(session.id);
          return;
        }
        if (view.current.workspaceId !== session.workspace_id) chooseWorkspace(session.workspace_id);
        navigationTarget.current = { session, runId: target.runId };
      } else chooseWorkspace(target.workspaceId);
      setWorkspaceGeneration(value => value + 1);
    })().catch(report);
  }

  async function loadRunPage(kind: RunPageInput['kind']) {
    const runId = selectedRun!.id;
    const request = view.current;
    const page = await client[kind](runId, { cursor: runCursors[runId][kind]! });
    if (!currentView(request)) return;
    setProjection(state => mergeRunPage(state, runId, { kind, page } as RunPageInput));
    setRunCursors(current => ({ ...current, [runId]: { ...current[runId], [kind]: page.next_cursor } }));
  }

  async function loadResourcePage(kind: 'resources' | 'grants') {
    const request = view.current;
    // 快照的续页覆盖整个工作区，不能中途加 session_id 改变 opaque cursor 的范围。
    const result = kind === 'resources'
      ? { kind, page: await client.resources(workspaceId, { cursor: resourceCursors!.resources! }) }
      : { kind, page: await client.grants(workspaceId, { cursor: resourceCursors!.grants! }) };
    if (!currentView(request) || BigInt(result.page.watermark) < BigInt(store.getSnapshot().snapshotWatermark)) return;
    setProjection(state => result.kind === 'resources' ? mergeResources(state, result.page.items) : mergeGrants(state, result.page.items));
    setResourceCursors(current => current && ({ ...current, [kind]: result.page.next_cursor }));
  }

  async function chooseExport(artifact: ArtifactRef) {
    const request = view.current;
    setNativeSelecting(true);
    try {
      await onFormActiveChange?.(true);
      const task = await client.task(artifact.task_id);
      const detail = await client.run(task.run_id);
      const owner = { workspaceId: detail.run.workspace_id, sessionId: detail.run.interaction_session_id ?? '' };
      const selection = await invoke<{ resources: unknown[] }>('choose_export_target', {
        scope: { kind: owner.sessionId ? 'session' : 'workspace', workspace_id: owner.workspaceId, session_id: owner.sessionId || null },
        binary: artifact.media_type === 'application/octet-stream',
      });
      if (!currentView(request) || !selection.resources.length) return;
      const target = validate('ResourceRef', selection.resources[0]);
      const exportCommand: UiCommand = { type: 'exportArtifact', args: [artifact.id, { meta: commandMeta(artifact.version),
        data: { target_ref: target.id, expected_target_hash: target.source_version } }] };
      await dispatchCommand({ type: 'grant', args: [{ meta: commandMeta(), data: { scope: target.scope,
        resource_ids: [target.id], purposes: ['export'], destination: null } }] }, {
        key: owner, afterConfirmed: async () => { await dispatchCommand(exportCommand, { key: owner }); },
      });
    } finally { setNativeSelecting(false); }
  }

  async function confirm() {
    await perform(async () => {
      const action = confirmation!;
      const request = view.current;
      try {
        if (action.kind === 'session') {
          await dispatchCommand({ type: 'deleteSession', args: [action.id, commandMeta(action.version)] }, { afterConfirmed: async () => {
            if (view.current === request) chooseSession(Object.values(store.getSnapshot().sessions).find(session => session.workspace_id === request.workspaceId)?.id ?? '');
          } });
        } else {
          await dispatchCommand({ type: 'deleteWorkspace', args: [action.id, commandMeta(action.version)] }, { afterConfirmed: async () => {
            if (view.current === request) chooseWorkspace(Object.keys(store.getSnapshot().workspaces)[0] ?? '');
          } });
        }
        if (view.current === request) setConfirmation(undefined);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'skill_export_recovery_pending') {
          setConfirmation(undefined);
          setSkillLibrary({ key: { workspaceId: action.kind === 'workspace' ? action.id : request.workspaceId, sessionId: '' },
            origin: document.getElementById('message-input'), recovery: true });
        }
        throw error;
      }
    });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (steering && !canSteer || pendingSubmission || sourceResultInvalid || draft.sourceResult && steering || !steering && memorySources.loading) return;
    const request = view.current;
    const key = { ...draftKey };
    const submitted = drafts.read(key);
    await perform(async () => {
      if (steering) {
        await dispatchCommand({ type: 'steer', args: [activeRun!.id, { meta: commandMeta(activeRun!.version), data: { text: submitted.text } }] }, { key, revision: submitted.revision, steering: true });
      } else {
        const command: UiCommand = { type: queueing ? 'enqueueUser' : 'startRun', args: [key.sessionId, { meta: commandMeta(), data: {
          agent_profile_id: agentId, model_profile_id: submitted.modelId, text: submitted.text, allow_managed: submitted.allowManaged,
          allow_follow_up: submitted.allowFollowUp, source_result: submitted.sourceResult, limits: submitted.limits,
          sources: { resource_ids: submitted.resourceIds, memory_scopes: memorySources.scopes, skill_versions: submitted.skillVersions, excluded_source_ids: submitted.excludedSourceIds },
        } }] };
        const submit = async () => {
          if (submitted.resourceIds.length) {
            const result = await client.resourceCoverage(key.sessionId, {
              resource_ids: submitted.resourceIds, model_profile_id: submitted.modelId });
            if (currentView(request)) setCoverage({ key: coverageKey, result });
            if (result.destination !== connection?.endpoint) throw new Error('接收方已变化，请刷新连接并核对发送目标。');
            if (!result.allowed) throw new Error('所选资料的读取或发送授权已失效，请重新授权。');
          }
          await dispatchCommand(command, { key, revision: submitted.revision, submitted });
        };
        if (submitted.resourceIds.length && !granted && resources.every(resource => resource.kind === 'file')) {
          await dispatchCommand({ type: 'grant', args: [{ meta: commandMeta(), data: {
            scope: { kind: 'session', workspace_id: key.workspaceId, session_id: key.sessionId },
            resource_ids: submitted.resourceIds, purposes: ['read', 'model_send'], destination: connection!.endpoint,
          } }] }, { key, afterConfirmed: submit });
        } else await submit();
      }
    });
  }

  async function selectResources(kind: 'file' | 'directory') {
    const request = view.current;
    setNativeSelecting(true);
    try {
      await onFormActiveChange?.(true);
      const selection = await invoke<{ resources: unknown[] }>('select_resources', { scope: { kind: 'session', workspace_id: workspaceId, session_id: sessionId }, kind });
      if (!currentView(request)) return;
      const selected = selection.resources.map(resource => validate('ResourceRef', resource));
      setProjection(state => mergeResources(state, selected));
      const key = { ...request };
      drafts.update(key, { resourceIds: [...new Set([...drafts.read(key).resourceIds, ...selected.map(resource => resource.id)])] });
    } finally { setNativeSelecting(false); }
  }

  function requestSettings(section: 'models' | 'resources' | 'memory') {
    setPanel(null); setResultsOpen(false);
    if (onSettings) { onSettings(section); return; }
    void perform(async () => { await onFormActiveChange?.(true); await openSettings(section); });
  }

  const commandStatus = <CommandStatus commands={pendingCommands.filter(command => commandContexts.current.has(command.commandId))} busy={busy} canCheck={command => !!commandContexts.current.get(command.commandId)!.key.sessionId} location={command => {
    const context = commandContexts.current.get(command.commandId)!;
    return `${projection.workspaces[context.key.workspaceId]?.name ?? '原工作区尚未同步'} · ${projection.sessions[context.key.sessionId]?.title ?? '原会话尚未同步'}`;
  }} onCheck={command => void perform(async () => { await applyOutcome(await store.check(command.commandId, commandContexts.current.get(command.commandId)!.key.sessionId)); })}
    onRetry={command => void perform(async () => { await applyOutcome(await store.retry(command.commandId)); })} />;

  return <main className={`workbench ${compact ? 'workbench--compact' : ''} ${panel ? 'workbench--detail' : ''}`}>
    <ProjectSidebar client={client} workspaceId={workspaceId} sessionId={sessionId} refreshKey={`${projection.cursor}:${Object.values(projection.sessions).map(item => `${item.id}:${item.version}`).join(',')}:${Object.values(projection.workspaces).map(item => `${item.id}:${item.version}`).join(',')}`} onTaskCenter={openTaskCenter} onCapabilities={() => openSkillLibrary('personal')} onMemory={() => {
      if (onMemory) onMemory(); else void perform(() => showWorkbench({ kind: 'memory' }));
    }} onAssistants={() => {
      if (onAssistants) onAssistants(); else void perform(() => showWorkbench({ kind: 'assistants' }));
    }} onPendingOpen={openPending} onPendingAction={pendingAction} onFormActiveChange={setSidebarFormActive} allowDirectoryCreation={!compact} deletedWorkspaceIds={Object.keys(projection.deletedWorkspaces)} deletedSessionIds={Object.keys(projection.deletedSessions)} onDefaultWorkspace={id => {
      defaultWorkspaceId.current = id;
      if (id && !userNavigated.current && view.current.workspaceId && view.current.workspaceId !== id && !scopeDeleted(store.getSnapshot(), { workspace_id: id, session_id: null })) chooseWorkspace(id);
    }} onNewSession={(id, returnFocus) => { userNavigated.current = true; newSession(id, returnFocus); }} onNavigate={navigateProject} onCreated={workspace => setProjection(state => mergeWorkspaces(state, [workspace]))} onSettings={() => requestSettings('models')}>
    <details className="workspace-picker"><summary>项目设置</summary><section aria-label="项目设置">
      <div className="privacy-actions"><Button disabled={!sessionId || busy} onClick={() => { const session = projection.sessions[sessionId]; setConfirmation({ kind: 'session', id: session.id, version: session.version, name: session.title }); }}>删除会话</Button>
        <Button disabled={!workspaceId || busy} onClick={() => { const workspace = projection.workspaces[workspaceId]; setConfirmation({ kind: 'workspace', id: workspace.id, version: workspace.version, name: workspace.name }); }}>删除工作区</Button></div>
      {!compact && projection.workspaces[workspaceId] && <ProjectDirectory client={client} workspace={projection.workspaces[workspaceId]} blocked={pendingCommands.some(command => command.type === 'setWorkspaceDirectory' && commandContexts.current.get(command.commandId)?.targetId === workspaceId)} onLink={(resource_id, version) => dispatchCommand({ type: 'setWorkspaceDirectory', args: [workspaceId, { meta: commandMeta(version), data: { resource_id } }] })} />}
    </section></details>
    </ProjectSidebar>
    <section className="conversation" inert={management !== undefined}><header ref={conversationHeader} className="conversation-header"><div><div className="assistant-identity">{agent && <span className="profile-symbol" aria-label="助理图标">{assistantIcons.find(icon => icon.id === agent.icon_id)?.symbol ?? agent.icon_id}</span>}<h1>{agent?.display_name ?? '主助理'}</h1></div><h2>{projection.sessions[sessionId]?.title ?? '从一件想完成的事开始'}</h2></div>
      <div className="button-row"><Button aria-pressed={resultsOpen} onClick={() => { setPanel(null); setResultsOpen(!resultsOpen); }}>结果{Object.values(projection.deliveries).some(entry => entry.target_session_id === sessionId && !entry.viewed_at) ? ' · 未读' : ''}</Button>{(['tasks', 'artifacts'] as const).map((name, index) => <Button key={name} data-conversation-panel={name} aria-pressed={panel === name} onClick={() => { setResultsOpen(false); setPanel(panel === name ? null : name); }}>{['任务', '产物'][index]}</Button>)}{!management && onReturnToQuick && <Button onClick={() => void perform(onReturnToQuick)}>返回快捷小窗</Button>}{headerActions}</div></header>
    {projection.sessions[sessionId] && <SessionActions client={client} session={projection.sessions[sessionId]} busy={busy || pendingCommands.some(command => ['stopSession', 'stopWorkspace', 'archiveSession'].includes(command.type))} onCommand={dispatchCommand} />}
    <p className={`connection-status ${['本机事件流已连接', '本机连接就绪', '操作已确认'].includes(status) ? 'connection-status--ready' : ''}`} role="status">{status}</p>
    {error && <details className="operation-error"><summary>上次操作未完成</summary><p role="alert">{error}</p></details>}
    {!management && commandStatus}
    <p className="sr-only" role="status" aria-live="polite">{completion}</p>
    <section ref={messageScroll} className="messages" aria-label="持久对话" onScroll={event => { scrollPositions.current.set(sessionId, event.currentTarget.scrollTop); }}><div className="thread">
      {!messageIds.length && <div className="welcome"><span className="welcome-icon" aria-hidden="true">✦</span><h2>把想法变成可追溯的成果</h2><p>聊一个问题，或选几份笔记，一起整理出下一步。</p>
        {!sessionId && <Button className="button--primary" onClick={() => newSession()}>开始新会话</Button>}
        {!Object.keys(projection.models).length && initialized && <section aria-label="首次配置"><p>先添加连接和模型，即可发送第一条消息。草稿会为你保留。</p><Button onClick={() => requestSettings('models')}>配置第一个模型</Button></section>}</div>}
      {feedbackQuery?.request === view.current && feedbackQuery.failed && <div className="status-message" role="status">
        <p>暂时无法读取本会话的消息反馈。</p>
        <button type="button" disabled={feedbackQuery.loading} onClick={() => setFeedbackRetry(value => value + 1)}>重新读取消息反馈</button>
      </div>}
      <MessageList client={client} store={store} messages={messageIds.map(id => projection.messages[id]).filter(Boolean)} assistantName={agent?.display_name ?? '主助理'}
        runs={runs} feedback={Object.values(projection.runFeedback).filter(item => item.session_id === sessionId
          && item.version >= (projection.runs[item.run_id]?.version ?? 0))}
        onOpenConnection={connection_id => void perform(() => showWorkbench({ kind: 'connection', connection_id }))}
        onOpenResults={() => { setPanel(null); setResultsOpen(true); }} />
      {historyCursor && <button disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.messages(sessionId, { cursor: historyCursor }); if (!currentView(request)) return; setHistoryCursor(page.next_cursor); setProjection(state => mergeMessages(state, sessionId, page.items)); })}>更多历史</button>}
      {Object.entries(projection.previews).filter(([id]) => projection.runs[projection.activities[id].run_id]?.interaction_session_id === sessionId).map(([id, chunks]) => <p key={id} aria-label="未提交预览" style={{ whiteSpace: 'pre-wrap' }}>临时预览：{Object.values(chunks).join('')}</p>)}
      {Object.entries(projection.reasoningPreviews).filter(([id]) => projection.runs[projection.activities[id].run_id]?.interaction_session_id === sessionId).map(([id, chunks]) => <details className="reasoning" key={id}><summary>推理 · 未提交预览</summary><p style={{ whiteSpace: 'pre-wrap' }}>{Object.values(chunks).join('')}</p></details>)}
      <section className="run-actions" aria-label="运行与待办">
        {todoCursors?.active_runs && <button disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.activeRuns(workspaceId, { cursor: todoCursors.active_runs! }); const details = await Promise.all(page.items.map(run => client.run(run.id))); if (view.current !== request) return; setProjection(state => details.reduce(mergeRunDetail, state)); setTodoCursors(current => current && ({ ...current, active_runs: page.next_cursor })); })}>更多运行</button>}
        {todoCursors?.pending_questions && <button disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.pendingQuestions(workspaceId, { cursor: todoCursors.pending_questions! }); const details = await Promise.all([...new Set(page.items.map(question => question.run_id))].map(id => client.run(id))); if (view.current !== request) return; setProjection(state => mergeQuestions(details.reduce(mergeRunDetail, state), page.items)); setTodoCursors(current => current && ({ ...current, pending_questions: page.next_cursor })); })}>更多问题</button>}
        {todoCursors?.pending_approvals && <button disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.pendingApprovals(workspaceId, { cursor: todoCursors.pending_approvals! }); const details = await Promise.all([...new Set(page.items.map(approval => approval.run_id))].map(id => client.run(id))); if (view.current !== request) return; setProjection(state => mergeApprovals(details.reduce(mergeRunDetail, state), page.items)); setTodoCursors(current => current && ({ ...current, pending_approvals: page.next_cursor })); })}>更多审批</button>}
        <ManagedTaskStrip runs={runs} intents={Object.values(projection.followUpIntents).filter(intent => intent.target_session_id === sessionId)} busy={busy}
          onOpen={id => projection.runs[id].kind === 'follow_up' ? selectRun(id) : openTask(id)}
          onQuestion={id => void perform(() => openBackground(id))} onStop={run => void perform(() => dispatchCommand({ type: 'cancel', args: [run.id, commandMeta(run.version)] }))} />
        <PendingUserCommands commands={sessionCommands} runs={projection.runs} onOpen={id => void perform(async () => {
          const request = view.current, detail = await client.run(id);
          if (currentView(request)) { setProjection(state => mergeRunDetail(state, detail)); selectRun(id); }
        })} />
        {runs.filter(run => run.kind !== 'managed').map(run => <article className="run-state" key={run.id}><Status state={run.state} />{run.reason && run.reason !== 'user_cancelled' && !Object.hasOwn(modelFailures, run.reason) && <details><summary>本轮运行诊断</summary><p>{run.reason}</p></details>}
          {run.output && <section className="run-output delivery"><h3>任务交付摘要</h3><Markdown>{run.output.summary}</Markdown>{run.output.unresolved.length > 0 && <ul>{run.output.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul>}</section>}
          {['interrupted', 'blocked_incompatible', 'waiting_user'].includes(run.state) && <p className="muted">恢复与阻塞的当前允许操作请见“待办”；不会按状态猜测恢复权限。</p>}
        </article>)}
        {questions.map(question => <p key={question.id}>有待回答的问题 <button onClick={() => { setInteractionId(question.id); setInteractionCollapsed(false); }}>回答问题</button></p>)}
        {Object.values(projection.questions).filter(question => question.status !== 'pending' && projection.runs[question.run_id]?.interaction_session_id === sessionId).flatMap(question => Object.entries(questionDrafts).filter(([key, draft]) => key.startsWith(`${question.id}:`) && draft.value !== undefined).map(([key, draft]) => <p key={key}>问题已处理，未提交的回答已保留：{typeof draft.value === 'string' ? draft.value : JSON.stringify(draft.value)}</p>))}
      </section>
    </div></section>
    <div className="composer-wrap"><div className="composer-inner">
    {composerSummary && <div className="composer-summary" key={composerRun?.id}><RunCostSummary summary={composerSummary.cost_summary} disclosureName={summaryDisclosureName} />
      <ContextNotice usage={composerSummary.context_usage} disclosureName={summaryDisclosureName} onInspectRun={() => openTask(composerRun!.id)} /></div>}
    {interactions.length > 1 && <label className="interaction-picker">当前待办 <select value={interaction?.id} onChange={event => { setInteractionId(event.target.value); setInteractionCollapsed(false); }}>{interactions.map(item => <option key={item.id} value={item.id}>{item.title}{item.kind === 'question' ? `：${item.question.question}` : ''}</option>)}</select></label>}
    {backgroundInteraction && <div className="background-return"><p>仅处理原后台任务；当前会话、草稿和本次配置不变。</p><button onClick={returnFromBackground}>返回原页与草稿</button></div>}
    {interaction && <InteractionPanel item={interaction} collapsed={interactionCollapsed} onCollapse={() => setInteractionCollapsed(value => !value)}>
    {interaction.kind === 'question' && (() => {
      const question = interaction.question, key = `${question.id}:${question.version}`;
      const answerDraft = questionDrafts[key] ?? { value: undefined, revision: 0 };
      const returnTarget = backgroundReturn.current;
      return <QuestionForm key={key} question={question} value={answerDraft.value} onChange={value => setQuestionDrafts(current => ({ ...current, [key]: { value, revision: (current[key]?.revision ?? 0) + 1 } }))}
        onCancel={() => void perform(() => { const run = projection.runs[question.run_id]; return dispatchCommand({ type: 'cancel', args: [run.id, commandMeta(run.version)] }, { key: { workspaceId: run.workspace_id, sessionId: run.interaction_session_id ?? '' } }); })}
        busy={busy || unconfirmed('answer', question.id)} onSubmit={answer => void perform(() => dispatchCommand({ type: 'answer', args: [question.id, { meta: commandMeta(question.version), data: { answer } }] }, {
          key: { workspaceId: projection.runs[question.run_id].workspace_id, sessionId: projection.runs[question.run_id].interaction_session_id! },
          afterConfirmed: async () => { setQuestionDrafts(current => current[key]?.revision === answerDraft.revision ? { ...current, [key]: { value: undefined, revision: answerDraft.revision + 1 } } : current); if (returnTarget && backgroundReturn.current === returnTarget) returnFromBackground(); },
        }))} />;
    })()}
    {interaction.kind === 'approval' && <ApprovalCard approval={interaction.approval} busy={busy || unconfirmed('decide', interaction.approval.id)} onDecision={allow => {
      const returnTarget = backgroundReturn.current;
      return perform(() => dispatchCommand({ type: 'decide', args: [interaction.approval.id, { meta: commandMeta(interaction.approval.version), data: { allow } }] }, { key: { workspaceId: interaction.approval.workspace_id, sessionId: interaction.approval.session_id ?? '' }, afterConfirmed: async () => { if (returnTarget && backgroundReturn.current === returnTarget) returnFromBackground(); } }));
    }} />}
    {interaction.kind === 'recovery' && <RecoveryPanel publications={publications} busy={busy} isPending={id => pendingCommands.some(command => ['restoreExport', 'releaseExport'].includes(command.type) && commandContexts.current.get(command.commandId)?.targetId === id)} onCommand={(type, item) => dispatchCommand({ type, args: [item.id, commandMeta(item.version)] }, { key: { workspaceId: item.workspace_id, sessionId: item.session_id } })} />}
    {interaction.kind === 'scope' && <section className="resource-bar" aria-label="资料选择"><div className="interaction-body">
      {resourcesSyncing && <p>资料与授权同步中；尚未加载的授权状态未知。</p>}
      {currentCoverage?.error && <p role="alert">{currentCoverage.error}<button onClick={() => setCoverageRevision(value => value + 1)}>重新核对授权</button></p>}
      {resourceCursors?.resources && <button disabled={busy || !sessionId} onClick={() => perform(() => loadResourcePage('resources'))}>更多资料</button>}
      {resourceCursors?.grants && <button disabled={busy || !sessionId} onClick={() => perform(() => loadResourcePage('grants'))}>更多授权</button>}
      <ul>{draft.resourceIds.map(id => <li key={id}>{projection.resources[id]?.label ?? `资料尚未同步 · ${id}`} <button aria-label="移除本次附件" disabled={busy || configurationLocked} onClick={() => drafts.update(draftKey, { resourceIds: draft.resourceIds.filter(item => item !== id) })}>移除本次附件</button></li>)}</ul>
      <p>点击发送即同意本次读取所列文件并发送至：{connection ? `${connection.display_name} · ${connection.endpoint}` : model ? '连接尚未同步，无法确认目的地' : '请先选择模型'}。目录范围需要另行授权。</p></div><footer className="interaction-footer"><button disabled={busy || !connection || granted || resourcesSyncing || resources.length !== draft.resourceIds.length || configurationLocked || unconfirmed('grant')} onClick={() => perform(() => dispatchCommand({ type: 'grant', args: [{ meta: commandMeta(), data: { scope: { kind: 'session', workspace_id: workspaceId, session_id: sessionId }, resource_ids: draft.resourceIds as [string, ...string[]], purposes: ['read', 'model_send'], destination: connection.endpoint } }] }))}>{granted ? '当前范围已授权' : resourcesSyncing ? '授权状态同步中' : '授权读取并发送'}</button></footer>
    </section>}
    </InteractionPanel>}
    {interaction?.kind !== 'scope' && <div className="resource-pagination">{resourceCursors?.resources && <button onClick={() => perform(() => loadResourcePage('resources'))}>更多资料</button>}{resourceCursors?.grants && <button onClick={() => perform(() => loadResourcePage('grants'))}>更多授权</button>}</div>}
    {activeRun?.kind === 'follow_up' && !activeRun.yield_requested && !activeRun.follow_up_closed && <fieldset className="configuration-row" disabled={busy}><legend>本次输入</legend>
      <label><input type="radio" name={`summary-mode-${summaryDisclosureName}`} checked={!editingSummary} onChange={() => drafts.update(draftKey, { summaryRunId: null })} />新目标（默认排队）</label>
      <label><input type="radio" name={`summary-mode-${summaryDisclosureName}`} disabled={!!draft.sourceResult} checked={editingSummary} onChange={() => drafts.update(draftKey, { summaryRunId: activeRun.id })} />修改这个总结</label>
    </fieldset>}
    {draft.sourceResult && <section className="resource-bar" aria-label="本次总结引用"><p>本次将总结所选交付结果 · 结果版本 {sourceResult?.result_version ?? '待同步'}</p>
      <p>使用本次模型、资料与限额创建新的用户任务。</p>{sourceResultInvalid && <p role="alert">总结引用已失效或尚未同步，请重新选择结果</p>}
      <button disabled={busy} onClick={() => drafts.update(draftKey, { sourceResult: null })}>移除总结引用</button></section>}
    {Object.keys(draft.skillVersions).length > 0 && <section aria-label="新目标的 Skill 版本" className="skill-pins">
      {Object.entries(draft.skillVersions).map(([id, hash]) => <span key={id}>{skillNames[`${id}:${hash}`] ?? `Skill ${id}`} · {hash.slice(0, 12)}
        <button type="button" aria-label={`移除 Skill ${skillNames[`${id}:${hash}`] ?? id}`} onClick={() => {
          const skillVersions = { ...draft.skillVersions }; delete skillVersions[id]; drafts.update(draftKey, { skillVersions });
        }}>×</button></span>)}
      {steering && <p>这些版本为新目标保留；补充指令沿当前运行原版本。</p>}
    </section>}
    {defaultModelLoading && <p role="status" id="default-model-status">正在加载默认模型…</p>}
    {defaultModelError && <div id="default-model-status"><p role="alert">{defaultModelError}</p><Button onClick={() => retryModelLookup(value => value + 1)}>重试加载默认模型</Button></div>}
    <Composer value={text} onChange={setText} onSubmit={send} steering={!!canSteer} queueing={queueing}
      onStop={activeRun ? () => void perform(() => dispatchCommand({ type: 'cancel', args: [activeRun.id, commandMeta(activeRun.version)] })) : undefined}
      stopDisabled={busy || !!activeRun && unconfirmed('cancel', activeRun.id)}
      blockedReason={!Object.keys(projection.models).length ? '还没有配置模型，请打开模型设置' : !modelId ? '在输入区选择本次使用的模型' : !sessionId ? '先新建一个会话' : projection.sessions[sessionId]?.archived ? '会话已归档；取消归档后可发送，草稿已保留' : draft.sourceResult && steering ? '当前用户任务结束后可总结所选结果，草稿已保留' : steering && !canSteer ? activeRoot?.kind === 'tool' ? '导出结束后可发送；也可另开会话' : '正在同步当前运行类型，草稿已保留' : pendingSubmission ? '请先核对上次提交，草稿已保留' : undefined}
      toolbar={<div className="composer-toolbar">
        <button type="button" className="attachment-button" aria-label="选择文本文件" title="选择文本文件" disabled={busy || !sessionId || configurationLocked} onClick={() => perform(() => selectResources('file'))}>♧</button>
        <button type="button" className="attachment-button" aria-label="选择目录" title="选择目录" disabled={busy || !sessionId || configurationLocked} onClick={() => perform(() => selectResources('directory'))}>▱</button>
        <button type="button" disabled={!sessionId} onClick={() => openSkillLibrary('project')}>选择 Skill</button>
        <select aria-label="模型" aria-busy={defaultModelLoading} aria-invalid={!!defaultModelError || undefined} aria-describedby={defaultModelLoading || defaultModelError ? 'default-model-status' : undefined} title={connection ? `${connection.display_name} · ${connection.endpoint}` : '连接尚未同步'} value={modelId} disabled={busy || configurationLocked} onChange={event => setModelId(event.target.value)}><option value="">请选择模型</option>{modelId && !model && <option value={modelId}>默认模型{defaultModelError ? '（加载失败）' : '（加载中）'}</option>}{Object.values(projection.models).map(model => <option key={model.id} value={model.id}>{model.display_name ?? model.model_id} · {projection.connections[model.connection_id]?.display_name ?? '连接尚未同步'}</option>)}</select>
        <details className="composer-options"><summary aria-label="运行配置" title="运行配置">⋯</summary><div className="composer-options-panel">
          <fieldset className="configuration-row" disabled={busy || configurationLocked}><legend>新运行的配置（当前运行固定原配置）</legend>
            <label><input type="checkbox" checked={draft.allowManaged} onChange={event => drafts.update(draftKey, { allowManaged: event.target.checked })} />允许本次转为独立后台任务</label>
            <label><input type="checkbox" checked={draft.allowFollowUp} onChange={event => drafts.update(draftKey, { allowFollowUp: event.target.checked })} />完成后自动总结</label>
            <fieldset><legend>本次记忆范围</legend>
              {([['user_global', '本次读取个人记忆'], ['workspace', '本次读取项目记忆']] as const).map(([kind, label]) =>
                <label key={kind}><input type="checkbox" checked={draft.memoryScopes.some(scope => scope.kind === kind)}
                  onChange={event => drafts.update(draftKey, { memoryScopes: event.target.checked
                    ? [...draft.memoryScopes, kind === 'user_global' ? personalScope : { kind, workspace_id: workspaceId, session_id: null }]
                    : draft.memoryScopes.filter(scope => scope.kind !== kind) })} />{label}</label>)}
              {!draft.memoryScopes.length && <p>未选择记忆范围，本次不读取长期记忆。</p>}
              {memorySources.descriptions.map(description => <p key={description}>{description}</p>)}
              {memorySources.records.length > 0 && <details><summary>本次排除单条记忆</summary>
                {memorySources.records.map(record => <label key={record.id}><input type="checkbox" checked={draft.excludedSourceIds.includes(record.id)}
                  onChange={event => drafts.update(draftKey, { excludedSourceIds: event.target.checked ? [...draft.excludedSourceIds, record.id]
                    : draft.excludedSourceIds.filter(id => id !== record.id) })} />本次排除：{record.text}</label>)}
              </details>}
              {draft.excludedSourceIds.length > 0 && <p>本次明确排除 {draft.excludedSourceIds.length} 条记忆。</p>}
              {memorySources.error && <p role="alert">{memorySources.error}</p>}
              <p>切换模型将重新核对目的地；补充指令沿当前运行原范围。</p>
              <button type="button" onClick={() => requestSettings('memory')}>记忆读取与授权设置</button>
              <p>可将本次记忆范围和 Skill 版本记为当前项目、当前模型地址的偏好；有效授权仍逐次复核。</p>
              <button type="button" disabled={!connection} onClick={() => {
                try { drafts.rememberPreference(draftKey, connection!.endpoint); } catch (error) { report(error); }
              }}>记住本项目的来源偏好</button>
              <button type="button" disabled={!connection} onClick={() => {
                try { drafts.forgetPreference(draftKey, connection!.endpoint); } catch (error) { report(error); }
              }}>清除本项目的来源偏好</button>
            </fieldset>
            <details><summary>本次限额</summary>
              {([['max_model_requests', '模型请求上限'], ['max_steps', '步骤上限'], ['max_tasks', '任务上限'], ['max_total_tokens', '总 Token 上限'],
                ['deadline_seconds', '时限（秒）'], ['max_delegation_depth', '委派深度上限'], ['max_parallel_agents', '并行成员上限']] as const).map(([key, label]) => <label key={key}>{label}
                <input type="number" min={key === 'deadline_seconds' ? '0.001' : '0'} step={key === 'deadline_seconds' ? 'any' : '1'} max={Number.MAX_SAFE_INTEGER}
                  placeholder="使用默认限制" value={draft.limits[key] ?? ''} onChange={event => drafts.update(draftKey, { limits: { ...draft.limits, [key]: event.target.value === '' ? undefined : event.target.valueAsNumber } })} /></label>)}
              <label>费用上限（记账单位）<input inputMode="numeric" pattern="(0|[1-9][0-9]*)" placeholder="使用默认限制" value={draft.limits.max_cost_units ?? ''}
                onChange={event => drafts.update(draftKey, { limits: { ...draft.limits, max_cost_units: event.target.value || undefined } })} /></label>
            </details>
            <label>助理 <select value={agentId} onChange={event => { setAgentId(event.target.value); setModelId(projection.profiles[event.target.value].default_model_profile_id ?? ''); }}>{Object.values(projection.profiles).map(profile => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>
            {profilePage?.next_cursor && <button type="button" onClick={() => perform(async () => { const page = await client.profiles({ cursor: profilePage.next_cursor! }); setProfilePage(page); setProjection(state => ({ ...state, profiles: mergeVersioned(state.profiles, page.items) })); })}>更多助理</button>}
            <button type="button" onClick={() => perform(async () => { const page = await client.models(modelPage?.next_cursor ? { cursor: modelPage.next_cursor } : {}); setModelPage(page); setProjection(state => ({ ...state, models: mergeVersioned(state.models, page.items) })); })}>{modelPage?.next_cursor ? '更多模型' : '刷新模型'}</button>
            <button type="button" onClick={() => perform(async () => { const page = await client.connections(connectionPage?.next_cursor ? { cursor: connectionPage.next_cursor } : {}); setConnectionPage(page); setProjection(state => ({ ...state, connections: mergeVersioned(state.connections, page.items) })); })}>{connectionPage?.next_cursor ? '更多连接' : '刷新连接'}</button>
          </fieldset>
          <button type="button" onClick={() => setPanel(panel === 'resources' ? null : 'resources')}>管理授权</button>
        </div></details>
        <button type="button" aria-label="模型设置" title="模型设置" onClick={() => requestSettings('models')}>⚙</button>
      </div>}
      disabled={busy || workReadySession !== sessionId || projection.sessions[sessionId]?.archived || pendingSubmission || !!steering && !canSteer || !sessionId || !text.trim()
          || sourceResultInvalid || !!draft.sourceResult && !!steering || (!steering && (memorySources.loading || !agent || !model || draft.resourceIds.length !== resources.length || (draft.resourceIds.length > 0 && (!connection || !currentCoverage?.result || (!granted && resources.some(resource => resource.kind !== 'file'))))))} />
    </div></div>
    </section>
    <Sheet open={!!panel || resultsOpen} onOpenChange={open => { if (!open) { setPanel(null); setResultsOpen(false); } }}><SheetContent onOpenAutoFocus={() => { panelOrigin.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={returnPanelFocus} onEscapeKeyDown={event => { if (event.isComposing || event.keyCode === 229) event.preventDefault(); }}><header className="panel-header"><SheetTitle asChild><h2>{resultsOpen ? '后台交付结果' : panel ? { tasks: '任务详情', artifacts: '产物', trace: 'Trace', resources: '管理授权' }[panel] : '会话详情'}</h2></SheetTitle><Button aria-label="关闭详情" onClick={() => { setPanel(null); setResultsOpen(false); }}>×</Button></header>
      {resultsOpen && sessionId && <ResultInbox client={client} store={store} sessionId={sessionId} onCommand={dispatchCommand} onOpen={id => { setResultsOpen(false); openTask(id); }}
        summaryBlocked={busy || pendingSubmission || activeRun?.kind === 'user' || projection.sessions[sessionId]?.archived}
        onSummarize={entry => { drafts.update(draftKey, { sourceResult: entry.id, summaryRunId: null }); setResultsOpen(false); requestAnimationFrame(() => document.getElementById('message-input')?.focus()); }} />}
      {panel === 'resources' && workspaceId && <ResourcePanel client={client} workspaceId={workspaceId} sessionId={sessionId || null} refreshKey={Object.values(projection.grants).map(item => `${item.id}:${item.version}`).join(',') + Object.values(projection.scopes).map(item => `${item.id}:${item.epoch}`).join(',')} isRevokePending={id => pendingCommands.some(command => command.type === 'revoke' && commandContexts.current.get(command.commandId)?.targetId === id)} onGrantsLoaded={items => setProjection(state => mergeGrants(state, items))} onRevoke={(id, meta) => dispatchCommand({ type: 'revoke', args: [id, meta] })} />}
      {panel === 'tasks' && summary && <RunCostSummary key={selectedRun?.id} summary={summary.cost_summary} disclosureName={`${summaryDisclosureName}-task`} />}
      {panel === 'tasks' && <><div className="button-row"><Button aria-pressed={graph} onClick={() => setGraph(true)}>任务图</Button><Button aria-pressed={!graph} onClick={() => setGraph(false)}>任务列表</Button></div>
        <section className="run-navigation" aria-label="会话任务"><h3>会话任务</h3>{runs.map(run => <Button key={run.id} className="run-nav" onClick={() => selectRun(run.id)}><span>{run.output?.summary || '会话任务'}</span><Status state={run.state} /></Button>)}
          {runListCursor && <Button disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.sessionRuns(sessionId, { cursor: runListCursor }); if (!currentView(request)) return; setProjection(state => page.items.reduce(mergeRunSnapshot, state)); setRunListCursor(page.next_cursor); })}>更多会话任务</Button>}
        </section><Button onClick={() => setPanel('trace')}>查看 Trace</Button>
        {selectedRun && <details className="muted"><summary><Status state={selectedRun.state} /> · 运行信息</summary><code>{selectedRun.id}</code></details>}
        {graph ? <TaskGraph tasks={tasks} activities={activities} waits={Object.values(projection.waits).filter(item => item.run_id === selectedRun?.id)}
          consumptions={Object.values(projection.consumptions).filter(item => item.run_id === selectedRun?.id)} joins={Object.values(projection.joins).filter(item => item.run_id === selectedRun?.id)}
          collapsedIds={collapsed} selectedId={selectedNode?.id} onSelect={(id, kind) => setSelectedNode({ id, kind })} onToggle={id => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />
          : <TaskList tasks={tasks} activities={activities} selectedId={selectedNode?.id} onSelect={(id, kind) => setSelectedNode({ id, kind })} />}
        {selectedNode && [...tasks, ...activities].some(item => item.id === selectedNode.id) && <section className="entity-detail"><h3>{selectedNode.kind === 'task' ? 'Task' : 'Activity'} <code>{selectedNode.id}</code></h3>
          <pre>{JSON.stringify(selectedNode.kind === 'task' ? projection.tasks[selectedNode.id] : projection.activities[selectedNode.id], null, 2)}</pre>
          <Button onClick={() => setPanel('trace')}>查看对应 Trace</Button>
          {artifacts.filter(item => item.task_id === selectedNode.id || item.activity_id === selectedNode.id).map(item => <Button key={item.id} onClick={() => { setArtifactId(item.id); setPanel('artifacts'); }}>查看来源产物 {item.id}</Button>)}
        </section>}
        {selectedRun && Object.entries(runCursors[selectedRun.id] ?? {}).filter(([, cursor]) => cursor).map(([kind]) => <Button key={kind} disabled={busy} onClick={() => perform(() => loadRunPage(kind as RunPageInput['kind']))}>更多 {kind}</Button>)}
      </>}
      {panel === 'artifacts' && <><div className="artifact-links">{artifacts.map((artifact, index) => <Button key={artifact.id} onClick={() => setArtifactId(artifact.id)}>{artifact.media_type === 'application/octet-stream' ? '二进制文件' : artifact.media_type === 'text/markdown' ? 'Markdown 文档' : '文本产物'} {index + 1}</Button>)}</div><ArtifactPanel artifact={selectedArtifact} client={client} onExport={chooseExport} exportBlocked={nativeSelecting || pendingCommands.some(command => command.type === 'exportArtifact' && commandContexts.current.get(command.commandId)?.targetId === selectedArtifact?.id || command.type === 'grant' && !!commandContexts.current.get(command.commandId)?.afterConfirmed)} onSelectSource={(taskId, activityId) => void perform(async () => {
        const request = view.current;
        const task = projection.tasks[taskId] ?? await client.task(taskId);
        if (currentView(request)) {
          if (compact) await showWorkbench({ kind: 'task', task_id: task.id });
          else { setSelectedNode({ id: activityId, kind: 'activity' }); setSelectedRunId(task.run_id); setPanel('trace'); }
        }
      })} /></>}
      {panel === 'trace' && <TracePanel events={tracePage?.items ?? []} selectedId={selectedNode?.id} onSelect={(id, kind) => setSelectedNode({ id, kind })} nextCursor={tracePage?.next_cursor} loading={busy}
        onLoadMore={() => void perform(async () => { const request = view.current, owner = trace!; const page = await client.trace(owner.runId, { cursor: owner.page.next_cursor! });
          if (currentView(request)) setTrace(current => current === owner ? { runId: owner.runId, page: { ...page,
            items: [...new Map([...owner.page.items, ...page.items].map(item => [item.event_id, item])).values()]
              .sort((left, right) => BigInt(left.event_id) < BigInt(right.event_id) ? -1 : BigInt(left.event_id) > BigInt(right.event_id) ? 1 : 0) } } : current); })} />}
    </SheetContent></Sheet>
    {management && <section className="task-management" aria-label="任务管理页面"><header className="panel-header"><button onClick={() => setManagement('center')}>返回任务中心</button><button onClick={closeManagement}>返回对话与草稿</button></header>
      {onReturnToQuick && <button onClick={() => void perform(onReturnToQuick)}>返回快捷小窗</button>}
      {commandStatus}
      <div hidden={management !== 'center'}><TaskCenter key={centerTarget.sequence} client={client} workspaceId={centerTarget.workspaceId}
        workspaces={Object.values(projection.workspaces)} onOpen={openTask} onOrganize={onMemory ? source => onMemory(source) : undefined} /></div>
      {management === 'detail' && <TaskDetail key={managedRunId} client={client} store={store} runId={managedRunId} onCommand={(command, key) => dispatchCommand(command, { key })} onQuestion={id => void perform(() => openBackground(id))} onOpen={openTask}
        onExport={chooseExport} exportBlocked={nativeSelecting || pendingCommands.some(command => command.type === 'exportArtifact' || command.type === 'grant' && !!commandContexts.current.get(command.commandId)?.afterConfirmed)} />}
    </section>}
    {skillLibrary && <CapabilityLibrary compact={compact} mcpTarget={skillLibrary.mcpTarget} mcpRevision={projection.mcpRevision}
      initialMcpScope={skillLibrary.mcpScope}
      onReturnToQuick={onReturnToQuick} client={client} workspaceId={skillLibrary.key.workspaceId || undefined} refreshKey={projection.skillsRevision}
      initialRecovery={skillLibrary.recovery} onClose={closeSkillLibrary}
      onUse={skillLibrary.key.sessionId ? async version => {
        const originalKey = { ...skillLibrary.key };
        const selected = await client.resolveSkills({ scope: { kind: 'workspace', workspace_id: originalKey.workspaceId, session_id: null },
          versions: { [version.skill_id]: version.content_hash } });
        if (!store.getSnapshot().sessions[originalKey.sessionId] || scopeDeleted(store.getSnapshot(), { workspace_id: originalKey.workspaceId, session_id: originalKey.sessionId })) {
          throw new Error('原会话已不可用，未修改其他草稿');
        }
        setSkillNames(current => ({ ...current, ...Object.fromEntries(selected.entries.map(item => [`${item.skill_id}:${item.content_hash}`, item.name])) }));
        drafts.update(originalKey, { skillVersions: { ...drafts.read(originalKey).skillVersions, ...selected.versions } });
        closeSkillLibrary();
      } : undefined} />}
    {newSessionWorkspace !== undefined && <Dialog title="新建会话" onReturnFocus={() => sessionReturnFocus.current?.()} onClose={() => { if (!busy) closeNewSession(); }}><form onSubmit={event => { event.preventDefault(); void perform(async () => {
      const session = await client.createSession(newSessionWorkspace, { meta: commandMeta(), data: { title: sessionTitle } });
      const next = setProjection(state => mergeSessions(state, [session]));
      if (next.sessions[session.id]) {
        if (view.current.workspaceId !== session.workspace_id) chooseWorkspace(session.workspace_id);
        chooseSession(session.id); navigationTarget.current = { session }; setWorkspaceGeneration(value => value + 1);
      }
      sessionReturnFocus.current = () => document.getElementById('message-input')?.focus();
      closeNewSession();
    }); }}><label>新会话标题 <input autoFocus required value={sessionTitle} onChange={event => setSessionTitle(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}<div className="button-row"><Button disabled={busy} onClick={closeNewSession}>取消</Button><Button type="submit" className="button--primary" disabled={busy || !newSessionWorkspace}>创建会话</Button></div>
    </form></Dialog>}
    {confirmation && <Dialog title="确认隐私删除" onClose={() => { if (!busy) setConfirmation(undefined); }}>
      <p>删除“{confirmation.name}”中的本地内容、产物引用和运行记录。逻辑删除立即生效；被占用文件的清理会在后续回收时重试。未完成的导出恢复必须先处理；不会删除外部目标或备份。</p>
      <div className="button-row"><Button disabled={busy} onClick={() => setConfirmation(undefined)}>取消</Button><Button className="button--primary" disabled={busy} onClick={() => void confirm()}>确认删除</Button></div>
    </Dialog>}
  </main>;
}
