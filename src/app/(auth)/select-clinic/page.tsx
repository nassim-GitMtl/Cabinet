import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Building2Icon, ChevronRightIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { logoutAction, selectClinicAction } from "@/features/auth/actions";
import { requireSession } from "@/server/auth/context";
import { listMyClinics } from "@/server/services/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth"))("selectClinicTitle") };
}

export default async function SelectClinicPage({ searchParams }: PageProps<"/select-clinic">) {
  const session = await requireSession();
  const { invalid } = await searchParams;
  const clinics = await listMyClinics(session.userId);
  const t = await getTranslations();
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.selectClinicTitle")}</CardTitle>
        <CardDescription>{t("auth.selectClinicSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {invalid ? (
          <Alert variant="destructive">
            <AlertDescription>{t("auth.invalidClinic")}</AlertDescription>
          </Alert>
        ) : null}
        {clinics.length === 0 ? <p className="text-sm text-muted-foreground">{t("auth.noClinic")}</p> : null}
        <ul className="space-y-2">
          {clinics.map((c) => (
            <li key={c.organizationId}>
              <form action={selectClinicAction.bind(null, c.organizationId)}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-start transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <Building2Icon className="size-5 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.displayName}</span>
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden />
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" className="w-full">
            {t("nav.logout")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
