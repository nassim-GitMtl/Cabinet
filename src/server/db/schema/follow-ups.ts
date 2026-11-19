// Patient follow-ups (brief §20): appointment reminders, check-up recalls and treatment/estimate follow-ups.
// Messages are sent by staff from their own WhatsApp/SMS/phone; the app records each contact attempt
// (append-only) so the team never double-contacts a patient and can see who reached whom.
import { sql } from "drizzle-orm";
import { check, date, index, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, organizationId } from "./_shared";
import { patients } from "./patients";
import { paymentScheduleInstallments } from "./payment-plans";
import { organizations, users } from "./platform";
import { appointments } from "./scheduling";
import { treatmentPlans } from "./treatment";

export const followUpReason = pgEnum("follow_up_reason", [
  "appointment_reminder",
  "recall",
  "treatment_followup",
  "estimate_followup",
  "no_show",
  /** Thank-you + care instructions (+ review link) after a day with completed procedures. */
  "after_visit",
  /** Thanks to a patient who recommended the clinic (never names who was referred). */
  "referral_thanks",
  /** Reminder of an upcoming or late payment-schedule installment. */
  "installment_due",
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
    /** Day of the visit an after-visit message refers to (date-only, clinic time zone). */
    visitDate: date("visit_date", { mode: "string" }),
    installmentId: uuid("installment_id").references(() => paymentScheduleInstallments.id),
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
      sql`((${t.reason}::text in ('appointment_reminder', 'no_show') and ${t.appointmentId} is not null and ${t.treatmentPlanId} is null and ${t.visitDate} is null)
       or (${t.reason}::text in ('treatment_followup', 'estimate_followup') and ${t.treatmentPlanId} is not null and ${t.appointmentId} is null and ${t.visitDate} is null)
       or (${t.reason}::text in ('recall', 'referral_thanks') and ${t.appointmentId} is null and ${t.treatmentPlanId} is null and ${t.visitDate} is null)
       or (${t.reason}::text = 'after_visit' and ${t.visitDate} is not null and ${t.appointmentId} is null and ${t.treatmentPlanId} is null)
       or (${t.reason}::text = 'installment_due' and ${t.appointmentId} is null and ${t.treatmentPlanId} is null and ${t.visitDate} is null))
       and ((${t.reason}::text = 'installment_due') = (${t.installmentId} is not null))`,
    ),
  ],
);
