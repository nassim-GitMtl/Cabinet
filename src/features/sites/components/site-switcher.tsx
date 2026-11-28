"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MapPinIcon } from "lucide-react";
import { chooseSiteAction } from "../actions";

/** Which site the person works at now (agenda, reception, cash drawer). Shown only when there are several. */
export function SiteSwitcher({ sites, siteId, compact = false }: { sites: Array<{ id: string; name: string }>; siteId: string | null; compact?: boolean }) {
  const t = useTranslations("sites");
  const router = useRouter();
  const [pending, start] = useTransition();
  if (sites.length < 2) return null;
  return (
    <label className={compact ? "flex items-center gap-1 text-[11px] text-muted-foreground" : "mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"}>
      <MapPinIcon className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">{t("current")}</span>
      <select
        value={siteId ?? sites[0]!.id}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          start(async () => {
            const r = await chooseSiteAction(next);
            if (r.ok) router.refresh();
          });
        }}
        className="min-w-0 max-w-full truncate rounded-md border-0 bg-transparent py-0 pe-1 font-medium text-primary focus-visible:outline-2"
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </label>
  );
}
