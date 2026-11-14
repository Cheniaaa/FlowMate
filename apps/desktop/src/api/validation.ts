import * as validators from '../generated/validators.js';

export type RootName = keyof typeof validators;
export type Validated<N extends RootName> = typeof validators[N] extends (value: unknown) => value is infer T ? T : never;

export function validate<N extends RootName>(name: N, value: unknown): Validated<N> {
  if (!validators[name](value)) throw new Error(`Runtime 契约校验失败：${name}`);
  return value as Validated<N>;
}
