/**
 * Monotonic ordering for `wa_status` webhook updates (ws-r1 spec §5, ratified
 * P1-Q4). Deliveries can arrive out of order — a late `delivered` must never
 * overwrite `read`. `failed` is terminal: recordable from any state, never
 * downgraded once stored.
 */
import type { Database } from '@optiax/shared';

type WaStatus = Database['public']['Enums']['e_wa_status'];

const RANK: Record<Exclude<WaStatus, 'failed'>, number> = {
  accepted: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/** True when `incoming` should replace `current` (current=null → always). */
export function shouldRecordStatus(current: WaStatus | null, incoming: WaStatus): boolean {
  if (current === 'failed') return false;
  if (incoming === 'failed') return true;
  if (current === null) return true;
  return RANK[incoming] > RANK[current];
}
