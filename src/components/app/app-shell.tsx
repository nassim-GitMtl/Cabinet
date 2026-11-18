"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  ArrowLeftRightIcon,
  BarChart3Icon,
  BookOpenIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  MenuIcon,
  PackageSearchIcon,
  ReceiptIcon,
  WalletIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SettingsIcon,
  UserPlusIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { logoutAction } from "@/features/auth/actions";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./language-switcher";
import { ToothIcon, ToothNumberGuide } from "./tooth-number-guide";

export type NavKey = "dashboard" | "agenda" | "reception" | "patients" | "invoices" | "reports" | "cash" | "expenses" | "inventory" | "catalog" | "settings";

/** Shown in the phone bottom bar; everything else goes in the "More" sheet. */
const MOBILE_PRIMARY: NavKey[] = ["dashboard", "agenda", "patients", "invoices"];

const NAV: Record<NavKey, { href: string; icon: LucideIcon; label: string; short?: string }> = {
  dashboard: { href: "/dashboard", icon: LayoutDashboardIcon, label: "dashboard", short: "dashboardShort" },
  agenda: { href: "/agenda", icon: CalendarDaysIcon, label: "agenda" },
  reception: { href: "/reception", icon: ClipboardCheckIcon, label: "reception" },
  patients: { href: "/patients", icon: UsersIcon, label: "patients" },
  invoices: { href: "/invoices", icon: FileTextIcon, label: "invoices" },
  reports: { href: "/reports", icon: BarChart3Icon, label: "reports" },
  cash: { href: "/cash", icon: WalletIcon, label: "cash" },
  expenses: { href: "/expenses", icon: ReceiptIcon, label: "expenses" },
  inventory: { href: "/inventory", icon: PackageSearchIcon, label: "inventory" },
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
    <span className="flex items-center gap-3 font-semibold tracking-tight">
      <span aria-hidden className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-primary to-teal-700 text-primary-foreground shadow-lg shadow-primary/20">
        <ToothIcon className="size-6" />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px]">Cabinet Dentaire</span>
        <span className="block text-xs font-medium uppercase tracking-[0.22em] text-primary">Pro</span>
      </span>
    </span>
  );
}

export function AppShell({ clinicName, userName, roleName, nav, canCreatePatient, hasMultipleClinics, children }: Props) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        {t("skipToContent")}
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-e border-sidebar-border/70 bg-sidebar/95 shadow-[8px_0_30px_-24px_rgba(15,23,42,.32)] backdrop-blur-xl lg:flex no-print">
        <div className="px-5 pt-5 pb-4">
          <Brand />
        </div>
        <div className="mx-4 mb-5 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/10 via-background to-background p-3.5 shadow-sm">
          <p className="truncate text-sm font-semibold" title={clinicName} dir="auto">
            {clinicName}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{roleName}</p>
          {hasMultipleClinics ? (
            <Link href="/select-clinic" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <ArrowLeftRightIcon className="size-3" aria-hidden />
              {t("switchClinic")}
            </Link>
          ) : null}
        </div>
        <p className="px-6 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("workspace")}</p>
        <nav aria-label={t("mainNavigation")} className="flex-1 space-y-1 overflow-y-auto px-3">
          {nav.map((key) => {
            const item = NAV[key];
            const active = isActive(item.href);
            return (
              <Link
                key={key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/15"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className={cn("size-4.5 transition-transform group-hover:scale-105", active && "text-primary-foreground")} aria-hidden />
                {t(item.label as never)}
              </Link>
            );
          })}
        </nav>
        <div className="mx-3 mb-2"><ToothNumberGuide /></div>
        <div className="space-y-3 border-t border-sidebar-border/70 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-muted/55 p-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary" aria-hidden>
              {userName.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" dir="auto">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">{roleName}</p>
            </div>
          </div>
          <LanguageSwitcher className="block" />
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" className="w-full justify-start gap-2">
              <LogOutIcon aria-hidden />
              {t("logout")}
            </Button>
          </form>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_right,color-mix(in_oklch,var(--primary)_8%,transparent),transparent_34rem)]">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/60 bg-background/85 px-4 py-2.5 shadow-sm backdrop-blur-xl lg:hidden no-print">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-teal-700 text-primary-foreground shadow-md shadow-primary/20">
              <ToothIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold" dir="auto">{clinicName}</p>
              <p className="truncate text-[11px] text-muted-foreground">{userName}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ToothNumberGuide compact />
            <LanguageSwitcher compact />
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="icon" aria-label={t("logout")}>
                <LogOutIcon aria-hidden />
              </Button>
            </form>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-5 pb-32 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12 xl:px-10">
          {children}
        </main>

        {/* Mobile bottom navigation */}
        <nav
          aria-label={t("mainNavigation")}
          className="fixed inset-x-3 bottom-3 z-30 overflow-hidden rounded-2xl border border-border/70 bg-background/90 pb-[env(safe-area-inset-bottom)] shadow-[0_12px_40px_-12px_rgba(15,23,42,.35)] backdrop-blur-xl lg:hidden no-print"
        >
          <ul className="mx-auto flex max-w-lg items-stretch justify-around">
            {nav.filter((key) => MOBILE_PRIMARY.includes(key)).map((key) => {
              const item = NAV[key];
              const active = isActive(item.href);
              return (
                <li key={key} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <item.icon className={cn("size-5", active && "drop-shadow-sm")} aria-hidden />
                    {t((item.short ?? item.label) as never)}
                  </Link>
                </li>
              );
            })}
            {nav.some((key) => !MOBILE_PRIMARY.includes(key)) ? (
              <li className="flex-1">
                <Sheet>
                  <SheetTrigger
                    className={cn(
                      "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                      nav.some((key) => !MOBILE_PRIMARY.includes(key) && isActive(NAV[key].href)) ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <MenuIcon className="size-5" aria-hidden />
                    {t("more")}
                  </SheetTrigger>
                  <SheetContent side="bottom" className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
                    <SheetHeader>
                      <SheetTitle>{t("menu")}</SheetTitle>
                    </SheetHeader>
                    <ul className="grid gap-1 px-4">
                      {nav.filter((key) => !MOBILE_PRIMARY.includes(key)).map((key) => {
                        const item = NAV[key];
                        return (
                          <li key={key}>
                            <Link href={item.href} className="flex min-h-12 items-center gap-3 rounded-lg px-3 font-medium hover:bg-accent">
                              <item.icon className="size-5 text-primary" aria-hidden />
                              {t(item.label as never)}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </SheetContent>
                </Sheet>
              </li>
            ) : null}
          </ul>
        </nav>
        {canCreatePatient && !pathname.startsWith("/patients/new") && !pathname.endsWith("/procedures/new") && !pathname.includes("/billing/") ? (
          <Link
            href="/patients/new"
            aria-label={t("quickActions")}
            className="fixed end-5 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-xl shadow-primary/25 transition-transform active:scale-95 lg:hidden no-print"
          >
            <UserPlusIcon className="size-6" aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
