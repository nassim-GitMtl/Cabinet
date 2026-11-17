"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  ArrowLeftRightIcon,
  BookOpenIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SettingsIcon,
  UserPlusIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/features/auth/actions";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./language-switcher";

export type NavKey = "dashboard" | "patients" | "catalog" | "settings";

const NAV: Record<NavKey, { href: string; icon: LucideIcon; label: string; short?: string }> = {
  dashboard: { href: "/dashboard", icon: LayoutDashboardIcon, label: "dashboard" },
  patients: { href: "/patients", icon: UsersIcon, label: "patients" },
  catalog: { href: "/catalog", icon: BookOpenIcon, label: "catalog", short: "catalogShort" },
  settings: { href: "/settings", icon: SettingsIcon, label: "settings" },
};

type Props = {
  clinicName: string;
  userName: string;
  roleName: string;
  nav: NavKey[];
  canCreatePatient: boolean;
  hasMultipleClinics: boolean;
  children: ReactNode;
};

function Brand() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <svg viewBox="0 0 64 64" className="size-5" fill="currentColor">
          <path d="M22 14c-6 0-10 5-10 11 0 5 2 9 4 13 2 5 2 12 6 12 3 0 3-6 5-10 1-2 2-3 5-3s4 1 5 3c2 4 2 10 5 10 4 0 4-7 6-12 2-4 4-8 4-13 0-6-4-11-10-11-4 0-6 2-10 2s-6-2-10-2z" />
        </svg>
      </span>
      <span>Cabinet Dentaire Pro</span>
    </span>
  );
}

export function AppShell({ clinicName, userName, roleName, nav, canCreatePatient, hasMultipleClinics, children }: Props) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        {t("skipToContent")}
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e bg-sidebar lg:flex no-print">
        <div className="px-4 pt-5 pb-4">
          <Brand />
        </div>
        <div className="mx-3 mb-3 rounded-lg border bg-background px-3 py-2.5">
          <p className="truncate text-sm font-medium" title={clinicName} dir="auto">
            {clinicName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{roleName}</p>
          {hasMultipleClinics ? (
            <Link href="/select-clinic" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <ArrowLeftRightIcon className="size-3" aria-hidden />
              {t("switchClinic")}
            </Link>
          ) : null}
        </div>
        <nav aria-label={t("mainNavigation")} className="flex-1 space-y-0.5 px-3">
          {nav.map((key) => {
            const item = NAV[key];
            const active = isActive(item.href);
            return (
              <Link
                key={key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-muted",
                )}
              >
                <item.icon className="size-4.5" aria-hidden />
                {t(item.label as never)}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-3 border-t p-3">
          <p className="truncate px-1 text-sm">{userName}</p>
          <LanguageSwitcher className="block" />
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" className="w-full justify-start gap-2">
              <LogOutIcon aria-hidden />
              {t("logout")}
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-background/95 px-4 py-2.5 backdrop-blur lg:hidden no-print">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" dir="auto">{clinicName}</p>
            <p className="truncate text-xs text-muted-foreground">{userName}</p>
          </div>
          <div className="flex items-center gap-1">
            <LanguageSwitcher compact />
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="icon" aria-label={t("logout")}>
                <LogOutIcon aria-hidden />
              </Button>
            </form>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-10">
          {children}
        </main>

        {/* Mobile bottom navigation */}
        <nav
          aria-label={t("mainNavigation")}
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden no-print"
        >
          <ul className="mx-auto flex max-w-lg items-stretch justify-around">
            {nav.map((key) => {
              const item = NAV[key];
              const active = isActive(item.href);
              return (
                <li key={key} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <item.icon className="size-5" aria-hidden />
                    {t((item.short ?? item.label) as never)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {canCreatePatient && !pathname.startsWith("/patients/new") && !pathname.endsWith("/procedures/new") ? (
          <Link
            href="/patients/new"
            aria-label={t("quickActions")}
            className="fixed end-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg lg:hidden no-print"
          >
            <UserPlusIcon className="size-6" aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
