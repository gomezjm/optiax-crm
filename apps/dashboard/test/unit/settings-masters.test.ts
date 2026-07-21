/**
 * Unit tests for the Settings masters contracts + guards (WS-D4 §2/§4). Pure —
 * no DB. The RLS-backed CRUD lives in test/db/settings-db.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  AttributeDefCreateSchema,
  AttributeDefUpdateSchema,
  PaymentMethodCreateSchema,
} from '@optiax/shared';
import { canDemoteAdmin, type TeamMember } from '../../src/lib/settings/types';

describe('AttributeDefCreateSchema', () => {
  const base = { key: 'talla', label: 'Talla', enabled: true };

  it('accepts a text def with no options', () => {
    const r = AttributeDefCreateSchema.safeParse({ ...base, type: 'text', options: null });
    expect(r.success).toBe(true);
  });

  it('requires options for a select def', () => {
    const r = AttributeDefCreateSchema.safeParse({ ...base, type: 'select', options: null });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['options']);
  });

  it('rejects options on a non-select def', () => {
    const r = AttributeDefCreateSchema.safeParse({ ...base, type: 'text', options: ['a'] });
    expect(r.success).toBe(false);
  });

  it('rejects a non snake_case key', () => {
    const r = AttributeDefCreateSchema.safeParse({ ...base, key: 'Talla Preferida', type: 'text', options: null });
    expect(r.success).toBe(false);
  });

  it('accepts a select def with options', () => {
    const r = AttributeDefCreateSchema.safeParse({ ...base, type: 'select', options: ['S', 'M', 'L'] });
    expect(r.success).toBe(true);
  });
});

describe('AttributeDefUpdateSchema — key and type are immutable', () => {
  it('has no `key` field', () => {
    const r = AttributeDefUpdateSchema.safeParse({
      key: 'other',
      label: 'X',
      options: null,
      enabled: true,
    });
    // `.strict()` rejects the extra `key`.
    expect(r.success).toBe(false);
  });

  it('has no `type` field', () => {
    const r = AttributeDefUpdateSchema.safeParse({
      type: 'number',
      label: 'X',
      options: null,
      enabled: true,
    });
    expect(r.success).toBe(false);
  });

  it('accepts label + options + enabled', () => {
    const r = AttributeDefUpdateSchema.safeParse({ label: 'X', options: null, enabled: false });
    expect(r.success).toBe(true);
  });
});

describe('PaymentMethodCreateSchema', () => {
  it('requires a non-empty label and details', () => {
    expect(PaymentMethodCreateSchema.safeParse({ label: '', details: 'x', enabled: true }).success).toBe(false);
    expect(PaymentMethodCreateSchema.safeParse({ label: 'Nequi', details: '', enabled: true }).success).toBe(false);
    expect(PaymentMethodCreateSchema.safeParse({ label: 'Nequi', details: '300', enabled: true }).success).toBe(true);
  });
});

describe('canDemoteAdmin (last-admin guard)', () => {
  const team = (roles: TeamMember['role'][]): TeamMember[] =>
    roles.map((role, i) => ({ id: `u${i}`, display_name: `U${i}`, role }));

  it('blocks demoting the only admin', () => {
    expect(canDemoteAdmin(team(['admin', 'sales_rep']), 'u0')).toBe(false);
  });

  it('allows demoting an admin when another admin remains', () => {
    expect(canDemoteAdmin(team(['admin', 'admin']), 'u0')).toBe(true);
  });

  it('is a no-op for a non-admin', () => {
    expect(canDemoteAdmin(team(['admin', 'sales_rep']), 'u1')).toBe(true);
  });
});
