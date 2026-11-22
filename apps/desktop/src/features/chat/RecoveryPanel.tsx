import { useRef, useState } from 'react';
import type { PublicationView } from '../../generated/contracts';
import type { CommandOutcome } from '../../state/runtime-store';
import { windowError } from '../../api/windows';
import { Button } from '../../components/ui/button';
import { FieldLabel } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
export default function RecoveryPanel({ publications, busy, onCommand, isPending }: {
  publications: PublicationView[]; busy: boolean; onCommand: (type: 'restoreExport' | 'releaseExport', publication: PublicationView) => Promise<CommandOutcome>;
  isPending?: (id: string) => boolean;
}) {
  const [confirming, setConfirming] = useState<string>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const inflight = useRef(false);
  const [selectedId, setSelectedId] = useState('');
  const item = publications.find(item => item.id === selectedId) ?? publications[0];
  async function submit(type: 'restoreExport' | 'releaseExport', value: PublicationView) {
    if (inflight.current || isPending?.(value.id)) return;
    inflight.current = true; setPending(true); setError('');
    try { const outcome = await onCommand(type, value); if (outcome.status === 'unconfirmed') setError('提交状态待确认，请核对或使用原命令重试；尚未确认释放。'); else setConfirming(undefined); }
    catch (error) { setError(windowError(error)); } finally { inflight.current = false; setPending(false); }
  }
  if (!item) return null;
  const blocked = busy || pending || isPending?.(item.id);
  const terminal = ['restored', 'released', 'finalized'].includes(item.state);
  return <div className="recovery-panel">
    {publications.length > 1 && <FieldLabel>恢复记录
      <NativeSelect value={item.id} disabled={pending} onChange={event => {
        setSelectedId(event.target.value);
        setConfirming(undefined);
        setError('');
      }}>
        {publications.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.target_path} · {item.state}</NativeSelectOption>)}
      </NativeSelect>
    </FieldLabel>}
    <div className="interaction-body">
    <h3>导出恢复 · {item.state}</h3><p>目标：{item.target_path}</p><p>备份：{item.backup_path ?? '无备份'}</p>
    <p>目标核验：{item.target_matches} · 备份核验：{item.backup_matches === null ? '未知' : item.backup_matches ? '匹配' : '不匹配'}</p>
    {item.maintenance_reason && <p>{item.maintenance_reason}</p>}
    {terminal && <p>恢复责任已结束，可重试原隐私删除；外部文件不属于本地隐私删除。</p>}
    {error && <p role="alert">{error}</p>}</div>
    {!terminal && <footer className="interaction-footer">
      {confirming === item.id && <p>放弃后不再自动恢复。外部目标和备份均保留，由你自行处理；这不是删除外部文件。</p>}
      <div className="button-row">
        {confirming === item.id ? <>
          <Button disabled={blocked} onClick={() => setConfirming(undefined)}>取消放弃</Button>
          <Button disabled={blocked} onClick={() => void submit('releaseExport', item)}>确认放弃自动恢复</Button>
        </> : <>
          <Button disabled={blocked} onClick={() => void submit('restoreExport', item)}>核验并恢复</Button>
          <Button className="whitespace-normal" disabled={blocked} onClick={() => setConfirming(item.id)}>放弃自动恢复，保留外部文件</Button>
        </>}
      </div>
    </footer>}
  </div>;
}
