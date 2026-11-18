CREATE TYPE "public"."odontogram_finding_kind" AS ENUM('caries', 'existing_filling', 'crown', 'bridge', 'missing', 'implant', 'root_canal', 'fracture', 'mobility', 'other');--> statement-breakpoint
CREATE TYPE "public"."odontogram_finding_status" AS ENUM('active', 'resolved', 'entered_in_error');--> statement-breakpoint
CREATE TABLE "odontogram_findings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tooth_number" text NOT NULL,
	"surfaces" text[] DEFAULT '{}'::text[] NOT NULL,
	"kind" "odontogram_finding_kind" NOT NULL,
	"status" "odontogram_finding_status" DEFAULT 'active' NOT NULL,
	"note" text,
	"observed_on" date NOT NULL,
	"provider_id" uuid NOT NULL,
	"treatment_plan_item_id" uuid,
	"performed_procedure_id" uuid,
	"supersedes_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "odontogram_findings_fdi_valid" CHECK (
    "odontogram_findings"."tooth_number" ~ '^[1-8][1-8]$' and (
      (substring("odontogram_findings"."tooth_number", 1, 1)::int <= 4 and substring("odontogram_findings"."tooth_number", 2, 1)::int <= 8)
      or (substring("odontogram_findings"."tooth_number", 1, 1)::int >= 5 and substring("odontogram_findings"."tooth_number", 2, 1)::int <= 5)
    )),
	CONSTRAINT "odontogram_findings_surfaces_valid" CHECK ("odontogram_findings"."surfaces" <@ ARRAY['mesial','distal','occlusal','buccal','lingual','palatal','incisal']::text[])
);
--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_treatment_plan_item_id_treatment_plan_items_id_fk" FOREIGN KEY ("treatment_plan_item_id") REFERENCES "public"."treatment_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_performed_procedure_id_performed_procedures_id_fk" FOREIGN KEY ("performed_procedure_id") REFERENCES "public"."performed_procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_supersedes_id_odontogram_findings_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."odontogram_findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odontogram_findings" ADD CONSTRAINT "odontogram_findings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "odontogram_findings_patient_idx" ON "odontogram_findings" USING btree ("organization_id","patient_id","tooth_number","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "odontogram_findings_supersedes_uq" ON "odontogram_findings" USING btree ("supersedes_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.validate_odontogram_finding()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE prior public.odontogram_findings%ROWTYPE;
BEGIN
  IF NEW.supersedes_id IS NULL THEN
    IF NEW.status <> 'active' THEN RAISE EXCEPTION 'initial finding must be active'; END IF;
  ELSE
    SELECT f.* INTO prior FROM public.odontogram_findings f
     WHERE f.id = NEW.supersedes_id
       AND f.organization_id = NEW.organization_id AND f.patient_id = NEW.patient_id
       AND f.status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'superseded finding unavailable'; END IF;
    IF NEW.status NOT IN ('resolved', 'entered_in_error')
       OR NEW.tooth_number <> prior.tooth_number OR NEW.surfaces <> prior.surfaces
       OR NEW.kind <> prior.kind OR NEW.provider_id <> prior.provider_id
       OR NEW.treatment_plan_item_id IS DISTINCT FROM prior.treatment_plan_item_id
       OR NEW.performed_procedure_id IS DISTINCT FROM prior.performed_procedure_id
    THEN RAISE EXCEPTION 'superseding event may only change status and note'; END IF;
  END IF;
  IF NEW.treatment_plan_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.treatment_plan_items i
     WHERE i.id = NEW.treatment_plan_item_id
       AND i.organization_id = NEW.organization_id AND i.patient_id = NEW.patient_id
       AND i.tooth_number = NEW.tooth_number
  ) THEN RAISE EXCEPTION 'treatment item does not match finding'; END IF;
  IF NEW.performed_procedure_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.performed_procedures p
     WHERE p.id = NEW.performed_procedure_id
       AND p.organization_id = NEW.organization_id AND p.patient_id = NEW.patient_id
       AND p.tooth_number = NEW.tooth_number
  ) THEN RAISE EXCEPTION 'performed procedure does not match finding'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER odontogram_finding_validate BEFORE INSERT ON public.odontogram_findings
FOR EACH ROW EXECUTE FUNCTION app_private.validate_odontogram_finding();--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings'
  ]::text[] $$;--> statement-breakpoint
SELECT app_private.apply_security();
