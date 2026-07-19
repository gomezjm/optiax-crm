import type { Database } from '@optiax/shared';

export type CustomerRow = Database['public']['Tables']['customers']['Row'];
export type CustomerInsert = Database['public']['Tables']['customers']['Insert'];
export type CustomerUpdate = Database['public']['Tables']['customers']['Update'];
export type TagRow = Database['public']['Tables']['tags']['Row'];
export type AttributeDefRow = Database['public']['Tables']['attribute_defs']['Row'];
export type ConsentStatus = Database['public']['Enums']['e_consent'];
export type CustomerSource = Database['public']['Enums']['e_customer_source'];
export type AttrType = Database['public']['Enums']['e_attr_type'];

/** A customer plus its resolved tags, as rendered in the list. */
export interface CustomerListItem {
  customer: CustomerRow;
  tags: TagRow[];
}

export interface CustomersPage {
  items: CustomerListItem[];
  /** Total rows matching the filter (for pagination). */
  total: number;
}

/** `options` of a select attribute def, parsed. */
export function selectOptions(def: AttributeDefRow): string[] {
  return Array.isArray(def.options) ? def.options.filter((o): o is string => typeof o === 'string') : [];
}
