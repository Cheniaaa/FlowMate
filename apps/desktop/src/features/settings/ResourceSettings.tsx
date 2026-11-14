import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RuntimeClient } from '../../api/client';
import { mergeGrants, mergeVersioned, scopeDeleted } from '../../api/events';
import { windowError } from '../../api/windows';
import type { WorkspacePage } from '../../generated/contracts';
import type { createRuntimeStore } from '../../state/runtime-store';
import ResourcePanel from '../chat/ResourcePanel';
export default function ResourceSettings({ client, store }: { client: RuntimeClient; store: ReturnType<typeof createRuntimeStore> }) {
  const commands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [workspaces, setWorkspaces] = useState<WorkspacePage>();
  const [workspaceId, setWorkspaceId] = useState('');
  const [error, setError] = useState('');
  const [grantRevision, setGrantRevision] = useState(0);
  const availableWorkspaces = workspaces?.items.filter(item => !scopeDeleted(projection, { workspace_id: item.id, session_id: null })) ?? [];
  const workspaceDeleted = workspaceId !== '' && scopeDeleted(projection, { workspace_id: workspaceId, session_id: null });
  useEffect(() => { if (workspaceDeleted) setWorkspaceId(availableWorkspaces[0]?.id ?? ''); }, [workspaceDeleted]);
  useEffect(() => { let ignore = false;
    client.workspaces().then(page => { if (!ignore) { setWorkspaces(page); setWorkspaceId(page.items[0]?.id ?? ''); } }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client]);
  useEffect(() => {
    if (!workspaceId) return;
    const abort = new AbortController();
    store.loadWorkspace(workspaceId, { snapshot: () => setGrantRevision(value => value + 1), event: event => {
      if (event.kind === 'durable' && ['resource.registered', 'resource.updated', 'grant.created', 'grant.revoked', 'scope.deleted'].includes(event.event.kind)) setGrantRevision(value => value + 1);
    } }, abort.signal).catch(error => { if (!abort.signal.aborted) setError(windowError(error)); });
    return () => abort.abort();
  }, [store, workspaceId]);
  return <><h2>资料与授权</h2><label>授权所属项目 <select value={workspaceDeleted ? '' : workspaceId} onChange={event => setWorkspaceId(event.target.value)}>{availableWorkspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {workspaces?.next_cursor && <button onClick={async () => { try { const next = await client.workspaces({ cursor: workspaces.next_cursor! }); setWorkspaces({ ...next, items: Object.values(mergeVersioned(Object.fromEntries(workspaces.items.map(item => [item.id, item])), next.items)) }); } catch (error) { setError(windowError(error)); } }}>更多项目</button>}
    {error && <p role="alert">{error}</p>}
    {workspaceId && !workspaceDeleted && <ResourcePanel client={client} workspaceId={workspaceId} sessionId={null} refreshKey={grantRevision} isRevokePending={() => commands.length > 0} onGrantsLoaded={items => store.update(state => mergeGrants(state, items))} onRevoke={(id, meta) => {
      if (commands.some(command => command.status === 'unconfirmed')) return Promise.reject(new Error('请先核对上一条撤销命令，不能用新命令重复提交'));
      return store.dispatch({ type: 'revoke', args: [id, meta] });
    }} />}
    {commands.map(command => <section key={command.commandId}><p>{command.status === 'unconfirmed' ? '撤销提交状态待确认；尚未确认撤销' : '撤销已接收，状态同步中'}</p><p>{command.error}</p>
      {command.scope && <p>原项目 {command.scope.workspace_id} · {command.scope.session_id ? `原会话 ${command.scope.session_id}` : '整个项目'}；切换当前项目不会改变这条命令的归属。</p>}
      <button disabled={command.busy} onClick={async () => { try { await store.retry(command.commandId); setGrantRevision(value => value + 1); } catch (error) { setError(windowError(error)); } }}>{command.status === 'unconfirmed' ? '使用原命令重试撤销' : '重试授权同步'}</button>
    </section>)}
  </>;
}
