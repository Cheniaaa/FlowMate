import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { mergeVersioned } from '../../api/events';
import { pricingUnknownMessage } from '../../api/pricing';
import type { ModelCandidateList, ModelConnection, ModelDiscoveryResult, ModelProfile, ModelProfilePage, ModelResolution, ProviderPresetList, SaveModelCommand } from '../../generated/contracts';
import type { EditorLifecycle } from './Settings';
import PricingAssumptions from '../../components/PricingAssumptions';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import SettingsConflict, { findSetting, useSettingsConflict } from './SettingsConflict';

const capabilityNames = { tools: '工具调用', thinking: '思考', vision: '图片输入', structured_output: '结构化输出' } as const;
type Efforts = ModelProfile['capabilities']['reasoning_efforts'];
type Effort = NonNullable<Efforts>[number];
const effortLabel = '思考强度档位';
const effortLabels: Record<Effort, string> = {
  none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高',
};
const effortLevels = Object.keys(effortLabels) as Effort[];
const sourceNames = { user: '用户设置', service: '当前服务声明', observed: '此连接的调用记录', catalog: '型号目录', application: '应用默认', unknown: '未知' };
const metadataNames: Record<string, string> = {
  context_window_tokens: '上下文容量', max_input_tokens: '最大输入', max_supported_output_tokens: '最大输出容量',
  local_context_budget_tokens: '本地请求预算', max_output_tokens: '输出上限', request_timeout_seconds: '请求时限',
  openai_max_tokens_field: '输出上限参数', pricing: '价格',
  'capabilities.tools': '工具调用', 'capabilities.thinking': '思考', 'capabilities.vision': '图片输入',
  'capabilities.structured_output': '结构化输出', 'capabilities.reasoning_efforts': effortLabel,
};
const blockerMessages: Record<string, string> = {
  output_exceeds_context: '输出上限占满或超过本地请求预算；请降低最大输出或增大本地上下文预算。',
  tools_unsupported: '当前模型不支持工具调用；请选择支持工具调用的型号，或核对能力覆盖。',
  openai_max_tokens_field_not_applicable: '当前协议不使用此输出参数覆盖；请重新保存模型以清除该覆盖。',
};
const pricingNames = {
  multiplier: '价格倍率', input_per_million: '输入单价', output_per_million: '输出单价',
  cache_read_per_million: '缓存读取单价', cache_write_per_million: '缓存写入单价',
} as const;
const capacity = (value: number | null) => value?.toLocaleString('en-US') ?? '未知';
const describeEfforts = (efforts: Efforts) => efforts?.map(effort => effortLabels[effort]).join('、') || '暂无可选档位';

function ReasoningEffortSettings({ efforts, options, editable, disabled }: {
  efforts: Efforts; options: readonly Effort[]; editable: boolean; disabled: boolean;
}) {
  const fieldId = useId();
  const [manual, setManual] = useState(efforts != null);
  return <FieldSet className="my-3" aria-describedby={`${fieldId}-help`}>
    <FieldLegend>{effortLabel}</FieldLegend>
    <FieldLabel>档位来源 <NativeSelect name="reasoning_effort_mode" value={manual ? 'manual' : 'auto'}
      onChange={event => setManual(event.target.value === 'manual')}>
      <NativeSelectOption value="auto">自动解析</NativeSelectOption>
      <NativeSelectOption value="manual">{editable ? '手动指定可用档位' : '保留已保存的覆盖'}</NativeSelectOption>
    </NativeSelect></FieldLabel>
    <FieldDescription id={`${fieldId}-help`}>{editable
      ? '仅勾选已确认此连接和型号接受的档位。没有可用档位时，输入区不显示思考强度选择。'
      : '切换到自动解析可清除已保存的覆盖，交由服务端确定此型号的可用档位。'}</FieldDescription>
    {editable ? <div hidden={!manual}>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map(effort => <Field key={effort} orientation="horizontal">
          <Checkbox id={`${fieldId}-${effort}`} name="reasoning_efforts" value={effort}
            defaultChecked={efforts?.includes(effort)} disabled={disabled} />
          <FieldLabel htmlFor={`${fieldId}-${effort}`}>{effortLabels[effort]}</FieldLabel>
        </Field>)}
      </div>
    </div> : manual && <FieldDescription>已保存的覆盖：{describeEfforts(efforts)}</FieldDescription>}
  </FieldSet>;
}

export default function ModelSettings({ client, connection, initialDiscovery, onDiscovery, onCheckConnection, onBusyChange, onSaved, onDiscard, onViewReady, guard = action => action() }: {
  client: RuntimeClient; connection: ModelConnection; initialDiscovery?: ModelDiscoveryResult;
  onDiscovery?: (result: ModelDiscoveryResult) => void; onCheckConnection?: () => void;
} & EditorLifecycle) {
  const [models, setModels] = useState<ModelProfilePage>();
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(false);
  const selected = models?.items.find(model => model.id === selectedId);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const [editRevision, setEditRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<ModelCandidateList>([]);
  const [resolvedModel, setResolvedModel] = useState<ModelResolution>();
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [candidateProvider, setCandidateProvider] = useState(connection.provider_preset_id ?? '');
  const [providers, setProviders] = useState<ProviderPresetList>([]);
  const [discovery, setDiscovery] = useState(initialDiscovery);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const recovery = useSettingsConflict<ModelProfile, SaveModelCommand['data']>(inflight, setBusy, onBusyChange, (original, draft, latest, choose) => ({
    ...latest,
    display_name: choose('模型显示名称', original.display_name, draft.display_name, latest.display_name),
    context_window_tokens: choose('本地上下文预算', original.context_window_tokens, draft.context_window_tokens, latest.context_window_tokens),
    max_output_tokens: choose('最大输出', original.max_output_tokens, draft.max_output_tokens, latest.max_output_tokens),
    request_timeout_seconds: choose('请求时限', original.request_timeout_seconds, draft.request_timeout_seconds, latest.request_timeout_seconds),
    openai_max_tokens_field: connection.protocol === 'openai_compatible'
      ? choose('输出上限参数', original.openai_max_tokens_field, draft.openai_max_tokens_field, latest.openai_max_tokens_field) : undefined,
    capabilities: {
      ...Object.fromEntries((Object.keys(capabilityNames) as (keyof typeof capabilityNames)[]).map(field => [
        field, choose(capabilityNames[field], original.capabilities[field], draft.capabilities?.[field], latest.capabilities[field],
          value => value == null ? '自动解析' : value ? '支持' : '不支持'),
      ])),
      reasoning_efforts: choose(effortLabel, original.capabilities.reasoning_efforts, draft.capabilities?.reasoning_efforts,
        latest.capabilities.reasoning_efforts, value => value == null ? '自动解析' : describeEfforts(value)),
    },
    pricing: {
      ...latest.pricing,
      provider_id: choose('价格目录提供商', original.pricing.provider_id, draft.pricing?.provider_id, latest.pricing.provider_id),
      model_id: choose('价格目录型号', original.pricing.model_id, draft.pricing?.model_id, latest.pricing.model_id),
      ...Object.fromEntries((Object.keys(pricingNames) as (keyof typeof pricingNames)[]).map(field => [
        field, choose(pricingNames[field], original.pricing[field], draft.pricing?.[field], latest.pricing[field]),
      ])),
    },
  }));
  const { conflict } = recovery;
  const draft = recovery.editing?.draft ?? selected;
  const draftEfforts = draft?.capabilities?.reasoning_efforts;
  const resolution = resolvedModel && resolvedModel.id === selected?.id && resolvedModel.version === selected.version
    && resolvedModel.connection_id === connection.id && resolvedModel.connection_version === connection.version ? resolvedModel : undefined;
  const editableEfforts = connection.provider_preset_id === null;
  const effortOptions = connection.protocol === 'anthropic' ? effortLevels.filter(effort => effort !== 'none' && effort !== 'minimal') : effortLevels;
  const effortSource = resolution?.metadata_sources['capabilities.reasoning_efforts'];
  const formKey = `${selectedId}:${draft?.version}:${editRevision}:${!!recovery.editing}`;
  useLayoutEffect(() => { if (!busy) onViewReady?.(); }, [formKey, editing, busy, onViewReady]);
  useEffect(() => { setCandidateId(''); }, [selectedId, editRevision]);

  useEffect(() => {
    let ignore = false;
    setDiscoveryError('');
    if (initialDiscovery && refreshRevision === 0) { setDiscovery(initialDiscovery); return; }
    setDiscovering(true); setDiscovery(undefined);
    client.discoverConnection(connection.id).then(result => {
      if (!ignore) { setDiscovery(result); onDiscovery?.(result); }
    }).catch(() => { if (!ignore) setDiscoveryError('暂时无法读取型号列表，请刷新或检查连接'); })
      .finally(() => { if (!ignore) setDiscovering(false); });
    return () => { ignore = true; };
  }, [client, connection.id, connection.version, refreshRevision]);

  useEffect(() => {
    if (connection.provider_preset_id || discovery?.status !== 'unavailable') return;
    let ignore = false;
    client.providerPresets().then(value => { if (!ignore) setProviders(value); })
      .catch(() => { if (!ignore) setDiscoveryError('参考提供方目录读取失败；仍可手填别名'); });
    return () => { ignore = true; };
  }, [client, connection.provider_preset_id, discovery?.status]);

  useEffect(() => {
    let ignore = false;
    client.models({ connection_id: connection.id }).then(page => { if (!ignore) setModels(page); }).catch(() => { if (!ignore) setError('无法读取模型配置'); });
    return () => { ignore = true; };
  }, [client, connection.id]);

  useEffect(() => {
    let ignore = false; setResolvedModel(undefined);
    if (selected) client.modelResolution(selected.id).then(value => { if (!ignore) setResolvedModel(value); }).catch(() => { if (!ignore) setError('当前模型解析读取失败；不能把覆盖输入当作已生效值'); });
    return () => { ignore = true; };
  }, [client, connection.version, selected?.id, selected?.version]);
  useEffect(() => {
    let ignore = false; setCandidates([]);
    if (candidateProvider) client.modelCandidates(candidateProvider, candidateQuery).then(value => { if (!ignore) setCandidates(value); }).catch(() => { if (!ignore) setError('模型候选读取失败，仍可填写明确的 Model ID'); });
    return () => { ignore = true; };
  }, [client, candidateProvider, candidateQuery]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inflight.current || (conflict && !recovery.merged)) return;
    const base = recovery.latestBase ?? selected;
    const values = new FormData(event.currentTarget);
    const form = event.currentTarget;
    const effortMode = values.get('reasoning_effort_mode');
    let reasoningEfforts = draftEfforts;
    if (effortMode === 'auto' && draftEfforts !== undefined) {
      reasoningEfforts = null;
    } else if (effortMode === 'manual' && editableEfforts) {
      const checked = values.getAll('reasoning_efforts');
      // 保留未显示的历史值及保存顺序，只允许新增当前协议的档位。
      reasoningEfforts = [
        ...(draftEfforts ?? []).filter(effort => !effortOptions.includes(effort) || checked.includes(effort)),
        ...effortOptions.filter(effort => checked.includes(effort) && !draftEfforts?.includes(effort)),
      ];
    }
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setError(''); setStatus('');
    const profile_id = base?.id ?? crypto.randomUUID();
    const data: SaveModelCommand['data'] = recovery.merged ?? {
        id: profile_id, version: base?.version ?? 1,
        ...(connection.protocol === 'openai_compatible' ? {
          openai_max_tokens_field: (values.get('openai_max_tokens_field') || null) as SaveModelCommand['data']['openai_max_tokens_field'],
        } : {}),
        connection_id: connection.id,
        model_id: base?.model_id ?? String(values.get('model_id')), display_name: String(values.get('display_name')) || null,
        context_window_tokens: values.get('context_window_tokens') ? Number(values.get('context_window_tokens')) : null, max_output_tokens: Number(values.get('max_output_tokens')),
        request_timeout_seconds: Number(values.get('request_timeout_seconds')),
        capabilities: {
          ...Object.fromEntries(Object.keys(capabilityNames).map(key => [
            key, values.get(key) ? values.get(key) === 'true' : null,
          ])),
          reasoning_efforts: reasoningEfforts,
        },
        pricing: { provider_id: String(values.get('provider_id')) || null, model_id: String(values.get('pricing_model_id')) || null,
          multiplier: String(values.get('multiplier')) || null, input_per_million: String(values.get('input_per_million')) || null,
          output_per_million: String(values.get('output_per_million')) || null, cache_read_per_million: String(values.get('cache_read_per_million')) || null,
          cache_write_per_million: String(values.get('cache_write_per_million')) || null, currency: 'USD' },
    };
    try {
      const saved = await client.saveModel(profile_id, { meta: commandMeta(base?.version ?? null), data });
      setModels(page => ({ ...page!, items: Object.values(mergeVersioned(
        Object.fromEntries(page!.items.map(item => [item.id, item])), [saved])) }));
      setSelectedId(saved.id);
      recovery.clear();
      setStatus('模型配置已保存；仅对新运行生效');
      onSaved?.(form);
    } catch (error) {
      if (!recovery.capture(error, base, data)) {
        setError(error instanceof ApiError ? error.message : '模型保存失败，请检查配置和 Runtime 状态');
      }
    } finally {
      inflight.current = false;
      setBusy(false); onBusyChange?.(false);
    }
  }

  async function loadMore() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setError('');
    try {
      const next = await client.models({ cursor: models!.next_cursor!, connection_id: connection.id });
      setModels(current => ({ ...next, items: Object.values(mergeVersioned(
        Object.fromEntries(current!.items.map(item => [item.id, item])), next.items)) }));
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '读取下一页配置失败');
    } finally { inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  function resetDraft() {
    const latest = recovery.latestBase;
    if (latest) setModels(current => ({ ...current!, items: Object.values(mergeVersioned(
      Object.fromEntries(current!.items.map(item => [item.id, item])), [latest])) }));
    recovery.clear(); setEditRevision(value => value + 1); setError(''); setStatus('');
  }

  return <section aria-labelledby="model-settings-title" className="flex w-full min-w-0 flex-col items-start gap-3">
    <div className="model-heading w-full"><h2 id="model-settings-title">模型设置</h2><Button variant="default" disabled={busy || !models} onClick={() => guard(() => { setSelectedId(''); setEditing(true); recovery.clear(); setStatus(''); setError(''); })}>新建模型</Button></div>
    <p className="muted">修改仅对新运行生效；未知价格不表示免费。</p>
    {error && <p className="status-message" role="alert">{error}</p>}<p className="status-message" role="status">{status}</p>
    <section aria-label="本站型号列表">
      <Button disabled={busy || discovering} onClick={() => setRefreshRevision(value => value + 1)}>{discovering ? '正在读取型号列表' : '刷新型号列表'}</Button>
      {discovery && <p role={discovery.status === 'authentication_error' ? 'alert' : 'status'}>{discovery.message}</p>}
      {discovery?.cached && <p>当前显示此连接上次成功读取的列表{discovery.fetched_at && ` · ${new Date(discovery.fetched_at).toLocaleString()}`}</p>}
      {discoveryError && <p role="alert">{discoveryError}</p>}
      {(discovery?.status === 'authentication_error' || discoveryError) && onCheckConnection && <Button disabled={busy} onClick={onCheckConnection}>检查连接</Button>}
    </section>
    <div className="model-settings-list grid w-full gap-2">{models?.items.map(item => <Button key={item.id} disabled={busy}
      className="justify-start whitespace-normal text-left [overflow-wrap:anywhere] aria-expanded:bg-secondary"
      aria-expanded={editing && selectedId === item.id} onClick={() => guard(() => { setEditing(selectedId !== item.id || !editing); setSelectedId(item.id); recovery.clear(); setStatus(''); setError(''); })}>
      <span className="flex min-w-0 flex-col items-start"><strong>{item.display_name || item.model_id}</strong>
        {item.display_name && item.display_name !== item.model_id && <span className="text-xs text-muted-foreground">{item.model_id}</span>}</span>
    </Button>)}</div>
    {models?.next_cursor && <Button disabled={busy || !!conflict} onClick={loadMore}>更多模型</Button>}
    {editing && resolution && <section className="resolved-model" aria-label="当前生效配置"><h3>当前生效配置</h3>
      <p>上下文容量：{capacity(resolution.context_window_tokens)}
        {resolution.context_window_tokens !== null && `（${sourceNames[resolution.metadata_sources.context_window_tokens.kind]}）`}
        {' · '}最大输入：{capacity(resolution.max_input_tokens)} · 最大输出：{capacity(resolution.max_supported_output_tokens)}</p>
      <p>本地请求预算：{capacity(resolution.local_context_budget_tokens)} token · 本次输出上限：{capacity(resolution.max_output_tokens)} token</p>
      <p>{Object.entries(capabilityNames).map(([key, label]) => {
        const value = resolution.capabilities[key as keyof typeof capabilityNames];
        return `${label}：${value == null ? '未知' : value ? '支持' : '不支持'}`;
      }).join(' · ')}</p>
      <p>{effortLabel}：{describeEfforts(resolution.capabilities.reasoning_efforts)}
        {effortSource && `（${sourceNames[effortSource.kind]}）`}</p>
      {resolution.pricing_unknown_reason && <p>价格未知：{pricingUnknownMessage(resolution.pricing_unknown_reason)}；不代表免费</p>}
       <details><summary>配置来源与计价依据</summary><ul>{Object.entries(resolution.metadata_sources).filter(([field]) => metadataNames[field]).map(([field, source]) => <li key={field}>{metadataNames[field]}：{sourceNames[source.kind]}{source.verified_at && ` · ${source.verified_at}`}</li>)}</ul>
       {resolution.model_pricing && <><p>计价来源：{resolution.model_pricing.mode === 'manual' ? '手动单价' : '价格目录'} · 倍率 {resolution.model_pricing.effective_multiplier}；不是供应商实扣</p><PricingAssumptions assumptions={resolution.model_pricing.assumptions} /></>}
      </details>{resolution.blockers.map(item => <p key={item}>暂不能运行：{blockerMessages[item] ?? '请检查模型设置，核对服务支持的型号、请求预算与能力覆盖。'}</p>)}
    </section>}
    {editing && conflict && <SettingsConflict label="模型" latest={conflict.latest && `${conflict.latest.display_name || conflict.latest.model_id} · ${connection.display_name}`}
      {...recovery} error={conflict.error} busy={busy} onRead={() => void recovery.read(() => findSetting(selectedId, cursor => client.models({ connection_id: connection.id, cursor })))} />}
    {editing && <form ref={formRef} onSubmit={save} onReset={resetDraft} className="settings-form w-full">
      <fieldset key={formKey} disabled={busy || !models || !!conflict} className="settings-grid">
        <FieldLegend>模型配置</FieldLegend>
        <FieldLabel className="model-fixed-connection">所属连接 <NativeSelect name="connection_id" disabled value={connection.id}>
          <NativeSelectOption value={connection.id}>{connection.display_name} · {connection.endpoint}</NativeSelectOption>
        </NativeSelect></FieldLabel>
        {!selected && !!discovery?.items.length && <FieldLabel>本站型号 <NativeSelect defaultValue="" onChange={event => {
          setCandidateId(''); (formRef.current!.elements.namedItem('model_id') as HTMLInputElement).value = event.target.value;
        }}>
          <NativeSelectOption value="">从此连接的列表选择，或手填别名</NativeSelectOption>
          {discovery.items.map(item => <NativeSelectOption key={item.model_id} value={item.model_id}>{item.model_id}{item.display_name ? ` · ${item.display_name}` : ''}</NativeSelectOption>)}
        </NativeSelect></FieldLabel>}
        {!selected && discovery?.status === 'unavailable' && <p>以下是可尝试的型号，本站尚未确认可用；也可直接填写自定义别名。</p>}
        {!selected && discovery?.status === 'unavailable' && !connection.provider_preset_id && <FieldLabel>参考提供方目录 <NativeSelect value={candidateProvider} onChange={event => setCandidateProvider(event.target.value)}>
          <NativeSelectOption value="">选择提供方</NativeSelectOption>
          {providers.map(provider => <NativeSelectOption key={provider.id} value={provider.id}>{provider.display_name}</NativeSelectOption>)}
        </NativeSelect></FieldLabel>}
        {!selected && candidateProvider && <FieldLabel>搜索目录候选 <Input data-settings-search value={candidateQuery} onChange={event => setCandidateQuery(event.target.value)} /></FieldLabel>}
        {!selected && candidates.length > 0 && <p>离线目录候选可尝试使用，本站尚未确认可用。</p>}
        {!selected && candidates.length > 0 && <FieldLabel>目录候选 <NativeSelect defaultValue="" onChange={event => { setCandidateId(event.target.value); (formRef.current!.elements.namedItem('model_id') as HTMLInputElement).value = event.target.value; }}>
          <NativeSelectOption value="">选择候选，或自由填写 ID</NativeSelectOption>
          {candidates.map(item => <NativeSelectOption key={item.model_id} value={item.model_id}>{item.display_name ?? item.model_id} · 容量 {item.context_window_tokens ?? '未知'}</NativeSelectOption>)}
        </NativeSelect></FieldLabel>}
        {!selected && candidates.find(item => item.model_id === candidateId) && <details><summary>型号元数据来源</summary><ul>{Object.entries(candidates.find(item => item.model_id === candidateId)!.metadata_sources).filter(([field]) => metadataNames[field]).map(([field, source]) => <li key={field}>{metadataNames[field]}：{sourceNames[source.kind]}{source.verified_at && ` · ${source.verified_at}`}</li>)}</ul></details>}
        <FieldLabel>Model ID <Input name="model_id" required maxLength={256} disabled={!!selected} defaultValue={selected?.model_id ?? ''} onChange={() => setCandidateId('')} /></FieldLabel>
        <FieldLabel>模型显示名称 <Input name="display_name" maxLength={256} defaultValue={draft?.display_name ?? ''} /></FieldLabel>
        <FieldLabel>本地上下文预算（tokens） <Input name="context_window_tokens" type="number" min="1" step="1" aria-describedby="model-context-help" defaultValue={draft?.context_window_tokens ?? ''} /></FieldLabel>
        <p id="model-context-help">可选。留空由服务容量、目录或应用默认值确定本地请求预算；填写预算不会声明模型实际容量。</p>
        <FieldLabel>最大输出（tokens） <Input name="max_output_tokens" type="number" min="1" step="1" required defaultValue={draft?.max_output_tokens ?? 2048} /></FieldLabel>
        <details className="advanced-settings"><summary>高级覆盖 · 留空自动解析或保持未知</summary>
        <p>模型创建后型号和所属连接不可修改；使用其他型号请新增。地址与凭据在连接设置中管理。</p>
        {connection.protocol === 'openai_compatible' && <FieldLabel>输出上限参数 <NativeSelect name="openai_max_tokens_field" defaultValue={draft?.openai_max_tokens_field ?? ''}>
          <NativeSelectOption value="">未覆盖（应用默认）</NativeSelectOption>
          <NativeSelectOption value="max_completion_tokens">max_completion_tokens</NativeSelectOption>
          <NativeSelectOption value="max_tokens">max_tokens</NativeSelectOption>
        </NativeSelect></FieldLabel>}
        <FieldLabel>请求时限（秒） <Input name="request_timeout_seconds" type="number" min="0" step="any" required defaultValue={draft?.request_timeout_seconds ?? 60} /></FieldLabel>
        {(Object.keys(capabilityNames) as (keyof typeof capabilityNames)[]).map(capability => <FieldLabel key={capability}>{capabilityNames[capability]} <NativeSelect name={capability} defaultValue={draft?.capabilities?.[capability] == null ? '' : String(draft.capabilities[capability])}>
          <NativeSelectOption value="">自动解析（服务、调用记录或目录）</NativeSelectOption>
          <NativeSelectOption value="true">支持</NativeSelectOption>
          <NativeSelectOption value="false">不支持</NativeSelectOption>
        </NativeSelect></FieldLabel>)}
        <p>能力留空时自动解析，无法确认时保持未知；选择“不支持”会明确覆盖其他来源。</p>
        {(editableEfforts || draftEfforts != null) && <ReasoningEffortSettings efforts={draftEfforts}
          options={effortOptions} editable={editableEfforts} disabled={busy || !models || !!conflict} />}
        <FieldLabel>价格目录提供商 ID <Input name="provider_id" defaultValue={draft?.pricing?.provider_id ?? ''} /></FieldLabel>
        <FieldLabel>价格目录型号 ID <Input name="pricing_model_id" defaultValue={draft?.pricing?.model_id ?? ''} /></FieldLabel>
        {(Object.keys(pricingNames) as (keyof typeof pricingNames)[]).map(field => <FieldLabel key={field}>{pricingNames[field]}{field !== 'multiplier' && '（USD / 百万 tokens）'} <Input name={field} inputMode="decimal" defaultValue={draft?.pricing?.[field] ?? ''} /></FieldLabel>)}
        <p>价格覆盖均可留空。目录映射只用于计价，不会改写发送到服务的 Model ID。手动单价需同时填写输入和输出；0 表示明确的零单价，留空表示未覆盖。</p>
        </details>
      </fieldset>
      <div className="settings-form-actions button-row">
          <Button type="submit" variant="default" disabled={busy || !models || (!!conflict && !recovery.merged)}>{recovery.latestBase ? '保存合并后的模型' : '保存模型'}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => { onDiscard?.(formRef.current!); resetDraft(); }}>取消编辑</Button>
      </div>
    </form>}
  </section>;
}
