import type { ActivityView } from '../../generated/contracts';
import { Button } from '../../components/ui/button';

const termination = { exited: '进程已退出', cancelled: '进程已取消', timed_out: '执行超时' };

export default function ScriptActivity({ activity, onArtifact }: { activity: ActivityView; onArtifact?: (id: string) => void }) {
  if (activity.operation !== 'skills.run_script') return null;
  const summary = activity.script_execution;
  return <div aria-label="脚本执行结果">
    <p>{activity.state === 'dispatched' ? '脚本运行中' : activity.state === 'uncertain' ? '脚本结果待核对，不自动重试'
      : activity.state === 'prepared' ? '脚本待审批与派发' : summary?.collection_error ? '进程已执行，产物采集失败'
      : activity.state === 'failed' ? '脚本执行失败' : '脚本执行完成'}</p>
    {activity.error && <p>{activity.error}</p>}
    {summary && <>
      <p><code>{summary.script_relative_path}</code></p>
      <p>退出码 {summary.exit_code ?? '未知'} · {termination[summary.termination_reason]} · 外部费用未知</p>
      {summary.truncated && <p>进程日志已截断</p>}
      {summary.outputs.length > 0 && <ul>{summary.outputs.map(entry => <li key={entry.artifact.id}>
        {onArtifact ? <Button type="button" size="sm" variant="link" className="h-auto whitespace-normal break-all text-left" onClick={() => onArtifact(entry.artifact.id)}>{entry.relative_path}</Button>
          : <code>{entry.relative_path}</code>}
      </li>)}</ul>}
    </>}
  </div>;
}
