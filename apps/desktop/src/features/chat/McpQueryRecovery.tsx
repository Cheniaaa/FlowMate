import { useEffect, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import type { PendingAction, RunSnapshot } from '../../generated/contracts';
import { Button } from '../../components/ui/button';

export const queryUncertain = 'mcp_query_uncertain';
export const queryCanBeSentAgain = 'mcp_query_uncertain_retry_available';

export default function McpQueryRecovery({ client, run, tool, revision, busy, onResume, onInspect }: {
  client: RuntimeClient; run: RunSnapshot; tool?: string; revision: string; busy: boolean;
  onResume: (version: number, retryReadonly?: boolean) => void; onInspect: () => void;
}) {
  const [item, setItem] = useState<PendingAction>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setFailed(false);
    // 同版本在后台复查时保留已确认的按钮，避免事件刷新打断正在进行的点击。
    client.inbox({ run_id: run.id }).then(page => {
      if (current) setItem(page.items.find((entry): entry is PendingAction => entry.kind === 'recovery' && entry.id === run.id));
    }).catch(() => {
      if (current) {
        setItem(undefined);
        setFailed(true);
      }
    });
    return () => { current = false; };
  }, [client, run.id, run.version, revision]);
  const resume = item?.allowed_actions.find(action => action.kind === 'resume'
    && action.target_id === run.id && action.expected_version === run.version);
  return <section className="interaction-panel" aria-label="查询恢复">
    <div className="interaction-body">
      <p>{tool && <strong>{tool} · </strong>}查询已发送，未收到结果。原查询不会自动重复。</p>
      {failed && <p role="status">暂时无法核对可用操作。</p>}
    </div>
    <footer className="interaction-footer">
      {resume && <Button type="button" size="sm" variant="default" disabled={busy} onClick={() => onResume(run.version)}>按已有材料继续</Button>}
      {resume && item?.reason === queryCanBeSentAgain && <Button type="button" size="sm" variant="outline" disabled={busy}
        onClick={() => onResume(run.version, true)}>另发一次只读查询</Button>}
      <Button type="button" size="sm" variant="ghost" onClick={onInspect}>查看任务</Button>
    </footer>
  </section>;
}
