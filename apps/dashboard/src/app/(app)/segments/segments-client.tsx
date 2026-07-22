'use client';

/**
 * Segments screen (ws-c1 §2). Lists the tenant's segments with a live member
 * count each, and orchestrates the editor, the clone/delete actions and the
 * member sheet. Counts arrive evaluated from the server component and refresh
 * via `router.refresh()` after any write.
 *
 * Roles: segments are rep-writable, but template rows (`is_template`) are
 * shared defaults edited by admins only. RLS does not distinguish template rows
 * (they're `operational`), so that restriction is enforced here in the app
 * layer — reps can still clone a template into their own editable segment.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { SegmentRules } from '@optiax/shared';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { t } from '@/i18n/index';
import { formatRelative } from '@/lib/format';
import type { AttributeDefRow, CustomerListItem, TagRow } from '@/lib/customers/types';
import { attributeTypeMap, parseRules } from '@/lib/segments/queries';
import { evalSegmentMembers, SEGMENT_PREVIEW_LIMIT } from '@/lib/segments/executor';
import { deleteSegment } from '@/lib/segments/mutations';
import type { SegmentListItem, SegmentRow } from '@/lib/segments/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { SegmentEditor } from './segment-editor';
import { MemberTable } from './member-table';

interface EditorState {
  mode: 'create' | 'edit';
  segmentId: string | null;
  name: string;
  rules: SegmentRules | null;
}

export function SegmentsClient({
  tenantId,
  isAdmin,
  timeZone,
  currency,
  defs,
  tags,
  items,
}: {
  tenantId: string;
  isAdmin: boolean;
  timeZone: string;
  currency: string;
  defs: AttributeDefRow[];
  tags: TagRow[];
  items: SegmentListItem[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const ctx = useMemo(() => ({ timeZone, attributeTypes: attributeTypeMap(defs) }), [timeZone, defs]);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [viewing, setViewing] = useState<SegmentRow | null>(null);
  const [members, setMembers] = useState<{ items: CustomerListItem[]; total: number } | null>(null);
  const [deleting, setDeleting] = useState<SegmentRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  /** Whether the current user may edit/delete a given segment. */
  function canModify(segment: SegmentRow): boolean {
    return isAdmin || !segment.is_template;
  }

  function openView(segment: SegmentRow) {
    const rules = parseRules(segment.rules);
    setViewing(segment);
    setMembers(null);
    if (!rules) return;
    void evalSegmentMembers(supabase, rules, ctx, SEGMENT_PREVIEW_LIMIT)
      .then(setMembers)
      .catch(() => setMembers({ items: [], total: 0 }));
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteSegment(supabase, deleting.id);
      toast.success(t('segments.toast.deleted'));
      setDeleting(null);
      router.refresh();
    } catch {
      toast.error(t('segments.toast.error'));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-background px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">{t('segments.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('segments.subtitle')}</p>
        </div>
        <Button
          size="sm"
          onClick={() => setEditor({ mode: 'create', segmentId: null, name: '', rules: null })}
        >
          <Plus className="size-4" />
          {t('segments.new')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <h2 className="text-base font-medium">{t('segments.empty.title')}</h2>
            <p className="max-w-md text-sm text-muted-foreground">{t('segments.empty.body')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map(({ segment, count }) => {
              const modifiable = canModify(segment);
              return (
                <li
                  key={segment.id}
                  className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{segment.name}</span>
                      {segment.is_template && (
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {t('segments.templateBadge')}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('segments.updatedPrefix')} {formatRelative(segment.updated_at)}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm tabular-nums hover:bg-muted"
                    onClick={() => openView(segment)}
                  >
                    <Users className="size-4 text-muted-foreground" />
                    {count === null ? (
                      <span className="text-destructive">{t('segments.invalidRules')}</span>
                    ) : (
                      <>
                        <span className="font-medium">{count}</span>
                        <span className="text-muted-foreground">{t('segments.membersLabel')}</span>
                      </>
                    )}
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => openView(segment)}>
                        {t('segments.actions.view')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          setEditor({
                            mode: 'create',
                            segmentId: null,
                            name: `${segment.name} ${t('segments.clone.suffix')}`,
                            rules: parseRules(segment.rules),
                          })
                        }
                      >
                        {t('segments.actions.clone')}
                      </DropdownMenuItem>
                      {modifiable && (
                        <DropdownMenuItem
                          onSelect={() =>
                            setEditor({
                              mode: 'edit',
                              segmentId: segment.id,
                              name: segment.name,
                              rules: parseRules(segment.rules),
                            })
                          }
                        >
                          {t('segments.actions.edit')}
                        </DropdownMenuItem>
                      )}
                      {modifiable && (
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => setDeleting(segment)}
                        >
                          {t('segments.actions.delete')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
        {items.some((i) => i.segment.is_template) && !isAdmin && (
          <p className="mt-4 text-xs text-muted-foreground">{t('segments.templateAdminOnly')}</p>
        )}
      </div>

      {editor && (
        <SegmentEditor
          open
          mode={editor.mode}
          segmentId={editor.segmentId}
          initialName={editor.name}
          initialRules={editor.rules}
          tenantId={tenantId}
          timeZone={timeZone}
          currency={currency}
          defs={defs}
          tags={tags}
          supabase={supabase}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            router.refresh();
          }}
        />
      )}

      <Sheet open={viewing !== null} onOpenChange={(o) => (!o ? setViewing(null) : undefined)}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{viewing?.name ?? t('segments.members.title')}</SheetTitle>
            <SheetDescription>{t('segments.members.liveNote')}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
            {members === null ? (
              <p className="p-4 text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : members.items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t('segments.members.empty')}</p>
            ) : (
              <>
                <p className="px-1 py-2 text-sm text-muted-foreground tabular-nums">
                  {members.total} {t('segments.membersLabel')}
                </p>
                <MemberTable items={members.items} currency={currency} />
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={deleting !== null} onOpenChange={(o) => (!o ? setDeleting(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('segments.deleteConfirm.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('segments.deleteConfirm.body')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
            >
              {deleteBusy ? t('common.deleting') : t('segments.deleteConfirm.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
