import { useEffect, useRef, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { EvidencePage } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import IconButton from '../../components/IconButton';

export interface EvidenceReaderProps {
  client: RuntimeClient;
  workspaceId: string;
  evidenceId: string;
  onClose: () => void;
  refreshKey?: string;
}

export default function EvidenceReader(props: EvidenceReaderProps) {
  return <EvidenceReaderView key={`${props.workspaceId}:${props.evidenceId}`} {...props} />;
}

function EvidenceReaderView({ client, workspaceId, evidenceId, onClose, refreshKey }: EvidenceReaderProps) {
  const [offsets, setOffsets] = useState([0]), [retry, setRetry] = useState(0);
  const [data, setData] = useState<{ key: string; page?: EvidencePage; label?: string; removed?: boolean; error?: string }>();
  const heading = useRef<HTMLHeadingElement>(null), origin = useRef<HTMLElement | null>(null);
  const offset = offsets.at(-1)!, key = `${offset}:${retry}:${refreshKey}`;
  useEffect(() => {
    origin.current = document.activeElement as HTMLElement; heading.current?.focus();
    return () => { if (origin.current?.isConnected) origin.current.focus(); };
  }, []);
  useEffect(() => {
    let ignore = false;
    async function read() {
      const value = await client.knowledgeEvidence(workspaceId, evidenceId, { offset });
      if (value.evidence.id !== evidenceId) throw new Error('原文响应与所选引用不符，请重新打开引用。');
      let sources = await client.knowledgeSources(workspaceId);
      let source = sources.items.find(item => item.id === value.evidence.source_id);
      while (!source && sources.next_cursor) {
        sources = await client.knowledgeSources(workspaceId, { cursor: sources.next_cursor });
        source = sources.items.find(item => item.id === value.evidence.source_id);
      }
      if (!source) throw new Error('原文所属资料当前不可用。');
      if (source.status === 'revoked' || source.status === 'deleted') throw new Error('资料已撤权或删除，原文不可用。');
      if (!ignore) setData({ key, page: value, label: source.label, removed: source.status === 'removed' });
    }
    void read().catch(error => { if (!ignore) setData({ key, error: windowError(error) }); });
    return () => { ignore = true; };
  }, [client, workspaceId, evidenceId, key]);
  const current = data?.key === key ? data : undefined, page = current?.page;
  function close() { if (origin.current?.isConnected) origin.current.focus(); onClose(); }
  return <section aria-label="引用原文" className="ui-surface-motion flex min-w-0 flex-col gap-3"
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); close();
      }
    }}>
    <header className="flex items-center justify-between gap-3">
      <h2 ref={heading} tabIndex={-1} className="m-0 text-lg font-semibold">{current?.label ?? '引用原文'}</h2>
      <IconButton icon="close" label="关闭原文" size="icon-sm" onClick={close} />
    </header>
    {!current && <p role="status">正在读取引用原文…</p>}
    {current?.error && <><p role="alert">{current.error}</p><Button onClick={() => setRetry(value => value + 1)}>重试</Button></>}
    {page && <>
      {current?.removed && <p className="m-0 text-sm">资料已移出项目，当前查看答复所引的历史原文。</p>}
      <p className="m-0 text-sm text-muted-foreground">第 {page.evidence.locator.start_line}–{page.evidence.locator.end_line} 行</p>
      {page.current_version !== null && page.current_version !== page.evidence.source_version
        && <p className="m-0 text-sm">答复引用时的内容，当前已有更新</p>}
      {page.evidence.locator.heading_path.length > 0 && <p className="m-0 text-sm text-muted-foreground">
        {page.evidence.locator.heading_path.join(' / ')}</p>}
      <pre className="m-0 max-h-[60dvh] min-h-32 overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-sans text-reading leading-relaxed whitespace-pre-wrap break-words">{page.text}</pre>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">引用详情</summary>
        <p className="my-1">引用版本 {page.evidence.source_version}</p>
        <p className="my-1">原文字符 {page.offset}–{page.offset + Array.from(page.text).length} / {page.total_chars}</p>
      </details>
    </>}
    <nav aria-label="原文分段" className="flex flex-wrap gap-2">
      <Button size="sm" disabled={!page || offsets.length === 1} onClick={() => { heading.current?.focus(); setOffsets(current => current.slice(0, -1)); }}>上一段原文</Button>
      <Button size="sm" disabled={!page || page.next_offset === null} onClick={() => {
        if (page?.next_offset !== null && page?.next_offset !== undefined) { heading.current?.focus(); setOffsets(current => [...current, page.next_offset!]); }
      }}>下一段原文</Button>
    </nav>
  </section>;
}
