import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt, version } from "./_shared";
import { encounters } from "./clinical";
import { patients } from "./patients";
import { memberships, organizations, users } from "./platform";

/**
 * Clinical notes (§12). A note is edited as a mutable DRAFT on the header row;
 * signing writes version 1 into the append-only `clinical_note_versions` table
 * and freezes the note. Corrections are dated amendments (new versions) that
 * reference the original — the signed text is never overwritten. Each version
 * stores a SHA-256 hash chained to the previous one (tamper evidence).
 */

export type NoteBody = {
  chiefComplaint: string;
  observations: string;
  assessment: string;
  plan: string;
  performedWork: string;
  /** FDI tooth numbers concerned. */
  teeth: string[];
};

export const noteKind = pgEnum("clinical_note_kind", ["consultation", "progress", "procedure", "post_op", "referral", "other"]);
export const noteStatus = pgEnum("clinical_note_status", ["draft", "in_review", "signed", "discarded"]);
export const noteVersionKind = pgEnum("clinical_note_version_kind", ["original", "amendment"]);

/** Clinic-editable templates. Their text is structure only — clinicians approve the content. */
export const noteTemplates = pgTable(
  "note_templates",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    name: text("name").notNull(),
    kind: noteKind("kind").notNull().default("progress"),
    body: jsonb("body").$type<Partial<NoteBody>>().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("note_templates_org_name_uq").on(t.organizationId, t.name)],
);

export const clinicalNotes = pgTable(
  "clinical_notes",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    encounterId: uuid("encounter_id").references(() => encounters.id),
    kind: noteKind("kind").notNull(),
    /** Clinical date of the care described (date-only). */
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => memberships.id),
    status: noteStatus("status").notNull().default("draft"),
    /** Editable only while draft / in review. Cleared at signing. */
    draftBody: jsonb("draft_body").$type<NoteBody | null>(),
    templateId: uuid("template_id").references(() => noteTemplates.id),
    templateName: text("template_name"),
    currentVersion: integer("current_version").notNull().default(0),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    submittedForReviewAt: timestamp("submitted_for_review_at", { withTimezone: true }),
    signedByUserId: uuid("signed_by_user_id").references(() => users.id),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [index("clinical_notes_patient_idx").on(t.organizationId, t.patientId, t.serviceDate)],
);

/** Signed content, append-only. Version 1 = original; later versions = amendments. */
export const clinicalNoteVersions = pgTable(
  "clinical_note_versions",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    noteId: uuid("note_id")
      .notNull()
      .references(() => clinicalNotes.id),
    versionNo: integer("version_no").notNull(),
    kind: noteVersionKind("kind").notNull(),
    body: jsonb("body").$type<NoteBody>().notNull(),
    amendmentReason: text("amendment_reason"),
    /** Template text the draft started from, kept to distinguish copied text from patient-specific entries. */
    templateSnapshot: jsonb("template_snapshot").$type<Partial<NoteBody> | null>(),
    signedByUserId: uuid("signed_by_user_id")
      .notNull()
      .references(() => users.id),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    prevHash: text("prev_hash"),
    contentHash: text("content_hash").notNull(),
  },
  (t) => [uniqueIndex("note_versions_note_no_uq").on(t.noteId, t.versionNo), index("note_versions_note_idx").on(t.noteId)],
);

