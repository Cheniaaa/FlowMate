import { useEffect, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import type { WorkspacePage } from '../../generated/contracts';
import { windowError } from '../../api/windows';
import { personalScope, type MemoryScope } from '../../api/memory';

export default function MemoryScopePicker({ client, scope, onChange, disabled = false }: {
  client: RuntimeClient; scope: MemoryScope; onChange: (scope: MemoryScope) => void; disabled?: boolean;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspacePage>(), [error, setError] = useState('');
  useEffect(() => { let ignore = false;
    client.workspaces().then(page => { if (!ignore) setWorkspaces(page); }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client]);
  return <><label>记忆范围 <select disabled={disabled} value={scope.workspace_id ?? ''} onChange={event => onChange(event.target.value
    ? { kind: 'workspace', workspace_id: event.target.value, session_id: null } : personalScope)}>
    <option value="">关于我</option>
    {scope.workspace_id && !workspaces?.items.some(workspace => workspace.id === scope.workspace_id) && <option value={scope.workspace_id}>当前项目 · 名称尚未同步</option>}
    {workspaces?.items.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name} · 项目记忆</option>)}
  </select></label>
    {workspaces?.next_cursor && <button disabled={disabled} onClick={() => {
      void client.workspaces({ cursor: workspaces.next_cursor! }).then(page => setWorkspaces({ ...page, items: [...workspaces.items, ...page.items] })).catch(error => setError(windowError(error)));
    }}>更多记忆项目</button>}
    {error && <p role="alert">{error}</p>}
  </>;
}
