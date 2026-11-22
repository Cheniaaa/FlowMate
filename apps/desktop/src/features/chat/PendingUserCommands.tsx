import type { PendingUserCommand, RunSnapshot } from '../../generated/contracts';
import Status from '../../components/Status';
import { Button } from '../../components/ui/button';

export default function PendingUserCommands({ commands, runs, onOpen }: {
  commands: PendingUserCommand[]; runs: Record<string, RunSnapshot>; onOpen: (id: string) => void;
}) {
  if (!commands.length) return null;
  return <section aria-label="排队输入"><h2>用户输入队列</h2>
    {[...commands].sort((left, right) => left.created_seq - right.created_seq).map(command => <article key={command.command_id}>
      <p>{command.start.text}</p>
      <p>{command.state === 'queued' ? '已排队，输入已保存，尚未开始执行'
        : command.state === 'applied' ? '输入已应用，已创建独立用户任务' : `输入已取消：${command.reason}`}</p>
      {command.run_id && <div className="button-row">{runs[command.run_id] && <Status state={runs[command.run_id].state} />}
        <Button type="button" size="sm" variant="ghost" onClick={() => onOpen(command.run_id!)}>查看输入任务</Button></div>}
      <details><summary>查看本次输入配置</summary>
        <p>模型：{command.config.model_profile.model_id} · 截止：{command.deadline_at}</p>
        <p>后台许可：{command.start.allow_managed ? '允许' : '未允许'} · 自动总结许可：{command.start.allow_follow_up ? '允许' : '未允许'}</p>
        <p>已选资料 {command.start.sources.resource_ids.length} · 模型请求上限 {command.start.limits.max_model_requests}</p>
      </details>
    </article>)}
  </section>;
}
