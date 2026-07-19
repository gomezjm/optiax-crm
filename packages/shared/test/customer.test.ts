import { describe, expect, it } from 'vitest';
import {
  CustomerCreateSchema,
  CustomerEditSchema,
  CustomerImportRowSchema,
  normalizeCustomerPhone,
} from '../src/schemas/customer.js';

describe('normalizeCustomerPhone', () => {
  it('strips plus, spaces, dashes and parens down to digits', () => {
    expect(normalizeCustomerPhone('+57 301 555-0101')).toBe('573015550101');
    expect(normalizeCustomerPhone('(301) 555.0101')).toBe('3015550101');
    expect(normalizeCustomerPhone('573015550101')).toBe('573015550101');
  });

  it('returns empty string when there are no digits', () => {
    expect(normalizeCustomerPhone('n/a')).toBe('');
  });
});

describe('CustomerEditSchema', () => {
  const valid = {
    name: 'Camila Rojas',
    phone: '+57 301 555 0101',
    email: 'camila@example.test',
    address: null,
    city: 'Medellín',
    gender: 'femenino',
    age_group: '25-34',
    consent_status: 'opted_in',
    attributes: { talla_preferida: 'M', cumpleanos: '1995-04-01', vip: true },
  };

  it('accepts a full valid edit', () => {
    expect(CustomerEditSchema.safeParse(valid).success).toBe(true);
  });

  it('allows nullable core fields', () => {
    const result = CustomerEditSchema.safeParse({
      ...valid,
      name: null,
      phone: null,
      email: null,
      gender: null,
      age_group: null,
      city: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects phones with too few digits', () => {
    expect(CustomerEditSchema.safeParse({ ...valid, phone: '12 34' }).success).toBe(false);
  });

  it('rejects phones with more than 15 digits', () => {
    expect(CustomerEditSchema.safeParse({ ...valid, phone: '1234567890123456' }).success).toBe(
      false,
    );
  });

  it('rejects invalid email', () => {
    expect(CustomerEditSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects unknown consent values', () => {
    expect(CustomerEditSchema.safeParse({ ...valid, consent_status: 'maybe' }).success).toBe(false);
  });

  it('rejects non-snake_case attribute keys', () => {
    expect(
      CustomerEditSchema.safeParse({ ...valid, attributes: { 'Talla Preferida': 'M' } }).success,
    ).toBe(false);
  });

  it('rejects unknown top-level keys (no source smuggling)', () => {
    expect(CustomerEditSchema.safeParse({ ...valid, source: 'agent' }).success).toBe(false);
  });
});

describe('CustomerCreateSchema', () => {
  it('requires name and phone', () => {
    expect(
      CustomerCreateSchema.safeParse({
        name: null,
        phone: '+57 301 555 0101',
        email: null,
        address: null,
        city: null,
        gender: null,
        age_group: null,
        consent_status: 'unknown',
        attributes: {},
      }).success,
    ).toBe(false);
    expect(
      CustomerCreateSchema.safeParse({
        name: 'Nueva Clienta',
        phone: '+57 301 555 0199',
        email: null,
        address: null,
        city: null,
        gender: null,
        age_group: null,
        consent_status: 'unknown',
        attributes: {},
      }).success,
    ).toBe(true);
  });
});

describe('CustomerImportRowSchema', () => {
  it('parses a minimal row and defaults consent to unknown', () => {
    const result = CustomerImportRowSchema.parse({
      name: 'Andrés Pardo',
      phone: '57 312 555 0202',
    });
    expect(result.consent_status).toBe('unknown');
    expect(result.attributes).toEqual({});
  });

  it('treats blank cells as not provided', () => {
    const result = CustomerImportRowSchema.parse({
      name: 'Rosa',
      phone: '3125550001',
      email: '  ',
      city: '',
      consent_status: '',
    });
    expect(result.email).toBeUndefined();
    expect(result.city).toBeUndefined();
    expect(result.consent_status).toBe('unknown');
  });

  it('maps Spanish consent aliases', () => {
    expect(
      CustomerImportRowSchema.parse({ name: 'X Y', phone: '3125550001', consent_status: 'Sí' })
        .consent_status,
    ).toBe('opted_in');
    expect(
      CustomerImportRowSchema.parse({ name: 'X Y', phone: '3125550001', consent_status: 'no' })
        .consent_status,
    ).toBe('opted_out');
  });

  it('rejects unrecognized consent values instead of silently defaulting', () => {
    expect(
      CustomerImportRowSchema.safeParse({
        name: 'X Y',
        phone: '3125550001',
        consent_status: 'tal vez',
      }).success,
    ).toBe(false);
  });

  it('rejects rows missing name or phone', () => {
    expect(CustomerImportRowSchema.safeParse({ phone: '3125550001' }).success).toBe(false);
    expect(CustomerImportRowSchema.safeParse({ name: 'Sin Teléfono' }).success).toBe(false);
  });

  it('rejects invalid emails with a row-level issue', () => {
    const result = CustomerImportRowSchema.safeParse({
      name: 'X',
      phone: '3125550001',
      email: 'nope',
    });
    expect(result.success).toBe(false);
  });

  it('accepts converted attribute values of each type', () => {
    const result = CustomerImportRowSchema.parse({
      name: 'X',
      phone: '3125550001',
      attributes: { barrio_entrega: 'Chapinero', puntos: 12, vip: false },
    });
    expect(result.attributes).toEqual({ barrio_entrega: 'Chapinero', puntos: 12, vip: false });
  });
});
