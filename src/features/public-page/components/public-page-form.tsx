"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon, ExternalLinkIcon, PrinterIcon, QrCodeIcon } from "lucide-react";
import { FormError, SelectField, SubmitButton, TextAreaField, TextField, useErrorText } from "@/components/form";
import { ButtonLink } from "@/components/button-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { initialActionState } from "@/lib/action-state";
import { savePublicProfileAction } from "../actions";

type Saved = {
  slug: string; isPublished: boolean; about: { fr?: string; en?: string; ar?: string }; whatsappPhone: string; mapUrl: string;
  facebookUrl: string; instagramUrl: string; reviewUrl: string; bookingLinkId: string; featuredServiceIds: string[]; showPrices: boolean;
};
type ServiceOption = { id: string; name: string; category: string; price: string };

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function PublicPageForm({ saved, origin, localOnly, links, services, branchPhone }: {
  saved: Saved; origin: string; localOnly: boolean; links: { id: string; label: string }[]; services: ServiceOption[]; branchPhone: string;
}) {
  const t = useTranslations("publicPage");
  const errorText = useErrorText();
  const [state, action] = useActionState(savePublicProfileAction, initialActionState);
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  const featured = new Set((state.data as { featured?: string[] } | undefined)?.featured ?? saved.featuredServiceIds);
  const [slug, setSlug] = useState(v?.slug ?? saved.slug);
  const [copied, setCopied] = useState(false);
  const publicUrl = `${origin}/c/${slug.trim().toLowerCase()}`;
  const published = v ? v.isPublished === "on" : saved.isPublished;
  const categories = [...new Set(services.map((s) => s.category))];

  return (
    <form action={action} className="grid gap-5">
      <FormError error={state.error} />
      {state.ok ? <p role="status" className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm font-medium text-success">{t("saved")}</p> : null}

      <Panel title={t("addressTitle")} hint={t("addressHint")}>
        <TextField name="slug" label={t("slug")} required dir="ltr" autoComplete="off" value={slug} onChange={(e) => setSlug(e.target.value)}
          hint={<span dir="ltr" className="break-all">{publicUrl}</span>} error={fe.slug} />
        <label className="flex items-start gap-3 rounded-xl border p-3">
          <Checkbox name="isPublished" defaultChecked={published} />
          <span className="text-sm">
            <span className="block font-medium">{t("published")}</span>
            <span className="block text-xs text-muted-foreground">{t("publishedHint")}</span>
          </span>
        </label>
        {localOnly ? <p className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t("localOnly")}</p> : null}
        {saved.slug && saved.isPublished ? (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/c/${saved.slug}`} target="_blank" variant="outline" size="sm"><ExternalLinkIcon aria-hidden />{t("view")}</ButtonLink>
            <Button type="button" variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(`${origin}/c/${saved.slug}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } }}>
              {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}{copied ? t("copied") : t("copy")}
            </Button>
            <ButtonLink href="/print/public-poster" target="_blank" variant="outline" size="sm"><PrinterIcon aria-hidden />{t("poster")}</ButtonLink>
            <a href="/api/public-page/qr" download className={buttonVariants({ variant: "outline", size: "sm" })}><QrCodeIcon aria-hidden />{t("downloadQr")}</a>
          </div>
        ) : null}
      </Panel>

      <Panel title={t("aboutTitle")} hint={t("aboutHint")}>
        <div className="grid gap-3 lg:grid-cols-3">
          {(["fr", "en", "ar"] as const).map((locale) => (
            <TextAreaField key={locale} name={`about.${locale}`} label={t(`locales.${locale}`)} optionalLabel rows={4} maxLength={600}
              dir={locale === "ar" ? "rtl" : "ltr"} defaultValue={v?.[`about.${locale}`] ?? saved.about[locale] ?? ""} />
          ))}
        </div>
        {fe.about ? <p role="alert" className="text-sm text-destructive">{errorText(fe.about)}</p> : null}
      </Panel>

      <Panel title={t("contactTitle")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="whatsappPhone" type="tel" inputMode="tel" dir="ltr" label={t("whatsapp")} optionalLabel placeholder={branchPhone}
            hint={t("whatsappHint")} defaultValue={v?.whatsappPhone ?? saved.whatsappPhone} error={fe.whatsappPhone} />
          <TextField name="mapUrl" type="url" dir="ltr" label={t("mapUrl")} optionalLabel placeholder="https://maps.app.goo.gl/…"
            hint={t("mapUrlHint")} defaultValue={v?.mapUrl ?? saved.mapUrl} error={fe.mapUrl} />
          <TextField name="facebookUrl" type="url" dir="ltr" label="Facebook" optionalLabel placeholder="https://facebook.com/…"
            defaultValue={v?.facebookUrl ?? saved.facebookUrl} error={fe.facebookUrl} />
          <TextField name="instagramUrl" type="url" dir="ltr" label="Instagram" optionalLabel placeholder="https://instagram.com/…"
            defaultValue={v?.instagramUrl ?? saved.instagramUrl} error={fe.instagramUrl} />
          <TextField name="reviewUrl" type="url" dir="ltr" label={t("reviewUrl")} optionalLabel placeholder="https://g.page/r/…"
            hint={t("reviewUrlHint")} defaultValue={v?.reviewUrl ?? saved.reviewUrl} error={fe.reviewUrl} />
        </div>
      </Panel>

      <Panel title={t("bookingTitle")} hint={links.length ? t("bookingHint") : t("noBookingLink")}>
        {links.length ? (
          <SelectField name="bookingLinkId" label={t("bookingLink")} placeholder={t("firstActiveLink")}
            defaultValue={v?.bookingLinkId ?? saved.bookingLinkId} options={links.map((l) => ({ value: l.id, label: l.label }))} error={fe.bookingLinkId} />
        ) : (
          <ButtonLink href="/agenda/requests" variant="outline" size="sm" className="justify-self-start">{t("createBookingLink")}</ButtonLink>
        )}
      </Panel>

      <Panel title={t("servicesTitle")} hint={t("servicesHint")}>
        <label className="flex items-start gap-3 rounded-xl border p-3">
          <Checkbox name="showPrices" defaultChecked={v ? v.showPrices === "on" : saved.showPrices} />
          <span className="text-sm">
            <span className="block font-medium">{t("showPrices")}</span>
            <span className="block text-xs text-muted-foreground">{t("showPricesHint")}</span>
          </span>
        </label>
        <div className="grid max-h-[28rem] gap-4 overflow-y-auto rounded-xl border p-3">
          {categories.map((category) => (
            <fieldset key={category} className="grid gap-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><bdi>{category}</bdi></legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {services.filter((s) => s.category === category).map((s) => (
                  <label key={s.id} className="flex items-start gap-2 text-sm">
                    <Checkbox name="featuredServiceIds" value={s.id} defaultChecked={featured.has(s.id)} />
                    <span><bdi>{s.name}</bdi> <span className="text-xs text-muted-foreground tabular-nums">· {s.price}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {fe.featuredServiceIds ? <p role="alert" className="text-sm text-destructive">{errorText(fe.featuredServiceIds)}</p> : null}
      </Panel>

      <SubmitButton className="justify-self-start">{t("save")}</SubmitButton>
    </form>
  );
}
