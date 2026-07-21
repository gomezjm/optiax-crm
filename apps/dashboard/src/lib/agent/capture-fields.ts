/**
 * The capture-field picker's option set (ws-d3 §3). Keys must always resolve so
 * the agent's `capture_customer` calls land somewhere real (phase-0 §5 app-layer
 * rule): a key is either a core customer column the executor writes directly, or
 * an enabled `attribute_def`. Anything else the agent tries to save is dropped.
 *
 * The core keys mirror `CaptureCustomerSchema`'s identity fields (agent-tools.ts).
 */
import { t, type TranslationKey } from '@/i18n/index';
import type { CaptureFieldOption } from './types';

/** Core customer columns the agent can capture, with their i18n labels. */
const CORE_FIELDS: { key: string; labelKey: TranslationKey }[] = [
  { key: 'name', labelKey: 'customers.drawer.name' },
  { key: 'email', labelKey: 'customers.drawer.email' },
  { key: 'address', labelKey: 'customers.drawer.address' },
  { key: 'city', labelKey: 'customers.drawer.city' },
  { key: 'gender', labelKey: 'customers.drawer.gender' },
  { key: 'age_group', labelKey: 'customers.drawer.ageGroup' },
];

/**
 * Build the picker options: core columns first, then enabled attribute_defs.
 * An attribute whose key collides with a core column is skipped (the core one wins).
 */
export function buildCaptureOptions(
  attributeDefs: { key: string; label: string }[],
): CaptureFieldOption[] {
  const core: CaptureFieldOption[] = CORE_FIELDS.map((f) => ({
    key: f.key,
    label: t(f.labelKey),
    kind: 'core',
  }));
  const coreKeys = new Set(core.map((o) => o.key));
  const attributes: CaptureFieldOption[] = attributeDefs
    .filter((d) => !coreKeys.has(d.key))
    .map((d) => ({ key: d.key, label: d.label, kind: 'attribute' }));
  return [...core, ...attributes];
}
