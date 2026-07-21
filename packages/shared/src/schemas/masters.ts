import { z } from 'zod';

/**
 * Settings masters contracts (WS-D4 §2). The dashboard's Settings screen writes
 * through these; they mirror the `attribute_defs`, `order_statuses` and
 * `payment_methods` tables that the configurator and orders screens read.
 *
 * Two immutability rules are baked into the *shape*, not just guarded in the UI:
 *   · `attribute_defs.key` is absent from the update schema — it is referenced by
 *     `customers.attributes` and published `capture.fields`, so it never changes.
 *   · `attribute_defs.type` is likewise absent from the update schema — stored
 *     customer values are typed, so retyping a def would silently invalidate them.
 * A def created with the wrong key/type is deleted and recreated, not edited.
 */

/** Matches the DB enum `e_attr_type` and the configurator's picker. */
export const ATTRIBUTE_TYPES = ['text', 'number', 'date', 'select', 'boolean'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

/** Same key grammar the compiler's `CaptureFieldSchema` enforces. */
const attributeKey = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,60}$/, 'lowercase snake_case, max 60 chars');

const attributeLabel = z.string().trim().min(1).max(80);
const attributeOptions = z.array(z.string().trim().min(1).max(60)).min(1).max(50).nullable();

/** `select` needs a non-empty option list; every other type forbids one. */
function refineOptions<T extends { type: AttributeType; options: string[] | null }>(
  data: T,
  ctx: z.RefinementCtx,
): void {
  if (data.type === 'select') {
    if (!data.options || data.options.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'select requires options' });
    }
  } else if (data.options !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'only select uses options' });
  }
}

export const AttributeDefCreateSchema = z
  .object({
    key: attributeKey,
    label: attributeLabel,
    type: z.enum(ATTRIBUTE_TYPES),
    options: attributeOptions,
    enabled: z.boolean(),
  })
  .strict()
  .superRefine(refineOptions);
export type AttributeDefCreate = z.infer<typeof AttributeDefCreateSchema>;

/** Mutable surface of an existing def: no `key`, no `type` (see file header). */
export const AttributeDefUpdateSchema = z
  .object({
    label: attributeLabel,
    options: attributeOptions,
    enabled: z.boolean(),
  })
  .strict();
export type AttributeDefUpdate = z.infer<typeof AttributeDefUpdateSchema>;

/**
 * Order statuses are rename + reorder only — never add/remove kinds (the
 * pipeline logic depends on the fixed set). So neither `kind` nor an insert
 * schema exists here on purpose.
 */
export const OrderStatusRenameSchema = z
  .object({ name: z.string().trim().min(1).max(40) })
  .strict();
export type OrderStatusRename = z.infer<typeof OrderStatusRenameSchema>;

export const OrderStatusReorderSchema = z
  .array(z.object({ id: z.string().uuid(), sort_order: z.number().int().min(0).max(999) }).strict())
  .min(1)
  .max(20);
export type OrderStatusReorder = z.infer<typeof OrderStatusReorderSchema>;

export const PaymentMethodCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    details: z.string().trim().min(1).max(400),
    enabled: z.boolean(),
  })
  .strict();
export type PaymentMethodCreate = z.infer<typeof PaymentMethodCreateSchema>;

export const PaymentMethodUpdateSchema = PaymentMethodCreateSchema.partial().strict();
export type PaymentMethodUpdate = z.infer<typeof PaymentMethodUpdateSchema>;
