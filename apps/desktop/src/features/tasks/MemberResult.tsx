import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import type { RuntimeClient } from '../../api/client';
import type { AgentResult, ArtifactRef, MemberLane } from '../../generated/contracts';
import { validate } from '../../api/validation';
import { windowError } from '../../api/windows';
import AgentResultView from './AgentResultView';
import ArtifactPanel from '../artifacts/ArtifactPanel';
import { describeArtifacts } from '../artifacts/artifact-presentation';

export default function MemberResult({ client, lane, onExport, exportBlocked, onOpenEvidence }: {
  client: RuntimeClient; lane: MemberLane; onExport?: (artifact: ArtifactRef) => Promise<void>; exportBlocked?: boolean;
  onOpenEvidence?: (id: string) => void;
}) {
  const [result, setResult] = useState<AgentResult>(), [error, setError] = useState('');
  const [artifacts, setArtifacts] = useState<ArtifactRef[]>([]), [artifactId, setArtifactId] = useState('');
  useEffect(() => {
    let ignore = false;
    client.taskResult(lane.task.id).then(value => {
      if (!ignore) {
        if (value.handle.task_id !== lane.task.id || value.handle.run_id !== lane.task.run_id || value.result_version !== lane.task.result_version) {
          setError('交付版本已变化，请刷新任务后重试。');
          return;
        }
        if (value.result === null) setError(`无明确成员交付 · ${value.state} · ${value.error ?? '无错误说明'}`);
        else { setResult(validate('AgentResult', value.result)); setArtifacts(value.artifacts); }
      }
    }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, lane.task.id, lane.task.run_id, lane.task.result_version]);
  const files = describeArtifacts(artifacts, lane.activities);
  const selected = files.find(({ artifact }) => artifact.id === artifactId);
  return <section aria-label="成员结果预览">{error && <p role="alert">{error}</p>}{result ? <AgentResultView result={result} onOpenEvidence={onOpenEvidence} /> : !error && <p>正在读取已提交成员交付…</p>}
    {files.map(({ artifact, label }) => <Button type="button" size="sm" variant={artifact.id === artifactId ? 'secondary' : 'ghost'}
      className="whitespace-normal text-left" key={artifact.id} aria-pressed={artifact.id === artifactId} onClick={() => setArtifactId(artifact.id)}>{label}</Button>)}
    {selected && <ArtifactPanel client={client} artifact={selected.artifact} label={selected.label} onExport={onExport} exportBlocked={exportBlocked} />}
    <p className="muted">用户查看不等于模型消费。</p></section>;
}
