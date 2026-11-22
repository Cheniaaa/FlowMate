import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { validate } from '../../api/validation';
import { windowError } from '../../api/windows';
import type { ScopeRef, SkillView, SkillVersion, SkillFileSlice, SkillExportReceipt, ResourceRef, BindSkillCommand } from '../../generated/contracts';
import { skillQuery } from './skill-query';
import SkillExecution from './SkillExecution';
import SkillExportRecovery from './SkillExportRecovery';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { useSkillExportReceipts } from './useSkillExportReceipts';
import type { DeferredSkillExport } from './deferred-skill-exports';

type SkillDetailProps = {
  client: RuntimeClient; view: SkillView; scope: ScopeRef; onUse?: (version: SkillVersion, permissionId?: string) => Promise<void>;
  useInDraft?: boolean;
  workspaceId?: string; refreshKey?: number; onChanged: () => void; onEdit: () => Promise<void>; onBusyChange?: (busy: boolean) => void;
  onLocateExport?: (receipt: SkillExportReceipt) => void;
  onDeferExport?: (draft: DeferredSkillExport) => void;
};

export default function SkillDetail(props: SkillDetailProps) {
  const { scope, view } = props;
  return <SkillDetailView key={`${scope.kind}:${scope.workspace_id ?? ''}:${view.version.skill_id}`} {...props} />;
}

function SkillDetailView({ client, view, scope, workspaceId, refreshKey = 0, onUse, useInDraft, onChanged, onEdit, onBusyChange, onLocateExport, onDeferExport }: SkillDetailProps) {
  const version = view.version, query = skillQuery(scope);
  const scriptPackage = version.files.some(file => file.path.startsWith('scripts/'));
  const executionScope = useMemo<ScopeRef>(() => onUse && workspaceId
    ? { kind: 'workspace', workspace_id: workspaceId, session_id: null } : scope,
  [!!onUse, workspaceId, scope]);
  const canUse = !!onUse && view.binding?.enabled && view.readiness === 'content_available';
  const [file, setFile] = useState<SkillFileSlice>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const { receipts, install, error: receiptError } = useSkillExportReceipts(client, scope, refreshKey, version.skill_id);
  const [overwrite, setOverwrite] = useState<ResourceRef>();
  const exportButton = useRef<HTMLButtonElement>(null);
  const lookupButton = useRef<HTMLButtonElement>(null);
  const [locatedReceipt, setLocatedReceipt] = useState<SkillExportReceipt>();
  const [pendingExport, freezeExport] = useState<DeferredSkillExport>();
  const [pendingBinding, freezeBinding] = useState<BindSkillCommand>();
  const pending = useRef(false);
  const [executionBusy, setExecutionBusy] = useState(false);
  const locked = busy || executionBusy || !!pendingExport || !!pendingBinding || !!overwrite;
  useEffect(() => { onBusyChange?.(locked); return () => onBusyChange?.(false); }, [locked, onBusyChange]);
  useEffect(() => {
    let ignore = false; setFile(undefined);
    client.skillFile(version.skill_id, version.content_hash, skillQuery(version.scope)).then(value => { if (!ignore) setFile(value); })
      .catch(error => { if (!ignore) setError(windowError(error)); });
    return () => { ignore = true; };
  }, [client, version.skill_id, version.content_hash, scope, refreshKey]);
  async function act(action: () => Promise<unknown>, actionType?: 'lookup' | 'save' | 'retry' | 'bind') {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) {
      const rejected = error instanceof ApiError && error.status < 500 && error.code !== 'skill_export_unconfirmed';
      if (rejected && actionType === 'save') freezeExport(undefined);
      if (rejected && actionType === 'bind') freezeBinding(undefined);
      if (actionType === 'lookup') {
        setError(error instanceof ApiError && (error.code === 'skill_export_not_found' || error.status === 404)
          ? '暂未找到保存记录，可以重试保存。' : '暂时无法查询保存结果，请稍后再试。');
      } else if (actionType === 'save') {
        setError(rejected
          ? '文件未保存。请核对目标文件后重新导出。'
          : '暂未确认文件是否已保存。你可以查询保存结果。');
      } else if (actionType === 'retry') {
        setError(rejected
          ? '本次重试未完成。请查询原命令的保存结果。'
          : '暂未确认文件是否已保存。你可以查询保存结果。');
      } else setError(windowError(error));
    }
    finally { pending.current = false; setBusy(false); }
  }
  function confirmExport(receipt: SkillExportReceipt, focusReceipt = true) {
    install(receipt);
    if (focusReceipt) setLocatedReceipt(receipt);
    freezeExport(undefined);
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
    freezeExport({ label: target.label, command });
    try {
      confirmExport(await client.saveSkillExport(command), !target.source_version);
    } finally {
      setOverwrite(undefined);
    }
  }
  async function choose() {
    let resource: ResourceRef;
    try {
      const result = await invoke<{ resources: unknown[] }>('choose_skill_export_target', { scope: { kind: 'workspace', workspace_id: workspaceId, session_id: null } });
      if (!result.resources.length) return;
      resource = validate('ResourceRef', result.resources[0]);
    } catch {
      setError('无法选择目标文件，请重新打开保存窗口。');
      return;
    }
    if (resource.source_version) setOverwrite(resource); else await save(resource);
  }
  const { version: declaredVersion, ...metadata } = version.metadata;
  return <article aria-label="Skill 详情" className="skill-detail flex flex-col gap-4 [overflow-wrap:anywhere]">
    <header className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">Agent Skills 标准包 · {view.binding?.enabled ? '已启用' : '未启用'}</p>
      <h2 className="text-xl font-semibold">{version.name}</h2><p>{version.description}</p>
    </header>
    <div className="button-row">
      {onUse && <Button variant={scriptPackage ? 'outline' : 'default'} disabled={locked || !canUse} onClick={() => void act(() => onUse(version))}>
        {scriptPackage ? '仅使用指导' : useInDraft ? '用于本次草稿' : '用于原会话的新目标'}
      </Button>}
      <Button disabled={busy || executionBusy || !!pendingExport || !!overwrite} onClick={() => void act(bind, 'bind')}>{pendingBinding ? '按原命令核对启停' : view.binding?.enabled ? '停用' : '启用'}</Button>
      <Button disabled={locked || view.readiness !== 'content_available'} onClick={() => void onEdit()}>编辑新版本</Button>
      <Button ref={exportButton} disabled={locked || !workspaceId || view.readiness !== 'content_available'} onClick={() => void act(choose, 'save')}>导出标准包</Button>
    </div>
    {!workspaceId && <p>保存副本需选择一个项目作为原生保存目标范围，无需聊天会话。</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {receiptError && !error && <p role="alert" className="text-destructive">读取保存记录失败。</p>}
    <details className="rounded-md border border-border bg-background p-3">
      <summary className="cursor-pointer font-medium">版本详情</summary>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm [&>dt]:text-muted-foreground">
        <dt>发布版本</dt><dd>{declaredVersion || '当前发布版'}</dd>
        <dt>来源</dt><dd>{{ external: '外部导入', user_created: '用户创建', user_edited: '用户编辑', generated: '任务生成候选后发布' }[version.source.kind]}</dd>
        <dt>范围</dt><dd>{version.scope.kind === 'workspace' ? '项目' : '个人'}</dd>
        <dt>可用内容</dt><dd>{scriptPackage ? '指导、参考文件与包内脚本' : '指导与参考文件'}</dd>
        {version.license && <><dt>许可声明</dt><dd>{version.license}</dd></>}
        {version.compatibility && <><dt>兼容要求</dt><dd>{version.compatibility}</dd></>}
        {Object.keys(metadata).length > 0 && <><dt>包作者附注</dt><dd>{Object.entries(metadata).map(([key, value]) => <p key={key}>{key}: {value}</p>)}</dd></>}
        <dt>内容状态</dt><dd>{view.readiness === 'content_available' ? '内容可读取' : '来源不可用'}</dd>
      </dl>
    </details>
    {scriptPackage && <SkillExecution
      key={`${version.skill_id}:${version.content_hash}:${executionScope.kind}:${executionScope.workspace_id}`}
      client={client} version={version} scope={executionScope} onChanged={onChanged} onBusyChange={setExecutionBusy}
      onUse={canUse ? permission => onUse!(version, permission.id) : undefined} />}
    {overwrite && <Dialog open><DialogContent className="flex flex-col gap-3 [overflow-wrap:anywhere]"
      onInteractOutside={event => event.preventDefault()}
      onEscapeKeyDown={event => { event.preventDefault(); if (!pending.current) setOverwrite(undefined); }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (exportButton.current?.disabled) lookupButton.current?.focus();
        else exportButton.current?.focus();
      }}>
      <DialogTitle className="text-lg font-semibold">确认覆盖</DialogTitle>
      <DialogDescription>将覆盖所选文件：{overwrite.label}</DialogDescription>
      <div className="button-row justify-end">
        <Button disabled={!!pendingExport} onClick={() => { if (!pending.current) setOverwrite(undefined); }}>取消覆盖</Button>
        <Button variant="destructive" disabled={!!pendingExport} onClick={() => void act(() => save(overwrite), 'save')}>确认覆盖并保存</Button>
      </div>
    </DialogContent></Dialog>}
    {pendingExport && <section aria-label="保存结果待确认" className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
      <p>保存结果待核对 · {pendingExport.label}</p>
      <div className="button-row">
        <Button ref={lookupButton} variant="default" disabled={busy} onClick={() => void act(async () => {
          const receipt = await client.skillExport(pendingExport.command.meta.command_id!, query);
          confirmExport(receipt);
          onLocateExport?.(receipt);
        }, 'lookup')}>查询保存结果</Button>
        <Button disabled={busy} onClick={() => void act(async () => {
          confirmExport(await client.saveSkillExport(pendingExport.command));
        }, 'retry')}>重试保存</Button>
        {onDeferExport && <Button variant="ghost" disabled={busy} onClick={() => {
          if (pending.current) return;
          try { onDeferExport(pendingExport); }
          catch { setError('无法保留待核对的保存命令。请在此继续查询或重试。'); }
        }}>暂缓核对并返回草稿</Button>}
      </div>
    </section>}
    {!!receipts?.length && <SkillExportRecovery client={client} scope={scope} receipts={receipts}
      locatedReceipt={locatedReceipt} onReceipt={install} onBusyChange={setBusy} />}
    <h3>{file?.path ?? 'SKILL.md'}</h3>{file?.encoding === 'utf-8' && <pre className="skill-body">{file.content}</pre>}
    {file && file.end < file.total && <Button type="button" disabled={busy} onClick={() => void act(async () => {
      const next = await client.skillFile(version.skill_id, version.content_hash, { ...skillQuery(version.scope), path: file.path, offset: file.end });
      setFile({ ...next, content: file.content + next.content });
    })}>继续读取文件</Button>}
    {file?.encoding === 'base64' && <p>二进制资源 · {file.total} 字节</p>}
    <h3>包内文件</h3><ul>{version.files.map(item => <li key={item.path}><Button type="button" size="sm" className="whitespace-normal break-all" disabled={busy} onClick={() => void act(async () =>
      setFile(await client.skillFile(version.skill_id, version.content_hash, { ...skillQuery(version.scope), path: item.path })))}>
      {item.path}</Button> · {item.size_bytes} bytes</li>)}</ul>
  </article>;
}
