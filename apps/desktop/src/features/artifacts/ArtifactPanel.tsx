import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, type RuntimeClient } from '../../api/client';
import type { ArtifactRef, TextSlice } from '../../generated/contracts';
import { artifactDocument } from '../../components/Markdown';
import { Button } from '../../components/ui/button';
import { useDocumentTheme, useTextSize } from '../../components/documentAppearance';
import McpArtifactSource from './McpArtifactSource';
import ArtifactImage from './ArtifactImage';

interface ArtifactPanelProps {
  artifact: ArtifactRef | null;
  client: RuntimeClient;
  label?: string;
  onExport?: (artifact: ArtifactRef) => Promise<void>;
  onSelectSource?: (taskId: string, activityId: string) => void;
  exportBlocked?: boolean;
}

function formatJsonPage(text: string) {
  let depth = 0;
  let lines = '';
  // 直接格式化 JSON 标记，保留大整数、转义与原始键顺序。
  const tokens = text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g) ?? [];
  const newline = () => '\n' + '  '.repeat(Math.min(depth, 12));
  for (const [index, token] of tokens.entries()) {
    if (token === '{' || token === '[') {
      depth += 1;
      lines += token + (tokens[index + 1] === '}' || tokens[index + 1] === ']' ? '' : newline());
    } else if (token === '}' || token === ']') {
      depth -= 1;
      lines += (tokens[index - 1] === '{' || tokens[index - 1] === '[' ? '' : newline()) + token;
    } else {
      lines += token === ',' ? `,${newline()}` : token === ':' ? ': ' : token;
    }
  }
  return lines;
}

export default function ArtifactPanel({ artifact, label, ...props }: ArtifactPanelProps) {
  return <section className="artifact-panel" aria-label="产物详情">
    <h3>{label ?? '产物'}</h3>
    {artifact ? <ArtifactPreview key={`${artifact.id}:${artifact.version}`} artifact={artifact} {...props} /> : <p>选择产物以预览</p>}
  </section>;
}

function ArtifactPreview({ artifact, client, onExport, onSelectSource, exportBlocked }: ArtifactPanelProps & { artifact: ArtifactRef }) {
  const [view, setView] = useState<'text' | 'structured'>('text');
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets[offsets.length - 1];
  const [content, setContent] = useState<{ offset: number; view: typeof view; slice: TextSlice | null; error: string }>({ offset, view, slice: null, error: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const exporting = useRef(false);
  const current = content.offset === offset && content.view === view;
  const slice = current ? content.slice : null;
  const image = artifact.media_type === 'image/png' || artifact.media_type === 'image/jpeg';
  const mediaType = artifact.media_type;
  const textual = mediaType === 'text/plain' || mediaType === 'text/markdown' || mediaType === 'application/json';
  const theme = useDocumentTheme();
  const textSize = useTextSize();
  const document = useMemo(() => {
    if (!slice || !textual) return null;
    const format = view === 'structured' ? 'application/json' : mediaType;
    const text = format === 'application/json' && slice.start === 0 && slice.end === slice.total_chars
      ? formatJsonPage(slice.text) : slice.text;
    return artifactDocument(text, format, theme);
  }, [slice, mediaType, textual, theme, textSize, view]);

  useEffect(() => {
    if (!textual) return;
    let ignore = false;
    setContent(previous => ({ ...previous, offset, view, error: '', slice: null }));
    client.artifactContent(artifact.id, offset, view).then(slice => {
      if (!ignore) setContent({ offset, view, slice, error: '' });
    }).catch(() => {
      if (!ignore) setContent({ offset, view, slice: null, error: '产物内容加载失败' });
    });
    return () => { ignore = true; };
  }, [client, artifact.id, offset, textual, view]);

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
    <div className="artifact-actions">
      {onSelectSource && <Button type="button" size="sm" variant="ghost" onClick={() => onSelectSource(artifact.task_id, artifact.activity_id)}>定位来源</Button>}
      {onExport && <Button type="button" size="sm" disabled={busy || exportBlocked} onClick={() => { void exportArtifact(); }}>{busy ? '正在导出…' : '导出产物'}</Button>}
      {exportBlocked && !busy && <p>导出命令待核对或同步，请使用原命令入口；不会重开保存选择。</p>}
    </div>
    {(slice?.has_structured_content || view === 'structured') && <Button type="button" size="sm" variant="outline" onClick={() => {
      setView(view === 'text' ? 'structured' : 'text');
      setOffsets([0]);
    }}>{view === 'text' ? '查看历史回执的业务 JSON' : '返回历史回执正文'}</Button>}
    {image ? <ArtifactImage id={artifact.id} client={client} /> : !textual ? <p>二进制文件，可导出到本机。</p> : current && content.error
      ? <p role="alert">{content.error}</p> : !slice && <p role="status">正在加载产物…</p>}
    {slice && document && <>
      <p className="artifact-range">字符 {slice.start}–{slice.end} / {slice.total_chars}</p>
      <iframe title="产物预览" sandbox="" srcDoc={document.srcDoc} />
      {document.links.length > 0 && <ul className="artifact-links" aria-label="产物外部链接">
        {document.links.map((link, index) => <li key={`${index}:${link.url}`}>
          <Button type="button" size="sm" variant="link" className="block whitespace-normal break-all text-left" onClick={() => { void open(link.url); }}
            aria-label={`打开外部链接：${link.label}`}>{link.label} · {link.url}</Button>
        </li>)}
      </ul>}
    </>}
    {textual && <nav className="artifact-pagination" aria-label="产物分段">
      <Button type="button" size="sm" variant="ghost" disabled={!slice || offsets.length === 1} onClick={() => setOffsets(previous => previous.slice(0, -1))}>前文</Button>
      <Button type="button" size="sm" disabled={!slice || slice.end >= slice.total_chars} onClick={() => { if (slice) setOffsets(previous => [...previous, slice.end]); }}>下一段</Button>
    </nav>}
    {error && <p role="alert">{error}</p>}
  </>;
}
