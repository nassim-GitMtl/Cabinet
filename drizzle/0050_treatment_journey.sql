CREATE TYPE "public"."journey_access_decision" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."journey_item_kind" AS ENUM('milestone', 'image', 'comparison');--> statement-breakpoint
CREATE TABLE "patient_journey_access" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"decision" "journey_access_decision" NOT NULL,
	"account_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_journey_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" "journey_item_kind" NOT NULL,
	"clinical_file_id" uuid,
	"comparison_id" uuid,
	"treatment_plan_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"event_date" date NOT NULL,
	"shared_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	"withdraw_reason" text,
	CONSTRAINT "patient_journey_items_kind_target" CHECK (("patient_journey_items"."kind" = 'image' and "patient_journey_items"."clinical_file_id" is not null and "patient_journey_items"."comparison_id" is null)
        or ("patient_journey_items"."kind" = 'comparison' and "patient_journey_items"."comparison_id" is not null and "patient_journey_items"."clinical_file_id" is null)
        or ("patient_journey_items"."kind" = 'milestone' and "patient_journey_items"."clinical_file_id" is null and "patient_journey_items"."comparison_id" is null)),
	CONSTRAINT "patient_journey_items_text" CHECK (length(trim("patient_journey_items"."title")) between 1 and 160 and ("patient_journey_items"."body" is null or length("patient_journey_items"."body") <= 2000)),
	CONSTRAINT "patient_journey_items_withdrawal" CHECK (("patient_journey_items"."withdrawn_at" is null and "patient_journey_items"."withdrawn_by_user_id" is null and "patient_journey_items"."withdraw_reason" is null)
        or ("patient_journey_items"."withdrawn_at" is not null and "patient_journey_items"."withdrawn_by_user_id" is not null and length(trim("patient_journey_items"."withdraw_reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "patient_journey_access" ADD CONSTRAINT "patient_journey_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_journey_access" ADD CONSTRAINT "patient_journey_access_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_journey_items" ADD CONSTRAINT "patient_journey_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_journey_items" ADD CONSTRAINT "patient_journey_items_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_journey_items" ADD CONSTRAINT "patient_journey_items_clinical_file_id_clinical_files_id_fk" FOREIGN KEY ("clinical_file_id") REFERENCES "public"."clinical_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_journey_items" ADD CONSTRAINT "patient_journey_items_comparison_id_clinical_file_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."clinical_file_comparisons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_journey_items" ADD CONSTRAINT "patient_journey_items_treatment_plan_id_treatment_plans_id_fk" FOREIGN KEY ("treatment_plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_journey_items" ADD CONSTRAINT "patient_journey_items_shared_by_user_id_users_id_fk" FOREIGN KEY ("shared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_journey_items" ADD CONSTRAINT "patient_journey_items_withdrawn_by_user_id_users_id_fk" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_journey_access_patient_idx" ON "patient_journey_access" USING btree ("organization_id","patient_id","decided_at");--> statement-breakpoint
CREATE INDEX "patient_journey_items_patient_idx" ON "patient_journey_items" USING btree ("organization_id","patient_id","event_date");--> statement-breakpoint
-- A shared photo, pair or plan must be the same patient's (foreign keys alone do not check the patient).
CREATE OR REPLACE FUNCTION app_private.guard_journey_item() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.clinical_file_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.clinical_files f
       WHERE f.id = NEW.clinical_file_id AND f.patient_id = NEW.patient_id AND f.organization_id = NEW.organization_id AND f.kind = 'image') THEN
      RAISE EXCEPTION 'journey: the photo must be an image of the same patient';
    END IF;
    IF NEW.comparison_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.clinical_file_comparisons c
       WHERE c.id = NEW.comparison_id AND c.patient_id = NEW.patient_id AND c.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'journey: the before/after pair must be the same patient''s';
    END IF;
    IF NEW.treatment_plan_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.treatment_plans p
       WHERE p.id = NEW.treatment_plan_id AND p.patient_id = NEW.patient_id AND p.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'journey: the treatment plan must be the same patient''s';
    END IF;
    IF NEW.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'journey: an item is shared before it can be withdrawn';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: an item is never edited; it can only be withdrawn, once.
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'journey: a withdrawn item stays withdrawn';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['withdrawn_at', 'withdrawn_by_user_id', 'withdraw_reason'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['withdrawn_at', 'withdrawn_by_user_id', 'withdraw_reason']) THEN
    RAISE EXCEPTION 'journey: a shared item is not edited; withdraw it and share a new one';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patient_journey_items_guard BEFORE INSERT OR UPDATE ON public.patient_journey_items
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_journey_item();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings', 'clinical_note_versions',
    'questionnaire_responses', 'health_history_reviews', 'inventory_lots', 'inventory_movements',
    'inventory_purchase_order_lines', 'audit_events', 'clinical_files', 'clinical_file_comparisons',
    'patient_contacts', 'payment_schedules', 'payment_schedule_installments', 'payment_installment_receipts',
    'patient_imports', 'sync_changes', 'provider_service_term_history', 'honorarium_entries',
    'honorarium_payments', 'honorarium_period_closures', 'record_changes', 'patient_journey_access'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.no_delete_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'payments', 'cash_sessions', 'expenses', 'appointments', 'booking_requests',
    'treatment_plans', 'clinical_notes', 'questionnaire_versions', 'inventory_items',
    'inventory_purchase_orders', 'inventory_item_identifiers', 'procedure_consumptions',
    'sterilizers', 'instrument_sets', 'sterilization_cycles', 'sterilization_packs', 'sterilization_pack_uses',
    'questionnaire_tablet_sessions', 'sync_nodes', 'provider_service_terms', 'patient_journey_items'
  ]::text[] $$;
--> statement-breakpoint
-- Clinicians share; existing clinics' built-in roles get the key like new clinics (src/server/authz/permissions.ts).
UPDATE public.roles SET permissions = permissions || ARRAY['patient.journey.manage']::text[]
 WHERE key IN ('owner', 'dentist', 'hygienist') AND is_system AND NOT ('patient.journey.manage' = ANY(permissions));
--> statement-breakpoint
SELECT app_private.apply_security();
