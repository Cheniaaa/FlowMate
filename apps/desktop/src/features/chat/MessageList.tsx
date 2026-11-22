import { Fragment, type ReactNode } from 'react';
import { FileText } from 'lucide-react';
import type { ActivityView, ModelMessage, RunSnapshot } from '../../generated/contracts';
import { latestContextUsage, messageSourceInvalid, terminal } from '../../api/events';
import Markdown from '../../components/Markdown';
import { Button } from '../../components/ui/button';
import Status from '../../components/Status';
import ToolCard, { toolLabel } from './ToolCard';
import type { RuntimeClient } from '../../api/client';
import type { RuntimeStore } from '../../state/runtime-store';
import MemoryReview from '../memory/MemoryReview';
import VisionContinuation from './VisionContinuation';
import './message-attachments.css';
import ContextNotice from './ContextNotice';

type ToolResult = Extract<ModelMessage['parts'][number], { kind: 'tool_result' }>;
type ToolCall = Extract<ModelMessage['parts'][number], { kind: 'tool_call' }>;
const memoryCalls = new Set(['memory.propose', 'memory.remember']);
const controls = new Set(['run.finish', 'user.ask', 'task.submit', 'task.await', 'task.status', 'task.result', 'task.cancel', ...memoryCalls]);

type ReadingItem = { key: string | number; runId?: string; node: ReactNode; steps?: number };

function PublicReasoning({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return null;
  return <details className="reasoning"><summary>
    <span>{streaming ? '思考中' : '思考摘要'}</span>
    <span className="reasoning-preview">{streaming ? lines.at(-1) : lines[0]}</span>
  </summary><Markdown>{text}</Markdown></details>;
}

function renderReadingOrder(items: ReadingItem[]) {
  const output: ReactNode[] = [];
  let adjacent: ReadingItem[] = [];
  function flush() {
    if (!adjacent.length) return;
    const [first] = adjacent;
    const steps = adjacent.reduce((total, item) => total + item.steps!, 0);
    const rows = adjacent.map(({ key, node }) => <Fragment key={key}>{node}</Fragment>);
    output.push(steps > 1
      ? <details className="activity-group" key={first.key}><summary>{`工具活动 · ${steps} 步`}</summary>{rows}</details>
      : rows[0]);
    adjacent = [];
  }
  for (const item of items) {
    if (!item.steps || adjacent.length && adjacent[0].runId !== item.runId) flush();
    if (item.steps) adjacent.push(item);
    else if (item.node) output.push(<Fragment key={item.key}>{item.node}</Fragment>);
  }
  flush();
  return output;
}

export default function MessageList({ messages, assistantName, onOpenResults, client, store, runs = [],
  activities = [], previews = {}, reasoningPreviews = {}, artifacts = [], onOpenArtifact, onOpenToolArtifact, onInspectRun,
  hideInlineContext }: {
  messages: ModelMessage[]; assistantName: string; onOpenResults?: (ids?: string[]) => void; client?: RuntimeClient; store?: RuntimeStore;
  runs?: RunSnapshot[];
  activities?: ActivityView[];
  artifacts?: { id: string; runId: string; label: string }[];
  onOpenArtifact?: (id: string, runId: string) => void;
  onOpenToolArtifact?: (id: string, runId: string, activityId: string) => void;
  onInspectRun?: (runId: string) => void;
  hideInlineContext?: boolean;
  previews?: Record<string, Record<number, string>>;
  reasoningPreviews?: Record<string, Record<number, string>>;
}) {
  const projection = store?.getSnapshot();
  const activeReadGrants = new Map<string, NonNullable<typeof projection>['grants'][string][]>();
  for (const grant of Object.values(projection?.grants ?? {})) {
    if (grant.status !== 'active' || !grant.purposes.includes('read') || projection?.scopes[grant.id]?.status === 'revoked'
      || projection?.scopes[grant.id]?.status === 'deleted') continue;
    for (const resourceId of grant.resource_ids) {
      const grants = activeReadGrants.get(resourceId);
      if (grants) grants.push(grant);
      else activeReadGrants.set(resourceId, [grant]);
    }
  }
  const invalidMessages = new Set(messages.filter(message => messageSourceInvalid(message, projection)).map(message => message.id));
  const committedActivities = new Set(messages.map(message => message.activity_id));
  const runsById = new Map(runs.map(run => [run.id, run]));
  const tailAnchors = new Map<string, string>();
  const finalMessages = new Map<string, ModelMessage>();
  for (const message of messages) {
    // 后台回告有自己的发布时间。它不能移动已经加载的原轮次内容。
    if (message.origin !== 'background_report' || !tailAnchors.has(message.run_id)) {
      tailAnchors.set(message.run_id, message.id);
    }
    if (message.role === 'user' && ['conversation', 'steering', 'answer'].includes(message.origin)) finalMessages.delete(message.run_id);
    if (message.role === 'assistant' && message.origin === 'conversation') {
      finalMessages.set(message.run_id, message);
    }
  }
  for (const [runId, message] of finalMessages) {
    if (runsById.get(runId)?.output) tailAnchors.set(runId, message.id);
  }
  function renderContextNotice(runId: string) {
    const usage = projection && latestContextUsage(projection, runId);
    return !hideInlineContext && usage?.compaction_state === 'blocked' && <ContextNotice usage={usage} disclosureName={`context-${runId}`}
      onInspectRun={onInspectRun && (() => onInspectRun(runId))} />;
  }
  function renderRunTail(run: RunSnapshot) {
    if (run.kind === 'managed') return null;
    const final = finalMessages.get(run.id);
    // 普通模型答复直接生成同轮 RunOutput；仅与这条最终消息关联，不能全局按文本去重。
    const finalText = final?.parts.filter(part => part.kind === 'text').map(part => part.text).join('');
    const represented = final && finalText && !final.parts.some(part => part.kind === 'tool_call') && finalText === run.output?.summary;
    const outputAvailable = (!final || !invalidMessages.has(final.id)) && !run.scope_dependencies.some(({ scope_id, epoch }) =>
      [projection?.scopes[scope_id], projection?.grants[scope_id]].some(scope =>
        scope && (scope.epoch > epoch || scope.status !== 'active')) || (projection?.resources[scope_id]?.version ?? 0) > epoch);
    const live = terminal(run.state) ? [] : activities.filter(activity => activity.run_id === run.id
      && (activity.kind === 'model' || activity.kind === 'tool')
      && ['prepared', 'dispatched'].includes(activity.state)
      && !committedActivities.has(activity.id) && !projection?.fencedActivities[activity.id]);
    const showStatus = run.kind !== 'follow_up' && run.state !== 'completed'
      && !(run.state === 'running' && live.length);
    return <Fragment key={run.id}>
      {live.map(activity =>
        <section className="turn-activity" key={activity.id} aria-label="本轮活动">
          <p className="activity-progress">{toolLabel(activity.operation, run.config.catalog.mcp_tools[activity.operation]?.original_name)} · <Status state={activity.state} /></p>
          {reasoningPreviews[activity.id] && <PublicReasoning streaming text={Object.values(reasoningPreviews[activity.id]).join('')} />}
          {previews[activity.id] && <div className="message-content" aria-label="未提交预览"><Markdown>{Object.values(previews[activity.id]).join('')}</Markdown></div>}
        </section>)}
      {run.output && outputAvailable && (!represented || run.output.unresolved.length > 0) && <article className="message message--assistant" aria-label="正式答复">
        <div className="message-content">{!represented && <Markdown>{run.output.summary}</Markdown>}
          {run.output.unresolved.length > 0 && <ul>{run.output.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul>}
        </div>
      </article>}
      {onOpenArtifact && artifacts.some(item => item.runId === run.id) && <div className="conversation-file-links" aria-label="本轮产物">
        {artifacts.filter(item => item.runId === run.id).map(item =>
          <Button size="sm" variant="outline" key={item.id} onClick={() => onOpenArtifact(item.id, run.id)}><FileText size={14} aria-hidden="true" />{item.label}</Button>)}
      </div>}
      {renderContextNotice(run.id)}
      {showStatus && <p className="turn-status"><Status state={run.state} />
        {['interrupted', 'blocked_incompatible', 'waiting_user'].includes(run.state) && ' · 可在待办中查看处理方式'}</p>}
      {client && store && ['completed', 'failed', 'cancelled', 'waiting_user', 'blocked_incompatible'].includes(run.state)
        && messages.some(message => message.run_id === run.id && !invalidMessages.has(message.id) && message.parts.some(part => {
          if (part.kind !== 'tool_result' || !part.result || typeof part.result !== 'object'
            || part.origin_message_id && invalidMessages.has(part.origin_message_id)
            || !('content' in part.result) || !Array.isArray(part.result.content)) return false;
          const operation = message.tool_operation ?? (part.origin_message_id
            ? callResults.get(part.origin_message_id)?.get(part.call_id)?.call.name : undefined);
          if (!operation?.startsWith('mcp.')) return false;
          return part.result.content.some(item => item && typeof item === 'object' && 'type' in item && item.type === 'image');
        })) && <VisionContinuation run={run} client={client} store={store} />}
    </Fragment>;
  }
  // 先建立完整的已加载调用索引；结果到达顺序及 Activity/Task 均不是配对依据。
  const callResults = new Map<string, Map<string, { call: ToolCall; origin: ModelMessage['origin']; results: ToolResult[]; memoryNotice?: string; receipt?: { id: string; messageId: string; saved?: 'new' | 'corrected' } }>>();
  const receiptSources = new Map<ToolResult, ModelMessage>();
  const activitiesById = new Map(activities.map(activity => [activity.id, activity]));
  const deliveryArtifacts = new Map<string, Set<string>>();
  for (const artifact of artifacts) {
    const ids = deliveryArtifacts.get(artifact.runId) ?? new Set<string>();
    ids.add(artifact.id);
    deliveryArtifacts.set(artifact.runId, ids);
  }
  const openReceipt = onOpenToolArtifact && ((part: ToolResult, id: string) => {
    const source = receiptSources.get(part);
    if (source?.activity_id) onOpenToolArtifact(id, source.run_id, source.activity_id);
  });
  for (const message of messages) {
    if (message.role !== 'assistant' || invalidMessages.has(message.id)) continue;
    const calls = message.parts.filter(part => part.kind === 'tool_call');
    if (calls.length) callResults.set(message.id, new Map(calls.map(call => [call.call_id, { call, origin: message.origin, results: [] }])));
  }
  for (const message of messages) {
    if (invalidMessages.has(message.id)) continue;
    for (const part of message.parts) {
      if (part.kind === 'tool_result' && message.activity_id) receiptSources.set(part, message);
      if (part.kind === 'tool_result' && part.origin_message_id !== null) {
        const paired = callResults.get(part.origin_message_id)?.get(part.call_id);
        paired?.results.push(part);
        const receipt = part.result;
        if (paired?.call.name === 'memory.remember' && paired.origin === 'conversation'
          && message.role === 'tool' && message.origin === 'conversation') {
          const outcome = !part.error && receipt && typeof receipt === 'object' && 'outcome' in receipt ? receipt.outcome : undefined;
          if (outcome === 'existing') paired.memoryNotice = '相同记忆已经存在';
          if (outcome === 'budget' || part.error === 'memory_review_budget') {
            paired.memoryNotice = '本轮未保存记忆，剩余模型请求用于完成当前答复';
          }
        }
        // 只取真实配对的成功回执身份；正文/范围/revision始终从当前Memory API读取。
        if (paired && memoryCalls.has(paired.call.name) && paired.origin === 'conversation' && message.role === 'tool' && message.origin === 'conversation' && part.error === null
          && typeof receipt === 'object' && receipt !== null && 'id' in receipt && typeof receipt.id === 'string'
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(receipt.id)
          && 'revision' in receipt && Number.isSafeInteger(receipt.revision) && Number(receipt.revision) > 0
          && (paired.call.name === 'memory.propose' ? 'status' in receipt && receipt.status === 'candidate'
            : 'outcome' in receipt && ['staged', 'candidate'].includes(String(receipt.outcome)))) {
          const saved = 'outcome' in receipt && receipt.outcome === 'staged'
            ? Number(receipt.revision) > 1 ? 'corrected' : 'new'
            : undefined;
          paired.receipt = { id: receipt.id, messageId: message.id, saved };
        }
      }
    }
  }
  function renderMessage(message: ModelMessage): Pick<ReadingItem, 'node' | 'steps'> {
    const deliveryIds = message.delivery_ids;
    const unavailable = invalidMessages.has(message.id)
      || deliveryIds?.some(id => {
        const entry = projection?.deliveries[id];
        return entry?.source_valid === false || entry?.delivery_state === 'invalidated';
      });
    // origin标识任务交付；模型上下文中的user角色不代表用户原话。
    if (message.origin === 'background_report') return { node: <article className="message message--assistant message--delivery" data-message-id={message.id} aria-label="后台交付">
      <strong className="message-avatar" aria-hidden="true">◇</strong>
      <div className="message-content"><strong className="message-author">后台交付</strong>
        {unavailable ? <p className="muted">历史交付 · 来源已失效</p>
          : message.parts.map((part, index) => part.kind === 'text' && <Markdown key={index}>{part.text}</Markdown>)}
        {onOpenResults && <Button size="xs" variant="link" onClick={() => onOpenResults(deliveryIds?.length ? deliveryIds : undefined)}>
          {deliveryIds?.length ? '查看交付结果' : '打开结果收件箱'}
        </Button>}
      </div>
    </article> };
    if (message.origin === 'task_result') return { node: <article className="message message--task-result" data-message-id={message.id} aria-label="任务交付引用">
      <div className="message-content"><p className="muted">已接收任务交付，供助理处理。</p>
         {onOpenResults && <Button size="xs" variant="link" onClick={() => onOpenResults(deliveryIds?.length ? deliveryIds : undefined)}>
           {deliveryIds?.length ? '查看交付结果' : '打开结果收件箱'}
         </Button>}
      </div>
    </article> };
    if (unavailable) return { node: <p className="turn-status">历史消息 · 来源已失效</p> };
    const hasText = message.parts.some(part => part.kind === 'text');
    const owner = projection?.entityScopes[message.id];
    // 来源观察可以更新内容版本，文件身份与已发送记录的归属保持不变。
    const attachments = message.role === 'user' && message.origin === 'conversation'
      ? (message.attachments ?? []).filter(file => !projection
        || file.resource_lineage.every(id => !projection.scopes[id] || projection.scopes[id].status === 'active')
        && (file.read_grant_ids.some(id => (!projection.scopes[id] || projection.scopes[id].status === 'active')
          && projection.grants[id]?.status !== 'revoked')
          || owner && file.resource_lineage.some(id => activeReadGrants.get(id)?.some(grant =>
            grant.scope.workspace_id === owner.workspace_id
            && (grant.scope.session_id === null || grant.scope.session_id === owner.session_id)))))
      : [];
    const run = runsById.get(message.run_id);
    const items: ReadingItem[] = [];
    for (const [key, part] of message.parts.entries()) {
      if (part.kind === 'text') items.push({ key, node: <Markdown>{part.text}</Markdown> });
      if (part.kind === 'reasoning') items.push({ key, node: <PublicReasoning text={part.text} /> });
      if (part.kind === 'tool_result') {
        const origin = part.origin_message_id;
        if (origin && (invalidMessages.has(origin) || callResults.get(origin)?.has(part.call_id))) continue;
        items.push({ key, steps: part.error === null ? 1 : undefined, node: <ToolCard part={part} client={client}
          sourceOperation={message.tool_operation ?? (message.activity_id ? (projection?.activities[message.activity_id] ?? activitiesById.get(message.activity_id))?.operation : undefined)}
          openReceipt={openReceipt} deliveryArtifacts={deliveryArtifacts.get(message.run_id)} /> });
      }
      if (part.kind === 'tool_call') {
        const paired = callResults.get(message.id)?.get(part.call_id);
        if (client && store && memoryCalls.has(part.name)) {
          const receipt = paired?.receipt;
          if (paired?.memoryNotice) items.push({ key: `${key}-notice`, node: <p role="status">{paired.memoryNotice}</p> });
          else if (receipt) items.push({ key: `${key}-memory`, node: <MemoryReview id={receipt.id} client={client} store={store}
            receiptMessageId={receipt.messageId} savedInChat={receipt.saved} runState={run?.state} /> });
        }
        const control = controls.has(part.name);
        const card = <ToolCard part={part} client={client} label={run?.config.catalog.mcp_tools[part.name]?.original_name}
          showArguments={!memoryCalls.has(part.name) && part.name !== 'run.finish'} results={paired?.results}
          openReceipt={openReceipt} deliveryArtifacts={deliveryArtifacts.get(message.run_id)} />;
        const groupable = !control && !paired?.results.some(result => result.error !== null);
        items.push({ key, steps: groupable ? 1 : undefined,
          node: control ? <details className="process-details"><summary>过程详情</summary>{card}</details> : card });
      }
    }
    if (!items.length && !attachments.length) return { node: null };
    const isMessage = hasText || attachments.length > 0;
    const steps = !isMessage && items.every(item => item.steps) ? items.length : undefined;
    return { steps, node: <article className={`message ${isMessage ? `message--${message.role}` : 'message--activity'}`} data-message-id={message.id}
      aria-label={message.role === 'user' ? '你的消息' : hasText && message.role === 'assistant' ? `${assistantName}的回复` : '过程记录'}>
      {isMessage && message.role === 'user' && <strong className="message-avatar" aria-hidden="true">你</strong>}
      <div className="message-content">
        {attachments.length > 0 && <ul className="message-attachments" aria-label="已发送的附件">
          {attachments.map(file => <li key={file.resource_id} className="message-attachment">
            <FileText size={14} aria-hidden="true" /><span>{file.name}</span>
          </li>)}
        </ul>}
        {steps ? items.map(({ key, node }) => <Fragment key={key}>{node}</Fragment>) : renderReadingOrder(items)}
      </div>
    </article> };
  }
  const timeline: ReadingItem[] = [];
  for (const message of messages) {
    const visible = renderMessage(message);
    if (visible.node) timeline.push({ key: message.id, runId: message.run_id, ...visible });
    const run = runsById.get(message.run_id);
    if (tailAnchors.get(message.run_id) === message.id) {
      const node = run ? renderRunTail(run) : renderContextNotice(message.run_id);
      if (node) timeline.push({ key: `tail:${message.run_id}`, node });
    }
  }
  return <>{renderReadingOrder(timeline)}{runs.filter(run => !tailAnchors.has(run.id)).map(renderRunTail)}</>;
}
