import { useEffect, useState } from 'react';
import type { RuntimeClient } from '../../api/client';
import { Button } from '../../components/ui/button';
import Dialog from '../../components/Dialog';

export default function ArtifactImage({ id, client, label = '工具图片' }: {
  id: string; client: RuntimeClient; label?: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl = '';
    client.artifactImage(id, abort.signal).then(blob => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (!abort.signal.aborted) setError('图片无法打开，请检查产物是否仍可用。'); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, id]);
  return <figure className="flex flex-col items-start gap-2">
    {error ? <p role="alert">{error}</p> : url ? <>
      <Button type="button" variant="ghost" className="h-auto p-1" aria-label={`打开原图：${label}`} onClick={() => setOpen(true)}>
        <img src={url} alt={label} className="max-h-48 max-w-full object-contain" />
      </Button>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>打开原图</Button>
    </> : <p role="status">正在加载图片…</p>}
    {open && <Dialog title={label} onClose={() => setOpen(false)}>
      <img src={url} alt={`${label}原图`} className="max-h-[70vh] max-w-full object-contain" />
    </Dialog>}
  </figure>;
}
