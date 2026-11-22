import { useId, useState, type RefObject } from 'react';
import { ApiError } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Field, FieldLabel, FieldLegend, FieldSet } from '../../components/ui/field';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';

type Value = string | number | boolean | string[] | null | undefined;
type ChooseField = <V extends Value>(label: string, original: V, draft: V, latest: V, format?: (value: V) => string) => V;
type Choice = 'draft' | 'latest';
type Difference = { label: string; draft: string; latest: string };

function equal(left: Value, right: Value) {
  if (Array.isArray(left) && Array.isArray(right)) return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  return (left ?? null) === (right ?? null);
}

function display(value: Value): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.join('、') || '无';
  return value == null || value === '' ? '未设置' : String(value);
}

export function useSettingsConflict<T extends { version: number }, Draft = T>(
  inflight: RefObject<boolean>, setBusy: (busy: boolean) => void, onBusyChange: ((busy: boolean) => void) | undefined,
  merge: (original: T, draft: Draft, latest: T, choose: ChooseField) => Draft,
) {
  const [conflict, setConflict] = useState<{ original: T; draft: Draft; latest?: T; error?: string }>();
  const [editing, setEditing] = useState<{ base: T; draft: Draft }>();
  const [choices, setChoices] = useState<Record<string, Choice>>({});

  function capture(error: unknown, original: T | undefined, draft: Draft) {
    if (!(error instanceof ApiError)) return false;
    if (error.code === 'version_conflict' && original) {
      setConflict({ original, draft });
      setChoices({});
      return true;
    }
    if (conflict?.latest && error.status >= 400 && error.status < 500) {
      setEditing({ base: conflict.latest, draft });
      setConflict(undefined);
    }
    return false;
  }

  async function read(load: () => Promise<T | undefined>) {
    if (!conflict || inflight.current) return;
    inflight.current = true;
    setBusy(true); onBusyChange?.(true);
    try {
      const latest = await load();
      setConflict(latest && latest.version > conflict.original.version ? { ...conflict, latest, error: undefined }
        : { ...conflict, error: '未读到更新后的配置。请稍后重新读取，或取消编辑。' });
    } catch {
      setConflict({ ...conflict, error: '暂时无法读取最新配置，请重试。' });
    } finally {
      inflight.current = false;
      setBusy(false); onBusyChange?.(false);
    }
  }

  const differences: Difference[] = [];
  const merged = conflict?.latest && merge(conflict.original, conflict.draft, conflict.latest, (label, original, draft, latest, format = display) => {
    if (equal(original, draft) || equal(draft, latest)) return latest;
    if (equal(original, latest)) return draft;
    differences.push({ label, draft: format(draft), latest: format(latest) });
    return choices[label] === 'draft' ? draft : latest;
  });
  return {
    conflict, editing, capture, read, differences, choices,
    latestBase: conflict?.latest ?? editing?.base,
    clear: () => { setConflict(undefined); setEditing(undefined); },
    merged: differences.every(({ label }) => choices[label]) ? merged : undefined,
    choose: (label: string, choice: Choice) => setChoices(current => ({ ...current, [label]: choice })),
  };
}

export async function findSetting<T extends { id: string }>(id: string,
  load: (cursor?: string) => Promise<{ items: T[]; next_cursor?: string | null }>,
) {
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    const match = page.items.find(item => item.id === id);
    if (match) return match;
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
}

export default function SettingsConflict({ label, latest, error, busy, onRead, differences, choices, choose }: {
  label: string; latest?: string; error?: string; busy: boolean; onRead: () => void;
  differences: Difference[]; choices: Record<string, Choice>; choose: (label: string, choice: Choice) => void;
}) {
  const groupId = useId();
  return <section aria-label={`${label}配置冲突`} className="flex flex-col items-start gap-2 rounded-md border border-border bg-background p-3 [overflow-wrap:anywhere]">
    {latest ? <>
      <p role="status">当前已保存：{latest}。不同字段会合并。{differences.length > 0 ? '请逐项选择双方都改过的字段。' : '可保存合并后的设置。'}</p>
      {differences.map((field, index) => {
        const name = `${groupId}-${index}`;
        return <FieldSet key={field.label} disabled={busy} className="w-full">
          <FieldLegend id={`${name}-legend`}>{field.label}</FieldLegend>
          <RadioGroup name={name} aria-labelledby={`${name}-legend`} disabled={busy} value={choices[field.label] ?? ''}
            onValueChange={value => choose(field.label, value as Choice)}>
            {([['draft', '使用我的值'], ['latest', '保留已保存值']] as const).map(([value, title]) => {
              const id = `${name}-${value}`;
              return <div key={value}>
                <Field orientation="horizontal">
                  <RadioGroupItem id={id} value={value} aria-describedby={`${id}-detail`} />
                  <FieldLabel htmlFor={id}>{title}</FieldLabel>
                </Field>
                <p id={`${id}-detail`} className="whitespace-pre-wrap pl-6">{field[value]}</p>
              </div>;
            })}
          </RadioGroup>
        </FieldSet>;
      })}
    </> : <>
      <p role="alert" className="text-destructive">{error ?? '此配置已由其他操作更新。草稿已保留，请先读取最新配置。'}</p>
      <Button type="button" disabled={busy} onClick={onRead}>读取最新{label}配置</Button>
    </>}
  </section>;
}
