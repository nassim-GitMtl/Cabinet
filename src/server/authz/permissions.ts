/**
 * Permission keys and role templates.
 *
 * Roles are stored per organization (table `roles`) and seeded from these
 * templates when a clinic is created; owners can adjust them later.
 * Authorization must always check permission keys, never role names.
 */
export const PERMISSIONS = [
  // Organization administration
  "org.settings.manage",
  "org.staff.manage",
  "org.roles.manage",
  "org.modules.manage",
  // Patients (administrative data)
  "patient.read",
  "patient.create",
  "patient.update",
  "patient.archive",
  "patient.merge",
  "patient.export",
  "patient.alerts.read",
  "patient.alerts.manage",
  // Clinical
  "clinical.read",
  "clinical.write",
  "clinical.sign",
  "clinical.images.read",
  "clinical.images.write",
  // Cross-clinic shared profile
  "shared_profile.request",
  "shared_profile.read",
  // Scheduling
  "appointment.read",
  "appointment.manage",
  "booking.approve",
  // Catalog and pricing
  "catalog.read",
  "catalog.manage",
  "price.override",
  "discount.approve",
  // Finance
  "invoice.read",
  "invoice.create",
  "invoice.issue",
  "invoice.void",
  "credit_note.issue",
  "payment.read",
  "payment.receive",
  "payment.refund",
  "payment.reverse",
  "cash.manage",
  "cash.close",
  "cash.close.approve",
  "period.reopen",
  "expense.read",
  "expense.manage",
  "expense.approve",
  // Reporting and audit
  "report.operational",
  "report.financial",
  "report.export",
  "audit.read",
  // Operations modules
  "lab.manage",
  "inventory.manage",
  "sterilization.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const CLINICAL: Permission[] = [
  "patient.read",
  "patient.create",
  "patient.update",
  "patient.alerts.read",
  "patient.alerts.manage",
  "clinical.read",
  "clinical.write",
  "clinical.images.read",
  "clinical.images.write",
  "appointment.read",
  "catalog.read",
];

export type RoleTemplateKey =
  | "owner"
  | "dentist"
  | "hygienist"
  | "assistant"
  | "receptionist"
  | "accountant"
  | "inventory_operator"
  | "tech_admin";

export const ROLE_TEMPLATES: Record<RoleTemplateKey, { name: string; permissions: Permission[] }> = {
  owner: { name: "Propriétaire / Gérant", permissions: ALL },
  dentist: {
    name: "Chirurgien-dentiste",
    permissions: [
      ...CLINICAL,
      "clinical.sign",
      "shared_profile.request",
      "shared_profile.read",
      "appointment.manage",
      "booking.approve",
      "price.override",
      "invoice.read",
      "invoice.create",
      "invoice.issue",
      "payment.read",
      "payment.receive",
      "report.operational",
    ],
  },
  hygienist: { name: "Hygiéniste", permissions: [...CLINICAL, "clinical.sign"] },
  assistant: {
    name: "Assistant(e) dentaire",
    permissions: [...CLINICAL, "appointment.manage", "booking.approve", "sterilization.manage"],
  },
  receptionist: {
    name: "Réceptionniste",
    permissions: [
      "patient.read",
      "patient.create",
      "patient.update",
      "patient.alerts.read",
      "appointment.read",
      "appointment.manage",
      "booking.approve",
      "catalog.read",
      "invoice.read",
      "invoice.create",
      "invoice.issue",
      "payment.read",
      "payment.receive",
      "cash.manage",
      "report.operational",
      "shared_profile.request",
    ],
  },
  accountant: {
    name: "Comptable",
    permissions: [
      "patient.read",
      "catalog.read",
      "invoice.read",
      "payment.read",
      "expense.read",
      "expense.manage",
      "cash.close.approve",
      "report.financial",
      "report.export",
    ],
  },
  inventory_operator: {
    name: "Stock / Stérilisation",
    permissions: ["inventory.manage", "sterilization.manage", "catalog.read"],
  },
  // Administers accounts and settings; deliberately has NO patient or clinical access.
  tech_admin: {
    name: "Administrateur technique",
    permissions: ["org.settings.manage", "org.staff.manage", "org.modules.manage", "audit.read"],
  },
};

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
