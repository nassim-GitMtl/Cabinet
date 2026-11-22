CREATE TYPE "public"."fee_rule_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."honorarium_entry_kind" AS ENUM('earned', 'backfill', 'adjustment');--> statement-breakpoint
CREATE TABLE "honorarium_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"provider_snapshot" jsonb NOT NULL,
	"service_snapshot" jsonb NOT NULL,
	"kind" "honorarium_entry_kind" NOT NULL,
	"adjusts_entry_id" uuid,
	"effective_date" date NOT NULL,
	"currency" text NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"discount_minor" bigint NOT NULL,
	"lab_fee_minor" bigint NOT NULL,
	"deduct_lab_before_share" boolean DEFAULT false NOT NULL,
	"base_minor" bigint NOT NULL,
	"line_amount_minor" bigint NOT NULL,
	"rule_type" "fee_rule_type" NOT NULL,
	"rule_value" integer NOT NULL,
	"physician_share_minor" bigint NOT NULL,
	"clinic_share_minor" bigint NOT NULL,
	"reason" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "honorarium_entries_quantity_positive" CHECK ("honorarium_entries"."quantity" > 0),
	CONSTRAINT "honorarium_entries_base_nonnegative" CHECK ("honorarium_entries"."kind" = 'adjustment' or ("honorarium_entries"."base_minor" >= 0 and "honorarium_entries"."physician_share_minor" >= 0 and "honorarium_entries"."clinic_share_minor" >= 0)),
	CONSTRAINT "honorarium_entries_balanced" CHECK ("honorarium_entries"."physician_share_minor" + "honorarium_entries"."clinic_share_minor" = "honorarium_entries"."line_amount_minor"),
	CONSTRAINT "honorarium_entries_adjustment_link" CHECK (("honorarium_entries"."kind" = 'adjustment') = ("honorarium_entries"."adjusts_entry_id" is not null) and ("honorarium_entries"."kind" <> 'adjustment' or length(trim("honorarium_entries"."reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "honorarium_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"note" text,
	"reverses_payment_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "honorarium_payments_amount_valid" CHECK (("honorarium_payments"."reverses_payment_id" is null and "honorarium_payments"."amount_minor" > 0) or ("honorarium_payments"."reverses_payment_id" is not null and "honorarium_payments"."amount_minor" < 0 and length(trim("honorarium_payments"."note")) > 0))
);
--> statement-breakpoint
CREATE TABLE "honorarium_period_closures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by_user_id" uuid NOT NULL,
	"note" text,
	CONSTRAINT "honorarium_period_closures_month_start" CHECK (extract(day from "honorarium_period_closures"."period_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "provider_service_term_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"price_minor" bigint,
	"rule_type" "fee_rule_type" NOT NULL,
	"rule_value" integer NOT NULL,
	"reason" text NOT NULL,
	"changed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_service_terms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"price_minor" bigint,
	"rule_type" "fee_rule_type" NOT NULL,
	"rule_value" integer NOT NULL,
	"changed_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "provider_service_terms_value_valid" CHECK (("provider_service_terms"."rule_type" = 'percent' and "provider_service_terms"."rule_value" between 0 and 10000) or ("provider_service_terms"."rule_type" = 'fixed' and "provider_service_terms"."rule_value" >= 0)),
	CONSTRAINT "provider_service_terms_price_valid" CHECK ("provider_service_terms"."price_minor" is null or "provider_service_terms"."price_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "specialty" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "default_fee_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "deduct_lab_before_share" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "lab_fee_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "honorarium_rule_type" text;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "honorarium_rule_value" integer;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "honorarium_override_reason" text;--> statement-breakpoint
ALTER TABLE "honorarium_entries" ADD CONSTRAINT "honorarium_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_entries" ADD CONSTRAINT "honorarium_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_entries" ADD CONSTRAINT "honorarium_entries_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_entries" ADD CONSTRAINT "honorarium_entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_entries" ADD CONSTRAINT "honorarium_entries_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_entries" ADD CONSTRAINT "honorarium_entries_adjusts_entry_id_honorarium_entries_id_fk" FOREIGN KEY ("adjusts_entry_id") REFERENCES "public"."honorarium_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_entries" ADD CONSTRAINT "honorarium_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_payments" ADD CONSTRAINT "honorarium_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_payments" ADD CONSTRAINT "honorarium_payments_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_payments" ADD CONSTRAINT "honorarium_payments_reverses_payment_id_honorarium_payments_id_fk" FOREIGN KEY ("reverses_payment_id") REFERENCES "public"."honorarium_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_payments" ADD CONSTRAINT "honorarium_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_period_closures" ADD CONSTRAINT "honorarium_period_closures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_period_closures" ADD CONSTRAINT "honorarium_period_closures_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_period_closures" ADD CONSTRAINT "honorarium_period_closures_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_term_history" ADD CONSTRAINT "provider_service_term_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_term_history" ADD CONSTRAINT "provider_service_term_history_term_id_provider_service_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."provider_service_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_term_history" ADD CONSTRAINT "provider_service_term_history_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_term_history" ADD CONSTRAINT "provider_service_term_history_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_term_history" ADD CONSTRAINT "provider_service_term_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_terms" ADD CONSTRAINT "provider_service_terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_terms" ADD CONSTRAINT "provider_service_terms_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_terms" ADD CONSTRAINT "provider_service_terms_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_terms" ADD CONSTRAINT "provider_service_terms_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "honorarium_entries_provider_date_idx" ON "honorarium_entries" USING btree ("organization_id","provider_id","effective_date");--> statement-breakpoint
CREATE INDEX "honorarium_entries_invoice_idx" ON "honorarium_entries" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "honorarium_entries_base_line_uq" ON "honorarium_entries" USING btree ("invoice_line_id") WHERE kind in ('earned', 'backfill');--> statement-breakpoint
CREATE INDEX "honorarium_payments_provider_date_idx" ON "honorarium_payments" USING btree ("organization_id","provider_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "honorarium_payments_reversal_uq" ON "honorarium_payments" USING btree ("reverses_payment_id") WHERE reverses_payment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "honorarium_period_closures_uq" ON "honorarium_period_closures" USING btree ("organization_id","provider_id","period_month");--> statement-breakpoint
CREATE INDEX "provider_service_term_history_term_idx" ON "provider_service_term_history" USING btree ("term_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_service_terms_pair_uq" ON "provider_service_terms" USING btree ("organization_id","provider_id","service_id");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_default_fee_rate_valid" CHECK ("memberships"."default_fee_rate_bp" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_lab_fee_valid" CHECK ("invoice_lines"."lab_fee_minor" >= 0 and "invoice_lines"."lab_fee_minor" <= "invoice_lines"."quantity" * "invoice_lines"."unit_price_minor" - "invoice_lines"."discount_minor");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_honorarium_override_valid" CHECK (("invoice_lines"."honorarium_rule_type" is null and "invoice_lines"."honorarium_rule_value" is null and "invoice_lines"."honorarium_override_reason" is null)
        or ("invoice_lines"."honorarium_rule_type" = 'percent' and "invoice_lines"."honorarium_rule_value" between 0 and 10000 and length(trim("invoice_lines"."honorarium_override_reason")) > 0)
        or ("invoice_lines"."honorarium_rule_type" = 'fixed' and "invoice_lines"."honorarium_rule_value" >= 0 and length(trim("invoice_lines"."honorarium_override_reason")) > 0));--> statement-breakpoint
-- Ledgers are append-only (corrections are new rows); a practitioner/service rule is changed, never deleted.
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
    'honorarium_payments', 'honorarium_period_closures'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.no_delete_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'payments', 'cash_sessions', 'expenses', 'appointments', 'booking_requests',
    'treatment_plans', 'clinical_notes', 'questionnaire_versions', 'inventory_items',
    'inventory_purchase_orders', 'inventory_item_identifiers', 'procedure_consumptions',
    'sterilizers', 'instrument_sets', 'sterilization_cycles', 'sterilization_packs', 'sterilization_pack_uses',
    'questionnaire_tablet_sessions', 'sync_nodes', 'provider_service_terms'
  ]::text[] $$;
--> statement-breakpoint
-- Existing clinics: give the built-in roles the new keys, as new clinics get them (src/server/authz/permissions.ts).
UPDATE public.roles SET permissions = permissions || ARRAY['honorarium.read.own', 'honorarium.read.all', 'honorarium.manage', 'honorarium.pay', 'honorarium.close']::text[]
 WHERE key = 'owner' AND is_system AND NOT ('honorarium.manage' = ANY(permissions));
--> statement-breakpoint
UPDATE public.roles SET permissions = permissions || ARRAY['honorarium.read.own']::text[]
 WHERE key = 'dentist' AND is_system AND NOT ('honorarium.read.own' = ANY(permissions));
--> statement-breakpoint
UPDATE public.roles SET permissions = permissions || ARRAY['honorarium.read.all', 'honorarium.pay', 'honorarium.close']::text[]
 WHERE key = 'accountant' AND is_system AND NOT ('honorarium.read.all' = ANY(permissions));
--> statement-breakpoint
SELECT app_private.apply_security();
