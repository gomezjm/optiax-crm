'use client';

/**
 * Settings orchestrator (WS-D4 §2). Holds the browser Supabase client and the
 * active tab; each master is a small CRUD section reusing the D1/D2 table +
 * drawer patterns. After a write, sections call `router.refresh()` so the
 * server component re-reads and the props update.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { t, type TranslationKey } from '@/i18n/index';
import { cn } from '@/lib/utils';
import type { SettingsData } from '@/lib/settings/types';
import { AttributesSection } from './attributes-section';
import { StatusesSection } from './statuses-section';
import { PaymentMethodsSection } from './payment-methods-section';
import { TeamSection } from './team-section';
import { ChannelSection } from './channel-section';

type Tab = 'attributes' | 'statuses' | 'payments' | 'team' | 'channel';

const TABS: { id: Tab; labelKey: TranslationKey }[] = [
  { id: 'attributes', labelKey: 'settings.tabs.attributes' },
  { id: 'statuses', labelKey: 'settings.tabs.statuses' },
  { id: 'payments', labelKey: 'settings.tabs.payments' },
  { id: 'team', labelKey: 'settings.tabs.team' },
  { id: 'channel', labelKey: 'settings.tabs.channel' },
];

export function SettingsClient({
  tenantId,
  data,
}: {
  tenantId: string;
  data: SettingsData;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tab, setTab] = useState<Tab>('attributes');
  const refresh = () => router.refresh();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-b bg-background px-6 py-4">
        <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.subtitle')}</p>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b px-6">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm',
              tab === item.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          {tab === 'attributes' && (
            <AttributesSection
              tenantId={tenantId}
              supabase={supabase}
              defs={data.attributeDefs}
              publishedCaptureKeys={data.publishedCaptureKeys}
              onChanged={refresh}
            />
          )}
          {tab === 'statuses' && (
            <StatusesSection supabase={supabase} statuses={data.orderStatuses} onChanged={refresh} />
          )}
          {tab === 'payments' && (
            <PaymentMethodsSection
              tenantId={tenantId}
              supabase={supabase}
              methods={data.paymentMethods}
              onChanged={refresh}
            />
          )}
          {tab === 'team' && (
            <TeamSection
              supabase={supabase}
              team={data.team}
              currentUserId={data.currentUserId}
              onChanged={refresh}
            />
          )}
          {tab === 'channel' && <ChannelSection channel={data.channel} />}
        </div>
      </div>
    </div>
  );
}
