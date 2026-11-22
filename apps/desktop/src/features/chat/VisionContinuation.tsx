import { useState } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import type { ModelProfile, ModelResolution, RunSnapshot, VisionContinueCommand } from '../../generated/contracts';
import type { RuntimeStore } from '../../state/runtime-store';
import { Button } from '../../components/ui/button';
import Dialog from '../../components/Dialog';
import { FieldLabel } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';

export default function VisionContinuation({ run, client, store }: {
  run: RunSnapshot; client: RuntimeClient; store: RuntimeStore;
}) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [selected, setSelected] = useState<ModelResolution | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState<VisionContinueCommand | null>(null);
  const [pending, setPending] = useState(false);

  async function show() {
    setOpen(true); setBusy(true); setError('');
    try {
      const items: ModelProfile[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.models({ cursor });
        items.push(...page.items);
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      setModels(items.filter(model => model.capabilities.vision !== false));
    } catch { setError('无法读取可用型号，请稍后重试。'); }
    finally { setBusy(false); }
  }
  async function select(id: string) {
    setSelected(null); setCommand(null); setError('');
    if (!id) return;
    setBusy(true);
    try { setSelected(await client.modelResolution(id)); }
    catch { setError('无法确认此型号的接收方，请重新选择。'); }
    finally { setBusy(false); }
  }
  async function continueRun() {
    if (!selected || busy || pending) return;
    const next = command ?? { meta: commandMeta(run.version), data: {
      model_profile_id: selected.id, model_profile_version: selected.version,
      connection_version: selected.connection_version, endpoint: selected.endpoint,
    } };
    setCommand(next); setBusy(true); setError('');
    try {
      const outcome = await store.dispatch({ type: 'continueVision', args: [run.id, next] });
      if (outcome.status === 'confirmed') setOpen(false);
      else { setPending(true); setError('提交结果待确认，请在运行待办中核对本次操作。'); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '图片续办失败。'); setCommand(null); }
    finally { setBusy(false); }
  }
  return <>
    <Button type="button" onClick={() => void show()}>选择视觉模型继续</Button>
    {open && <Dialog title="选择视觉模型继续" onClose={() => setOpen(false)}>
      <p>复用原任务已保存的图片与文字，使用原预算的剩余额度。</p>
      <FieldLabel>视觉型号 <NativeSelect disabled={busy || command !== null} defaultValue={selected?.id ?? ''} onChange={event => void select(event.target.value)}>
        <NativeSelectOption value="">请选择型号</NativeSelectOption>
        {models.map(model => <NativeSelectOption key={model.id} value={model.id}>{model.display_name ?? model.model_id}</NativeSelectOption>)}
      </NativeSelect></FieldLabel>
      {selected && <><p>图片接收方：{selected.endpoint}</p>
        <p>型号：{selected.display_name ?? selected.model_id}</p>
        <p>图片输入按像素预留预算，实际用量以服务回执为准。</p></>}
      {error && <p role="alert">{error}</p>}
      <Button type="button" variant="default" disabled={!selected || busy || pending || selected.blockers.length > 0} onClick={() => void continueRun()}>
        {busy ? '正在处理…' : '继续处理图片'}
      </Button>
    </Dialog>}
  </>;
}
