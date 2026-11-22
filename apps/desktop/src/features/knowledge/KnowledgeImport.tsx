import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { validate } from '../../api/validation';
import { windowError } from '../../api/windows';
import type { KnowledgeImportReceipt, KnowledgeSource, ResourceRef } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '../../components/ui/field';
import { forgetImport, readPendingImport, rememberImport, type PendingImport } from './pending-import';

const fileRejections: Record<string, string> = {
  file_extension_not_allowed: '仅支持 MD、TXT 文件，请转换后重新选择。',
  file_encoding_invalid: '文件编码无法读取，请转换为 UTF-8 后重新选择。',
  file_too_large: '文件超出本次可接收大小，请拆分后重新选择。',
  file_access_failed: '文件无法读取，请检查访问权限后重新选择。',
  file_identity_changed: '文件已被替换，请重新选择。',
  file_source_changed: '文件读取期间发生变化，请重新选择。',
  not_found: '所选文件不存在，请重新选择。',
  scope_mismatch: '此文件不属于当前项目，请在当前项目重新选择。',
};

export interface KnowledgeImportHandle { update: (source: KnowledgeSource) => void }
export default function KnowledgeImport({ client, workspaceId, onImported, trigger, onFormActiveChange, ref }: {
  client: RuntimeClient; workspaceId: string; onImported?: () => void;
  trigger?: (review: (resources: ResourceRef[]) => void, disabled: boolean) => ReactNode;
  onFormActiveChange?: (active: boolean) => void;
  ref?: Ref<KnowledgeImportHandle>;
}) {
  const [selection, setSelection] = useState<ResourceRef[]>([]), [chosen, setChosen] = useState<string[]>([]);
  const [directory, setDirectory] = useState<{ id: string; cursor: string | null }>();
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [pending, setPending] = useState<PendingImport | undefined>(() => readPendingImport(workspaceId));
  const [targetSource, setTargetSource] = useState<KnowledgeSource>();
  const inflight = useRef(false), fieldId = useId();
  useImperativeHandle(ref, () => ({ update: source => { if (!pending) review([], source); } }));
  useEffect(() => { onFormActiveChange?.(preview || busy); return () => onFormActiveChange?.(false); },
    [preview, busy, onFormActiveChange]);
  function accepted(receipt: KnowledgeImportReceipt, original: PendingImport) {
    if (receipt.command_id !== original.command.meta.command_id) throw new Error('接纳回执与原命令不符');
    forgetImport(workspaceId); setPending(undefined); setPreview(false);
    setSelection([]); setChosen([]); setDirectory(undefined);
    setMessage(`已接收 ${receipt.jobs.length} 个文件`);
    setError(receipt.rejected.map(item =>
      `${original.labels[item.resource_id]}：${fileRejections[item.reason] ?? '未能接收，请检查文件后重新选择。'}`).join('；'));
    onImported?.();
  }
  async function checkPending(original: PendingImport) {
    const checked = await client.workspaceCommandStatus(workspaceId, original.command.meta.command_id!);
    if (checked.status === 'confirmed') accepted(validate('KnowledgeImportReceipt', checked.result), original);
    else setError('暂未查到接收回执，请稍后重试。');
  }
  useEffect(() => {
    const original = readPendingImport(workspaceId);
    if (!original) return;
    let ignore = false;
    client.workspaceCommandStatus(workspaceId, original.command.meta.command_id!).then(checked => {
      if (ignore) return;
      if (checked.status === 'confirmed') accepted(validate('KnowledgeImportReceipt', checked.result), original);
      else setError('暂未查到接收回执，请稍后重试。');
    }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, workspaceId]);
  async function act(action: () => Promise<void>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) { setError(windowError(error)); }
    finally { inflight.current = false; setBusy(false); }
  }
  function review(resources: ResourceRef[], target?: KnowledgeSource) {
    setDirectory(undefined); setMessage(''); setError('');
    setTargetSource(target); setSelection(resources);
    setChosen(target && resources.length !== 1 ? [] : resources.map(item => item.id)); setPreview(true);
  }
  async function selectResources(kind: 'file' | 'directory', target?: KnowledgeSource) {
    const raw = await invoke<{ resources: unknown[] }>('select_resources', {
      scope: { kind: 'workspace', workspace_id: workspaceId, session_id: null }, kind,
    });
    const resources = raw.resources.map(value => validate('ResourceRef', value));
    if (!resources.length) return;
    if (kind === 'file') review(resources, target);
    else {
      const value = await invoke<{ resources: unknown[]; next_cursor: string | null }>('expand_knowledge_directory', {
        directoryId: resources[0].id, cursor: null, limit: 50,
      });
      review(value.resources.map(item => validate('ResourceRef', item)).filter(item => /\.(md|txt)$/i.test(item.label)));
      setDirectory({ id: resources[0].id, cursor: value.next_cursor });
    }
  }
  async function moreDirectory() {
    const value = await invoke<{ resources: unknown[]; next_cursor: string | null }>('expand_knowledge_directory', {
      directoryId: directory!.id, cursor: directory!.cursor, limit: 50,
    });
    const files = value.resources.map(item => validate('ResourceRef', item)).filter(item => /\.(md|txt)$/i.test(item.label));
    setSelection(current => [...new Map([...current, ...files].map(item => [item.id, item])).values()]);
    setChosen(current => [...new Set([...current, ...files.map(item => item.id)])]);
    setDirectory({ ...directory!, cursor: value.next_cursor });
  }
  async function submit() {
    const original: PendingImport = { command: { meta: commandMeta(targetSource?.revision ?? null),
      data: { resource_ids: chosen, ...(targetSource ? { source_id: targetSource.id } : {}) } },
      labels: Object.fromEntries(selection.map(item => [item.id, item.label])) };
    validate('KnowledgeImportCommand', original.command);
    await send(original);
  }
  async function send(original: PendingImport) {
    rememberImport(workspaceId, original); setPending(original);
    try { accepted(await client.importKnowledge(workspaceId, original.command), original); }
    catch (error) {
      if (error instanceof ApiError && error.status < 500) { forgetImport(workspaceId); setPending(undefined); throw error; }
      setPreview(false); setError(windowError(error));
    }
  }
  return <>
    {trigger ? trigger(review, busy || !!pending) : <div className="flex flex-wrap gap-2">
      <Button variant="default" disabled={busy || !!pending} onClick={() => void act(() => selectResources('file'))}>加入文件</Button>
      <Button disabled={busy || !!pending} onClick={() => void act(() => selectResources('directory'))}>从目录选择</Button>
    </div>}
    {message && <p role="status" className="m-0 text-sm">{message}</p>}
    {error && !preview && <p role="alert" className="m-0 text-sm">{error}</p>}
    {pending && <div className="flex flex-wrap items-center gap-2">
      <p className="m-0 text-sm">接收状态待核对，离开页面后仍可核对。</p>
      <Button disabled={busy} onClick={() => void act(() => checkPending(pending))}>核对接收状态</Button>
      <Button disabled={busy} onClick={() => void act(() => send(pending))}>重试</Button>
    </div>}
    <Dialog open={preview} onOpenChange={value => { if (!busy) setPreview(value); }}>
      <DialogContent className="flex max-h-[85dvh] w-[min(92vw,560px)] flex-col gap-4 overflow-auto">
        <DialogTitle className="m-0 text-lg font-semibold">{targetSource ? '更新项目资料' : '加入项目资料'}</DialogTitle>
        <DialogDescription className="m-0 text-sm text-muted-foreground">
          {targetSource ? `从「${targetSource.label}」的原位置读取最新内容，完成前仍使用当前资料；历史引用保留原文。文件已移动或需要替换时，可选择其他文件。`
            : '所选文件将保存在当前项目，继续使用本项目已有的用途许可。目录只加入本次选中的 MD、TXT 文件。'}
        </DialogDescription>
        <FieldGroup>{selection.map(item => <Field key={item.id} orientation="horizontal">
          <Checkbox id={`${fieldId}-${item.id}`} checked={chosen.includes(item.id)} disabled={busy}
            onCheckedChange={checked => setChosen(current => checked ? targetSource ? [item.id] : [...current, item.id] : current.filter(id => id !== item.id))} />
          <FieldLabel htmlFor={`${fieldId}-${item.id}`} className="break-words">{item.label}</FieldLabel>
        </Field>)}</FieldGroup>
        {directory?.cursor && <><p className="m-0 text-sm text-muted-foreground">目录还有文件，仅加入已选中的文件。</p>
          <Button disabled={busy} onClick={() => void act(moreDirectory)}>继续查看目录文件</Button></>}
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="default" disabled={busy || !!pending || (targetSource ? selection.length > 0 && chosen.length !== 1 : !chosen.length)}
            onClick={() => void act(submit)}>{targetSource ? '更新此资料' : `加入所选 ${chosen.length} 个文件`}</Button>
          {targetSource && <Button disabled={busy || !!pending}
            onClick={() => void act(() => selectResources('file', targetSource))}>选择其他文件</Button>}
          <Button disabled={busy} onClick={() => setPreview(false)}>{targetSource ? '取消更新' : '暂不加入'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
