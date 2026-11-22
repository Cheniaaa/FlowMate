import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import type { RuntimeClient } from '../../api/client';
import { applyDeletion, mergeGrants, mergeVersioned, scopeDeleted } from '../../api/events';
import { windowError } from '../../api/windows';
import type { Session, WorkspacePage, WorkspaceSnapshot } from '../../generated/contracts';
import type { createRuntimeStore } from '../../state/runtime-store';
import ResourcePanel from '../chat/ResourcePanel';
import type { EditorLifecycle } from './Settings';
import { Button } from '../../components/ui/button';
import { Field, FieldError, FieldLabel } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
export default function ResourceSettings({ client, store, ...lifecycle }: { client: RuntimeClient; store: ReturnType<typeof createRuntimeStore> } & EditorLifecycle) {
  const projectField = useId();
  const allCommands = useSyncExternalStore(store.subscribe, store.getCommandsSnapshot);
  const commands = allCommands.filter(command => command.type === 'revoke');
  const projection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [workspaces, setWorkspaces] = useState<WorkspacePage>();
  const [workspaceId, setWorkspaceId] = useState('');
  const [error, setError] = useState('');
  const [grantRevision, setGrantRevision] = useState(0);
  const [sessionCatalog, setSessionCatalog] = useState<{
    workspaceId: string; items: Record<string, Session>; nextCursor: string | null;
  }>();
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
    // 管理查询只订阅目标项目；不能安装到聊天的当前工作区快照。
    function readSnapshot(snapshot: WorkspaceSnapshot) {
      setSessionCatalog({
        workspaceId, items: mergeVersioned({}, snapshot.sessions.items), nextCursor: snapshot.sessions.next_cursor,
      });
      setGrantRevision(value => value + 1);
    }
    client.workspaceSnapshot(workspaceId, abort.signal).then(snapshot => {
      if (abort.signal.aborted) return;
      readSnapshot(snapshot);
      return client.watchWorkspace(workspaceId, snapshot.watermark, { snapshot: readSnapshot, event: event => {
        if (event.kind === 'durable' && (event.event.kind === 'session.created' || event.event.kind === 'session.updated')) {
          const session = event.event.payload;
          setSessionCatalog(current => current?.workspaceId === workspaceId ? {
            ...current, items: mergeVersioned(current.items, [session]),
          } : current);
        }
        if (event.kind === 'durable' && ['resource.registered', 'resource.updated', 'grant.created', 'grant.revoked', 'scope.deleted'].includes(event.event.kind)) {
          if (event.event.kind === 'scope.deleted') {
            const deletions = event.event.payload.deletions;
            store.update(state => deletions.reduce(applyDeletion, state));
          }
          setGrantRevision(value => value + 1);
        }
      } }, abort.signal);
    }).catch(error => { if (!abort.signal.aborted) setError(windowError(error)); });
    return () => abort.abort();
  }, [client, store, workspaceId]);
  const catalog = sessionCatalog?.workspaceId === workspaceId ? sessionCatalog : undefined;
  const cursor = catalog?.nextCursor;
  const needsSessionTitles = !!catalog?.nextCursor && Object.values(projection.grants).some(grant =>
    grant.scope.workspace_id === workspaceId && grant.scope.session_id && !catalog.items[grant.scope.session_id]);
  useEffect(() => {
    if (!cursor || !needsSessionTitles) return;
    let ignore = false;
    client.sessions(workspaceId, { cursor }).then(page => {
      if (ignore) return;
      setSessionCatalog(current => current?.workspaceId === workspaceId && current.nextCursor === cursor
        ? { workspaceId, items: mergeVersioned(current.items, page.items), nextCursor: page.next_cursor }
        : current);
    }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, workspaceId, cursor, needsSessionTitles]);

  const sessions = catalog ? Object.values(catalog.items) : [];
  const sessionTitles = Object.fromEntries(sessions.filter(item => !scopeDeleted(projection, {
    workspace_id: workspaceId, session_id: item.id,
  })).map(item => [item.id, item.title]));
  const workspaceName = availableWorkspaces.find(item => item.id === workspaceId)?.name;
  return <section className="grid gap-3 wrap-anywhere"><h2 className="m-0">资料与授权</h2>
    <Field><FieldLabel htmlFor={projectField}>授权所属项目</FieldLabel>
      <NativeSelect id={projectField} value={workspaceDeleted ? '' : workspaceId} disabled={!availableWorkspaces.length} onChange={event => setWorkspaceId(event.target.value)}>
        {availableWorkspaces.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
      </NativeSelect>
    </Field>
    {workspaces?.next_cursor && <Button className="justify-self-start" onClick={async () => { try { const next = await client.workspaces({ cursor: workspaces.next_cursor! }); setWorkspaces({ ...next, items: Object.values(mergeVersioned(Object.fromEntries(workspaces.items.map(item => [item.id, item])), next.items)) }); } catch (error) { setError(windowError(error)); } }}>更多项目</Button>}
    {error && <FieldError>{error}</FieldError>}
    {workspaceId && !workspaceDeleted && <ResourcePanel {...lifecycle} client={client} workspaceId={workspaceId} sessionId={null} workspaceName={workspaceName} sessionTitles={sessionTitles} showHeading={false} refreshKey={grantRevision} isRevokePending={() => commands.length > 0} onGrantsLoaded={items => store.update(state => mergeGrants(state, items))} onRevoke={(id, meta) => {
      if (commands.some(command => command.status === 'unconfirmed')) return Promise.reject(new Error('请先核对上一条撤销命令，不能用新命令重复提交'));
      return store.dispatch({ type: 'revoke', args: [id, meta] });
    }} />}
    {commands.map(command => <section key={command.commandId}><p>{command.status === 'unconfirmed' ? '撤销提交状态待确认；尚未确认撤销' : '撤销已接收，状态同步中'}</p><p>{command.error}</p>
      {command.scope && <p>原项目：{availableWorkspaces.find(item => item.id === command.scope?.workspace_id)?.name ?? '项目名称不可用'}{command.scope.session_id && ` · ${command.scope.workspace_id === workspaceId ? sessionTitles[command.scope.session_id] ?? '原会话' : '原会话'}`}。切换项目不会改变撤销目标。</p>}
      <Button disabled={command.busy} onClick={async () => { try { await store.retry(command.commandId); setGrantRevision(value => value + 1); } catch (error) { setError(windowError(error)); } }}>{command.status === 'unconfirmed' ? '使用原命令重试撤销' : '重试授权同步'}</Button>
    </section>)}
  </section>;
}
