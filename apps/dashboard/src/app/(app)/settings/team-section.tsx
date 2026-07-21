'use client';

/**
 * Team roles (WS-D4 §2). An admin flips another member between admin and
 * sales_rep (phase-0: only admins manage roles). No invites — Phase 4. The last
 * admin can't be demoted: the option is disabled and the mutation refuses too.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { UserCog } from 'lucide-react';
import { t } from '@/i18n/index';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { canDemoteAdmin, type Role, type TeamMember } from '@/lib/settings/types';
import { LastAdminError, updateMemberRole } from '@/lib/settings/mutations';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function TeamSection({
  supabase,
  team,
  currentUserId,
  onChanged,
}: {
  supabase: DashboardSupabaseClient;
  team: TeamMember[];
  currentUserId: string;
  onChanged: () => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);

  async function onChangeRole(member: TeamMember, role: Role) {
    if (role === member.role) return;
    setSavingId(member.id);
    try {
      await updateMemberRole(supabase, team, member.id, role);
      toast.success(t('settings.team.roleChanged'));
      onChanged();
    } catch (err) {
      toast.error(err instanceof LastAdminError ? t('settings.team.lastAdminHint') : t('common.errorGeneric'));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <UserCog className="size-4" />
          {t('settings.team.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('settings.team.description')}</p>
      </div>

      <ul className="divide-y rounded-lg border">
        {team.map((member) => {
          // Only the last admin is locked; everyone else can be re-roled freely.
          const demotionBlocked = !canDemoteAdmin(team, member.id);
          return (
            <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{member.display_name}</span>
                  {member.id === currentUserId && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t('settings.team.you')}
                    </span>
                  )}
                </div>
                {demotionBlocked && (
                  <p className="text-xs text-muted-foreground">{t('settings.team.lastAdminHint')}</p>
                )}
              </div>
              <Select
                value={member.role}
                disabled={savingId === member.id}
                onValueChange={(role) => void onChangeRole(member, role as Role)}
              >
                <SelectTrigger size="sm" className="w-40" aria-label={t('settings.team.role')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('settings.team.admin')}</SelectItem>
                  <SelectItem value="sales_rep" disabled={demotionBlocked}>
                    {t('settings.team.sales_rep')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">{t('settings.team.noInvites')}</p>
    </section>
  );
}
