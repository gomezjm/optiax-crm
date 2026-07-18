import { z } from 'zod';

/** Trigger DSL for auto_reply_rules.trigger (spec §4). */
export const AutoReplyTriggerSchema = z
  .object({
    kind: z.enum(['keyword', 'first_message', 'outside_hours']),
    keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(20).optional(),
  })
  .strict()
  .superRefine((trigger, ctx) => {
    if (trigger.kind === 'keyword' && (!trigger.keywords || trigger.keywords.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['keywords'],
        message: "required when kind is 'keyword'",
      });
    }
  });

export type AutoReplyTrigger = z.infer<typeof AutoReplyTriggerSchema>;
