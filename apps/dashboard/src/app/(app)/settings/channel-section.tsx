'use client';

/**
 * WhatsApp channel status (WS-D4 §2) — read-only. Embedded Signup / token entry
 * is Phase 4; here we only surface what `tenants` already knows and point at the
 * one-step-connection-coming note. The bulk-import link (D1) lives alongside it
 * rather than getting its own tab.
 */
import Link from 'next/link';
import { ExternalLink, MessageCircle, Upload } from 'lucide-react';
import { t, type TranslationKey } from '@/i18n/index';
import type { ChannelStatus } from '@/lib/settings/types';

const STATUS_LABEL: Record<ChannelStatus, TranslationKey> = {
  live: 'settings.channel.statusLive',
  pending: 'settings.channel.statusPending',
  disconnected: 'settings.channel.statusDisconnected',
};

const STATUS_CLASS: Record<ChannelStatus, string> = {
  live: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  disconnected: 'border-border bg-muted text-muted-foreground',
};

export function ChannelSection({
  channel,
}: {
  channel: { status: ChannelStatus; phoneNumberId: string | null };
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <MessageCircle className="size-4" />
            {t('settings.channel.title')}
          </h2>
        </div>
        <dl className="rounded-lg border">
          <div className="flex items-center justify-between border-b px-4 py-3 text-sm">
            <dt className="text-muted-foreground">{t('settings.channel.status')}</dt>
            <dd>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[channel.status]}`}
              >
                {t(STATUS_LABEL[channel.status])}
              </span>
            </dd>
          </div>
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <dt className="text-muted-foreground">{t('settings.channel.phoneNumber')}</dt>
            <dd className="font-mono text-xs">
              {channel.phoneNumberId ?? t('settings.channel.notConfigured')}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{t('settings.channel.note')}</p>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Upload className="size-4" />
            {t('settings.import.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('settings.import.description')}</p>
        </div>
        <Link
          href="/customers/import"
          className="inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50"
        >
          <ExternalLink className="size-4" />
          {t('settings.import.link')}
        </Link>
      </section>
    </div>
  );
}
