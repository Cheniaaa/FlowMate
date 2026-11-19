import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { validate } from '../../api/validation';
import { windowError } from '../../api/windows';
import type { ScopeRef, SkillView, SkillVersion, SkillFileSlice, SkillExportReceipt, ResourceRef, SaveSkillExportCommand, BindSkillCommand } from '../../generated/contracts';
import { skillQuery } from './skill-query';
import SkillExecution from './SkillExecution';
import SkillExportRecovery from './SkillExportRecovery';

export default function SkillDetail({ client, view, scope, workspaceId, refreshKey = 0, onUse, onChanged, onEdit }: {
  client: RuntimeClient; view: SkillView; scope: ScopeRef; onUse?: (version: SkillVersion) => Promise<void>;
  workspaceId?: string; refreshKey?: number; onChanged: () => void; onEdit: () => Promise<void>;
}) {
  const version = view.version, query = skillQuery(scope);
  const [file, setFile] = useState<SkillFileSlice>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [receipts, setReceipts] = useState<SkillExportReceipt[]>([]), [overwrite, setOverwrite] = useState<ResourceRef>();
  const [pendingExport, freezeExport] = useState<SaveSkillExportCommand>(), [pendingBinding, freezeBinding] = useState<BindSkillCommand>();
  const pending = useRef(false);
  useEffect(() => {
    let ignore = false; setFile(undefined);
    client.skillFile(version.skill_id, version.content_hash, skillQuery(version.scope)).then(value => { if (!ignore) setFile(value); })
      .catch(error => { if (!ignore) setError(windowError(error)); });
    client.skillExports({ ...query, skill_id: version.skill_id }).then(value => { if (!ignore) setReceipts(value); })
      .catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, version.skill_id, version.content_hash, scope, refreshKey]);
  async function act(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.code !== 'skill_export_unconfirmed') {
        freezeExport(undefined); freezeBinding(undefined);
      }
      setError(windowError(error));
    }
    finally { pending.current = false; setBusy(false); }
  }
  function install(receipt: SkillExportReceipt) {
    setReceipts(current => [...current.filter(item => item.command_id !== receipt.command_id), receipt]);
  }
  async function bind() {
    const binding = view.binding?.scope.kind === scope.kind && view.binding.scope.workspace_id === scope.workspace_id ? view.binding : null;
    const command = pendingBinding ?? { meta: commandMeta(binding?.revision ?? null), data: {
      id: binding?.id ?? crypto.randomUUID(), skill_id: version.skill_id, scope,
      enabled: !view.binding?.enabled, revision: binding?.revision ?? 1,
      environment_id: binding?.environment_id ?? null, environment_revision: binding?.environment_revision ?? null,
    } };
    freezeBinding(command); await client.bindSkill(command); freezeBinding(undefined); onChanged();
  }
  async function save(target: ResourceRef) {
    const command = { meta: commandMeta(), data: { scope, skill_id: version.skill_id, content_hash: version.content_hash,
      target_ref: target.id, confirmed_target_hash: target.source_version } };
    freezeExport(command); setOverwrite(undefined);
    install(await client.saveSkillExport(command)); freezeExport(undefined);
  }
  async function choose() {
    const result = await invoke<{ resources: unknown[] }>('choose_skill_export_target', { scope: { kind: 'workspace', workspace_id: workspaceId, session_id: null } });
    if (!result.resources.length) return;
    const resource = validate('ResourceRef', result.resources[0]);
    if (resource.source_version) setOverwrite(resource); else await save(resource);
  }
  return <article aria-label="Skill 详情" className="skill-detail">
    <p>Agent Skills 标准包 · {view.binding?.enabled ? '已启用' : '未启用'}</p>
    <h2>{version.name}</h2><p>{version.description}</p><p>版本 <code>{version.content_hash}</code></p>
    <div className="button-row">
      {onUse && <button disabled={busy || !view.binding?.enabled || view.readiness !== 'content_available'} onClick={() => void act(() => onUse(version))}>用于原会话的新目标</button>}
      <button disabled={busy} onClick={() => void act(bind)}>{pendingBinding ? '按原命令核对启停' : view.binding?.enabled ? '停用' : '启用'}</button>
      <button disabled={busy || view.readiness !== 'content_available'} onClick={() => void onEdit()}>编辑新版本</button>
      <button disabled={busy || !!pendingExport || !workspaceId || view.readiness !== 'content_available'} onClick={() => void act(choose)}>导出标准包</button>
    </div>
    {!workspaceId && <p>保存副本需选择一个项目作为原生保存目标范围，无需聊天会话。</p>}
    {error && <p role="alert">{error}</p>}
    <dl><dt>来源</dt><dd>{{ external: '外部导入', user_created: '用户创建', user_edited: '用户编辑', generated: '任务生成候选后发布' }[version.source.kind]}</dd>
      <dt>范围</dt><dd>{version.scope.kind === 'workspace' ? '项目' : '个人'}</dd>
      {version.license && <><dt>许可声明</dt><dd>{version.license}</dd></>}
      {version.compatibility && <><dt>兼容要求</dt><dd>{version.compatibility}</dd></>}
      {Object.keys(version.metadata).length > 0 && <><dt>标准 metadata</dt><dd>{Object.entries(version.metadata).map(([key, value]) => <p key={key}>{key}: {value}</p>)}</dd></>}
      <dt>内容状态</dt><dd>{view.readiness === 'content_available' ? '内容可读取' : '来源不可用'}</dd></dl>
    <p>启停只影响新运行；执行许可与运行环境由其管理入口核对。实际使用记录见任务 Trace。</p>
    {version.files.some(file => file.path.startsWith('scripts/')) && <SkillExecution
      key={`${version.skill_id}:${version.content_hash}:${scope.kind}:${scope.workspace_id}`}
      client={client} version={version} scope={scope} onChanged={onChanged} />}
    {overwrite && <section aria-label="确认覆盖"><p>将覆盖所选文件：{overwrite.label}</p><code>{overwrite.source_version}</code>
      <button disabled={busy} onClick={() => void act(() => save(overwrite))}>确认覆盖并保存</button><button disabled={busy} onClick={() => setOverwrite(undefined)}>取消覆盖</button></section>}
    {pendingExport && <section aria-label="保存命令待核对"><p>保存结果待核对 · {pendingExport.meta.command_id}</p>
      <button disabled={busy} onClick={() => void act(async () => { install(await client.skillExport(pendingExport.meta.command_id!, query)); freezeExport(undefined); })}>查询原保存命令</button>
      <button disabled={busy} onClick={() => void act(async () => { install(await client.saveSkillExport(pendingExport)); freezeExport(undefined); })}>以同一命令重试</button></section>}
    {receipts.length > 0 && <SkillExportRecovery client={client} scope={scope} receipts={receipts} onReceipt={install} onBusyChange={setBusy} />}
    <h3>{file?.path ?? 'SKILL.md'}</h3>{file?.encoding === 'utf-8' && <pre className="skill-body">{file.content}</pre>}
    {file && file.end < file.total && <button disabled={busy} onClick={() => void act(async () => {
      const next = await client.skillFile(version.skill_id, version.content_hash, { ...skillQuery(version.scope), path: file.path, offset: file.end });
      setFile({ ...next, content: file.content + next.content });
    })}>继续读取文件</button>}
    {file?.encoding === 'base64' && <p>二进制资源 · {file.total} bytes · hash {file.file_hash}</p>}
    <h3>包内文件</h3><ul>{version.files.map(item => <li key={item.path}><button disabled={busy} onClick={() => void act(async () =>
      setFile(await client.skillFile(version.skill_id, version.content_hash, { ...skillQuery(version.scope), path: item.path })))}>
      {item.path}</button> · {item.size_bytes} bytes</li>)}</ul>
  </article>;
}
