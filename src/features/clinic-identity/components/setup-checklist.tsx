import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2Icon, CircleIcon, RocketIcon } from "lucide-react";
import type { SetupItem } from "../server";

/** "Mise en route" card: real setup status, shown to administrators until everything is done. */
export async function SetupChecklist({ items }: { items: SetupItem[] }) {
  const t = await getTranslations("clinicIdentity.setup");
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  return (
    <section className="mb-6 rounded-2xl border bg-card p-4 shadow-sm sm:p-5" aria-labelledby="setup-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="setup-heading" className="flex items-center gap-2 font-heading text-lg font-semibold">
          <RocketIcon className="size-5 text-primary" aria-hidden />{t("title")}
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">{t("progress", { done, total: items.length })}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-primary" style={{ width: `${(done / items.length) * 100}%` }} /></div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link href={item.href} className="flex items-start gap-2 rounded-xl border p-3 text-sm hover:bg-muted/50">
              {item.done ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <span className={item.done ? "text-muted-foreground line-through" : ""}>
                <span className="block font-medium">{t(`items.${item.key}`)}</span>
                {!item.done ? <span className="block text-xs text-muted-foreground">{t(`hints.${item.key}`)}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
