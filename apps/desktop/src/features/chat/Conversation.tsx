import { useEffect, useLayoutEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, commandMeta, RuntimeClient } from '../../api/client';
import { laterCursor, mergeApprovals, mergeGrants, mergeMessages, mergePublications, mergeQuestions, mergeResources, mergeRunDetail, mergeRunFeedback, mergeRunPage, mergeRunSnapshot, mergeSessions, mergeVersioned, mergeWorkspaces, messageSourceInvalid, orderedMessageIds, scopeDeleted, terminal, type RunPageInput } from '../../api/events';
import { validate } from '../../api/validation';
import { openSettings, showWorkbench, type WorkbenchTarget } from '../../api/windows';
import type { AgentProfile, AgentProfilePage, AnswerCommand, ArtifactRef, InboxPage, ModelResolution, PendingAction, ProviderPresetList, ResourceCoverage, ResourceRef, RunDetail, RunSnapshot, ScopeRef, Session, SessionContext, Workspace, WorkspaceSnapshot } from '../../generated/contracts';
import { createRuntimeStore, uiCommandId, type CommandOutcome, type UiCommand, type RuntimeStore } from '../../state/runtime-store';
import { createDraftStore, type Draft, type DraftKey } from '../../state/draft-store';
import { Button } from '../../components/ui/button';
import Dialog from '../../components/Dialog';
import Status from '../../components/Status';
import { assistantIcons } from '../../components/assistant-icons';
import ArtifactPanel from '../artifacts/ArtifactPanel';
import { describeArtifacts } from '../artifacts/artifact-presentation';
import { TaskGraph } from '../tasks/TaskGraph';
import { TaskList } from '../tasks/TaskList';
import { TracePanel } from '../trace/TracePanel';
import Composer from './Composer';
import ComposerModelPicker from './ComposerModelPicker';
import ApprovalCard from './ApprovalCard';
import QuestionForm from './QuestionForm';
import InteractionPanel from './InteractionPanel';
import ResourcePanel from './ResourcePanel';
import MessageList from './MessageList';
import McpQueryRecovery, { queryUncertain } from './McpQueryRecovery';
import RecoveryPanel from './RecoveryPanel';
import ContextPanel from './ContextPanel';
import ProjectSidebar, { type ProjectNavigation } from '../navigation/ProjectSidebar';
import ProjectDirectory from '../navigation/ProjectDirectory';
import ScopeNameDialog from '../navigation/ScopeNameDialog';
import TaskCenter, { runKinds } from '../tasks/TaskCenter';
import TaskDetail from '../tasks/TaskDetail';
import SelectedStep from '../tasks/SelectedStep';
import ManagedTaskStrip from './ManagedTaskStrip';
import ResultInbox from '../notifications/ResultInbox';
import ScopeActions from './SessionActions';
import IconButton, { UiIcon } from '../../components/IconButton';
import CommandStatus from '../notifications/CommandStatus';
import PendingUserCommands from './PendingUserCommands';
import { useMemorySources } from './useMemorySources';
import CapabilityLibrary from '../capabilities/CapabilityLibrary';
import { personalScope } from '../../api/memory';
import { Sheet, SheetContent, SheetTitle } from '../../components/ui/sheet';
import { toast } from 'sonner';
import AssistantsPage from '../assistants/AssistantsPage';
import MemoryPage from '../memory/MemoryPage';
import KnowledgePage from '../knowledge/KnowledgePage';
import KnowledgeImport from '../knowledge/KnowledgeImport';
import EvidenceReader from '../knowledge/EvidenceReader';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import type { MemoryScope } from '../../api/memory';
import { Checkbox } from '../../components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import RunFeedbackNotice, { modelFailures } from '../tasks/RunFeedbackNotice';
import { useMcpAdmission } from './useMcpAdmission';
import McpAdmission from './McpAdmission';
import './conversation-details.css';

type Confirmation = { kind: 'session' | 'workspace'; id: string; workspaceId: string; version: number; name: string };
const detailSections = { results: '结果', tasks: '任务', artifacts: '产物', context: '上下文' } as const;
type DetailSection = keyof typeof detailSections;
type DetailPanel = DetailSection | 'trace' | 'resources' | 'evidence';
const detailTitles = { results: '后台交付结果', tasks: '任务详情', artifacts: '产物', context: '上下文', trace: 'Trace', resources: '管理授权', evidence: '引用原文' };
const wideConversation = '(min-width: 1200px)';
const wideContext = '(min-width: 1000px)';
type ModelUse = NonNullable<WorkspaceSnapshot['recent_model_uses']>[number];
type ProjectModelUse = {
  workspaceId: string;
  sessions: Record<string, ModelUse>;
  recent: ModelUse[];
};
type FileIssue = { kind: 'recipient' | 'version'; resourceIds: readonly string[]; observedRunId?: string };
function classifyFileIssue(error: unknown): FileIssue | undefined {
  if (!(error instanceof ApiError)) return;
  if (error.code === 'session_file_recipient_changed') return { kind: 'recipient', resourceIds: error.relatedIds };
  if (error.code === 'file_source_changed' || error.code === 'file_identity_changed') return { kind: 'version', resourceIds: error.relatedIds };
}
function newerModelUse(use: ModelUse, previous: ModelUse | undefined) {
  return BigInt(use.event_id) > BigInt(previous?.event_id ?? '0');
}

export interface WorkbenchNavigation { target: Exclude<WorkbenchTarget, { kind: 'connection' }>; sequence: number }
interface ConversationProps {
  client: RuntimeClient;
  compact?: boolean;
  navigation?: WorkbenchNavigation;
  onSelectedRunChange?: (id: string | null) => void;
  onFormActiveChange?: (active: boolean) => Promise<void>;
  onSettings?: (section: 'models' | 'resources' | 'memory' | 'retrieval', connectionId?: string, memoryScope?: MemoryScope) => void;
  headerActions?: ReactNode;
  onReturnToQuick?: () => Promise<void>;
  onProfilesChange?: (revision: string) => void;
  runtimeStore?: RuntimeStore;
  draftStore?: ReturnType<typeof createDraftStore>;
  obscured?: boolean;
}

export function Conversation({ client, compact = false, navigation, onSelectedRunChange, onFormActiveChange, onSettings, headerActions, onReturnToQuick, onProfilesChange, runtimeStore, draftStore, obscured = false }: ConversationProps) {
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
  const [readyWorkspace, setReadyWorkspace] = useState('');
  const [nativeSelecting, setNativeSelecting] = useState(false);
  const [profilePage, setProfilePage] = useState<AgentProfilePage>();
  const [providerPresets, setProviderPresets] = useState<ProviderPresetList>([]);
  const [catalog, setCatalog] = useState<{ models: string | null; connections: string | null }>();
  const loadingCatalog = useRef<{ revision: number; promise: Promise<void> }>(undefined);
  const [modelLookup, setModelLookup] = useState<{ id: string; message: string }>();
  const [modelLookupRevision, retryModelLookup] = useState(0);
  const [todoCursors, setTodoCursors] = useState<Record<'active_runs' | 'pending_approvals' | 'pending_questions', string | null>>();
  const [resourceCursors, setResourceCursors] = useState<Record<'resources' | 'grants', string | null>>();
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [runConfigurationOpen, setRunConfigurationOpen] = useState(false);
  const runConfigurationTrigger = useRef<HTMLButtonElement>(null);
  const [assistantsOpen, setAssistantsOpen] = useState(false);
  const [memoryPage, setMemoryPage] = useState<{ source?: RunSnapshot }>();
  const [knowledgePage, setKnowledgePage] = useState<{ workspaceId: string; sourceId: string | null }>();
  const [evidenceTarget, setEvidenceTarget] = useState<{ workspaceId: string; evidenceId: string }>();
  const [evidenceReturn, setEvidenceReturn] = useState<{ origin: HTMLElement; panel: 'results' | 'context' | 'tasks' | null }>();
  const evidenceReturnFocus = useRef<HTMLElement>(undefined);
  const pageGuard = useRef<((action: () => void) => void) | null>(null);
  const navTrigger = useRef<HTMLButtonElement>(null);
  const pageOrigin = useRef<HTMLElement | null>(null);
  const returnPageFocus = useRef(false);
  const [directoryTarget, setDirectoryTarget] = useState<{ workspace: Workspace; origin: HTMLElement }>();
  const [renameTarget, setRenameTarget] = useState<{ target: Session | Workspace; origin: HTMLElement; suggest?: boolean }>();
  const [sessionId, setSessionId] = useState('');
  const [accountingRevision, setAccountingRevision] = useState('0');
  const mcpAdmission = useMcpAdmission(client, workspaceId, sessionId, projection.mcpRevision);
  const [agentId, setAgentId] = useState('');
  const [firstAgent, setFirstAgent] = useState<AgentProfile>();
  const [snapshotGeneration, setSnapshotGeneration] = useState(0);
  const [workReadySession, setWorkReadySession] = useState('');
  const [modelHistoryReadySession, setModelHistoryReadySession] = useState('');
  const [projectModelUse, setProjectModelUse] = useState<ProjectModelUse>();
  const [sidebarFormActive, setSidebarFormActive] = useState(false);
  const [knowledgeFormActive, setKnowledgeFormActive] = useState(false);
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
  const [skillLabels, setSkillLabels] = useState<Record<string, { name: string; release?: string }>>({});
  function openSkillLibrary(entry: 'personal' | 'project') {
    if (entry === 'personal') clearPages();
    setSkillLibrary({ key: { ...view.current }, origin: document.activeElement as HTMLElement,
      mcpScope: entry === 'personal' ? personalScope
        : { kind: 'workspace', workspace_id: view.current.workspaceId, session_id: null } });
  }
  function closeSkillLibrary() {
    pageOrigin.current = skillLibrary?.origin ?? null;
    returnPageFocus.current = true;
    setSkillLibrary(undefined);
  }
  function clearPages() {
    taskDetailOrigin.current = null;
    setPanel(null);
    setManagement(undefined);
    setSkillLibrary(undefined);
    setAssistantsOpen(false);
    setMemoryPage(undefined);
    setKnowledgePage(undefined);
    setEvidenceTarget(undefined);
    setEvidenceReturn(undefined);
    returnToInboxFromTask.current = undefined;
  }
  function showPage(action: () => void) {
    if (pageGuard.current) pageGuard.current(action);
    else action();
  }
  function openAssistants() {
    if (compact) { void perform(() => showWorkbench({ kind: 'assistants' })); return; }
    if (assistantsOpen) return;
    clearPages();
    pageOrigin.current = document.activeElement as HTMLElement;
    setAssistantsOpen(true);
  }
  function openMemory(source?: RunSnapshot) {
    if (compact) { void perform(() => showWorkbench({ kind: 'memory' })); return; }
    if (memoryPage && !source) return;
    if (!source) clearPages();
    pageOrigin.current = document.activeElement as HTMLElement;
    setMemoryPage({ source });
  }
  function openKnowledge(targetWorkspace = workspaceId, sourceId: string | null = null) {
    if (compact) { void perform(() => showWorkbench({ kind: 'knowledge', workspace_id: targetWorkspace, source_id: sourceId })); return; }
    clearPages();
    pageOrigin.current = document.activeElement as HTMLElement;
    if (view.current.workspaceId !== targetWorkspace) chooseWorkspace(targetWorkspace);
    setKnowledgePage({ workspaceId: targetWorkspace, sourceId });
  }
  function openEvidence(targetWorkspace: string, evidenceId: string) {
    if (compact) { void perform(() => showWorkbench({ kind: 'evidence', workspace_id: targetWorkspace, evidence_id: evidenceId })); return; }
    if (panel === 'results' || panel === 'context' || panel === 'tasks' || management === 'detail')
      setEvidenceReturn({ origin: document.activeElement as HTMLElement,
        panel: panel === 'results' || panel === 'context' || panel === 'tasks' ? panel : null });
    else clearPages();
    if (view.current.workspaceId !== targetWorkspace) chooseWorkspace(targetWorkspace);
    setEvidenceTarget({ workspaceId: targetWorkspace, evidenceId });
    openPanel('evidence');
  }
  function closeSecondaryPage() {
    returnPageFocus.current = true;
    setAssistantsOpen(false);
    setMemoryPage(undefined);
    setKnowledgePage(undefined);
  }
  const draftKey = { workspaceId, sessionId };
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.read(draftKey));
  const { text } = draft;
  const resources = draft.resourceIds.map(id => projection.resources[id]).filter(Boolean);
  const setText = (text: string) => {
    userNavigated.current = true;
    const pinModel = text.trim() && !draft.modelId && !!agent && modelAvailable && !effortPending
      && (!sessionId || modelHistoryReadySession === sessionId);
    drafts.update(draftKey, pinModel ? { text, modelId, reasoningEffort } : { text });
  };
  const setModelId = (selectedId: string) => {
    userNavigated.current = true;
    if (selectedId !== draft.modelId) {
      drafts.update(draftKey, { modelId: selectedId, reasoningEffort: selectedId === modelId ? reasoningEffort : null });
    }
  };
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, { value: AnswerCommand['data']['answer'] | undefined; revision: number }>>({});
  const [interactionId, setInteractionId] = useState('');
  const [interactionCollapsed, setInteractionCollapsed] = useState(false);
  const [approvalId, setApprovalId] = useState<string>();
  type CommandContext = { key: DraftKey; draftKey?: DraftKey; revision?: number; steering?: boolean; targetId?: string; targetName?: string;
    submitted?: Draft; acknowledgedRevision?: number; runId?: string; missingHandled?: boolean;
    afterConfirmed?: (outcome: CommandOutcome) => Promise<void>; onRejected?: (error: unknown) => void };
  const commandContexts = useRef(new Map<string, CommandContext>());
  const [artifactId, setArtifactId] = useState('');
  const [artifactDeliveryRunId, setArtifactDeliveryRunId] = useState<string>();
  const [selectedRunId, setSelectedRunId] = useState('');
  const [management, setManagement] = useState<'center' | 'detail'>();
  const [centerTarget, setCenterTarget] = useState({ workspaceId: '', sequence: 0 });
  const [managedRunId, setManagedRunId] = useState('');
  const managementOrigin = useRef<HTMLElement | null>(null);
  const managementReturnPending = useRef(false);
  const returnToInboxFromTask = useRef<(() => void) | undefined>(undefined);
  const taskCenterContent = useRef<HTMLDivElement>(null);
  const taskDetailOrigin = useRef<HTMLElement | null>(null);
  const taskCenterReturnPending = useRef(false);
  const [backgroundInteraction, setBackgroundInteraction] = useState<string>();
  const backgroundReturn = useRef<{ interactionId: string; management: typeof management; origin: HTMLElement; fromPanel: boolean; toInbox?: () => void } | undefined>(undefined);
  const backgroundFocus = useRef<'sheet' | 'inline' | undefined>(undefined);
  const interactionPanel = useRef<HTMLElement>(null);
  const [deliveryIds, setDeliveryIds] = useState<string[]>();
  const [detailRunId, setDetailRunId] = useState<string>();
  const [selectedNode, setSelectedNode] = useState<{ id: string; kind: 'task' | 'activity' }>();
  const [panel, setPanel] = useState<DetailPanel | null>(null);
  const detailBreakpoint = panel === 'context' || panel === 'evidence' && (!evidenceReturn || evidenceReturn.panel === 'context')
    ? wideContext : wideConversation;
  const wide = useSyncExternalStore(subscribeToWidth, () => !!window.matchMedia?.(detailBreakpoint).matches);
  function subscribeToWidth(update: () => void) {
    const screen = window.matchMedia?.(detailBreakpoint);
    screen?.addEventListener('change', update);
    return () => screen?.removeEventListener('change', update);
  }
  const docked = wide && !compact && panel !== 'resources';
  const panelOrigin = useRef<HTMLElement | null>(null);
  const detailsRail = useRef<HTMLElement>(null);
  const detailsPane = useRef<HTMLElement>(null);
  const workbenchRoot = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (panel === 'context' && docked) {
      detailsPane.current?.querySelector<HTMLElement>('h2')?.focus();
    }
  }, [panel, docked]);
  const activePage = knowledgePage ? 'knowledge' : memoryPage ? 'memory' : assistantsOpen ? 'assistants' : skillLibrary ? 'capabilities' : management && panel !== 'evidence' ? 'tasks' : undefined;
  useEffect(() => {
    if (evidenceTarget && readyWorkspace === evidenceTarget.workspaceId
      && (!sessionId || workReadySession === sessionId)) setPanel('evidence');
  }, [evidenceTarget, readyWorkspace, sessionId, workReadySession]);
  useLayoutEffect(() => {
    if (!returnPageFocus.current) return;
    returnPageFocus.current = false;
    const origin = pageOrigin.current;
    pageOrigin.current = null;
    const active = document.activeElement;
    if (active?.isConnected && !active.matches('body,html,:disabled') && !active.closest('[inert],[hidden]')) return;
    for (const target of [origin, navTrigger.current, workbenchRoot.current?.querySelector<HTMLElement>('#message-input')]) {
      if (!target?.isConnected || target.closest('[hidden],[inert]')) continue;
      target.focus();
      if (document.activeElement === target) break;
    }
  }, [activePage]);
  useLayoutEffect(() => {
    if (management === 'center' && taskCenterReturnPending.current) {
      taskCenterReturnPending.current = false;
      const origin = taskDetailOrigin.current;
      taskDetailOrigin.current = null;
      const center = taskCenterContent.current;
      if (origin && center?.contains(origin) && !origin.matches(':disabled')) origin.focus();
      else center?.querySelector<HTMLElement>('h2')?.focus();
      return;
    }
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
    for (const target of [detailsRail.current?.querySelector<HTMLButtonElement>('[data-conversation-panel="tasks"]'), navTrigger.current]) {
      if (!target || target.closest('[inert]')) continue;
      target.focus();
      if (document.activeElement === target) break;
    }
  }, [management]);
  function restorePanelFocus(container?: HTMLElement) {
    const active = document.activeElement as HTMLElement | null;
    const origin = panelOrigin.current;
    panelOrigin.current = null;
    // 旧 Sheet 的延迟回焦不能覆盖已由输入或新页面接管的焦点。
    if (active?.isConnected && !active.matches('body,html,:disabled') && !active.closest('[inert]')
      && !container?.contains(active)) return;
    if (origin?.isConnected && !origin.matches('body,html,:disabled') && !origin.closest('[inert],[hidden]')) {
      origin.focus();
      if (document.activeElement === origin) return;
    }
    const target = detailsRail.current?.querySelector<HTMLButtonElement>(panel === 'context'
      ? '[data-conversation-panel="context"]' : '[data-conversation-panel="tasks"]');
    if (target && !target.closest('[inert]')) target.focus();
  }
  function openPanel(next: DetailPanel, origin = document.activeElement as HTMLElement) {
    if (!panel || !origin.closest('.conversation-details, .ui-sheet')) panelOrigin.current = origin;
    setPanel(next);
  }
  function closePanel() {
    if (panel === 'evidence' && evidenceReturn) {
      evidenceReturnFocus.current = evidenceReturn.origin;
      setPanel(evidenceReturn.panel); setEvidenceTarget(undefined); setEvidenceReturn(undefined); return;
    }
    if (docked) restorePanelFocus(detailsPane.current ?? undefined);
    setPanel(null);
    setEvidenceTarget(undefined);
  }
  useLayoutEffect(() => {
    if (panel !== 'evidence' && evidenceReturnFocus.current) {
      evidenceReturnFocus.current.focus(); evidenceReturnFocus.current = undefined;
    }
  }, [panel]);
  function focusBackgroundForm() {
    backgroundFocus.current = undefined;
    const form = interactionPanel.current;
    if (!form) return;
    // Radix 单选与复选的可交互元素带有 data-slot，提交用的隐藏 input 没有。
    const field = Array.from(form.querySelectorAll<HTMLElement>(
      '.question-form :is([data-slot="input"], [data-slot="textarea"], [data-slot="native-select"], '
      + '[data-slot="checkbox"], [data-slot="radio-group-item"])',
    )).find(control => !control.matches(':disabled, [aria-disabled="true"]')
      && !control.closest('[hidden], [inert], details:not([open])'));
    (field ?? form).focus();
  }
  useEffect(() => { if (obscured) setPanel(null); }, [obscured]);
  const [graph, setGraph] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [runListCursor, setRunListCursor] = useState<string | null>(null);
  const [runCursors, setRunCursors] = useState<Record<string, Partial<Record<RunPageInput['kind'], string | null>>>>({});
  const [runLabels, setRunLabels] = useState<Pick<RunDetail, 'task_goal' | 'task_title' | 'task_titles' | 'file_names' | 'source_valid' | 'watermark'> & { runId: string; authorization: string }>();
  const [taskTitleEvent, setTaskTitleEvent] = useState<{ runId: string; position: string }>();
  const [trace, setTrace] = useState<{ runId: string; page: Awaited<ReturnType<RuntimeClient['trace']>> }>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const confirmationOrigin = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('正在读取本地记录…');
  const [feedbackQuery, setFeedbackQuery] = useState<{ request: typeof view.current; failed: boolean; loading: boolean }>();
  const [feedbackRetry, setFeedbackRetry] = useState(0);
  const messageScroll = useRef<HTMLElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const observedRuns = useRef(new Map<string, string>());
  const notifiedErrors = useRef(new Set<string>());
  const [completion, setCompletion] = useState('');
  useEffect(() => {
    for (const run of Object.values(projection.runs)) {
      const previous = observedRuns.current.get(run.id);
      if (previous && previous !== run.state && run.state === 'completed' && run.interaction_session_id === sessionId) {
        setCompletion('任务已完成，可打开结果或任务查看。'); toast.success('任务已完成', { id: `completed:${run.id}` });
      }
      observedRuns.current.set(run.id, run.state);
    }
  }, [projection.runs, sessionId]);
  useLayoutEffect(() => {
    if (messageScroll.current) messageScroll.current.scrollTop = scrollPositions.current.get(sessionId) ?? 0;
  }, [sessionId, projection.messages, activePage]);
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
      setCatalog({ models: models.next_cursor, connections: connections.next_cursor }); setProfilePage(profiles);
      setProjection(state => ({ ...state, models: mergeVersioned({}, models.items),
        connections: mergeVersioned({}, connections.items), profiles: mergeVersioned(state.profiles, profiles.items) }));
      setModelLookup(undefined);
    }).catch(report);
  }, [client, configurationRevision]);

  function chooseSession(id: string) {
    navigationTarget.current = undefined;
    view.current = { workspaceId: view.current.workspaceId, sessionId: id };
    const profileId = store.getSnapshot().sessions[id]?.agent_profile_id ?? '';
    setAgentId(profileId);
    setWorkReadySession('');
    setModelHistoryReadySession('');
    setSessionId(id); setHistoryCursor(null); setArtifactId(''); setPanel(null); setDeliveryIds(undefined); setDetailRunId(undefined); setBackgroundInteraction(undefined); backgroundReturn.current = undefined; backgroundFocus.current = undefined;
    setSelectedRunId(''); setSelectedNode(undefined); setTrace(undefined); setRunCursors({}); setRunListCursor(null); setConfirmation(undefined);
    setApprovalId(undefined); setRunConfigurationOpen(false);
    setFeedbackQuery(undefined);
  }

  function chooseWorkspace(id: string) {
    view.current = { workspaceId: id, sessionId: '' };
    setReadyWorkspace('');
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
      const key = context.draftKey ?? context.key;
      // 排队失败可先于确认到达；已因缺凭据保留的草稿不能再由迟到确认清空。
      if (!context.missingHandled && context.revision !== undefined && drafts.read(key).revision === context.revision) {
        drafts.acknowledge(key, context.revision, context.steering);
        context.acknowledgedRevision = drafts.read(key).revision;
      }
      const afterConfirmed = context.afterConfirmed;
      context.afterConfirmed = undefined;
      await afterConfirmed?.(outcome);
    }
    if (view.current.workspaceId === context.key.workspaceId && view.current.sessionId === context.key.sessionId) {
      setStatus(outcome.status === 'unconfirmed' ? '命令待核对' : outcome.sync === 'pending' ? '操作已接收，正在同步状态' : '操作已确认');
    }
  }

  async function dispatchCommand(command: UiCommand, options: Partial<CommandContext> = {}) {
    const commandId = uiCommandId(command);
    commandContexts.current.set(commandId, { key: { ...view.current }, targetId: typeof command.args[0] === 'string' ? command.args[0] : undefined, ...options });
    let outcome: CommandOutcome;
    try { outcome = await store.dispatch(command); }
    catch (error) { options.onRejected?.(error); throw error; }
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
      setProfilePage(profiles); setCatalog({ models: models.next_cursor, connections: connections.next_cursor });
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
      if (target.kind === 'knowledge') { openKnowledge(target.workspace_id, target.source_id); return; }
      if (target.kind === 'evidence') { openEvidence(target.workspace_id, target.evidence_id); return; }
      if (target.kind === 'assistants') { openAssistants(); return; }
      if (target.kind === 'memory') { openMemory(); return; }
      if (target.kind === 'mcp') {
        setPanel(null); setManagement(undefined); setMemoryPage(undefined); setAssistantsOpen(false);
        setSkillLibrary({ key: { ...view.current }, origin: document.activeElement as HTMLElement,
          mcpTarget: { server_id: target.server_id, workspace_id: target.workspace_id } }); return;
      }
      if (target.kind === 'capabilities') { openSkillLibrary('personal'); return; }
      clearPages();
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
    showPage(() => { if (!ignore) void locate().catch(error => { if (!ignore) report(error); }); });
    return () => { ignore = true; };
  }, [client, initialized, navigation]);

  useEffect(() => {
    if (!workspaceId) return;
    const abort = new AbortController();
    async function installSnapshot(snapshot: WorkspaceSnapshot) {
      if (abort.signal.aborted || view.current.workspaceId !== workspaceId
        || scopeDeleted(store.getSnapshot(), { workspace_id: workspaceId, session_id: null })) return;
      let next = store.getSnapshot();
      setProjectModelUse({
        workspaceId,
        recent: snapshot.recent_model_uses ?? [],
        sessions: {},
      });
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
      const unboundDraft = drafts.read({ workspaceId, sessionId: '' });
      if (!next.sessions[view.current.sessionId]
        && !store.getCommandsSnapshot().some(command => command.type === 'createSession' && command.targetId === workspaceId)
        && !unboundDraft.text && !unboundDraft.modelId && !unboundDraft.resourceIds.length && !Object.keys(unboundDraft.skillVersions).length) {
        chooseSession(Object.values(next.sessions).find(session => session.workspace_id === workspaceId)?.id ?? '');
      }
      setReadyWorkspace(workspaceId);
      setSnapshotGeneration(value => value + 1);
      const runIds = new Set([...snapshot.pending_questions.items.map(question => question.run_id), ...snapshot.pending_approvals.items.map(approval => approval.run_id)]
        .filter(id => !next.runs[id]));
      const details = await Promise.all([...runIds].map(id => client.run(id)));
      if (!abort.signal.aborted) setProjection(state => mergeQuestions(details.reduce(mergeRunDetail, state), snapshot.pending_questions.items));
    }
    async function connect() {
      await store.loadWorkspace(workspaceId, {
        snapshot: installSnapshot,
        event: envelope => {
          if (abort.signal.aborted) return;
          const next = store.getSnapshot();
          if (envelope.kind === 'durable' && envelope.event.kind === 'accounting.settled') {
            const runId = envelope.event.run_id;
            const owner = runId ? next.runs[runId]?.interaction_session_id ?? next.runSummaries[runId]?.session_id : null;
            if (owner && owner === view.current.sessionId) {
              setAccountingRevision(previous => laterCursor(previous, envelope.event_id));
            }
          }
          if (envelope.kind === 'durable' && 'activities' in envelope.event.payload) {
            const use = envelope.event.payload.chat_model_use;
            if (use && envelope.event.workspace_id === workspaceId
              && BigInt(use.event_id) > BigInt(next.snapshotWatermark)
              && !scopeDeleted(next, { workspace_id: workspaceId, session_id: use.session_id })) {
              setProjectModelUse(current => {
                if (current?.workspaceId !== workspaceId) return current;
                const oldModel = current.recent.find(previous => previous.model_profile_id === use.model_profile_id);
                const recent = newerModelUse(use, oldModel)
                  ? [use, ...current.recent.filter(previous => previous !== oldModel)]
                    .sort((left, right) => newerModelUse(left, right) ? -1 : 1).slice(0, 10)
                  : current.recent;
                const sessions = newerModelUse(use, current.sessions[use.session_id])
                  ? { ...current.sessions, [use.session_id]: use } : current.sessions;
                return { workspaceId, recent, sessions };
              });
            }
            if (envelope.event.kind === 'naming.task_changed' && envelope.event.run_id) {
              setTaskTitleEvent({ runId: envelope.event.run_id, position: envelope.event_id });
            }
            const payload = envelope.event.payload;
            const failures = payload.activities.filter(activity => activity.error
              && activity.operation !== 'naming.title'
              && !['cancelled', 'tool_cancelled', 'mcp_call_cancelled'].includes(activity.error)
              && ['failed', 'uncertain'].includes(activity.state));
            for (const activity of failures) {
              const key = `activity:${activity.id}`;
              if (activity.kind === 'model') notifiedErrors.current.add(`run:${activity.run_id}:${activity.error}`);
              if (notifiedErrors.current.has(key)) continue;
              notifiedErrors.current.add(key);
              const run = next.runs[activity.run_id];
              if (!run || run.config.kind !== 'agent' || run.interaction_session_id !== view.current.sessionId || !document.hasFocus()) continue;
              const config = run.config;
              const modelError = activity.kind === 'model';
              toast.error(modelError ? modelFailures[activity.error!] ?? '模型请求未完成，请查看任务。' : '工具调用未完成，请查看任务中的处理方式。', {
                id: key,
                action: modelError ? { label: '检查连接', onClick: () => {
                  if (activity.task_id === run.root_task_id) openConnection(config.model_profile.connection_id);
                  else void client.task(activity.task_id).then(task => {
                    if (task.binding.config.kind === 'agent') openConnection(task.binding.config.model_profile.connection_id);
                  }).catch(report);
                } }
                  : { label: '查看任务', onClick: () => openTask(run.id) },
              });
            }
            for (const run of payload.runs) {
              if (run.config.kind !== 'agent' || !run.reason || !Object.hasOwn(modelFailures, run.reason) || failures.some(activity => activity.run_id === run.id)) continue;
              const config = run.config;
              const key = `run:${run.id}:${run.reason}`;
              if (notifiedErrors.current.has(key)) continue;
              notifiedErrors.current.add(key);
              if (run.interaction_session_id === view.current.sessionId && document.hasFocus()) toast.error(modelFailures[run.reason], {
                id: key, action: { label: '检查连接', onClick: () => openConnection(config.model_profile.connection_id) },
              });
            }
          }
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
    const messages = client.messages(sessionId).then(page => {
      if (!ignore && currentView(request)) { setHistoryCursor(page.next_cursor); setProjection(state => mergeMessages(state, sessionId, page)); }
    });
    const history = client.sessionRuns(sessionId).then(page => {
      if (!ignore && currentView(request)) {
        setRunListCursor(page.next_cursor);
        setProjection(state => page.items.reduce(mergeRunSnapshot, state));
        const use = page.last_model_use;
        if (use) setProjectModelUse(current => current?.workspaceId === request.workspaceId && newerModelUse(use, current.sessions[sessionId])
          ? { ...current, sessions: { ...current.sessions, [sessionId]: use } } : current);
      }
    });
    void Promise.all([messages, history]).then(() => {
      if (!ignore && currentView(request)) setModelHistoryReadySession(sessionId);
    }).catch(error => { if (!ignore) report(error); });
    store.refreshSessionWork(sessionId).then(() => {
      if (!ignore && currentView(request)) setWorkReadySession(sessionId);
    }).catch(error => { if (!ignore) report(error); });
    return () => { ignore = true; };
  }, [client, sessionId, snapshotGeneration]);

  useEffect(() => {
    if (!workspaceId || readyWorkspace !== workspaceId || sessionId) return;
    let ignore = false;
    setFirstAgent(undefined);
    client.defaultAgent().then(profile => {
      if (!ignore) setFirstAgent(profile);
    }).catch(error => { if (!ignore) report(error); });
    return () => { ignore = true; };
  }, [client, sessionId, workspaceId, readyWorkspace, configurationRevision]);
  const agent = sessionId ? projection.profiles[agentId] : firstAgent;
  useEffect(() => {
    if (!agentId || agent || !profilePage?.next_cursor) return;
    let ignore = false;
    client.profiles({ cursor: profilePage.next_cursor }).then(page => {
      if (!ignore) { setProfilePage(page); setProjection(state => ({ ...state, profiles: mergeVersioned(state.profiles, page.items) })); }
    }).catch(error => { if (!ignore) report(error); });
    return () => { ignore = true; };
  }, [client, agentId, agent, profilePage]);
  const runs = Object.values(projection.runs).filter((run): run is RunSnapshot & { config: Extract<RunSnapshot['config'], { kind: 'agent' }> } =>
    run.interaction_session_id === sessionId && run.config.kind === 'agent');
  const workspaceModelUse = projectModelUse?.workspaceId === workspaceId ? projectModelUse : undefined;
  const recentModelIds = workspaceModelUse?.recent.map(use => use.model_profile_id) ?? [];
  const sessionChoice = workspaceModelUse?.sessions[sessionId];
  const modelId = draft.modelId || sessionChoice?.model_profile_id || agent?.default_model_profile_id || recentModelIds[0] || '';
  const model = projection.models[modelId];
  const connection = model && projection.connections[model.connection_id];
  const modelAvailable = !!model && !!connection;
  const catalogIncomplete = !!catalog && (!!catalog.models || !!catalog.connections);
  const usesProviderPresets = Object.values(projection.connections).some(item => item.provider_preset_id);
  useEffect(() => {
    if (!usesProviderPresets) return;
    let current = true;
    client.providerPresets().then(items => { if (current) setProviderPresets(items); })
      .catch(error => { if (current) report(error); });
    return () => { current = false; };
  }, [client, usesProviderPresets]);
  const lookupNeeded = !!modelId && (!model || !connection);
  const lookupError = modelLookup?.id === modelId ? modelLookup.message : undefined;
  const defaultModelLoading = lookupNeeded && catalogIncomplete && !lookupError;
  const defaultModelError = lookupNeeded && catalog ? lookupError ?? (!catalogIncomplete
    ? '所选模型或连接已不可用，请手动选择模型。' : undefined) : undefined;
  const resolutionKey = modelAvailable ? JSON.stringify([model.id, model.version, connection.id, connection.version]) : '';
  const [effortResolution, setEffortResolution] = useState<{
    key: string;
    options: NonNullable<ModelResolution['capabilities']['reasoning_efforts']>;
  }>();
  const requiresResolution = modelAvailable && (model.capabilities.reasoning_efforts != null || !!connection.provider_preset_id);
  const effortOptions = effortResolution?.key === resolutionKey ? effortResolution.options : [];
  const intendedEffort = draft.modelId ? draft.reasoningEffort : sessionChoice?.reasoning_effort;
  const reasoningEffort = effortOptions.find(option => option === intendedEffort) ?? null;
  const effortPending = !!intendedEffort && requiresResolution && effortResolution?.key !== resolutionKey;

  function loadCatalog(): Promise<void> {
    const revision = configRead.current;
    if (!catalogIncomplete) return Promise.resolve();
    if (loadingCatalog.current?.revision === revision) return loadingCatalog.current.promise;
    const consume = async (kind: 'models' | 'connections') => {
      let cursor = catalog![kind];
      while (cursor && revision === configRead.current) {
        if (kind === 'models') {
          const page = await client.models({ cursor });
          if (revision !== configRead.current) return;
          cursor = page.next_cursor;
          setProjection(state => ({ ...state, models: mergeVersioned(state.models, page.items) }));
        } else {
          const page = await client.connections({ cursor });
          if (revision !== configRead.current) return;
          cursor = page.next_cursor;
          setProjection(state => ({ ...state, connections: mergeVersioned(state.connections, page.items) }));
        }
        const next = cursor;
        setCatalog(current => current && { ...current, [kind]: next });
      }
    };
    const promise = Promise.allSettled([consume('models'), consume('connections')]).then(results => {
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }).finally(() => {
      if (loadingCatalog.current?.revision === revision) loadingCatalog.current = undefined;
    });
    loadingCatalog.current = { revision, promise };
    return promise;
  }
  useEffect(() => {
    if (!lookupNeeded || !catalogIncomplete) return;
    let ignore = false;
    setModelLookup(undefined);
    void loadCatalog().catch(error => {
      if (!ignore) setModelLookup({ id: modelId, message: `默认模型加载失败：${error instanceof Error ? error.message : '无法读取模型列表'}` });
    });
    return () => { ignore = true; };
  }, [client, modelId, lookupNeeded, catalogIncomplete, modelLookupRevision, configurationRevision]);
  useEffect(() => {
    if (!requiresResolution) return;
    let ignore = false;
    client.modelResolution(modelId).then(resolution => {
      if (!ignore && resolution.version === model.version && resolution.connection_version === connection.version) {
        setEffortResolution({ key: resolutionKey, options: resolution.capabilities.reasoning_efforts ?? [] });
      }
    }).catch(error => {
      if (!ignore) report(error);
    });
    return () => { ignore = true; };
  }, [client, resolutionKey, requiresResolution, configurationRevision]);
  useLayoutEffect(() => {
    if (connection && workspaceId) {
      try { drafts.applyPreference(draftKey, connection.endpoint); } catch (error) { report(error); }
    }
  }, [drafts, workspaceId, sessionId, connection?.endpoint]);
  const memorySources = useMemorySources(client, draft.memoryScopes, connection?.endpoint, projection.memoryRevision,
    workspaceId, runConfigurationOpen);
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
    return command.status === 'unconfirmed' && (command.type === 'createSession' || command.type === 'startRun' || command.type === 'enqueueUser'
      || command.type === 'steer' || command.type === 'grant' && !!context?.afterConfirmed)
      && [context?.key, context?.draftKey].some(key => key?.workspaceId === workspaceId && key.sessionId === sessionId);
  });
  const configurationLocked = !!steering || pendingSubmission;
  const lockedModel = steering ? activeRun.config.model_profile : undefined;
  const selectedRun = runs.find(run => run.id === selectedRunId) ?? activeRun ?? runs.at(-1);
  const tracePage = trace?.runId === selectedRun?.id ? trace?.page : undefined;
  const tasks = Object.values(projection.tasks).filter(task => task.run_id === selectedRun?.id);
  const activities = Object.values(projection.activities).filter(activity => activity.run_id === selectedRun?.id);
  const dependenciesVisible = (dependencies: ArtifactRef['dependencies']) =>
    dependencies.every(({ scope_id, epoch }) => [projection.scopes[scope_id], projection.grants[scope_id]]
      .every(scope => !scope || scope.epoch <= epoch && scope.status === 'active') && !(projection.resources[scope_id]?.version > epoch));
  const sourcesVisible = (item: Pick<ArtifactRef, 'dependencies'>) => dependenciesVisible(item.dependencies);
  const fixedActivities = Object.values(projection.activities).filter(sourcesVisible);
  const scopedArtifacts = Object.values(projection.artifacts).filter(artifact => projection.entityScopes[artifact.id]?.session_id === sessionId
    && projection.entityScopes[artifact.id]?.workspace_id === workspaceId);
  const scriptArtifacts = fixedActivities.flatMap(activity => {
    const owner = projection.runs[activity.run_id];
    if (owner?.interaction_session_id !== sessionId || owner.workspace_id !== workspaceId) return [];
    return (activity.script_execution?.outputs ?? []).flatMap(({ artifact }) =>
      artifact.activity_id === activity.id && artifact.task_id === activity.task_id ? [artifact] : []);
  });
  const artifacts = [...new Map([...scriptArtifacts, ...scopedArtifacts].filter(sourcesVisible).map(artifact => [artifact.id, artifact])).values()];
  const visibleArtifacts = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const deliveryIdsByRun = new Map<string, Set<string>>();
  for (const run of runs) {
    if (run.kind === 'managed' || !dependenciesVisible(run.scope_dependencies)) continue;
    deliveryIdsByRun.set(run.id, new Set(run.output?.artifact_ids ?? []));
  }
  for (const artifact of scriptArtifacts) {
    const owner = projection.activities[artifact.activity_id].run_id;
    deliveryIdsByRun.get(owner)?.add(artifact.id);
  }
  const selectedArtifact = artifactId ? visibleArtifacts.get(artifactId) : undefined;
  const artifactsByRun = new Map<string, ArtifactRef[]>();
  for (const [owner, ids] of deliveryIdsByRun) {
    artifactsByRun.set(owner, [...ids].flatMap(id => {
      const artifact = visibleArtifacts.get(id);
      return artifact ? [artifact] : [];
    }));
  }
  const options = selectedArtifact && !artifactDeliveryRunId ? [selectedArtifact]
    : artifactsByRun.get((selectedArtifact && artifactDeliveryRunId) || selectedRun?.id || '') ?? [];
  const artifactOptions = describeArtifacts(options, fixedActivities);
  const selectedArtifactLabel = artifactOptions.find(option => option.artifact.id === artifactId)?.label;
  const chatArtifacts = [...artifactsByRun].flatMap(([runId, group]) => describeArtifacts(group, fixedActivities)
    .map(({ artifact, label }) => ({ id: artifact.id, runId, label })));
  for (const [runId, ids] of deliveryIdsByRun) {
    let position = 0;
    for (const id of ids) {
      if (visibleArtifacts.has(id) || projection.artifacts[id]) continue;
      chatArtifacts.push({ id, runId, label: `交付文件 ${++position}` });
    }
  }
  const selectedRunSources = selectedRun && dependenciesVisible(selectedRun.scope_dependencies);
  const fileAuthorization = [...Object.values(projection.grants), ...Object.values(projection.scopes)]
    .map(scope => `${scope.id}:${scope.epoch}:${scope.status}`).join(',');
  const citationIds = [...new Set(runs.flatMap(run => run.output?.citations?.map(item => item.evidence_id) ?? []))].sort().join(',');
  const citationContextKey = sessionId && citationIds
    ? `${sessionId}:${citationIds}:${projection.snapshotWatermark}:${fileAuthorization}:${projection.knowledgeNotices[workspaceId]?.watermark ?? ''}` : '';
  const [citationContext, setCitationContext] = useState<{ key: string; data?: SessionContext; error?: string }>();
  const [citationRetry, retryCitations] = useState(0);
  useEffect(() => {
    if (!citationContextKey) return;
    let ignore = false;
    client.sessionContext(sessionId).then(data => {
      if (!ignore) setCitationContext({ key: citationContextKey, data });
    }, error => {
      if (!ignore) setCitationContext({ key: citationContextKey, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { ignore = true; };
  }, [client, sessionId, citationContextKey, citationRetry]);
  const currentCitationContext = citationContext?.key === citationContextKey ? citationContext : undefined;
  const citationLabels = new Map(currentCitationContext?.data?.knowledge.map(item => [item.evidence_id, item]));
  const selectedRunLabels = runLabels?.runId === selectedRun?.id && runLabels && runLabels.source_valid !== false
    && runLabels.authorization === fileAuthorization && BigInt(runLabels.watermark) >= BigInt(projection.snapshotWatermark) ? runLabels : undefined;
  const questions = Object.values(projection.questions).filter(question => question.status === 'pending'
    && (question.run_id === backgroundInteraction || projection.runs[question.run_id]?.interaction_session_id === sessionId && projection.runs[question.run_id]?.kind !== 'managed'));
  const approvals = Object.values(projection.approvals).filter(approval => approval.status === 'pending'
    && (approval.run_id === backgroundInteraction || approval.session_id === sessionId && projection.runs[approval.run_id]?.kind !== 'managed'));
  const activeApproval = approvals.find(approval => approval.id === approvalId);
  useEffect(() => {
    if (!approvalId || activeApproval || busy) return;
    if (backgroundReturn.current) returnFromBackground();
    else setApprovalId(undefined);
  }, [approvalId, activeApproval, busy]);
  const publications = Object.values(projection.publications).filter(item => backgroundInteraction ? item.run_id === backgroundInteraction : item.session_id === sessionId);
  const interactions = [
    ...questions.map(question => ({ kind: 'question' as const, id: question.id, title: '回答问题', question })),
    ...(draft.resourceIds.length ? [{ kind: 'scope' as const, id: 'scope', title: '本次资料范围' }] : []),
    ...approvals.map(approval => ({ kind: 'approval' as const, id: approval.id, title: '批准本次操作', approval })),
    ...(publications.length ? [{ kind: 'recovery' as const, id: 'recovery', title: '导出恢复' }] : []),
  ];
  const interaction = interactions.find(item => item.id === interactionId) ?? interactions[0];
  useLayoutEffect(() => {
    if (backgroundFocus.current === 'inline' && backgroundInteraction && !panel) focusBackgroundForm();
  }, [backgroundInteraction, interaction?.id, panel]);
  const messageIds = orderedMessageIds(projection, sessionId);
  const reportMessages = new Map(messageIds.flatMap(id => {
    const message = projection.messages[id];
    return message.origin === 'background_report' ? (message.delivery_ids ?? []).map(deliveryId => [deliveryId, id] as const) : [];
  }));
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
      if (!run || run.config.kind !== 'agent') continue;
      if ((feedback?.model_activity?.error ?? run?.reason) !== 'credential_missing') continue;
      if (scopeDeleted(projection, { workspace_id: context.key.workspaceId, session_id: context.key.sessionId })) continue;
      context.missingHandled = true;
      // 仅恢复该命令清空且之后未编辑的草稿；较新的输入始终保留。
      const key = context.draftKey ?? context.key;
      if (context.acknowledgedRevision === drafts.read(key).revision) {
        const { revision: _revision, ...submitted } = context.submitted;
        drafts.update(key, submitted);
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
  const coverageKey = JSON.stringify([workspaceId, sessionId, modelId, model?.version, connection?.id, connection?.version, connection?.endpoint,
    draft.resourceIds, policyRevision, coverageRevision]);
  const currentCoverage = coverage?.key === coverageKey ? coverage : undefined;
  const coverageLoading = !!connection && !!sessionId && draft.resourceIds.length > 0 && !currentCoverage;
  const resourcesSyncing = !resourceCursors || resourceCursors.resources !== null || resourceCursors.grants !== null || coverageLoading;
  const directoryIds = resources.filter(resource => resource.kind === 'directory').map(resource => resource.id);
  const missingCoverage = currentCoverage?.result && currentCoverage.result.destination === connection?.endpoint
    ? new Set([...currentCoverage.result.missing_read, ...currentCoverage.result.missing_model_send]) : undefined;
  const directoriesGranted = !!missingCoverage && directoryIds.every(id => !missingCoverage.has(id));
  const [fileIssues, setFileIssues] = useState<Record<string, FileIssue>>({});
  const [handledFileReads, setHandledFileReads] = useState<ReadonlySet<string>>(() => new Set());
  function fileIssueKey(key: DraftKey) {
    return JSON.stringify([key.workspaceId, key.sessionId, modelId, model?.version, connection?.id, connection?.version]);
  }
  function clearFileIssue(key: string, issue?: FileIssue) {
    if (issue?.observedRunId) setHandledFileReads(current => new Set([...current, issue.observedRunId!]));
    setFileIssues(current => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  const activeFileIssueKey = fileIssueKey(draftKey);
  const latestUserRun = runs.filter(run => run.kind === 'user' && run.execution_session_id === sessionId).at(-1);
  const observedFileIssue = useMemo<FileIssue | undefined>(() => {
    if (!latestUserRun || !terminal(latestUserRun.state) || handledFileReads.has(latestUserRun.id)) return;
    const changed = new Set<string>();
    for (const id of messageIds) {
      const message = projection.messages[id];
      if (message.run_id !== latestUserRun.id || messageSourceInvalid(message, projection)) continue;
      for (const result of message.parts) {
        if (result.kind !== 'tool_result' || (result.error !== 'file_source_changed' && result.error !== 'file_identity_changed')
          || !result.origin_message_id) continue;
        const origin = projection.messages[result.origin_message_id];
        if (!origin || origin.run_id !== latestUserRun.id || messageSourceInvalid(origin, projection)) continue;
        for (const call of origin.parts) {
          if (call.kind === 'tool_call' && call.name === 'files.read_text' && call.call_id === result.call_id
            && typeof call.arguments === 'object' && call.arguments !== null && typeof call.arguments.resource_id === 'string') {
            changed.add(call.arguments.resource_id);
          }
        }
      }
    }
    if (changed.size) return { kind: 'version', resourceIds: [...changed], observedRunId: latestUserRun.id };
  }, [latestUserRun, handledFileReads, messageIds, projection]);
  const fileIssue = fileIssues[activeFileIssueKey] ?? observedFileIssue;
  useEffect(() => {
    if (!sessionId || !connection || !draft.resourceIds.length || resources.length !== draft.resourceIds.length) return;
    let ignore = false;
    client.resourceCoverage(sessionId, { resource_ids: draft.resourceIds, model_profile_id: modelId })
      .then(result => { if (!ignore) setCoverage({ key: coverageKey, result }); })
      .catch(error => {
        if (ignore) return;
        const issue = classifyFileIssue(error);
        if (issue) setFileIssues(current => ({ ...current, [activeFileIssueKey]: issue }));
        setCoverage({ key: coverageKey, error: error instanceof Error ? error.message : '授权核对失败' });
      });
    return () => { ignore = true; };
  }, [client, coverageKey]);

  const formActive = busy || nativeSelecting || sidebarFormActive || knowledgeFormActive || newSessionWorkspace !== undefined || !!text || !!sessionTitle || resources.length > 0 || !!confirmation || !!renameTarget
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
      setRunLabels({ runId: detail.run.id, task_goal: detail.task_goal, task_title: detail.task_title, task_titles: detail.task_titles, file_names: detail.file_names,
        source_valid: detail.source_valid, watermark: detail.watermark, authorization: fileAuthorization });
      setRunCursors(current => ({ ...current, [detail.run.id]: Object.fromEntries(
        (['tasks', 'activities', 'artifacts', 'waits', 'consumptions', 'joins'] as const).map(kind => [kind, detail[kind].next_cursor])) }));
    }).catch(error => {
      if (!ignore && !store.getCommandsSnapshot().some(command => command.status === 'confirmed' && command.runId === selectedRun.id)) report(error);
    });
    return () => { ignore = true; };
  }, [client, selectedRun?.id, sessionId, projection.snapshotWatermark, fileAuthorization,
    taskTitleEvent?.runId === selectedRun?.id ? taskTitleEvent?.position : undefined]);

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
    if (run.kind === 'managed') { setDetailRunId(id); openPanel('tasks'); return; }
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
  function closeManagement() {
    taskDetailOrigin.current = null;
    const toInbox = returnToInboxFromTask.current;
    returnToInboxFromTask.current = undefined;
    if (toInbox) toInbox();
    else managementReturnPending.current = true;
    setManagement(undefined);
  }
  function openTaskCenter() {
    if (compact) { void perform(() => showWorkbench({ kind: 'tasks', workspace_id: workspaceId || null })); return; }
    if (management === 'center' && !memoryPage) return;
    clearPages();
    setCenterTarget(current => ({ workspaceId, sequence: current.sequence + 1 }));
    enterManagement('center');
  }
  function openTask(runId: string) {
    setPanel(null);
    if (compact) {
      void perform(async () => { const detail = await client.run(runId); await showWorkbench({ kind: 'task', task_id: detail.run.root_task_id }); });
      return;
    }
    if (!management) setCenterTarget(current => ({ workspaceId, sequence: current.sequence + 1 }));
    setManagedRunId(runId); enterManagement('detail', management ? managementOrigin.current : document.activeElement as HTMLElement);
  }
  function returnFromBackground() {
    const previous = backgroundReturn.current;
    backgroundReturn.current = undefined;
    backgroundFocus.current = undefined;
    setApprovalId(undefined);
    setBackgroundInteraction(undefined);
    if (!previous) return;
    setInteractionId(previous.interactionId);
    setManagement(previous.management);
    if (previous.toInbox) previous.toInbox();
    else if (previous.fromPanel) document.getElementById('message-input')?.focus();
    else previous.origin.focus();
  }
  async function openBackground(runId: string, itemId?: string, panelTrigger?: HTMLButtonElement, toInbox?: () => void, inboxApproval = false) {
    const request = view.current;
    const origin = panelTrigger ?? document.activeElement as HTMLElement;
    const detail = await client.run(runId);
    if (view.current !== request || (panelTrigger && !panelTrigger.isConnected)) { toInbox?.(); return; }
    if (panelTrigger && ![...detail.questions.items, ...detail.approvals.items].some(item => item.id === itemId && item.status === 'pending')) {
      throw new Error('该待办已处理，请刷新任务详情。');
    }
    setProjection(state => mergeRunDetail(state, detail));
    const id = itemId ?? detail.questions.items.find(question => question.status === 'pending')?.id ?? detail.approvals.items.find(approval => approval.status === 'pending')?.id ?? '';
    const isApproval = inboxApproval || detail.approvals.items.some(approval => approval.id === id && approval.status === 'pending');
    backgroundReturn.current = { interactionId, management, origin, fromPanel: !!panelTrigger, toInbox };
    if (panelTrigger && !isApproval) {
      // Sheet 解除焦点约束后再交接。宽窗侧栏退出后，表单可立即接收焦点。
      backgroundFocus.current = docked ? 'inline' : 'sheet';
      if (backgroundFocus.current === 'inline') panelOrigin.current = null;
    }
    if (toInbox && !isApproval) backgroundFocus.current = 'inline';
    if (panelTrigger) setPanel(null);
    setBackgroundInteraction(runId); setManagement(undefined);
    setInteractionId(id);
    if (isApproval) setApprovalId(id);
    setInteractionCollapsed(false);
  }
  function openPending(item: InboxPage['items'][number], toInbox: () => void) {
    if (pending.current) { toInbox(); return; }
    void perform(async () => {
      if (activePage !== 'tasks') clearPages();
      try { await openBackground(item.run_id, item.id, undefined, toInbox, item.kind === 'approval'); }
      catch (error) { toInbox(); throw error; }
      // 待办可来自RunDetail首页之外；仍绑定Inbox返回的真实原对象及版本。
      if (item.kind === 'question') setProjection(state => mergeQuestions(state, [item.question]));
      else if (item.kind === 'approval') setProjection(state => mergeApprovals(state, [item.approval]));
    });
  }
  async function pendingAction(item: PendingAction, action: PendingAction['allowed_actions'][number], toInbox: () => void) {
    if (action.kind === 'view_task') {
      if (!compact) returnToInboxFromTask.current = toInbox;
      openTask(action.target_id);
      if (compact) toInbox();
      return;
    }
    if (action.kind === 'inspect_export_recovery') {
      await openBackground(action.target_id, 'recovery', undefined, toInbox);
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
    clearPages();
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
        // JSON 可读，但保存对话框应沿用原始字节的扩展名规则。
        binary: artifact.media_type !== 'text/plain' && artifact.media_type !== 'text/markdown',
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
      const key = { workspaceId: action.workspaceId, sessionId: action.kind === 'session' ? action.id : '' };
      try {
        if (action.kind === 'session') {
          await dispatchCommand({ type: 'deleteSession', args: [action.id, commandMeta(action.version)] }, { key, afterConfirmed: async () => {
            if (view.current.sessionId === action.id) chooseSession(Object.values(store.getSnapshot().sessions).find(session => session.workspace_id === action.workspaceId)?.id ?? '');
          } });
        } else {
          await dispatchCommand({ type: 'deleteWorkspace', args: [action.id, commandMeta(action.version)] }, { key, afterConfirmed: async () => {
            if (view.current.workspaceId === action.id) chooseWorkspace(Object.keys(store.getSnapshot().workspaces)[0] ?? '');
          } });
        }
        setConfirmation(undefined);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'skill_export_recovery_pending') {
          setConfirmation(undefined);
          clearPages();
          setSkillLibrary({ key: { workspaceId: action.workspaceId, sessionId: '' },
            origin: confirmationOrigin.current, recovery: true });
        }
        throw error;
      }
    });
  }

  async function send(event: FormEvent, choice?: 'text' | Record<string, string>) {
    event.preventDefault();
    const textOnly = choice === 'text';
    const adoptions = typeof choice === 'object' ? choice : undefined;
    if (sendUnavailable || (!textOnly && selectionUnavailable) || (!steering && fileIssue && !choice)) return;
    let request = view.current;
    const originalKey = { ...draftKey };
    const submitted = { ...drafts.read(originalKey), modelId, reasoningEffort };
    const resourceIds = textOnly ? [] : [...new Set([...submitted.resourceIds, ...Object.keys(adoptions ?? {})])];
    const mcpServerId = !steering && !textOnly ? mcpAdmission.selected : '';
    const submit = async () => { let accepted = false; await perform(async () => {
      if (steering) {
        await dispatchCommand({ type: 'steer', args: [activeRun!.id, { meta: commandMeta(activeRun!.version), data: { text: submitted.text } }] }, { key: originalKey, revision: submitted.revision, steering: true });
        return;
      }
      function checkDestination() {
        const current = store.getSnapshot();
        const currentModel = current.models[submitted.modelId];
        const currentConnection = currentModel && current.connections[currentModel.connection_id];
        if (!currentModel || !currentConnection || currentModel.version !== model.version || currentConnection.id !== connection!.id
          || currentConnection.version !== connection!.version) {
          throw new Error('模型或连接已变化，请核对模型、思考强度和发送目标后重试。');
        }
      }
      async function submitGoal(key: DraftKey, submitAgentId: string, ackKey: DraftKey, revision?: number) {
        checkDestination();
        const issueKey = fileIssueKey(key);
        const rememberFileIssue = (error: unknown) => {
          const issue = classifyFileIssue(error);
          if (issue) setFileIssues(current => ({ ...current, [issueKey]: issue }));
        };
        const command: UiCommand = { type: queueing ? 'enqueueUser' : 'startRun', args: [key.sessionId, { meta: commandMeta(), data: {
          agent_profile_id: submitAgentId, model_profile_id: submitted.modelId, text: submitted.text, allow_managed: submitted.allowManaged,
          model_selection: { model_version: model.version, connection_id: connection!.id, connection_version: connection!.version },
          ...(reasoningEffort === null ? {} : { reasoning_effort: reasoningEffort }),
          ...(textOnly || adoptions ? { inherit_session_files: false } : {}),
          ...(adoptions ? { session_file_adoptions: adoptions } : {}),
          allow_follow_up: submitted.allowFollowUp, source_result: textOnly ? null : submitted.sourceResult, limits: submitted.limits,
          sources: { resource_ids: resourceIds, memory_scopes: textOnly ? [] : memorySources.scopes,
            skill_versions: textOnly ? {} : submitted.skillVersions,
            skill_execution_permissions: textOnly ? {} : submitted.skillExecutionPermissions,
            excluded_source_ids: textOnly ? [] : submitted.excludedSourceIds.filter(id => !adoptions?.[id]) },
        } }, ...(mcpServerId ? [mcpServerId] : [])] } as UiCommand;
        const readCoverage = async () => {
          let result: ResourceCoverage;
          try { result = await client.resourceCoverage(key.sessionId, { resource_ids: resourceIds, model_profile_id: submitted.modelId }); }
          catch (error) { rememberFileIssue(error); throw error; }
          if (originalKey.sessionId && !adoptions && currentView(request)) setCoverage({ key: coverageKey, result });
          if (result.destination !== connection?.endpoint) throw new Error('接收方已变化，请刷新连接并核对发送目标。');
          checkDestination();
          return result;
        };
        const sendGoal = async () => {
          checkDestination();
          const outcome = await dispatchCommand(command, { key, draftKey: ackKey, revision, submitted, onRejected: rememberFileIssue,
            afterConfirmed: async () => clearFileIssue(issueKey, fileIssue) });
          accepted = outcome.status === 'confirmed';
        };
        const result = resourceIds.length ? await readCoverage() : undefined;
        if (!result) {
          await sendGoal();
          return;
        }
        const missing = [...new Set([...result.missing_read, ...result.missing_model_send])];
        const error = '所选资料的读取或发送授权已失效，请核对资料后再发送。';
        if (!result.allowed && (!missing.length || missing.some(id => directoryIds.includes(id)
          || (originalKey.sessionId && !adoptions?.[id] && !missingCoverage?.has(id))))) {
          throw new Error(error);
        }
        const [first, ...rest] = originalKey.sessionId ? [...new Set([...missing, ...Object.keys(adoptions ?? {})])] : resourceIds;
        if (!first) {
          await sendGoal();
          return;
        }
        await dispatchCommand({ type: 'grant', args: [{ meta: commandMeta(), data: {
          scope: { kind: 'session', workspace_id: key.workspaceId, session_id: key.sessionId },
          resource_ids: [first, ...rest], purposes: ['read', 'model_send'], destination: connection!.endpoint,
        } }] }, { key, draftKey: ackKey, onRejected: rememberFileIssue, afterConfirmed: async () => {
          if (!(await readCoverage()).allowed) throw new Error(error);
          await sendGoal();
        } });
      }
      if (originalKey.sessionId) {
        await submitGoal(originalKey, agentId, originalKey, submitted.revision);
        return;
      }
      checkDestination();
      userNavigated.current = true;
      await dispatchCommand({ type: 'createSession', args: [originalKey.workspaceId, { meta: commandMeta(), data: { title: null } }] }, {
        key: originalKey, afterConfirmed: async outcome => {
          const session = store.getSnapshot().sessions[outcome.sessionId!];
          if (!session) throw new Error('项目或会话已删除，当前输入已保留。');
          const key = { workspaceId: session.workspace_id, sessionId: session.id };
          const migration = drafts.move(originalKey, key, { modelId, reasoningEffort });
          const ackKey = migration ? key : originalKey;
          const revision = migration
            ? (migration.fromRevision === submitted.revision ? migration.moved.revision : undefined)
            : submitted.revision;
          if (view.current === request) {
            chooseSession(session.id);
            request = view.current;
          }
          if (session.agent_profile_id !== agent!.id) throw new Error('默认助理已变化，请核对新会话的模型后再发送。');
          setProjection(state => ({ ...state, profiles: mergeVersioned(state.profiles, [agent!]) }));
          await submitGoal(key, session.agent_profile_id, ackKey, revision);
        },
      });
    }); return accepted; };
    if (mcpServerId) {
      try { await mcpAdmission.send(mcpServerId, submitted.limits.deadline_seconds ?? 900,
        () => currentView(request) && drafts.read(originalKey).revision === submitted.revision, submit); }
      catch (error) { report(error); }
    } else await submit();
  }

  async function selectResources(kind: 'file' | 'directory', trigger: HTMLButtonElement, replace?: FileIssue) {
    const request = view.current;
    setNativeSelecting(true);
    try {
      await onFormActiveChange?.(true);
      const scope: ScopeRef = request.sessionId
        ? { kind: 'session', workspace_id: request.workspaceId, session_id: request.sessionId }
        : { kind: 'workspace', workspace_id: request.workspaceId, session_id: null };
      const selection = await invoke<{ resources: unknown[] }>('select_resources', { scope, kind });
      if (!selection.resources.length || view.current !== request || scopeDeleted(store.getSnapshot(), scope)) return;
      const selected = selection.resources.map(resource => validate('ResourceRef', resource));
      setProjection(state => mergeResources(state, selected));
      const key = { ...request };
      const current = drafts.read(key);
      const adopted = selected.map(resource => resource.id);
      drafts.update(key, {
        resourceIds: [...new Set([...current.resourceIds.filter(id => !replace?.resourceIds.includes(id)), ...adopted])],
        ...(replace ? { excludedSourceIds: [...new Set([...current.excludedSourceIds, ...replace.resourceIds])].filter(id => !adopted.includes(id)) } : {}),
      });
      if (replace) clearFileIssue(fileIssueKey(key), replace);
    } finally {
      setNativeSelecting(false);
      requestAnimationFrame(() => {
        if (view.current !== request || !document.activeElement?.matches('body,html,:disabled')) return;
        const target = trigger.isConnected ? trigger : workbenchRoot.current?.querySelector<HTMLElement>('#message-input');
        if (target && !target.closest('[inert]')) target.focus();
      });
    }
  }

  function requestSettings(section: 'models' | 'resources' | 'memory' | 'retrieval') {
    setRunConfigurationOpen(false);
    setPanel(null);
    if (onSettings) { onSettings(section); return; }
    void perform(async () => { await onFormActiveChange?.(true); await openSettings(section); });
  }
  function openConnection(connectionId: string) {
    setPanel(null);
    if (onSettings) { onSettings('models', connectionId); return; }
    void perform(() => showWorkbench({ kind: 'connection', connection_id: connectionId }));
  }

  const commandStatus = <CommandStatus commands={pendingCommands.filter(command => commandContexts.current.has(command.commandId))} busy={busy} canCheck={command => !!commandContexts.current.get(command.commandId)!.key.sessionId} location={command => {
    const context = commandContexts.current.get(command.commandId)!;
    const workspace = projection.workspaces[context.key.workspaceId]?.name;
    if (command.type === 'stopWorkspace' || command.type === 'createSession') return workspace ?? context.targetName ?? '原工作区尚未同步';
    return `${workspace ?? '原工作区尚未同步'} · ${projection.sessions[context.key.sessionId]?.title ?? context.targetName ?? '原会话尚未同步'}`;
  }} onCheck={command => void perform(async () => { await applyOutcome(await store.check(command.commandId, commandContexts.current.get(command.commandId)!.key.sessionId)); })}
    onRetry={command => void perform(async () => {
      let outcome: CommandOutcome;
      try { outcome = await store.retry(command.commandId); }
      catch (error) { commandContexts.current.get(command.commandId)?.onRejected?.(error); throw error; }
      await applyOutcome(outcome);
    })} />;

  function chooseDetail(next: DetailSection, origin: HTMLElement, toggle: boolean) {
    if (next === 'results') setDeliveryIds(undefined);
    if (next === 'tasks') setDetailRunId(undefined);
    if (next === 'artifacts') setArtifactId('');
    if (toggle && panel === next) closePanel();
    else openPanel(next, origin);
  }
  const unread = Object.values(projection.deliveries).some(entry => entry.target_session_id === sessionId && !entry.viewed_at && entry.source_valid);
  const detailButtons = (inside: boolean) => (Object.keys(detailSections) as DetailSection[]).map(name =>
    <Button key={name} variant="ghost" data-conversation-panel={name} aria-pressed={name === panel || name === 'tasks' && panel === 'trace'}
      aria-label={`${detailSections[name]}${name === 'results' && unread ? ' · 未读' : ''}`} title={detailTitles[name]}
      disabled={name === 'context' && !sessionId}
      onClick={event => chooseDetail(name, event.currentTarget, !inside)}>
      <UiIcon name={name === 'results' ? 'inbox' : name} /><span>{detailSections[name]}</span>
      {name === 'results' && unread && <i className="detail-unread" aria-hidden="true" />}
    </Button>);

  function showConversationTask(runId: string) {
    setDetailRunId(runId);
    openPanel('tasks');
  }
  function showArtifact(id: string, deliveryRunId?: string) {
    setArtifactDeliveryRunId(deliveryRunId);
    setArtifactId(id);
    openPanel('artifacts');
  }
  function showDeliveryArtifact(id: string, runId: string) {
    if (deliveryIdsByRun.get(runId)?.has(id)) loadPublishedArtifact(id, runId);
  }
  function loadPublishedArtifact(id: string, runId: string, activityId?: string) {
    const cached = visibleArtifacts.get(id);
    const deliveryRunId = activityId ? undefined : runId;
    if (cached && (!activityId || cached.activity_id === activityId)) { showArtifact(id, deliveryRunId); return; }
    void perform(async () => {
      const request = view.current;
      const page = await client.sessionArtifact(request.sessionId, id);
      if (!currentView(request)) return;
      const artifact = page.items.find(item => item.id === id && (!activityId || item.activity_id === activityId));
      if (!artifact) throw new Error('产物已不可用');
      const updated = setProjection(state => mergeRunPage(state, runId, { kind: 'artifacts', page: { ...page, items: [artifact] } }));
      if (updated.artifacts[id]) showArtifact(id, deliveryRunId);
    });
  }

  function conversationRunName(run: RunSnapshot) {
    if (dependenciesVisible(run.scope_dependencies)) {
      const goal = (run.id === selectedRun?.id ? selectedRunLabels?.task_title ?? selectedRunLabels?.task_goal : undefined)
        || projection.tasks[run.root_task_id]?.binding.agent_work?.goal;
      if (goal) return goal;
      const firstUserGoal = messageIds.map(id => projection.messages[id]).find(message => message.run_id === run.id
        && message.role === 'user' && message.origin === 'conversation');
      const text = firstUserGoal?.parts.find(part => part.kind === 'text')?.text;
      if (text || run.output?.summary) return text || run.output!.summary;
    }
    return run.config.kind === 'agent' ? `${runKinds[run.kind]} · ${run.config.agent_profile.display_name}` : runKinds[run.kind];
  }

  const detailContent = <>
    {panel === 'evidence' && evidenceTarget && <EvidenceReader client={client}
      workspaceId={evidenceTarget.workspaceId} evidenceId={evidenceTarget.evidenceId} onClose={closePanel}
      refreshKey={`${projection.knowledgeNotices[evidenceTarget.workspaceId]?.watermark ?? ''}:${projection.snapshotWatermark}:${fileAuthorization}`} />}
    {(panel === 'results' || evidenceReturn?.panel === 'results') && sessionId && <div hidden={panel !== 'results'} inert={panel !== 'results'}>
      <ResultInbox client={client} store={store} sessionId={sessionId} onCommand={dispatchCommand}
      onOpenEvidence={id => openEvidence(workspaceId, id)}
      deliveryIds={deliveryIds} onOpen={showConversationTask} activities={fixedActivities}
      messageDeliveryIds={new Set(reportMessages.keys())} onMessage={deliveryId => {
        const id = reportMessages.get(deliveryId);
        if (!id) return;
        setPanel(null);
        requestAnimationFrame(() => {
          const message = messageScroll.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
          message?.scrollIntoView({ block: 'nearest' });
          message?.querySelector('button')?.focus();
        });
      }}
      onArtifact={(artifact, entry, activityPage) => void perform(async () => {
        const request = view.current;
        const trigger = document.activeElement;
        const detail = await client.run(entry.result.run_id);
        const current = store.getSnapshot();
        if (!trigger?.isConnected || !currentView(request) || detail.source_valid === false || !current.deliveries[entry.id]?.source_valid
          || current.deliveries[entry.id].result_version !== entry.result_version) return;
        setProjection(state => {
          let next = mergeRunDetail(state, detail);
          if (activityPage) next = mergeRunPage(next, detail.run.id, { kind: 'activities', page: activityPage });
          return mergeRunPage(next, detail.run.id, { kind: 'artifacts', page: { ...detail.artifacts, items: [artifact] } });
        });
        showArtifact(artifact.id);
      })}
      summaryBlocked={busy || pendingSubmission || activeRun?.kind === 'user' || projection.sessions[sessionId]?.archived}
      onSummarize={entry => { drafts.update(draftKey, { sourceResult: entry.id, summaryRunId: null }); setPanel(null); requestAnimationFrame(() => document.getElementById('message-input')?.focus()); }} /></div>}
    {panel === 'resources' && workspaceId && <ResourcePanel client={client} workspaceId={workspaceId} sessionId={sessionId || null} refreshKey={Object.values(projection.grants).map(item => `${item.id}:${item.version}`).join(',') + Object.values(projection.scopes).map(item => `${item.id}:${item.epoch}`).join(',')} isRevokePending={id => pendingCommands.some(command => command.type === 'revoke' && commandContexts.current.get(command.commandId)?.targetId === id)} onGrantsLoaded={items => setProjection(state => mergeGrants(state, items))} onRevoke={(id, meta) => dispatchCommand({ type: 'revoke', args: [id, meta] })} />}
    {(panel === 'tasks' || evidenceReturn?.panel === 'tasks') && detailRunId && <div hidden={panel !== 'tasks'} inert={panel !== 'tasks'}>
      <IconButton icon="back" label="返回会话任务" onClick={() => setDetailRunId(undefined)} />
      <TaskDetail client={client} store={store} runId={detailRunId} onCommand={(command, key) => dispatchCommand(command, { key })}
        onQuestion={(runId, itemId, trigger) => void perform(() => openBackground(runId, itemId, trigger))} onOpen={showConversationTask} onOpenConnection={openConnection} onOpenEvidence={openEvidence}
        onExport={chooseExport} exportBlocked={nativeSelecting || pendingCommands.some(command => command.type === 'exportArtifact')} />
    </div>}
    {(panel === 'context' || evidenceReturn?.panel === 'context') && sessionId && <div hidden={panel !== 'context'} inert={panel !== 'context'}>
      <ContextPanel key={sessionId} client={client} sessionId={sessionId}
      revision={`${projection.contextWatermark}:${accountingRevision}:${projection.knowledgeNotices[workspaceId]?.watermark ?? ''}`}
      accountingRevision={accountingRevision} authorization={`${projection.snapshotWatermark}:${fileAuthorization}`}
      onOpenEvidence={id => openEvidence(workspaceId, id)}
      onInspect={openTask} onResources={() => openPanel('resources')}
      fileSelectionDisabled={busy || configurationLocked || nativeSelecting || !!projection.sessions[sessionId]?.archived}
      onUseFileVersion={(trigger, observedRunId, resourceIds) => void perform(() => selectResources('file', trigger,
        { kind: 'version', observedRunId, resourceIds }))} /></div>}
    {panel === 'tasks' && !detailRunId && <>
      {feedbackQuery?.request === view.current && feedbackQuery.failed && <div className="status-message" role="status">
        <p>暂时无法读取本会话的任务反馈。</p>
        <Button variant="outline" size="sm" disabled={feedbackQuery.loading} onClick={() => setFeedbackRetry(value => value + 1)}>重新读取消息反馈</Button>
      </div>}
      {selectedRun && <RunFeedbackNotice run={selectedRun} feedback={projection.runFeedback[selectedRun.id]} onOpenConnection={openConnection} />}
      <div className="button-row">
        <Button size="sm" variant={graph ? 'secondary' : 'ghost'} aria-pressed={graph} onClick={() => setGraph(true)}>任务图</Button>
        <Button size="sm" variant={graph ? 'ghost' : 'secondary'} aria-pressed={!graph} onClick={() => setGraph(false)}>任务列表</Button>
      </div>
      <section className="run-navigation" aria-label="会话任务"><h3>会话任务</h3>{runs.map(run => <Button key={run.id} variant="ghost" size="sm" className="run-nav" onClick={() => selectRun(run.id)}>
        <span>{conversationRunName(run)}</span><Status state={run.state} /></Button>)}
        {runListCursor && <Button variant="ghost" size="sm" disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.sessionRuns(sessionId, { cursor: runListCursor }); if (!currentView(request)) return; setProjection(state => page.items.reduce(mergeRunSnapshot, state)); setRunListCursor(page.next_cursor); })}>更多会话任务</Button>}
      </section><Button variant="outline" size="sm" onClick={() => setPanel('trace')}>查看 Trace</Button>
      {graph ? <TaskGraph tasks={tasks} activities={activities} waits={Object.values(projection.waits).filter(item => item.run_id === selectedRun?.id)}
        consumptions={Object.values(projection.consumptions).filter(item => item.run_id === selectedRun?.id)} joins={Object.values(projection.joins).filter(item => item.run_id === selectedRun?.id)}
        collapsedIds={collapsed} selectedId={selectedNode?.id} onSelect={(id, kind) => setSelectedNode({ id, kind })} onToggle={id => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />
        : <TaskList tasks={tasks} activities={activities} selectedId={selectedNode?.id} onSelect={(id, kind) => setSelectedNode({ id, kind })} />}
      {selectedRunSources && selectedNode && <SelectedStep id={selectedNode.id} tasks={tasks} activities={activities.filter(sourcesVisible)}
        fileNames={selectedRunLabels?.file_names} taskTitles={selectedRunLabels?.task_titles} onArtifact={showArtifact} />}
      {selectedRun && Object.entries(runCursors[selectedRun.id] ?? {}).filter(([, cursor]) => cursor).map(([kind]) => <Button key={kind} disabled={busy} onClick={() => perform(() => loadRunPage(kind as RunPageInput['kind']))}>更多 {kind}</Button>)}
    </>}
    {panel === 'artifacts' && <>
      {artifactOptions.length > 0 && (!selectedArtifact || artifactOptions.length > 1) && <div className="artifact-links">{artifactOptions.map(({ artifact, label }) =>
        <Button key={artifact.id} size="sm" variant={artifact.id === artifactId ? 'secondary' : 'ghost'} aria-pressed={artifact.id === artifactId} onClick={() => setArtifactId(artifact.id)}>{label}</Button>)}</div>}
      {artifactOptions.length === 0 && <p className="empty-state">暂无产物。</p>}
      {artifactOptions.length > 0 && <ArtifactPanel key={projection.snapshotWatermark} artifact={selectedArtifact ?? null} label={selectedArtifactLabel}
        client={client} onExport={chooseExport} exportBlocked={nativeSelecting || pendingCommands.some(command => command.type === 'exportArtifact' && commandContexts.current.get(command.commandId)?.targetId === selectedArtifact?.id || command.type === 'grant' && !!commandContexts.current.get(command.commandId)?.afterConfirmed)}
        onSelectSource={(taskId, activityId) => void perform(async () => {
          const request = view.current;
          const task = projection.tasks[taskId] ?? await client.task(taskId);
          if (currentView(request)) {
            if (projection.runs[task.run_id]?.kind === 'managed') showConversationTask(task.run_id);
            else { setSelectedNode({ id: activityId, kind: 'activity' }); setSelectedRunId(task.run_id); setPanel('trace'); }
          }
        })} />}
    </>}
    {panel === 'trace' && <TracePanel client={client} events={(tracePage?.items ?? []).map(event => ({
      ...event, activities: event.activities.filter(sourcesVisible),
    }))} selectedId={selectedNode?.id}
      onSelect={(id, kind) => setSelectedNode({ id, kind })} onArtifact={showArtifact} nextCursor={tracePage?.next_cursor} loading={busy}
      onLoadMore={() => void perform(async () => { const request = view.current, owner = trace!; const page = await client.trace(owner.runId, { cursor: owner.page.next_cursor! });
        if (currentView(request)) setTrace(current => current === owner ? { runId: owner.runId, page: { ...page,
          items: [...new Map([...owner.page.items, ...page.items].map(item => [item.event_id, item])).values()]
            .sort((left, right) => BigInt(left.event_id) < BigInt(right.event_id) ? -1 : BigInt(left.event_id) > BigInt(right.event_id) ? 1 : 0) } } : current); })} />}
  </>;

  const hasModels = Object.keys(projection.models).length > 0;
  const needsModel = !hasModels && catalog?.models === null;
  const sendUnavailable = busy || !!mcpAdmission.waiting || !workspaceId || readyWorkspace !== workspaceId
    || (!!sessionId && (workReadySession !== sessionId || projection.sessions[sessionId]?.archived))
    || pendingSubmission || (!!steering && !canSteer) || !text.trim()
    || (!!draft.sourceResult && !!steering)
    || (!steering && ((!!sessionId && !draft.modelId && !sessionChoice && modelHistoryReadySession !== sessionId)
      || effortPending || !agent || !modelAvailable));
  const selectionUnavailable = sourceResultInvalid || (!steering && (memorySources.loading
    || draft.resourceIds.length !== resources.length
    || (!!sessionId && draft.resourceIds.length > 0 && (!missingCoverage || !directoriesGranted))));
  const sendDisabled = sendUnavailable || selectionUnavailable || (!steering && !!fileIssue);
  const historicalFiles = new Map<string, { name: string; version?: string }>();
  if (fileIssue) {
    for (const id of messageIds.slice().reverse()) {
      const message = projection.messages[id];
      if (messageSourceInvalid(message, projection)) continue;
      for (const attachment of message.attachments ?? []) {
        const resourceId = attachment.resource_id;
        if (!fileIssue.resourceIds.includes(resourceId) || historicalFiles.has(resourceId)
          || !attachment.resource_lineage.every(id => !projection.scopes[id] || projection.scopes[id].status === 'active')
          || !attachment.read_grant_ids.some(id => projection.grants[id]?.status === 'active'
            && (!projection.scopes[id] || projection.scopes[id].status === 'active'))) continue;
        const version = projection.runs[message.run_id]?.file_inputs?.[resourceId]?.source_version;
        historicalFiles.set(resourceId, { name: attachment.name, version });
      }
    }
  }
  const adoptionVersions = fileIssue?.kind === 'recipient' && fileIssue.resourceIds.length > 0
    && fileIssue.resourceIds.every(id => !!historicalFiles.get(id)?.version)
    ? Object.fromEntries(fileIssue.resourceIds.map(id => [id, historicalFiles.get(id)!.version!])) : undefined;
  const issueLabels = fileIssue && [...new Set([
    ...resources.filter(resource => fileIssue.resourceIds.includes(resource.id)).map(resource => resource.label),
    ...[...historicalFiles.values()].map(file => file.name),
  ])];
  const showWelcome = initialized && !!workspaceId && readyWorkspace === workspaceId
    && (!sessionId || modelHistoryReadySession === sessionId) && !messageIds.length && !historyCursor && !runs.length
    && (hasModels || needsModel);
  const showStartAction = showWelcome && needsModel;

  const backToTaskCenter = management === 'detail' && !!taskDetailOrigin.current && !returnToInboxFromTask.current;
  return <main ref={workbenchRoot} className={`workbench ${compact ? 'workbench--compact' : ''}`}>
    <ProjectSidebar client={client} workspaceId={workspaceId} sessionId={sessionId} activePage={activePage} drawerToggleRef={navTrigger} sessionVersions={projection.sessions}
      renderScopeActions={(target, createSession) => <ScopeActions client={client} target={target} onCommand={dispatchCommand} onNewSession={createSession}
        onRename={origin => setRenameTarget({ target, origin })}
        onSuggestName={'name' in target ? origin => setRenameTarget({ target, origin, suggest: true }) : undefined}
        onDirectory={!compact && 'name' in target ? origin => setDirectoryTarget({ workspace: target, origin }) : undefined}
        onDelete={origin => {
          confirmationOrigin.current = origin;
          if ('title' in target) setConfirmation({ kind: 'session', id: target.id, workspaceId: target.workspace_id, version: target.version, name: target.title });
          else setConfirmation({ kind: 'workspace', id: target.id, workspaceId: target.id, version: target.version, name: target.name });
        }}
        busy={busy || pendingCommands.some(command => ['stopSession', 'stopWorkspace', 'archiveSession'].includes(command.type))} />}
      refreshKey={`${projection.cursor}:${Object.values(projection.sessions).map(item => `${item.id}:${item.version}`).join(',')}:${Object.values(projection.workspaces).map(item => `${item.id}:${item.version}`).join(',')}`}
      onTaskCenter={() => showPage(openTaskCenter)} onCapabilities={() => showPage(() => openSkillLibrary('personal'))}
      onMemory={() => showPage(() => openMemory())} onAssistants={() => showPage(openAssistants)}
      onKnowledge={() => showPage(() => openKnowledge())}
      onPendingOpen={openPending} onPendingAction={pendingAction} onOpenInbox={showPage} onFormActiveChange={setSidebarFormActive} allowDirectoryCreation={!compact} deletedWorkspaceIds={Object.keys(projection.deletedWorkspaces)} deletedSessionIds={Object.keys(projection.deletedSessions)} onDefaultWorkspace={id => {
      defaultWorkspaceId.current = id;
      if (id && !userNavigated.current && view.current.workspaceId && view.current.workspaceId !== id && !scopeDeleted(store.getSnapshot(), { workspace_id: id, session_id: null })) chooseWorkspace(id);
    }} onNewSession={(id, returnFocus) => showPage(() => { userNavigated.current = true; clearPages(); newSession(id, returnFocus); })}
      onNavigate={target => showPage(() => navigateProject(target))} onCreated={workspace => setProjection(state => mergeWorkspaces(state, [workspace]))} onSettings={() => requestSettings('models')} />
    <div className={`conversation-layout${activePage ? ' hidden!' : ''}`} hidden={!!activePage} inert={!!activePage}
      onKeyDown={event => {
        if (docked && panel && event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing
          && event.nativeEvent.keyCode !== 229 && !(event.target as HTMLElement).closest('[role="dialog"],[role="menu"]')) {
          event.preventDefault();
          closePanel();
        }
      }}>
    <section className={`conversation ${showWelcome ? 'conversation--empty' : ''}`}><header className="conversation-header"><div><div className="assistant-identity">{agent && <span className="profile-symbol" aria-label="助理图标">{assistantIcons.find(icon => icon.id === agent.icon_id)?.symbol ?? agent.icon_id}</span>}<h1>{agent?.display_name ?? '主助理'}</h1></div><h2>{projection.sessions[sessionId]?.title ?? '新会话'}</h2></div>
      <div className="button-row">{!management && onReturnToQuick && <IconButton icon="quick" label="返回快捷小窗" onClick={() => void perform(onReturnToQuick)} />}{headerActions}</div></header>
    <p className={`connection-status ${['本机事件流已连接', '本机连接就绪', '操作已确认'].includes(status) ? 'connection-status--ready' : ''}`} role="status">{status}</p>
    {!management && commandStatus}
    <p className="sr-only" role="status" aria-live="polite">{completion}</p>
    <section ref={messageScroll} className="messages" aria-label="持久对话" onScroll={event => { scrollPositions.current.set(sessionId, event.currentTarget.scrollTop); }}><div className="thread">
      {showWelcome && <section className="conversation-start" aria-label="会话引导">
        <h2>今天想做什么？</h2>
        {showStartAction && <div className="conversation-start-model">
          <span>连接模型后即可发送</span>
          <Button variant="outline" size="sm" onClick={() => requestSettings('models')}>配置模型</Button>
        </div>}
      </section>}
      {currentCitationContext?.error && <div role="status"><p>引用资料名称暂不可用：{currentCitationContext.error}</p>
        <Button size="sm" variant="ghost" onClick={() => retryCitations(value => value + 1)}>重试</Button></div>}
      <MessageList client={client} store={store} messages={messageIds.map(id => projection.messages[id]).filter(Boolean)} assistantName={agent?.display_name ?? '主助理'}
        evidenceLabels={citationLabels}
        activities={Object.values(projection.activities)} previews={projection.previews} reasoningPreviews={projection.reasoningPreviews}
        runs={runs} artifacts={chatArtifacts} onOpenArtifact={showDeliveryArtifact} onOpenToolArtifact={loadPublishedArtifact} onInspectRun={openTask}
        hideInlineContext={panel === 'context'}
        onOpenEvidence={openEvidence}
        onOpenResults={ids => { setDeliveryIds(ids); openPanel('results'); }} />
      {historyCursor && <Button variant="ghost" size="sm" disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.messages(sessionId, { cursor: historyCursor }); if (!currentView(request)) return; setHistoryCursor(page.next_cursor); setProjection(state => mergeMessages(state, sessionId, page)); })}>更多历史</Button>}
      <section className="run-actions" aria-label="运行与待办">
        {runs.filter(run => run.state === 'interrupted' && run.reason === queryUncertain).map(run => {
          const activity = Object.values(projection.activities).find(item => item.run_id === run.id && item.state === 'uncertain'
            && item.error === 'mcp_call_uncertain');
          return <McpQueryRecovery key={run.id} client={client} run={run}
            tool={activity && run.config.catalog.mcp_tools[activity.operation]?.original_name}
            revision={`${projection.cursor}:${projection.sessions[sessionId]?.version ?? ''}`}
            busy={busy || unconfirmed('resume', run.id)} onInspect={() => openTask(run.id)}
            onResume={(version, retryReadonly) => void perform(() => dispatchCommand({
              type: 'resume', args: [run.id, commandMeta(version), retryReadonly],
            }))} />;
        })}
        {todoCursors?.active_runs && <Button variant="outline" size="sm" disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.activeRuns(workspaceId, { cursor: todoCursors.active_runs! }); const details = await Promise.all(page.items.map(run => client.run(run.id))); if (view.current !== request) return; setProjection(state => details.reduce(mergeRunDetail, state)); setTodoCursors(current => current && ({ ...current, active_runs: page.next_cursor })); })}>更多运行</Button>}
        {todoCursors?.pending_questions && <Button variant="outline" size="sm" disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.pendingQuestions(workspaceId, { cursor: todoCursors.pending_questions! }); const details = await Promise.all([...new Set(page.items.map(question => question.run_id))].map(id => client.run(id))); if (view.current !== request) return; setProjection(state => mergeQuestions(details.reduce(mergeRunDetail, state), page.items)); setTodoCursors(current => current && ({ ...current, pending_questions: page.next_cursor })); })}>更多问题</Button>}
        {todoCursors?.pending_approvals && <Button variant="outline" size="sm" disabled={busy} onClick={() => perform(async () => { const request = view.current; const page = await client.pendingApprovals(workspaceId, { cursor: todoCursors.pending_approvals! }); const details = await Promise.all([...new Set(page.items.map(approval => approval.run_id))].map(id => client.run(id))); if (view.current !== request) return; setProjection(state => mergeApprovals(details.reduce(mergeRunDetail, state), page.items)); setTodoCursors(current => current && ({ ...current, pending_approvals: page.next_cursor })); })}>更多审批</Button>}
        <ManagedTaskStrip runs={runs} intents={Object.values(projection.followUpIntents).filter(intent => intent.target_session_id === sessionId)} busy={busy}
          onOpen={id => projection.runs[id].kind === 'follow_up' ? selectRun(id) : openTask(id)}
          onQuestion={id => void perform(() => openBackground(id))} onStop={run => void perform(() => dispatchCommand({ type: 'cancel', args: [run.id, commandMeta(run.version)] }))} />
        <PendingUserCommands commands={sessionCommands} runs={projection.runs} onOpen={id => void perform(async () => {
          const request = view.current, detail = await client.run(id);
          if (currentView(request)) { setProjection(state => mergeRunDetail(state, detail)); selectRun(id); }
        })} />
        {questions.map(question => <p key={question.id}>有待回答的问题 <Button variant="ghost" size="sm" onClick={() => { setInteractionId(question.id); setInteractionCollapsed(false); }}>回答问题</Button></p>)}
        {Object.values(projection.questions).filter(question => question.status !== 'pending' && projection.runs[question.run_id]?.interaction_session_id === sessionId).flatMap(question => Object.entries(questionDrafts).filter(([key, draft]) => key.startsWith(`${question.id}:`) && draft.value !== undefined).map(([key, draft]) => <p key={key}>问题已处理，未提交的回答已保留：{typeof draft.value === 'string' ? draft.value : JSON.stringify(draft.value)}</p>))}
      </section>
    </div></section>
    <div className="composer-wrap"><div className="composer-inner">
    {interactions.length > 1 && <Field className="interaction-picker"><FieldLabel htmlFor={`${summaryDisclosureName}-pending-item`}>当前待办</FieldLabel>
      <NativeSelect id={`${summaryDisclosureName}-pending-item`} value={interaction?.id} onChange={event => { setInteractionId(event.target.value); setInteractionCollapsed(false); }}>
        {interactions.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.title}{item.kind === 'question' ? `：${item.question.question}` : ''}</NativeSelectOption>)}
      </NativeSelect>
    </Field>}
    {backgroundInteraction && <div className="background-return"><p>仅处理原后台任务；当前会话、草稿和本次配置不变。</p><IconButton icon="back" label="返回原页与草稿" onClick={returnFromBackground} /></div>}
    {interaction && <InteractionPanel ref={interactionPanel} item={interaction} collapsed={interactionCollapsed} onCollapse={() => setInteractionCollapsed(value => !value)}>
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
    {interaction.kind === 'approval' && <Button variant="outline" size="sm" onClick={() => setApprovalId(interaction.approval.id)}>查看审批</Button>}
    {interaction.kind === 'recovery' && <RecoveryPanel publications={publications} busy={busy} isPending={id => pendingCommands.some(command => ['restoreExport', 'releaseExport'].includes(command.type) && commandContexts.current.get(command.commandId)?.targetId === id)} onCommand={(type, item) => dispatchCommand({ type, args: [item.id, commandMeta(item.version)] }, { key: { workspaceId: item.workspace_id, sessionId: item.session_id } })} />}
    {interaction.kind === 'scope' && <section className="resource-bar" aria-label="资料选择"><div className="interaction-body">
      {sessionId && resourcesSyncing && <p>资料与授权同步中；尚未加载的授权状态未知。</p>}
      {currentCoverage?.error && <p role="alert">{currentCoverage.error}<Button variant="outline" size="sm" onClick={() => setCoverageRevision(value => value + 1)}>重新核对授权</Button></p>}
      {resourceCursors?.resources && <Button variant="outline" size="sm" disabled={busy || !sessionId} onClick={() => perform(() => loadResourcePage('resources'))}>更多资料</Button>}
      {resourceCursors?.grants && <Button variant="outline" size="sm" disabled={busy || !sessionId} onClick={() => perform(() => loadResourcePage('grants'))}>更多授权</Button>}
      {!activePage && <KnowledgeImport key={workspaceId} client={client} workspaceId={workspaceId}
        onFormActiveChange={setKnowledgeFormActive} trigger={(review, importing) => <ul aria-label="本次附件">{draft.resourceIds.map((id, index) => {
        const name = projection.resources[id]?.label ?? `附件 ${index + 1}（正在同步）`;
        return <li key={id} className="inline-flex max-w-full items-center gap-1">
          <span className="min-w-0 wrap-anywhere">{name}</span>
          {projection.resources[id]?.kind === 'file' && <DropdownMenu>
            <DropdownMenuTrigger asChild><IconButton icon="more" size="icon-xs" label={`附件「${name}」的更多操作`} /></DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem disabled={importing}
              onSelect={() => review([projection.resources[id]])}>加入项目资料</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>}
          <IconButton icon="close" size="icon-xs" label={`移除附件「${name}」`} disabled={busy || configurationLocked}
            onClick={event => {
              const row = event.currentTarget.closest('li')!;
              const adjacent = row.nextElementSibling ?? row.previousElementSibling;
              const focusTarget = adjacent?.querySelector<HTMLButtonElement>('button[data-icon-action="close"]')
                ?? workbenchRoot.current?.querySelector<HTMLTextAreaElement>('#message-input');
              focusTarget?.focus();
              drafts.update(draftKey, { resourceIds: draft.resourceIds.filter(item => item !== id) });
            }} />
        </li>;
      })}</ul>} />}
      <p>点击发送即同意本次读取所列文件并发送至：{connection ? `${connection.display_name} · ${connection.endpoint}` : model ? '连接尚未同步，无法确认目的地' : '请先选择模型'}。此授权仅用于当前会话。{directoryIds.length > 0 && '目录范围需要另行授权。'}</p></div>
      {directoryIds.length > 0 && <footer className="interaction-footer"><Button variant="outline" size="sm" disabled={busy || !connection || directoriesGranted || resourcesSyncing || !missingCoverage || configurationLocked || unconfirmed('grant')} onClick={() => perform(() => dispatchCommand({ type: 'grant', args: [{ meta: commandMeta(), data: { scope: { kind: 'session', workspace_id: workspaceId, session_id: sessionId }, resource_ids: directoryIds as [string, ...string[]], purposes: ['read', 'model_send'], destination: connection.endpoint } }] }))}>{directoriesGranted ? '当前目录已授权' : resourcesSyncing ? '授权状态同步中' : '授权读取并发送目录'}</Button></footer>}
    </section>}
    </InteractionPanel>}
    {interaction?.kind !== 'scope' && <div className="resource-pagination">{resourceCursors?.resources && <Button variant="ghost" size="sm" onClick={() => perform(() => loadResourcePage('resources'))}>更多资料</Button>}{resourceCursors?.grants && <Button variant="ghost" size="sm" onClick={() => perform(() => loadResourcePage('grants'))}>更多授权</Button>}</div>}
    {activeRun?.kind === 'follow_up' && !activeRun.yield_requested && !activeRun.follow_up_closed &&
      <FieldSet className="mb-2"><FieldLegend id={`${summaryDisclosureName}-summary-mode`}>本次输入</FieldLegend>
        <RadioGroup aria-labelledby={`${summaryDisclosureName}-summary-mode`} className="flex flex-wrap gap-3" disabled={busy}
          value={editingSummary ? 'edit' : 'new'} onValueChange={value => drafts.update(draftKey, { summaryRunId: value === 'edit' ? activeRun.id : null })}>
          <Field orientation="horizontal"><RadioGroupItem id={`${summaryDisclosureName}-new-goal`} value="new" />
            <FieldLabel htmlFor={`${summaryDisclosureName}-new-goal`}>新目标（默认排队）</FieldLabel></Field>
          <Field orientation="horizontal"><RadioGroupItem id={`${summaryDisclosureName}-edit-summary`} value="edit" disabled={!!draft.sourceResult} />
            <FieldLabel htmlFor={`${summaryDisclosureName}-edit-summary`}>修改这个总结</FieldLabel></Field>
        </RadioGroup>
      </FieldSet>}
    {draft.sourceResult && <section className="resource-bar" aria-label="本次总结引用"><p>本次将总结所选交付结果 · 结果版本 {sourceResult?.result_version ?? '待同步'}</p>
      <p>使用本次模型、资料与限额创建新的用户任务。</p>{sourceResultInvalid && <p role="alert">总结引用已失效或尚未同步，请重新选择结果</p>}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => drafts.update(draftKey, { sourceResult: null })}>移除总结引用</Button></section>}
    {Object.keys(draft.skillVersions).length > 0 && <section aria-label="新目标的 Skill 版本" className="skill-pins">
      {Object.entries(draft.skillVersions).map(([id, hash], index) => {
        const label = skillLabels[`${id}:${hash}`];
        const name = label?.name ?? `已选 Skill ${index + 1}`;
        return <span key={id}>{name} · {label?.release || '本次已选版本'}
        {id in draft.skillExecutionPermissions && (draft.skillExecutionPermissions[id] ? ' · 本机脚本已选' : ' · 仅指导')}
        <IconButton type="button" icon="close" size="icon-xs" label={label ? `移除 Skill ${name}` : `移除${name}`} onClick={() => {
          const skillVersions = { ...draft.skillVersions };
          const skillExecutionPermissions = { ...draft.skillExecutionPermissions };
          delete skillVersions[id]; delete skillExecutionPermissions[id];
          drafts.update(draftKey, { skillVersions, skillExecutionPermissions });
        }} /></span>;
      })}
      {steering && <p>这些版本为新目标保留；补充指令沿当前运行原版本。</p>}
    </section>}
    {defaultModelLoading && <p role="status" id="default-model-status">正在加载默认模型…</p>}
    {defaultModelError && <div id="default-model-status"><p role="alert">{defaultModelError}</p><Button onClick={() => retryModelLookup(value => value + 1)}>重试加载默认模型</Button></div>}
    {fileIssue && !steering && <section className="resource-bar" aria-label="处理会话文件">
      <div className="interaction-body">
        <p role="status">{fileIssue.kind === 'recipient'
          ? `会话文件的接收方已改变。请确认要发送到 ${connection?.display_name} · ${connection?.endpoint} 的文件。`
          : '文件已改变。重新选择文件可使用新版。'}</p>
        {adoptionVersions ? <ul aria-label="可继续使用的原文件版本">
          {fileIssue.resourceIds.map(id => <li key={id}>{historicalFiles.get(id)!.name} · 版本{' '}
            <code title={adoptionVersions[id]}>{adoptionVersions[id].slice(0, 12)}</code></li>)}
        </ul> : !!issueLabels?.length && <p>{issueLabels.join('、')}</p>}
      </div>
      <footer className="interaction-footer">
        {adoptionVersions && <Button type="button" size="sm" disabled={sendUnavailable || selectionUnavailable}
          onClick={event => void send(event, adoptionVersions)}>向此接收方使用原文件版本</Button>}
        <Button type="button" size="sm" disabled={busy || configurationLocked} onClick={event => {
          const trigger = event.currentTarget;
          void perform(() => selectResources('file', trigger, fileIssue));
        }}>{fileIssue.kind === 'recipient' ? '重新选择要发送的文件' : '重新选择以使用新版'}</Button>
        <Button type="button" variant="outline" size="sm" disabled={sendUnavailable} onClick={event => void send(event, 'text')}>仅发送本条文字</Button>
      </footer>
    </section>}
    <Composer value={text} onChange={setText} onSubmit={send} steering={!!canSteer} queueing={queueing}
      onStop={activeRun ? () => void perform(() => dispatchCommand({ type: 'cancel', args: [activeRun.id, commandMeta(activeRun.version)] })) : undefined}
      stopDisabled={busy || !!activeRun && unconfirmed('cancel', activeRun.id)}
      blockedReason={!workspaceId ? '请选择项目' : needsModel && !steering ? '请先配置模型'
        : !modelId && !steering ? '在输入区选择本次使用的模型'
        : projection.sessions[sessionId]?.archived ? '会话已归档，取消归档后可发送。草稿已保留'
        : draft.sourceResult && steering ? '当前用户任务结束后可总结所选结果，草稿已保留'
        : steering && !canSteer ? activeRoot?.kind === 'tool' ? '导出结束后可发送；也可另开会话' : '正在同步当前运行类型，草稿已保留'
        : pendingSubmission ? '请先核对上次提交，草稿已保留'
        : !sessionId && !agent ? '正在读取默认助理' : undefined}
      toolbar={<div className="composer-toolbar">
        {!steering && <McpAdmission admission={mcpAdmission} />}
        <IconButton type="button" icon="file" label="选择文本文件" disabled={busy || !workspaceId || readyWorkspace !== workspaceId || configurationLocked} onClick={event => {
          const trigger = event.currentTarget;
          void perform(() => selectResources('file', trigger));
        }} />
        <IconButton type="button" icon="folder" label="选择目录" disabled={busy || !sessionId || configurationLocked} onClick={event => {
          const trigger = event.currentTarget;
          void perform(() => selectResources('directory', trigger));
        }} />
        <IconButton type="button" icon="skill" label="选择 Skill" disabled={!workspaceId || readyWorkspace !== workspaceId || busy || pendingSubmission} onClick={() => openSkillLibrary('project')} />
        <ComposerModelPicker models={Object.values(projection.models)}
          connections={Object.values(projection.connections)}
          providerPresets={providerPresets}
          recentModelIds={recentModelIds} modelId={lockedModel?.id ?? modelId} onModelChange={setModelId}
          effort={lockedModel ? lockedModel.reasoning_effort ?? null : reasoningEffort}
          effortOptions={lockedModel ? lockedModel.capabilities.reasoning_efforts ?? [] : effortOptions}
          onEffortChange={value => drafts.update(draftKey, { modelId, reasoningEffort: value })}
          disabled={!workspaceId || busy || configurationLocked} onLoadCatalog={loadCatalog} />
        <Button type="button" ref={runConfigurationTrigger} variant="ghost" size="sm" aria-label="运行配置"
          aria-haspopup="dialog" onClick={() => setRunConfigurationOpen(true)}>运行配置</Button>
      </div>}
      disabled={sendDisabled} />
        {runConfigurationOpen && <Dialog title="运行配置" onClose={() => setRunConfigurationOpen(false)} onReturnFocus={() => {
          if (!runConfigurationTrigger.current?.closest('[inert]')) runConfigurationTrigger.current?.focus();
        }}><FieldGroup className="run-configuration">
          <FieldSet disabled={busy || configurationLocked}>
            <FieldLegend>新运行的配置（当前运行固定原配置）</FieldLegend>
            <Field><FieldLabel htmlFor={`${summaryDisclosureName}-agent`}>助理</FieldLabel>
              <NativeSelect id={`${summaryDisclosureName}-agent`} value={agent?.id ?? ''} disabled={!sessionId} onChange={event => {
                const profile = projection.profiles[event.target.value];
                setAgentId(profile.id);
                setModelId(profile.default_model_profile_id ?? sessionChoice?.model_profile_id ?? recentModelIds[0] ?? '');
              }}>
                {Object.values(projection.profiles).map(profile => <NativeSelectOption key={profile.id} value={profile.id}>{profile.display_name}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            {profilePage?.next_cursor && <Button variant="outline" size="sm" className="self-start" onClick={() => perform(async () => {
              const page = await client.profiles({ cursor: profilePage.next_cursor! });
              setProfilePage(page); setProjection(state => ({ ...state, profiles: mergeVersioned(state.profiles, page.items) }));
            })}>更多助理</Button>}
            <Field orientation="horizontal"><Checkbox id={`${summaryDisclosureName}-managed`} disabled={busy || configurationLocked}
              checked={draft.allowManaged} onCheckedChange={allowManaged => drafts.update(draftKey, { allowManaged: allowManaged === true })} />
              <FieldLabel htmlFor={`${summaryDisclosureName}-managed`}>允许本次转为独立后台任务</FieldLabel></Field>
            <Field orientation="horizontal"><Checkbox id={`${summaryDisclosureName}-follow-up`} disabled={busy || configurationLocked}
              checked={draft.allowFollowUp} onCheckedChange={allowFollowUp => drafts.update(draftKey, { allowFollowUp: allowFollowUp === true })} />
              <FieldLabel htmlFor={`${summaryDisclosureName}-follow-up`}>完成后自动总结</FieldLabel></Field>
            <FieldSet className="rounded-control border border-border p-3">
              <FieldLegend>本次记忆范围</FieldLegend>
              <FieldDescription>开启记忆读取后，项目偏好和指令会在使用已获授权的模型服务时自动应用到主助理和成员。</FieldDescription>
              <FieldDescription>开启个人画像读取后，个人偏好和指令仅由已获个人记忆授权的主助理默认使用。</FieldDescription>
              {([['user_global', '本次读取其他个人记忆'], ['workspace', '本次读取其他项目记忆']] as const).map(([kind, label]) =>
                <Field key={kind} orientation="horizontal"><Checkbox id={`${summaryDisclosureName}-${kind}`} disabled={busy || configurationLocked}
                  checked={draft.memoryScopes.some(scope => scope.kind === kind)}
                  onCheckedChange={checked => drafts.update(draftKey, { memoryScopes: checked === true
                    ? [...draft.memoryScopes, kind === 'user_global' ? personalScope : { kind, workspace_id: workspaceId, session_id: null }]
                    : draft.memoryScopes.filter(scope => scope.kind !== kind) })} />
                  <FieldLabel htmlFor={`${summaryDisclosureName}-${kind}`}>{label}</FieldLabel></Field>)}
              {memorySources.descriptions.map(description => <FieldDescription key={description}>{description}</FieldDescription>)}
              {memorySources.previews.length > 0 && <details><summary>本次排除单条记忆</summary>
                <FieldDescription>发送时按授权、来源和上下文容量核对可用记忆。</FieldDescription>
                {memorySources.previews.map(group => <section key={group.label} aria-label={group.label} className="my-2 flex flex-col items-start gap-2">
                  <FieldDescription>{group.label}</FieldDescription>
                  {group.records.map(record => <Field key={record.id} orientation="horizontal">
                    <Checkbox id={`${summaryDisclosureName}-${record.id}`} disabled={busy || configurationLocked} checked={draft.excludedSourceIds.includes(record.id)}
                      onCheckedChange={checked => drafts.update(draftKey, { excludedSourceIds: checked === true ? [...draft.excludedSourceIds, record.id]
                        : draft.excludedSourceIds.filter(id => id !== record.id) })} />
                    <FieldLabel htmlFor={`${summaryDisclosureName}-${record.id}`} className="wrap-anywhere">本次排除：{record.text}</FieldLabel></Field>)}
                  {group.loading && <FieldDescription>正在加载记忆…</FieldDescription>}
                  {group.error && <FieldDescription>载入失败：{group.error}</FieldDescription>}
                  {group.retry && <Button variant="outline" size="sm" onClick={() => void group.retry?.()}>重试读取{group.label}</Button>}
                  {group.more && <Button variant="outline" size="sm" disabled={group.loading} onClick={() => void group.more?.()}>加载更多{group.label}</Button>}
                </section>)}
              </details>}
              {draft.excludedSourceIds.length > 0 && <FieldDescription>本次明确排除 {draft.excludedSourceIds.length} 条记忆。</FieldDescription>}
              {memorySources.error && <p role="alert">{memorySources.error}</p>}
              <FieldDescription>切换模型将重新核对目的地；补充指令沿当前运行原范围。</FieldDescription>
              <Button variant="outline" size="sm" className="self-start" onClick={() => requestSettings('memory')}>记忆读取与授权设置</Button>
              <FieldDescription>可将本次记忆范围和 Skill 版本记为当前项目、当前模型地址的偏好；有效授权仍逐次复核。</FieldDescription>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={!connection} onClick={() => {
                  try { drafts.rememberPreference(draftKey, connection!.endpoint); } catch (error) { report(error); }
                }}>记住本项目的来源偏好</Button>
                <Button variant="outline" size="sm" disabled={!connection} onClick={() => {
                  try { drafts.forgetPreference(draftKey, connection!.endpoint); } catch (error) { report(error); }
                }}>清除本项目的来源偏好</Button>
              </div>
            </FieldSet>
            <details><summary>本次限额</summary>
              <FieldGroup className="mt-2 sm:grid sm:grid-cols-2">
              {([['max_model_requests', '模型请求上限'], ['max_steps', '步骤上限'], ['max_tasks', '任务上限'], ['max_total_tokens', '总 Token 上限'],
                ['deadline_seconds', '时限（秒）'], ['max_delegation_depth', '委派深度上限'], ['max_parallel_agents', '并行成员上限']] as const).map(([key, label]) =>
                <Field key={key}><FieldLabel htmlFor={`${summaryDisclosureName}-${key}`}>{label}</FieldLabel>
                  <Input id={`${summaryDisclosureName}-${key}`} type="number" min={key === 'deadline_seconds' ? '0.001' : '0'} step={key === 'deadline_seconds' ? 'any' : '1'} max={Number.MAX_SAFE_INTEGER}
                    placeholder="使用默认限制" value={draft.limits[key] ?? ''} onChange={event => drafts.update(draftKey, { limits: { ...draft.limits, [key]: event.target.value === '' ? undefined : event.target.valueAsNumber } })} /></Field>)}
              <Field><FieldLabel htmlFor={`${summaryDisclosureName}-cost`}>费用上限（记账单位）</FieldLabel>
                <Input id={`${summaryDisclosureName}-cost`} inputMode="numeric" pattern="(0|[1-9][0-9]*)"
                  placeholder="使用默认限制" value={draft.limits.max_cost_units ?? ''}
                  onChange={event => drafts.update(draftKey, { limits: { ...draft.limits, max_cost_units: event.target.value || undefined } })} /></Field>
              </FieldGroup>
            </details>
            <div className="flex flex-wrap gap-2">
            </div>
          </FieldSet>
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => requestSettings('models')}>模型设置</Button>
            <Button variant="outline" onClick={() => { setRunConfigurationOpen(false); openPanel('resources', runConfigurationTrigger.current!); }}>管理授权</Button></div>
        </FieldGroup></Dialog>}
    </div></div>
    </section>
    {docked && panel && <aside ref={detailsPane} className="conversation-details" aria-label={detailTitles[panel]}>
      <header className="panel-header"><h2 tabIndex={panel === 'context' ? -1 : undefined}>{detailTitles[panel]}</h2>
        {panel !== 'evidence' && <IconButton icon="close" label="关闭详情" onClick={closePanel} />}</header>
      <div className="conversation-details-body">{detailContent}</div>
    </aside>}
    <nav ref={detailsRail} className="conversation-detail-rail" aria-label="会话详情入口">{detailButtons(false)}</nav>
    </div>
    <Sheet open={!!panel && !docked} onOpenChange={open => { if (!open) closePanel(); }}>
      <SheetContent className="conversation-detail-sheet" onOpenAutoFocus={() => { panelOrigin.current ??= document.activeElement as HTMLElement; }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (backgroundFocus.current === 'sheet') {
            panelOrigin.current = null;
            focusBackgroundForm();
          } else restorePanelFocus(event.target as HTMLElement);
        }}
        onEscapeKeyDown={event => { if (event.isComposing || event.keyCode === 229) event.preventDefault(); }}>
        <header className="panel-header"><SheetTitle asChild><h2>{panel ? detailTitles[panel] : '会话详情'}</h2></SheetTitle>
          {panel === 'evidence' && onReturnToQuick && <IconButton icon="quick" label="返回快捷小窗" onClick={() => void perform(onReturnToQuick)} />}
          {panel !== 'evidence' && <IconButton icon="close" label="关闭详情" onClick={closePanel} />}</header>
        {panel !== 'resources' && panel !== 'evidence' && <nav className="conversation-sheet-tabs" aria-label="会话详情入口">{detailButtons(true)}</nav>}
        <div className="conversation-details-body">{detailContent}</div>
      </SheetContent>
    </Sheet>
    {management && <section className="task-management workbench-page ui-page-motion" hidden={!!memoryPage || panel === 'evidence'} inert={panel === 'evidence'} aria-label="任务管理页面">
      <header className="panel-header">
        <IconButton icon="back" size="icon-sm"
          label={backToTaskCenter ? '返回任务中心' : returnToInboxFromTask.current ? '返回待办' : '返回对话与草稿'}
          onClick={backToTaskCenter ? () => { taskCenterReturnPending.current = true; setManagement('center'); } : closeManagement} />
        {onReturnToQuick && <IconButton className="ml-auto" icon="quick" label="返回快捷小窗" onClick={() => void perform(onReturnToQuick)} />}
      </header>
      {commandStatus}
      <div ref={taskCenterContent} hidden={management !== 'center'}><TaskCenter key={centerTarget.sequence} client={client} workspaceId={centerTarget.workspaceId}
        workspaces={Object.values(projection.workspaces)} sessionNames={Object.fromEntries(Object.values(projection.sessions).map(session => [session.id, session.title]))}
        onOpen={id => { taskDetailOrigin.current = document.activeElement as HTMLElement; openTask(id); }}
         onOrganize={!compact ? openMemory : undefined} /></div>
      {management === 'detail' && <TaskDetail key={managedRunId} client={client} store={store} runId={managedRunId} onCommand={(command, key) => dispatchCommand(command, { key })} onQuestion={(runId, itemId) => void perform(() => openBackground(runId, itemId))} onOpen={openTask} onOpenConnection={openConnection} onOpenEvidence={openEvidence}
        onExport={chooseExport} exportBlocked={nativeSelecting || pendingCommands.some(command => command.type === 'exportArtifact' || command.type === 'grant' && !!commandContexts.current.get(command.commandId)?.afterConfirmed)} />}
    </section>}
    {assistantsOpen && <AssistantsPage client={client} refreshKey={profileRevision} skillsRevision={projection.skillsRevision}
      navigationGuard={pageGuard} onClose={closeSecondaryPage} onReturnToQuick={onReturnToQuick && (async () => { await onReturnToQuick(); closeSecondaryPage(); })} />}
    {memoryPage && <MemoryPage embedded client={client} store={store} initialSource={memoryPage.source}
      onClose={closeSecondaryPage}
      onOpenTask={task => { setMemoryPage(undefined); openTask(task.run_id); }}
      onSettings={scope => onSettings?.('memory', undefined, scope)} onReturnToQuick={onReturnToQuick} />}
    {knowledgePage && <section className="workbench-page ui-page-motion p-5 max-[760px]:px-4 max-[760px]:pt-14" aria-label="项目资料页面">
      <header className="panel-header">
        <IconButton icon="back" label="返回对话与草稿" onClick={closeSecondaryPage} />
        <span className="text-sm text-muted-foreground">{projection.workspaces[knowledgePage.workspaceId]?.name}</span>
        {onReturnToQuick && <IconButton className="ml-auto" icon="quick" label="返回快捷小窗" onClick={() => void perform(onReturnToQuick)} />}
      </header>
      <KnowledgePage client={client} workspaceId={knowledgePage.workspaceId} sourceId={knowledgePage.sourceId}
        refreshKey={projection.knowledgeNotices[knowledgePage.workspaceId]?.watermark}
        profileRefreshKey={projection.knowledgeNotices.global?.watermark} onConfigureModels={() => requestSettings('retrieval')}
        onOpenTask={task => { clearPages(); void perform(async () => { const target = await client.task(task.task_id); openTask(target.run_id); }); }} />
    </section>}
    {skillLibrary && <CapabilityLibrary compact={compact} embedded={!compact} navigationGuard={pageGuard} mcpTarget={skillLibrary.mcpTarget} mcpRevision={projection.mcpRevision}
      initialMcpScope={skillLibrary.mcpScope}
      onReturnToQuick={onReturnToQuick} client={client} workspaceId={skillLibrary.key.workspaceId || undefined} refreshKey={projection.skillsRevision}
      initialRecovery={skillLibrary.recovery} onClose={closeSkillLibrary}
       useInDraft={!skillLibrary.key.sessionId}
       onUse={skillLibrary.key.sessionId || skillLibrary.mcpScope?.kind === 'workspace' ? async (version, permissionId) => {
        const originalKey = { ...skillLibrary.key };
        const selected = await client.resolveSkills({ scope: { kind: 'workspace', workspace_id: originalKey.workspaceId, session_id: null },
          versions: { [version.skill_id]: version.content_hash } });
         const currentProjection = store.getSnapshot();
         if ((originalKey.sessionId && !currentProjection.sessions[originalKey.sessionId])
           || scopeDeleted(currentProjection, { workspace_id: originalKey.workspaceId, session_id: originalKey.sessionId || null })) {
           throw new Error('原项目或会话已不可用，未修改其他草稿');
        }
        setSkillLabels(current => ({ ...current, ...Object.fromEntries(selected.entries.map(item => [
          `${item.skill_id}:${item.content_hash}`, {
            name: item.name, release: item.skill_id === version.skill_id && item.content_hash === version.content_hash
              ? version.metadata.version : undefined,
          },
        ])) }));
        const current = drafts.read(originalKey);
        const skillExecutionPermissions = { ...current.skillExecutionPermissions };
        if (version.files.some(file => file.path.startsWith('scripts/'))) {
          skillExecutionPermissions[version.skill_id] = permissionId ?? null;
        } else {
          delete skillExecutionPermissions[version.skill_id];
        }
        drafts.update(originalKey, { skillVersions: { ...current.skillVersions, ...selected.versions },
          skillExecutionPermissions });
        closeSkillLibrary();
      } : undefined} />}
    {newSessionWorkspace !== undefined && <Dialog title="新建会话" onReturnFocus={() => sessionReturnFocus.current?.()} onClose={() => { if (!busy) closeNewSession(); }}><form onSubmit={event => { event.preventDefault(); void perform(async () => {
      const origin = view.current;
      const session = await client.createSession(newSessionWorkspace, { meta: commandMeta(), data: { title: sessionTitle.trim() || null } });
      const next = setProjection(state => mergeSessions(state, [session]));
      if (next.sessions[session.id]) {
        if (view.current.workspaceId !== session.workspace_id) chooseWorkspace(session.workspace_id);
        if (!origin.sessionId && origin.workspaceId === session.workspace_id) {
          drafts.move(origin, { workspaceId: session.workspace_id, sessionId: session.id });
        }
        chooseSession(session.id); navigationTarget.current = { session }; setWorkspaceGeneration(value => value + 1);
      }
      sessionReturnFocus.current = () => document.getElementById('message-input')?.focus();
      closeNewSession();
    }); }}><Field><FieldLabel htmlFor={`${summaryDisclosureName}-new-session`}>新会话标题</FieldLabel>
      <Input id={`${summaryDisclosureName}-new-session`} autoFocus maxLength={256} placeholder="留空时按目标命名" value={sessionTitle} onChange={event => setSessionTitle(event.target.value)} /></Field>
      {error && <p role="alert">{error}</p>}<div className="button-row"><Button type="button" variant="outline" disabled={busy} onClick={closeNewSession}>取消</Button><Button type="submit" variant="default" disabled={busy || !newSessionWorkspace}>创建会话</Button></div>
    </form></Dialog>}
    {renameTarget && <ScopeNameDialog client={client} target={renameTarget.target} suggest={renameTarget.suggest}
      onClose={() => setRenameTarget(undefined)}
      onReturnFocus={() => { if (renameTarget.origin.isConnected) renameTarget.origin.focus(); else navTrigger.current?.focus(); }}
      onRenamed={target => {
        setProjection(state => 'title' in target ? mergeSessions(state, [target]) : mergeWorkspaces(state, [target]));
        setRenameTarget(undefined);
      }} />}
    {directoryTarget && <Dialog title={`项目目录 · ${directoryTarget.workspace.name}`} onClose={() => setDirectoryTarget(undefined)}
      onReturnFocus={() => directoryTarget.origin.focus()}>
      <ProjectDirectory client={client} workspace={projection.workspaces[directoryTarget.workspace.id] ?? directoryTarget.workspace}
        blocked={pendingCommands.some(command => command.type === 'setWorkspaceDirectory' && commandContexts.current.get(command.commandId)?.targetId === directoryTarget.workspace.id)}
        onLink={(resource_id, version) => dispatchCommand({ type: 'setWorkspaceDirectory', args: [directoryTarget.workspace.id, { meta: commandMeta(version), data: { resource_id } }] },
          { key: { workspaceId: directoryTarget.workspace.id, sessionId: '' } })} />
    </Dialog>}
    {activeApproval && !activePage && !obscured && <Dialog title="审批本次操作" onClose={() => {
      if (busy) return;
      setApprovalId(undefined);
      if (backgroundReturn.current) returnFromBackground();
    }}>
      <ApprovalCard approval={activeApproval} busy={busy || unconfirmed('decide', activeApproval.id)} onDecision={allow => {
        const returnTarget = backgroundReturn.current;
        return perform(() => dispatchCommand({ type: 'decide', args: [activeApproval.id, { meta: commandMeta(activeApproval.version), data: { allow } }] }, {
          key: { workspaceId: activeApproval.workspace_id, sessionId: activeApproval.session_id ?? '' },
          afterConfirmed: async () => {
            setApprovalId(undefined);
            if (returnTarget && backgroundReturn.current === returnTarget) returnFromBackground();
          },
        }));
      }} />
    </Dialog>}
    {confirmation && <Dialog title="确认隐私删除" onClose={() => { if (!busy) setConfirmation(undefined); }} onReturnFocus={() => {
      const origin = confirmationOrigin.current;
      if (origin?.isConnected) origin.focus();
      else (navTrigger.current?.offsetParent ? navTrigger.current : document.getElementById('message-input'))?.focus();
    }}>
      <p>删除“{confirmation.name}”中的本地内容、产物引用和运行记录。逻辑删除立即生效；被占用文件的清理会在后续回收时重试。未完成的导出恢复必须先处理；不会删除外部目标或备份。</p>
      <div className="button-row"><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmation(undefined)}>取消</Button><Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>确认删除</Button></div>
    </Dialog>}
  </main>;
}
