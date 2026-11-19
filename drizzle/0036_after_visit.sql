ALTER TYPE "public"."follow_up_reason" ADD VALUE 'after_visit';--> statement-breakpoint
ALTER TYPE "public"."follow_up_reason" ADD VALUE 'referral_thanks';--> statement-breakpoint
ALTER TABLE "patient_contacts" DROP CONSTRAINT "patient_contacts_reference";--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD COLUMN "visit_date" date;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_reference" CHECK (("patient_contacts"."reason"::text in ('appointment_reminder', 'no_show') and "patient_contacts"."appointment_id" is not null and "patient_contacts"."treatment_plan_id" is null and "patient_contacts"."visit_date" is null)
       or ("patient_contacts"."reason"::text in ('treatment_followup', 'estimate_followup') and "patient_contacts"."treatment_plan_id" is not null and "patient_contacts"."appointment_id" is null and "patient_contacts"."visit_date" is null)
       or ("patient_contacts"."reason"::text in ('recall', 'referral_thanks') and "patient_contacts"."appointment_id" is null and "patient_contacts"."treatment_plan_id" is null and "patient_contacts"."visit_date" is null)
       or ("patient_contacts"."reason"::text = 'after_visit' and "patient_contacts"."visit_date" is not null and "patient_contacts"."appointment_id" is null and "patient_contacts"."treatment_plan_id" is null));