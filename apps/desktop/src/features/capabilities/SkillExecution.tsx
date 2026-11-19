import { useEffect, useRef, useState } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { windowError } from '../../api/windows';
import type {
  BindSkillCommand, CommandMeta, ExecutionEnvironmentPage, ExecutionEnvironmentView,
  SaveSkillExecutionPermissionCommand, ScopeRef, SkillScriptSettings, SkillVersion,
} from '../../generated/contracts';
import { skillQuery } from './skill-query';

type Pending = { kind: 'save'; command: SaveSkillExecutionPermissionCommand }
  | { kind: 'revoke'; id: string; meta: CommandMeta } | { kind: 'bind'; command: BindSkillCommand };

export default function SkillExecution({ client, version, scope, onChanged }: {
  client: RuntimeClient; version: SkillVersion; scope: ScopeRef; onChanged: () => void;
}) {
  const [settings, setSettings] = useState<SkillScriptSettings>();
  const [environment, setEnvironment] = useState<ExecutionEnvironmentView>();
  const [options, setOptions] = useState<ExecutionEnvironmentPage>();
  const [chosen, setChosen] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const working = useRef(false);
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
        const page = await client.executionEnvironments();
        if (!ignore) setOptions(page);
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
      setSettings(current => ({ ...current!, permissions: [...current!.permissions.filter(item => item.id !== value.id), value] }));
    } else if (command.kind === 'revoke') {
      const value = await client.revokeSkillExecutionPermission(command.id, command.meta);
      setSettings(current => ({ ...current!, permissions: current!.permissions.map(item => item.id === value.id ? value : item) }));
    } else {
      const binding = await client.bindSkill(command.command);
      setSettings(current => ({ ...current!, binding }));
      setEnvironment(await client.executionEnvironment(binding.environment_id!));
      setOptions(undefined); onChanged();
    }
    setPending(undefined);
  }
  const binding = settings?.binding;
  const permission = settings?.permissions.find(item => item.environment_id === binding?.environment_id
    && item.environment_revision === binding?.environment_revision);
  const ready = environment?.status === 'probed' && environment.revision === binding?.environment_revision;
  function permit() {
    return submit({ kind: 'save', command: { meta: commandMeta(permission?.revision ?? null), data: {
      id: permission?.id ?? crypto.randomUUID(), skill_id: version.skill_id, content_hash: version.content_hash,
      environment_id: binding!.environment_id!, environment_revision: binding!.environment_revision!,
      scope, revision: permission?.revision ?? 1, status: 'active',
    } } });
  }
  function bind() {
    const own = binding?.scope.kind === scope.kind && binding.scope.workspace_id === scope.workspace_id ? binding : null;
    const selected = options!.items.find(item => item.id === chosen)!;
    return submit({ kind: 'bind', command: { meta: commandMeta(own?.revision ?? null), data: {
      id: own?.id ?? crypto.randomUUID(), skill_id: version.skill_id, scope, enabled: binding?.enabled ?? false,
      revision: own?.revision ?? 1, environment_id: selected.id, environment_revision: selected.revision,
    } } });
  }
  return <section aria-label="脚本执行许可">
    <h3>包内脚本</h3>
    <p>执行许可仅用于此版本和绑定的环境。每次调用仍需审批；脚本在本机运行。</p>
    {error && <p role="alert">{error}</p>}
    {!settings ? <p>正在核对脚本设置…</p> : <>
      <ul>{settings.scripts.map(path => <li key={path}><code>{path}</code></li>)}</ul>
      {!binding?.environment_id ? <p>待绑定环境</p> : <>
        <p>绑定环境 {environment?.kind ?? binding.environment_id} · 修订 {binding.environment_revision}</p>
        {!ready ? <p>待检测环境，请在设置中核对环境及修订</p> : permission?.status === 'active'
          ? <p>此版本已有执行许可</p> : <p>待执行许可</p>}
        {ready && permission?.status !== 'active' && <button disabled={busy || !!pending} onClick={() => void act(permit)}>允许此版本在绑定环境执行</button>}
        {permission?.status === 'active' && <button disabled={busy || !!pending} onClick={() => void act(() => submit({
          kind: 'revoke', id: permission.id, meta: commandMeta(permission.revision),
        }))}>撤销执行许可</button>}
        <button disabled={busy || !!pending} onClick={() => void act(async () => setOptions(await client.executionEnvironments()))}>更换绑定环境</button>
      </>}
      {options && <div>
        <label>用户运行环境<select value={chosen} disabled={busy || !!pending} onChange={event => setChosen(event.target.value)}>
          <option value="">请选择已检测环境</option>
          {options.items.map(item => <option key={item.id} value={item.id} disabled={item.status !== 'probed'}>
            {item.kind} · {item.executable_path} · 修订 {item.revision} · {item.status}
          </option>)}
        </select></label>
        <button disabled={busy || !!pending || !chosen} onClick={() => void act(bind)}>绑定所选环境</button>
        {options.next_cursor && <button disabled={busy} onClick={() => void act(async () => {
          const next = await client.executionEnvironments({ cursor: options.next_cursor! });
          setOptions({ ...next, items: [...options.items, ...next.items] });
        })}>更多环境</button>}
      </div>}
    </>}
    {pending && <button disabled={busy} onClick={() => void act(() => submit(pending))}>按原命令核对许可</button>}
  </section>;
}
