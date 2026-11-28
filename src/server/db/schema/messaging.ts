import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId, updatedAt } from "./_shared";
import { patients } from "./patients";
import { organizations } from "./platform";
import { appointments } from "./scheduling";

/**
 * Messages sent automatically through a provider (WhatsApp Cloud API). One row per message, never deleted; its status
 * only moves forward (queued → sent → delivered → read, or failed) as the provider confirms. A message is shown as
 * sent only once the provider accepted it.
 */
export const outboundMessageStatus = pgEnum("outbound_message_status", ["queued", "sent", "delivered", "read", "failed"]);

export type ReminderParams = { firstName: string; clinic: string; date: string; time: string; clinicPhone: string };

export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    /** What the message is for; one kind for now. */
    kind: text("kind").notNull(),
    channel: text("channel").notNull(),
    /** Appointment start the reminder was written for: a moved appointment gets a new reminder. */
    appointmentStartsAt: timestamp("appointment_starts_at", { withTimezone: true }),
    toE164: text("to_e164").notNull(),
    locale: text("locale").notNull(),
    templateName: text("template_name").notNull(),
    /** The template's variables (first name, clinic, date, time, phone); no clinical content. */
    params: jsonb("params").$type<ReminderParams>().notNull(),
    status: outboundMessageStatus("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
    errorTitle: text("error_title"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("outbound_messages_reminder_once_uq").on(t.appointmentId, t.kind, t.appointmentStartsAt).where(sql`appointment_id is not null`),
    uniqueIndex("outbound_messages_provider_id_uq").on(t.providerMessageId).where(sql`provider_message_id is not null`),
    index("outbound_messages_org_time_idx").on(t.organizationId, t.createdAt),
    index("outbound_messages_patient_idx").on(t.organizationId, t.patientId),
    check("outbound_messages_kind_valid", sql`${t.kind} in ('appointment_reminder')`),
    check("outbound_messages_channel_valid", sql`${t.channel} in ('whatsapp')`),
    check("outbound_messages_attempts_valid", sql`${t.attempts} between 0 and 10`),
  ],
);
