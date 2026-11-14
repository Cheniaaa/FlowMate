import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, commandMeta, type RuntimeClient } from '../../api/client';
import { mergeVersioned } from '../../api/events';
import type { ModelCandidateList, ModelConnection, ModelProfilePage, ModelResolution, SaveModelCommand } from '../../generated/contracts';
import type { EditorLifecycle } from './Settings';
import PricingAssumptions from '../../components/PricingAssumptions';

export default function ModelSettings({ client, connection, onBusyChange, onSaved, onDiscard, onViewReady, guard = action => action() }: { client: RuntimeClient; connection: ModelConnection } & EditorLifecycle) {
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
  const [resolution, setResolution] = useState<ModelResolution>();
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => { if (!busy) onViewReady?.(); }, [selectedId, selected?.version, editRevision, editing, busy, onViewReady]);
  useEffect(() => { setCandidateId(''); }, [selectedId, editRevision]);

  useEffect(() => {
    let ignore = false;
    client.models({ connection_id: connection.id }).then(page => { if (!ignore) setModels(page); }).catch(() => { if (!ignore) setError('无法读取模型配置'); });
    return () => { ignore = true; };
  }, [client, connection.id]);

  useEffect(() => {
    let ignore = false; setResolution(undefined);
    if (selected) client.modelResolution(selected.id).then(value => { if (!ignore) setResolution(value); }).catch(() => { if (!ignore) setError('当前模型解析读取失败；不能把覆盖输入当作已生效值'); });
    return () => { ignore = true; };
  }, [client, selected?.id, selected?.version]);
  useEffect(() => {
    let ignore = false; setCandidates([]);
    if (connection.provider_preset_id) client.modelCandidates(connection.provider_preset_id, candidateQuery).then(value => { if (!ignore) setCandidates(value); }).catch(() => { if (!ignore) setError('模型候选读取失败，仍可填写明确的 Model ID'); });
    return () => { ignore = true; };
  }, [client, connection.provider_preset_id, candidateQuery]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inflight.current) return;
    const values = new FormData(event.currentTarget);
    const form = event.currentTarget;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true); setError(''); setStatus('');
    try {
      const profile_id = selected?.id ?? crypto.randomUUID();
      const data: SaveModelCommand['data'] = {
        id: profile_id, version: selected?.version ?? 1,
        ...(connection.protocol === 'openai_compatible' ? {
          openai_max_tokens_field: (values.get('openai_max_tokens_field') || null) as SaveModelCommand['data']['openai_max_tokens_field'],
        } : {}),
        connection_id: connection.id,
        model_id: selected?.model_id ?? String(values.get('model_id')), display_name: String(values.get('display_name')) || null,
        context_window_tokens: values.get('context_window_tokens') ? Number(values.get('context_window_tokens')) : null, max_output_tokens: Number(values.get('max_output_tokens')),
        request_timeout_seconds: Number(values.get('request_timeout_seconds')),
        capabilities: { tools: values.get('tools') ? values.get('tools') === 'true' : null,
          thinking: values.get('thinking') ? values.get('thinking') === 'true' : null,
          structured_output: values.get('structured_output') ? values.get('structured_output') === 'true' : null },
        pricing: { provider_id: String(values.get('provider_id')) || null, model_id: String(values.get('pricing_model_id')) || null,
          multiplier: String(values.get('multiplier')) || null, input_per_million: String(values.get('input_per_million')) || null,
          output_per_million: String(values.get('output_per_million')) || null, cache_read_per_million: String(values.get('cache_read_per_million')) || null,
          cache_write_per_million: String(values.get('cache_write_per_million')) || null, currency: 'USD' },
      };
      const saved = await client.saveModel(profile_id, { meta: commandMeta(selected?.version ?? null), data });
      setModels(page => ({ ...page!, items: Object.values(mergeVersioned(
        Object.fromEntries(page!.items.map(item => [item.id, item])), [saved])) }));
      setSelectedId(saved.id);
      setStatus('模型配置已保存；仅对新运行生效');
      onSaved?.(form);
    } catch (error) {
      setError(error instanceof ApiError ? `${error.code}: ${error.message}` : '模型保存失败，请检查配置和 Runtime 状态');
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
      setError(error instanceof ApiError ? `${error.code}: ${error.message}` : '读取下一页配置失败');
    } finally { inflight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  function cancelEdit() {
    onDiscard?.(formRef.current!);
    setEditRevision(value => value + 1); setError(''); setStatus('');
  }

  return <section aria-labelledby="model-settings-title">
    <div className="model-heading"><h2 id="model-settings-title">模型设置</h2><button disabled={busy || !models} onClick={() => guard(() => { setSelectedId(''); setEditing(true); setStatus(''); setError(''); })}>新建模型</button></div>
    <p className="muted">修改仅对新运行生效；未知价格不表示免费。</p>
    {error && <p className="status-message" role="alert">{error}</p>}<p className="status-message" role="status">{status}</p>
    <div className="model-list">{models?.items.map(item => <button key={item.id} disabled={busy} aria-expanded={editing && selectedId === item.id} onClick={() => guard(() => { setEditing(selectedId !== item.id || !editing); setSelectedId(item.id); setStatus(''); setError(''); })}>{item.display_name ?? item.model_id}<span>{editing && selectedId === item.id ? '收起' : '展开编辑'}</span></button>)}</div>
    {models?.next_cursor && <button className="button" disabled={busy} onClick={loadMore}>更多模型</button>}
    {editing && resolution && <section className="resolved-model" aria-label="当前生效配置"><h3>当前生效配置 · 版本 {resolution.version} / 连接 {resolution.connection_version}</h3>
      <p>上下文容量：{resolution.context_window_tokens ?? '未知'} · 最大输出：{resolution.max_output_tokens} · 时限：{resolution.request_timeout_seconds}s</p>
      <p>能力：{Object.entries(resolution.capabilities).map(([key, value]) => `${key}：${value === null ? '未知' : value ? '支持' : '不支持'}`).join(' · ')}</p>
      {resolution.pricing_unknown_reason && <p>价格未知：{resolution.pricing_unknown_reason}；不代表免费</p>}
      <details><summary>配置来源与计价依据</summary><ul>{Object.entries(resolution.metadata_sources).map(([field, source]) => <li key={field}>{field}：{{ user: '用户覆盖', catalog: '目录', application: '应用默认', unknown: '未知' }[source.kind]} · {source.source} {source.version} {source.verified_at} {source.note}</li>)}</ul>
      {resolution.model_pricing && <><p>计价来源：{resolution.model_pricing.source} · {resolution.model_pricing.catalog_version} · 倍率 {resolution.model_pricing.effective_multiplier}；不是供应商实扣</p><PricingAssumptions assumptions={resolution.model_pricing.assumptions} /></>}
      </details>{resolution.blockers.map(item => <p key={item}>运行阻塞：{item}</p>)}
    </section>}
    {editing && <form ref={formRef} key={`${selectedId}:${selected?.version ?? 'new'}:${editRevision}`} onSubmit={save} onReset={() => setEditRevision(value => value + 1)} className="settings-form">
      <fieldset disabled={busy || !models} className="settings-grid">
        <legend>模型配置</legend>
        <label className="model-fixed-connection">所属连接 <select name="connection_id" disabled value={connection.id}>
          <option value={connection.id}>{connection.display_name} · {connection.endpoint}</option>
        </select></label>
        {!selected && connection.provider_preset_id && <label>搜索目录候选 <input data-settings-search value={candidateQuery} onChange={event => setCandidateQuery(event.target.value)} /></label>}
        {!selected && candidates.length > 0 && <label>目录候选 <select defaultValue="" onChange={event => { setCandidateId(event.target.value); (formRef.current!.elements.namedItem('model_id') as HTMLInputElement).value = event.target.value; }}><option value="">选择候选，或自由填写 ID</option>{candidates.map(item => <option key={item.model_id} value={item.model_id}>{item.display_name ?? item.model_id} · 容量 {item.context_window_tokens ?? '未知'}</option>)}</select></label>}
        {!selected && candidates.find(item => item.model_id === candidateId) && <ul>{Object.entries(candidates.find(item => item.model_id === candidateId)!.metadata_sources).map(([field, source]) => <li key={field}>{field}：{source.kind} · {source.source} {source.version} {source.verified_at} {source.note}</li>)}</ul>}
        <label>Model ID <input name="model_id" required maxLength={256} disabled={!!selected} defaultValue={selected?.model_id ?? ''} onChange={() => setCandidateId('')} /></label>
        <label>模型显示名称 <input name="display_name" maxLength={256} defaultValue={selected?.display_name ?? ''} /></label>
        <label>上下文容量（tokens） <input name="context_window_tokens" type="number" min="1" step="1" defaultValue={selected?.context_window_tokens ?? ''} /></label>
        <label>最大输出（tokens） <input name="max_output_tokens" type="number" min="1" step="1" required defaultValue={selected?.max_output_tokens ?? 2048} /></label>
        <details className="advanced-settings"><summary>高级覆盖 · 留空由目录解析或报告未知</summary>
        <p>模型创建后型号和所属连接不可修改；使用其他型号请新增。地址与凭据在连接设置中管理。</p>
        {connection.protocol === 'openai_compatible' && <label>输出上限参数 <select name="openai_max_tokens_field" defaultValue={selected?.openai_max_tokens_field ?? ''}>
          <option value="">未覆盖（应用默认）</option><option value="max_completion_tokens">max_completion_tokens</option><option value="max_tokens">max_tokens</option>
        </select></label>}
        <label>请求时限（秒） <input name="request_timeout_seconds" type="number" min="0" step="any" required defaultValue={selected?.request_timeout_seconds ?? 60} /></label>
        {(['tools', 'thinking'] as const).map(capability => <label key={capability}>{capability} <select name={capability} defaultValue={selected?.capabilities[capability] == null ? '' : String(selected.capabilities[capability])}>
          <option value="">未覆盖（目录或未知）</option><option value="true">支持</option><option value="false">不支持</option>
        </select></label>)}
        <p>结构化输出尚未实现，不提供启用开关；能力留空不表示 SDK 默认已验证。</p><input type="hidden" name="structured_output" value={selected?.capabilities.structured_output == null ? '' : String(selected.capabilities.structured_output)} />
        <label>价格目录 provider ID <input name="provider_id" defaultValue={selected?.pricing?.provider_id ?? ''} /></label>
        <label>价格目录 model ID <input name="pricing_model_id" defaultValue={selected?.pricing?.model_id ?? ''} /></label>
        {(['multiplier', 'input_per_million', 'output_per_million', 'cache_read_per_million', 'cache_write_per_million'] as const).map(field => <label key={field}>{field}（USD / 百万 tokens；倍率除外） <input name={field} inputMode="decimal" defaultValue={selected?.pricing?.[field] ?? ''} /></label>)}
        </details>
        <button className="button" type="submit" disabled={busy}>保存模型</button>
        <button className="button" type="button" disabled={busy} onClick={cancelEdit}>取消编辑</button>
      </fieldset>
    </form>}
  </section>;
}
