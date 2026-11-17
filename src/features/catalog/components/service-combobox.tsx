"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronsUpDownIcon, StarIcon } from "lucide-react";
import { useErrorText } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { INTL_LOCALE, isLocale } from "@/i18n/config";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { setServiceFavoriteAction } from "../actions";
import type { CatalogService, ServicePickerData } from "../server";

type Props = {
  data: ServicePickerData;
  value: string;
  onValueChange: (serviceId: string) => void;
  currencySymbol: string;
  error?: string;
};

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase();

export function ServiceCombobox({ data, value, onValueChange, currencySymbol, error }: Props) {
  const id = useId();
  const t = useTranslations("procedures.picker");
  const locale = useLocale();
  const errorText = useErrorText()(error);
  const intl = INTL_LOCALE[isLocale(locale) ? locale : "fr"];
  const [open, setOpen] = useState(false);
  const [favorites, setFavorites] = useState(() => new Set(data.favoriteIds));
  const [, startTransition] = useTransition();

  const services = useMemo(() => data.categories.flatMap((category) => category.services), [data]);
  const byId = useMemo(() => new Map(services.map((service) => [service.id, service])), [services]);
  const selected = byId.get(value);
  const favoritesList = [...favorites].map((serviceId) => byId.get(serviceId)).filter(Boolean) as CatalogService[];
  const recent = data.recentIds
    .filter((serviceId) => !favorites.has(serviceId))
    .map((serviceId) => byId.get(serviceId))
    .filter(Boolean) as CatalogService[];

  const nameOf = (service: { name: CatalogService["name"] }) =>
    (service.name as Record<string, string | undefined>)[locale] || service.name.fr;

  const select = (serviceId: string) => {
    onValueChange(serviceId);
    setOpen(false);
  };

  const toggleFavorite = (serviceId: string) => {
    const wasFavorite = favorites.has(serviceId);
    setFavorites((current) => {
      const next = new Set(current);
      if (wasFavorite) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
    startTransition(async () => {
      const saved = await setServiceFavoriteAction(serviceId, !wasFavorite);
      if (!saved) {
        setFavorites((current) => {
          const next = new Set(current);
          if (wasFavorite) next.add(serviceId);
          else next.delete(serviceId);
          return next;
        });
      }
    });
  };

  const item = (service: CatalogService, group: string) => (
    <CommandItem
      key={`${group}-${service.id}`}
      value={`${service.code} ${service.name.fr} ${service.name.en ?? ""} ${service.name.ar ?? ""} ${group}`}
      data-checked={service.id === value || undefined}
      onSelect={() => select(service.id)}
      className="min-h-12 pe-1"
    >
      <button
        type="button"
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground",
          favorites.has(service.id) && "text-warning-foreground",
        )}
        aria-label={favorites.has(service.id) ? t("removeFavorite") : t("addFavorite")}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleFavorite(service.id);
        }}
      >
        <StarIcon className={cn("size-4", favorites.has(service.id) && "fill-current")} aria-hidden />
      </button>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <bdi className="truncate font-medium">{nameOf(service)}</bdi>
          {service.isDemoPrice ? <Badge variant="outline">{t("demo")}</Badge> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          <bdi>{service.code}</bdi> · {formatMoney(service.priceMinor, service.currency, intl, currencySymbol)}
        </span>
      </span>
    </CommandItem>
  );

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {t("label")} <span className="text-destructive" aria-hidden>*</span>
      </Label>
      <input type="hidden" name="serviceId" value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-invalid={!!errorText || undefined}
              aria-describedby={errorText ? `${id}-error` : undefined}
              className="h-auto min-h-11 w-full justify-between px-3 py-2 text-start"
            />
          }
        >
          {selected ? (
            <span className="min-w-0">
              <bdi className="block truncate font-medium">{nameOf(selected)}</bdi>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                <bdi>{selected.code}</bdi> · {formatMoney(selected.priceMinor, selected.currency, intl, currencySymbol)}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t("placeholder")}</span>
          )}
          <ChevronsUpDownIcon className="ms-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] p-0">
          <Command filter={(itemValue, search) => (fold(itemValue).includes(fold(search.trim())) ? 1 : 0)}>
            <CommandInput placeholder={t("search")} autoFocus />
            <CommandList className="max-h-[min(26rem,60dvh)]">
              <CommandEmpty>{t("empty")}</CommandEmpty>
              {favoritesList.length ? (
                <CommandGroup heading={t("favorites")}>{favoritesList.map((service) => item(service, "favorite"))}</CommandGroup>
              ) : null}
              {favoritesList.length && recent.length ? <CommandSeparator /> : null}
              {recent.length ? (
                <CommandGroup heading={t("recent")}>{recent.map((service) => item(service, "recent"))}</CommandGroup>
              ) : null}
              {(favoritesList.length || recent.length) && data.categories.length ? <CommandSeparator /> : null}
              {data.categories.map((category) =>
                category.services.length ? (
                  <CommandGroup key={category.id} heading={nameOf(category)}>
                    {category.services.map((service) => item(service, category.id))}
                  </CommandGroup>
                ) : null,
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {errorText ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
