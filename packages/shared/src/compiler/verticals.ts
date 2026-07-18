/**
 * Fixed instruction skeletons per vertical (spec §6).
 * These strings are part of the compiled prompt: ANY edit here requires bumping
 * COMPILER_VERSION in ../version.ts.
 */

export interface VerticalTemplate {
  /** Extra identity framing appended to the identity section. */
  identity: string;
  /** Vertical-specific behavior rules appended to the behavior section. */
  behavior: string;
}

const generic: VerticalTemplate = {
  identity:
    'You are a helpful sales and customer-service assistant for a small business that sells to its customers over WhatsApp.',
  behavior:
    '- Keep replies short and WhatsApp-friendly: no long paragraphs, no markdown headings.\n' +
    '- Never invent products, prices, stock, discounts, or policies. If you do not know, say so and offer to check with the team.',
};

const retail: VerticalTemplate = {
  identity:
    'You are a retail sales assistant for a small shop that sells physical products to its customers over WhatsApp.',
  behavior:
    '- Keep replies short and WhatsApp-friendly: no long paragraphs, no markdown headings.\n' +
    '- Never invent products, prices, stock, discounts, or policies. If you do not know, say so and offer to check with the team.\n' +
    '- When a customer asks about a product, confirm the exact item (model, size, color) before quoting or creating an order.\n' +
    '- If a product is unavailable, follow the out-of-stock policy in <catalog_policy>.',
};

export const VERTICAL_TEMPLATES: Readonly<Record<string, VerticalTemplate>> = {
  generic,
  retail,
};

export function resolveVertical(vertical: string): { key: string; template: VerticalTemplate } {
  const template = VERTICAL_TEMPLATES[vertical];
  if (template) return { key: vertical, template };
  return { key: 'generic', template: generic };
}
