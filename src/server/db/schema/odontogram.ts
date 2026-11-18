import { sql } from "drizzle-orm";
import { AnyPgColumn, check, date, index, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId } from "./_shared";
import { performedProcedures } from "./clinical";
import { patients } from "./patients";
import { memberships, organizations, users } from "./platform";
import { treatmentPlanItems } from "./treatment";

export const odontogramFindingKind = pgEnum("odontogram_finding_kind", [
  "caries", "existing_filling", "crown", "bridge", "missing", "implant",
  "root_canal", "fracture", "mobility", "other",
]);
export const odontogramFindingStatus = pgEnum("odontogram_finding_status", ["active", "resolved", "entered_in_error"]);

/**
 * Append-only odontogram event. A resolution/correction inserts a new row that
 * supersedes the previous current row; the clinical observation is never edited.
 */
export const odontogramFindings = pgTable("odontogram_findings", {
  id: id(),
  organizationId: organizationId().references(() => organizations.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  toothNumber: text("tooth_number").notNull(),
  surfaces: text("surfaces").array().notNull().default(sql`'{}'::text[]`),
  kind: odontogramFindingKind("kind").notNull(),
  status: odontogramFindingStatus("status").notNull().default("active"),
  note: text("note"),
  observedOn: date("observed_on", { mode: "string" }).notNull(),
  providerId: uuid("provider_id").notNull().references(() => memberships.id),
  treatmentPlanItemId: uuid("treatment_plan_item_id").references(() => treatmentPlanItems.id),
  performedProcedureId: uuid("performed_procedure_id").references(() => performedProcedures.id),
  supersedesId: uuid("supersedes_id").references((): AnyPgColumn => odontogramFindings.id),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  index("odontogram_findings_patient_idx").on(t.organizationId, t.patientId, t.toothNumber, t.createdAt),
  uniqueIndex("odontogram_findings_supersedes_uq").on(t.supersedesId),
  check("odontogram_findings_fdi_valid", sql`
    ${t.toothNumber} ~ '^[1-8][1-8]$' and (
      (substring(${t.toothNumber}, 1, 1)::int <= 4 and substring(${t.toothNumber}, 2, 1)::int <= 8)
      or (substring(${t.toothNumber}, 1, 1)::int >= 5 and substring(${t.toothNumber}, 2, 1)::int <= 5)
    )`),
  check("odontogram_findings_surfaces_valid", sql`${t.surfaces} <@ ARRAY['mesial','distal','occlusal','buccal','lingual','palatal','incisal']::text[]`),
]);
