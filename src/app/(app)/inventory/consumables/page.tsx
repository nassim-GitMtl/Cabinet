import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/button-link";
import { ForbiddenState, PageHeader } from "@/components/app/page-header";
import { getServicePickerData } from "@/features/catalog/server";
import { getReorderSuggestions, listPendingConsumptions, listRecipes } from "@/features/inventory/consumables";
import { ModeForm, PendingConsumptionActions, RecipeForm, RemoveRecipeButton } from "@/features/inventory/components/consumables";
import { getInventory } from "@/features/inventory/server";
import { formatDateOnly, todayInZone } from "@/lib/dates";
import { can, requireClinicContext } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("inventory.consumables"))("title") };
}

type Localized = { fr: string; en?: string; ar?: string };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function ConsumablesPage() {
  const ctx = await requireClinicContext();
  const t = await getTranslations("inventory");
  const manage = can(ctx, "inventory.manage");
  if (!manage && !can(ctx, "clinical.write")) return <ForbiddenState message={(await getTranslations("errors"))("forbiddenPage")} />;
  const today = todayInZone(ctx.organization.timezone);
  const [pending, recipes, reorder, inventory, picker, raw] = await Promise.all([
    listPendingConsumptions(ctx),
    manage ? listRecipes(ctx) : null,
    manage ? getReorderSuggestions(ctx, today) : null,
    manage ? getInventory(ctx, today) : null,
    manage && can(ctx, "catalog.read") ? getServicePickerData(ctx) : null,
    getLocale(),
  ]);
  const locale = raw as keyof Localized;
  const name = (n: Localized | null | undefined) => (n ? n[locale] || n.fr : "—");
  const unit = (u: string, n: number) => `${n} ${t(`units.${u}` as never)}`;
  const mode = ctx.organization.settings.consumablesMode ?? "suggest";
  const serviceOptions = (picker?.categories ?? []).flatMap((c) => c.services.map((s) => ({ value: s.id, label: `${s.code} · ${name(s.name as Localized)}` })));
  const itemOptions = (inventory?.items ?? []).map((i) => ({ value: i.id, label: `${i.sku} · ${i.name}` }));

  return (
    <>
      <PageHeader
        title={t("consumables.title")}
        description={t("consumables.subtitle")}
        back={manage ? <ButtonLink href="/inventory" variant="ghost">{t("consumables.backToInventory")}</ButtonLink> : undefined}
      />

      <Section title={t("consumables.pendingTitle", { count: pending.length })} hint={t("consumables.pendingHint")}>
        {pending.length ? (
          <ul className="divide-y rounded-xl border">
            {pending.map((c) => (
              <li key={c.id} className="grid gap-3 p-3 md:grid-cols-[1fr_auto] md:items-start">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    <bdi>{c.itemName}</bdi> · <span className="tabular-nums">{unit(c.unit, c.quantity)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    <span className="tabular-nums">{formatDateOnly(c.serviceDate)}</span> ·{" "}
                    <Link href={`/patients/${c.patientId}`} className="text-primary underline-offset-4 hover:underline"><bdi>{c.patientName}</bdi></Link> ·{" "}
                    <bdi>{name(c.serviceName as unknown as Localized)}</bdi>
                  </p>
                  {c.note === "insufficientStock" ? <p className="mt-1 text-xs font-medium text-destructive">{t("errors.insufficientStock")}</p> : null}
                </div>
                <PendingConsumptionActions id={c.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("consumables.pendingEmpty")}</p>
        )}
      </Section>

      {manage && reorder ? (
        <Section
          title={t("consumables.reorderTitle")}
          hint={t("consumables.reorderHint", { upcoming: reorder.upcomingAppointments, average: reorder.averagePer14.toFixed(1), factor: reorder.agendaFactor.toFixed(2) })}
        >
          {reorder.suggestions.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{t("item")}</th>
                    <th className="px-3 py-2 text-end">{t("consumables.usage90")}</th>
                    <th className="px-3 py-2 text-end">{t("consumables.projected30")}</th>
                    <th className="px-3 py-2 text-end">{t("minimumStock")}</th>
                    <th className="px-3 py-2 text-end">{t("consumables.onHand")}</th>
                    <th className="px-3 py-2 text-end">{t("consumables.onOrder")}</th>
                    <th className="px-3 py-2 text-end">{t("consumables.suggested")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reorder.suggestions.map((s) => (
                    <tr key={s.itemId}>
                      <td className="px-3 py-2"><bdi>{s.name}</bdi> <span className="text-xs text-muted-foreground"><bdi>{s.sku}</bdi></span></td>
                      <td className="px-3 py-2 text-end tabular-nums">{s.usage90}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{s.projected30}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{s.minimumStock}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{s.onHand}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{s.onOrder}</td>
                      <td className="px-3 py-2 text-end font-semibold tabular-nums">{unit(s.unit, s.suggested)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("consumables.reorderEmpty")}</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{t("consumables.reorderFormula")}</p>
        </Section>
      ) : null}

      {manage && recipes ? (
        <Section title={t("consumables.recipesTitle")} hint={t("consumables.recipesHint")}>
          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <div className="grid gap-4">
              <RecipeForm services={serviceOptions} items={itemOptions} />
              {recipes.length ? (
                <ul className="divide-y rounded-xl border text-sm">
                  {recipes.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 p-3">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium"><bdi>{r.serviceCode}</bdi> · <bdi>{name(r.serviceName as Localized)}</bdi></span>
                        <span className="block text-muted-foreground"><bdi>{r.itemName}</bdi> · <span className="tabular-nums">{unit(r.unit, r.quantity)}</span> {t("consumables.perProcedure")}</span>
                      </span>
                      <RemoveRecipeButton id={r.id} label={`${r.serviceCode} · ${r.itemName}`} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("consumables.recipesEmpty")}</p>
              )}
            </div>
            <ModeForm mode={mode} canManage={can(ctx, "org.settings.manage")} />
          </div>
        </Section>
      ) : null}
    </>
  );
}
