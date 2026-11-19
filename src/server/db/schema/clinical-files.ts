import { sql } from "drizzle-orm";
import { check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId } from "./_shared";
import { patients } from "./patients";
import { organizations, users } from "./platform";

/** Immutable clinical file metadata. File bytes live in private local storage, never under /public. */
export const clinicalFileKind = pgEnum("clinical_file_kind", ["image", "document"]);
export const clinicalFileCategory = pgEnum("clinical_file_category", [
  "intraoral_photo", "extraoral_photo", "radiograph", "scan", "referral",
  "prescription", "lab_report", "consent", "other",
]);

export const clinicalFiles = pgTable(
  "clinical_files",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    kind: clinicalFileKind("kind").notNull(),
    category: clinicalFileCategory("category").notNull(),
    title: text("title"),
    /** Date represented by the image/document; date-only and never timezone-converted. */
    clinicalDate: date("clinical_date", { mode: "string" }).notNull(),
    toothNumbers: text("tooth_numbers").array().notNull().default(sql`'{}'::text[]`),
    mimeType: text("mime_type").notNull(),
    originalFilename: text("original_filename").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    /** Opaque validated relative path. Never display it or accept it from a client. */
    storageKey: text("storage_key").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("clinical_files_size_positive", sql`${t.byteSize} > 0`),
    check("clinical_files_sha256_format", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    uniqueIndex("clinical_files_storage_key_uq").on(t.storageKey),
    index("clinical_files_patient_date_idx").on(t.organizationId, t.patientId, t.clinicalDate, t.createdAt),
  ],
);

/** Immutable before/after relationship. Both assets remain independently usable clinical records. */
export const clinicalFileComparisons = pgTable(
  "clinical_file_comparisons",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    beforeFileId: uuid("before_file_id").notNull().references(() => clinicalFiles.id),
    afterFileId: uuid("after_file_id").notNull().references(() => clinicalFiles.id),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("clinical_file_comparisons_distinct", sql`${t.beforeFileId} <> ${t.afterFileId}`),
    uniqueIndex("clinical_file_comparisons_before_uq").on(t.beforeFileId),
    uniqueIndex("clinical_file_comparisons_after_uq").on(t.afterFileId),
    index("clinical_file_comparisons_patient_idx").on(t.organizationId, t.patientId, t.createdAt),
  ],
);
