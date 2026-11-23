"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { HeartPulseIcon, ClipboardListIcon, ImagesIcon, LayoutDashboardIcon, RouteIcon, StethoscopeIcon, UserRoundIcon, WalletIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = ["overview", "details", "health", "clinical", "documents", "treatments", "journey", "finance"] as const;
export type PatientTab = (typeof TABS)[number];

const ICONS = {
  overview: LayoutDashboardIcon,
  details: UserRoundIcon,
  health: HeartPulseIcon,
  clinical: StethoscopeIcon,
  documents: ImagesIcon,
  treatments: ClipboardListIcon,
  journey: RouteIcon,
  finance: WalletIcon,
} as const;

export function PatientTabs({ patientId, active, allowed }: { patientId: string; active: PatientTab; allowed: PatientTab[] }) {
  const t = useTranslations();
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
  }, [active]);

  return (
    <nav aria-label={t("patients.title")} className="sticky top-2 z-20 mb-6 flex gap-1 overflow-x-auto rounded-xl border border-border/80 bg-card/95 p-1.5 text-sm shadow-[0_10px_25px_-22px_rgba(48,39,25,.45)] backdrop-blur supports-[backdrop-filter]:bg-card/88 lg:flex-wrap lg:overflow-visible">
      {TABS.map((tab) => {
        const Icon = ICONS[tab];
        const enabled = allowed.includes(tab);
        return enabled ? (
          <Link
            key={tab}
            ref={tab === active ? activeRef : undefined}
            href={tab === "overview" ? `/patients/${patientId}` : `/patients/${patientId}?tab=${tab}`}
            aria-current={active === tab ? "page" : undefined}
            className={cn(
              "group relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 font-semibold transition-colors",
              active === tab ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t(`patients.tabs.${tab}`)}
          </Link>
        ) : (
          <span key={tab} aria-disabled className="flex shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg px-3 py-2 text-muted-foreground/60">
            <Icon className="size-4" aria-hidden />
            {t(`patients.tabs.${tab}`)}
          </span>
        );
      })}
    </nav>
  );
}
