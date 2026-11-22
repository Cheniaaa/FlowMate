import { useEffect, useRef, useState } from 'react';
import { ApiError, type RuntimeClient } from '../../api/client';
import { Button } from '../../components/ui/button';
import type { ScopeRef, SkillExportReceipt } from '../../generated/contracts';
import { skillQuery } from './skill-query';
import type { DeferredSkillExport } from './deferred-skill-exports';

export default function SkillExportRecovery({ client, scope, receipts, deferred = [], locatedReceipt, onReceipt, onBusyChange, onDeferredReceipt }: {
  client: RuntimeClient; scope: ScopeRef; receipts: SkillExportReceipt[];
  deferred?: DeferredSkillExport[];
  locatedReceipt?: SkillExportReceipt;
  onReceipt: (receipt: SkillExportReceipt) => void; onBusyChange?: (busy: boolean) => void;
  onDeferredReceipt?: (receipt: SkillExportReceipt) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [releasing, setReleasing] = useState('');
  const [deferredError, setDeferredError] = useState<{ id: string; message: string }>();
  const pending = useRef(false);
  const located = useRef<HTMLElement>(null);
  useEffect(() => { if (locatedReceipt) located.current?.focus(); }, [locatedReceipt]);
  async function act(action: () => Promise<SkillExportReceipt>, deferredAction?: { id: string; kind: 'lookup' | 'retry' }) {
    if (pending.current) return;
    pending.current = true; setBusy(true); onBusyChange?.(true); setError('');
    setDeferredError(undefined);
    try {
      const receipt = await action();
      if (deferredAction && onDeferredReceipt) onDeferredReceipt(receipt);
      else onReceipt(receipt);
      setReleasing('');
    } catch (failure) {
      if (!deferredAction) setError('未能确认文件状态。请重新核对保存记录后再试。');
      else {
        const notFound = failure instanceof ApiError && (failure.code === 'skill_export_not_found' || failure.status === 404);
        setDeferredError({ id: deferredAction.id, message: deferredAction.kind === 'retry'
          ? '本次重试未完成，原保存结果仍待核对。'
          : notFound ? '暂未找到原保存记录，原保存结果仍待核对。' : '暂时无法查询原保存记录。' });
      }
    }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <section aria-label="保存记录" className="flex flex-col gap-3 [overflow-wrap:anywhere]">
    <h3 className="font-semibold">保存记录与恢复</h3>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {receipts.length === 0 && deferred.length === 0 && <p>当前范围没有保存记录。</p>}
    {deferred.filter(entry => !receipts.some(receipt => receipt.command_id === entry.command.meta.command_id)).map(({ label, command }) => {
      const id = command.meta.command_id!;
      return <article key={id} aria-label={label} className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
        <h4 className="font-medium">{label}</h4>
        <p className="text-sm text-muted-foreground">保存结果待核对</p>
        {deferredError?.id === id && <p role="alert" className="text-destructive">{deferredError.message}</p>}
         <div className="flex flex-wrap gap-2">
           <Button type="button" size="sm" variant="default" disabled={busy} onClick={() => void act(
             () => client.skillExport(id, skillQuery(scope)), { id, kind: 'lookup' })}>查询保存结果</Button>
           <Button type="button" size="sm" disabled={busy} onClick={() => void act(() => client.saveSkillExport(command), { id, kind: 'retry' })}>重试保存</Button>
        </div>
      </article>;
    })}
    {receipts.map(receipt => {
      const fileName = receipt.target_path.split(/[\\/]/).at(-1)!;
      const isLocated = receipt.command_id === locatedReceipt?.command_id;
      const active = receipt.disposition === 'pending';
      return <article key={receipt.command_id} aria-label={fileName} ref={isLocated ? located : undefined}
        tabIndex={isLocated ? -1 : undefined} className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
        <h4 className="font-medium">{active && receipt.state === 'saved' ? `已保存：${fileName}` : fileName}</h4>
        <p className="text-sm text-muted-foreground">目标：{receipt.target_path}</p>
        {active ? <>
          {receipt.state !== 'saved' && <p>{receipt.state === 'original'
          ? receipt.target_matches === 'original' ? '原文件完整，未确认保存新版本'
            : receipt.target_matches === 'missing' ? '目标文件未写入' : '未确认保存结果'
            : receipt.state === 'needs_restore' ? '保存中断，原文件待恢复' : '文件状态冲突，保留现状'}</p>}
          {receipt.cleanup_pending && <p className="text-sm text-muted-foreground">此记录仍有暂存或备份待处理。</p>}
          {receipt.reason && <p>无法核对文件状态，请检查目标位置后重新核对。</p>}
           <div className="flex flex-wrap gap-2">
             <Button type="button" size="sm" disabled={busy} onClick={() => void act(() => client.skillExport(receipt.command_id, skillQuery(scope)))}>重新核对</Button>
             {receipt.state === 'needs_restore' && <Button type="button" size="sm" variant="default" disabled={busy} onClick={() => void act(() => client.restoreSkillExport(receipt.command_id, { scope }))}>恢复原文件</Button>}
             {(receipt.state === 'saved' || receipt.state === 'original') && <Button type="button" size="sm" className="whitespace-normal" disabled={busy} onClick={() => void act(() => client.finalizeSkillExport(receipt.command_id, { scope }))}>完成处置并清理所属临时文件</Button>}
             <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setReleasing(receipt.command_id)}>放弃自动恢复</Button>
          </div>
          {releasing === receipt.command_id && <section aria-label="确认放弃恢复">
            <p>外部目标、暂存和备份都会保留。处置后不再自动恢复；删除所属项目后需自行保管和处理这些文件。</p>
             <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="destructive" className="whitespace-normal" disabled={busy} onClick={() => void act(() => client.releaseSkillExport(receipt.command_id, { scope }))}>确认放弃恢复并保留外部文件</Button>
               <Button type="button" size="sm" disabled={busy} onClick={() => setReleasing('')}>继续保留恢复入口</Button></div>
          </section>}
        </> : <>
          <p className="text-sm text-muted-foreground">处置时记录的文件状态</p>
          <p>{receipt.reason ? '当时无法核对文件状态' : ({
            saved: '当时已确认保存',
            original: receipt.target_matches === 'original' ? '当时核对为原文件' :
              receipt.target_matches === 'missing' ? '当时目标不存在' : '当时未确认保存结果',
            needs_restore: '当时尚未恢复原文件',
            conflict: '当时文件状态存在冲突',
          })[receipt.state]}</p>
          {receipt.cleanup_pending && <p>处置时未清理暂存或备份。</p>}
          <p>{receipt.disposition === 'released' ? '已放弃自动恢复'
            : receipt.disposition === 'restored' ? '已恢复原文件并完成处置' : '已完成处置'}</p>
        </>}
      </article>;
    })}
  </section>;
}
