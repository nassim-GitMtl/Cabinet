import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, type LocalizedText } from "./_shared";
import { patients } from "./patients";
import { organizations, users } from "./platform";
import { appointments } from "./scheduling";

/**
 * Medical history questionnaires (§8).
 * - Questionnaire definitions are versioned; a published version never changes.
 * - Every submission is a new, append-only response (history preserved).
 * - "Unanswered" is distinct from "no"; "unknown" and "declined" are explicit.
 * - Clinician reviews (including "reviewed, no changes") are append-only events.
 * - Nothing here infers a diagnosis or contraindication; alerts are created by
 *   a clinician from an answer.
 */

export type QuestionKind = "yes_no" | "text";
export type Question = {
  id: string;
  kind: QuestionKind;
  label: LocalizedText;
  /** Follow-up prompt shown when the answer is "yes" (yes_no) — e.g. "Lesquels ?". */
  detailPrompt?: LocalizedText;
  /** Restricted information (e.g. infectious disease) — shown only to clinical roles. */
  sensitive?: boolean;
  /** Short label used when a clinician promotes the answer to an alert, e.g. "Allergie". */
  alertLabel?: LocalizedText;
  /** Suggested alert kind if a clinician promotes a "yes" answer to an alert. */
  alertKind?: "medical" | "allergy" | "medication";
};

export type AnswerValue = "yes" | "no" | "unknown" | "declined";
export type Answer = { value?: AnswerValue; text?: string; details?: string };
export type Answers = Record<string, Answer>;

export const questionnaireVersions = pgTable(
  "questionnaire_versions",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    /** Stable key of the questionnaire family, e.g. "medical_history". */
    key: text("key").notNull(),
    versionNo: integer("version_no").notNull(),
    title: jsonb("title").$type<LocalizedText>().notNull(),
    questions: jsonb("questions").$type<Question[]>().notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    /** Clinician who approved the wording (null for the starter version until a clinician approves it). */
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("questionnaire_versions_key_no_uq").on(t.organizationId, t.key, t.versionNo)],
);

export const responseSource = pgEnum("questionnaire_response_source", ["staff_entered", "patient_portal", "patient_tablet"]);

export const questionnaireResponses = pgTable(
  "questionnaire_responses",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    questionnaireVersionId: uuid("questionnaire_version_id")
      .notNull()
      .references(() => questionnaireVersions.id),
    answers: jsonb("answers").$type<Answers>().notNull(),
    source: responseSource("source").notNull(),
    /** Staff member who entered it (null when the patient submitted it). */
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id),
    /** The patient (or representative) confirmed the answers. */
    patientAcknowledged: boolean("patient_acknowledged").notNull().default(false),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("questionnaire_responses_patient_idx").on(t.organizationId, t.patientId, t.recordedAt)],
);

/** Short-lived, single-use handoff for a patient completing the form on a clinic tablet. */
export const questionnaireTabletSessions = pgTable(
  "questionnaire_tablet_sessions",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    questionnaireVersionId: uuid("questionnaire_version_id").notNull().references(() => questionnaireVersions.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("questionnaire_tablet_sessions_token_uq").on(t.tokenHash),
    index("questionnaire_tablet_sessions_patient_idx").on(t.organizationId, t.patientId, t.createdAt),
  ],
);

export const historyReviewOutcome = pgEnum("health_history_review_outcome", ["reviewed", "no_changes"]);

export const healthHistoryReviews = pgTable(
  "health_history_reviews",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    responseId: uuid("response_id")
      .notNull()
      .references(() => questionnaireResponses.id),
    outcome: historyReviewOutcome("outcome").notNull(),
    note: text("note"),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    reviewedByUserId: uuid("reviewed_by_user_id")
      .notNull()
      .references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("health_reviews_patient_idx").on(t.organizationId, t.patientId, t.reviewedAt)],
);
