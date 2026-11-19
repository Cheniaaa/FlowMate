import type { FollowUpIntent, RunSnapshot } from '../../generated/contracts';
import { terminal } from '../../api/events';
import Status from '../../components/Status';

export default function ManagedTaskStrip({ runs, intents = [], onOpen, onStop, onQuestion, busy = false }: {
  runs: RunSnapshot[]; onOpen: (id: string) => void; onStop: (run: RunSnapshot) => void;
  onQuestion?: (id: string) => void; busy?: boolean; intents?: FollowUpIntent[];
}) {
  return <>{runs.filter(run => run.kind === 'managed').map(run => {
    const expanded = terminal(run.state) || ['waiting_user', 'waiting_approval', 'interrupted', 'blocked_incompatible'].includes(run.state);
    return <section key={run.id} className={`managed-task ${expanded ? 'managed-task--expanded' : ''}`} aria-label="后台任务条">
      <div className="managed-task-heading"><span aria-hidden="true">◇</span><strong>独立后台任务</strong><Status state={run.state} />
        <button onClick={() => onOpen(run.id)}>查看后台任务</button>
        {!terminal(run.state) && <details className="managed-task-menu"><summary aria-label="后台任务更多操作">⋯</summary><button disabled={busy} onClick={() => onStop(run)}>停止该后台</button></details>}
      </div>
      {expanded && <div className="managed-task-body">
        {run.reason && <p>{run.reason}</p>}
        {run.state === 'waiting_user' && onQuestion && <button onClick={() => onQuestion(run.id)}>回答后台问题</button>}
        <p className="muted">{terminal(run.state) ? '执行已结束；投递、查看与模型消费分别记录在结果收件箱。' : '当前对话可以继续；此任务独立等待处理。'}</p>
      </div>}
    </section>;
  })}
    {runs.filter(run => run.kind === 'follow_up').map(run => {
      const intent = intents.find(intent => intent.run_id === run.id);
      const yielded = run.state === 'interrupted' && run.reason === 'yield_to_user';
      return <section key={run.id} className="managed-task managed-task--expanded" aria-label="自动总结条">
        <div className="managed-task-heading"><strong>自动总结</strong><Status state={run.state} />
          <button onClick={() => onOpen(run.id)}>查看自动总结</button>
          {!terminal(run.state) && !run.follow_up_closed && <button disabled={busy} onClick={() => onStop(run)}>停止自动总结</button>}
        </div>
        <p>{run.yield_requested && !yielded && !terminal(run.state) ? '正在让出，等待安全边界'
          : run.follow_up_closed || intent?.status === 'closed' ? '自动总结已关闭'
          : yielded ? '已让出，等待会话空闲后继续原总结'
          : run.state === 'interrupted' || run.state === 'blocked_incompatible' || intent?.status === 'paused' ? '自动总结已暂停，请核对待办'
          : run.state === 'waiting_user' ? '自动总结等待回答'
          : run.state === 'waiting_approval' ? '自动总结等待审批'
          : run.state === 'waiting_children' ? '自动总结等待子任务'
          : terminal(run.state) ? '自动总结执行已结束' : '正在自动总结'}</p>
        {intent?.reason && <p>{intent.reason}</p>}
      </section>;
    })}
    {intents.filter(intent => !intent.run_id || !runs.some(run => run.id === intent.run_id)).map(intent => <section key={intent.id} className="managed-task" aria-label="自动总结意图">
      <strong>自动总结</strong><p>{({ ready: '等待自动总结', active: '自动总结运行待同步', paused: '自动总结已暂停', closed: '自动总结已关闭' })[intent.status]}</p>
      {intent.reason && <p>{intent.reason}</p>}
    </section>)}
  </>;
}
