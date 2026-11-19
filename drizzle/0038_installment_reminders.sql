ALTER TYPE "public"."follow_up_reason" ADD VALUE 'installment_due';--> statement-breakpoint
ALTER TABLE "patient_contacts" DROP CONSTRAINT "patient_contacts_reference";--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD COLUMN "installment_id" uuid;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_installment_id_payment_schedule_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."payment_schedule_installments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_reference" CHECK ((("patient_contacts"."reason"::text in ('appointment_reminder', 'no_show') and "patient_contacts"."appointment_id" is not null and "patient_contacts"."treatment_plan_id" is null and "patient_contacts"."visit_date" is null)
       or ("patient_contacts"."reason"::text in ('treatment_followup', 'estimate_followup') and "patient_contacts"."treatment_plan_id" is not null and "patient_contacts"."appointment_id" is null and "patient_contacts"."visit_date" is null)
       or ("patient_contacts"."reason"::text in ('recall', 'referral_thanks') and "patient_contacts"."appointment_id" is null and "patient_contacts"."treatment_plan_id" is null and "patient_contacts"."visit_date" is null)
       or ("patient_contacts"."reason"::text = 'after_visit' and "patient_contacts"."visit_date" is not null and "patient_contacts"."appointment_id" is null and "patient_contacts"."treatment_plan_id" is null)
       or ("patient_contacts"."reason"::text = 'installment_due' and "patient_contacts"."appointment_id" is null and "patient_contacts"."treatment_plan_id" is null and "patient_contacts"."visit_date" is null))
       and (("patient_contacts"."reason"::text = 'installment_due') = ("patient_contacts"."installment_id" is not null)));--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_patient_contact() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app_private.current_actor_type() <> 'staff' OR NEW.created_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'patient contacts: must be recorded by the staff actor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = NEW.patient_id AND p.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'patient contacts: patient must belong to the same organization';
  END IF;
  IF NEW.appointment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.appointments a
        WHERE a.id = NEW.appointment_id AND a.organization_id = NEW.organization_id AND a.patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'patient contacts: appointment must belong to the same patient';
  END IF;
  IF NEW.treatment_plan_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.treatment_plans t
        WHERE t.id = NEW.treatment_plan_id AND t.organization_id = NEW.organization_id AND t.patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'patient contacts: treatment plan must belong to the same patient';
  END IF;
  IF NEW.installment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.payment_schedule_installments i
        WHERE i.id = NEW.installment_id AND i.organization_id = NEW.organization_id AND i.patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'patient contacts: installment must belong to the same patient';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
SELECT app_private.apply_security();
