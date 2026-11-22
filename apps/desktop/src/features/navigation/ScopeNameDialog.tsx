import { useEffect, useId, useRef, useState } from 'react';
import { commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import Dialog from '../../components/Dialog';
import { Button } from '../../components/ui/button';
import { Field, FieldGroup, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import type { Session, Workspace } from '../../generated/contracts';

export default function ScopeNameDialog({ client, target, onClose, onReturnFocus, onRenamed, suggest = false }: {
  client: RuntimeClient;
  target: Session | Workspace;
  onClose: () => void;
  onReturnFocus: () => void;
  onRenamed: (target: Session | Workspace) => void;
  suggest?: boolean;
}) {
  const isSession = 'title' in target;
  const [name, setName] = useState(isSession ? target.title : target.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const fieldId = useId();
  const [suggestionMeta] = useState(() => suggest ? commandMeta(target.version) : undefined);
  const [suggestion, setSuggestion] = useState('');
  const [suggesting, setSuggesting] = useState(suggest);
  useEffect(() => {
    if (!suggestionMeta) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read(id: string) {
      const { run } = await client.run(id, controller.signal);
      if (controller.signal.aborted) return;
      if (run.state === 'completed' && run.output) {
        setSuggestion(run.output.summary);
        setSuggesting(false);
      } else if (['completed', 'failed', 'cancelled', 'interrupted', 'blocked_incompatible'].includes(run.state)) {
        setError('未取得项目名称建议。');
        setSuggesting(false);
      } else {
        timer = setTimeout(() => void read(id).catch(report), 600);
      }
    }
    function report(reason: unknown) {
      if (controller.signal.aborted) return;
      setError(windowError(reason));
      setSuggesting(false);
    }
    void client.suggestProjectTitle(target.id, suggestionMeta).then(run => {
      if (!controller.signal.aborted) return read(run.id);
    }).catch(report);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [client, suggestionMeta, target.id]);
  return <Dialog title={isSession ? '重命名会话' : '重命名项目'} onClose={() => { if (!pending.current) onClose(); }} onReturnFocus={onReturnFocus}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (pending.current || !name.trim()) return;
      pending.current = true;
      setBusy(true);
      setError('');
      const command = { meta: commandMeta(target.version), data: { name: name.trim() } };
      try {
        onRenamed(await (isSession ? client.renameSession(target.id, command) : client.renameWorkspace(target.id, command)));
      } catch (reason) {
        setError(windowError(reason));
      } finally {
        pending.current = false;
        setBusy(false);
      }
    }}>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={fieldId}>{isSession ? '会话标题' : '项目名称'}</FieldLabel>
          <Input id={fieldId} autoFocus required maxLength={256} readOnly={busy}
            value={name} onChange={event => setName(event.target.value)} />
        </Field>
        {suggesting && <p role="status">正在拟定项目名称…</p>}
        {suggestion && <div>
          <p className="wrap-anywhere">建议名称：{suggestion}</p>
          <Button type="button" variant="outline" disabled={busy} onClick={() => {
            setName(suggestion); setSuggestion('');
          }}>采用建议</Button>
        </div>}
        {error && <p role="alert">{error}</p>}
        <div className="button-row">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" variant="default" disabled={busy || !name.trim()}>保存名称</Button>
        </div>
      </FieldGroup>
    </form>
  </Dialog>;
}
