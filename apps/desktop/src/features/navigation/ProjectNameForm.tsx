import { useId, useRef, useState } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import {
  checkWorkspaceDirectoryCommand, createWorkspaceFromDirectory, discardWorkspaceDirectorySelection,
  retryWorkspaceFromDirectory, selectWorkspaceDirectory, windowError,
} from '../../api/windows';
import Dialog from '../../components/Dialog';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import type { CommandMeta, Workspace } from '../../generated/contracts';

export default function ProjectNameForm({ client, allowDirectory, onCreated, onClose, onReturnFocus }: {
  client: RuntimeClient;
  allowDirectory: boolean;
  onCreated: (workspace: Workspace) => void;
  onClose: () => void;
  onReturnFocus: () => void;
}) {
  const [name, setName] = useState('');
  const [selection, setSelection] = useState<{ name: string; meta: CommandMeta }>();
  const [frozenName, setFrozenName] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  function act(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    void action().catch(reason => {
      const code = windowError(reason);
      if (code === 'file_not_found' || code === 'native_selection_kind') {
        setFrozenName(undefined);
        setSelection(undefined);
        if (name === selection?.name) setName('');
        setError('所选目录已不可用，请重新选择。');
      } else {
        setError(code);
      }
    }).finally(() => {
      pending.current = false;
      setBusy(false);
    });
  }

  function close() {
    if (frozenName) return;
    act(async () => {
      if (selection) await discardWorkspaceDirectorySelection(selection.meta.command_id!);
      onClose();
    });
  }

  return <Dialog title="新建项目" onClose={close} onReturnFocus={onReturnFocus}>
    <form onSubmit={event => {
      event.preventDefault();
      const confirmed = name.trim();
      if (!confirmed || frozenName) return;
      act(async () => {
        if (selection) {
          setFrozenName(confirmed);
          onCreated((await createWorkspaceFromDirectory(confirmed, selection.meta)).workspace);
        } else {
          onCreated(await client.createWorkspace({ meta: commandMeta(), data: { name: confirmed } }));
        }
      });
    }}>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={fieldId}>项目名称</FieldLabel>
          <Input id={fieldId} autoFocus required ref={input} value={name} maxLength={256}
            readOnly={!!frozenName || busy} onChange={event => setName(event.target.value)} />
        </Field>
        {allowDirectory && <Field>
          {selection && <FieldDescription>{selection.name ? `已选目录：${selection.name}` : '已选根目录'}</FieldDescription>}
          <Button type="button" variant="outline" className="self-start" disabled={busy || !!frozenName} onClick={() => act(async () => {
            const meta = commandMeta();
            const selectedName = await selectWorkspaceDirectory(meta.command_id!);
            if (selectedName === null) return;
            setSelection({ name: selectedName, meta });
            if (!name.trim() || name === selection?.name) setName(selectedName);
            input.current?.focus();
          })}>{selection ? '更换项目目录' : '选择项目目录'}</Button>
        </Field>}
        {error && <p role="alert">{error}</p>}
        {frozenName && selection && <>
          <p>目录创建结果待核对。可以核对或重试同一命令。</p>
          <div className="button-row">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => act(async () => {
              const { result } = await checkWorkspaceDirectoryCommand(selection.meta.command_id!);
              if (result) onCreated(result.workspace);
            })}>核对目录创建</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => act(async () => {
              onCreated((await retryWorkspaceFromDirectory(frozenName, selection.meta)).workspace);
            })}>重试目录创建</Button>
          </div>
        </>}
        <div className="button-row">
          <Button type="button" variant="outline" disabled={busy || !!frozenName} onClick={close}>取消</Button>
          <Button type="submit" variant="default" disabled={busy || !!frozenName || !name.trim()}>创建项目</Button>
        </div>
      </FieldGroup>
    </form>
  </Dialog>;
}
