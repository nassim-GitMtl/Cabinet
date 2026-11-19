// Patient follow-ups (brief §20): appointment reminders, check-up recalls and treatment/estimate follow-ups.
// Messages are sent by staff from their own WhatsApp/SMS/phone; the app records each contact attempt
// (append-only) so the team never double-contacts a patient and can see who reached whom.
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId } from "./_shared";
import { patients } from "./patients";
import { organizations, users } from "./platform";
import { appointments } from "./scheduling";
import { treatmentPlans } from "./treatment";

export const followUpReason = pgEnum("follow_up_reason", [
  "appointment_reminder",
  "recall",
  "treatment_followup",
  "estimate_followup",
  "no_show",
]);
export const contactChannel = pgEnum("contact_channel", ["whatsapp", "sms", "phone", "in_person"]);
/** `message_prepared` = staff opened WhatsApp/SMS with the message; the app cannot know it was sent. */
export const contactOutcome = pgEnum("contact_outcome", ["message_prepared", "reached", "no_answer", "booked", "declined"]);

export const patientContacts = pgTable(
  "patient_contacts",
  {
    id: id(),
    organizationId: organizationId().references(() => organizations.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    reason: followUpReason("reason").notNull(),
    channel: contactChannel("channel").notNull(),
    outcome: contactOutcome("outcome").notNull(),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    treatmentPlanId: uuid("treatment_plan_id").references(() => treatmentPlans.id),
    /** Administrative only (e.g. "rappeler après 17 h"). Never clinical content. */
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("patient_contacts_patient_idx").on(t.organizationId, t.patientId, t.reason, t.createdAt),
    index("patient_contacts_appointment_idx").on(t.organizationId, t.appointmentId),
    index("patient_contacts_plan_idx").on(t.organizationId, t.treatmentPlanId),
    check("patient_contacts_note_length", sql`${t.note} is null or char_length(${t.note}) <= 300`),
    check(
      "patient_contacts_reference",
      sql`(${t.reason} in ('appointment_reminder', 'no_show') and ${t.appointmentId} is not null and ${t.treatmentPlanId} is null)
       or (${t.reason} in ('treatment_followup', 'estimate_followup') and ${t.treatmentPlanId} is not null and ${t.appointmentId} is null)
       or (${t.reason} = 'recall' and ${t.appointmentId} is null and ${t.treatmentPlanId} is null)`,
    ),
  ],
);
