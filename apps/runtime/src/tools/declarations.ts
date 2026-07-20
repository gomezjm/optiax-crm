/**
 * Tool declarations, generated from the tenant's `agent_config` (ws-r2 §2).
 *
 * Which tools exist at all is a per-tenant question: a business that does not
 * take orders through the agent must not be handed a `create_order` it could
 * decide to call, and a tenant with no capture fields configured has nothing
 * for `capture_customer` to write.
 *
 * ## Why these JSON schemas are hand-written
 *
 * The obvious alternative is `zod-to-json-schema` over the shared schemas.
 * Rejected, and logged in SESSION_NOTES: it emits `$ref`/`definitions`,
 * `anyOf` for optionals, and draft-specific keywords that Gemini's
 * function-calling subset rejects, so it would need post-processing that is
 * itself more code than the four literals below — for one new dependency.
 *
 * The risk of hand-mapping is drift between what is declared and what the
 * executor validates. `test/tool-declarations.test.ts` closes that: it walks
 * each declaration against its Zod schema and asserts the property names and
 * required sets match exactly. Add a field on one side only and it fails.
 */
import {
  CaptureCustomerSchema,
  CheckCatalogArgsSchema,
  CreateOrderArgsSchema,
  HANDOFF_REASONS,
  HandoffToHumanArgsSchema,
  type AgentConfig,
  type AgentToolName,
} from '@optiax/shared';
import type { ToolDeclaration } from '../model/types.js';

/** Everything the declaration builder needs to know beyond the config. */
export interface DeclarationContext {
  /** False when the tenant's catalog has no products — nothing to look up. */
  hasProducts: boolean;
}

const checkCatalog: ToolDeclaration = {
  name: 'check_catalog',
  description:
    'Look up products, prices, promotions and availability in the live catalog. This is the ONLY source of truth for prices — never quote a price you did not get from this tool. Call it before answering any question about what is sold, what it costs, or whether it is in stock.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What the customer is asking about, in their own words (e.g. "blusa blanca"). Matched against product names and descriptions.',
      },
      category: {
        type: 'string',
        description: 'Restrict to one category, by its name as shown in the catalog.',
      },
      onlyAvailable: {
        type: 'boolean',
        description:
          'Only return products currently in stock. Defaults to true; pass false only when the customer explicitly asks about something unavailable.',
      },
    },
  },
};

function captureCustomer(config: AgentConfig): ToolDeclaration {
  const fields = config.capture.fields;
  const fieldList = fields
    .map((f) => `${f.key}${f.required ? ' (required)' : ''}`)
    .join(', ');

  return {
    name: 'capture_customer',
    description:
      'Save what you have learned about this customer. Call it as soon as the customer volunteers a detail — do not wait until the end, and never interrogate them for the whole list at once. Only pass fields you actually learned in this conversation.' +
      (fieldList
        ? ` The business also wants these custom fields, passed inside "attributes": ${fieldList}.`
        : ''),
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The customer's name." },
        email: { type: 'string', description: 'Email address.' },
        address: { type: 'string', description: 'Street address for delivery.' },
        city: { type: 'string', description: 'City.' },
        gender: { type: 'string', description: 'Only if the customer states it.' },
        age_group: { type: 'string', description: 'Only if the customer states it.' },
        consent_status: {
          type: 'string',
          enum: ['unknown', 'opted_in', 'opted_out'],
          description:
            'Set opted_in only when the customer clearly agrees to receive messages, opted_out when they ask to stop.',
        },
        attributes: {
          type: 'object',
          description: fieldList
            ? `Custom fields defined by the business: ${fieldList}. Use exactly these keys.`
            : 'Custom fields defined by the business. None are configured, so leave this out.',
        },
      },
    },
  };
}

function createOrder(config: AgentConfig): ToolDeclaration {
  const confirm = config.orders.confirmBeforeCreate;
  const delivery = config.orders.collectDelivery;

  return {
    name: 'create_order',
    description:
      'Register an order for this customer. Every line must reference a product_id you got from check_catalog — prices come from the catalog, not from you.' +
      (confirm
        ? ' Before calling this, recap the items, quantities and total to the customer and get an explicit yes; then pass confirmed: true. Calling it without an explicit agreement is an error.'
        : '') +
      (delivery
        ? ' Collect the delivery address and preferred date before closing the order.'
        : ''),
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The lines the customer is ordering.',
          items: {
            type: 'object',
            properties: {
              product_id: {
                type: 'string',
                description: 'The product id exactly as returned by check_catalog.',
              },
              qty: { type: 'integer', description: 'How many units, at least 1.' },
            },
            required: ['product_id', 'qty'],
          },
        },
        delivery_address: { type: 'string', description: 'Where to deliver.' },
        delivery_date: {
          type: 'string',
          description: 'Requested delivery date as YYYY-MM-DD.',
        },
        driver_notes: {
          type: 'string',
          description: 'Anything the person delivering needs to know.',
        },
        confirmed: {
          type: 'boolean',
          description: confirm
            ? 'Must be true, and only after the customer explicitly agreed to the recap.'
            : 'True when the customer has explicitly agreed to the order.',
        },
      },
      required: ['items'],
    },
  };
}

const handoffToHuman: ToolDeclaration = {
  name: 'handoff_to_human',
  description:
    'Hand the conversation to a human on the team. After calling this you stop replying — the tool sends the handoff message for you, so do not also write one.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: [...HANDOFF_REASONS],
        description: 'Why this needs a human.',
      },
      note: {
        type: 'string',
        description: 'A short note for the teammate picking this up. Not shown to the customer.',
      },
    },
    required: ['reason'],
  },
};

/**
 * The Zod schema each declared tool's arguments are validated against. Paired
 * here so the parity test can walk declaration and schema together, and so a
 * new tool cannot be declared without saying how it is validated.
 */
export const TOOL_ARG_SCHEMAS = {
  check_catalog: CheckCatalogArgsSchema,
  capture_customer: CaptureCustomerSchema,
  create_order: CreateOrderArgsSchema,
  handoff_to_human: HandoffToHumanArgsSchema,
} as const satisfies Record<AgentToolName, unknown>;

/**
 * Build the declarations this tenant's agent may use.
 *
 * `handoff_to_human` is unconditional: escalation config shapes *when* to use
 * it, but a bot with no way to fetch a human is a trap for the customer.
 */
export function buildToolDeclarations(
  config: AgentConfig,
  ctx: DeclarationContext,
): ToolDeclaration[] {
  const declarations: ToolDeclaration[] = [];

  if (ctx.hasProducts) declarations.push(checkCatalog);
  declarations.push(captureCustomer(config));
  // No catalog means no priceable line, so an order could only be invented.
  if (config.orders.enabled && ctx.hasProducts) declarations.push(createOrder(config));
  declarations.push(handoffToHuman);

  return declarations;
}
