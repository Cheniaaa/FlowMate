import { useEffect, useRef, useState } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { mergeVersioned } from '../../api/events';
import type { CommandMeta, DataUseGrant, ResourceRef } from '../../generated/contracts';
import { windowError } from '../../api/windows';
import GrantForm from '../authorization/GrantForm';
import type { EditorLifecycle } from '../settings/Settings';
const purposes = { read: '读取', model_send: '发送至模型', export: '导出', tool_send: '发送到 MCP 工具', local_process_send: '发送到绑定的本机脚本' };
export default function ResourcePanel({ client, workspaceId, sessionId, onRevoke, onGrantsLoaded, refreshKey, isRevokePending, onBusyChange, onSaved }: {
  client: RuntimeClient; workspaceId: string; sessionId: string | null; onRevoke: (id: string, meta: CommandMeta) => Promise<unknown>;
  onGrantsLoaded?: (grants: DataUseGrant[]) => void;
  refreshKey?: string | number; isRevokePending?: (id: string) => boolean;
} & EditorLifecycle) {
  const [resources, setResources] = useState<Record<string, ResourceRef>>({});
  const [grants, setGrants] = useState<Record<string, DataUseGrant>>({});
  const [syncing, setSyncing] = useState(true);
  const [confirmation, setConfirmation] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let ignore = false; setResources({}); setGrants({}); setSyncing(true); setConfirmation(undefined);
    async function load() {
      let cursor: string | null = null;
      do { const page = await client.resources(workspaceId, cursor ? { cursor } : {}); if (ignore) return; setResources(current => mergeVersioned(current, page.items)); cursor = page.next_cursor; } while (cursor);
      const loaded: DataUseGrant[] = [];
      do { const page = await client.grants(workspaceId, cursor ? { cursor } : {}); if (ignore) return; setGrants(current => mergeVersioned(current, page.items)); loaded.push(...page.items); cursor = page.next_cursor; } while (cursor);
      onGrantsLoaded?.(loaded);
      if (!ignore) setSyncing(false);
    }
    load().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, workspaceId, sessionId, revision, refreshKey]);
  useEffect(() => { setError(''); }, [workspaceId, sessionId]);
  return <section className="resource-panel" aria-label="授权管理"><h2>资料与授权</h2>
    <p>移除本次附件只改变草稿；撤销授权保留历史；隐私删除请在项目或会话菜单中操作。</p>
    <button onClick={() => { setError(''); setRevision(value => value + 1); }} disabled={busy}>刷新授权</button>
    <button onClick={() => setCreating(true)} disabled={busy || syncing}>新增用途授权</button>
    {creating && <GrantForm client={client} workspaceId={workspaceId} sessionId={sessionId} resources={Object.values(resources)} onBusyChange={onBusyChange} onSaved={onSaved} onGranted={grant => {
      onGrantsLoaded?.([grant]); setRevision(value => value + 1);
    }} />}
    {syncing && <p role="status">资料与授权同步中；未加载部分状态未知。</p>}{error && <p role="alert">{error}</p>}
    {Object.values(grants).filter(grant => sessionId === null || grant.scope.session_id === null || grant.scope.session_id === sessionId).map(grant => <article className="grant-card" key={grant.id}>
      <p>{grant.scope.kind === 'user_global' ? '个人' : grant.scope.session_id ? '指定会话' : '整个项目'} · {grant.status === 'active' ? '有效' : '已撤销'}</p>
      <details><summary>授权范围详情</summary><p>项目 {grant.scope.workspace_id} · 会话 {grant.scope.session_id ?? '整个项目'} · 授权 {grant.id}</p>
        {Object.entries(grant.mcp_versions).map(([id, revision]) => <p key={id}>MCP 返回资料：服务器 {id} · 配置修订 {revision}</p>)}</details>
      <ul>{grant.resource_ids.map(id => <li key={id}>{resources[id]?.label ?? `资料尚未同步 · ${id}`}</li>)}</ul>
      {grant.memory_scopes.map(scope => <p key={`${scope.kind}:${scope.workspace_id}`}>记忆范围：{scope.kind === 'user_global' ? '个人' : '项目记忆'}</p>)}
      <p>{grant.purposes.map(purpose => purposes[purpose]).join(' · ')}</p><p>目的地：{grant.destination ?? '本地导出，无模型目的地'}</p>
      {confirmation === grant.id ? <div className="inline-confirmation"><p>将撤销此授权的全部来源及以上用途，阻止依赖它的新派发；已经发送的内容无法收回，历史不删除。</p>
        <button disabled={busy} onClick={() => setConfirmation(undefined)}>取消撤销</button><button disabled={busy || syncing || isRevokePending?.(grant.id)} onClick={async () => {
          if (inflight.current || isRevokePending?.(grant.id)) return;
          inflight.current = true;
          setBusy(true); setError(''); try { const result = await onRevoke(grant.id, commandMeta(grant.version));
            if (result && typeof result === 'object' && 'status' in result && result.status === 'unconfirmed') setError('撤销提交状态待确认，请在命令状态中核对或用原命令重试。');
            else setRevision(value => value + 1);
          } catch (error) { setError(windowError(error)); if (error instanceof ApiError && error.code === 'version_conflict') setRevision(value => value + 1); } finally { inflight.current = false; setBusy(false); }
        }}>确认撤销整份授权</button></div> : <button disabled={busy || syncing || grant.status !== 'active' || isRevokePending?.(grant.id)} onClick={() => setConfirmation(grant.id)}>撤销这份授权并保留历史</button>}
    </article>)}
    {!syncing && !Object.keys(grants).length && <p>当前范围没有授权。</p>}
  </section>;
}
