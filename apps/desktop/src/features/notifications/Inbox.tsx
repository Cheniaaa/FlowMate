import type { Approval, InboxPage, PendingAction, Question, RunSnapshot } from '../../generated/contracts';
import Status from '../../components/Status';
import { Button } from '../../components/ui/button';

const actionKinds = { recovery: '恢复核对', blocked: '任务受阻', delivery_failed: '投递失败' };
const actionReasons = new Map([
  ['uncertain_activity', '有外部操作的结果尚未核实，请先查看任务记录。'],
  ['context_authorization_required', '请检查本次任务需要的资料及发送授权。'],
  ['grant_required', '请检查本次任务需要的资料及发送授权。'],
  ['scope_revoked', '任务的来源或授权已失效，请检查资料范围。'],
  ['source_scope_changed', '任务用到的资料范围已变更，请查看任务记录。'],
  ['outside_run_scope', '所需资料超出本次任务的授权范围。'],
  ['budget_exceeded', '费用达到本次任务的上限。'],
  ['allocation_exceeded', '任务已用完分配给它的额度。'],
  ['token_limit', '本次任务已达到 Token 上限。'],
  ['request_limit', '本次任务已达到模型请求上限。'],
  ['step_limit', '本次任务已达到执行步骤上限。'],
  ['task_limit', '本次运行已达到任务数量上限。'],
  ['pricing_unknown', '当前无法确认模型费用，请检查模型计价设置。'],
  ['managed_not_authorized', '当前运行没有获准创建后台任务。'],
  ['result_capacity', '结果存储已达上限，请在任务详情查看结果。'],
  ['session_archived', '会话已归档。'],
  ['admission_stopped', '此范围已停止接收新运行。'],
  ['SQLITE_FULL', '存储空间不足，结果暂未投递。'],
  ['SQLITE_READONLY', '结果存储当前无法写入。'],
  ['SQLITE_BUSY', '结果存储正忙，可以尝试重新投递。'],
]);

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
  return <section aria-label="待我处理">{!items.length && <p>暂无待处理事项</p>}{items.map(item => {
    const workspace = item.workspace_name ?? workspaceNames[item.workspace_id];
    const uncertainQuery = 'reason' in item && item.reason.startsWith('mcp_query_uncertain');
    return <article className="pending-action min-w-0 border-b border-border py-3 wrap-anywhere [&>h3]:mb-1 [&>h3]:text-sm [&>p]:mb-2" key={`${item.kind}:${item.id}`}>
    {item.kind === 'question' ? <Button variant="ghost" size="sm" className="-ms-2.5 h-auto justify-start text-start whitespace-normal wrap-anywhere" onClick={() => onOpen(item)}>{item.question.question}</Button>
      : item.kind === 'approval' ? <Button variant="ghost" size="sm" className="-ms-2.5 h-auto justify-start text-start whitespace-normal wrap-anywhere" onClick={() => onOpen(item)}>审批：{item.approval.export_preview?.target_path ?? item.approval.mcp?.original_name ?? item.approval.tool_name}</Button>
      : <h3 className="m-0 font-medium">{actionKinds[item.kind]}</h3>}
    {(workspace || item.session_title || item.task_goal) && <dl className="mt-1 mb-2 text-xs [&>div]:my-1 [&>div]:grid [&>div]:grid-cols-[2.25rem_minmax(0,1fr)] [&>div]:gap-1.5 [&_dt]:text-muted-foreground [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:whitespace-pre-line">
      {workspace && <div><dt>项目</dt><dd>{workspace}</dd></div>}
      {item.session_title && <div><dt>会话</dt><dd>{item.session_title}</dd></div>}
      {item.task_goal && item.task_goal !== item.session_title && <div><dt>任务</dt><dd>{item.task_goal}</dd></div>}
    </dl>}
    {'allowed_actions' in item && <><p>{uncertainQuery
          ? '查询已发送，未收到结果。原查询不会自动重复。'
          : actionReasons.get(item.reason) ?? (item.kind === 'delivery_failed' ? '结果还未送达，可在任务详情查看。' : '请查看任务详情，核对当前状态和可用操作。')}</p>
          {item.allowed_actions.some(action => action.kind === 'resume') && !uncertainQuery && <p className="muted">系统会重新核查并恢复这次运行中符合条件的等待成员。问题仍需手动回答，正在工作的成员会继续。</p>}
          <div className="flex flex-wrap items-center gap-2">{item.allowed_actions.map(action => <Button size="sm" key={action.kind} disabled={busy} onClick={() => onAction(item, action)}>
            {action.kind === 'resume' && uncertainQuery ? '按已有材料继续' : labels[action.kind]}
          </Button>)}</div></>}
    </article>;
  })}</section>;
}

export function Inbox({ questions, approvals, runs, onSelect }: InboxProps) {
  const pendingQuestions = questions.filter(question => question.status === 'pending');
  const pendingApprovals = approvals.filter(approval => approval.status === 'pending');
  const runIds = [...new Set([...pendingQuestions.map(question => question.run_id), ...pendingApprovals.map(approval => approval.run_id)])].sort();
  const runById = new Map(runs.map(run => [run.id, run]));
  return <section className="inbox" aria-label="持久待办">
    <h2>待处理（{pendingQuestions.length + pendingApprovals.length}）</h2>
    {runIds.length === 0 ? <p>暂无待处理事项</p> : <ul className="inbox-runs">
      {runIds.map(runId => {
        const questionsForRun = pendingQuestions.filter(question => question.run_id === runId);
        const approvalsForRun = pendingApprovals.filter(approval => approval.run_id === runId);
        const approval = approvalsForRun[0];
        const subject = questionsForRun[0]?.question ?? approval?.export_preview?.target_path ?? approval?.mcp?.original_name ?? '待审批操作';
        const run = runById.get(runId);
        return <li key={runId}><Button type="button" aria-label={`定位运行：${subject}`} disabled={!run} onClick={() => onSelect(runId)}>
          <span>{subject}</span>
          <span>待回答 {questionsForRun.length} · 待审批 {approvalsForRun.length}</span>
          {run && <Status state={run.state} />}
        </Button>
        </li>;
      })}
    </ul>}
  </section>;
}
