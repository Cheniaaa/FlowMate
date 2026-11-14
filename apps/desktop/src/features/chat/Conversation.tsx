import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, commandMeta, RuntimeClient } from '../../api/client';
import { mergeApprovals, mergeGrants, mergeMessages, mergePublications, mergeQuestions, mergeResources, mergeRunDetail, mergeRunPage, mergeRunSnapshot, mergeSessions, mergeVersioned, mergeWorkspaces, orderedMessageIds, scopeDeleted, terminal, type RunPageInput } from '../../api/events';
import { validate } from '../../api/validation';
import { openSettings } from '../../api/windows';
import type { AgentProfilePage, AnswerCommand, ArtifactRef, ModelConnectionPage, ModelProfilePage, ResourceRef, Session, WorkspaceSnapshot } from '../../generated/contracts';
import { createRuntimeStore, uiCommandId, type CommandOutcome, type UiCommand } from '../../state/runtime-store';
import { createDraftStore, type DraftKey } from '../../state/draft-store';
import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import Status from '../../components/Status';
import { assistantIcons } from '../../components/assistant-icons';
import Markdown from '../../components/Markdown';
import ArtifactPanel from '../artifacts/ArtifactPanel';
import { TaskGraph } from '../tasks/TaskGraph';
import { TaskList } from '../tasks/TaskList';
import { TracePanel } from '../trace/TracePanel';
import { Inbox } from '../notifications/Inbox';
import Composer from './Composer';
import ApprovalCard from './ApprovalCard';
import QuestionForm from './QuestionForm';
import InteractionPanel from './InteractionPanel';
import ResourcePanel from './ResourcePanel';
import MessageList from './MessageList';
import RecoveryPanel from './RecoveryPanel';
import RunCostSummary from './RunCostSummary';
import ContextNotice from './ContextNotice';
import ProjectSidebar, { type ProjectNavigation } from '../navigation/ProjectSidebar';
import ProjectDirectory from '../navigation/ProjectDirectory';

type Confirmation = { kind: 'session' | 'workspace'; id: string; version: number; name: string };

export interface WorkbenchNavigation { runId: string; sequence: number }
interface ConversationProps {
  client: RuntimeClient;
  compact?: boolean;
  navigation?: WorkbenchNavigation;
  onSelectedRunChange?: (id: string | null) => void;
  onFormActiveChange?: (active: boolean) => Promise<void>;
  onSettings?: (section: 'models' | 'resources') => void;
  headerActions?: ReactNode;
}

export function Conversation({ client, compact = false, navigation, onSelectedRunChange, onFormActiveChange, onSettings, headerActions }: ConversationProps) {
  const summaryDisclosureName = useId();
  const store = useMemo(() => createRuntimeStore(client), [client]);
  const drafts = useMemo(() => createDraftStore(), [client]);
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const pendingCommands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const setProjection = store.update;
  const view = useRef({ workspaceId: '', sessionId: '' });
  const defaultWorkspaceId = useRef<string | null | undefined>(undefined);
  const userNavigated = useRef(false);
  const navigationTarget = useRef<{ session: Session; runId?: string } | undefined>(undefined);
  const [initialized, setInitialized] = useState(false);
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0);
  const [nativeSelecting, setNativeSelecting] = useState(false);
  const [workspaceCursor, setWorkspaceCursor] = useState<string | null>(null);
  const [profilePage, setProfilePage] = useState<AgentProfilePage>();
  const [modelPage, setModelPage] = useState<ModelProfilePage>();
  const [connectionPage, setConnectionPage] = useState<ModelConnectionPage>();
  const [sessionCursor, setSessionCursor] = useState<string | null>(null);
  const [todoCursors, setTodoCursors] = useState<Record<'active_runs' | 'pending_approvals' | 'pending_questions', string | null>>();
  const [resourceCursors, setResourceCursors] = useState<Record<'resources' | 'grants', string | null>>();
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [agentId, setAgentId] = useState('');
  const defaultModelId = useRef('');
  const [snapshotGeneration, setSnapshotGeneration] = useState(0);
  const [workspaceName, setWorkspaceName] = useState('');
  const [managingWorkspace, setManagingWorkspace] = useState(false);
  const [sidebarFormActive, setSidebarFormActive] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const draftKey = { workspaceId, sessionId };
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.read(draftKey));
  const { text, modelId } = draft;
  const resources = draft.resourceIds.map(id => projection.resources[id]).filter(Boolean);
  const setText = (text: string) => { userNavigated.current = true; drafts.update(draftKey, { text }); };
  const setModelId = (modelId: string) => { userNavigated.current = true; drafts.update(draftKey, { modelId }); };
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, { value: AnswerCommand['data']['answer'] | undefined; revision: number }>>({});
  const [interactionId, setInteractionId] = useState('');
  const [interactionCollapsed, setInteractionCollapsed] = useState(false);
  const commandContexts = useRef(new Map<string, { key: DraftKey; revision?: number; targetId?: string; afterConfirmed?: () => Promise<void> }>());
  const [artifactId, setArtifactId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedNode, setSelectedNode] = useState<{ id: string; kind: 'task' | 'activity' }>();
  const [panel, setPanel] = useState<'tasks' | 'artifacts' | 'trace' | 'resources' | null>(null);
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

  function chooseSession(id: string) {
    navigationTarget.current = undefined;
    view.current = { workspaceId: view.current.workspaceId, sessionId: id };
    const key = { workspaceId: view.current.workspaceId, sessionId: id };
    if (id && drafts.read(key).revision === 0) drafts.update(key, { modelId: defaultModelId.current });
    setSessionId(id); setHistoryCursor(null); setArtifactId('');
    setSelectedRunId(''); setSelectedNode(undefined); setTrace(undefined); setRunCursors({}); setRunListCursor(null); setConfirmation(undefined);
  }

  function chooseWorkspace(id: string) {
    view.current = { workspaceId: id, sessionId: '' };
    setWorkspaceId(id); chooseSession(''); setSessionCursor(null); setTodoCursors(undefined); setResourceCursors(undefined); setSessionTitle('');
  }

  function currentView(request: typeof view.current) {
    return view.current === request && !!store.getSnapshot().sessions[request.sessionId]
      && !scopeDeleted(store.getSnapshot(), { workspace_id: request.workspaceId, session_id: request.sessionId });
  }

  const report = (error: unknown) => setError(error instanceof ApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : '宿主操作失败');
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
      if (context.revision !== undefined) drafts.acknowledge(context.key, context.revision);
      const afterConfirmed = context.afterConfirmed;
      context.afterConfirmed = undefined;
      await afterConfirmed?.();
    }
    if (view.current.workspaceId === context.key.workspaceId && view.current.sessionId === context.key.sessionId) {
      setStatus(outcome.status === 'unconfirmed' ? '命令待核对' : outcome.sync === 'pending' ? '操作已接收，正在同步状态' : '操作已确认');
    }
  }

  async function dispatchCommand(command: UiCommand, options: { key?: DraftKey; revision?: number; afterConfirmed?: () => Promise<void> } = {}) {
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
      setWorkspaceCursor(workspaces.next_cursor); setProfilePage(profiles); setModelPage(models); setConnectionPage(connections);
      const next = setProjection(state => mergeWorkspaces({ ...state, profiles: mergeVersioned(state.profiles, profiles.items), models: mergeVersioned(state.models, models.items), connections: mergeVersioned(state.connections, connections.items) }, workspaces.items));
      defaultModelId.current = profiles.items[0]?.default_model_profile_id ?? '';
      chooseWorkspace(defaultWorkspaceId.current ?? Object.keys(next.workspaces)[0] ?? '');
      setAgentId(profiles.items[0]?.id ?? '');
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
      const detail = await client.run(navigation!.runId);
      if (ignore) return;
      const session = await client.session(detail.run.session_id);
      if (ignore || scopeDeleted(store.getSnapshot(), detail.run)) return;
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
      setSessionCursor(snapshot.sessions.next_cursor);
      setTodoCursors({ active_runs: snapshot.active_runs.next_cursor,
        pending_questions: snapshot.pending_questions.next_cursor, pending_approvals: snapshot.pending_approvals.next_cursor });
      setResourceCursors({ resources: snapshot.resources.next_cursor, grants: snapshot.grants.next_cursor });
      const target = navigationTarget.current;
      if (target?.session.workspace_id === workspaceId) {
        next = setProjection(state => mergeSessions(state, [target.session]));
        if (next.sessions[target.session.id]) {
          chooseSession(target.session.id);
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
    return () => { ignore = true; };
  }, [client, sessionId, snapshotGeneration]);

  const agent = projection.profiles[agentId];
  const model = projection.models[modelId];
  const connection = model && projection.connections[model.connection_id];
  const runs = Object.values(projection.runs).filter(run => run.session_id === sessionId);
  const activeRun = runs.find(run => !terminal(run.state));
  const activeRoot = activeRun && projection.tasks[activeRun.root_task_id];
  const canSteer = activeRoot?.kind === 'agent';
  const pendingSubmission = pendingCommands.some(command => {
    const context = commandContexts.current.get(command.commandId);
    return command.status === 'unconfirmed' && (command.type === 'startRun' || command.type === 'steer')
      && context?.key.workspaceId === workspaceId && context.key.sessionId === sessionId;
  });
  const selectedRun = runs.find(run => run.id === selectedRunId) ?? activeRun ?? runs.at(-1);
  const tracePage = trace?.runId === selectedRun?.id ? trace?.page : undefined;
  const tasks = Object.values(projection.tasks).filter(task => task.run_id === selectedRun?.id);
  const activities = Object.values(projection.activities).filter(activity => activity.run_id === selectedRun?.id);
  const artifacts = Object.values(projection.artifacts).filter(artifact => projection.entityScopes[artifact.id]?.session_id === sessionId
    && projection.entityScopes[artifact.id]?.workspace_id === workspaceId);
  const selectedArtifact = artifacts.find(artifact => artifact.id === artifactId) ?? null;
  const questions = Object.values(projection.questions).filter(question => question.status === 'pending' && projection.runs[question.run_id]?.session_id === sessionId);
  const approvals = Object.values(projection.approvals).filter(approval => approval.session_id === sessionId && approval.status === 'pending');
  const publications = Object.values(projection.publications).filter(item => item.session_id === sessionId);
  const interactions = [
    ...questions.map(question => ({ kind: 'question' as const, id: question.id, title: '回答问题', question })),
    ...(draft.resourceIds.length ? [{ kind: 'scope' as const, id: 'scope', title: '本次资料范围' }] : []),
    ...approvals.map(approval => ({ kind: 'approval' as const, id: approval.id, title: '批准本次操作', approval })),
    ...(publications.length ? [{ kind: 'recovery' as const, id: 'recovery', title: '导出恢复' }] : []),
  ];
  const interaction = interactions.find(item => item.id === interactionId) ?? interactions[0];
  const summary = selectedRun && projection.runSummaries[selectedRun.id];
  const messageIds = orderedMessageIds(projection, sessionId);
  const resourcesSyncing = !resourceCursors || resourceCursors.resources !== null || resourceCursors.grants !== null;
  const granted = draft.resourceIds.length > 0 && resources.length === draft.resourceIds.length && !!connection && resources.every(resource => Object.values(projection.grants).some(grant => grant.status === 'active'
    && projection.scopes[grant.id]?.status !== 'revoked'
    && grant.scope.workspace_id === workspaceId && (grant.scope.session_id === null || grant.scope.session_id === sessionId)
    && grant.destination === connection.endpoint && grant.resource_ids.includes(resource.id) && grant.purposes.includes('read') && grant.purposes.includes('model_send')));

  const formActive = busy || nativeSelecting || sidebarFormActive || !!text || !!workspaceName || !!sessionTitle || resources.length > 0 || !!confirmation
    || Object.values(projection.questions).some(question => question.status === 'pending' && projection.runs[question.run_id]?.session_id === sessionId)
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
    if (!store.getSnapshot().sessions[run.session_id]) {
      void perform(async () => {
        const request = view.current;
        const session = await client.session(run.session_id);
        if (view.current !== request) return;
        const next = setProjection(state => mergeSessions(state, [session]));
        if (next.sessions[session.id]) { chooseSession(session.id); setSelectedRunId(id); if (!compact) setPanel('tasks'); }
      });
      return;
    }
    if (run.session_id !== view.current.sessionId) chooseSession(run.session_id);
    setSelectedRunId(id); setSelectedNode(undefined); if (!compact) setPanel('tasks');
  }

  function navigateProject(target: ProjectNavigation) {
    if (scopeDeleted(store.getSnapshot(), { workspace_id: target.workspaceId, session_id: target.sessionId ?? null })) { setStatus('目标项目或会话已删除'); return; }
    userNavigated.current = true;
    void perform(async () => {
      if (target.sessionId) {
        const session = await client.session(target.sessionId);
        if (scopeDeleted(store.getSnapshot(), { workspace_id: session.workspace_id, session_id: session.id })) return;
        chooseWorkspace(session.workspace_id); navigationTarget.current = { session, runId: target.runId };
      } else chooseWorkspace(target.workspaceId);
      setWorkspaceGeneration(value => value + 1);
    });
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
      const selection = await invoke<{ resources: unknown[] }>('choose_export_target', { scope: { workspace_id: workspaceId, session_id: sessionId } });
      if (!currentView(request) || !selection.resources.length) return;
      const target = validate('ResourceRef', selection.resources[0]);
      const exportCommand: UiCommand = { type: 'exportArtifact', args: [artifact.id, { meta: commandMeta(artifact.version),
        data: { target_ref: target.id, expected_target_hash: target.source_version } }] };
      await dispatchCommand({ type: 'grant', args: [{ meta: commandMeta(), data: { scope: target.scope,
        resource_ids: [target.id], purposes: ['export'], destination: null } }] }, {
        key: { ...request }, afterConfirmed: async () => { await dispatchCommand(exportCommand, { key: { ...request } }); },
      });
    } finally { setNativeSelecting(false); }
  }

  async function confirm() {
    await perform(async () => {
      const action = confirmation!;
      const request = view.current;
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
    });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (activeRun && !canSteer || pendingSubmission) return;
    const submitted = drafts.read(draftKey);
    await perform(async () => {
      if (activeRun) {
        await dispatchCommand({ type: 'steer', args: [activeRun.id, { meta: commandMeta(activeRun.version), data: { text: submitted.text } }] }, { revision: submitted.revision });
      } else {
        await dispatchCommand({ type: 'startRun', args: [sessionId, { meta: commandMeta(), data: { agent_profile_id: agentId, model_profile_id: submitted.modelId, text: submitted.text, resource_ids: submitted.resourceIds } }] }, { revision: submitted.revision });
      }
    });
  }

  async function selectResources(kind: 'file' | 'directory') {
    const request = view.current;
    setNativeSelecting(true);
    try {
      await onFormActiveChange?.(true);
      const selection = await invoke<{ resources: unknown[] }>('select_resources', { scope: { workspace_id: workspaceId, session_id: sessionId }, kind });
      if (!currentView(request)) return;
      const selected = selection.resources.map(resource => validate('ResourceRef', resource));
      setProjection(state => mergeResources(state, selected));
      const key = { ...request };
      drafts.update(key, { resourceIds: [...new Set([...drafts.read(key).resourceIds, ...selected.map(resource => resource.id)])] });
    } finally { setNativeSelecting(false); }
  }

  function requestSettings(section: 'models' | 'resources') {
    if (onSettings) { onSettings(section); return; }
    void perform(async () => { await onFormActiveChange?.(true); await openSettings(section); });
  }

  return <main className={`workbench ${compact ? 'workbench--compact' : ''} ${panel ? 'workbench--detail' : ''}`}>
    <ProjectSidebar client={client} onFormActiveChange={setSidebarFormActive} allowDirectoryCreation={!compact} deletedWorkspaceIds={Object.keys(projection.deletedWorkspaces)} deletedSessionIds={Object.keys(projection.deletedSessions)} onDefaultWorkspace={id => {
      defaultWorkspaceId.current = id;
      if (id && !userNavigated.current && view.current.workspaceId && view.current.workspaceId !== id && !scopeDeleted(store.getSnapshot(), { workspace_id: id, session_id: null })) chooseWorkspace(id);
    }} onNewSession={() => { userNavigated.current = true; setManagingWorkspace(true); }} onNavigate={navigateProject} onCreated={workspace => setProjection(state => mergeWorkspaces(state, [workspace]))} onSettings={() => requestSettings('models')}>
    <details className="workspace-picker" open={managingWorkspace} onToggle={event => setManagingWorkspace(event.currentTarget.open)}><summary>工作区与会话</summary><section aria-label="工作区与会话">
      <label>工作区 <select value={workspaceId} onChange={event => { userNavigated.current = true; chooseWorkspace(event.target.value); }}><option value="">请选择工作区</option>{Object.values(projection.workspaces).map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
      {workspaceCursor && <button onClick={() => perform(async () => { const request = view.current; const page = await client.workspaces({ cursor: workspaceCursor }); if (view.current !== request) return; setWorkspaceCursor(page.next_cursor); setProjection(state => mergeWorkspaces(state, page.items)); })}>更多工作区</button>}
      <form onSubmit={event => { event.preventDefault(); void perform(async () => { const request = view.current; const workspace = await client.createWorkspace({ meta: commandMeta(), data: { name: workspaceName } }); const next = setProjection(state => mergeWorkspaces(state, [workspace])); if (view.current === request && next.workspaces[workspace.id]) chooseWorkspace(workspace.id); setWorkspaceName(''); }); }}>
        <label>新工作区名称 <input required value={workspaceName} onChange={event => { userNavigated.current = true; setWorkspaceName(event.target.value); }} /></label><button disabled={busy}>创建工作区</button>
      </form>
      <label>会话 <select value={sessionId} onChange={event => { userNavigated.current = true; chooseSession(event.target.value); }}><option value="">请选择会话</option>{Object.values(projection.sessions).filter(session => session.workspace_id === workspaceId).map(session => <option key={session.id} value={session.id}>{session.title}</option>)}</select></label>
      {sessionCursor && <button onClick={() => perform(async () => { const request = view.current; const page = await client.sessions(workspaceId, { cursor: sessionCursor }); if (view.current !== request) return; setSessionCursor(page.next_cursor); setProjection(state => mergeSessions(state, page.items)); })}>更多会话</button>}
      <form onSubmit={event => { event.preventDefault(); void perform(async () => { const request = view.current; const session = await client.createSession(workspaceId, { meta: commandMeta(), data: { title: sessionTitle } }); const next = setProjection(state => mergeSessions(state, [session])); if (view.current === request && next.sessions[session.id]) chooseSession(session.id); setSessionTitle(''); }); }}>
        <label>新会话标题 <input required value={sessionTitle} onChange={event => { userNavigated.current = true; setSessionTitle(event.target.value); }} /></label><button disabled={busy || !workspaceId}>创建会话</button>
      </form>
      <div className="privacy-actions"><Button disabled={!sessionId || busy} onClick={() => { const session = projection.sessions[sessionId]; setConfirmation({ kind: 'session', id: session.id, version: session.version, name: session.title }); }}>删除会话</Button>
        <Button disabled={!workspaceId || busy} onClick={() => { const workspace = projection.workspaces[workspaceId]; setConfirmation({ kind: 'workspace', id: workspace.id, version: workspace.version, name: workspace.name }); }}>删除工作区</Button></div>
      {!compact && projection.workspaces[workspaceId] && <ProjectDirectory client={client} workspace={projection.workspaces[workspaceId]} blocked={pendingCommands.some(command => command.type === 'setWorkspaceDirectory' && commandContexts.current.get(command.commandId)?.targetId === workspaceId)} onLink={(resource_id, version) => dispatchCommand({ type: 'setWorkspaceDirectory', args: [workspaceId, { meta: commandMeta(version), data: { resource_id } }] })} />}
    </section></details>
    <details className="sidebar-secondary"><summary>本项目待办与任务</summary>
    <Inbox questions={Object.values(projection.questions)} approvals={Object.values(projection.approvals)} runs={Object.values(projection.runs)} onSelect={selectRun} />
    <section className="run-navigation" aria-label="会话任务"><h2>会话任务 <span>{runs.length}</span></h2>
      {!runs.length && <p className="empty-state">开始一段对话后，真实任务会显示在这里。</p>}
      {runs.map(run => <Button key={run.id} className={selectedRun?.id === run.id ? 'run-nav run-nav--selected' : 'run-nav'} onClick={() => selectRun(run.id)}>
        <span>{run.output?.summary || '会话任务'}</span><Status state={run.state} /></Button>)}
      {runListCursor && <Button disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.sessionRuns(sessionId, { cursor: runListCursor }); if (!currentView(request)) return; setProjection(state => page.items.reduce(mergeRunSnapshot, state)); setRunListCursor(page.next_cursor); })}>更多会话任务</Button>}
    </section></details></ProjectSidebar>
    <section className="conversation"><header className="conversation-header"><div><div className="assistant-identity">{agent && <span className="profile-symbol" aria-label="助理图标">{assistantIcons.find(icon => icon.id === agent.icon_id)?.symbol ?? agent.icon_id}</span>}<h1>{agent?.display_name ?? '主助理'}</h1></div><h2>{projection.sessions[sessionId]?.title ?? '从一件想完成的事开始'}</h2></div>
      <div className="button-row">{!compact && (['tasks', 'artifacts', 'trace'] as const).map((name, index) => <Button key={name} aria-pressed={panel === name} onClick={() => setPanel(panel === name ? null : name)}>{['任务', '产物', 'Trace'][index]}</Button>)}{headerActions}</div></header>
    <p className={`connection-status ${status === '本机事件流已连接' ? 'connection-status--ready' : ''}`} role="status">{status}</p>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {pendingCommands.length > 0 && <section aria-label="命令状态">
      {pendingCommands.map(command => <article key={command.commandId}>
        <p>{command.type} · {projection.workspaces[commandContexts.current.get(command.commandId)!.key.workspaceId]?.name ?? '原工作区尚未同步'} · {projection.sessions[commandContexts.current.get(command.commandId)!.key.sessionId]?.title ?? '原会话尚未同步'}</p>
        <p>{command.status === 'unconfirmed' ? '提交状态待确认' : command.type === 'startRun' || command.type === 'steer' ? '已提交，详情同步中' : '已提交，状态同步中'}</p>
        {command.error && <p>{command.error}</p>}
        {command.status === 'unconfirmed' && <button disabled={command.busy || busy} onClick={() => perform(async () => {
          const context = commandContexts.current.get(command.commandId)!;
          await applyOutcome(await store.check(command.commandId, context.key.sessionId));
        })}>核对提交状态</button>}
        <button disabled={command.busy || busy} onClick={() => perform(async () => { await applyOutcome(await store.retry(command.commandId)); })}>
          {command.status === 'unconfirmed' ? '使用原命令重试' : '重试状态同步'}
        </button>
      </article>)}
    </section>}
    <section className="messages" aria-label="持久对话"><div className="thread">
      {!messageIds.length && <div className="welcome"><span className="welcome-icon" aria-hidden="true">✦</span><h2>把想法变成可追溯的成果</h2><p>聊一个问题，或选几份笔记，一起整理出下一步。</p></div>}
      <MessageList messages={messageIds.map(id => projection.messages[id]).filter(Boolean)} assistantName={agent?.display_name ?? '主助理'} />
      {historyCursor && <button disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.messages(sessionId, { cursor: historyCursor }); if (!currentView(request)) return; setHistoryCursor(page.next_cursor); setProjection(state => mergeMessages(state, sessionId, page.items)); })}>更多历史</button>}
      {Object.entries(projection.previews).filter(([id]) => projection.runs[projection.activities[id].run_id]?.session_id === sessionId).map(([id, chunks]) => <p key={id} aria-label="未提交预览" style={{ whiteSpace: 'pre-wrap' }}>临时预览：{Object.values(chunks).join('')}</p>)}
      {Object.entries(projection.reasoningPreviews).filter(([id]) => projection.runs[projection.activities[id].run_id]?.session_id === sessionId).map(([id, chunks]) => <details className="reasoning" key={id}><summary>推理 · 未提交预览</summary><p style={{ whiteSpace: 'pre-wrap' }}>{Object.values(chunks).join('')}</p></details>)}
      <section className="run-actions" aria-label="运行与待办">
        {todoCursors?.active_runs && <button disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.activeRuns(workspaceId, { cursor: todoCursors.active_runs! }); const details = await Promise.all(page.items.map(run => client.run(run.id))); if (view.current !== request) return; setProjection(state => details.reduce(mergeRunDetail, state)); setTodoCursors(current => current && ({ ...current, active_runs: page.next_cursor })); })}>更多运行</button>}
        {todoCursors?.pending_questions && <button disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.pendingQuestions(workspaceId, { cursor: todoCursors.pending_questions! }); const details = await Promise.all([...new Set(page.items.map(question => question.run_id))].map(id => client.run(id))); if (view.current !== request) return; setProjection(state => mergeQuestions(details.reduce(mergeRunDetail, state), page.items)); setTodoCursors(current => current && ({ ...current, pending_questions: page.next_cursor })); })}>更多问题</button>}
        {todoCursors?.pending_approvals && <button disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.pendingApprovals(workspaceId, { cursor: todoCursors.pending_approvals! }); const details = await Promise.all([...new Set(page.items.map(approval => approval.run_id))].map(id => client.run(id))); if (view.current !== request) return; setProjection(state => mergeApprovals(details.reduce(mergeRunDetail, state), page.items)); setTodoCursors(current => current && ({ ...current, pending_approvals: page.next_cursor })); })}>更多审批</button>}
        {runs.map(run => <article className="run-state" key={run.id}><Status state={run.state} />{run.reason && <p>{run.reason}</p>}
          {run.output && <section className="run-output delivery"><h3>任务交付摘要</h3><Markdown>{run.output.summary}</Markdown>{run.output.unresolved.length > 0 && <ul>{run.output.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul>}</section>}
          {!terminal(run.state) && <Button disabled={busy || unconfirmed('cancel', run.id)} onClick={() => perform(() => dispatchCommand({ type: 'cancel', args: [run.id, commandMeta(run.version)] }))}>取消运行</Button>}
          {(run.state === 'interrupted' || run.state === 'blocked_incompatible'
            || run.state === 'waiting_user' && !!projection.runSummaries[run.id] && !questions.some(question => question.run_id === run.id))
            && <Button disabled={busy || unconfirmed('resume', run.id)} onClick={() => perform(() => dispatchCommand({ type: 'resume', args: [run.id, commandMeta(run.version)] }))}>重新检查并继续</Button>}
        </article>)}
        {questions.map(question => <p key={question.id}>有待回答的问题 <button onClick={() => { setInteractionId(question.id); setInteractionCollapsed(false); }}>回答问题</button></p>)}
        {Object.values(projection.questions).filter(question => question.status !== 'pending' && projection.runs[question.run_id]?.session_id === sessionId).flatMap(question => Object.entries(questionDrafts).filter(([key, draft]) => key.startsWith(`${question.id}:`) && draft.value !== undefined).map(([key, draft]) => <p key={key}>问题已处理，未提交的回答已保留：{typeof draft.value === 'string' ? draft.value : JSON.stringify(draft.value)}</p>))}
      </section>
      <section className="artifact-links" aria-label="文本产物">{artifacts.map(artifact => <Button key={artifact.id} aria-label={`预览产物 ${artifact.id}`} onClick={() => { setArtifactId(artifact.id); setPanel('artifacts'); }}>{artifact.media_type === 'text/markdown' ? 'Markdown 文档' : '文本产物'} · 预览</Button>)}</section>
    </div></section>
    <div className="composer-wrap"><div className="composer-inner">
    {summary && <div className="composer-summary" key={selectedRun?.id}><RunCostSummary summary={summary.cost_summary} disclosureName={summaryDisclosureName} /><ContextNotice usage={summary.context_usage} disclosureName={summaryDisclosureName} /></div>}
    {interactions.length > 1 && <label className="interaction-picker">当前待办 <select value={interaction?.id} onChange={event => { setInteractionId(event.target.value); setInteractionCollapsed(false); }}>{interactions.map(item => <option key={item.id} value={item.id}>{item.title}{item.kind === 'question' ? `：${item.question.question}` : ''}</option>)}</select></label>}
    {interaction && <InteractionPanel item={interaction} collapsed={interactionCollapsed} onCollapse={() => setInteractionCollapsed(value => !value)}>
    {interaction.kind === 'question' && (() => {
      const question = interaction.question, key = `${question.id}:${question.version}`;
      const answerDraft = questionDrafts[key] ?? { value: undefined, revision: 0 };
      return <QuestionForm key={key} question={question} value={answerDraft.value} onChange={value => setQuestionDrafts(current => ({ ...current, [key]: { value, revision: (current[key]?.revision ?? 0) + 1 } }))}
        onCancel={() => void perform(() => { const run = projection.runs[question.run_id]; return dispatchCommand({ type: 'cancel', args: [run.id, commandMeta(run.version)] }); })}
        busy={busy || unconfirmed('answer', question.id)} onSubmit={answer => void perform(() => dispatchCommand({ type: 'answer', args: [question.id, { meta: commandMeta(question.version), data: { answer } }] }, {
          afterConfirmed: async () => { setQuestionDrafts(current => current[key]?.revision === answerDraft.revision ? { ...current, [key]: { value: undefined, revision: answerDraft.revision + 1 } } : current); },
        }))} />;
    })()}
    {interaction.kind === 'approval' && <ApprovalCard approval={interaction.approval} busy={busy || unconfirmed('decide', interaction.approval.id)} onDecision={allow => perform(() => dispatchCommand({ type: 'decide', args: [interaction.approval.id, { meta: commandMeta(interaction.approval.version), data: { allow } }] }))} />}
    {interaction.kind === 'recovery' && <RecoveryPanel publications={publications} busy={busy} isPending={id => pendingCommands.some(command => ['restoreExport', 'releaseExport'].includes(command.type) && commandContexts.current.get(command.commandId)?.targetId === id)} onCommand={(type, item) => dispatchCommand({ type, args: [item.id, commandMeta(item.version)] })} />}
    {interaction.kind === 'scope' && <section className="resource-bar" aria-label="资料选择"><div className="interaction-body">
      {resourcesSyncing && <p>资料与授权同步中；尚未加载的授权状态未知。</p>}
      {resourceCursors?.resources && <button disabled={busy || !sessionId} onClick={() => perform(() => loadResourcePage('resources'))}>更多资料</button>}
      {resourceCursors?.grants && <button disabled={busy || !sessionId} onClick={() => perform(() => loadResourcePage('grants'))}>更多授权</button>}
      <ul>{draft.resourceIds.map(id => <li key={id}>{projection.resources[id]?.label ?? `资料尚未同步 · ${id}`} <button aria-label="移除本次附件" disabled={busy || !!activeRun} onClick={() => drafts.update(draftKey, { resourceIds: draft.resourceIds.filter(item => item !== id) })}>移除本次附件</button></li>)}</ul>
      <p>读取以上资料并发送至：{connection ? `${connection.display_name} · ${connection.endpoint}` : model ? '连接尚未同步，无法确认目的地' : '请先选择模型'}</p></div><footer className="interaction-footer"><button disabled={busy || !connection || granted || resourcesSyncing || resources.length !== draft.resourceIds.length || !!activeRun || unconfirmed('grant')} onClick={() => perform(() => dispatchCommand({ type: 'grant', args: [{ meta: commandMeta(), data: { scope: { workspace_id: workspaceId, session_id: sessionId }, resource_ids: draft.resourceIds as [string, ...string[]], purposes: ['read', 'model_send'], destination: connection.endpoint } }] }))}>{granted ? '当前范围已授权' : resourcesSyncing ? '授权状态同步中' : '授权读取并发送'}</button></footer>
    </section>}
    </InteractionPanel>}
    {interaction?.kind !== 'scope' && <div className="resource-pagination">{resourceCursors?.resources && <button onClick={() => perform(() => loadResourcePage('resources'))}>更多资料</button>}{resourceCursors?.grants && <button onClick={() => perform(() => loadResourcePage('grants'))}>更多授权</button>}</div>}
    <Composer value={text} onChange={setText} onSubmit={send} steering={canSteer} blockedReason={activeRun && !canSteer ? activeRoot?.kind === 'tool' ? '导出结束后可发送；也可另开会话' : '正在同步当前运行类型，草稿已保留' : pendingSubmission ? '请先核对上次提交，草稿已保留' : undefined}
      toolbar={<div className="composer-toolbar">
        <button type="button" className="attachment-button" aria-label="选择文本文件" title="选择文本文件" disabled={busy || !sessionId || !!activeRun} onClick={() => perform(() => selectResources('file'))}>♧</button>
        <button type="button" className="attachment-button" aria-label="选择目录" title="选择目录" disabled={busy || !sessionId || !!activeRun} onClick={() => perform(() => selectResources('directory'))}>▱</button>
        <select aria-label="模型" title={connection ? `${connection.display_name} · ${connection.endpoint}` : '连接尚未同步'} value={modelId} disabled={busy || !!activeRun} onChange={event => setModelId(event.target.value)}><option value="">请选择模型</option>{Object.values(projection.models).map(model => <option key={model.id} value={model.id}>{model.display_name ?? model.model_id} · {projection.connections[model.connection_id]?.display_name ?? '连接尚未同步'}</option>)}</select>
        <details className="composer-options"><summary aria-label="运行配置" title="运行配置">⋯</summary><div className="composer-options-panel">
          <fieldset className="configuration-row" disabled={busy || !!activeRun}><legend>新运行的配置（当前运行固定原配置）</legend>
            <label>助理 <select value={agentId} onChange={event => { setAgentId(event.target.value); setModelId(projection.profiles[event.target.value].default_model_profile_id ?? ''); }}>{Object.values(projection.profiles).map(profile => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>
            {profilePage?.next_cursor && <button type="button" onClick={() => perform(async () => { const page = await client.profiles({ cursor: profilePage.next_cursor! }); setProfilePage(page); setProjection(state => ({ ...state, profiles: mergeVersioned(state.profiles, page.items) })); })}>更多助理</button>}
            <button type="button" onClick={() => perform(async () => { const page = await client.models(modelPage?.next_cursor ? { cursor: modelPage.next_cursor } : {}); setModelPage(page); setProjection(state => ({ ...state, models: mergeVersioned(state.models, page.items) })); })}>{modelPage?.next_cursor ? '更多模型' : '刷新模型'}</button>
            <button type="button" onClick={() => perform(async () => { const page = await client.connections(connectionPage?.next_cursor ? { cursor: connectionPage.next_cursor } : {}); setConnectionPage(page); setProjection(state => ({ ...state, connections: mergeVersioned(state.connections, page.items) })); })}>{connectionPage?.next_cursor ? '更多连接' : '刷新连接'}</button>
          </fieldset>
          <button type="button" onClick={() => setPanel(panel === 'resources' ? null : 'resources')}>管理授权</button>
        </div></details>
        <button type="button" aria-label="模型设置" title="模型设置" onClick={() => requestSettings('models')}>⚙</button>
      </div>}
      disabled={busy || pendingSubmission || !!activeRun && !canSteer || !sessionId || !text.trim() || (!activeRun && (!agent || !model || draft.resourceIds.length !== resources.length || (draft.resourceIds.length > 0 && !granted)))} />
    </div></div>
    </section>
    {panel && <aside className="detail-panel"><header className="panel-header"><h2>{{ tasks: '任务详情', artifacts: '产物', trace: 'Trace', resources: '管理授权' }[panel]}</h2><Button aria-label="关闭详情" onClick={() => setPanel(null)}>×</Button></header>
      {panel === 'resources' && workspaceId && <ResourcePanel client={client} workspaceId={workspaceId} sessionId={sessionId || null} refreshKey={Object.values(projection.grants).map(item => `${item.id}:${item.version}`).join(',') + Object.values(projection.scopes).map(item => `${item.id}:${item.epoch}`).join(',')} isRevokePending={id => pendingCommands.some(command => command.type === 'revoke' && commandContexts.current.get(command.commandId)?.targetId === id)} onGrantsLoaded={items => setProjection(state => mergeGrants(state, items))} onRevoke={(id, meta) => dispatchCommand({ type: 'revoke', args: [id, meta] })} />}
      {panel === 'tasks' && summary && <RunCostSummary key={selectedRun?.id} summary={summary.cost_summary} disclosureName={`${summaryDisclosureName}-task`} />}
      {panel === 'tasks' && <><div className="button-row"><Button aria-pressed={graph} onClick={() => setGraph(true)}>任务图</Button><Button aria-pressed={!graph} onClick={() => setGraph(false)}>任务列表</Button></div>
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
      {panel === 'artifacts' && <ArtifactPanel artifact={selectedArtifact} client={client} onExport={chooseExport} exportBlocked={nativeSelecting || pendingCommands.some(command => command.type === 'exportArtifact' && commandContexts.current.get(command.commandId)?.targetId === selectedArtifact?.id || command.type === 'grant' && !!commandContexts.current.get(command.commandId)?.afterConfirmed)} onSelectSource={(taskId, activityId) => void perform(async () => {
        const request = view.current;
        const task = projection.tasks[taskId] ?? await client.task(taskId);
        if (currentView(request)) {
          if (compact) await invoke('show_workbench', { run_id: task.run_id });
          else { setSelectedNode({ id: activityId, kind: 'activity' }); setSelectedRunId(task.run_id); setPanel('trace'); }
        }
      })} />}
      {panel === 'trace' && <TracePanel events={tracePage?.items ?? []} selectedId={selectedNode?.id} onSelect={(id, kind) => setSelectedNode({ id, kind })} nextCursor={tracePage?.next_cursor} loading={busy}
        onLoadMore={() => void perform(async () => { const request = view.current, owner = trace!; const page = await client.trace(owner.runId, { cursor: owner.page.next_cursor! });
          if (currentView(request)) setTrace(current => current === owner ? { runId: owner.runId, page: { ...page,
            items: [...new Map([...owner.page.items, ...page.items].map(item => [item.event_id, item])).values()]
              .sort((left, right) => BigInt(left.event_id) < BigInt(right.event_id) ? -1 : BigInt(left.event_id) > BigInt(right.event_id) ? 1 : 0) } } : current); })} />}
    </aside>}
    {confirmation && <Dialog title="确认隐私删除" onClose={() => { if (!busy) setConfirmation(undefined); }}>
      <p>删除“{confirmation.name}”中的本地内容、产物引用和运行记录。逻辑删除立即生效；被占用文件的清理会在后续回收时重试。未完成的导出恢复必须先处理；不会删除外部目标或备份。</p>
      <div className="button-row"><Button disabled={busy} onClick={() => setConfirmation(undefined)}>取消</Button><Button className="button--primary" disabled={busy} onClick={() => void confirm()}>确认删除</Button></div>
    </Dialog>}
  </main>;
}
