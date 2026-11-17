CREATE TYPE "public"."treatment_decision" AS ENUM('accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."treatment_decision_method" AS ENUM('signed_in_clinic', 'verbal', 'other');--> statement-breakpoint
CREATE TYPE "public"."treatment_plan_status" AS ENUM('draft', 'proposed', 'accepted', 'declined', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "treatment_plan_conversions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"performed_procedure_id" uuid NOT NULL,
	"converted_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"decision" "treatment_decision" NOT NULL,
	"method" "treatment_decision_method" NOT NULL,
	"note" text,
	"decided_at" timestamp with time zone NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"service_snapshot" jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"tooth_number" text,
	"surfaces" text[] DEFAULT '{}'::text[] NOT NULL,
	"arch" "dental_arch",
	"quadrant" "dental_quadrant",
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plan_items_quantity_positive" CHECK ("treatment_plan_items"."quantity" > 0),
	CONSTRAINT "treatment_plan_items_price_nonnegative" CHECK ("treatment_plan_items"."unit_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plan_versions_number_positive" CHECK ("treatment_plan_versions"."version_number" > 0),
	CONSTRAINT "treatment_plan_versions_total_nonnegative" CHECK ("treatment_plan_versions"."total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" "treatment_plan_status" DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "treatment_plans_current_version_positive" CHECK ("treatment_plans"."current_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "treatment_plan_conversions" ADD CONSTRAINT "treatment_plan_conversions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_conversions" ADD CONSTRAINT "treatment_plan_conversions_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_conversions" ADD CONSTRAINT "treatment_plan_conversions_version_id_treatment_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."treatment_plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_conversions" ADD CONSTRAINT "treatment_plan_conversions_item_id_treatment_plan_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."treatment_plan_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_conversions" ADD CONSTRAINT "treatment_plan_conversions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_conversions" ADD CONSTRAINT "treatment_plan_conversions_performed_procedure_id_performed_procedures_id_fk" FOREIGN KEY ("performed_procedure_id") REFERENCES "public"."performed_procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_conversions" ADD CONSTRAINT "treatment_plan_conversions_converted_by_user_id_users_id_fk" FOREIGN KEY ("converted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_decisions" ADD CONSTRAINT "treatment_plan_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_decisions" ADD CONSTRAINT "treatment_plan_decisions_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_decisions" ADD CONSTRAINT "treatment_plan_decisions_version_id_treatment_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."treatment_plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_decisions" ADD CONSTRAINT "treatment_plan_decisions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_decisions" ADD CONSTRAINT "treatment_plan_decisions_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_version_id_treatment_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."treatment_plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_versions" ADD CONSTRAINT "treatment_plan_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_versions" ADD CONSTRAINT "treatment_plan_versions_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_versions" ADD CONSTRAINT "treatment_plan_versions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_versions" ADD CONSTRAINT "treatment_plan_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_conversions_item_uq" ON "treatment_plan_conversions" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_conversions_procedure_uq" ON "treatment_plan_conversions" USING btree ("performed_procedure_id");--> statement-breakpoint
CREATE INDEX "treatment_plan_conversions_patient_idx" ON "treatment_plan_conversions" USING btree ("organization_id","patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_decisions_version_uq" ON "treatment_plan_decisions" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "treatment_plan_decisions_patient_idx" ON "treatment_plan_decisions" USING btree ("organization_id","patient_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_items_version_order_uq" ON "treatment_plan_items" USING btree ("version_id","sort_order");--> statement-breakpoint
CREATE INDEX "treatment_plan_items_version_idx" ON "treatment_plan_items" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_versions_plan_number_uq" ON "treatment_plan_versions" USING btree ("plan_id","version_number");--> statement-breakpoint
CREATE INDEX "treatment_plan_versions_patient_idx" ON "treatment_plan_versions" USING btree ("organization_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "treatment_plans_patient_idx" ON "treatment_plans" USING btree ("organization_id","patient_id","updated_at");
--> statement-breakpoint
-- Estimate versions, their line snapshots, patient decisions and procedure links
-- are permanent records. Revisions are new versions, never edits.
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions'
  ]::text[] $$;
--> statement-breakpoint
SELECT app_private.apply_security();
--> statement-breakpoint
REVOKE DELETE ON public.treatment_plans FROM cabinet_app;
--> statement-breakpoint
-- Existing system roles receive the same keys as newly provisioned role templates.
UPDATE public.roles SET permissions = permissions || ARRAY[
  'treatment_plan.read', 'treatment_plan.manage', 'treatment_plan.accept', 'treatment_plan.convert'
]::text[]
 WHERE key = 'owner' AND is_system;
UPDATE public.roles SET permissions = permissions || ARRAY[
  'treatment_plan.read', 'treatment_plan.manage', 'treatment_plan.accept', 'treatment_plan.convert'
]::text[]
 WHERE key = 'dentist' AND is_system;
UPDATE public.roles SET permissions = permissions || ARRAY['treatment_plan.read', 'treatment_plan.convert']::text[]
 WHERE key IN ('hygienist', 'assistant') AND is_system;
UPDATE public.roles SET permissions = permissions || ARRAY['treatment_plan.read', 'treatment_plan.accept']::text[]
 WHERE key = 'receptionist' AND is_system;
