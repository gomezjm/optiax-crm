/**
 * Declaration generation per config permutation, plus the parity check that
 * makes hand-mapped JSON schemas safe (ws-r2 §2, §6).
 */
import { describe, expect, it } from 'vitest';
import { buildToolDeclarations, TOOL_ARG_SCHEMAS } from '../src/tools/index.js';
import type { JsonSchemaNode } from '../src/model/types.js';
import type { ToolDeclaration } from '../src/model/types.js';
import { makeAgentConfig } from './fakes.js';

const WITH_PRODUCTS = { hasProducts: true };
const NO_PRODUCTS = { hasProducts: false };

function names(declarations: ToolDeclaration[]): string[] {
  return declarations.map((d) => d.name);
}

describe('buildToolDeclarations — which tools a tenant is offered', () => {
  it('offers catalog, capture and handoff by default', () => {
    const declarations = buildToolDeclarations(makeAgentConfig(), WITH_PRODUCTS);
    expect(names(declarations)).toEqual(['check_catalog', 'capture_customer', 'handoff_to_human']);
  });

  it('adds create_order only when orders are enabled', () => {
    const off = buildToolDeclarations(makeAgentConfig(), WITH_PRODUCTS);
    expect(names(off)).not.toContain('create_order');

    const on = buildToolDeclarations(
      makeAgentConfig({}, { orders: { enabled: true } }),
      WITH_PRODUCTS,
    );
    expect(names(on)).toContain('create_order');
  });

  it('drops catalog tools when the tenant has no products', () => {
    const declarations = buildToolDeclarations(
      makeAgentConfig({}, { orders: { enabled: true } }),
      NO_PRODUCTS,
    );
    // No catalog means no priceable line, so an order could only be invented.
    expect(names(declarations)).toEqual(['capture_customer', 'handoff_to_human']);
  });

  it('always offers handoff_to_human, even with no escalation rules configured', () => {
    const declarations = buildToolDeclarations(
      makeAgentConfig({}, { escalation: { rules: [] } }),
      NO_PRODUCTS,
    );
    // A bot with no way to fetch a human is a trap for the customer.
    expect(names(declarations)).toContain('handoff_to_human');
  });

  it('names the tenant capture fields in the capture_customer description', () => {
    const declarations = buildToolDeclarations(
      makeAgentConfig(
        {},
        { capture: { fields: [{ key: 'talla', required: true }, { key: 'barrio', required: false }] } },
      ),
      NO_PRODUCTS,
    );
    const capture = declarations.find((d) => d.name === 'capture_customer');
    expect(capture?.description).toContain('talla (required)');
    expect(capture?.description).toContain('barrio');
  });

  it('spells out the confirmation requirement when confirmBeforeCreate is on', () => {
    const withConfirm = buildToolDeclarations(
      makeAgentConfig({}, { orders: { enabled: true, confirmBeforeCreate: true } }),
      WITH_PRODUCTS,
    ).find((d) => d.name === 'create_order');
    expect(withConfirm?.description).toContain('confirmed: true');

    const without = buildToolDeclarations(
      makeAgentConfig({}, { orders: { enabled: true, confirmBeforeCreate: false } }),
      WITH_PRODUCTS,
    ).find((d) => d.name === 'create_order');
    expect(without?.description).not.toContain('explicit yes');
  });
});

/**
 * The declarations are hand-written JSON Schema (see declarations.ts for why),
 * so nothing but this test stops them drifting from the Zod schemas the
 * executors validate with.
 *
 * Checked behaviorally rather than by reflecting over Zod internals: build an
 * instance from the declaration alone, and assert the schema accepts it. If a
 * declared property is one the schema would reject — a typo, a wrong type, a
 * field that only exists on one side — the round trip fails.
 */
describe('declared shapes match validated shapes', () => {
  /**
   * Values for fields whose declared type is honest but under-specifies what
   * the schema demands (uuid, ISO date, email). Everything else is generated
   * from the declared type.
   */
  const FORMATTED: Record<string, unknown> = {
    product_id: 'aa000000-0060-4000-8000-000000000001',
    delivery_date: '2026-07-25',
    email: 'ana@example.com',
  };

  function sampleFor(key: string, node: JsonSchemaNode): unknown {
    if (key in FORMATTED) return FORMATTED[key];
    if (node.enum && node.enum.length > 0) return node.enum[0];
    switch (node.type) {
      case 'string':
        return 'texto';
      case 'number':
        return 1.5;
      case 'integer':
        return 2;
      case 'boolean':
        return true;
      case 'array':
        return node.items ? [buildObject(node.items)] : [];
      case 'object':
        return buildObject(node);
    }
  }

  function buildObject(node: JsonSchemaNode): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      out[key] = sampleFor(key, child);
    }
    return out;
  }

  const allTools = buildToolDeclarations(
    makeAgentConfig(
      {},
      {
        orders: { enabled: true, confirmBeforeCreate: true },
        capture: { fields: [{ key: 'talla', required: false }] },
      },
    ),
    WITH_PRODUCTS,
  );

  it('declares every tool the registry can execute', () => {
    expect(names(allTools).sort()).toEqual(Object.keys(TOOL_ARG_SCHEMAS).sort());
  });

  for (const declaration of allTools) {
    it(`${declaration.name}: every declared property is one the schema accepts`, () => {
      const schema = TOOL_ARG_SCHEMAS[declaration.name];
      const args: Record<string, unknown> = {};
      for (const [key, node] of Object.entries(declaration.parameters.properties)) {
        // `attributes` keys are tenant-defined; use one the config configured.
        args[key] = key === 'attributes' ? { talla: 'M' } : sampleFor(key, node);
      }

      const result = schema.safeParse(args);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });

    it(`${declaration.name}: schema rejects each declared-required field when missing`, () => {
      const schema = TOOL_ARG_SCHEMAS[declaration.name];
      for (const required of declaration.parameters.required ?? []) {
        const args: Record<string, unknown> = {};
        for (const [key, node] of Object.entries(declaration.parameters.properties)) {
          if (key === required) continue;
          args[key] = key === 'attributes' ? { talla: 'M' } : sampleFor(key, node);
        }
        expect(schema.safeParse(args).success, `${declaration.name}.${required}`).toBe(false);
      }
    });

    /**
     * The other direction, and the one that actually bit: a field the
     * declaration leaves optional but the schema requires. The model omits it,
     * every call fails validation, and the tool looks broken for no visible
     * reason.
     */
    it(`${declaration.name}: schema accepts args omitting every declared-optional field`, () => {
      const schema = TOOL_ARG_SCHEMAS[declaration.name];
      const required = new Set(declaration.parameters.required ?? []);
      const args: Record<string, unknown> = {};
      for (const [key, node] of Object.entries(declaration.parameters.properties)) {
        if (required.has(key)) args[key] = sampleFor(key, node);
      }
      // capture_customer needs at least one field to have something to save.
      if (declaration.name === 'capture_customer') args.name = 'Ana';

      const result = schema.safeParse(args);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });

    it(`${declaration.name}: schema rejects an undeclared field`, () => {
      const schema = TOOL_ARG_SCHEMAS[declaration.name];
      const args: Record<string, unknown> = { not_a_declared_field: 'x' };
      for (const [key, node] of Object.entries(declaration.parameters.properties)) {
        args[key] = key === 'attributes' ? { talla: 'M' } : sampleFor(key, node);
      }
      expect(schema.safeParse(args).success).toBe(false);
    });
  }

  it('create_order declares the same item fields the schema validates', () => {
    const items = allTools.find((d) => d.name === 'create_order')?.parameters.properties.items;
    expect(items?.type).toBe('array');
    expect(Object.keys(items?.items?.properties ?? {}).sort()).toEqual(['product_id', 'qty']);
    expect(items?.items?.required?.slice().sort()).toEqual(['product_id', 'qty']);
  });

  it('no tool declares tenant or customer identity — that comes from the loop', () => {
    for (const declaration of allTools) {
      const properties = Object.keys(declaration.parameters.properties);
      expect(properties).not.toContain('tenant_id');
      expect(properties).not.toContain('customer_id');
    }
  });
});
