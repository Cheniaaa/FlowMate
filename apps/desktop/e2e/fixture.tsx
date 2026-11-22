import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import App from '../src/App';
import { agent, binding, connection, contextUsage, event, grant, id, limits, model, modelDiscovery, modelResolution, page, resource, resultEntry, run, runDetailSummary, secondId } from '../src/test/fixtures';
import { mcpView } from '../src/test/mcp-fixtures';
import { memory, memoryGrant, memoryPolicy } from '../src/test/memory-fixtures';
import { skillHash, skillReceipt, skillView } from '../src/test/skill-fixtures';
import { evidence as knowledgeEvidence, evidenceId as knowledgeEvidenceId, source as knowledgeSource,
  job as knowledgeJob } from '../src/features/knowledge/knowledge-fixtures';
import { embeddingProfile as defaultEmbeddingProfile, projectKnowledge } from '../src/features/knowledge/embedding-fixtures';
import type { EmbeddingProfile, EmbeddingProfileView, KnowledgeImportReceipt, KnowledgeJob as KnowledgeJobRecord, KnowledgeSettings, KnowledgeSource, KnowledgeSourceView } from '../src/generated/contracts';
import type { ActivityView, AgentResult, Approval, ArtifactRef, DataUseGrant, MemberLane, ModelConnection, ModelMessage, ModelProfile, ModelResolution, ProviderPresetList, PublicEvent, Question, RunDetail, RunSnapshot, Session, SessionContext, SessionContextSchema, SessionContextUsage, SessionInboxEntry, SessionRunPage, StopAllReceipt, TaskResult, Workspace } from '../src/generated/contracts';
import type { PendingCounts } from '../src/api/windows';
import type { WorkbenchRequest } from '../src/api/windows';

type AgentRunSnapshot = RunSnapshot & { config: typeof run.config };

// 仅由验收页面载入。所有业务调用留在内存，未定义的路由立即失败。
let sequence = 100;
const uuid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
const workspaces: Workspace[] = [{ id, name: '合成验收项目', version: 1, directory_resource_id: null }];
const firstRun = new URLSearchParams(location.search).get('firstRun');
const noModel = firstRun === 'clean' || firstRun === 'no-model';
const modelPickerScenario = new URLSearchParams(location.search).has('model-picker');
const pickerConnections: ModelConnection[] = [
  { ...connection, id: '00000000-0000-4000-8000-000000000051', display_name: '研发直连',
    endpoint: 'https://direct.example.invalid/v1', protocol: 'openai_responses', provider_preset_id: 'openai' },
  { ...connection, id: '00000000-0000-4000-8000-000000000052', display_name: '团队网关',
    endpoint: 'https://gateway.example.invalid/v1' },
  { ...connection, id: '00000000-0000-4000-8000-000000000053', display_name: '研究连接',
    endpoint: 'https://research.example.invalid', protocol: 'anthropic', provider_preset_id: 'anthropic' },
];
const pickerPresets: ProviderPresetList = [
  { id: 'openai', display_name: 'OpenAI', protocol: 'openai_responses', default_endpoint: pickerConnections[0].endpoint,
    auth_mode: 'api_key', source_url: 'https://direct.example.invalid/docs', source_version: 'synthetic', verified_at: '2026-11-21' },
  { id: 'anthropic', display_name: 'Anthropic', protocol: 'anthropic', default_endpoint: pickerConnections[2].endpoint,
    auth_mode: 'api_key', source_url: 'https://research.example.invalid/docs', source_version: 'synthetic', verified_at: '2026-11-21' },
];
const pickerModels: ModelProfile[] = [
  { ...model, id: '00000000-0000-4000-8000-000000000054', connection_id: pickerConnections[0].id,
    display_name: 'GPT 合成推理', model_id: 'synthetic-gpt-direct' },
  { ...model, id: '00000000-0000-4000-8000-000000000055', connection_id: pickerConnections[1].id,
    display_name: 'GPT 合成推理', model_id: 'synthetic-gpt-gateway' },
  { ...model, id: '00000000-0000-4000-8000-000000000056', connection_id: pickerConnections[2].id,
    display_name: 'Claude 合成助手', model_id: 'synthetic-claude-research' },
];
function resolvePickerModel(item: ModelProfile): ModelResolution {
  const transport = pickerConnections.find(connection => connection.id === item.connection_id)!;
  const reasoning = item.id === pickerModels[0].id;
  return { ...modelResolution, ...item, connection_version: transport.version,
    protocol: transport.protocol, endpoint: transport.endpoint, secret_ref: transport.secret_ref,
    provider_preset_id: transport.provider_preset_id,
    capabilities: { ...item.capabilities, thinking: reasoning, reasoning_efforts: reasoning ? ['low', 'medium', 'high'] : null } };
}
const fixtureSession: Session = { id, workspace_id: id, title: '合成会话', version: 1, agent_profile_id: id, kind: 'interaction', archived: false };
const sessions: Session[] = firstRun === 'clean' || firstRun === 'no-session' ? []
  : [fixtureSession, { ...fixtureSession, id: secondId, title: '合成对照会话' }];
let firstSessionReceipt: { commandId: string; session: Session } | undefined;
let cancelFirstFileSelection = firstRun === 'no-session';
const messages: ModelMessage[] = [];
let current: AgentRunSnapshot | undefined;
const runs = new Map<string, AgentRunSnapshot>();
const chatModelDispatches: { workspaceId: string; use: NonNullable<SessionRunPage['last_model_use']> }[] = [];
const reports = new Map<string, { runId: string; artifact: ArtifactRef; text: string }>();
const activities = new Map<string, ActivityView>();
const coldDeliveryRuns = new Set<string>();
const deliveries = new Map<string, SessionInboxEntry>();
const taskResults = new Map<string, TaskResult>();
const grants: DataUseGrant[] = [];
let navigation: WorkbenchRequest | null = null;
let watermark = BigInt(event.event_id);
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
const requests: { path: string; method: string; body: unknown; query: Record<string, string> }[] = [];
const nativeRequests: { command: string; args: unknown }[] = [];
const unexpectedRequests: string[] = [];
let notes = mcpView;
const profile = { ...agent, display_name: '日常助理',
  default_model_profile_id: noModel ? null : modelPickerScenario ? pickerModels[0].id : model.id };
const exportName = '已有的发布说明.zip';
const existingExportHash = 'c'.repeat(64);
const evidencePages = ['以后使用中文回答。', '遇到专业术语请保留英文原名。'];
let evidenceAvailable = true;
let evidenceReadFails = false;
let exportReceipt: typeof skillReceipt | undefined;
const task2Scenario = new URLSearchParams(location.search).get('task2');
const task5Inbox = new URLSearchParams(location.search).get('task5') === 'inbox';
const sentFileScenario = new URLSearchParams(location.search).has('sent-file');
const fileDecision = new URLSearchParams(location.search).get('file-decision');
const selectedFiles = new Map<string, typeof resource>();
const fileChoices = ['未发送.txt', 'tmp.txt', '读书会纪要.txt'].values();
const questions = new Map<string, Question>();
const approvals = new Map<string, Approval>();
const stopReceipts = new Map<string, { path: string; version: number; receipt: StopAllReceipt }>();
const generations = new Map<string, number>();
const readingScenario = new URLSearchParams(location.search).get('reading');
const knowledgeScenario = new URLSearchParams(location.search).get('knowledge');
let knowledgeMember: MemberLane | undefined;
const retrievalScenario = new URLSearchParams(location.search).has('retrieval');
const retrievalConnection = { ...connection, id: uuid(), display_name: '硅基流动', endpoint: 'https://api.siliconflow.cn/v1' };
const retrievalProfiles = new Map<string, EmbeddingProfile>();
const retrievalViews = new Map<string, EmbeddingProfileView>();
const retrievalReceipts = new Map<string, KnowledgeSettings>();
let retrievalSettings = projectKnowledge;
if (retrievalScenario) {
  const profile: EmbeddingProfile = { ...defaultEmbeddingProfile, display_name: '硅基流动资料检索',
    model_id: 'Qwen/Qwen3-Embedding-4B', dimensions: 1024, request_dimensions: true, connection_id: retrievalConnection.id };
  retrievalProfiles.set(profile.id, profile);
  retrievalViews.set(`${profile.id}:${profile.revision}`, { profile,
    destination: 'https://api.siliconflow.cn/v1/embeddings', local_runtime_available: null });
}
const knowledgeReceipts = new Map<string, KnowledgeImportReceipt>();
const knowledgeActionReceipts = new Map<string, { fingerprint: string; source: KnowledgeSource }>();
const knowledgeSources: KnowledgeSource[] = [{ ...knowledgeSource, active_version: 2 }, { ...knowledgeSource, id: uuid(), label: '会议记录.txt', active_version: 2 },
  { ...knowledgeSource, id: uuid(), label: '研究方案.md', active_version: null, status: 'pending' as const }];
const knowledgeJobs: KnowledgeJobRecord[] = [
  { ...knowledgeJob, source_id: knowledgeSources[1].id, source_version: 3, status: 'running' as const },
  { ...knowledgeJob, id: uuid(), source_id: knowledgeSources[2].id, source_version: 1, status: 'queued' as const },
];
if (knowledgeScenario === 'duplicates') knowledgeSources[1].label = knowledgeSources[0].label;
if (knowledgeScenario === 'failed') knowledgeJobs.push({ ...knowledgeJob, id: uuid(),
  status: 'failed', task: null, reason: 'knowledge_encoding_unsupported' });
if (knowledgeScenario === 'grants') {
  const scope = { kind: 'workspace' as const, workspace_id: id, session_id: null };
  const destination = 'https://api.siliconflow.cn/v1/embeddings';
  grants.push(
    { ...grant, id: uuid(), scope, resource_ids: [], knowledge_source_ids: [knowledgeSources[0].id],
      purposes: ['embedding_send'], destination },
    { ...grant, id: uuid(), scope, resource_ids: [], knowledge_scopes: [scope],
      purposes: ['embedding_send'], destination },
  );
}
const knowledgeText = [
  '第 18 行：保留当前可用版本，更新完成后再发布新版。\n第 19 行：历史答复始终指向当时引用的原文。\n第 20 行：项目之间的资料保持隔离。',
  '第二段：项目内的对话共享已加入资料，历史引用始终指向原版本。',
];
const knowledgeFirstLength = Array.from(knowledgeText[0]).length;
function knowledgeNotice(source: KnowledgeSource) {
  const eventId = String(++watermark);
  const wire = { kind: 'durable', event_id: eventId, event: { ...event, event_id: eventId, kind: 'knowledge.changed',
    workspace_id: id, session_id: null, run_id: null, seq: null, payload: { workspace_id: id,
      source_revisions: { [source.id]: source.revision }, job_revisions: {}, settings_revision: null, profile_revisions: {} } } };
  for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`));
}
const contextFiles = new Map<string, SessionContextSchema.ContextFile[]>();
const contextActivities = new Map<string, SessionContextSchema.ContextActivity[]>();
const fileName = '读书会纪要.txt';
const contextHistory = { ...contextUsage, state: 'succeeded', omitted_group_count: 1,
  omitted_message_count: 4, reason_counts: { outside_run_scope: 4 } } as const;
let historyNoticeRunId: string | undefined;
const queryRecovery = new URLSearchParams(location.search).has('query-recovery');
const readingImageId = '00000000-0000-4000-8000-000000000079';
const readingMediaOperation = 'mcp.AAAAAAAAQACAAAAAAAAAeA.cLzPU1bJQmHXbPPGWyskNEaTutbuLrmD';
const readingMediaTool = {
  server_id: '00000000-0000-4000-8000-000000000078',
  original_name: 'get_equipment_photo',
  config_revision: 1,
  catalog_hash: 'b'.repeat(64),
  destination: 'mcp:00000000-0000-4000-8000-000000000078:1:stdio',
};
function contextRequest(input_tokens: number, output_tokens: number, cached_input_tokens: number | null,
  input_limit: number | null, calculated_units: string | null): SessionContextSchema.ContextActivity {
  return { id: uuid(), kind: 'model', state: 'succeeded', model: model.model_id, compaction: false,
    input_tokens, output_tokens, cached_input_tokens, input_limit, calculated_units, files: [], hidden_file_count: 0, file_changed: false };
}
let readingImage: { runId: string; artifact: ArtifactRef } | undefined;
let readingActivity: ActivityView;
if (readingScenario !== null) {
  const hierarchy = readingScenario === 'hierarchy';
  const historyNotice = readingScenario === 'context-current';
  const meetingBrief = [
    '# 阅读会准备简报',
    '**时间与地点：** 周四 10:00，302 会议室。请预留前五分钟测试投影。',
    '## 会前准备',
    '- **林宁：** 周三发出议程与上次纪要。\n- **陈晨：** 到场后确认白板和投影。\n  - 远程成员用日历邀请里的链接。',
    '### 现场顺序',
    '1. 确认分工。\n2. 记录需要在下次复核的事项。',
    '> 如临时更换会场，以日历邀请为准。',
    '| 设备 | 使用前检查 |\n| --- | --- |\n| 投影 | 屏幕共享 |\n| 白板 | 笔和板擦 |',
    '```toml\n[meeting]\n    room = "302"\n    remote_attendees = ["上海项目组", "北京项目组", "成都项目组", "深圳项目组", "武汉项目组", "西安项目组", "厦门项目组", "苏州项目组", "杭州项目组", "青岛项目组", "重庆项目组", "南京项目组"]\n```',
  ].join('\n\n');
  const exchanges = historyNotice ? [
    ['请核对会议开始时间。', '会议在上午十点开始。'],
    ['能读出前两行吗？', '前两行是「周四上午十点」和「302 会议室」。'],
  ] : hierarchy ? [['请汇总阅读会安排，并核对场地预约。', meetingBrief]] : [
    ['会议几点开始？', '会议在上午十点开始。'],
    ['需要带什么？', '带上议程和上次的会议纪要。'],
    ['有远程链接吗？', '有，链接已附在日历邀请里。\n\n提前五分钟进入即可。'],
    ['谁负责记录？', '林宁负责记下决定和后续事项。'],
    ['能核对房间和白板吗？', '会议室是 302，白板和投影都可以使用。'],
    ['请列出两个准备事项。', '| 事项 | 负责人 |\n| --- | --- |\n| 发议程 | 林宁 |\n| 测试投影 | 陈晨 |'],
  ];
  const visibleFile = { name: fileName, origin: null, changed: false, size_bytes: null, line_count: null,
    start: null, end: null, total_chars: null };
  const sourceVersion = 'a'.repeat(64);
  const fileGrant = historyNotice ? { ...grant, scope: { kind: 'session', workspace_id: id, session_id: id } } satisfies DataUseGrant : undefined;
  if (fileGrant) grants.push(fileGrant);
  for (const [index, [question, answer]] of exchanges.entries()) {
    const withMedia = readingScenario === 'media' && index === 4;
    const value: AgentRunSnapshot = { ...run, id: uuid(), root_task_id: uuid(), budget_id: uuid(),
      state: 'completed', config: { ...run.config, agent_profile: profile, catalog: withMedia ? {
        ...run.config.catalog,
        tools: { ...run.config.catalog.tools, [readingMediaOperation]: `${readingMediaTool.config_revision}:${readingMediaTool.catalog_hash}` },
        mcp_tools: { ...run.config.catalog.mcp_tools, [readingMediaOperation]: readingMediaTool },
      } : run.config.catalog },
      output: { summary: answer, artifact_ids: [], unresolved: [], handled_failures: [] } };
    runs.set(value.id, value);
    if (historyNotice) {
      const newlySelected = index === 0;
      if (!newlySelected) historyNoticeRunId = value.id;
      value.attached_file_ids = newlySelected ? [resource.id] : [];
      value.sources = { ...value.sources, resource_ids: [resource.id] };
      value.file_inputs = { [resource.id]: { file_identity: 'b'.repeat(64), source_version: sourceVersion,
        ...(newlySelected ? {} : { inheritance_grants: [{ scope_id: fileGrant!.id, epoch: fileGrant!.epoch }] }) } };
      contextFiles.set(value.id, [{ ...visibleFile, origin: newlySelected ? 'attached' : 'inherited' }]);
      const read: SessionContextSchema.ContextActivity = { id: uuid(), kind: 'read', state: 'succeeded',
        model: null, compaction: false, input_tokens: null, output_tokens: null, cached_input_tokens: null,
        input_limit: null, calculated_units: null, hidden_file_count: 0, file_changed: false,
        files: [{ ...visibleFile, start: 0, end: newlySelected ? 716 : '周四上午十点\n302 会议室\n'.length, total_chars: 716 }],
      };
      contextActivities.set(value.id, newlySelected
        ? [
          contextRequest(12400, 298, null, null, '7150000'),
          { ...read, id: uuid(), kind: 'inspect', files: [{ ...visibleFile, size_bytes: 1872, line_count: 28 }] },
          read,
          contextRequest(12400, 298, null, 96000, '7150000'),
          contextRequest(12400, 298, null, 96000, '7150000'),
        ]
        : [
          contextRequest(12400, 620, 9728, 96000, '20000000'),
          read,
          contextRequest(11690, 610, null, null, '18000000'),
          contextRequest(12400, 590, 0, 96000, '17000000'),
          contextRequest(10900, 570, null, 96000, '16765000'),
          contextRequest(11620, 526, 9728, 96000, null),
        ]);
    }
    const appendMessage = (role: ModelMessage['role'], parts: ModelMessage['parts'], activity_id: string | null = null) => {
      const message: ModelMessage = { id: uuid(), run_id: value.id, event_id: String(++watermark), event_index: 0,
        activity_id, role, origin: 'conversation', parts, private_ref: null, source_dependencies: [] };
      messages.push(message);
      return message.id;
    };
    appendMessage('user', [{ kind: 'text', text: question }]);
    if (fileGrant && index === 0) messages.at(-1)!.attachments = [{
      resource_id: resource.id, name: fileName, resource_lineage: [resource.id], read_grant_ids: [fileGrant.id],
    }];
    if (hierarchy || index === 4) {
      appendMessage('assistant', [{ kind: 'reasoning', text: '先核对会议信息，再检查设备。' }]);
      for (const [call_id, name, text] of [['room', 'files.list', '预订：302。'],
        ['equipment', withMedia ? readingMediaOperation : 'files.read_text', '设备清单：白板、投影。']]) {
        const origin_message_id = appendMessage('assistant', [{ kind: 'tool_call', call_id, name, arguments: {} }]);
        if (name === readingMediaOperation) {
          const activity_id = uuid();
          const dependencies = [{ scope_id: readingMediaTool.server_id, epoch: readingMediaTool.config_revision },
            { scope_id: activity_id, epoch: 1 }];
          const artifact: ArtifactRef = { id: readingImageId, version: 1, content_hash: 'b'.repeat(64),
            task_id: value.root_task_id, activity_id, dependencies, media_type: 'image/png' };
          readingImage = { runId: value.id, artifact };
          activities.set(activity_id, { id: activity_id, run_id: value.id, task_id: value.root_task_id,
            version: 1, state: 'succeeded', kind: 'tool', operation: name, dependencies,
            usage: null, error: null, actual_units: null, script_execution: null });
          const { server_id, original_name, config_revision, catalog_hash, destination } = readingMediaTool;
          const caption = '白板和投影均已就位。';
          appendMessage('tool', [{ kind: 'tool_result', origin_message_id, call_id, error: null, result: {
            server_id, tool_name: original_name, config_revision, catalog_hash, destination, call_id,
            structured_content: null, is_error: false, external_cost_status: 'unknown', texts: [text, caption],
            content: [{ type: 'text', text }, { type: 'image', media_type: 'image/png', width: 240, height: 100, artifact },
              { type: 'text', text: caption }],
          } }], activity_id);
          continue;
        }
        const result = name === 'files.read_text'
          ? { text, start: 0, end: text.length, total_chars: text.length, source_version: 'reading-equipment-v1' }
          : { items: [resource], next_cursor: null };
        appendMessage('tool', [{ kind: 'tool_result', origin_message_id, call_id, result, error: null }]);
      }
    }
    appendMessage('assistant', [{ kind: 'text', text: answer }]);
    if (hierarchy) {
      const summary = '已核对 302 的预约：周四 09:45–11:30，含白板和投影。';
      const { entry } = managedDelivery(value, '核对场地预约', '资料整理员', summary, '# 场地预约\n\n' + summary);
      messages.push({ id: uuid(), run_id: value.id, event_id: String(++watermark), event_index: 0,
        activity_id: null, role: 'assistant', origin: 'background_report', parts: [{ kind: 'text', text: summary }],
        delivery_ids: [entry.id], source_dependencies: [], private_ref: null });
    }
  }
}
if (queryRecovery) {
  const operation = 'mcp.synthetic.resolve';
  const remote = { server_id: notes.config.id, config_revision: 1, catalog_hash: 'a'.repeat(64),
    original_name: 'resolve-library-id', destination: 'mcp:synthetic' };
  const value: AgentRunSnapshot = { ...run, id: uuid(), root_task_id: uuid(), budget_id: uuid(), version: 4,
    state: 'interrupted', reason: 'mcp_query_uncertain', config: { ...run.config, agent_profile: profile,
      catalog: { ...run.config.catalog, tools: { [operation]: '1:catalog' }, mcp_tools: { [operation]: remote } } } };
  const activity: ActivityView = { id: uuid(), version: 3, run_id: value.id, task_id: value.root_task_id,
    state: 'uncertain', kind: 'tool', operation, error: 'mcp_call_uncertain', usage: null, dependencies: [],
    actual_units: '0', script_execution: null };
  runs.set(value.id, value);
  activities.set(activity.id, activity);
  for (const part of [
    { kind: 'text', text: '请整理已有资料，并核对组件文档。' },
    { kind: 'tool_call', call_id: 'query', name: operation, arguments: { library: '组件库' } },
  ] as const) {
    messages.push({ id: uuid(), run_id: value.id, activity_id: null, event_id: String(++watermark), event_index: 0,
      role: part.kind === 'text' ? 'user' : 'assistant', origin: 'conversation', parts: [part],
      private_ref: null, source_dependencies: [] });
  }
}
if (task2Scenario === 'stop') {
  const otherWorkspace = { ...workspaces[0], id: uuid(), name: '异项目' };
  workspaces.push(otherWorkspace);
  sessions.push({ ...sessions[0], workspace_id: otherWorkspace.id, id: uuid(), title: '异项目会话' });
  for (const [index, session] of sessions.entries()) {
    const value = { ...run, id: uuid(), root_task_id: uuid(), budget_id: uuid(), workspace_id: session.workspace_id,
      interaction_session_id: session.id, execution_session_id: session.id, config: { ...run.config, agent_profile: profile } };
    runs.set(value.id, value);
    generations.set(`/sessions/${session.id}`, 7 + index);
    messages.push({ id: uuid(), run_id: value.id, activity_id: null, event_id: String(++watermark), event_index: 0,
      role: 'user', origin: 'conversation', parts: [{ kind: 'text', text: `${session.title}的任务` }],
      private_ref: null, source_dependencies: [] });
  }
  for (const [index, workspace] of workspaces.entries()) generations.set(`/workspaces/${workspace.id}`, 12 + index);
}
if (task2Scenario === 'interaction') {
  // 两个成员分别等待回答与审批。用同一个后台 Run 验证两个入口选中不同对象。
  const value: AgentRunSnapshot = { ...run, id: uuid(), root_task_id: uuid(), budget_id: uuid(), execution_session_id: uuid(),
    kind: 'managed', state: 'waiting_children', config: { ...run.config, agent_profile: { ...profile, display_name: '资料整理员' } } };
  runs.set(value.id, value);
  const choice = new URLSearchParams(location.search).get('question-choice');
  const days = ['周四', '周五'];
  const question: Question = { id: uuid(), version: 5, run_id: value.id, task_id: uuid(), call_id: 'question', message_id: uuid(),
    question: '这份会议纪要需要覆盖哪一天？', answer_schema: choice === 'radio' ? { type: 'string', enum: days }
      : choice === 'checkbox' ? { type: 'array', items: { type: 'string', enum: days }, minItems: 1 }
      : { type: 'string', minLength: 1 }, status: 'pending', answer_message_id: null, dependencies: [] };
  questions.set(question.id, question);
  const approval: Approval = { id: uuid(), version: 8, workspace_id: id, session_id: id, run_id: value.id, task_id: uuid(),
    activity_id: uuid(), call_id: 'approve', tool_name: 'artifacts.export', tool_version: '1', args_hash: 'a'.repeat(64),
    target: '会议纪要.md', parameters: {}, dependencies: [], expires_at: '2026-11-22T12:00:00Z',
    status: 'pending', mcp: null, export_preview: task5Inbox ? {
      artifact_id: uuid(), artifact_version: 1, target_exists: true, target_path: '会议纪要.md',
    } : null };
  approvals.set(approval.id, approval);
}
const detail = (value: AgentRunSnapshot): RunDetail => ({ ...runDetailSummary, run: value, tasks: page([{ id: value.root_task_id, run_id: value.id, version: 1,
  binding: { ...binding, config: value.config, execution_session_id: value.execution_session_id, interaction_session_id: value.interaction_session_id }, parent_task_id: null, origin_task_id: null, kind: 'agent', executor_id: 'builtin.agent',
  state: value.state, created_seq: 1, deadline_at: null, result_version: taskResults.get(value.root_task_id)?.result_version ?? null, reason: null }]),
  activities: page(coldDeliveryRuns.has(value.id) ? [] : [...activities.values()].filter(activity => activity.run_id === value.id)),
  messages: page(messages.filter(message => message.run_id === value.id)),
  artifacts: page([
    ...[...reports.values()].filter(report => report.runId === value.id).map(report => report.artifact),
    ...(readingImage?.runId === value.id ? [readingImage.artifact] : []),
  ]),
  questions: page([...questions.values()].filter(item => item.run_id === value.id)),
  approvals: page([...approvals.values()].filter(item => item.run_id === value.id)), waits: page([]), consumptions: page([]), joins: page([]),
  budget: { id: value.budget_id, run_id: value.id, version: 1, limits, spent_units: '0', reserved_units: '0', model_requests: 0, steps: 0,
    task_count: 1, total_tokens: 0, reserved_tokens: 0 }, watermark: String(watermark) });

if (knowledgeScenario) {
  current = { ...run, id: uuid(), root_task_id: uuid(), budget_id: uuid(), state: 'completed',
    config: { ...run.config, agent_profile: profile },
    output: { summary: '两个方案都支持项目内共享；更新完成前，继续使用当前可用版本 [1]。\n\n引用保留答复所用的历史原文，可逐段核对。\n\n`[1]` 是代码示例，不打开资料。',
      artifact_ids: [], handled_failures: [], unresolved: [], citations: [{ marker: 1, evidence_id: knowledgeEvidenceId }] } };
  runs.set(current.id, current);
  contextActivities.set(current.id, [...(retrievalScenario ? [{
    id: uuid(), kind: 'embedding', embedding_kind: 'query', model: '硅基流动资料检索',
    input_tokens: 128, output_tokens: null, cached_input_tokens: null, input_limit: null,
    calculated_units: null, files: [], hidden_file_count: 0, file_changed: false, compaction: false, state: 'succeeded',
  } satisfies SessionContextSchema.ContextActivity] : []), contextRequest(1850, 120, null, 16000, null)]);
  if (knowledgeScenario === 'tools') {
    const call: ModelMessage = { id: uuid(), run_id: current.id, event_id: String(++watermark), event_index: 0,
      activity_id: null, role: 'assistant', origin: 'conversation', private_ref: null, source_dependencies: [],
      parts: [{ kind: 'tool_call', call_id: 'project-search', name: 'knowledge.search',
        arguments: { query: '项目资料如何共享和更新？', mode: 'hybrid', source_ids: [knowledgeSource.id] } }] };
    messages.push(call, { ...call, id: uuid(), event_id: String(++watermark), role: 'tool', parts: [{
      kind: 'tool_result', call_id: 'project-search', origin_message_id: call.id, error: null,
      result: { status: 'partial', mode: 'bm25', error: 'knowledge_embedding_failed', notices: [],
        sources: [knowledgeSources[0]], evidence: [{ ...knowledgeEvidence.evidence, excerpt: knowledgeText[0] }] },
    }] });
  }
  if (knowledgeScenario === 'member') {
    current.kind = 'managed'; current.execution_session_id = uuid();
    const task = detail(current).tasks.items[0];
    knowledgeMember = { profile: { ...profile, display_name: '资料核对员' }, activities: [], handoffs: [],
      task: { ...task, result_version: 1, binding: { ...task.binding, agent_work: {
        kind: 'agent', profile_id: profile.id, goal: '核对项目共享与更新规则',
        input_refs: [], output_schema: {}, success_criteria: [],
      } } } };
    taskResults.set(task.id, { handle: { run_id: current.id, task_id: task.id, lifetime: 'managed', submitted_state: 'completed' },
      result_version: 1, state: 'completed', artifacts: [], dependencies: [], error: null,
      result: { summary: '更新完成前继续使用当前资料 [1]。', status: 'completed',
        citations: [{ marker: 1, evidence_id: knowledgeEvidenceId }], evidence_refs: [], artifact_ids: [],
        structured_result: null, verification: [], unresolved: [], handled_failures: [] } });
  }
}
const knowledgeWindows = knowledgeScenario ? new BroadcastChannel(`flowmate-fixture-knowledge-${knowledgeScenario}`) : undefined;
knowledgeWindows?.addEventListener('message', async ({ data }) => {
  const isQuick = new URLSearchParams(location.search).get('window') === 'quick';
  if (data.kind === 'workbench' && !isQuick) {
    navigation = { target: data.target, from_quick: true };
    await emit('workbench-navigation', null);
  } else if (data.kind === 'return' && isQuick) document.querySelector<HTMLElement>('[data-quick-origin]')?.focus();
});
mockIPC(async (command, args) => {
  nativeRequests.push({ command, args });
  const payload = args as Record<string, unknown> | undefined;
  if (command === 'runtime_connection') return { base_url: 'http://synthetic.invalid', token: 'synthetic-token', protocol_version: 4 };
  if (command === 'take_settings_navigation') return null;
  if (command === 'take_workbench_navigation') { const target = navigation; navigation = null; return target; }
  if (new URLSearchParams(location.search).has('project-name')) {
    if (command === 'select_workspace_directory') return '桌面助理开发';
    if (command === 'discard_workspace_directory_selection') return;
  }
  if (command === 'show_workbench') {
    if (knowledgeWindows && new URLSearchParams(location.search).get('window') === 'quick') {
      document.activeElement?.setAttribute('data-quick-origin', '');
      knowledgeWindows.postMessage({ kind: 'workbench', target: payload?.target });
      return;
    }
    await (window as Window & { acknowledgeWorkbench?: () => Promise<void> }).acknowledgeWorkbench?.();
    navigation = { target: payload?.target as WorkbenchRequest['target'], from_quick: false };
    return emit('workbench-navigation', null);
  }
  if (command === 'return_to_quick') { knowledgeWindows?.postMessage({ kind: 'return' }); return; }
  if (command === 'select_resources') {
    if (cancelFirstFileSelection) {
      cancelFirstFileSelection = false;
      return { resources: [] };
    }
    if (sentFileScenario) {
      const chosen = { ...resource, id: uuid(), label: fileChoices.next().value!, scope: payload?.scope as typeof resource.scope };
      selectedFiles.set(chosen.id, chosen);
      return { resources: [chosen] };
    }
    const chosen = { ...resource, scope: payload?.scope as typeof resource.scope, source_version: 'a'.repeat(64),
      ...(retrievalScenario && payload?.kind === 'directory' ? { kind: 'directory' as const, label: '所选本地检索模型' } : {}) };
    selectedFiles.set(chosen.id, chosen);
    return { resources: [chosen] };
  }
  if (command === 'choose_skill_export_target') return { resources: [{
    ...resource, scope: payload?.scope, kind: 'export', label: exportName, source_version: existingExportHash,
  }] };
  if (command === 'pending_counts') return { pending_actions: 0, pending_questions: 0, pending_approvals: 0, unviewed_results: 0 };
  if (command === 'window_settings') return { quick_pinned: false, ball_enabled: false, shortcut: null, shortcut_error: null };
  if (command === 'set_quick_form_active' || command === 'toggle_quick' || command === 'open_settings') return;
  if (command === 'set_quick_pinned') return { quick_pinned: payload?.pinned, ball_enabled: false, shortcut: null, shortcut_error: null };
  if (command === 'credential_status') return { configured: false };
  unexpectedRequests.push(command);
  throw new Error(`未定义的原生测试命令：${command}`);
}, { shouldMockEvents: true });
const originalFetch = window.fetch;
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.origin !== 'http://synthetic.invalid') return originalFetch(input, init);
  const path = url.pathname.replace('/v4', '');
  const body = init.body ? JSON.parse(String(init.body)) : null;
  requests.push({ path, method: init.method ?? 'GET', body, query: Object.fromEntries(url.searchParams) });
  if (retrievalScenario) {
    if (path === '/knowledge/embedding-profiles') return Response.json(page([...retrievalProfiles.values()]));
    if (path.startsWith('/knowledge/embedding-profiles/')) {
      const profileId = path.split('/').at(-1)!;
      if (init.method === 'PUT') {
        const previous = retrievalProfiles.get(profileId);
        const profile: EmbeddingProfile = { ...defaultEmbeddingProfile, ...body.data, id: profileId,
          revision: (previous?.revision ?? 0) + 1,
          pricing: { ...defaultEmbeddingProfile.pricing, ...body.data.pricing } };
        retrievalProfiles.set(profileId, profile);
        const selectedConnection = [connection, retrievalConnection].find(item => item.id === profile.connection_id);
        retrievalViews.set(`${profile.id}:${profile.revision}`, { profile,
          destination: profile.provider === 'openai' ? `${selectedConnection!.endpoint}/embeddings` : null,
          local_runtime_available: profile.provider === 'fastembed' ? false : null });
        return Response.json(profile);
      }
      return Response.json(retrievalViews.get(`${profileId}:${url.searchParams.get('revision')}`));
    }
    if (path.endsWith('/knowledge/settings')) {
      if (init.method === 'PUT') {
        retrievalSettings = { ...retrievalSettings, revision: retrievalSettings.revision + 1,
          desired_profile: body.data.embedding_profile, rebuild_job_id: uuid() };
        knowledgeJobs.push({ ...knowledgeJob, id: retrievalSettings.rebuild_job_id!, command_id: body.meta.command_id,
          kind: 'rebuild', source_id: null, source_version: null, task: null, status: 'queued' });
        retrievalReceipts.set(body.meta.command_id, retrievalSettings);
        for (const requested of body.data.grants) grants.push({ ...grant, ...requested, id: uuid() });
      }
      return Response.json(retrievalSettings);
    }
  }
  if (knowledgeScenario) {
    if (path.startsWith('/knowledge/sources/') && path.endsWith('/actions')) {
      const sourceId = path.split('/')[3], index = knowledgeSources.findIndex(source => source.id === sourceId);
      const fingerprint = JSON.stringify({ path, body }), prior = knowledgeActionReceipts.get(body.meta.command_id);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error('来源动作重放身份已改变');
        return Response.json(prior.source);
      }
      const source = knowledgeSources[index];
      if (body.meta.expected_version !== source.revision) throw new Error('来源动作使用了错误 revision');
      const changed: KnowledgeSource = { ...source, revision: source.revision + 1,
        status: ({ remove: 'removed', revoke: 'revoked', delete: 'deleted' } as const)[body.data.action as 'remove' | 'revoke' | 'delete'],
        cleanup_status: 'pending', cleanup_reason: null };
      knowledgeSources[index] = changed;
      knowledgeActionReceipts.set(body.meta.command_id, { fingerprint, source: changed });
      knowledgeNotice(changed);
      return Response.json(changed);
    }
    if (path.endsWith('/knowledge/sources')) return Response.json(page(knowledgeSources.map((source, index): KnowledgeSourceView => ({
      ...source, latest_job: [...knowledgeJobs].reverse().find(job => job.source_id === source.id) ?? null,
      origin_hint: source.status === 'deleted' ? null : ['设计文档', '会议资料', '研究记录'][index],
      added_at: source.status === 'deleted' ? null : knowledgeJob.created_at,
    }))));
    if (path.endsWith('/knowledge/jobs')) return Response.json(page(knowledgeJobs));
    if (/^\/knowledge\/jobs\/[^/]+$/.test(path)) {
      return Response.json(knowledgeJobs.find(job => job.id === path.split('/').at(-1)));
    }
    if (path.includes('/knowledge/evidence/')) {
      const source = knowledgeSources.find(source => source.id === knowledgeSource.id)!;
      if (source.status === 'revoked' || source.status === 'deleted') return Response.json({
        error: { code: 'knowledge_source_unavailable', safe_message: '资料已停止使用，历史原文不可用', retryable: false, related_ids: [] },
      }, { status: 403 });
      const second = url.searchParams.get('offset') === String(knowledgeFirstLength);
      return Response.json({ ...knowledgeEvidence, text: knowledgeText[second ? 1 : 0], current_version: source.active_version,
        offset: second ? knowledgeFirstLength : 0, next_offset: second ? null : knowledgeFirstLength,
        total_chars: knowledgeFirstLength + Array.from(knowledgeText[1]).length });
    }
    if (path.endsWith('/knowledge/imports')) {
      if (body.data.source_id) {
        const index = knowledgeSources.findIndex(source => source.id === body.data.source_id), source = knowledgeSources[index];
        if (body.meta.expected_version !== source.revision) throw new Error('来源更新使用了错误 revision');
        const label = body.data.resource_ids.length ? selectedFiles.get(body.data.resource_ids[0])!.label : source.label;
        knowledgeSources[index] = { ...source, revision: source.revision + 1, label };
        knowledgeJobs.push({ ...knowledgeJob, id: uuid(), command_id: body.meta.command_id, source_id: source.id,
          source_version: (source.active_version ?? 0) + 1, status: 'queued' });
        knowledgeNotice(knowledgeSources[index]);
      }
      const receipt: KnowledgeImportReceipt = { command_id: body.meta.command_id,
        jobs: [{ ...knowledgeJob, command_id: body.meta.command_id }], rejected: [] };
      knowledgeReceipts.set(receipt.command_id, receipt);
      if (knowledgeScenario === 'unknown') throw new TypeError('合成响应丢失');
      return Response.json(receipt, { status: 202 });
    }
    if (path.startsWith(`/workspaces/${id}/commands/`)) {
      const receipt = knowledgeReceipts.get(path.split('/').at(-1)!) ?? retrievalReceipts.get(path.split('/').at(-1)!);
      return Response.json({ status: receipt ? 'confirmed' : 'not_found', result: receipt ?? null });
    }
  }
  if (queryRecovery && path === '/inbox') {
    const value = [...runs.values()][0];
    return Response.json(page([{ id: value.id, kind: 'recovery', workspace_id: id, session_id: id, run_id: value.id,
      task_id: value.root_task_id, version: value.version, reason: 'mcp_query_uncertain_retry_available',
      allowed_actions: [{ kind: 'view_task', target_id: value.id, expected_version: null },
        { kind: 'resume', target_id: value.id, expected_version: value.version }] }]));
  }
  if (task5Inbox && path === '/inbox') return Response.json(page([...approvals.values()].filter(approval => approval.status === 'pending').map(approval => ({
    id: approval.id, kind: 'approval', workspace_id: approval.workspace_id, session_id: approval.session_id, run_id: approval.run_id, approval,
    workspace_name: workspaces.find(workspace => workspace.id === approval.workspace_id)!.name,
    session_title: sessions.find(session => session.id === approval.session_id)!.title,
    task_goal: '核对会议纪要导出',
  }))));
  if (task2Scenario === 'stop') {
    if (path.endsWith('/admission') || path.endsWith('/stop-all')) {
      const [,, targetId] = path.split('/');
      const targetSession = sessions.find(session => session.id === targetId);
      const scope = path.startsWith('/sessions/')
        ? { kind: 'session' as const, workspace_id: targetSession!.workspace_id, session_id: targetId }
        : { kind: 'workspace' as const, workspace_id: targetId, session_id: null };
      if (path.endsWith('/admission')) return Response.json({ scope, generation: generations.get(path.replace('/admission', '')) });
      const prior = stopReceipts.get(body.command_id);
      if (prior) {
        if (prior.path !== path || prior.version !== body.expected_version) throw new Error('重放的范围或代次已改变');
        return Response.json(prior.receipt);
      }
      const key = path.replace('/stop-all', '');
      if (generations.get(key) !== body.expected_version) throw new Error('首次提交使用了错误代次');
      const cancelled = [...runs.values()].filter(value => value.state === 'running' && value.workspace_id === scope.workspace_id
        && (!scope.session_id || value.interaction_session_id === scope.session_id));
      for (const value of cancelled) runs.set(value.id, { ...value, version: value.version + 1, state: 'cancelled', reason: 'stop_all' });
      const receipt = { scope, generation: body.expected_version + 1, cancelled_run_ids: cancelled.map(value => value.id) };
      generations.set(key, receipt.generation);
      stopReceipts.set(body.command_id, { path, version: body.expected_version, receipt });
      throw new TypeError('合成网络在 Runtime 持久化回执后丢失响应');
    }
    if (/^\/sessions\/[^/]+\/commands\/[^/]+$/.test(path)) {
      const [,, sessionId,, commandId] = path.split('/');
      const prior = stopReceipts.get(commandId);
      const result = prior?.receipt.scope.session_id === sessionId ? prior.receipt : null;
      return Response.json({ status: result ? 'confirmed' : 'not_found', result });
    }
  }
  if (task2Scenario === 'interaction' && init.method === 'POST') {
    if (path.endsWith('/answer')) {
      const question = questions.get(path.split('/')[2])!;
      questions.set(question.id, { ...question, version: question.version + 1, status: 'answered', answer_message_id: uuid() });
      return Response.json(runs.get(question.run_id));
    }
    if (path.endsWith('/decision')) {
      const approval = approvals.get(path.split('/')[2])!;
      const decided: Approval = { ...approval, version: approval.version + 1, status: body.data.allow ? 'approved' : 'denied' };
      approvals.set(decided.id, decided);
      return Response.json(decided);
    }
  }
  if (path.endsWith('/events')) {
    let active: ReadableStreamDefaultController<Uint8Array>;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { active = controller; streams.add(controller); }, cancel() { streams.delete(active); } }));
  }
  if (init.method === 'POST') {
    if (path === '/capabilities/skills/resolve') {
      const { skill_id, content_hash, name, description } = skillView.version;
      return Response.json({ versions: { [skill_id]: content_hash }, dependencies: [],
        entries: [{ skill_id, content_hash, name, description }] });
    }
    if (path === '/capabilities/skill-exports') {
      exportReceipt = { ...skillReceipt, command_id: body.meta.command_id, skill_id: body.data.skill_id, content_hash: body.data.content_hash,
        target_ref: body.data.target_ref, target_path: `C:\\Synthetic\\${exportName}` };
      return Response.json(exportReceipt);
    }
    if (/^\/results\/[^/]+\/view$/.test(path)) {
      const delivery = deliveries.get(path.split('/')[2])!;
      const viewed = { ...delivery, version: delivery.version + 1, viewed_at: '2026-11-21T08:00:00Z' };
      deliveries.set(viewed.id, viewed);
      return Response.json(viewed);
    }
    if (path === `/model-connections/${connection.id}/discover`) return Response.json(modelDiscovery);
    if (path === `/capabilities/mcp/${notes.config.id}/discover`) {
      await new Promise<void>(resolve => window.addEventListener('fixture-mcp-ready', () => resolve(), { once: true }));
      init.signal?.throwIfAborted();
      notes = { ...notes, state: 'connected', catalog: { server_id: notes.config.id,
        config_revision: notes.config.revision, content_hash: 'a'.repeat(64), tools: [{ name: 'read',
          description: '读取笔记', input_schema: { type: 'object' }, output_schema: null, annotations: null, unavailable_reason: null }] } };
      return Response.json(notes);
    }
    if (path.endsWith('/resource-coverage')) {
      const allowed = grants.some(item => item.scope.session_id === path.split('/')[2]
        && item.destination === connection.endpoint && body.resource_ids.every((id: string) => item.resource_ids.includes(id)));
      return Response.json({ allowed, destination: connection.endpoint,
        missing_read: allowed ? [] : body.resource_ids, missing_model_send: allowed ? [] : body.resource_ids });
    }
    if (path === '/grants') { const value = { ...grant, ...body.data, id: uuid() }; grants.push(value); return Response.json(value); }
    if (path === '/workspaces') { const value = { id: uuid(), version: 1, name: body.data.name, directory_resource_id: null }; workspaces.push(value); return Response.json(value); }
    if (path.endsWith('/sessions')) {
      if (firstSessionReceipt && body.meta.command_id === firstSessionReceipt.commandId) return Response.json(firstSessionReceipt.session);
      const value: Session = { ...fixtureSession, id: uuid(), workspace_id: path.split('/')[2], title: body.data.title ?? '新会话' };
      sessions.push(value);
      if (firstRun === 'no-session' && !firstSessionReceipt) {
        firstSessionReceipt = { commandId: body.meta.command_id, session: value };
        throw new TypeError('合成网络在持久化首个会话后丢失响应');
      }
      return Response.json(value);
    }
    if (path.endsWith('/runs')) {
      const sessionId = path.split('/')[2];
      if (fileDecision && current && current.interaction_session_id === sessionId && body.data.inherit_session_files !== false
        && !body.data.sources.resource_ids.length) return Response.json({ error: {
          code: fileDecision === 'recipient' ? 'session_file_recipient_changed' : 'file_source_changed',
          safe_message: '会话文件需要确认', retryable: false, related_ids: current.sources.resource_ids,
        } }, { status: 409 });
      let modelProfile = run.config.model_profile;
      if (modelPickerScenario) {
        const selected = pickerModels.find(item => item.id === body.data.model_profile_id)!;
        const { connection_version, protocol, endpoint, secret_ref, provider_preset_id, capabilities } = resolvePickerModel(selected);
        modelProfile = { ...modelProfile, ...selected, context_window_tokens: modelProfile.context_window_tokens,
          connection_version, protocol, endpoint, secret_ref, provider_preset_id, capabilities,
          ...(body.data.reasoning_effort ? { reasoning_effort: body.data.reasoning_effort } : {}) };
      }
      current = { ...run, id: uuid(), root_task_id: uuid(), budget_id: uuid(), interaction_session_id: sessionId, execution_session_id: sessionId, workspace_id: sessions.find(session => session.id === sessionId)!.workspace_id,
        config: { ...run.config, agent_profile: profile, model_profile: modelProfile }, sources: body.data.sources, state: 'running' };
      if (fileDecision) current = { ...current, file_inputs: Object.fromEntries(current.sources.resource_ids.map(resourceId => [
        resourceId, { file_identity: 'b'.repeat(64), source_version: 'a'.repeat(64) },
      ])) };
      runs.set(current.id, current);
      const sent: ModelMessage = { id: uuid(), run_id: current.id, activity_id: null, event_id: String(++watermark), event_index: 0,
        role: 'user', origin: 'conversation', parts: [{ kind: 'text', text: body.data.text }], private_ref: null, source_dependencies: [] };
      if (current.sources.resource_ids.length) {
        sent.attachments = current.sources.resource_ids.map(resource_id => ({
          resource_id, name: selectedFiles.get(resource_id)!.label, resource_lineage: [resource_id],
          read_grant_ids: grants.filter(item => item.status === 'active' && item.purposes.includes('read')
            && item.scope.session_id === sessionId && item.resource_ids.includes(resource_id)).map(item => item.id),
        }));
      }
      messages.push(sent);
      if (modelPickerScenario) {
        const started = { ...event, event_id: sent.event_id,
          workspace_id: current.workspace_id, session_id: sessionId, run_id: current.id, causation_id: body.meta.command_id,
          payload: { ...event.payload, runs: [current], tasks: detail(current).tasks.items,
            messages: [sent], message_watermark: sent.event_id } } satisfies PublicEvent;
        const activity: ActivityView = { id: uuid(), run_id: current.id, task_id: current.root_task_id,
          version: 2, kind: 'model', operation: 'model.generate', state: 'dispatched',
          actual_units: null, dependencies: [], error: null, usage: null, script_execution: null };
        activities.set(activity.id, activity);
        const use = { event_id: String(++watermark), session_id: sessionId, model_profile_id: modelProfile.id,
          reasoning_effort: modelProfile.reasoning_effort ?? null };
        // 快照、会话历史和 SSE 共用首个根模型派发事实。
        chatModelDispatches.unshift({ workspaceId: current.workspace_id, use });
        const dispatched = { ...started, kind: 'activity.dispatched', event_id: use.event_id, seq: 2,
          task_id: activity.task_id, activity_id: activity.id, causation_id: null,
          payload: { ...event.payload, runs: [], activities: [activity], chat_model_use: use } } satisfies PublicEvent;
        for (const item of [started, dispatched]) {
          const wire = { kind: 'durable', event_id: item.event_id, event: item };
          for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`));
        }
      }
      return Response.json(current);
    }
    if (path.endsWith('/cancel')) { current = { ...runs.get(path.split('/')[2])!, state: 'cancelled', reason: 'user_cancelled', version: runs.get(path.split('/')[2])!.version + 1 }; runs.set(current.id, current); return Response.json(current); }
    unexpectedRequests.push(path);
    throw new Error(`未定义的写入路由：${path}`);
  }
  if (path === '/navigation') {
    const pending = task5Inbox ? [...approvals.values()].filter(approval => approval.status === 'pending') : [];
    return Response.json({ default_workspace_id: id, workspaces: page(workspaces.map(workspace => ({
      workspace, sessions: page(sessions.filter(session => session.workspace_id === workspace.id)),
      pending_count: pending.filter(approval => approval.workspace_id === workspace.id).length,
    }))), recent_sessions: page([]), pending_count: pending.length, watermark: String(watermark) });
  }
  if (path === '/workspaces') return Response.json(page(workspaces));
  if (readingImage && path === `/artifacts/${readingImage.artifact.id}/image`) {
    if (new Headers(init.headers).get('Authorization') !== 'Bearer synthetic-token') return new Response(null, { status: 401 });
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 100;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#e7edf9';
    context.fillRect(0, 0, 240, 100);
    context.fillStyle = '#263b70';
    context.font = '18px sans-serif';
    context.fillText('302  白板与投影', 24, 56);
    return new Response(await new Promise<Blob | null>(resolve => canvas.toBlob(resolve)), { headers: { 'Content-Type': 'image/png' } });
  }
  if (path.startsWith('/artifacts/') && path.endsWith('/content')) {
    const report = reports.get(path.split('/')[2]);
    if (!report) return Response.json({ detail: '未知产物' }, { status: 404 });
    const start = Number(url.searchParams.get('offset'));
    return Response.json({ text: report.text.slice(start), start, end: report.text.length,
      total_chars: report.text.length, source_version: report.artifact.content_hash });
  }
  if (path === '/tasks' || path === '/memory/maintenance' || path === `/memory/records/${memory.id}/maintenance`) return Response.json(page([]));
  if (path === '/memory/records') {
    const personal = url.searchParams.get('scope_kind') === 'user_global';
    return Response.json(page(!personal ? [] : url.searchParams.get('status') === 'confirmed' ? [{
      ...memory, id: '00000000-0000-4000-8000-000000000063', status: 'confirmed', text: '每份报告附上来源',
    }] : [memory]));
  }
  if (path === `/memory/records/${memory.id}`) return Response.json(memory);
  if (path === `/memory/records/${memory.id}/evidence`) return Response.json(page(memory.evidence.map(evidence => ({
    evidence, available: evidenceAvailable, reason: evidenceAvailable ? null : 'source_unavailable',
  }))));
  if (path === `/memory/records/${memory.id}/evidence/0/excerpt`) {
    if (evidenceReadFails) {
      evidenceReadFails = false;
      return Response.json({ error: { code: 'source_read_unavailable', retryable: true, related_ids: [],
        safe_message: '原始资料暂时无法读取。已保存的记忆和当前草稿仍然保留。请重试查看原始消息，等待来源恢复后核对上下文。合成来源：https://example.invalid/archive/meeting-records/2026/03/reading-group/meeting-notes-and-reference-materials.html' } }, { status: 503 });
    }
    const start = Number(url.searchParams.get('offset'));
    if (Number(url.searchParams.get('expected_revision')) !== memory.revision) throw new Error('依据查询缺少当前记忆修订');
    const text = start === 0 ? evidencePages[0] : evidencePages[1];
    return Response.json({ record_id: memory.id, record_revision: memory.revision, source_label: '合成会话 · 原始消息',
      evidence: memory.evidence[0], reason: evidenceAvailable ? null : 'source_unavailable',
      excerpt: evidenceAvailable ? { text, start, end: start + text.length,
        total_chars: evidencePages.join('').length, source_version: memory.evidence[0].source_version } : null });
  }
  if (path === '/settings/memory') {
    const workspaceId = url.searchParams.get('workspace_id');
    return Response.json(workspaceId ? { ...memoryPolicy, scope: { kind: 'workspace', workspace_id: workspaceId, session_id: null } } : memoryPolicy);
  }
  if (path === '/memory/grants') return Response.json(page(url.searchParams.get('scope_kind') === 'user_global' ? [memoryGrant] : []));
  if (path === '/capabilities/skills') {
    const workspaceId = url.searchParams.get('workspace_id');
    if (!workspaceId) return Response.json(page([]));
    const scope = { ...skillView.version.scope, workspace_id: workspaceId };
    return Response.json(page([{ ...skillView, version: { ...skillView.version, scope },
      binding: { ...skillView.binding!, scope } }]));
  }
  if (path === `/capabilities/skills/${skillView.version.skill_id}/versions/${skillHash}/file`) {
    const text = '整理真实发布说明';
    return Response.json({ skill_id: skillView.version.skill_id, content_hash: skillHash, path: 'SKILL.md', file_hash: skillHash,
      encoding: 'utf-8', content: text, start: 0, end: text.length, total: text.length });
  }
  if (path === '/capabilities/skill-exports') return Response.json(exportReceipt ? [exportReceipt] : []);
  if (path === '/capabilities/mcp') return Response.json(page(url.searchParams.get('scope_kind') === 'user_global' ? [notes] : []));
  if (path === '/profiles/default') return Response.json(profile);
  if (path === '/profiles') return Response.json(page([{ ...profile, id: secondId, display_name: '排序靠前的成员' }, profile]));
  if (modelPickerScenario && !noModel) {
    if (path === '/models') return Response.json(page(pickerModels));
    if (path === '/model-connections') return Response.json(page(pickerConnections));
    const selected = pickerModels.find(item => path === `/models/${item.id}/resolved`);
    if (selected) return Response.json(resolvePickerModel(selected));
  }
  if (path === '/models' && firstRun !== null) return Response.json(page(noModel ? [] : [model]));
  if (path === '/models') return Response.json(url.searchParams.get('cursor') === 'synthetic-model-tail'
    ? page([model]) : { ...page([]), next_cursor: 'synthetic-model-tail' });
  if (path === `/models/${model.id}/resolved`) return Response.json({
    ...modelResolution,
  });
  if (path === '/model-connections') return Response.json(page(noModel ? [] : retrievalScenario ? [connection, retrievalConnection] : [connection]));
  if (path === `/workspaces/${id}/title-policy` && new URLSearchParams(location.search).has('title-settings')) {
    return Response.json({ workspace_id: id, version: null, binding: null });
  }
  if (path === '/provider-presets') return Response.json(modelPickerScenario ? pickerPresets : []);
  if (/^\/workspaces\/[^/]+\/resources$/.test(path)) return Response.json(page(resource.scope.workspace_id === path.split('/')[2] ? [resource] : []));
  if (path.endsWith('/grants')) return Response.json({ ...page(grants.filter(item => item.scope.workspace_id === path.split('/')[2]
    && (!url.searchParams.has('session_id') || item.scope.session_id === url.searchParams.get('session_id')))), watermark: String(watermark) });
  if (path.endsWith('/commands') || path.endsWith('/follow-ups')) return Response.json(page([]));
  if (path.endsWith('/results')) return Response.json({ ...page([...deliveries.values()].filter(entry => entry.target_session_id === path.split('/')[2])), watermark: String(watermark) });
  if (/^\/tasks\/[^/]+\/result$/.test(path)) return Response.json(taskResults.get(path.split('/')[2]));
  if (path.endsWith('/directory')) return Response.json({ workspace_id: path.split('/')[2], workspace_version: 1, state: 'unlinked', reason: null, resource: null });
  if (path.endsWith('/snapshot')) {
    const workspaceId = path.split('/')[2];
    const modelUses = new Map<string, NonNullable<SessionRunPage['last_model_use']>>();
    for (const { workspaceId: owner, use } of chatModelDispatches) {
      if (owner === workspaceId && !modelUses.has(use.model_profile_id)) modelUses.set(use.model_profile_id, use);
      if (modelUses.size === 10) break;
    }
    return Response.json({ workspace: workspaces.find(workspace => workspace.id === workspaceId),
      sessions: page(sessions.filter(session => session.workspace_id === workspaceId)), active_runs: page(current && current.state === 'running' ? [current] : []),
      pending_questions: page([]), pending_approvals: page([]), resources: page([]), grants: page([]), watermark: String(watermark),
      ...(modelUses.size ? { recent_model_uses: [...modelUses.values()] } : {}) });
  }
  if (/^\/sessions\/[^/]+$/.test(path)) return Response.json(sessions.find(session => session.id === path.split('/')[2]));
  if (/^\/sessions\/[^/]+\/context$/.test(path)) {
    const sessionId = path.split('/')[2];
    const value = [...runs.values()].reverse().find(value => value.interaction_session_id === sessionId
      && value.execution_session_id === sessionId && (value.kind === 'user' || value.kind === 'follow_up'));
    const records = value ? contextActivities.get(value.id) ?? [] : [];
    const latest = records.slice().reverse().find(item => item.kind === 'model') ?? null;
    const cursor = url.searchParams.get('cursor');
    const firstPage = Math.min(3, Number(url.searchParams.get('limit') ?? 3));
    const nextCursor = value && records.length > firstPage ? `context-${value.id}` : null;
    if (cursor !== null && cursor !== nextCursor) throw new Error('分页游标不属于当前轮');
    const usedKnowledge = knowledgeScenario && value?.id === current?.id;
    const citedSource = knowledgeSources[0];
    const knowledgeHidden = citedSource.status === 'revoked' || citedSource.status === 'deleted';
    return Response.json({
      round: value ? { run_id: value.id, state: value.state, source_attention: false } : null,
      files: value ? contextFiles.get(value.id) ?? [] : [],
      knowledge: usedKnowledge && !knowledgeHidden ? [{ evidence_id: knowledgeEvidenceId, name: citedSource.label,
        start_line: knowledgeEvidence.evidence.locator.start_line, end_line: knowledgeEvidence.evidence.locator.end_line,
        historical: citedSource.status === 'removed' || citedSource.active_version !== knowledgeEvidence.evidence.source_version }] : [],
      hidden_knowledge_count: usedKnowledge && knowledgeHidden ? 1 : 0,
      hidden_file_count: 0, history: value && value.id === historyNoticeRunId ? contextHistory : null,
      latest_request: latest, units_per_currency: '1000000000',
      activities: { items: cursor ? records.slice(firstPage) : records.slice(0, firstPage),
        next_cursor: cursor ? null : nextCursor, watermark: String(watermark) },
    } satisfies SessionContext);
  }
  if (/^\/sessions\/[^/]+\/context\/usage$/.test(path)) {
    const sessionId = path.split('/')[2];
    const modelRequests = [...runs.values()].filter(value => value.interaction_session_id === sessionId)
      .flatMap(({ id }) => contextActivities.get(id) ?? []).filter(item => item.kind === 'model');
    const reportingCache = modelRequests.filter(item => item.cached_input_tokens != null);
    const embeddings = [...runs.values()].filter(value => value.interaction_session_id === sessionId)
      .flatMap(({ id }) => contextActivities.get(id) ?? []).filter(item => item.kind === 'embedding');
    return Response.json({
      units_per_currency: '1000000000', requests: modelRequests.length,
      input_tokens: modelRequests.reduce((sum, item) => sum + item.input_tokens!, 0),
      output_tokens: modelRequests.reduce((sum, item) => sum + item.output_tokens!, 0),
      input_reported_requests: modelRequests.length, output_reported_requests: modelRequests.length,
      cached_input_tokens: reportingCache.reduce((sum, item) => sum + item.cached_input_tokens!, 0),
      cache_reported_requests: reportingCache.length,
      cache_reported_input_tokens: reportingCache.reduce((sum, item) => sum + item.input_tokens!, 0),
      cached_tokens_with_reported_input: reportingCache.reduce((sum, item) => sum + item.cached_input_tokens!, 0),
      calculated_units: [...modelRequests, ...embeddings].reduce((sum, item) => sum + BigInt(item.calculated_units ?? '0'), 0n).toString(),
      unknown_cost_requests: modelRequests.filter(item => item.calculated_units == null).length, pending_cost_requests: 0,
      embedding_requests: embeddings.length,
      embedding_input_tokens: embeddings.reduce((sum, item) => sum + (item.input_tokens ?? 0), 0),
      embedding_input_reported_requests: embeddings.filter(item => item.input_tokens != null).length,
      embedding_calculated_units: embeddings.reduce((sum, item) => sum + BigInt(item.calculated_units ?? '0'), 0n).toString(),
      embedding_unknown_cost_requests: embeddings.filter(item => item.calculated_units == null && !item.cost_pending).length,
      embedding_pending_cost_requests: embeddings.filter(item => item.cost_pending).length,
    } satisfies SessionContextUsage);
  }
  if (path.endsWith('/run-feedback')) return Response.json({ ...page(url.searchParams.getAll('run_id').map(id => runs.get(id)!).map(value => ({
    run_id: value.id, version: value.version, workspace_id: value.workspace_id,
    session_id: value.interaction_session_id, root_task_id: value.root_task_id,
    connection_id: value.config.model_profile.connection_id, state: value.state, reason: value.reason,
    model_activity: modelPickerScenario ? [...activities.values()].find(item =>
      item.run_id === value.id && item.task_id === value.root_task_id && item.kind === 'model') ?? null : null,
    context_usage: value.id === historyNoticeRunId ? contextHistory : null,
  }))), watermark: String(watermark) });
  if (path.endsWith('/messages')) {
    const sessionId = path.split('/')[2];
    const items = messages.filter(message => runs.get(message.run_id)!.interaction_session_id === sessionId);
    return Response.json({ ...page(items), watermark: String(watermark) });
  }
  if (path.endsWith('/export-recovery')) return Response.json([]);
  if (path.startsWith('/sessions/') && path.endsWith('/runs')) {
    const sessionId = path.split('/')[2];
    const lastUse = !url.searchParams.has('cursor')
      ? chatModelDispatches.find(({ use }) => use.session_id === sessionId)?.use : undefined;
    return Response.json({ ...page([...runs.values()].filter(value => value.interaction_session_id === sessionId)),
      watermark: String(watermark), ...(lastUse ? { last_model_use: lastUse } : {}) });
  }
  if (/^\/runs\/[^/]+\/activities$/.test(path)) {
    const activityId = url.searchParams.get('activity_id');
    return Response.json({ ...page([...activities.values()].filter(activity =>
      activity.run_id === path.split('/')[2] && (!activityId || activity.id === activityId))), watermark: String(watermark) });
  }
  if (knowledgeMember && path === `/runs/${knowledgeMember.task.run_id}/member-lanes`) return Response.json([knowledgeMember]);
  if (path.startsWith('/runs/')) return Response.json(detail(runs.get(path.split('/')[2])!));
  unexpectedRequests.push(path);
  throw new Error(`未定义的读取路由：${path}`);
};
function managedDelivery(origin: AgentRunSnapshot, name: string, assistant: string, summary: string, text: string) {
  const managed: AgentRunSnapshot = { ...origin, id: uuid(), root_task_id: uuid(), budget_id: uuid(),
    execution_session_id: uuid(), kind: 'managed', state: 'completed',
    config: { ...origin.config, agent_profile: { ...profile, id: uuid(), display_name: assistant } } };
  const artifact: ArtifactRef = { id: uuid(), activity_id: uuid(), task_id: managed.root_task_id, version: 1,
    media_type: 'text/markdown', content_hash: (String(deliveries.size + 1)).repeat(64), dependencies: [] };
  managed.output = { summary, artifact_ids: [artifact.id], unresolved: [], handled_failures: [] };
  runs.set(managed.id, managed);
  reports.set(artifact.id, { runId: managed.id, artifact, text });
  const activity: ActivityView = {
    id: artifact.activity_id, task_id: artifact.task_id, run_id: managed.id, version: 1, kind: 'tool', operation: 'run_skill_script',
    state: 'succeeded', actual_units: null, dependencies: [], error: null, usage: null,
    script_execution: { attempt_id: uuid(), content_hash: skillHash, environment_id: uuid(), environment_revision: 1,
      script_relative_path: 'scripts/report.py', skill_id: skillView.version.skill_id, exit_code: 0, external_costs: 'unknown',
      outputs: [{ artifact, relative_path: '阅读报告.md' }], termination_reason: 'exited', truncated: false, collection_error: null },
  };
  activities.set(activity.id, activity);
  const result = { run_id: managed.id, task_id: managed.root_task_id, lifetime: 'managed', submitted_state: 'completed' } as const;
  const content: AgentResult = { summary, status: 'completed', structured_result: { 章节: '阅读纪要' }, artifact_ids: [artifact.id],
    evidence_refs: [], handled_failures: [], unresolved: [], verification: [] };
  const entry: SessionInboxEntry = { ...resultEntry, id: uuid(), source_event_id: String(++watermark), target_session_id: origin.interaction_session_id!,
    result, task_name: name, assistant_name: assistant };
  deliveries.set(entry.id, entry);
  taskResults.set(result.task_id, { handle: result, state: 'completed', result_version: entry.result_version,
    result: { ...content }, artifacts: [artifact], dependencies: [], error: null });
  return { managed, artifact, activity, entry };
}
Object.assign(window, { syntheticUi: { requests, nativeRequests, unexpectedRequests,
  failKnowledgeCleanup() {
    const source = knowledgeSources[0];
    const failed: KnowledgeSource = { ...source, revision: source.revision + 1, cleanup_status: 'failed', cleanup_reason: 'index_cleanup_failed' };
    knowledgeSources[0] = failed; knowledgeNotice(failed);
  },
  readingPreview() {
    const owner = current!;
    readingActivity = { id: uuid(), run_id: owner.id, task_id: owner.root_task_id, version: 1, kind: 'model',
      operation: 'model.generate', state: 'dispatched', actual_units: null, dependencies: [], error: null, usage: null, script_execution: null };
    activities.set(readingActivity.id, readingActivity);
    const eventId = String(++watermark);
    const wire = { kind: 'durable', event_id: eventId, event: { ...event, event_id: eventId, run_id: owner.id,
      session_id: owner.interaction_session_id, workspace_id: owner.workspace_id,
      payload: { ...event.payload, runs: [owner], activities: [readingActivity], messages: [] } } };
    const delta = { kind: 'delta', activity_id: readingActivity.id, index: 0, text: '白板已确认' };
    for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\ndata: ${JSON.stringify(delta)}\n\n`));
  },
  readingCommit() {
    const answer = '白板已确认，使用后请擦干净。';
    const owner: AgentRunSnapshot = { ...current!, state: 'completed', version: current!.version + 1,
      output: { summary: answer, artifact_ids: [], unresolved: [], handled_failures: [] } };
    current = owner;
    runs.set(owner.id, owner);
    const eventId = String(++watermark);
    const message: ModelMessage = { id: uuid(), run_id: owner.id, event_id: eventId, event_index: 0, activity_id: readingActivity.id,
      role: 'assistant', origin: 'conversation', parts: [{ kind: 'text', text: answer }], private_ref: null, source_dependencies: [] };
    messages.push(message);
    const activity: ActivityView = { ...readingActivity, state: 'succeeded', version: readingActivity.version + 1 };
    activities.set(activity.id, activity);
    const wire = { kind: 'durable', event_id: eventId, event: { ...event, event_id: eventId, run_id: owner.id,
      session_id: owner.interaction_session_id, workspace_id: owner.workspace_id,
      payload: { ...event.payload, runs: [owner], activities: [activity], messages: [message] } } };
    const late = { kind: 'delta', activity_id: activity.id, index: 1, text: '迟到的片段' };
    for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\ndata: ${JSON.stringify(late)}\n\n`));
  },
  receiveContextReply() {
    const answer = '白板已确认，使用后请擦干净。';
    const owner: AgentRunSnapshot = { ...run, id: uuid(), root_task_id: uuid(), budget_id: uuid(), state: 'completed',
      config: { ...run.config, agent_profile: profile },
      output: { summary: answer, artifact_ids: [], unresolved: [], handled_failures: [] } };
    const request = contextRequest(3100, 35, null, 16000, '1200000');
    const activity: ActivityView = { id: request.id, run_id: owner.id, task_id: owner.root_task_id, kind: 'model',
      operation: 'model.generate', state: 'succeeded', version: 1, usage: null, actual_units: request.calculated_units,
      error: null, dependencies: [], script_execution: null };
    const eventId = String(++watermark);
    const prompt: ModelMessage = { id: uuid(), run_id: owner.id, event_id: eventId, event_index: 0, activity_id: null,
      role: 'user', origin: 'conversation', parts: [{ kind: 'text', text: '再确认白板是否可用' }], private_ref: null, source_dependencies: [] };
    const reply: ModelMessage = { ...prompt, id: uuid(), event_index: 1, activity_id: activity.id,
      role: 'assistant', parts: [{ kind: 'text', text: answer }] };
    runs.set(owner.id, owner);
    activities.set(activity.id, activity);
    contextActivities.set(owner.id, [request]);
    messages.push(prompt, reply);
    const wire = { kind: 'durable', event_id: eventId, event: { ...event, kind: 'task.stepped', event_id: eventId,
      run_id: owner.id, session_id: owner.interaction_session_id, workspace_id: owner.workspace_id,
      payload: { ...event.payload, runs: [owner], activities: [activity], messages: [prompt, reply] } } };
    for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`));
  },
  task2Targets() {
    return { workspaces, sessions, runs: [...runs.values()], questions: [...questions.values()], approvals: [...approvals.values()],
      stopReceipts: [...stopReceipts].map(([commandId, entry]) => ({ commandId, ...entry })) };
  },
  failEvidenceRead() { evidenceReadFails = true; },
  invalidateEvidence() {
    evidenceAvailable = false;
    window.dispatchEvent(new Event('focus'));
  },
  petCounts(counts: PendingCounts | null) { return emit('pending-counts', counts); },
  complete({ includeDeliveryActivities = true } = {}) {
  const summary = '合成验收已完成，可以继续下一步。';
  const artifact: ArtifactRef = { id: uuid(), activity_id: uuid(), task_id: current!.root_task_id, version: 1,
    media_type: 'text/markdown', content_hash: '18d16068f261d1bacc66291487528f822ecbe8946f1336d29c7e2ce5244036a1', dependencies: [] };
  reports.set(artifact.id, { runId: current!.id, artifact, text: '# 本周阅读报告\n\n会议记录已核对。下次讨论时可以从以下两项继续。\n\n| 事项 | 负责人 |\n| --- | --- |\n| 整理意见 | 主助理 |\n| 补充示例 | 项目成员 |' });
  current = { ...current!, state: 'completed', version: current!.version + 1,
    output: { summary, artifact_ids: [artifact.id], unresolved: [], handled_failures: [] } };
  runs.set(current.id, current);
  contextActivities.set(current.id, [contextRequest(2400, 60, null, null, '3000000')]);
  const unrelated = managedDelivery(current, '不相关的对照交付', '对照助理', '对照来源已完成。', '# 对照文件');
  const sources = [
    managedDelivery(current, '会议记录整理', '会议记录员', '会议记录来源已完成。', '# 会议记录版\n\n已整理阅读会意见。\n\n| 事项 | 负责人 |\n| --- | --- |\n| 整理意见 | 主助理 |'),
    managedDelivery(current, '图书馆资料核对', '图书资料员', '图书馆资料来源已完成。', '# 本周阅读报告\n\n已核对图书馆资料。\n\n| 事项 | 负责人 |\n| --- | --- |\n| 补充示例 | 项目成员 |'),
  ];
  if (!includeDeliveryActivities) for (const source of sources) coldDeliveryRuns.add(source.managed.id);
  const message: ModelMessage = { id: uuid(), run_id: current.id, activity_id: null, event_id: String(++watermark), event_index: 0, role: 'assistant', origin: 'conversation',
    parts: [{ kind: 'text', text: summary }], private_ref: null, source_dependencies: [] };
  const report: ModelMessage = { ...message, id: uuid(), event_index: 1, origin: 'background_report',
    parts: [{ kind: 'text', text: '两位成员已交付，同名文件来自不同任务。' }], delivery_ids: sources.map(source => source.entry.id) };
  messages.push(message, report);
  const wire = { kind: 'durable', event_id: String(watermark), event: { ...event, event_id: String(watermark), kind: 'task.stepped', run_id: current.id,
    session_id: current.interaction_session_id, workspace_id: current.workspace_id, payload: { ...event.payload, runs: [current, unrelated.managed, ...sources.map(source => source.managed)],
      messages: [message, report], activities: includeDeliveryActivities ? [unrelated.activity, ...sources.map(source => source.activity)] : [],
      artifacts: [artifact] } } };
  for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`));
  return Object.fromEntries(sources.map(({ entry, managed, artifact }) => [entry.task_name!, {
    delivery: entry.id, version: entry.version, run: managed.id, task: managed.root_task_id,
    artifact: artifact.id, activity: artifact.activity_id,
  }]));
}, fail(reason: string) {
  current = { ...current!, state: 'failed', reason, version: current!.version + 1 };
  runs.set(current.id, current);
  const wire = { kind: 'durable', event_id: String(++watermark), event: { ...event, event_id: String(watermark), kind: 'task.stepped', run_id: current.id,
    session_id: current.interaction_session_id, workspace_id: current.workspace_id, payload: { ...event.payload, runs: [current] } } };
  for (const stream of streams) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(wire)}\n\n`));
} } });
createRoot(document.getElementById('root')!).render(<App />);
