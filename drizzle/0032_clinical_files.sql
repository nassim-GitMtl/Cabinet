CREATE TYPE "public"."clinical_file_category" AS ENUM('intraoral_photo', 'extraoral_photo', 'radiograph', 'scan', 'referral', 'prescription', 'lab_report', 'consent', 'other');--> statement-breakpoint
CREATE TYPE "public"."clinical_file_kind" AS ENUM('image', 'document');--> statement-breakpoint
CREATE TABLE "clinical_file_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"before_file_id" uuid NOT NULL,
	"after_file_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_file_comparisons_distinct" CHECK ("clinical_file_comparisons"."before_file_id" <> "clinical_file_comparisons"."after_file_id")
);
--> statement-breakpoint
CREATE TABLE "clinical_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" "clinical_file_kind" NOT NULL,
	"category" "clinical_file_category" NOT NULL,
	"title" text,
	"clinical_date" date NOT NULL,
	"tooth_numbers" text[] DEFAULT '{}'::text[] NOT NULL,
	"mime_type" text NOT NULL,
	"original_filename" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_files_size_positive" CHECK ("clinical_files"."byte_size" > 0),
	CONSTRAINT "clinical_files_sha256_format" CHECK ("clinical_files"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "clinical_file_comparisons" ADD CONSTRAINT "clinical_file_comparisons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_file_comparisons" ADD CONSTRAINT "clinical_file_comparisons_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_file_comparisons" ADD CONSTRAINT "clinical_file_comparisons_before_file_id_clinical_files_id_fk" FOREIGN KEY ("before_file_id") REFERENCES "public"."clinical_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_file_comparisons" ADD CONSTRAINT "clinical_file_comparisons_after_file_id_clinical_files_id_fk" FOREIGN KEY ("after_file_id") REFERENCES "public"."clinical_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_file_comparisons" ADD CONSTRAINT "clinical_file_comparisons_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_files" ADD CONSTRAINT "clinical_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_files" ADD CONSTRAINT "clinical_files_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_files" ADD CONSTRAINT "clinical_files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_file_comparisons_before_uq" ON "clinical_file_comparisons" USING btree ("before_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_file_comparisons_after_uq" ON "clinical_file_comparisons" USING btree ("after_file_id");--> statement-breakpoint
CREATE INDEX "clinical_file_comparisons_patient_idx" ON "clinical_file_comparisons" USING btree ("organization_id","patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_files_storage_key_uq" ON "clinical_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "clinical_files_patient_date_idx" ON "clinical_files" USING btree ("organization_id","patient_id","clinical_date","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings', 'clinical_note_versions',
    'questionnaire_responses', 'health_history_reviews', 'inventory_lots', 'inventory_movements',
    'inventory_purchase_order_lines', 'audit_events', 'clinical_files', 'clinical_file_comparisons'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_clinical_file() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app_private.current_actor_type() <> 'staff' OR NEW.uploaded_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'clinical files: upload must match the staff actor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = NEW.patient_id AND p.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'clinical files: patient must belong to the same organization';
  END IF;
  IF (NEW.kind = 'image' AND NEW.mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp'))
     OR (NEW.kind = 'document' AND NEW.mime_type NOT IN ('application/pdf', 'application/dicom')) THEN
    RAISE EXCEPTION 'clinical files: file kind does not match its verified media type';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.tooth_numbers) AS tooth(value)
              WHERE value !~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$') THEN
    RAISE EXCEPTION 'clinical files: invalid FDI tooth number';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinical_files_guard BEFORE INSERT ON public.clinical_files
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_clinical_file();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_clinical_file_comparison() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  before_row public.clinical_files%ROWTYPE;
  after_row public.clinical_files%ROWTYPE;
BEGIN
  IF app_private.current_actor_type() <> 'staff' OR NEW.created_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'clinical files: comparison must match the staff actor';
  END IF;
  SELECT * INTO before_row FROM public.clinical_files WHERE id = NEW.before_file_id;
  SELECT * INTO after_row FROM public.clinical_files WHERE id = NEW.after_file_id;
  IF before_row.id IS NULL OR after_row.id IS NULL
     OR before_row.organization_id <> NEW.organization_id OR after_row.organization_id <> NEW.organization_id
     OR before_row.patient_id <> NEW.patient_id OR after_row.patient_id <> NEW.patient_id
     OR before_row.kind <> 'image' OR after_row.kind <> 'image' THEN
    RAISE EXCEPTION 'clinical files: comparison images must belong to the same patient and organization';
  END IF;
  IF after_row.clinical_date < before_row.clinical_date THEN
    RAISE EXCEPTION 'clinical files: after image cannot predate before image';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinical_file_comparisons_guard BEFORE INSERT ON public.clinical_file_comparisons
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_clinical_file_comparison();
--> statement-breakpoint
SELECT app_private.apply_security();
