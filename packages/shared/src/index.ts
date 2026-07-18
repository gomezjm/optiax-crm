export { COMPILER_VERSION } from './version.js';

export {
  AgentConfigSchema,
  BusinessSchema,
  AgentBehaviorSchema,
  CatalogPolicySchema,
  FaqSchema,
  CaptureFieldSchema,
  OrdersPolicySchema,
  EscalationSchema,
  EscalationRuleSchema,
  GuardrailsSchema,
  ScheduleSchema,
  validateAgentConfig,
  type AgentConfig,
  type AgentConfigInput,
  type ConfigValidationError,
  type ValidateAgentConfigResult,
} from './schemas/agent-config.js';

export {
  SegmentRulesSchema,
  SegmentConditionSchema,
  SegmentFieldSchema,
  SegmentOpSchema,
  SEGMENT_FIELDS,
  type SegmentRules,
  type SegmentCondition,
  type SegmentField,
  type SegmentOp,
} from './schemas/segment-rules.js';

export { AutoReplyTriggerSchema, type AutoReplyTrigger } from './schemas/auto-reply.js';

export { compilePrompt, type CompileResult } from './compiler/compile-prompt.js';
export { VERTICAL_TEMPLATES, resolveVertical } from './compiler/verticals.js';

export {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
} from './webhook-signature.js';

export type { Database, Json } from './db-types.js';
