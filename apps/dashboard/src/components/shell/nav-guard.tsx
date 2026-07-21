'use client';

/**
 * In-app navigation guard (WS-D4 §0.2, carry-in from D3-D).
 *
 * `beforeunload` only fires for browser-level navigation (refresh, close, hard
 * link-out); it never sees Next's client-side route changes, so a sidebar click
 * would silently discard a half-finished form. This provider closes that gap: a
 * big-form screen registers a "dirty" predicate with `useUnsavedGuard(dirty)`,
 * and any in-app navigator routes through `guardedPush`, which pops a confirm
 * dialog when a registered guard is dirty.
 *
 * It is deliberately screen-agnostic — the configurator adopts it now, and any
 * later screen with an unsaved-changes problem registers the same way.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/i18n/index';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface NavGuardContext {
  /** Register a predicate that reports whether the screen has unsaved edits. */
  registerGuard: (isDirty: () => boolean) => () => void;
  /** Navigate to `href`, confirming first if any registered guard is dirty. */
  guardedPush: (href: string) => void;
}

const Context = createContext<NavGuardContext | null>(null);

export function NavGuardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // A set of dirty-predicates: more than one big-form screen could be mounted
  // (e.g. a drawer over a page), so any dirty guard blocks navigation.
  const guards = useRef(new Set<() => boolean>());
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const registerGuard = useCallback((isDirty: () => boolean) => {
    guards.current.add(isDirty);
    return () => {
      guards.current.delete(isDirty);
    };
  }, []);

  const guardedPush = useCallback(
    (href: string) => {
      const dirty = [...guards.current].some((isDirty) => isDirty());
      if (dirty) {
        setPendingHref(href);
        return;
      }
      router.push(href);
    },
    [router],
  );

  const confirm = useCallback(() => {
    const href = pendingHref;
    setPendingHref(null);
    if (href) router.push(href);
  }, [pendingHref, router]);

  return (
    <Context.Provider value={{ registerGuard, guardedPush }}>
      {children}
      <Dialog open={pendingHref !== null} onOpenChange={(open) => (!open ? setPendingHref(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('navGuard.title')}</DialogTitle>
            <DialogDescription>{t('navGuard.body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingHref(null)}>
              {t('navGuard.stay')}
            </Button>
            <Button variant="destructive" onClick={confirm}>
              {t('navGuard.leave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}

/** Access the guard from a navigator (the sidebar). Safe outside a provider. */
export function useNavGuard(): NavGuardContext {
  const ctx = useContext(Context);
  // A no-op fallback keeps the sidebar usable in isolation (e.g. component
  // tests) without forcing every consumer to mount the provider.
  const router = useRouter();
  if (ctx) return ctx;
  return {
    registerGuard: () => () => undefined,
    guardedPush: (href: string) => router.push(href),
  };
}

/**
 * Register `dirty` as an unsaved-changes guard for as long as the screen is
 * mounted. The predicate is read at navigation time, so passing the live
 * boolean each render keeps it current without re-registering.
 */
export function useUnsavedGuard(dirty: boolean): void {
  const ctx = useContext(Context);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!ctx) return;
    return ctx.registerGuard(() => dirtyRef.current);
  }, [ctx]);
}
