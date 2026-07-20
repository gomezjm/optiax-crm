import { z } from 'zod';

/**
 * agent_config v1 (spec §5). Strict everywhere: unknown keys are validation errors.
 * All free text is length-capped — this JSON is compiled into the system prompt.
 */

const shortText = (max: number) => z.string().trim().min(1).max(max);

const HHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm (24h)');

export const ScheduleSchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday */
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    start: HHMM,
    end: HHMM,
  })
  .strict();

export const BusinessSchema = z
  .object({
    name: shortText(120),
    description: shortText(1000),
    vertical: shortText(50),
    address: shortText(300).optional(),
    hours: shortText(300).optional(),
    socialLinks: z.array(z.string().trim().url().max(200)).max(10).optional(),
  })
  .strict();

export const AgentBehaviorSchema = z
  .object({
    displayName: shortText(80),
    tone: z.enum(['formal', 'cercano', 'neutral']),
    language: z.literal('es'),
    emojiUsage: z.enum(['none', 'light', 'frequent']),
    /** Screen 5 audio rules */
    audioPolicy: z.enum(['transcribe', 'text_reply']),
    operatingMode: z.enum(['always', 'outside_hours', 'schedule']),
    schedule: ScheduleSchema.optional(),
    pauseHoursOnOwnerReply: z.number().int().min(1).max(168).default(24),
  })
  .strict();

export const CatalogPolicySchema = z
  .object({
    canQuotePrices: z.boolean(),
    offerPromos: z.boolean(),
    outOfStock: z.enum(['say_unavailable', 'suggest_alternative']),
  })
  .strict();

export const FaqSchema = z
  .object({
    q: shortText(300),
    a: shortText(500),
  })
  .strict();

export const CaptureFieldSchema = z
  .object({
    /** Must exist in attribute_defs for the tenant — enforced in the app layer, not here. */
    key: z
      .string()
      .regex(/^[a-z0-9_]{1,60}$/, 'lowercase snake_case, max 60 chars'),
    required: z.boolean(),
  })
  .strict();

export const OrdersPolicySchema = z
  .object({
    enabled: z.boolean(),
    confirmBeforeCreate: z.boolean(),
    collectDelivery: z.boolean(),
    sharePaymentMethods: z.boolean(),
  })
  .strict();

export const EscalationRuleSchema = z
  .object({
    trigger: z.enum(['keyword', 'payment_proof', 'complaint', 'human_request']),
    keywords: z.array(shortText(60)).min(1).max(20).optional(),
  })
  .strict();

export const EscalationSchema = z
  .object({
    rules: z.array(EscalationRuleSchema).max(20).default([]),
    handoffMessage: shortText(500),
  })
  .strict();

export const GuardrailsSchema = z
  .object({
    forbiddenTopics: z.array(shortText(100)).max(20).default([]),
    custom: z.array(shortText(300)).max(20).default([]),
  })
  .strict();

export const AgentConfigSchema = z
  .object({
    version: z.literal(1),
    business: BusinessSchema,
    agent: AgentBehaviorSchema,
    catalog: CatalogPolicySchema,
    faqs: z.array(FaqSchema).max(50).default([]),
    capture: z
      .object({ fields: z.array(CaptureFieldSchema).max(20).default([]) })
      .strict()
      .default({ fields: [] }),
    orders: OrdersPolicySchema,
    escalation: EscalationSchema,
    guardrails: GuardrailsSchema.default({ forbiddenTopics: [], custom: [] }),
  })
  .strict()
  .superRefine((config, ctx) => {
    // Both schedule-relative modes need a schedule: "outside" of an undefined
    // schedule is meaningless, and silently degrading to always-active is a
    // surprise the owner never asked for (ws-r1 §8.2).
    const mode = config.agent.operatingMode;
    if ((mode === 'schedule' || mode === 'outside_hours') && !config.agent.schedule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agent', 'schedule'],
        message: `required when operatingMode is '${mode}'`,
      });
    }
    for (const [i, rule] of config.escalation.rules.entries()) {
      if (rule.trigger === 'keyword' && (!rule.keywords || rule.keywords.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['escalation', 'rules', i, 'keywords'],
          message: "required when trigger is 'keyword'",
        });
      }
    }
  });

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type AgentConfigInput = z.input<typeof AgentConfigSchema>;

/** Structured validation error — the dashboard wizard renders these. */
export interface ConfigValidationError {
  path: string;
  message: string;
}

export type ValidateAgentConfigResult =
  | { ok: true; config: AgentConfig }
  | { ok: false; errors: ConfigValidationError[] };

export function validateAgentConfig(input: unknown): ValidateAgentConfigResult {
  const result = AgentConfigSchema.safeParse(input);
  if (result.success) {
    return { ok: true, config: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
