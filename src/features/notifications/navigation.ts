import type { OperationalNotification, OperationalNotificationKind } from "./types";

/** One notification kind belongs to one navigation destination, so totals are never double-counted. */
const KINDS_BY_NAV: Readonly<Record<string, readonly OperationalNotificationKind[]>> = {
  agenda: ["bookingRequests"],
  reception: ["receptionWaiting"],
  followUps: ["followUpsDue"],
  invoices: ["billingReady", "invoicePaymentsDue"],
  honoraria: ["honorariaPayable"],
  inventory: ["inventoryExpired", "inventoryLow", "inventoryExpiring"],
  sterilization: ["sterilizationPending"],
};

export type NavigationNotificationSummary = { count: number; urgent: boolean };

export function navigationNotificationSummary(
  notifications: readonly OperationalNotification[],
  navKey: string,
): NavigationNotificationSummary {
  const kinds = KINDS_BY_NAV[navKey];
  if (!kinds) return { count: 0, urgent: false };
  const matching = notifications.filter((item) => kinds.includes(item.kind));
  return {
    count: matching.reduce((sum, item) => sum + item.count, 0),
    urgent: matching.some((item) => item.priority === "urgent"),
  };
}
