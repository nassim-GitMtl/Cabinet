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
  /** Contact patients for reminders, recalls and follow-ups (sees phone numbers and visit/estimate status). */
  "patient.followup",
  // Clinical
  "clinical.read",
  "clinical.write",
  "clinical.sign",
  "questionnaire.manage",
  "questionnaire.approve",
  "clinical.images.read",
  "clinical.images.write",
  "patient.journey.manage",
  "treatment_plan.read",
  "treatment_plan.manage",
  "treatment_plan.accept",
  "treatment_plan.convert",
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
  "honorarium.read.own",
  "honorarium.read.all",
  "honorarium.manage",
  "honorarium.pay",
  "honorarium.close",
  // Reporting and audit
  "report.operational",
  "report.financial",
  "report.export",
  "audit.read",
  // Operations modules
  "lab.manage",
  "inventory.manage",
  "sterilization.manage",
  "sterilization.release",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * On the cloud copy of a clinic whose clinic computer is in charge, staff may only look: every ".read" key plus
 * reports and the audit trail. Screens then hide what cannot be done; the database refuses staff writes anyway.
 */
/**
 * Keys that only the owner role can hold (user decision 2026-11-22: only the owner and the practitioner concerned see
 * what a practitioner earned; the owner sets fees and prices). They cannot be given to another role, and are removed
 * from any other role when permissions are loaded.
 */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = ["honorarium.read.all", "honorarium.manage", "honorarium.pay", "honorarium.close"];
export const ASSIGNABLE_PERMISSIONS = PERMISSIONS.filter((p) => !OWNER_ONLY_PERMISSIONS.includes(p)) as [Permission, ...Permission[]];
export function roleEffectivePermissions(roleKey: string, permissions: readonly string[]): string[] {
  return roleKey === "owner" ? [...permissions] : permissions.filter((p) => !(OWNER_ONLY_PERMISSIONS as readonly string[]).includes(p));
}

const READ_ONLY_EXTRA: readonly string[] = ["report.operational", "report.financial", "report.export", "audit.read", "honorarium.read.own", "honorarium.read.all"];
export function readOnlyCopyPermissions(permissions: readonly string[]): string[] {
  return permissions.filter((p) => (p.endsWith(".read") && p !== "shared_profile.read") || READ_ONLY_EXTRA.includes(p));
}

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
  "treatment_plan.read",
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
      "patient.journey.manage",
      "questionnaire.approve",
      "treatment_plan.manage",
      "treatment_plan.accept",
      "treatment_plan.convert",
      "shared_profile.request",
      "shared_profile.read",
      "appointment.manage",
      "booking.approve",
      "patient.followup",
      "invoice.read",
      "invoice.create",
      "invoice.issue",
      "payment.read",
      "payment.receive",
      "honorarium.read.own",
      "report.operational",
      "sterilization.release",
    ],
  },
  hygienist: { name: "Hygiéniste", permissions: [...CLINICAL, "clinical.sign", "patient.journey.manage", "questionnaire.approve", "treatment_plan.convert"] },
  assistant: {
    name: "Assistant(e) dentaire",
    permissions: [...CLINICAL, "appointment.manage", "booking.approve", "patient.followup", "treatment_plan.convert", "sterilization.manage"],
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
      "patient.followup",
      "catalog.read",
      "invoice.read",
      "invoice.create",
      "invoice.issue",
      "payment.read",
      "payment.receive",
      "cash.manage",
      "cash.close",
      "report.operational",
      "shared_profile.request",
      "treatment_plan.read",
      "treatment_plan.accept",
    ],
  },
  accountant: {
    name: "Comptable",
    permissions: [
      "patient.read",
      "appointment.read",
      "catalog.read",
      "invoice.read",
      "payment.read",
      "expense.read",
      "expense.manage",
      "cash.manage",
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
