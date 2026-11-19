import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { RuntimeClient } from '../../api/client';
import { validate } from '../../api/validation';
import { windowError } from '../../api/windows';
import type { Workspace, WorkspaceDirectoryView } from '../../generated/contracts';
export default function ProjectDirectory({ client, workspace, onLink, blocked }: {
  client: RuntimeClient; workspace: Workspace; onLink: (id: string | null, version: number) => Promise<unknown>;
  blocked?: boolean;
}) {
  const [directory, setDirectory] = useState<WorkspaceDirectoryView>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const view = useRef({ workspaceId: workspace.id });
  if (view.current.workspaceId !== workspace.id) view.current = { workspaceId: workspace.id };
  const inflight = useRef(false);
  useEffect(() => {
    let ignore = false; setDirectory(undefined); setError('');
    client.workspaceDirectory(workspace.id).then(value => { if (!ignore) setDirectory(value); }).catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, workspace.id, workspace.version, revision]);
  async function link(choose: boolean) {
    if (inflight.current || blocked || !directory) return;
    const request = view.current;
    inflight.current = true; setBusy(true); setError('');
    try {
      let id: string | null = null;
      if (choose) {
        const selection = await invoke<{ resources: unknown[] }>('select_resources', { scope: { kind: 'workspace', workspace_id: workspace.id, session_id: null }, kind: 'directory' });
        if (view.current !== request || !selection.resources.length) return;
        id = validate('ResourceRef', selection.resources[0]).id;
      }
      await onLink(id, directory.workspace_version); setRevision(value => value + 1);
    } catch (error) { if (view.current === request) setError(windowError(error)); } finally { inflight.current = false; setBusy(false); }
  }
  return <section className="project-directory" aria-label="项目目录"><p>目录：{directory?.resource?.label ?? (directory?.state === 'unlinked' ? '未关联' : '正在查询')}</p>
    {directory?.state === 'unavailable' && <p>目录失效：{directory.reason}</p>}
    <p className="muted">关联目录不会授权读取，也不会加入本次附件。</p>
    {error && <p role="alert">{error}</p>}{blocked && <p>目录命令待核对或同步，请使用原命令入口。</p>}<button disabled={busy || blocked || !directory} onClick={() => void link(true)}>关联/更换目录</button><button disabled={busy || blocked || !directory || directory.state === 'unlinked'} onClick={() => void link(false)}>解除关联</button>
  </section>;
}
