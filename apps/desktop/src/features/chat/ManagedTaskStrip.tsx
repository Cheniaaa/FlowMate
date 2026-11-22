import type { FollowUpIntent, RunSnapshot } from '../../generated/contracts';
import { terminal } from '../../api/events';
import Status from '../../components/Status';
import IconButton from '../../components/IconButton';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';

export default function ManagedTaskStrip({ runs, intents = [], onOpen, onStop, onQuestion, busy = false }: {
  runs: RunSnapshot[]; onOpen: (id: string) => void; onStop: (run: RunSnapshot) => void;
  onQuestion?: (id: string) => void; busy?: boolean; intents?: FollowUpIntent[];
}) {
  return <>{runs.filter(run => run.kind === 'managed').map(run => {
    const question = run.state === 'waiting_user' && onQuestion;
    const notice = run.state === 'completed' ? null : run.reason;
    return <section key={run.id} className="managed-task" aria-label="后台任务条">
      <div className="managed-task-heading"><span aria-hidden="true">◇</span><strong>独立后台任务</strong><Status state={run.state} />
        <Button size="xs" variant="link" onClick={() => onOpen(run.id)}>查看后台任务</Button>
        {!terminal(run.state) && <DropdownMenu>
          <DropdownMenuTrigger asChild><IconButton icon="more" size="icon-sm" label="后台任务更多操作" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={busy} variant="destructive" onSelect={() => onStop(run)}>停止该后台</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      {(notice || question) && <div className="managed-task-body">
        {notice && <p>{notice}</p>}
        {question && <Button size="sm" variant="outline" onClick={() => question(run.id)}>回答后台问题</Button>}
      </div>}
    </section>;
  })}
    {runs.filter(run => run.kind === 'follow_up').map(run => {
      const intent = intents.find(intent => intent.run_id === run.id);
      const yielded = run.state === 'interrupted' && run.reason === 'yield_to_user';
      return <section key={run.id} className="managed-task" aria-label="自动总结条">
        <div className="managed-task-heading"><strong>自动总结</strong><Status state={run.state} />
          <Button size="xs" variant="link" onClick={() => onOpen(run.id)}>查看自动总结</Button>
          {!terminal(run.state) && !run.follow_up_closed && <Button size="xs" variant="ghost" disabled={busy} onClick={() => onStop(run)}>停止自动总结</Button>}
        </div>
        {run.state !== 'completed' && <p className="managed-task-note">{run.yield_requested && !yielded && !terminal(run.state) ? '正在让出，等待安全边界'
          : run.follow_up_closed || intent?.status === 'closed' ? '自动总结已关闭'
          : yielded ? '已让出，等待会话空闲后继续原总结'
          : run.state === 'interrupted' || run.state === 'blocked_incompatible' || intent?.status === 'paused' ? '自动总结已暂停，请核对待办'
          : run.state === 'waiting_user' ? '自动总结等待回答'
          : run.state === 'waiting_approval' ? '自动总结等待审批'
          : run.state === 'waiting_children' ? '自动总结等待子任务'
          : terminal(run.state) ? '自动总结执行已结束' : '正在自动总结'}</p>}
        {intent?.reason && <p className="managed-task-note">{intent.reason}</p>}
      </section>;
    })}
    {intents.filter(intent => !intent.run_id || !runs.some(run => run.id === intent.run_id)).map(intent => <section key={intent.id} className="managed-task" aria-label="自动总结意图">
      <div className="managed-task-heading"><strong>自动总结</strong>
        <span>{({ ready: '等待自动总结', active: '自动总结运行待同步', paused: '自动总结已暂停', closed: '自动总结已关闭' })[intent.status]}</span>
      </div>
      {intent.reason && <p className="managed-task-note">{intent.reason}</p>}
    </section>)}
  </>;
}
