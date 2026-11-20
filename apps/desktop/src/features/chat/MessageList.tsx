import type { ModelMessage, RunFeedback, RunSnapshot } from '../../generated/contracts';
import Markdown from '../../components/Markdown';
import ToolCard from './ToolCard';
import type { RuntimeClient } from '../../api/client';
import type { RuntimeStore } from '../../state/runtime-store';
import MemoryReview from '../memory/MemoryReview';

type ToolResult = Extract<ModelMessage['parts'][number], { kind: 'tool_result' }>;
type ToolCall = Extract<ModelMessage['parts'][number], { kind: 'tool_call' }>;
const controls = new Set(['run.finish', 'user.ask', 'task.submit', 'task.await', 'task.status', 'task.result', 'task.cancel', 'memory.propose']);

export const modelFailures: Readonly<Record<string, string>> = {
  credential_missing: '此连接尚未配置密钥。',
  model_authentication_failed: '服务商拒绝了此连接的凭据，请检查密钥和服务地址。',
  model_permission_denied: '此连接没有访问此模型的权限，请检查账号和所选型号。',
  model_timeout: '模型响应超时。',
  model_connection_failed: '无法连接到模型服务。',
  model_rate_limited: '模型服务请求过于频繁，请稍后再试。',
};

export default function MessageList({ messages, assistantName, onOpenResults, client, store, runs = [], feedback = [], onOpenConnection }: {
  messages: ModelMessage[]; assistantName: string; onOpenResults?: () => void; client?: RuntimeClient; store?: RuntimeStore;
  runs?: RunSnapshot[]; onOpenConnection?: (id: string) => void;
  feedback?: RunFeedback[];
}) {
  const lastInput = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'user' && message.origin === 'conversation') lastInput.set(message.run_id, message.id);
  }
  const failedInputs = new Map<string, { description: string; connectionId: string }>();
  const facts = new Map<string, Pick<RunFeedback, 'run_id' | 'state' | 'reason' | 'connection_id' | 'model_activity'>>(runs.map(run => [run.id, {
    run_id: run.id, state: run.state, reason: run.reason, connection_id: run.config.model_profile.connection_id,
    model_activity: null,
  }]));
  for (const item of feedback) facts.set(item.run_id, item);
  for (const fact of facts.values()) {
    const receipt = fact.model_activity;
    const error = receipt?.error ?? fact.reason;
    const previousRejection = receipt?.state === 'uncertain' && receipt.error === 'model_authentication_failed';
    const description = previousRejection ? '服务商拒绝了此前的请求，请检查密钥和模型访问权限。'
      : error && Object.hasOwn(modelFailures, error) && modelFailures[error];
    const inputId = lastInput.get(fact.run_id);
    if (inputId && description) {
      failedInputs.set(inputId, { description, connectionId: fact.connection_id });
    }
  }
  // 先建立完整的已加载调用索引；结果到达顺序及 Activity/Task 均不是配对依据。
  const callResults = new Map<string, Map<string, { call: ToolCall; origin: ModelMessage['origin']; results: ToolResult[]; receipt?: { id: string; messageId: string } }>>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const calls = message.parts.filter(part => part.kind === 'tool_call');
    if (calls.length) callResults.set(message.id, new Map(calls.map(call => [call.call_id, { call, origin: message.origin, results: [] }])));
  }
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.kind === 'tool_result' && part.origin_message_id !== null) {
        const paired = callResults.get(part.origin_message_id)?.get(part.call_id);
        paired?.results.push(part);
        const receipt = part.result;
        // 只取真实配对的成功回执身份；正文/范围/revision始终从当前Memory API读取。
        if (paired?.call.name === 'memory.propose' && paired.origin === 'conversation' && message.role === 'tool' && message.origin === 'conversation' && part.error === null
          && typeof receipt === 'object' && receipt !== null && 'id' in receipt && typeof receipt.id === 'string'
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(receipt.id)
          && 'revision' in receipt && Number.isSafeInteger(receipt.revision) && Number(receipt.revision) > 0
          && 'status' in receipt && receipt.status === 'candidate') {
          paired.receipt = { id: receipt.id, messageId: message.id };
        }
      }
    }
  }
  return <>{messages.map(message => {
    // origin标识任务交付；模型上下文中的user角色不代表用户原话。
    if (message.origin === 'task_result') return <article className="message message--task-result" key={message.id} data-message-id={message.id} aria-label="任务交付引用">
      <strong className="message-avatar" aria-hidden="true">◇</strong>
      <div className="message-content"><p className="muted">已接收任务交付，供助理处理。</p>
        {onOpenResults && <button type="button" onClick={onOpenResults}>打开结果收件箱</button>}
      </div>
    </article>;
    const publicParts = message.parts.filter(part => part.kind === 'text' || part.kind === 'reasoning');
    const calls = message.parts.filter(part => part.kind === 'tool_call');
    const orphanResults = message.parts.filter(part => part.kind === 'tool_result').filter(part => part.origin_message_id === null || !callResults.get(part.origin_message_id)?.has(part.call_id));
    const controlCalls = calls.filter(part => controls.has(part.name));
    if (!publicParts.length && !calls.length && !orphanResults.length) return null;
    const failure = failedInputs.get(message.id);
    return <article className={`message message--${message.role}`} key={message.id} data-message-id={message.id} aria-label={message.role === 'user' ? '你的消息' : message.role === 'assistant' ? `${assistantName}的回复` : '工具回复'}>
      <strong className="message-avatar" aria-hidden="true">{message.role === 'user' ? '你' : message.role === 'assistant' ? '✦' : '⚒'}</strong>
      <div className="message-content">{message.role === 'assistant' && <strong className="message-author">{assistantName}</strong>}{publicParts.map((part, index) => part.kind === 'text' ? <Markdown key={index}>{part.text}</Markdown> : <details className="reasoning" key={index}><summary>推理 · 已提交</summary><Markdown>{part.text}</Markdown></details>)}
        {client && store && calls.filter(call => call.name === 'memory.propose').map(call => {
          const receipt = callResults.get(message.id)?.get(call.call_id)?.receipt;
          return receipt ? <MemoryReview key={receipt.id} id={receipt.id} client={client} store={store} receiptMessageId={receipt.messageId} /> : null;
        })}
        {calls.filter(part => !controls.has(part.name)).map((part, index) => <ToolCard key={`${message.id}:${part.call_id}:${index}`} part={part} results={callResults.get(message.id)?.get(part.call_id)?.results} />)}
        {orphanResults.map((part, index) => <ToolCard key={`result:${part.call_id}:${index}`} part={part} />)}
        {controlCalls.length > 0 && <details className="process-details"><summary>过程详情</summary>{controlCalls.map((part, index) => <ToolCard key={`${message.id}:${part.call_id}:${index}`} part={part}
          showArguments={part.name !== 'memory.propose'} results={callResults.get(message.id)?.get(part.call_id)?.results} />)}</details>}
       {failure && <div className="turn-error"><p>{failure.description}</p>
         {onOpenConnection && <button type="button" onClick={() => onOpenConnection(failure.connectionId)}>检查连接</button>}</div>}
       </div>
    </article>;
  })}</>;
}
