import type { AgentResult } from '../../generated/contracts';
import Markdown from '../../components/Markdown';

export default function AgentResultView({ result, onOpenEvidence }: { result: AgentResult; onOpenEvidence?: (id: string) => void }) {
  return <section className="my-4 border-s-3 border-primary px-3.5 py-3.5 wrap-anywhere" aria-label="成员交付">
    <h3>{{ completed: '成员交付已完成', partial: '部分交付', failed: '成员交付失败' }[result.status]}</h3>
    {result.status === 'partial' && <p>这只是成员的部分交付，不代表父任务目标已完成。</p>}
    <Markdown citations={result.citations} onOpenEvidence={onOpenEvidence}>{result.summary}</Markdown>
    {result.structured_result !== null && <><h4>结构化结果</h4><pre>{JSON.stringify(result.structured_result, null, 2)}</pre></>}
    {result.unresolved.length > 0 && <><h4>未完成项</h4><ul>{result.unresolved.map((text, index) => <li key={index}>{text}</li>)}</ul></>}
    {result.artifact_ids.length > 0 && <p>交付产物 {result.artifact_ids.length} 项</p>}
    {result.evidence_refs.length > 0 && <p>证据引用 {result.evidence_refs.length} 项</p>}
    {result.verification.length > 0 && <details><summary>成员验证声明（不等同已执行工具事实）</summary><ul>{result.verification.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}
    {result.handled_failures.length > 0 && <details><summary>失败处理决定</summary><ul>
      {result.handled_failures.map(item => <li key={`${item.task_id}:${item.result_version}`}>{item.reason}</li>)}
    </ul></details>}
  </section>;
}
