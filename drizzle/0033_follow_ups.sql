CREATE TYPE "public"."contact_channel" AS ENUM('whatsapp', 'sms', 'phone', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."contact_outcome" AS ENUM('message_prepared', 'reached', 'no_answer', 'booked', 'declined');--> statement-breakpoint
CREATE TYPE "public"."follow_up_reason" AS ENUM('appointment_reminder', 'recall', 'treatment_followup', 'estimate_followup', 'no_show');--> statement-breakpoint
CREATE TABLE "patient_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"reason" "follow_up_reason" NOT NULL,
	"channel" "contact_channel" NOT NULL,
	"outcome" "contact_outcome" NOT NULL,
	"appointment_id" uuid,
	"treatment_plan_id" uuid,
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_contacts_note_length" CHECK ("patient_contacts"."note" is null or char_length("patient_contacts"."note") <= 300),
	CONSTRAINT "patient_contacts_reference" CHECK (("patient_contacts"."reason" in ('appointment_reminder', 'no_show') and "patient_contacts"."appointment_id" is not null and "patient_contacts"."treatment_plan_id" is null)
       or ("patient_contacts"."reason" in ('treatment_followup', 'estimate_followup') and "patient_contacts"."treatment_plan_id" is not null and "patient_contacts"."appointment_id" is null)
       or ("patient_contacts"."reason" = 'recall' and "patient_contacts"."appointment_id" is null and "patient_contacts"."treatment_plan_id" is null))
);
--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_treatment_plan_id_treatment_plans_id_fk" FOREIGN KEY ("treatment_plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_contacts_patient_idx" ON "patient_contacts" USING btree ("organization_id","patient_id","reason","created_at");--> statement-breakpoint
CREATE INDEX "patient_contacts_appointment_idx" ON "patient_contacts" USING btree ("organization_id","appointment_id");--> statement-breakpoint
CREATE INDEX "patient_contacts_plan_idx" ON "patient_contacts" USING btree ("organization_id","treatment_plan_id");--> statement-breakpoint
-- Contact attempts are history: never edited or deleted (full list redefined, see ARCHITECTURE "Adding a table").
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings', 'clinical_note_versions',
    'questionnaire_responses', 'health_history_reviews', 'inventory_lots', 'inventory_movements',
    'inventory_purchase_order_lines', 'audit_events', 'clinical_files', 'clinical_file_comparisons',
    'patient_contacts'
  ]::text[] $$;
--> statement-breakpoint
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
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patient_contacts_guard BEFORE INSERT ON public.patient_contacts
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_patient_contact();
--> statement-breakpoint
-- Contacting patients for reminders/recalls is its own permission (front desk + clinicians).
UPDATE public.roles SET permissions = permissions || ARRAY['patient.followup']::text[]
 WHERE key IN ('owner', 'dentist', 'assistant', 'receptionist') AND is_system AND NOT ('patient.followup' = ANY(permissions));
--> statement-breakpoint
SELECT app_private.apply_security();
