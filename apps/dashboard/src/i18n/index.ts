/**
 * The i18n pattern for all dashboard screens (spec §4): every UI string lives
 * in `es.json`, keys structured per screen, accessed through this typed `t()`.
 * No library yet — revisit in D1. Later sessions copy this.
 */
import es from './es.json';

type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type TranslationKey = Leaves<typeof es>;

export function t(key: TranslationKey): string {
  let node: unknown = es;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) break;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') throw new Error(`Missing translation: ${key}`);
  return node;
}
