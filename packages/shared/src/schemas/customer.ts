import { z } from 'zod';

/**
 * Customer edit/create/import contracts (WS-D1 spec §7). The dashboard is the
 * only consumer today, but the shapes live here per the shared-types rule.
 * `source` is intentionally absent from the edit shape: provenance is stated
 * explicitly at each write site (`manual` / `import`), never defaulted.
 */

export const CONSENT_STATUSES = ['unknown', 'opted_in', 'opted_out'] as const;
export const ConsentStatusSchema = z.enum(CONSENT_STATUSES);
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

/**
 * Normalize a phone to bare digits (strip `+`, spaces, dashes, parens…).
 * Import dedupe and duplicate checks compare normalized forms.
 */
export function normalizeCustomerPhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Minimum/maximum digit counts for a plausible phone (E.164 upper bound). */
export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

const phoneField = z
  .string()
  .trim()
  .max(30)
  .refine(
    (value) => {
      const digits = normalizeCustomerPhone(value);
      return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
    },
    { message: `must contain ${PHONE_MIN_DIGITS}-${PHONE_MAX_DIGITS} digits` },
  );

/** Values storable in `customers.attributes` (keys governed by attribute_defs). */
export const AttributeValueSchema = z.union([
  z.string().max(300),
  z.number().finite(),
  z.boolean(),
]);
export type AttributeValue = z.infer<typeof AttributeValueSchema>;

const attributesField = z.record(
  z.string().regex(/^[a-z0-9_]{1,60}$/, 'attribute keys are snake_case'),
  AttributeValueSchema,
);

/**
 * Editable surface of a customer row (detail drawer). Automated metrics
 * (total_spent, last_order_at, last_message_at) and wa_id are read-only.
 */
export const CustomerEditSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable(),
    phone: phoneField.nullable(),
    email: z.string().trim().email().max(200).nullable(),
    address: z.string().trim().max(300).nullable(),
    city: z.string().trim().max(120).nullable(),
    gender: z.string().trim().max(40).nullable(),
    age_group: z.string().trim().max(20).nullable(),
    consent_status: ConsentStatusSchema,
    attributes: attributesField,
  })
  .strict();
export type CustomerEdit = z.infer<typeof CustomerEditSchema>;

/** Manual creation requires at least name + phone (spec §4). */
export const CustomerCreateSchema = CustomerEditSchema.extend({
  name: z.string().trim().min(1).max(120),
  phone: phoneField,
});
export type CustomerCreate = z.infer<typeof CustomerCreateSchema>;

/** Consent spellings accepted from CSV imports (case-insensitive). */
const CONSENT_ALIASES: Record<string, ConsentStatus> = {
  opted_in: 'opted_in',
  opted_out: 'opted_out',
  unknown: 'unknown',
  si: 'opted_in',
  sí: 'opted_in',
  yes: 'opted_in',
  no: 'opted_out',
};

const importConsentField = z.string().trim().transform((value, ctx) => {
  const mapped = CONSENT_ALIASES[value.toLowerCase()];
  if (!mapped) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `unrecognized consent value: ${value}`,
    });
    return z.NEVER;
  }
  return mapped;
});

/** CSV cells: blank means "not provided", never an empty-string value. */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const csvOptional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

/**
 * One mapped CSV row, before insert. Core-field strings come straight from the
 * file; attribute values arrive already converted by the mapping step
 * (type-aware per attribute_defs). Consent defaults to `unknown` when the
 * column is absent or blank (spec §6).
 */
export const CustomerImportRowSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: phoneField,
    email: csvOptional(z.string().trim().email().max(200)),
    address: csvOptional(z.string().trim().max(300)),
    city: csvOptional(z.string().trim().max(120)),
    gender: csvOptional(z.string().trim().max(40)),
    age_group: csvOptional(z.string().trim().max(20)),
    consent_status: z.preprocess(blankToUndefined, importConsentField.optional()).transform(
      (value) => value ?? ('unknown' as const),
    ),
    attributes: attributesField.default({}),
  })
  .strict();
export type CustomerImportRow = z.infer<typeof CustomerImportRowSchema>;

/** Import hard cap (spec §6). */
export const IMPORT_MAX_ROWS = 5000;
/** Mass-edit selection cap (spec §5). */
export const MASS_EDIT_MAX_ROWS = 500;
