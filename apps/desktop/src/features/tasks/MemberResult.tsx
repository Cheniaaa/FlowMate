import { useEffect, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import type { AgentResult, ArtifactRef, MemberLane } from '../../generated/contracts';
import { validate } from '../../api/validation';
import { windowError } from '../../api/windows';
import AgentResultView from './AgentResultView';
import ArtifactPanel from '../artifacts/ArtifactPanel';

export default function MemberResult({ client, lane, onExport, exportBlocked }: { client: RuntimeClient; lane: MemberLane; onExport?: (artifact: ArtifactRef) => Promise<void>; exportBlocked?: boolean }) {
  const [result, setResult] = useState<AgentResult>(), [error, setError] = useState('');
  const [artifacts, setArtifacts] = useState<ArtifactRef[]>([]), [artifactId, setArtifactId] = useState('');
  useEffect(() => {
    let ignore = false;
    client.taskResult(lane.task.id).then(value => {
      if (!ignore) {
        if (value.result === null) setError(`无明确成员交付 · ${value.state} · ${value.error ?? '无错误说明'}`);
        else { setResult(validate('AgentResult', value.result)); setArtifacts(value.artifacts); }
      }
    }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, lane.task.id, lane.task.result_version]);
  return <section aria-label="成员结果预览">{error && <p role="alert">{error}</p>}{result ? <AgentResultView result={result} /> : !error && <p>正在读取已提交成员交付…</p>}
    {artifacts.map((artifact, index) => <button key={artifact.id} onClick={() => setArtifactId(artifact.id)}>预览成员交付产物 {index + 1}</button>)}
    {artifactId && <ArtifactPanel client={client} artifact={artifacts.find(artifact => artifact.id === artifactId) ?? null} onExport={onExport} exportBlocked={exportBlocked} />}
    <p className="muted">用户查看不等于模型消费。</p></section>;
}
