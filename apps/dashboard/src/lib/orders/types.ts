import type { Database, PaymentState } from '@optiax/shared';

export type OrderRow = Database['public']['Tables']['orders']['Row'];
export type OrderItemRow = Database['public']['Tables']['order_items']['Row'];
export type OrderStatusRow = Database['public']['Tables']['order_statuses']['Row'];
export type PaymentMethodRow = Database['public']['Tables']['payment_methods']['Row'];
export type CustomerRow = Database['public']['Tables']['customers']['Row'];
export type StatusKind = Database['public']['Enums']['e_status_kind'];
export type OrderSource = Database['public']['Enums']['e_order_source'];

export type { PaymentState };

/** Just enough of the customer to render the list cell and the drawer card. */
export type OrderCustomer = Pick<
  CustomerRow,
  'id' | 'name' | 'phone' | 'wa_id' | 'address' | 'city'
>;

/** An order with everything the list row renders, resolved in one page fetch. */
export interface OrderListItem {
  order: OrderRow;
  customer: OrderCustomer | null;
  items: OrderItemRow[];
}

export interface OrdersPage {
  items: OrderListItem[];
  /** Total rows matching the filter (for pagination). */
  total: number;
}

/** The tenant's masters, loaded once per page render. */
export interface OrderMasters {
  statuses: OrderStatusRow[];
  paymentMethods: PaymentMethodRow[];
}

/** Short display id — the first 8 of the uuid, as the PRD's list shows (§2). */
export function shortOrderId(id: string): string {
  return id.slice(0, 8);
}
