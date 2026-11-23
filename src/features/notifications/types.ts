export type OperationalNotificationKind =
  | "bookingRequests"
  | "receptionWaiting"
  | "followUpsDue"
  | "billingReady"
  | "invoicePaymentsDue"
  | "honorariaPayable"
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
