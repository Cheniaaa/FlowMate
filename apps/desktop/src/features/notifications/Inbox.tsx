import type { Approval, InboxPage, PendingAction, Question, RunSnapshot } from '../../generated/contracts';
import Status from '../../components/Status';

export interface InboxProps {
  questions: Question[];
  approvals: Approval[];
  runs: RunSnapshot[];
  onSelect: (runId: string) => void;
}

export function PendingActionList({ items, workspaceNames = {}, onOpen, onAction, busy = false }: {
  items: InboxPage['items']; onOpen: (item: InboxPage['items'][number]) => void;
  workspaceNames?: Readonly<Record<string, string>>;
  onAction: (item: PendingAction, action: PendingAction['allowed_actions'][number]) => void; busy?: boolean;
}) {
  const labels = { view_task: '查看任务', resume: '恢复本任务中的条件等待', cancel_run: '停止此任务', retry_delivery: '重新投递', inspect_export_recovery: '核对导出恢复' };
  return <section aria-label="待我处理">{!items.length && <p>暂无待处理事项</p>}{items.map(item => <article className="pending-action" key={`${item.kind}:${item.id}`}>
    <dl className="pending-action-owner">
      <div><dt>项目</dt><dd><span>{workspaceNames[item.workspace_id] ?? '项目名称未加载'}</span><code>{item.workspace_id}</code></dd></div>
      <div><dt>Task</dt><dd><code>{item.kind === 'question' ? item.question.task_id : item.kind === 'approval' ? item.approval.task_id : item.task_id}</code></dd></div>
    </dl>
    {item.kind === 'question' ? <button onClick={() => onOpen(item)}>{item.question.question}</button>
      : item.kind === 'approval' ? <button onClick={() => onOpen(item)}>审批：{item.approval.export_preview?.target_path ?? item.approval.tool_name}</button>
        : <><p>{{ recovery: '恢复核对', blocked: '授权或限额阻塞', delivery_failed: '投递失败' }[item.kind]} · {item.reason}</p>
          {item.allowed_actions.some(action => action.kind === 'resume') && <p className="muted">继续操作会重新核查并恢复该 Run 内符合条件的等待成员；不会自动回答问题或改动活跃成员。</p>}
          {item.allowed_actions.map(action => <button key={action.kind} disabled={busy} onClick={() => onAction(item, action)}>{labels[action.kind]}</button>)}</>}
  </article>)}</section>;
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
