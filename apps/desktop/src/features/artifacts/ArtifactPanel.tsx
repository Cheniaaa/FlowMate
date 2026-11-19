import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, type RuntimeClient } from '../../api/client';
import type { ArtifactRef, TextSlice } from '../../generated/contracts';
import { artifactDocument } from '../../components/Markdown';
import McpArtifactSource from './McpArtifactSource';

interface ArtifactPanelProps {
  artifact: ArtifactRef | null;
  client: RuntimeClient;
  onExport?: (artifact: ArtifactRef) => Promise<void>;
  onSelectSource?: (taskId: string, activityId: string) => void;
  exportBlocked?: boolean;
}

export default function ArtifactPanel({ artifact, ...props }: ArtifactPanelProps) {
  return <section className="artifact-panel" aria-label="产物详情">
    <h2>产物</h2>
    {artifact ? <ArtifactPreview key={`${artifact.id}:${artifact.version}`} artifact={artifact} {...props} /> : <p>选择产物以预览</p>}
  </section>;
}

function ArtifactPreview({ artifact, client, onExport, onSelectSource, exportBlocked }: ArtifactPanelProps & { artifact: ArtifactRef }) {
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets[offsets.length - 1];
  const [content, setContent] = useState<{ offset: number; slice: TextSlice | null; error: string }>({ offset, slice: null, error: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const exporting = useRef(false);
  const slice = content.offset === offset ? content.slice : null;
  const binary = artifact.media_type === 'application/octet-stream';
  const document = useMemo(() => slice && artifact.media_type !== 'application/octet-stream'
    ? artifactDocument(slice.text, artifact.media_type) : null, [slice, artifact.media_type]);

  useEffect(() => {
    if (binary) return;
    let ignore = false;
    setContent({ offset, slice: null, error: '' });
    client.artifactContent(artifact.id, offset).then(slice => {
      if (!ignore) setContent({ offset, slice, error: '' });
    }).catch(() => {
      if (!ignore) setContent({ offset, slice: null, error: '产物内容加载失败' });
    });
    return () => { ignore = true; };
  }, [client, artifact.id, offset, binary]);

  async function exportArtifact() {
    if (exporting.current || exportBlocked || !onExport) return;
    exporting.current = true; setBusy(true);
    setError('');
    try { await onExport(artifact); }
    catch (error) { setError(error instanceof ApiError ? `${error.code}: ${error.message}` : '产物导出失败'); }
    finally { exporting.current = false; setBusy(false); }
  }

  async function open(url: string) {
    setError('');
    try { await invoke('open_external', { url }); }
    catch { setError('无法打开外部链接，请检查系统浏览器设置'); }
  }

  return <>
    <McpArtifactSource artifact={artifact} client={client} />
    <details className="artifact-source"><summary>来源技术详情</summary><dl>
      <dt>来源 hash</dt><dd>{artifact.content_hash}</dd>
      <dt>Task</dt><dd>{artifact.task_id}</dd>
      <dt>Activity</dt><dd>{artifact.activity_id}</dd>
    </dl></details>
    <div className="artifact-actions">
      {onSelectSource && <button type="button" onClick={() => onSelectSource(artifact.task_id, artifact.activity_id)}>定位来源</button>}
      {onExport && <button type="button" disabled={busy || exportBlocked} onClick={() => { void exportArtifact(); }}>{busy ? '正在导出…' : '导出产物'}</button>}
      {exportBlocked && !busy && <p>导出命令待核对或同步，请使用原命令入口；不会重开保存选择。</p>}
    </div>
    {binary ? <p>二进制文件，可导出到本机。</p> : content.offset === offset && content.error
      ? <p role="alert">{content.error}</p> : !slice && <p role="status">正在加载产物…</p>}
    {slice && document && <>
      <p className="artifact-range">字符 {slice.start}–{slice.end} / {slice.total_chars} · 版本 {slice.source_version}</p>
      <iframe title="产物预览" sandbox="" srcDoc={document.srcDoc} />
      {document.links.length > 0 && <ul className="artifact-links" aria-label="产物外部链接">
        {document.links.map((link, index) => <li key={`${index}:${link.url}`}><button type="button" onClick={() => { void open(link.url); }} aria-label={`打开外部链接：${link.label}`}>{link.label} · {link.url}</button></li>)}
      </ul>}
    </>}
    {!binary && <nav className="artifact-pagination" aria-label="产物分段">
      <button type="button" disabled={!slice || offsets.length === 1} onClick={() => setOffsets(previous => previous.slice(0, -1))}>前文</button>
      <button type="button" disabled={!slice || slice.end >= slice.total_chars} onClick={() => { if (slice) setOffsets(previous => [...previous, slice.end]); }}>下一段</button>
    </nav>}
    {error && <p role="alert">{error}</p>}
  </>;
}
