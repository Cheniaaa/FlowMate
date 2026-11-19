import { useRef, useState } from 'react';
import type { Approval } from '../../generated/contracts';
import Button from '../../components/Button';
import McpIdentity from '../authorization/McpIdentity';

export default function ApprovalCard({ approval, busy, onDecision }: { approval: Approval; busy: boolean; onDecision: (allow: boolean) => Promise<void> }) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  async function decide(allow: boolean) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true);
    try { await onDecision(allow); } finally { inFlight.current = false; setPending(false); }
  }
  return <article className="approval-card"><header><span className="eyebrow">需要你的确认</span><h3>待审批：{approval.mcp?.original_name ?? approval.tool_name} · {approval.tool_version}</h3></header>
    {approval.mcp && <><McpIdentity value={approval.mcp} /><p>审批不会创建资料发送授权；只确认以下实际参数的本次调用。</p></>}
    <div className="interaction-body">{approval.export_preview ? <>
      <p>目标：<strong>{approval.export_preview.target_path}</strong></p>
      <p><strong>{approval.export_preview.target_exists ? '覆盖已核验的现有文件' : '创建新文件'}</strong> · <span>产物版本：{approval.export_preview.artifact_version}</span></p>
    </> : <p>目标：{approval.target}</p>}
      <p>仅允许对这个目标执行本次操作；有效期：{approval.expires_at}</p><details><summary>操作参数</summary><pre>{JSON.stringify(approval.parameters, null, 2)}</pre></details></div>
    <div className="button-row interaction-footer"><Button disabled={busy || pending} onClick={() => void decide(false)}>拒绝本次操作</Button>
      <Button className="button--primary" disabled={busy || pending} onClick={() => void decide(true)}>允许本次操作</Button></div>
  </article>;
}
