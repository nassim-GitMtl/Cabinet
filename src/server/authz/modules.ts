import { readOnlyCopyPermissions, roleEffectivePermissions, trialExpiredPermissions, type Permission } from "./permissions";

/** Commercial entitlements. `core` is always provisioned and is not sold separately. */
export const PRODUCT_MODULES = [
  "core",
  "online_booking",
  "advanced_clinical",
  "billing",
  "reports",
  "inventory",
  "sterilization",
  "patient_engagement",
  "laboratory",
  "whatsapp_reminders",
  "multi_site",
] as const;

export type ProductModule = (typeof PRODUCT_MODULES)[number];
export const BILLABLE_MODULES = PRODUCT_MODULES.filter((key) => key !== "core");

const MODULE_PERMISSIONS: Partial<Record<Permission, ProductModule>> = {
  "booking.approve": "online_booking",
  "questionnaire.manage": "advanced_clinical",
  "questionnaire.approve": "advanced_clinical",
  "clinical.images.read": "advanced_clinical",
  "clinical.images.write": "advanced_clinical",
  "patient.journey.manage": "advanced_clinical",
  "treatment_plan.read": "advanced_clinical",
  "treatment_plan.manage": "advanced_clinical",
  "treatment_plan.accept": "advanced_clinical",
  "treatment_plan.convert": "advanced_clinical",
  "price.override": "billing",
  "discount.approve": "billing",
  "invoice.read": "billing",
  "invoice.create": "billing",
  "invoice.issue": "billing",
  "invoice.void": "billing",
  "credit_note.issue": "billing",
  "payment.read": "billing",
  "payment.receive": "billing",
  "payment.refund": "billing",
  "payment.reverse": "billing",
  "cash.manage": "billing",
  "cash.close": "billing",
  "cash.close.approve": "billing",
  "period.reopen": "billing",
  "expense.read": "billing",
  "expense.manage": "billing",
  "expense.approve": "billing",
  "honorarium.read.own": "billing",
  "honorarium.read.all": "billing",
  "honorarium.manage": "billing",
  "honorarium.pay": "billing",
  "honorarium.close": "billing",
  "report.operational": "reports",
  "report.financial": "reports",
  "report.export": "reports",
  "inventory.manage": "inventory",
  "sterilization.manage": "sterilization",
  "sterilization.release": "sterilization",
  "patient.followup": "patient_engagement",
  "shared_profile.request": "patient_engagement",
  "shared_profile.read": "patient_engagement",
  "lab.manage": "laboratory",
  "reminders.auto.manage": "whatsapp_reminders",
  "branches.manage": "multi_site",
};

export function isProductModule(value: string): value is ProductModule {
  return (PRODUCT_MODULES as readonly string[]).includes(value);
}

export function normalizeModules(values: readonly string[]): ProductModule[] {
  const set = new Set<ProductModule>(["core"]);
  for (const value of values) if (isProductModule(value)) set.add(value);
  return PRODUCT_MODULES.filter((key) => set.has(key));
}

export function moduleEnabled(modules: readonly string[], key: ProductModule): boolean {
  // Backward compatibility while an older database is waiting for migration 0045.
  return modules.length === 0 || key === "core" || modules.includes(key);
}

/** Removes permissions whose commercial module is not enabled. */
export function entitledPermissions(permissions: readonly string[], modules: readonly string[]): string[] {
  return permissions.filter((permission) => {
    const requiredModule = MODULE_PERMISSIONS[permission as Permission];
    return !requiredModule || moduleEnabled(modules, requiredModule);
  });
}

/**
 * What a member may do in a clinic on this request: the role's keys (owner-only keys kept for the owner), limited to the
 * modules sold, then to viewing on the cloud copy of a clinic run from its clinic computer or once a trial is over.
 */
export function sessionPermissions(input: {
  roleKey: string; rolePermissions: readonly string[]; enabledModules: readonly string[]; readOnlyCopy: boolean; trialExpired: boolean;
}): string[] {
  const entitled = entitledPermissions(roleEffectivePermissions(input.roleKey, input.rolePermissions), input.enabledModules);
  if (input.readOnlyCopy) return readOnlyCopyPermissions(entitled);
  return input.trialExpired ? trialExpiredPermissions(entitled) : entitled;
}
