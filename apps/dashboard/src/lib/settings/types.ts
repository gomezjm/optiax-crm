import type { Database } from '@optiax/shared';

export type AttributeDefRow = Database['public']['Tables']['attribute_defs']['Row'];
export type OrderStatusRow = Database['public']['Tables']['order_statuses']['Row'];
export type PaymentMethodRow = Database['public']['Tables']['payment_methods']['Row'];
export type Role = Database['public']['Enums']['e_role'];
export type ChannelStatus = Database['public']['Enums']['e_channel_status'];

/** Just the team columns Settings renders. */
export interface TeamMember {
  id: string;
  display_name: string;
  role: Role;
}

export interface SettingsData {
  role: Role;
  currentUserId: string;
  attributeDefs: AttributeDefRow[];
  orderStatuses: OrderStatusRow[];
  paymentMethods: PaymentMethodRow[];
  team: TeamMember[];
  channel: { status: ChannelStatus; phoneNumberId: string | null };
  /**
   * Attribute keys referenced by the published config's `capture.fields`.
   * Disabling/deleting one of these breaks a live agent — the UI warns first.
   */
  publishedCaptureKeys: string[];
}

/**
 * Whether demoting `profileId` from admin is allowed: never when it is the last
 * admin in the tenant (phase-0: only admins can manage roles, so a tenant with
 * zero admins would be unrecoverable from the UI). Pure + unit-tested.
 */
export function canDemoteAdmin(team: TeamMember[], profileId: string): boolean {
  const target = team.find((m) => m.id === profileId);
  if (!target || target.role !== 'admin') return true; // not an admin → n/a
  const adminCount = team.filter((m) => m.role === 'admin').length;
  return adminCount > 1;
}
