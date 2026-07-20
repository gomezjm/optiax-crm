import { z } from 'zod';
import { AttributeValueSchema, ConsentStatusSchema } from './customer.js';

/**
 * Argument contracts for the agent's function-calling tools (WS-R2 §3).
 *
 * These live here, not in the runtime, for the same reason every other schema
 * does: the tool declarations sent to the model, the validation the executor
 * runs, and the assertions R3's evals make are all the same shape, and a
 * second copy is a second thing to drift.
 *
 * `create_order` deliberately has no schema of its own — it validates with
 * D2's `OrderCreateSchema` verbatim (see `agent-tool-args.ts` for the wrapper
 * that adds the confirmation flag without forking the order contract).
 *
 * Model-supplied args carry business data ONLY. Tenant identity is bound from
 * the loop context and is never a declared argument, so a model that invents a
 * `tenant_id` has nowhere to put it — `.strict()` rejects it outright.
 */

/** The four tools the runtime can offer. Which are actually declared depends on config. */
export const AGENT_TOOL_NAMES = [
  'check_catalog',
  'capture_customer',
  'create_order',
  'handoff_to_human',
] as const;
export const AgentToolNameSchema = z.enum(AGENT_TOOL_NAMES);
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

/** Most results the model narrates are short; cap what a tool may hand back. */
export const CATALOG_RESULT_LIMIT = 12;

export const CheckCatalogArgsSchema = z
  .object({
    /** Free-text product search; matched against name and description. */
    query: z.string().trim().min(1).max(140).optional(),
    /** Category name as shown in the catalog, not an id — the model never sees ids. */
    category: z.string().trim().min(1).max(80).optional(),
    /** Default true: customers ask about what they can actually buy. */
    onlyAvailable: z.boolean().optional(),
  })
  .strict();
export type CheckCatalogArgs = z.infer<typeof CheckCatalogArgsSchema>;

/**
 * Core identity the agent may set on the conversation's customer, plus free
 * `attributes` for the tenant's configured capture fields.
 *
 * Every field is optional: capture is incremental, a few facts at a time as
 * they come up in conversation. `wa_id`/`phone` are absent on purpose — those
 * come from the WhatsApp envelope, and letting the model rewrite them would
 * let a customer reassign someone else's record.
 */
export const CaptureCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(200).optional(),
    address: z.string().trim().max(300).optional(),
    city: z.string().trim().max(120).optional(),
    gender: z.string().trim().max(40).optional(),
    age_group: z.string().trim().max(20).optional(),
    consent_status: ConsentStatusSchema.optional(),
    /**
     * Tenant-defined capture fields. Keys are further constrained at execution
     * time to the tenant's `capture.fields` — the schema cannot know them.
     */
    attributes: z
      .record(z.string().regex(/^[a-z0-9_]{1,60}$/, 'attribute keys are snake_case'), AttributeValueSchema)
      .optional(),
  })
  .strict()
  .refine((args) => Object.keys(args).length > 0, {
    message: 'provide at least one field to save',
  });
export type CaptureCustomer = z.infer<typeof CaptureCustomerSchema>;

export const HANDOFF_REASONS = [
  'keyword',
  'payment_proof',
  'complaint',
  'human_request',
  'other',
] as const;
export const HandoffReasonSchema = z.enum(HANDOFF_REASONS);
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export const HandoffToHumanArgsSchema = z
  .object({
    reason: HandoffReasonSchema,
    /** What to tell the human picking this up. Not sent to the customer. */
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type HandoffToHumanArgs = z.infer<typeof HandoffToHumanArgsSchema>;
