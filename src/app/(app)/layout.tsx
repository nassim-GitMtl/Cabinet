import { getTranslations } from "next-intl/server";
import { ConnectionBanner } from "@/components/app/connection-banner";
import { AppShell, type NavKey } from "@/components/app/app-shell";
import { SyncNotice } from "@/features/sync/components/sync-notice";
import { getOperationalNotifications } from "@/features/notifications/server";
import { can, requireClinicContext } from "@/server/auth/context";
import { listMyClinics } from "@/server/services/auth";
import { canSeeHonoraria } from "@/features/honoraria/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireClinicContext();
  const clinics = await listMyClinics(ctx.userId);
  // The bell is a convenience: if its counts cannot be computed, the page still opens (without them).
  const notifications = await getOperationalNotifications(ctx).catch((error: unknown) => {
    console.error("notifications unavailable:", error instanceof Error ? error.message : error);
    return [];
  });
  const t = await getTranslations("roles");
  const roleName = t.has(ctx.roleKey as never) ? t(ctx.roleKey as never) : ctx.roleName;

  const nav: NavKey[] = ["dashboard"];
  if (can(ctx, "appointment.read")) nav.push("agenda", "reception");
  if (can(ctx, "patient.read")) nav.push("patients");
  if (can(ctx, "patient.followup")) nav.push("followUps");
  if (can(ctx, "invoice.read")) nav.push("invoices");
  if (canSeeHonoraria(ctx)) nav.push("honoraria");
  if (can(ctx, "report.operational") || can(ctx, "report.financial")) nav.push("reports");
  if (can(ctx, "cash.manage")) nav.push("cash");
  if (can(ctx, "expense.read")) nav.push("expenses");
  if (can(ctx, "inventory.manage")) nav.push("inventory");
  if (can(ctx, "sterilization.manage") || can(ctx, "sterilization.release")) nav.push("sterilization");
  if (can(ctx, "catalog.read")) nav.push("catalog");
  if (
    can(ctx, "org.settings.manage") ||
    can(ctx, "org.staff.manage") ||
    can(ctx, "questionnaire.manage") ||
    can(ctx, "questionnaire.approve") ||
    ctx.canManageClinicComputer
  ) nav.push("settings");

  return (
    <AppShell
      clinicName={ctx.organization.name}
      userName={ctx.displayName}
      roleName={roleName}
      nav={nav}
      canCreatePatient={can(ctx, "patient.create")}
      hasMultipleClinics={clinics.length > 1}
      isPlatformOperator={ctx.user.platformRole === "operator"}
      initialNotifications={notifications}
    >
      <ConnectionBanner />
      <SyncNotice ctx={ctx} />
      {children}
    </AppShell>
  );
}
