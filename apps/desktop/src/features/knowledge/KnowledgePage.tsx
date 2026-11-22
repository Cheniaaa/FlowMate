import { useEffect, useRef, useState } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type { KnowledgeJob, KnowledgeJobPage, KnowledgeSourcePage, TaskHandle } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import IconButton from '../../components/IconButton';
import { cn } from '../../lib/utils';
import KnowledgeSourceDetail, { sourceState } from './KnowledgeSourceDetail';
import KnowledgeImport, { type KnowledgeImportHandle } from './KnowledgeImport';
import KnowledgeSettings from './KnowledgeSettings';

export interface KnowledgePageProps {
  client: RuntimeClient;
  workspaceId: string;
  refreshKey?: string;
  onOpenTask?: (task: TaskHandle) => void;
  sourceId?: string | null;
  profileRefreshKey?: string;
  onConfigureModels?: () => void;
}

export default function KnowledgePage(props: KnowledgePageProps) {
  return <KnowledgePageView key={props.workspaceId} {...props} />;
}

function KnowledgePageView({ client, workspaceId, refreshKey, onOpenTask, sourceId, profileRefreshKey, onConfigureModels }: KnowledgePageProps) {
  const [sources, setSources] = useState<KnowledgeSourcePage>(), [jobs, setJobs] = useState<KnowledgeJobPage>();
  const [selected, select] = useState(sourceId ?? ''), [revision, refresh] = useState(0);
  const [showDetail, setShowDetail] = useState(!!sourceId), listSelection = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const importEditor = useRef<KnowledgeImportHandle>(null);
  const inflight = useRef(false), sourceDepth = useRef(1), jobDepth = useRef(1);
  useEffect(() => { if (sourceId) { select(sourceId); setShowDetail(true); } }, [sourceId]);
  useEffect(() => { if (!showDetail) listSelection.current?.focus(); }, [showDetail]);
  useEffect(() => {
    let ignore = false;
    async function read() {
      const [sourcePage, jobPage] = await Promise.all([client.knowledgeSources(workspaceId), client.knowledgeJobs(workspaceId)]);
      for (let index = 1; sourcePage.next_cursor && (index < sourceDepth.current
        || !!sourceId && !sourcePage.items.some(item => item.id === sourceId)); index++) {
        const next = await client.knowledgeSources(workspaceId, { cursor: sourcePage.next_cursor });
        Object.assign(sourcePage, { ...next, items: [...sourcePage.items, ...next.items] });
        sourceDepth.current = Math.max(sourceDepth.current, index + 1);
      }
      for (let index = 1; index < jobDepth.current && jobPage.next_cursor; index++) {
        const next = await client.knowledgeJobs(workspaceId, { cursor: jobPage.next_cursor });
        Object.assign(jobPage, { ...next, items: [...jobPage.items, ...next.items] });
      }
      if (!ignore) {
        setSources(sourcePage); setJobs(jobPage);
        select(current => sourcePage.items.some(item => item.id === current) ? current : sourcePage.items[0]?.id ?? '');
      }
    }
    void read().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, workspaceId, refreshKey, revision, sourceId]);

  async function act(action: () => Promise<void>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) { setError(windowError(error)); }
    finally { inflight.current = false; setBusy(false); }
  }
  async function cancel(job: KnowledgeJob) {
    await client.cancelKnowledgeJob(job.id, { meta: commandMeta(job.revision), data: {} });
    refresh(value => value + 1);
  }
  const detail = sources?.items.find(item => item.id === selected);
  return <section className="workbench-page ui-page-motion flex min-w-0 flex-col gap-4" aria-label="项目资料">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="m-0 text-lg font-semibold">项目资料</h1>
        <p className="m-0 mt-1 text-sm text-muted-foreground">加入 MD、TXT 文件，供本项目的对话使用。</p></div>
      <div className="flex flex-wrap gap-2">
        <IconButton icon="refresh" label="刷新资料" disabled={busy} onClick={() => refresh(value => value + 1)} />
      </div>
    </header>
    <KnowledgeImport ref={importEditor} client={client} workspaceId={workspaceId} onImported={() => refresh(value => value + 1)} />
    <details onToggle={event => setSettingsOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm">检索与发送设置</summary>
      {settingsOpen && <div className="mt-3"><KnowledgeSettings client={client} workspaceId={workspaceId}
        refreshKey={`${refreshKey ?? ''}:${profileRefreshKey ?? ''}`}
        onOpenTask={onOpenTask} onConfigureModels={onConfigureModels} /></div>}
    </details>
    {error && <p role="alert" className="m-0 text-sm">{error}</p>}
    {!sources && !error && <p role="status">正在读取项目资料…</p>}
    {sources?.items.length === 0 && <p className="py-8 text-center text-muted-foreground">本项目还没有资料，加入文件后即可在对话中使用。</p>}
    {!!sources?.items.length && <div className="grid min-w-0 grid-cols-1 overflow-hidden rounded-lg border border-border md:grid-cols-[minmax(180px,30%)_minmax(0,1fr)]">
      <nav aria-label="项目资料列表" className={cn('min-w-0 flex-col gap-1 border-b border-border bg-muted/40 p-2 md:flex md:border-r md:border-b-0',
        showDetail ? 'hidden' : 'flex')}>
        {sources.items.map(item => {
          const duplicate = sources.items.some(other => other.id !== item.id && other.label === item.label);
          return <Button key={item.id} variant={selected === item.id ? 'secondary' : 'ghost'}
            ref={selected === item.id ? listSelection : undefined}
            className="h-auto flex-col items-start gap-1 whitespace-normal px-3 py-2 text-start"
            aria-pressed={selected === item.id} onClick={() => { select(item.id); setShowDetail(true); }}>
            <span className="break-words">{item.label}</span>
            {duplicate && <span className="text-xs text-muted-foreground">{item.origin_hint}
              {item.origin_hint && item.added_at && ' · '}
              {item.added_at && <>加入于 <time dateTime={item.added_at}>{new Date(item.added_at).toLocaleString('zh-CN')}</time></>}
            </span>}
            <span className="text-xs text-muted-foreground">{sourceState(item)}
              {item.cleanup_status === 'failed' && ' · 清理未完成'}</span>
          </Button>;
        })}
        {sources.next_cursor && <Button size="sm" disabled={busy} onClick={() => void act(async () => {
          const next = await client.knowledgeSources(workspaceId, { cursor: sources.next_cursor! });
          sourceDepth.current++; setSources({ ...next, items: [...sources.items, ...next.items] });
        })}>更多资料</Button>}
      </nav>
      {detail && <div className={cn('min-w-0 md:block', showDetail ? 'block' : 'hidden')}>
        <KnowledgeSourceDetail client={client} source={detail} jobs={jobs?.items.filter(item => item.source_id === detail.id) ?? []}
          busy={busy} onCancel={job => void act(() => cancel(job))} onOpenTask={onOpenTask}
          onChanged={() => refresh(value => value + 1)} onUpdate={() => importEditor.current!.update(detail)}
          onBack={() => setShowDetail(false)} />
      </div>}
    </div>}
    {jobs?.next_cursor && <Button className="self-start" disabled={busy} onClick={() => void act(async () => {
      const next = await client.knowledgeJobs(workspaceId, { cursor: jobs.next_cursor! });
      jobDepth.current++; setJobs({ ...next, items: [...jobs.items, ...next.items] });
    })}>更多处理记录</Button>}
  </section>;
}
