"use client";

import { useActionState, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { EyeOffIcon, HistoryIcon, PencilIcon, PlusIcon, PowerIcon, SearchIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextField } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, minorToInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import type { CatalogCategory, CatalogService } from "../server";
import { priceHistoryAction, saveServiceAction, setServiceActiveAction } from "../actions";

type Props = {
  categories: CatalogCategory[];
  canManage: boolean;
  currency: string;
  currencySymbol: string;
  timeZone: string;
};

const UNITS = ["procedure", "tooth", "surface", "arch", "quadrant", "session", "item"] as const;
const ANATOMY = ["none", "tooth", "surface", "arch", "quadrant"] as const;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function CatalogBrowser({ categories, canManage, currency, currencySymbol, timeZone }: Props) {
  const t = useTranslations("catalog");
  const locale = useLocale();
  const intl = INTL_LOCALE[isLocale(locale) ? locale : "fr"];
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [editing, setEditing] = useState<CatalogService | "new" | null>(null);
  const [historyFor, setHistoryFor] = useState<CatalogService | null>(null);

  const nameOf = (s: { name: CatalogService["name"] }) =>
    (s.name as Record<string, string | undefined>)[locale] || s.name.fr;

  const filtered = useMemo(() => {
    const q = fold(deferred.trim());
    if (!q) return categories;
    return categories
      .map((c) => ({
        ...c,
        services: c.services.filter((s) =>
          fold(`${s.code} ${s.name.fr} ${s.name.en ?? ""} ${s.name.ar ?? ""}`).includes(q),
        ),
      }))
      .filter((c) => c.services.length > 0);
  }, [categories, deferred]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label={t("search")}
            placeholder={t("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
          />
        </div>
        {canManage ? (
          <Button onClick={() => setEditing("new")}>
            <PlusIcon aria-hidden />
            {t("newService")}
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : null}

      {filtered.map((cat) => (
        <section key={cat.id} aria-labelledby={`cat-${cat.id}`} className="overflow-hidden rounded-xl border bg-card">
          <h2 id={`cat-${cat.id}`} className="border-b bg-muted/50 px-4 py-2.5 text-sm font-semibold">
            {nameOf(cat)}
          </h2>
          <ul className="divide-y">
            {cat.services.map((s) => (
              <li key={s.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3", !s.isActive && "opacity-60")}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-medium">
                    {nameOf(s)}
                    {!s.isActive ? (
                      <Badge variant="secondary" className="ms-2">
                        <EyeOffIcon aria-hidden />
                        {t("inactive")}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="tabular">{s.code}</span> · {t(`units.${s.pricingUnit as (typeof UNITS)[number]}`)} ·{" "}
                    {t("minutes", { n: s.defaultDurationMin })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {s.isDemoPrice ? (
                    <Badge variant="outline" className="border-warning/60 text-warning-foreground">
                      {t("demoBadge")}
                    </Badge>
                  ) : null}
                  <span className="min-w-28 text-end font-semibold tabular">{formatMoney(s.priceMinor, s.currency, intl, currencySymbol)}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={t("priceHistory")} title={t("priceHistory")} onClick={() => setHistoryFor(s)}>
                    <HistoryIcon aria-hidden />
                  </Button>
                  {canManage ? (
                    <Button variant="ghost" size="icon-sm" aria-label={t("editTitle")} title={t("editTitle")} onClick={() => setEditing(s)}>
                      <PencilIcon aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {editing ? (
        <ServiceDialog
          key={editing === "new" ? "new" : `${editing.id}-${editing.version}`}
          service={editing === "new" ? null : editing}
          categories={categories}
          currency={currency}
          currencySymbol={currencySymbol}
          onClose={() => setEditing(null)}
          nameOf={nameOf}
        />
      ) : null}
      {historyFor ? (
        <HistoryDialog service={historyFor} intl={intl} symbol={currencySymbol} timeZone={timeZone} onClose={() => setHistoryFor(null)} title={nameOf(historyFor)} />
      ) : null}
    </div>
  );
}

function ServiceDialog({
  service,
  categories,
  currency,
  currencySymbol,
  onClose,
  nameOf,
}: {
  service: CatalogService | null;
  categories: CatalogCategory[];
  currency: string;
  currencySymbol: string;
  onClose: () => void;
  nameOf: (s: { name: CatalogService["name"] }) => string;
}) {
  const t = useTranslations("catalog");
  const [state, action] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await saveServiceAction(service?.id ?? null, service?.version ?? null, prev, formData);
    if (result.ok) onClose();
    return result;
  }, initialActionState);
  const [pending, startTransition] = useTransition();

  const d: Record<string, string> = state.values ?? {
    categoryId: service?.categoryId ?? categories[0]?.id ?? "",
    code: service?.code ?? "",
    nameFr: service?.name.fr ?? "",
    nameEn: service?.name.en ?? "",
    nameAr: service?.name.ar ?? "",
    pricingUnit: service?.pricingUnit ?? "procedure",
    anatomy: service?.anatomy ?? "none",
    defaultDurationMin: String(service?.defaultDurationMin ?? 30),
    price: service ? minorToInput(service.priceMinor, service.currency) : "",
  };
  const fe = state.fieldErrors ?? {};

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{service ? t("editTitle") : t("newService")}</DialogTitle>
          <DialogDescription>{service ? nameOf(service) : t("subtitle")}</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4" noValidate>
          <FormError error={state.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t("fields.category")}
              name="categoryId"
              defaultValue={d.categoryId}
              options={categories.map((c) => ({ value: c.id, label: nameOf(c) }))}
              error={fe.categoryId}
            />
            <TextField label={t("fields.code")} name="code" required defaultValue={d.code} error={fe.code} autoComplete="off" />
            <TextField label={t("fields.nameFr")} name="nameFr" required defaultValue={d.nameFr} error={fe.nameFr} fieldClassName="sm:col-span-2" autoComplete="off" />
            <TextField label={t("fields.nameEn")} name="nameEn" optionalLabel defaultValue={d.nameEn} autoComplete="off" />
            <TextField label={t("fields.nameAr")} name="nameAr" optionalLabel dir="rtl" lang="ar" defaultValue={d.nameAr} autoComplete="off" />
            <SelectField label={t("fields.unit")} name="pricingUnit" defaultValue={d.pricingUnit} options={UNITS.map((u) => ({ value: u, label: t(`units.${u}`) }))} />
            <SelectField label={t("fields.anatomy")} name="anatomy" defaultValue={d.anatomy} options={ANATOMY.map((a) => ({ value: a, label: t(`anatomy.${a}`) }))} />
            <TextField
              label={t("fields.duration")}
              name="defaultDurationMin"
              type="number"
              inputMode="numeric"
              min={0}
              max={600}
              defaultValue={d.defaultDurationMin}
              error={fe.defaultDurationMin}
            />
            <TextField
              label={t("fields.price", { currency: currencySymbol })}
              name="price"
              inputMode="decimal"
              required
              defaultValue={d.price}
              error={fe.price}
              autoComplete="off"
              className="tabular"
            />
            {service ? (
              <TextField
                label={t("fields.priceReason")}
                name="priceChangeReason"
                optionalLabel
                hint={t("fields.priceReasonHint")}
                fieldClassName="sm:col-span-2"
                defaultValue={d.priceChangeReason}
                autoComplete="off"
              />
            ) : null}
          </div>
          <input type="hidden" name="currency" value={currency} />
          <div className="flex flex-wrap justify-between gap-2">
            <SubmitButton>{service ? t("editTitle") : t("newService")}</SubmitButton>
            {service ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await setServiceActiveAction(service.id, !service.isActive);
                    onClose();
                  })
                }
              >
                <PowerIcon aria-hidden />
                {service.isActive ? t("deactivate") : t("activate")}
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type HistoryRow = Awaited<ReturnType<typeof priceHistoryAction>>[number];

function HistoryDialog({
  service,
  intl,
  symbol,
  timeZone,
  title,
  onClose,
}: {
  service: CatalogService;
  intl: string;
  symbol: string;
  timeZone: string;
  title: string;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    priceHistoryAction(service.id).then((r) => !cancelled && setRows(r));
    return () => {
      cancelled = true;
    };
  }, [service.id]);
  const reasonLabel = (r: string | null) =>
    r === "starter_catalog_demo" ? t("catalog.demoBadge") : r === "created" ? t("common.create") : r;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("catalog.priceHistory")}</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        {rows === null ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span>
                  <span className="block tabular">{formatDateTime(r.effectiveFrom, timeZone, intl)}</span>
                  {r.reason ? <span className="block text-xs text-muted-foreground">{reasonLabel(r.reason)}</span> : null}
                </span>
                <span className="font-semibold tabular">{formatMoney(r.priceMinor, r.currency, intl, symbol)}</span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
