import { getTranslations } from "next-intl/server";
import { AppShell, type NavKey } from "@/components/app/app-shell";
import { can, requireClinicContext } from "@/server/auth/context";
import { listMyClinics } from "@/server/services/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireClinicContext();
  const clinics = await listMyClinics(ctx.userId);
  const t = await getTranslations("roles");
  const roleName = t.has(ctx.roleKey as never) ? t(ctx.roleKey as never) : ctx.roleName;

  const nav: NavKey[] = ["dashboard"];
  if (can(ctx, "appointment.read")) nav.push("agenda", "reception");
  if (can(ctx, "patient.read")) nav.push("patients");
  if (can(ctx, "invoice.read")) nav.push("invoices");
  if (can(ctx, "report.operational") || can(ctx, "report.financial")) nav.push("reports");
  if (can(ctx, "cash.manage")) nav.push("cash");
  if (can(ctx, "expense.read")) nav.push("expenses");
  if (can(ctx, "catalog.read")) nav.push("catalog");
  if (can(ctx, "org.settings.manage") || can(ctx, "org.staff.manage")) nav.push("settings");

  return (
    <AppShell
      clinicName={ctx.organization.name}
      userName={ctx.displayName}
      roleName={roleName}
      nav={nav}
      canCreatePatient={can(ctx, "patient.create")}
      hasMultipleClinics={clinics.length > 1}
    >
      {children}
    </AppShell>
  );
}
