import { t, type TranslationKey } from '@/i18n/index';

/** Placeholder body for routes whose screens arrive in later workstreams. */
export function ComingSoon({ titleKey }: { titleKey: TranslationKey }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-lg font-semibold">{t(titleKey)}</h1>
      <p className="text-sm text-muted-foreground">{t('nav.comingSoonBody')}</p>
    </div>
  );
}
