import { useEffect, useId, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import type { WorkspacePage } from '../../generated/contracts';
import { windowError } from '../../api/windows';
import { personalScope, type MemoryScope } from '../../api/memory';
import { Button } from '../../components/ui/button';
import { Field, FieldError, FieldLabel } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';

export default function MemoryScopePicker({ client, scope, onChange, disabled = false }: {
  client: RuntimeClient; scope: MemoryScope; onChange: (scope: MemoryScope, name: string) => void; disabled?: boolean;
}) {
  const fieldId = useId();
  const [workspaces, setWorkspaces] = useState<WorkspacePage>(), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => { let ignore = false;
    client.workspaces().then(page => { if (!ignore) { setWorkspaces(page); setError(''); } }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, retry]);
  return <><Field><FieldLabel htmlFor={fieldId}>记忆范围</FieldLabel><NativeSelect id={fieldId} disabled={disabled} value={scope.workspace_id ?? ''} onChange={event => {
    const workspace = workspaces?.items.find(item => item.id === event.target.value);
    onChange(workspace ? { kind: 'workspace', workspace_id: workspace.id, session_id: null } : personalScope, workspace?.name ?? '');
  }}>
    <NativeSelectOption value="">个人</NativeSelectOption>
    {scope.workspace_id && !workspaces?.items.some(workspace => workspace.id === scope.workspace_id) && <NativeSelectOption value={scope.workspace_id}>当前项目 · 名称尚未同步</NativeSelectOption>}
    {workspaces?.items.map(workspace => <NativeSelectOption key={workspace.id} value={workspace.id}>{workspace.name} · 项目记忆</NativeSelectOption>)}
  </NativeSelect></Field>
    {workspaces?.next_cursor && <Button className="self-start" disabled={disabled} onClick={() => {
      void client.workspaces({ cursor: workspaces.next_cursor! }).then(page => setWorkspaces({ ...page, items: [...workspaces.items, ...page.items] })).catch(error => setError(windowError(error)));
    }}>更多记忆项目</Button>}
    {error && <><FieldError>{error}</FieldError><Button className="self-start" onClick={() => setRetry(value => value + 1)}>重试读取项目</Button></>}
  </>;
}
