import type { Permission } from "./permissions";

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
] as const;

export type ProductModule = (typeof PRODUCT_MODULES)[number];
export const BILLABLE_MODULES = PRODUCT_MODULES.filter((key) => key !== "core");

const MODULE_PERMISSIONS: Partial<Record<Permission, ProductModule>> = {
  "booking.approve": "online_booking",
  "questionnaire.manage": "advanced_clinical",
  "questionnaire.approve": "advanced_clinical",
  "clinical.images.read": "advanced_clinical",
  "clinical.images.write": "advanced_clinical",
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
