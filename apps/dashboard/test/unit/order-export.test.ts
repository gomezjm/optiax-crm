import { describe, expect, it } from 'vitest';
import { buildExportRows, exportFileName, toCsv } from '../../src/lib/orders/csv';
import { formatItemsSummary, truncateItemsSummary } from '../../src/lib/orders/summary';
import { shortOrderId, type OrderListItem } from '../../src/lib/orders/types';

function line(overrides: Partial<OrderListItem['items'][number]>) {
  return {
    id: 'item-1',
    created_at: '2026-07-20T00:00:00.000Z',
    tenant_id: 'tenant-1',
    order_id: 'order-1',
    product_id: 'product-1',
    description: 'Almuerzo ejecutivo',
    qty: 2,
    unit_price: 18000,
    sort_order: 0,
    ...overrides,
  };
}

function orderItem(overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    order: {
      id: 'aa000000-0040-4000-8000-000000000001',
      created_at: '2026-07-18T10:00:00.000Z',
      updated_at: '2026-07-18T10:00:00.000Z',
      tenant_id: 'tenant-1',
      customer_id: 'customer-1',
      conversation_id: null,
      status_id: 'status-1',
      total: 45000,
      currency: 'COP',
      payment_method_id: null,
      payment_reference: null,
      payment_proof_media_path: null,
      payment_verified_at: null,
      delivery_address: 'Cl 45 #13-40, Bogotá',
      delivery_date: '2026-07-20',
      driver_notes: 'Preguntar en recepción',
      source: 'manual',
      campaign_id: null,
    },
    customer: {
      id: 'customer-1',
      name: 'Andrés Pardo',
      phone: '573125550202',
      wa_id: '573125550202',
      address: 'Cl 45 #13-40',
      city: 'Bogotá',
    },
    items: [
      line({}),
      line({ id: 'item-2', description: 'Jugo natural', qty: 1, unit_price: 9000, sort_order: 1 }),
    ],
    ...overrides,
  };
}

describe('items summary', () => {
  it('renders "qty× description" joined by commas', () => {
    expect(formatItemsSummary(orderItem().items)).toBe('2× Almuerzo ejecutivo, 1× Jugo natural');
  });

  it('is empty for an order with no lines', () => {
    expect(formatItemsSummary([])).toBe('');
  });

  it('truncates for the list cell and reports the remainder', () => {
    const items = [line({}), line({ id: '2' }), line({ id: '3' })];
    expect(truncateItemsSummary(items, 2)).toEqual({
      text: '2× Almuerzo ejecutivo, 2× Almuerzo ejecutivo',
      remaining: 1,
    });
  });

  it('reports no remainder when everything fits', () => {
    expect(truncateItemsSummary([line({})], 2).remaining).toBe(0);
  });
});

describe('CSV export row shaping', () => {
  it('produces the eight handoff columns in order', () => {
    const [row] = buildExportRows([orderItem()]);
    expect(Object.keys(row ?? {})).toEqual([
      'cliente',
      'telefono',
      'direccion_entrega',
      'fecha_entrega',
      'articulos',
      'total',
      'estado_pago',
      'notas_domiciliario',
    ]);
  });

  it('display-formats the phone and writes the total as a bare number', () => {
    const [row] = buildExportRows([orderItem()]);
    expect(row?.['telefono']).toBe('+57 312 555 0202');
    // No "$" and no thousands separator: the column must stay summable in Sheets.
    expect(row?.['total']).toBe('45000');
  });

  it('translates the derived payment state', () => {
    const verified = orderItem();
    verified.order.payment_verified_at = '2026-07-19T12:00:00.000Z';
    expect(buildExportRows([verified])[0]?.['estado_pago']).toBe('Verificado');

    const awaiting = orderItem();
    awaiting.order.payment_proof_media_path = 'tenant-1/orders/order-1/proof.jpg';
    expect(buildExportRows([awaiting])[0]?.['estado_pago']).toBe(
      'Comprobante subido — por verificar',
    );
  });

  it('writes empty strings, never "null", for missing fields', () => {
    const bare = orderItem({ customer: null });
    bare.order.delivery_address = null;
    bare.order.delivery_date = null;
    bare.order.driver_notes = null;
    const [row] = buildExportRows([bare]);
    expect(row?.['cliente']).toBe('');
    expect(row?.['direccion_entrega']).toBe('');
    expect(row?.['fecha_entrega']).toBe('');
    expect(row?.['notas_domiciliario']).toBe('');
    // No phone at all still renders the em dash the UI uses, not "null".
    expect(row?.['telefono']).toBe('—');
  });

  it('falls back to wa_id when the customer has no typed phone', () => {
    const item = orderItem();
    item.customer = { ...item.customer!, phone: null };
    expect(buildExportRows([item])[0]?.['telefono']).toBe('+57 312 555 0202');
  });

  it('serializes to CSV with a header row and quoted commas', () => {
    const csv = toCsv(buildExportRows([orderItem()]));
    const [header, first] = csv.split('\r\n');
    expect(header).toContain('cliente');
    expect(header).toContain('notas_domiciliario');
    // The items summary contains a comma, so it must be quoted.
    expect(first).toContain('"2× Almuerzo ejecutivo, 1× Jugo natural"');
  });
});

describe('export file name', () => {
  it('is pedidos-YYYY-MM-DD.csv', () => {
    expect(exportFileName('2026-07-20')).toBe('pedidos-2026-07-20.csv');
  });
});

describe('shortOrderId', () => {
  it('is the first 8 characters of the uuid', () => {
    expect(shortOrderId('aa000000-0040-4000-8000-000000000001')).toBe('aa000000');
  });
});
