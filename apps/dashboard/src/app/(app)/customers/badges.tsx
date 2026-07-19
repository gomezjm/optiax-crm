'use client';

/** Tag + consent badges shared by the table and the drawer. */
import { t } from '@/i18n/index';
import type { ConsentStatus, TagRow } from '@/lib/customers/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function TagBadge({ tag, onRemove }: { tag: TagRow; onRemove?: () => void }) {
  return (
    <Badge
      variant="outline"
      className="gap-1"
      style={{ borderColor: tag.color, color: tag.color }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
      {tag.name}
      {onRemove && (
        <button
          type="button"
          aria-label={`${t('common.clear')} ${tag.name}`}
          className="ml-0.5 opacity-60 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </Badge>
  );
}

const CONSENT_STYLES: Record<ConsentStatus, string> = {
  opted_in: 'border-green-600/40 bg-green-50 text-green-700',
  opted_out: 'border-red-600/40 bg-red-50 text-red-700',
  unknown: 'border-gray-400/40 bg-gray-50 text-gray-600',
};

export function ConsentBadge({ status }: { status: ConsentStatus }) {
  return (
    <Badge variant="outline" className={cn('font-normal', CONSENT_STYLES[status])}>
      {t(`customers.consent.${status}`)}
    </Badge>
  );
}
