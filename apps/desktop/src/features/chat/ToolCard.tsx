import type { ModelMessage } from '../../generated/contracts';
import { knownOperationLabel } from '../tasks/operation-label';
import Markdown from '../../components/Markdown';
import { Button } from '../../components/ui/button';
import ArtifactImage from '../artifacts/ArtifactImage';
import type { RuntimeClient } from '../../api/client';
import SkillExecutionNotice from '../capabilities/SkillExecutionNotice';

type ToolResult = Extract<ModelMessage['parts'][number], { kind: 'tool_result' }>;
function isRequery(value: ToolResult['result']): value is Record<string, ToolResult['result']> & { mcp_requery: true } {
  return value !== null && typeof value === 'object' && 'mcp_requery' in value
    && value.mcp_requery === true;
}
const internalArguments = new Map([
  ['files.list', ['resource_id', 'cursor']],
  ['files.read_text', ['resource_id', 'source_version']],
  ['files.inspect_batch', ['resource_ids']],
  ['resources.read', ['resource_id']],
  ['artifacts.read', ['artifact_id']],
  ['artifacts.export', ['artifact_id', 'artifact_version', 'content_hash', 'target_ref', 'expected_target_hash']],
  ['skills.read', ['skill_id', 'content_hash']],
  ['skills.run_script', ['skill_id', 'content_hash', 'environment_id', 'environment_revision', 'input_refs']],
  ['task.submit', ['sources']],
  ['task.await', ['handle']], ['task.status', ['handle']], ['task.result', ['handle']],
  ['task.cancel', ['handle', 'expected_version']],
]);

export function toolLabel(name: string, label?: string) {
  return label ?? knownOperationLabel(name) ?? (name.startsWith('mcp.') ? 'MCP 工具调用' : name);
}

function ToolContent({ value, client, operation, isMcp }: { value: unknown; client?: RuntimeClient; operation?: string; isMcp: boolean }) {
  if (typeof value === 'string') return <Markdown>{value}</Markdown>;
  if ((operation === 'files.read_text' || operation === 'artifacts.read') && value && typeof value === 'object'
    && 'text' in value && typeof value.text === 'string') return <pre>{value.text}</pre>;
  if (isMcp && value !== null && typeof value === 'object' && 'texts' in value && Array.isArray(value.texts)
    && value.texts.every(text => typeof text === 'string')) {
    // MCP 信封与工具业务内容分开；正文中的编号属于内容，不按 UUID 过滤。
    const ordered = 'content' in value && Array.isArray(value.content) ? value.content : null;
    return <>{ordered ? ordered.map((item: unknown, index: number) => {
      if (!item || typeof item !== 'object' || !('type' in item)) return null;
      if ((item.type === 'text' || item.type === 'notice') && 'text' in item && typeof item.text === 'string')
        return <Markdown key={index}>{item.text}</Markdown>;
      if (item.type === 'image' && 'artifact' in item && item.artifact && typeof item.artifact === 'object'
        && 'id' in item.artifact && typeof item.artifact.id === 'string')
        return client ? <ArtifactImage key={index} id={item.artifact.id} client={client} label={`工具图片 ${index + 1}`} /> : <p key={index}>图片已保存，可在产物中打开。</p>;
      if (item.type === 'resource_link' && 'name' in item) return <p key={index}>资源：{String(item.name)}</p>;
      return null;
    }) : value.texts.map((text, index) => <Markdown key={index}>{text}</Markdown>)}
      {'structured_content' in value && value.structured_content !== null && <pre>{JSON.stringify(value.structured_content, null, 2)}</pre>}</>;
  }
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
export default function ToolCard({ part, results = [], showArguments = true, label, client, sourceOperation, openReceipt, deliveryArtifacts }: {
  part: Extract<ModelMessage['parts'][number], { kind: 'tool_call' | 'tool_result' }>; results?: ToolResult[]; showArguments?: boolean;
  label?: string;
  client?: RuntimeClient;
  sourceOperation?: string;
  openReceipt?: (result: ToolResult, id: string) => void;
  deliveryArtifacts?: ReadonlySet<string>;
}) {
  const returned = part.kind === 'tool_result' ? [part] : results;
  const operation = part.kind === 'tool_call' ? part.name : sourceOperation;
  const mcp = operation?.startsWith('mcp.');
  const canShowRequery = mcp || operation === undefined;
  const failed = returned.some(result => result.error !== null);
  const uncertain = returned.some(result => result.error === 'mcp_call_uncertain');
  const requery = canShowRequery && returned.some(result => isRequery(result.result));
  const state = returned.length === 0 ? '结果未加载' : requery
    ? `原查询结果未确认 · 另发查询${uncertain ? '结果未确认' : failed ? '未完成' : '已返回'}`
    : uncertain ? '结果未确认' : failed ? '未完成' : '已返回';
  const title = part.kind === 'tool_call' ? (
    label || knownOperationLabel(part.name) || part.name.startsWith('mcp.') ? toolLabel(part.name, label) : <code>{part.name}</code>
  ) : part.origin_message_id === null ? '工具结果 · 无来源关联' : '工具结果 · 源调用未加载';
  const input = part.kind === 'tool_call' && showArguments ? part.arguments : null;
  const hidden = operation ? internalArguments.get(operation) : undefined;
  const argumentsForDisplay = input && typeof input === 'object' && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input).filter(([key]) => !hidden?.includes(key)))
    : input;
  const hasArguments = typeof argumentsForDisplay === 'string' ? !!argumentsForDisplay.trim()
    : argumentsForDisplay && Object.keys(argumentsForDisplay).length > 0;
  return <details className="tool-card"><summary><span>{title}</span>{' · '}
    <span className={`tool-state${failed ? ' tool-state--failed' : ''}`}>{state}</span></summary>
    {hasArguments && <><p>调用参数</p><pre>{typeof argumentsForDisplay === 'string'
      ? argumentsForDisplay : JSON.stringify(argumentsForDisplay, null, 2)}</pre></>}
    {returned.map((result, index) => {
      const retry = canShowRequery && isRequery(result.result) ? result.result : null;
      if (result.error === 'mcp_call_uncertain') return <p className="tool-result" key={index}>
        {retry ? '原查询和另发查询均未收到结果。' : '查询已发送，未收到结果。'}已选择按已有材料继续。
      </p>;
      const value = retry ? Object.fromEntries(Object.entries(retry).filter(([key]) => key !== 'mcp_requery')) : result.result;
      const noContent = value === null || retry && Object.keys(retry).length === 1;
      const compactable = mcp || retry || operation === 'files.read_text' || operation === 'files.list'
        || operation === 'files.inspect_batch' || operation === 'skills.run_script';
      const receipt = compactable && value && typeof value === 'object' && 'truncated' in value && value.truncated === true
        && ('kind' in value && value.kind === 'artifact_preview'
          || 'artifact_id' in value && typeof value.artifact_id === 'string' && 'total_chars' in value && typeof value.total_chars === 'number')
        ? value : null;
      const links = receipt ? [
        ['artifact_id', '阅读完整回执'],
        ['structured_artifact_id', '查看完整 JSON'],
      ].flatMap(([key, text]) => {
        const id = receipt[key];
        return typeof id === 'string' && !deliveryArtifacts?.has(id) ? [{ id, text }] : [];
      }) : [];
      return <div className="tool-result" key={index}>
        {retry && <p>原查询未收到结果。下方记录属于另发查询。</p>}
        {result.error !== null && <SkillExecutionNotice error={result.error} />}
        {noContent ? null : receipt && !('texts' in receipt) ? ('preview' in receipt && typeof receipt.preview === 'string' && <pre>{receipt.preview}</pre>)
          : <ToolContent value={value} client={client} operation={operation} isMcp={!!(mcp || retry)} />}
        {openReceipt && links.map(({ id, text }) =>
          <Button key={id} type="button" size="sm" variant="outline" onClick={() => openReceipt(result, id)}>{text}</Button>)}
      </div>;
    })}
  </details>;
}
