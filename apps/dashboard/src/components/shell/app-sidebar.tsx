'use client';

/**
 * Sidebar nav (WS-D1 §1). Live routes: Bandeja, Clientes, Pedidos, Productos.
 * The rest link to "Próximamente" placeholder pages so the information
 * architecture is fixed from day one and later sessions only fill in content.
 * Paths are English permanently (D1 §10.4); labels come from `es.json`.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bot,
  Home,
  LogOut,
  Megaphone,
  MessageSquare,
  Package,
  Settings,
  Shirt,
  Users,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { t, type TranslationKey } from '@/i18n/index';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  href: string;
  labelKey: TranslationKey;
  icon: typeof Home;
  live: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/inicio', labelKey: 'nav.home', icon: Home, live: false },
  { href: '/inbox', labelKey: 'nav.inbox', icon: MessageSquare, live: true },
  { href: '/customers', labelKey: 'nav.customers', icon: Users, live: true },
  { href: '/orders', labelKey: 'nav.orders', icon: Package, live: true },
  { href: '/products', labelKey: 'nav.products', icon: Shirt, live: true },
  { href: '/campaigns', labelKey: 'nav.campaigns', icon: Megaphone, live: false },
  { href: '/agent', labelKey: 'nav.agent', icon: Bot, live: false },
  { href: '/settings', labelKey: 'nav.settings', icon: Settings, live: false },
];

export function AppSidebar({
  tenantName,
  userEmail,
}: {
  tenantName: string;
  userEmail: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function onSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="border-b px-4 py-4">
        <div className="text-sm font-semibold">{t('common.appName')}</div>
        <div className="truncate text-xs text-muted-foreground">{tenantName}</div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 truncate">{t(item.labelKey)}</span>
              {!item.live && (
                <Badge variant="outline" className="px-1 text-[10px] font-normal">
                  {t('nav.comingSoonBadge')}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-start truncate text-xs font-normal">
              {userEmail}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel className="truncate text-xs">{userEmail}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void onSignOut()}>
              <LogOut className="size-4" />
              {t('common.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
