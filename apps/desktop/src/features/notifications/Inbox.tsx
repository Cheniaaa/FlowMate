import type { Approval, Question, RunSnapshot } from '../../generated/contracts';
import Status from '../../components/Status';

export interface InboxProps {
  questions: Question[];
  approvals: Approval[];
  runs: RunSnapshot[];
  onSelect: (runId: string) => void;
}

export function Inbox({ questions, approvals, runs, onSelect }: InboxProps) {
  const pendingQuestions = questions.filter(question => question.status === 'pending');
  const pendingApprovals = approvals.filter(approval => approval.status === 'pending');
  const runIds = [...new Set([...pendingQuestions.map(question => question.run_id), ...pendingApprovals.map(approval => approval.run_id)])].sort();
  const runById = new Map(runs.map(run => [run.id, run]));
  return <section className="inbox" aria-label="持久待办">
    <h2>待处理（{pendingQuestions.length + pendingApprovals.length}）</h2>
    {runIds.length === 0 ? <p>暂无待处理事项</p> : <ul className="inbox-runs">
      {runIds.map(runId => <li key={runId}>
        <button type="button" aria-label={`定位运行 ${runId}`} disabled={!runById.has(runId)} onClick={() => onSelect(runId)}>
          <span>{pendingQuestions.some(question => question.run_id === runId) ? '回答任务问题' : '确认导出操作'}</span>
          <span>待回答 {pendingQuestions.filter(question => question.run_id === runId).length} · 待审批 {pendingApprovals.filter(approval => approval.run_id === runId).length}</span>
          {runById.has(runId) && <Status state={runById.get(runId)!.state} />}
        </button>
      </li>)}
    </ul>}
  </section>;
}
