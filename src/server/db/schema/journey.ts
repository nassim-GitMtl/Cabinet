import { sql } from "drizzle-orm";
import { check, date, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId } from "./_shared";
import { clinicalFileComparisons, clinicalFiles } from "./clinical-files";
import { patients } from "./patients";
import { organizations, users } from "./platform";
import { treatmentPlans } from "./treatment";

/**
 * Visual treatment journey: what a clinician chose to show a patient in the patient portal (photos, before/after
 * pairs, treatment steps), each with a plain-language explanation. Nothing is shown until the patient switches the
 * journey on in the portal, and they can switch it off. Items are never edited: a wrong one is withdrawn (once).
 */
export const journeyItemKind = pgEnum("journey_item_kind", ["milestone", "image", "comparison"]);
export const journeyAccessDecision = pgEnum("journey_access_decision", ["granted", "revoked"]);

export const patientJourneyItems = pgTable(
  "patient_journey_items",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    kind: journeyItemKind("kind").notNull(),
    /** The photo shown (kind image); must be an image of the same patient. */
    clinicalFileId: uuid("clinical_file_id").references(() => clinicalFiles.id),
    /** The before/after pair shown (kind comparison); must belong to the same patient. */
    comparisonId: uuid("comparison_id").references(() => clinicalFileComparisons.id),
    /** Optional: the treatment plan a step belongs to. */
    treatmentPlanId: uuid("treatment_plan_id").references(() => treatmentPlans.id),
    /** Plain-language title and explanation written for the patient. */
    title: text("title").notNull(),
    body: text("body"),
    /** Date the item is about (date-only, never timezone-converted). */
    eventDate: date("event_date", { mode: "string" }).notNull(),
    sharedByUserId: uuid("shared_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnByUserId: uuid("withdrawn_by_user_id").references(() => users.id),
    withdrawReason: text("withdraw_reason"),
  },
  (t) => [
    index("patient_journey_items_patient_idx").on(t.organizationId, t.patientId, t.eventDate),
    check(
      "patient_journey_items_kind_target",
      sql`(${t.kind} = 'image' and ${t.clinicalFileId} is not null and ${t.comparisonId} is null)
        or (${t.kind} = 'comparison' and ${t.comparisonId} is not null and ${t.clinicalFileId} is null)
        or (${t.kind} = 'milestone' and ${t.clinicalFileId} is null and ${t.comparisonId} is null)`,
    ),
    check("patient_journey_items_text", sql`length(trim(${t.title})) between 1 and 160 and (${t.body} is null or length(${t.body}) <= 2000)`),
    check(
      "patient_journey_items_withdrawal",
      sql`(${t.withdrawnAt} is null and ${t.withdrawnByUserId} is null and ${t.withdrawReason} is null)
        or (${t.withdrawnAt} is not null and ${t.withdrawnByUserId} is not null and length(trim(${t.withdrawReason})) > 0)`,
    ),
  ],
);

/** Append-only: the patient switching the journey on or off in the portal. The latest decision applies. */
export const patientJourneyAccess = pgTable(
  "patient_journey_access",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    decision: journeyAccessDecision("decision").notNull(),
    /** Portal account that decided (no foreign key: portal accounts are not copied to a clinic computer). */
    accountId: uuid("account_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("patient_journey_access_patient_idx").on(t.organizationId, t.patientId, t.decidedAt)],
);
