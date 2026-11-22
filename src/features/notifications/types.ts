export type OperationalNotificationKind =
  | "bookingRequests"
  | "inventoryLow"
  | "inventoryExpiring"
  | "inventoryExpired"
  | "sterilizationPending";

export type OperationalNotification = {
  kind: OperationalNotificationKind;
  count: number;
  href: string;
  priority: "attention" | "urgent";
};
