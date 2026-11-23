import { describe, expect, it } from "vitest";
import { navigationNotificationSummary } from "./navigation";
import type { OperationalNotification } from "./types";

const notifications: OperationalNotification[] = [
  { kind: "bookingRequests", count: 2, href: "/agenda/requests", priority: "attention" },
  { kind: "receptionWaiting", count: 3, href: "/reception", priority: "attention" },
  { kind: "billingReady", count: 4, href: "/invoices", priority: "attention" },
  { kind: "invoicePaymentsDue", count: 5, href: "/invoices", priority: "urgent" },
  { kind: "inventoryLow", count: 6, href: "/inventory", priority: "attention" },
  { kind: "inventoryExpired", count: 1, href: "/inventory", priority: "urgent" },
];

describe("navigation notification summaries", () => {
  it("maps each task to its module and combines multiple task types", () => {
    expect(navigationNotificationSummary(notifications, "agenda")).toEqual({ count: 2, urgent: false });
    expect(navigationNotificationSummary(notifications, "reception")).toEqual({ count: 3, urgent: false });
    expect(navigationNotificationSummary(notifications, "invoices")).toEqual({ count: 9, urgent: true });
    expect(navigationNotificationSummary(notifications, "inventory")).toEqual({ count: 7, urgent: true });
  });

  it("returns an empty summary for modules without actionable notifications", () => {
    expect(navigationNotificationSummary(notifications, "patients")).toEqual({ count: 0, urgent: false });
  });
});
