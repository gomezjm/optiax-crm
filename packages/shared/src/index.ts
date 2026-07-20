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

export {
  CONSENT_STATUSES,
  ConsentStatusSchema,
  normalizeCustomerPhone,
  PHONE_MIN_DIGITS,
  PHONE_MAX_DIGITS,
  AttributeValueSchema,
  CustomerEditSchema,
  CustomerCreateSchema,
  CustomerImportRowSchema,
  IMPORT_MAX_ROWS,
  MASS_EDIT_MAX_ROWS,
  type ConsentStatus,
  type AttributeValue,
  type CustomerEdit,
  type CustomerCreate,
  type CustomerImportRow,
} from './schemas/customer.js';

export {
  PRODUCT_MAX_IMAGES,
  PRODUCT_IMAGE_MAX_EDGE,
  ProductSchema,
  ProductCategorySchema,
  effectivePrice,
  type Product,
  type ProductCategory,
} from './schemas/product.js';

export {
  ORDER_MAX_ITEMS,
  PAYMENT_STATES,
  OrderItemInputSchema,
  OrderCreateSchema,
  OrderUpdateSchema,
  OrderStatusUpdateSchema,
  OrderPaymentUpdateSchema,
  OrderLogisticsUpdateSchema,
  computeOrderTotal,
  paymentState,
  type OrderItemInput,
  type OrderCreate,
  type OrderUpdate,
  type OrderStatusUpdate,
  type OrderPaymentUpdate,
  type OrderLogisticsUpdate,
  type PaymentState,
} from './schemas/order.js';

export {
  AGENT_SKIP_REASONS,
  AgentSkipReasonSchema,
  type AgentSkipReason,
} from './schemas/agent-skip-reason.js';

export { compilePrompt, type CompileResult } from './compiler/compile-prompt.js';
export { VERTICAL_TEMPLATES, resolveVertical } from './compiler/verticals.js';

export {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
} from './webhook-signature.js';

export type { Database, Json } from './db-types.js';
