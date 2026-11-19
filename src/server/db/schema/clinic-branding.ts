// Clinic logo shown on printed documents and the public page. Small image stored in the database
// (no file storage needed, included in every database backup). Type checked from magic bytes.
import { sql } from "drizzle-orm";
import { check, customType, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt } from "./_shared";
import { organizations, users } from "./platform";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const MAX_LOGO_BYTES = 300 * 1024;

export const clinicLogos = pgTable(
  "clinic_logos",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    mimeType: text("mime_type").notNull(),
    bytes: bytea("bytes").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    updatedByUserId: uuid("updated_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("clinic_logos_org_uq").on(t.organizationId),
    check("clinic_logos_mime", sql`${t.mimeType} in ('image/png', 'image/jpeg', 'image/webp')`),
    check("clinic_logos_size", sql`${t.byteSize} > 0 and ${t.byteSize} <= 307200`),
  ],
);
