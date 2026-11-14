import type { ModelMessage } from '../../generated/contracts';
import Markdown from '../../components/Markdown';
import ToolCard from './ToolCard';

type ToolResult = Extract<ModelMessage['parts'][number], { kind: 'tool_result' }>;
const controls = new Set(['run.finish', 'user.ask', 'task.submit', 'task.await', 'task.status', 'task.result', 'task.cancel']);

export default function MessageList({ messages, assistantName }: { messages: ModelMessage[]; assistantName: string }) {
  // 先建立完整的已加载调用索引；结果到达顺序及 Activity/Task 均不是配对依据。
  const callResults = new Map<string, Map<string, ToolResult[]>>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const calls = message.parts.filter(part => part.kind === 'tool_call');
    if (calls.length) callResults.set(message.id, new Map(calls.map(call => [call.call_id, []])));
  }
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.kind === 'tool_result' && part.origin_message_id !== null) callResults.get(part.origin_message_id)?.get(part.call_id)?.push(part);
    }
  }
  return <>{messages.map(message => {
    const publicParts = message.parts.filter(part => part.kind === 'text' || part.kind === 'reasoning');
    const calls = message.parts.filter(part => part.kind === 'tool_call');
    const orphanResults = message.parts.filter(part => part.kind === 'tool_result').filter(part => part.origin_message_id === null || !callResults.get(part.origin_message_id)?.has(part.call_id));
    const controlCalls = calls.filter(part => controls.has(part.name));
    if (!publicParts.length && !calls.length && !orphanResults.length) return null;
    return <article className={`message message--${message.role}`} key={message.id} data-message-id={message.id}>
      <strong className="message-avatar" aria-hidden="true">{message.role === 'user' ? '你' : message.role === 'assistant' ? '✦' : '⚒'}</strong>
      <div className="message-content">{message.role === 'assistant' && <strong className="message-author">{assistantName}</strong>}{publicParts.map((part, index) => part.kind === 'text' ? <Markdown key={index}>{part.text}</Markdown> : <details className="reasoning" key={index}><summary>推理 · 已提交</summary><Markdown>{part.text}</Markdown></details>)}
        {calls.filter(part => !controls.has(part.name)).map((part, index) => <ToolCard key={`${message.id}:${part.call_id}:${index}`} part={part} results={callResults.get(message.id)?.get(part.call_id)} />)}
        {orphanResults.map((part, index) => <ToolCard key={`result:${part.call_id}:${index}`} part={part} />)}
        {controlCalls.length > 0 && <details className="process-details"><summary>过程详情</summary>{controlCalls.map((part, index) => <ToolCard key={`${message.id}:${part.call_id}:${index}`} part={part} results={callResults.get(message.id)?.get(part.call_id)} />)}</details>}
      </div>
    </article>;
  })}</>;
}
