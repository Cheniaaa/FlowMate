import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import type { ExecutionEnvironmentPage, ExecutionEnvironmentView, SaveExecutionEnvironmentCommand } from '../../generated/contracts';
import type { createRuntimeStore } from '../../state/runtime-store';
import type { EditorLifecycle } from './Settings';
import IconButton from '../../components/IconButton';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { Textarea } from '../../components/ui/textarea';

const kinds = { python: 'Python', node: 'Node.js', powershell: 'PowerShell', bash: 'Bash' };
const states: Record<ExecutionEnvironmentView['status'], string> = {
  unprobed: '尚未检测', probed: '已完成版本检测', missing_executable: '缺少解释器',
  identity_changed: '解释器身份变化，需重新保存确认', dependency_changed: '依赖清单变化，需重新保存确认',
  probe_failed: '检测失败',
};
const reasons: Record<string, string> = {
  executable_missing: '选定的解释器或 venv 基础解释器文件缺失', identity_changed: '解释器身份已变化',
  dependency_changed: '依赖清单已变化', interpreter_version_changed: '实测版本已变化',
  probe_nonzero_exit: '版本命令退出失败', probe_timed_out: '版本检测超时', probe_cancelled: '版本检测已取消',
  probe_output_truncated: '版本输出超过上限', probe_unexpected_stderr: '版本命令报告错误',
  probe_version_invalid: '未得到有效的版本信息',
};
const absolute = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
type Mode = 'preserve' | 'replace' | 'clear';

export default function ExecutionEnvironments({ client, store, onBusyChange, onSaved, onDiscard, onViewReady, guard = action => action() }:
  { client: RuntimeClient; store: ReturnType<typeof createRuntimeStore> } & EditorLifecycle) {
  const fieldId = useId();
  const revision = useSyncExternalStore(store.subscribe, () => store.getSnapshot().environmentsRevision);
  const [page, setPage] = useState<ExecutionEnvironmentPage>();
  const [selected, setSelected] = useState<ExecutionEnvironmentView | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [manifestMode, setManifestMode] = useState<Mode>('replace');
  const [envMode, setEnvMode] = useState<Mode>('replace');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const inflight = useRef(false);
  const pending = useRef<SaveExecutionEnvironmentCommand | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    client.executionEnvironments().then(value => { if (!disposed) setPage(value); })
      .catch(() => { if (!disposed) setError('无法读取运行环境，请重试'); });
    return () => { disposed = true; };
  }, [client, revision]);
  useEffect(() => {
    if (!selected || dirty || inflight.current || unconfirmed) return;
    const latest = page?.items.find(item => item.id === selected.id);
    if (latest && latest !== selected) {
      setSelected(latest);
      if (latest.revision !== selected.revision) setGeneration(value => value + 1);
    }
    // 只响应权威目录刷新；本地编辑不触发重建，dirty 草稿保留其原 CAS 修订。
  }, [page]);
  useLayoutEffect(() => { if (!busy) onViewReady?.(); }, [editing, generation, busy, onViewReady]);

  function working(value: boolean) { inflight.current = value; setBusy(value); onBusyChange?.(value); }
  function choose(value: ExecutionEnvironmentView | null) {
    guard(() => {
      setSelected(value); setEditing(true); setDirty(false); setGeneration(value => value + 1);
      setManifestMode(value ? 'preserve' : 'replace'); setEnvMode(value ? 'preserve' : 'replace');
      pending.current = undefined; setUnconfirmed(false); setError(''); setStatus('');
    });
  }
  function install(value: ExecutionEnvironmentView) {
    setPage(current => ({ ...current!, items: [...current!.items.filter(item => item.id !== value.id), value] }));
    setSelected(value); setEditing(true); setDirty(false); setGeneration(value => value + 1);
    setManifestMode('preserve'); setEnvMode('preserve'); pending.current = undefined; setUnconfirmed(false);
  }
  function explain(failure: unknown, fallback: string) {
    return failure instanceof ApiError ? `${failure.code}: ${failure.message}` : fallback;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inflight.current) return;
    const target = event.currentTarget;
    const values = new FormData(target);
    const path = String(values.get('executable_path')).trim();
    if (!absolute(path)) { setError('请输入用户选定的解释器绝对路径'); return; }
    const manifests = manifestMode === 'preserve' ? null : manifestMode === 'clear' ? []
      : String(values.get('dependency_manifest_paths') ?? '').split(/\r?\n/).map(path => path.trim()).filter(Boolean);
    if (manifests?.some(path => !absolute(path))) { setError('依赖清单也必须使用用户选定的绝对路径'); return; }
    let env: Record<string, string> | null = envMode === 'preserve' ? null : {};
    if (envMode === 'replace') {
      for (const line of String(values.get('env') ?? '').split(/\r?\n/).filter(line => line.trim())) {
        const separator = line.indexOf('='), key = line.slice(0, separator).trim();
        if (separator < 1 || Object.keys(env!).some(name => name.toUpperCase() === key.toUpperCase())) {
          setError('环境变量请逐行填写 NAME=value，名称不能重复'); return;
        }
        env![key] = line.slice(separator + 1);
      }
    }
    pending.current ??= { meta: commandMeta(selected?.revision ?? null), data: {
      id: selected?.id ?? crypto.randomUUID(), kind: String(values.get('kind')) as ExecutionEnvironmentView['kind'],
      executable_path: path, cwd_mode: String(values.get('cwd_mode')) as ExecutionEnvironmentView['cwd_mode'],
      env, dependency_manifest_paths: manifests,
    } };
    working(true); setError(''); setStatus('');
    try {
      const saved = await client.saveExecutionEnvironment(pending.current);
      // 幂等回执确认原命令；当前配置另行读取，不能用旧回执覆盖后来的修订。
      const latest = await client.executionEnvironment(saved.id);
      install(latest); setStatus('运行环境已保存；版本检测需单独进行'); onSaved?.(target);
    } catch (failure) {
      if (failure instanceof ApiError) pending.current = undefined;
      else setUnconfirmed(true);
      setError(explain(failure, '保存结果尚未确认；可以核对结果或用原命令重试'));
    } finally { working(false); }
  }

  async function check() {
    if (inflight.current || !pending.current) return;
    working(true); setError('');
    try {
      const receipt = await client.executionEnvironmentCommandStatus(pending.current.meta.command_id!);
      if (receipt.status === 'not_found') { setError('尚未查到回执；不代表未保存，可以用原命令重试'); return; }
      const latest = await client.executionEnvironment(receipt.result!.id);
      install(latest); setStatus('已核对运行环境保存结果'); onSaved?.(form.current!);
    } catch (failure) { setError(explain(failure, '无法核对保存结果，请重试')); }
    finally { working(false); }
  }

  async function probe() {
    if (inflight.current || !selected || dirty) return;
    working(true); setError(''); setStatus('正在检测版本…');
    try {
      const value = await client.probeExecutionEnvironment(selected.id);
      install(value);
      setStatus(`检测完成：${states[value.status]}`);
    } catch (failure) { setStatus(''); setError(explain(failure, '版本检测未完成，请检查解释器和 Runtime 状态')); }
    finally { working(false); }
  }
  async function reload() {
    if (inflight.current) return;
    working(true); setError('');
    try { setPage(await client.executionEnvironments()); }
    catch (failure) { setError(explain(failure, '无法读取运行环境')); }
    finally { working(false); }
  }
  async function more() {
    if (inflight.current) return;
    working(true); setError('');
    try {
      const next = await client.executionEnvironments({ cursor: page!.next_cursor! });
      setPage(current => ({ ...next, items: [...current!.items, ...next.items] }));
    } catch (failure) { setError(explain(failure, '无法读取更多运行环境')); }
    finally { working(false); }
  }
  function facts(value: ExecutionEnvironmentView) {
    return <><p>修订 {value.revision} · {states[value.status]}{value.version ? ` · ${value.version}` : ''}</p>
      <p>依赖清单：{value.manifest_count} 个；{value.dependency_coverage === 'manifests_only' ? '仅观测清单内容与存在性' : '依赖尚未核验'}</p>
      {value.checked_at && <p>最近检测：{value.checked_at}</p>}
      {value.diagnostic_code && <p>{reasons[value.diagnostic_code] ?? '检测未完成，请重新确认环境'}</p>}</>;
  }

  return <section aria-labelledby="execution-environments-title">
    <h2 id="execution-environments-title">运行环境</h2>
    <p className="muted">登记用户已经准备的解释器或现有 Python venv。版本检测不证明脚本依赖完整，不会安装依赖或运行 Skill 自检。</p>
    {error && <p role="alert" className="status-message">{error}</p>}
    <p role="status" className="status-message">{status}</p>
    {!editing ? <>
      <Button className="self-start" disabled={busy} onClick={reload}>重新读取运行环境</Button>
      <div className="provider-grid">{page?.items.map(value => <article className="provider-card" key={value.id}>
        <strong>{kinds[value.kind]}</strong><code style={{ overflowWrap: 'anywhere' }}>{value.executable_path}</code>
        {facts(value)}<Button disabled={busy} onClick={() => choose(value)}>编辑 {kinds[value.kind]}</Button>
      </article>)}<Button className="min-h-24 border-dashed" disabled={busy || !page} onClick={() => choose(null)}>登记运行环境</Button></div>
      {!page && !error && <p role="status">正在读取运行环境…</p>}
      {page?.next_cursor && <Button className="self-start" disabled={busy} onClick={more}>更多运行环境</Button>}
    </> : <>
      <IconButton icon="back" label="返回运行环境列表" disabled={busy} onClick={() => guard(() => setEditing(false))} />
      {selected && <>{facts(selected)}<p>完整路径：<code style={{ overflowWrap: 'anywhere' }}>{selected.executable_path}</code></p>
        <p>已保存环境变量：{selected.env_keys.join('、') || '无'}（值不读取）</p></>}
      <form ref={form} className="settings-form" key={`${selected?.id ?? 'new'}:${generation}`} onSubmit={save}
        onChange={() => { setDirty(true); pending.current = undefined; setUnconfirmed(false); }}
        onReset={() => { setDirty(false); pending.current = undefined; setUnconfirmed(false); setManifestMode(selected ? 'preserve' : 'replace'); setEnvMode(selected ? 'preserve' : 'replace'); }}>
        <FieldSet disabled={busy}>
          <FieldLegend>现有解释器与执行配置</FieldLegend>
          <FieldGroup className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2">
          <Field><FieldLabel htmlFor={`${fieldId}-kind`}>解释器类别</FieldLabel>
            <NativeSelect id={`${fieldId}-kind`} name="kind" defaultValue={selected?.kind ?? 'python'}>
              {Object.entries(kinds).map(([kind, label]) => <NativeSelectOption key={kind} value={kind}>{label}</NativeSelectOption>)}
            </NativeSelect></Field>
          <Field><FieldLabel htmlFor={`${fieldId}-path`}>解释器绝对路径</FieldLabel>
            <Input id={`${fieldId}-path`} aria-describedby={`${fieldId}-path-help`} name="executable_path" required defaultValue={selected?.executable_path ?? ''} />
            <FieldDescription id={`${fieldId}-path-help`}>可填写现有 venv 的 Scripts\python.exe；始终按选定路径启动。</FieldDescription>
          </Field>
          <Field><FieldLabel htmlFor={`${fieldId}-cwd`}>工作目录模式</FieldLabel>
            <NativeSelect id={`${fieldId}-cwd`} name="cwd_mode" defaultValue={selected?.cwd_mode ?? 'attempt'}>
              <NativeSelectOption value="attempt">本次工作目录</NativeSelectOption><NativeSelectOption value="package_copy">本次包执行副本</NativeSelectOption>
            </NativeSelect></Field>
          <Field><FieldLabel htmlFor={`${fieldId}-manifest`}>依赖清单处理</FieldLabel>
            <NativeSelect id={`${fieldId}-manifest`} value={manifestMode} onChange={event => setManifestMode(event.target.value as Mode)}>
              {selected && <NativeSelectOption value="preserve">保留已登记清单</NativeSelectOption>}<NativeSelectOption value="replace">重新指定清单</NativeSelectOption><NativeSelectOption value="clear">移除全部清单</NativeSelectOption>
            </NativeSelect></Field>
          {manifestMode === 'replace' && <Field className="col-span-full"><FieldLabel htmlFor={`${fieldId}-manifest-paths`}>依赖清单绝对路径（每行一个）</FieldLabel>
            <Textarea id={`${fieldId}-manifest-paths`} name="dependency_manifest_paths" /></Field>}
          <Field className="col-span-full"><FieldLabel htmlFor={`${fieldId}-env`}>环境变量处理</FieldLabel>
            <NativeSelect id={`${fieldId}-env`} value={envMode} onChange={event => setEnvMode(event.target.value as Mode)}>
              {selected && <NativeSelectOption value="preserve">保留已保存环境变量</NativeSelectOption>}<NativeSelectOption value="replace">重新指定非秘密变量</NativeSelectOption><NativeSelectOption value="clear">移除全部环境变量</NativeSelectOption>
            </NativeSelect></Field>
          {envMode === 'replace' && <Field className="col-span-full"><FieldLabel htmlFor={`${fieldId}-env-values`}>非秘密环境变量（每行 NAME=value）</FieldLabel>
            <Textarea id={`${fieldId}-env-values`} name="env" autoComplete="off" /></Field>}
          <div role="group" aria-label="运行环境操作" className="col-span-full flex flex-wrap items-center gap-2">
            <Button type="submit" variant="default" disabled={busy}>保存运行环境</Button>
            {unconfirmed && <Button type="button" disabled={busy} onClick={check}>核对保存结果</Button>}
            <Button type="button" disabled={busy || !selected || dirty || unconfirmed} onClick={probe}>检测版本</Button>
            <Button type="button" disabled={busy} onClick={() => { onDiscard?.(form.current!); setEditing(false); setDirty(false); pending.current = undefined; }}>取消编辑</Button>
          </div>
          {dirty && <FieldDescription className="col-span-full">先保存更改后再检测。</FieldDescription>}
          </FieldGroup>
        </FieldSet>
      </form>
    </>}
  </section>;
}
