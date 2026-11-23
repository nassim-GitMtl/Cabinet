"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  BellIcon,
  BellRingIcon,
  CalendarClockIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  HandCoinsIcon,
  InboxIcon,
  PackageSearchIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { OperationalNotification, OperationalNotificationKind } from "@/features/notifications/types";
import { cn } from "@/lib/utils";

const icons: Record<OperationalNotificationKind, LucideIcon> = {
  bookingRequests: InboxIcon,
  receptionWaiting: ClipboardCheckIcon,
  followUpsDue: BellRingIcon,
  billingReady: FileTextIcon,
  invoicePaymentsDue: ReceiptIcon,
  honorariaPayable: HandCoinsIcon,
  inventoryLow: PackageSearchIcon,
  inventoryExpiring: CalendarClockIcon,
  inventoryExpired: AlertTriangleIcon,
  sterilizationPending: ShieldCheckIcon,
};

export function NotificationCenter({ notifications, className }: { notifications: OperationalNotification[]; className?: string }) {
  const t = useTranslations("notifications");
  const total = notifications.reduce((sum, item) => sum + item.count, 0);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("relative shrink-0", className)}
            aria-label={total ? t("buttonWithCount", { count: total }) : t("button")}
          />
        }
      >
        <BellIcon aria-hidden />
        {total ? (
          <span className="absolute -end-1 -top-1 min-w-4.5 rounded-full bg-destructive px-1 text-center text-[10px] font-bold leading-[18px] text-white tabular-nums ring-2 ring-background">
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(23rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0">
        <PopoverHeader className="border-b px-4 py-3">
          <PopoverTitle className="font-heading text-base">{t("title")}</PopoverTitle>
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
        </PopoverHeader>
        {notifications.length ? (
          <ul className="max-h-[min(26rem,60vh)] divide-y overflow-y-auto">
            {notifications.map((item) => {
              const Icon = icons[item.kind];
              return (
                <li key={item.kind}>
                  <Link href={item.href} className="group flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", item.priority === "urgent" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
                      <Icon className="size-4.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium">{t(item.kind, { count: item.count })}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", item.priority === "urgent" ? "bg-destructive text-white" : "bg-primary/10 text-primary")}>{item.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center">
            <span className="mx-auto mb-2 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"><BellIcon className="size-5" aria-hidden /></span>
            <p className="text-sm font-medium">{t("empty")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("emptyHint")}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
