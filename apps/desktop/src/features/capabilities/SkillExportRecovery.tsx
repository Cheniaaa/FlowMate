import { useRef, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { ScopeRef, SkillExportReceipt } from '../../generated/contracts';
import { skillQuery } from './skill-query';

export default function SkillExportRecovery({ client, scope, receipts, onReceipt, onBusyChange }: {
  client: RuntimeClient; scope: ScopeRef; receipts: SkillExportReceipt[];
  onReceipt: (receipt: SkillExportReceipt) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [releasing, setReleasing] = useState('');
  const pending = useRef(false);
  async function act(action: () => Promise<SkillExportReceipt>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try { onReceipt(await action()); setReleasing(''); }
    catch (error) { setError(windowError(error)); }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <section aria-label="保存记录"><h3>保存记录与恢复</h3>
    <p>删除前请处理所属保存命令，再返回重试删除。恢复只还原原件；完成处置只清理本命令确认所属的临时文件。</p>
    {error && <p role="alert">{error}</p>}
    {receipts.length === 0 && <p>当前范围没有保存记录。</p>}
    {receipts.map(receipt => <article key={receipt.command_id} aria-label={`保存命令 ${receipt.command_id}`}>
      <p>{receipt.state === 'saved' ? `已保存：${receipt.target_path.split(/[\\/]/).at(-1)}` : receipt.state === 'original' ? '原文件完整，未确认保存新版本'
        : receipt.state === 'needs_restore' ? '保存中断，原文件待恢复' : '文件状态冲突，保留现状'}</p>
      <p>命令 {receipt.command_id} · 版本 {receipt.content_hash.slice(0, 12)}</p>
      <p>目标：{receipt.target_path}</p>
      {receipt.cleanup_pending && <><p>暂存：{receipt.stage_path}</p>{receipt.backup_path && <p>备份：{receipt.backup_path}</p>}</>}
      {receipt.reason && <p>{receipt.reason}</p>}
      <button disabled={busy} onClick={() => void act(() => client.skillExport(receipt.command_id, skillQuery(scope)))}>重新核对</button>
      {receipt.disposition !== 'pending' ? <p>{receipt.disposition === 'released'
        ? '已放弃自动恢复；外部文件保留' : '已处置；可返回重试删除'}</p> : <>
        {receipt.state === 'needs_restore' && <button disabled={busy} onClick={() => void act(() => client.restoreSkillExport(receipt.command_id, { scope }))}>恢复原文件</button>}
        {(receipt.state === 'saved' || receipt.state === 'original') && <button disabled={busy} onClick={() => void act(() => client.finalizeSkillExport(receipt.command_id, { scope }))}>完成处置并清理所属临时文件</button>}
        <button disabled={busy} onClick={() => setReleasing(receipt.command_id)}>放弃自动恢复</button>
        {releasing === receipt.command_id && <section aria-label="确认放弃恢复">
          <p>外部目标、暂存和备份都会保留。处置后不再自动恢复；删除所属项目后需自行保管和处理这些文件。</p>
          <button disabled={busy} onClick={() => void act(() => client.releaseSkillExport(receipt.command_id, { scope }))}>确认放弃恢复并保留外部文件</button>
          <button disabled={busy} onClick={() => setReleasing('')}>继续保留恢复入口</button>
        </section>}
      </>}
    </article>)}
  </section>;
}
