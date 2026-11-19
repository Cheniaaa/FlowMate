import type { ModelMessage } from '../../generated/contracts';

type ToolResult = Extract<ModelMessage['parts'][number], { kind: 'tool_result' }>;
export default function ToolCard({ part, results = [], showArguments = true }: {
  part: Extract<ModelMessage['parts'][number], { kind: 'tool_call' | 'tool_result' }>; results?: ToolResult[]; showArguments?: boolean;
}) {
  const returned = part.kind === 'tool_result' ? [part] : results;
  const state = returned.length === 0 ? '结果未加载' : returned.some(result => result.error !== null) ? '未完成' : '已返回';
  const title = part.kind === 'tool_call' ? `工具调用 · ${part.name}` : part.origin_message_id === null ? '工具结果 · 无来源关联' : '工具结果 · 源调用未加载';
  return <details className="tool-card"><summary><span>{title}</span>{' · '}<span className="tool-state">{state}</span></summary>
    <p>调用 ID：<code>{part.call_id}</code></p>
    {part.kind === 'tool_call' && showArguments && <><p>调用参数</p><pre>{JSON.stringify(part.arguments, null, 2)}</pre></>}
    {returned.map((result, index) => <div className="tool-result" key={index}><p>{result.error !== null ? '工具未完成' : '返回结果'}</p><pre>{JSON.stringify(result, null, 2)}</pre></div>)}
  </details>;
}
