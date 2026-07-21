/**
 * /home — the owner's daily snapshot (WS-D4 §1, PRD Screen 0). Server component:
 * runs the tenant-scoped aggregate reads (anon key + session; RLS scopes
 * everything) in the tenant's timezone and renders the cards + action list.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertCircle, ArrowRight, Megaphone, PackageCheck, Wallet } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { t } from '@/i18n/index';
import { formatMoney, formatRelative } from '@/lib/format';
import { serializeOrderFilterModel } from '@/lib/orders/filter-model';
import { fetchHomeSnapshot } from '@/lib/home/queries';

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: tenant } = await supabase
    .from('tenants')
    .select('currency, timezone')
    .single();
  const currency = tenant?.currency ?? 'COP';
  const timezone = tenant?.timezone ?? 'America/Bogota';

  const snapshot = await fetchHomeSnapshot(supabase, timezone);

  const pendingHref = `/orders?${serializeOrderFilterModel({ statusIds: snapshot.pendingStatusIds }).toString()}`;
  const verificationHref = snapshot.awaitingVerificationStatusId
    ? `/orders?${serializeOrderFilterModel({ statusId: snapshot.awaitingVerificationStatusId }).toString()}`
    : '/orders';

  const nothingToDo =
    snapshot.accionNecesaria === 0 &&
    snapshot.pedidosPendientes === 0 &&
    snapshot.ventasDeHoy === 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="border-b bg-background px-6 py-4">
        <h1 className="text-lg font-semibold">{t('home.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('home.subtitle')}</p>
      </header>

      <div className="flex flex-col gap-6 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={<Wallet className="size-5" />}
            label={t('home.cards.salesToday')}
            value={formatMoney(snapshot.ventasDeHoy, currency)}
            accent="emerald"
          />
          <KpiCard
            icon={<PackageCheck className="size-5" />}
            label={t('home.cards.pendingOrders')}
            value={String(snapshot.pedidosPendientes)}
            href={pendingHref}
            accent="blue"
          />
          <KpiCard
            icon={<AlertCircle className="size-5" />}
            label={t('home.cards.actionNeeded')}
            value={String(snapshot.accionNecesaria)}
            href={snapshot.verificationOrders.length > 0 ? verificationHref : '/inbox'}
            accent={snapshot.accionNecesaria > 0 ? 'amber' : 'muted'}
          />
          <KpiCard
            icon={<Megaphone className="size-5" />}
            label={t('home.cards.activeCampaigns')}
            value={snapshot.campanasActivas === null ? t('home.cards.comingSoon') : String(snapshot.campanasActivas)}
            accent="muted"
          />
        </div>

        {nothingToDo ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <h2 className="text-base font-medium">{t('home.empty.title')}</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {t('home.empty.body')}
            </p>
          </div>
        ) : (
          <section className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">{t('home.actionList.title')}</h2>
            </div>
            {snapshot.attentionConversations.length === 0 &&
            snapshot.verificationOrders.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                {t('home.actionList.empty')}
              </p>
            ) : (
              <ul className="divide-y">
                {snapshot.verificationOrders.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={verificationHref}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50"
                    >
                      <span className="flex items-center gap-2">
                        <Wallet className="size-4 shrink-0 text-amber-600" />
                        <span>
                          <span className="font-medium">
                            {t('home.actionList.verifyPayment')}
                          </span>
                          {' · '}
                          {order.customerName ?? t('inbox.unnamedCustomer')} ·{' '}
                          {formatMoney(order.total, currency)}
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
                {snapshot.attentionConversations.map((convo) => (
                  <li key={convo.id}>
                    <Link
                      href={`/inbox?conversation=${convo.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50"
                    >
                      <span className="flex items-center gap-2">
                        <AlertCircle className="size-4 shrink-0 text-amber-600" />
                        <span>
                          <span className="font-medium">{t('home.actionList.attention')}</span>
                          {' · '}
                          {convo.customerName ?? t('inbox.unnamedCustomer')}
                          {convo.lastMessageAt ? ` · ${formatRelative(convo.lastMessageAt)}` : ''}
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

type Accent = 'emerald' | 'blue' | 'amber' | 'muted';

const ACCENT_CLASSES: Record<Accent, string> = {
  emerald: 'text-emerald-600',
  blue: 'text-blue-600',
  amber: 'text-amber-600',
  muted: 'text-muted-foreground',
};

function KpiCard({
  icon,
  label,
  value,
  href,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
  accent: Accent;
}) {
  const body = (
    <div className="flex flex-col gap-2 rounded-lg border p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={ACCENT_CLASSES[accent]}>{icon}</span>
      </div>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  );
  if (!href) return body;
  return (
    <Link href={href} className="block">
      {body}
    </Link>
  );
}
