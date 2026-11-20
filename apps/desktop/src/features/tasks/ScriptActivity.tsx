import type { ActivityView } from '../../generated/contracts';

export default function ScriptActivity({ activity, onArtifact }: { activity: ActivityView; onArtifact?: (id: string) => void }) {
  if (activity.operation !== 'skills.run_script') return null;
  const summary = activity.script_execution;
  return <div aria-label="脚本执行结果">
    <p>{activity.state === 'dispatched' ? '脚本运行中' : activity.state === 'uncertain' ? '脚本结果待核对，不自动重试'
      : activity.state === 'prepared' ? '脚本待审批与派发' : summary?.collection_error ? '进程已执行，产物采集失败'
      : activity.state === 'failed' ? '脚本执行失败' : '脚本执行完成'}</p>
    {activity.error && <p>{activity.error}</p>}
    {summary && <>
      <p><code>{summary.script_relative_path}</code> · 版本 {summary.content_hash.slice(0, 12)}</p>
      <p>环境 {summary.environment_id} · 修订 {summary.environment_revision}</p>
      <p>退出码 {summary.exit_code ?? '未知'} · {summary.termination_reason} · 外部费用未知</p>
      {summary.truncated && <p>进程日志已截断</p>}
      <ul>{summary.outputs.map(entry => <li key={entry.relative_path}>
        {onArtifact ? <button onClick={() => onArtifact(entry.artifact.id)}>{entry.relative_path}</button>
          : <code>{entry.relative_path}</code>}
        {' → '}产物 <code>{entry.artifact.id}</code>
      </li>)}</ul>
    </>}
  </div>;
}
