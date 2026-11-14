import { useId, useState, type FormEvent } from 'react';
import type { AnswerCommand, Question } from '../../generated/contracts';

type Answer = AnswerCommand['data']['answer'];
interface FieldSchema {
  type?: string | string[]; title?: string; description?: string; enum?: (string | number | boolean | null)[];
  properties?: Record<string, FieldSchema>; required?: string[]; items?: FieldSchema;
  minLength?: number; maxLength?: number; minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number;
  minItems?: number; maxItems?: number; uniqueItems?: boolean; additionalProperties?: boolean;
  multipleOf?: number;
}
function fieldTypes(schema: FieldSchema): string[] { return Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : schema.enum?.length ? [typeof schema.enum.find(value => value !== null)] : []; }

// 仅解释平台支持的有界子集，不动态编译代码；WebView CSP 不允许 unsafe-eval。
function problem(schema: FieldSchema, value: Answer | undefined): string | undefined {
  const types = fieldTypes(schema);
  if (schema.enum && !schema.enum.includes(value as string)) return '请选择明确选项';
  if (value === null) return types.includes('null') ? undefined : '此字段不能为 null';
  const type = types.find(type => type !== 'null');
  if (type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return '请填写必填字段';
    for (const [key, field] of Object.entries(schema.properties ?? {})) {
      if (!Object.hasOwn(value, key)) { if (schema.required?.includes(key)) return `${field.title ?? key}为必填项`; continue; }
      const error = problem(field, (value as Record<string, Answer>)[key]); if (error) return `${field.title ?? key}：${error}`;
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) return '请选择选项';
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return '所选数量超出范围';
    if (schema.uniqueItems && new Set(value).size !== value.length) return '选项不能重复';
    for (const item of value) { const error = problem(schema.items!, item); if (error) return error; }
  } else if (type === 'string') {
    if (typeof value !== 'string') return '请输入文本';
    if ([...value].length < (schema.minLength ?? 0) || [...value].length > (schema.maxLength ?? Infinity)) return '文本长度超出范围';
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') return '请选择是或否';
  } else if (typeof value !== 'number' || !Number.isFinite(value) || type === 'integer' && !Number.isInteger(value)
    || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)
    || schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum || schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return '请输入范围内的数字';
  else if (schema.multipleOf !== undefined) { const ratio = value / schema.multipleOf; if (Math.abs(ratio - Math.round(ratio)) > Number.EPSILON * Math.max(1, Math.abs(ratio))) return '数字不符合 multipleOf 步长'; }
}
function supported(schema: FieldSchema, depth = 0): boolean {
  const types = fieldTypes(schema);
  const type = types.filter(type => type !== 'null');
  if (type.length !== 1) return false;
  const keywords = ['type', 'title', 'description', 'enum'];
  if (schema.enum) {
    if (schema.enum.length === 0 || schema.enum.length > 20 || !schema.enum.every(value => value === null ? types.includes('null') : ['string', 'number', 'boolean'].includes(typeof value) && typeof value === (type[0] === 'integer' ? 'number' : type[0]))) return false;
    if (schema.type === undefined) return Object.keys(schema).every(key => keywords.includes(key));
  }
  if (type[0] === 'object') {
    keywords.push('properties', 'required', 'additionalProperties');
    const fields = schema.properties ?? {};
    if (depth !== 0 || schema.enum || Object.keys(fields).length > 12 || schema.additionalProperties === true || !Object.values(fields).every(field => supported(field, 1))) return false;
  } else if (type[0] === 'array') {
    keywords.push('items', 'minItems', 'maxItems', 'uniqueItems');
    if (schema.enum || !schema.items?.enum || !supported(schema.items, 2)) return false;
  } else if (type[0] === 'string') keywords.push('minLength', 'maxLength');
  else if (type[0] === 'number' || type[0] === 'integer') keywords.push('minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf');
  else if (type[0] !== 'boolean') return false;
  return Object.keys(schema).every(key => keywords.includes(key));
}
function Field({ schema, value, onChange, label }: { schema: FieldSchema; value: Answer | undefined; onChange: (value: Answer | undefined) => void; label: string }) {
  const name = useId();
  const types = fieldTypes(schema);
  const type = types.find(type => type !== 'null');
  const choices = schema.enum && schema.enum.length <= 4 ? schema.enum : !schema.enum && type === 'boolean' ? [true, false] : undefined;
  return <div className="question-field">
    {types.includes('null') && <label className="inline-choice"><input type="checkbox" aria-label={`${label}：设为 null`} checked={value === null} onChange={event => onChange(event.target.checked ? null : undefined)} />设为 null</label>}
    {value !== null && (choices ? <fieldset className="question-choices"><legend>{label}</legend>{choices.map((item, index) => <label className="inline-choice" key={index}><input type="radio" name={name} checked={value === item} onChange={() => onChange(item)} />{typeof item === 'boolean' ? item ? '是' : '否' : String(item)}</label>)}</fieldset>
      : schema.enum ? <label>{label}<select value={value === undefined ? '' : String(schema.enum.indexOf(value as string))} onChange={event => onChange(event.target.value === '' ? undefined : schema.enum![Number(event.target.value)])}>
      <option value="">请选择</option>{schema.enum.map((item, index) => <option key={index} value={index}>{String(item)}</option>)}</select></label>
        : type === 'array' ? <fieldset className="question-choices"><legend>{label}</legend>{schema.items!.enum!.map((item, index) => <label className="inline-choice" key={index}><input type="checkbox" checked={Array.isArray(value) && value.includes(item)} onChange={event => onChange(event.target.checked ? [...(Array.isArray(value) ? value : []), item] : (value as Answer[]).filter(value => value !== item))} />{String(item)}</label>)}</fieldset>
          : type === 'string' ? <label>{label}<textarea rows={2} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} /></label>
            : <label>{label}<input type="number" step={type === 'integer' ? '1' : 'any'} value={typeof value === 'number' ? value : ''} onChange={event => onChange(event.target.value === '' ? undefined : Number(event.target.value))} /></label>)}
    {schema.description && <p className="muted">{schema.description}</p>}
  </div>;
}
export default function QuestionForm({ question, value, onChange, onSubmit, busy, onCancel }: {
  question: Question; value: Answer | undefined; onChange: (value: Answer | undefined) => void; onSubmit: (value: Answer) => void; busy: boolean;
  onCancel?: () => void;
}) {
  const schema = question.answer_schema as unknown as FieldSchema;
  const [error, setError] = useState('');
  if (!supported(schema)) return <div className="interaction-body"><p role="alert">此问题的表单结构不受支持，无法处理。可取消当前运行，再在新会话重新提出有效问题。</p>{onCancel && <button disabled={busy} onClick={onCancel}>取消当前运行</button>}</div>;
  function submit(event: FormEvent) {
    event.preventDefault();
    const type = fieldTypes(schema).find(type => type !== 'null');
    const answer = value === undefined && !schema.enum ? type === 'object' ? {} : type === 'array' ? [] : type === 'string' ? '' : value : value;
    const bytes = (value: Answer | undefined): number => typeof value === 'string' ? new TextEncoder().encode(value).length : value && typeof value === 'object' ? Object.values(value).reduce<number>((total, item) => total + bytes(item), 0) : 0;
    const error = bytes(answer) > 8192 ? '回答文本总量不能超过 8KiB' : problem(schema, answer);
    setError(error ?? ''); if (!error && !busy) onSubmit(answer!);
  }
  const fields = Object.entries(schema.properties ?? {}).map(([key, field]) => ({ required: !!schema.required?.includes(key), label: field.title ?? key,
    element: <div className="question-property" key={key}><Field schema={field} label={field.title ?? key} value={value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Answer>)[key] : undefined} onChange={next => {
      const fields: Record<string, Answer> = { ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}) }; if (next === undefined) delete fields[key]; else fields[key] = next; onChange(fields);
    }} />{!schema.required?.includes(key) && <button className="question-clear" type="button" onClick={() => { const fields = { ...(value as Record<string, Answer>) }; delete fields[key]; onChange(fields); }}>不填写{field.title ?? key}</button>}</div>,
  }));
  const optional = fields.filter(field => !field.required);
  return <form className="question-form" onSubmit={submit} noValidate onKeyDown={event => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) event.preventDefault();
  }}>
    <div className="interaction-body"><h3>{question.question}</h3>
      {fieldTypes(schema).includes('object') && schema.description && <p>{schema.description}</p>}
      {fieldTypes(schema).includes('object') && schema.title && <h4>{schema.title}</h4>}
      {fieldTypes(schema).includes('object') && fieldTypes(schema).includes('null') && <label className="inline-choice"><input type="checkbox" checked={value === null} onChange={event => onChange(event.target.checked ? null : undefined)} />整个回答设为 null</label>}
      {fieldTypes(schema).includes('object') ? value !== null && <>{fields.filter(field => field.required).map(field => field.element)}
        {optional.length > 0 && <details className="question-optional"><summary>{optional.length === 1 ? `${optional[0].label}（可选）` : `补充信息（可选，${optional.length}项）`}</summary>{optional.map(field => field.element)}</details>}
      </> : <Field schema={schema} label={schema.title ?? '回答'} value={value} onChange={onChange} />}
      {error && <p role="alert">{error}</p>}
    </div><footer className="interaction-footer"><button disabled={busy} className="button--primary">提交回答</button></footer>
  </form>;
}
