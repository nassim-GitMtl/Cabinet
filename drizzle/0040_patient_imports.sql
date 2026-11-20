CREATE TABLE "patient_imports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"total_rows" integer NOT NULL,
	"imported_count" integer NOT NULL,
	"skipped_duplicates" integer NOT NULL,
	"skipped_invalid" integer NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "legacy_number" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "patient_imports" ADD CONSTRAINT "patient_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_imports" ADD CONSTRAINT "patient_imports_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_imports_org_idx" ON "patient_imports" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_import_id_patient_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."patient_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patients_legacy_number_idx" ON "patients" USING btree ("organization_id","legacy_number");--> statement-breakpoint
-- Import history is append-only (full list redefined; see ARCHITECTURE "Adding a table").
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings', 'clinical_note_versions',
    'questionnaire_responses', 'health_history_reviews', 'inventory_lots', 'inventory_movements',
    'inventory_purchase_order_lines', 'audit_events', 'clinical_files', 'clinical_file_comparisons',
    'patient_contacts', 'payment_schedules', 'payment_schedule_installments', 'payment_installment_receipts',
    'patient_imports'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_patient_import() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app_private.current_actor_type() <> 'staff' OR NEW.created_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'patient import: must be recorded by the staff actor';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patient_imports_guard BEFORE INSERT ON public.patient_imports
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_patient_import();
--> statement-breakpoint
-- A patient can only point to an import of the same clinic.
CREATE OR REPLACE FUNCTION app_private.guard_patient_import_link() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.import_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.patient_imports i WHERE i.id = NEW.import_id AND i.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'patients: import must belong to the same organization';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patients_import_guard BEFORE INSERT OR UPDATE OF import_id ON public.patients
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_patient_import_link();
--> statement-breakpoint
SELECT app_private.apply_security();
