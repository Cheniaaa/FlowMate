import { useEffect, useRef, useState } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { mergeVersioned } from '../../api/events';
import type { CommandMeta, DataUseGrant, ResourceRef } from '../../generated/contracts';
import { windowError } from '../../api/windows';
const purposes = { read: '读取', model_send: '发送至模型', export: '导出' };
export default function ResourcePanel({ client, workspaceId, sessionId, onRevoke, onGrantsLoaded, refreshKey, isRevokePending }: {
  client: RuntimeClient; workspaceId: string; sessionId: string | null; onRevoke: (id: string, meta: CommandMeta) => Promise<unknown>;
  onGrantsLoaded?: (grants: DataUseGrant[]) => void;
  refreshKey?: string | number; isRevokePending?: (id: string) => boolean;
}) {
  const [resources, setResources] = useState<Record<string, ResourceRef>>({});
  const [grants, setGrants] = useState<Record<string, DataUseGrant>>({});
  const [syncing, setSyncing] = useState(true);
  const [confirmation, setConfirmation] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
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
    {syncing && <p role="status">资料与授权同步中；未加载部分状态未知。</p>}{error && <p role="alert">{error}</p>}
    {Object.values(grants).filter(grant => sessionId === null || grant.scope.session_id === null || grant.scope.session_id === sessionId).map(grant => <article className="grant-card" key={grant.id}>
      <p>项目 {grant.scope.workspace_id} · {grant.scope.session_id ? `会话 ${grant.scope.session_id}` : '整个项目'} · {grant.status === 'active' ? '有效' : '已撤销'}</p>
      <ul>{grant.resource_ids.map(id => <li key={id}>{resources[id]?.label ?? `资料尚未同步 · ${id}`}</li>)}</ul>
      <p>{grant.purposes.map(purpose => purposes[purpose]).join(' · ')}</p><p>目的地：{grant.destination ?? '本地导出，无模型目的地'}</p>
      {confirmation === grant.id ? <div className="inline-confirmation"><p>将撤销此授权的全部 {grant.resource_ids.length} 份资料及以上用途，阻止依赖它的新派发；已经发送的内容无法收回，历史不删除。</p>
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
