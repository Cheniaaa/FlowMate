import { useEffect, useRef, useState } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { openSettings, windowError } from '../../api/windows';
import { Button } from '../../components/ui/button';
import { FieldLabel } from '../../components/ui/field';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import type {
  BindSkillCommand, CommandMeta, ExecutionEnvironmentPage, ExecutionEnvironmentView,
  SaveSkillExecutionPermissionCommand, ScopeRef, SkillExecutionPermission, SkillScriptSettings, SkillVersion,
} from '../../generated/contracts';
import { skillQuery } from './skill-query';

type Pending = { kind: 'save'; command: SaveSkillExecutionPermissionCommand; use?: boolean }
  | { kind: 'revoke'; id: string; meta: CommandMeta } | { kind: 'bind'; command: BindSkillCommand };
const extensions = { python: ['.py'], node: ['.js', '.mjs', '.cjs'], powershell: ['.ps1'], bash: ['.sh'] };
const names = { python: 'Python', node: 'Node.js', powershell: 'PowerShell', bash: 'Bash' };
function entryKinds(scripts: string[]) {
  return (Object.keys(extensions) as ExecutionEnvironmentView['kind'][])
    .filter(kind => scripts.some(path => extensions[kind].some(extension => path.endsWith(extension))));
}

export default function SkillExecution({ client, version, scope, onChanged, onBusyChange, onUse }: {
  client: RuntimeClient; version: SkillVersion; scope: ScopeRef; onChanged: () => void; onBusyChange?: (busy: boolean) => void;
  onUse?: (permission: SkillExecutionPermission) => Promise<void>;
}) {
  const [settings, setSettings] = useState<SkillScriptSettings>();
  const [environment, setEnvironment] = useState<ExecutionEnvironmentView>();
  const [options, setOptions] = useState<ExecutionEnvironmentPage>();
  const [chosen, setChosen] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const working = useRef(false);
  useEffect(() => { onBusyChange?.(busy || !!pending); return () => onBusyChange?.(false); }, [busy, pending, onBusyChange]);
  useEffect(() => {
    let ignore = false;
    async function load() {
      const value = await client.skillScriptSettings(version.skill_id, version.content_hash, skillQuery(scope));
      if (ignore) return;
      setSettings(value);
      if (value.binding?.environment_id) {
        const configured = await client.executionEnvironment(value.binding.environment_id);
        if (!ignore) setEnvironment(configured);
      } else {
        const page = await client.discoverExecutionEnvironments({
          workspace_id: scope.workspace_id ?? undefined, kinds: entryKinds(value.scripts),
        });
        if (!ignore) {
          const registered = [...new Set(value.permissions.filter(item => item.status === 'active'
            && !page.items.some(env => env.id === item.environment_id)).map(item => item.environment_id))];
          const additional = await Promise.all(registered.map(id => client.executionEnvironment(id)));
          if (ignore) return;
          page.items = [...page.items, ...additional];
          setOptions(page);
          const trusted = page.items.filter(item => item.status === 'probed' && value.scripts.length > 0
            && value.scripts.some(path => extensions[item.kind].some(extension => path.endsWith(extension))));
          const permitted = trusted.filter(env => value.permissions.some(item => item.status === 'active'
            && item.environment_id === env.id && item.environment_revision === env.revision));
          if (permitted.length === 1) setChosen(permitted[0].id);
          else if (trusted.length === 1 && page.next_cursor === null) setChosen(trusted[0].id);
        }
      }
    }
    load().catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, version.skill_id, version.content_hash, scope]);

  async function act(operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (error) {
      if (error instanceof ApiError && error.status < 500) setPending(undefined);
      setError(windowError(error));
    } finally { working.current = false; setBusy(false); }
  }
  async function submit(command: Pending) {
    setPending(command);
    if (command.kind === 'save') {
      const value = await client.saveSkillExecutionPermission(command.command);
      setSettings(current => ({ ...current!, permissions: [...current!.permissions.filter(item =>
        item.environment_id !== value.environment_id || item.environment_revision !== value.environment_revision), value] }));
      setPending(undefined);
      if (command.use) await onUse!(value);
    } else if (command.kind === 'revoke') {
      const value = await client.revokeSkillExecutionPermission(command.id, command.meta);
      setSettings(current => ({ ...current!, permissions: current!.permissions.map(item => item.id === value.id ? value : item) }));
    } else {
      const binding = await client.bindSkill(command.command);
      setSettings(current => ({ ...current!, binding }));
      setEnvironment(await client.executionEnvironment(binding.environment_id!));
      setOptions(undefined); setChosen(''); onChanged();
    }
    setPending(undefined);
  }
  const binding = settings?.binding;
  const chosenEnvironment = options?.items.find(item => item.id === chosen);
  const selected = chosenEnvironment ?? environment;
  const permission = settings?.permissions.find(item => item.environment_id === selected?.id
    && item.environment_revision === selected?.revision);
  const ownPermission = permission?.scope.kind === scope.kind && permission.scope.workspace_id === scope.workspace_id
    ? permission : undefined;
  const required = settings ? entryKinds(settings.scripts) : [];
  const defaultReady = environment?.status === 'probed' && required.includes(environment.kind)
    && environment.revision === binding?.environment_revision;
  const ready = selected?.status === 'probed' && required.includes(selected.kind)
    && (!!chosenEnvironment || defaultReady);
  function permit(use = false) {
    return submit({ kind: 'save', command: { meta: commandMeta(ownPermission?.revision ?? null), data: {
      id: ownPermission?.id ?? crypto.randomUUID(), skill_id: version.skill_id, content_hash: version.content_hash,
      environment_id: selected!.id, environment_revision: selected!.revision,
      scope, revision: ownPermission?.revision ?? 1, status: 'active',
    } }, use });
  }
  function bind() {
    const own = binding?.scope.kind === scope.kind && binding.scope.workspace_id === scope.workspace_id ? binding : null;
    const selected = options!.items.find(item => item.id === chosen)!;
    return submit({ kind: 'bind', command: { meta: commandMeta(own?.revision ?? null), data: {
      id: own?.id ?? crypto.randomUUID(), skill_id: version.skill_id, scope, enabled: binding?.enabled ?? false,
      revision: own?.revision ?? 1, environment_id: selected.id, environment_revision: selected.revision,
    } } });
  }
  async function discover() {
    if (binding?.environment_id) {
      setEnvironment(await client.probeExecutionEnvironment(binding.environment_id));
      return;
    }
    const page = await client.discoverExecutionEnvironments({
      workspace_id: scope.workspace_id ?? undefined, kinds: entryKinds(settings!.scripts),
    });
    setOptions(page);
    const available = page.items.filter(item => item.status === 'probed');
    setChosen(available.length === 1 ? available[0].id : '');
  }
  const missing = required.filter(kind => !options?.items.some(item => item.kind === kind && item.status === 'probed'));
  return <section aria-label="脚本执行许可" className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
    <h3 className="font-semibold">包内脚本</h3>
    <p className="text-sm text-muted-foreground">许可保存在{scope.kind === 'workspace' ? '当前项目' : '个人范围'}。脚本以当前用户权限运行。</p>
    {error && <p role="alert">{error}</p>}
    {!settings ? <p>正在核对脚本设置…</p> : <>
      <ul className="text-sm">{settings.scripts.map(path => <li key={path}><code>{path}</code></li>)}</ul>
      {!binding?.environment_id ? <>
        <p>按项目自动选择 · {required.map(kind => names[kind]).join('、')}</p>
        {options && missing.length > 0 && <p>需要 {missing.map(kind => names[kind]).join('、')} 解释器，请重新检测或选择已安装环境。</p>}
      </> : <>
        <p>默认环境 · {defaultReady ? `${names[environment!.kind]} 可用` : '待核对'} · {environment?.executable_path}{environment?.version ? ` · ${environment.version}` : ''}</p>
        {!defaultReady && <p>请重新检测，核对所绑定的解释器。</p>}
      </>}
      <div className="button-row">
        <Button disabled={busy || !!pending} onClick={() => void act(discover)}>重新检测</Button>
        <Button disabled={busy || !!pending} onClick={() => void act(async () => setOptions(await client.executionEnvironments()))}>选择已安装环境</Button>
      </div>
      {options && <div>
         <FieldLabel>{onUse ? '本轮运行环境' : '用户运行环境'}<NativeSelect value={chosen} disabled={busy || !!pending} onChange={event => setChosen(event.target.value)}>
          <NativeSelectOption value="">{binding?.environment_id ? '使用默认环境' : '请选择已检测环境'}</NativeSelectOption>
          {options.items.map(item => <NativeSelectOption key={item.id} value={item.id}>
            {names[item.kind]} · {item.executable_path} · {item.version ?? '待检测'}
          </NativeSelectOption>)}
        </NativeSelect></FieldLabel>
         <p>系统安装记录仅用于发现候选。检测会启动所列解释器查询版本，不运行项目脚本或安装依赖。</p>
         <Button disabled={busy || !!pending} onClick={() => void openSettings('environments')}>登记已安装环境</Button>
         <Button type="button" disabled={busy || !!pending || !chosen} onClick={() => void act(async () => {
           const checked = await client.probeExecutionEnvironment(chosen);
           setOptions(current => ({ ...current!, items: current!.items.map(item => item.id === checked.id ? checked : item) }));
         })}>检测所选环境</Button>
         <Button type="button" disabled={busy || !!pending || options.items.find(item => item.id === chosen)?.status !== 'probed'}
           onClick={() => void act(bind)}>将所选环境保存为{scope.kind === 'workspace' ? '项目' : '个人'}默认</Button>
        {options.next_cursor && <Button type="button" disabled={busy} onClick={() => void act(async () => {
          const next = await client.executionEnvironments({ cursor: options.next_cursor! });
          setOptions({ ...next, items: [...options.items, ...next.items] });
        })}>更多环境</Button>}
      </div>}
       {selected && (ready || ownPermission?.status === 'active') && <div role="group" aria-label="当前脚本许可" className="flex flex-col gap-2">
       <p className="text-sm"><strong>{version.name}</strong> · {version.metadata.version || '当前发布版'}</p>
       <p className="text-sm">所选解释器：{selected.executable_path}{selected.version && ` · ${selected.version}`}</p>
      {ready && (permission?.status === 'active' ? <p>此版本已有执行许可{ownPermission ? '' : '（个人）'}</p>
        : permission?.status === 'revoked' ? <p>此环境的执行许可已撤销</p> : <p>此版本尚未允许本机执行</p>)}
      {ready && (onUse
        ? permission?.status === 'active'
          ? <Button className="self-start" variant="default" disabled={busy || !!pending} onClick={() => void act(() => onUse(permission))}>使用此 Skill 和已许可脚本</Button>
          : <Button className="self-start" variant="default" disabled={busy || !!pending} onClick={() => void act(() => permit(true))}>允许本机执行并用于新目标</Button>
        : permission?.status !== 'active' && <Button className="self-start" variant="default" disabled={busy || !!pending} onClick={() => void act(() => permit())}>
          {chosenEnvironment ? '允许此版本在所选环境执行' : '允许此版本在绑定环境执行'}
        </Button>)}
       {ownPermission?.status === 'active' && <Button type="button" disabled={busy || !!pending} onClick={() => void act(() => submit({
         kind: 'revoke', id: ownPermission.id, meta: commandMeta(ownPermission.revision),
       }))}>撤销执行许可</Button>}
       </div>}
    </>}
    {pending && <Button type="button" disabled={busy} onClick={() => void act(() => submit(pending))}>按原命令核对许可</Button>}
  </section>;
}
