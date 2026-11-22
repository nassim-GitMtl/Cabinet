import { getTranslations } from "next-intl/server";
import { Loader2Icon } from "lucide-react";

/** Shown at once while a page loads (slow connections): the menu stays, the content area shows progress. */
export default async function Loading() {
  const t = await getTranslations("common");
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" aria-hidden />{t("loading")}
      </p>
      <div className="h-28 animate-pulse rounded-2xl bg-muted/60" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="h-24 animate-pulse rounded-2xl bg-muted/50" />
        <div className="h-24 animate-pulse rounded-2xl bg-muted/50" />
        <div className="h-24 animate-pulse rounded-2xl bg-muted/50" />
      </div>
    </div>
  );
}
