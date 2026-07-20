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

export {
  AGENT_TOOL_NAMES,
  AgentToolNameSchema,
  CATALOG_RESULT_LIMIT,
  CheckCatalogArgsSchema,
  CaptureCustomerSchema,
  HANDOFF_REASONS,
  HandoffReasonSchema,
  HandoffToHumanArgsSchema,
  type AgentToolName,
  type CheckCatalogArgs,
  type CaptureCustomer,
  type HandoffReason,
  type HandoffToHumanArgs,
} from './schemas/agent-tools.js';

export {
  CreateOrderArgsSchema,
  CreateOrderItemArgsSchema,
  type CreateOrderArgs,
  type CreateOrderItemArgs,
} from './schemas/agent-tool-args.js';

export { compilePrompt, type CompileResult } from './compiler/compile-prompt.js';
export { VERTICAL_TEMPLATES, resolveVertical } from './compiler/verticals.js';

// Webhook signing is deliberately NOT re-exported here: it pulls in
// `node:crypto`, and this barrel is bundled by the dashboard. It lives behind
// the `@optiax/shared/webhook` subpath instead (ws-d1 §10.2).

export type { Database, Json } from './db-types.js';
