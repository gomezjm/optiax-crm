import type { AttributeType, Database, SegmentRules } from '@optiax/shared';
import type { CustomerListItem } from '@/lib/customers/types';

export type SegmentRow = Database['public']['Tables']['segments']['Row'];
export type SegmentInsert = Database['public']['Tables']['segments']['Insert'];
export type SegmentUpdate = Database['public']['Tables']['segments']['Update'];

/** Attribute key → its def type, the shape the engine's context wants. */
export type AttributeTypeMap = Record<string, AttributeType>;

/** A segment plus its live member count (evaluated, never materialized). */
export interface SegmentListItem {
  segment: SegmentRow;
  /** Parsed rules, or null if the stored jsonb doesn't satisfy the schema. */
  rules: SegmentRules | null;
  /** Live count of matching customers, or null when the rules are invalid. */
  count: number | null;
}

/** A page of a segment's members (live evaluation). */
export interface SegmentMembersPage {
  items: CustomerListItem[];
  total: number;
}
