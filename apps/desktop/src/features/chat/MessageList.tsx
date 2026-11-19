import type { ModelMessage } from '../../generated/contracts';
import Markdown from '../../components/Markdown';
import ToolCard from './ToolCard';
import type { RuntimeClient } from '../../api/client';
import type { RuntimeStore } from '../../state/runtime-store';
import MemoryReview from '../memory/MemoryReview';

type ToolResult = Extract<ModelMessage['parts'][number], { kind: 'tool_result' }>;
type ToolCall = Extract<ModelMessage['parts'][number], { kind: 'tool_call' }>;
const controls = new Set(['run.finish', 'user.ask', 'task.submit', 'task.await', 'task.status', 'task.result', 'task.cancel', 'memory.propose']);

export default function MessageList({ messages, assistantName, onOpenResults, client, store }: {
  messages: ModelMessage[]; assistantName: string; onOpenResults?: () => void; client?: RuntimeClient; store?: RuntimeStore;
}) {
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
    return <article className={`message message--${message.role}`} key={message.id} data-message-id={message.id}>
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
      </div>
    </article>;
  })}</>;
}
