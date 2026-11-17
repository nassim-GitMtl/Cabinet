CREATE TYPE "public"."dental_arch" AS ENUM('maxillary', 'mandibular');--> statement-breakpoint
CREATE TYPE "public"."dental_quadrant" AS ENUM('upper_right', 'upper_left', 'lower_left', 'lower_right');--> statement-breakpoint
CREATE TYPE "public"."encounter_status" AS ENUM('open', 'completed', 'cancelled', 'entered_in_error');--> statement-breakpoint
CREATE TYPE "public"."performed_procedure_status" AS ENUM('completed', 'reversed', 'entered_in_error');--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"primary_provider_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"status" "encounter_status" DEFAULT 'completed' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performed_procedures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"service_snapshot" jsonb NOT NULL,
	"tooth_number" text,
	"surfaces" text[] DEFAULT '{}'::text[] NOT NULL,
	"arch" "dental_arch",
	"quadrant" "dental_quadrant",
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"price_override_reason" text,
	"price_override_approved_by_user_id" uuid,
	"performing_provider_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"status" "performed_procedure_status" DEFAULT 'completed' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone,
	"status_changed_by_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performed_procedures_quantity_positive" CHECK ("performed_procedures"."quantity" > 0),
	CONSTRAINT "performed_procedures_price_nonnegative" CHECK ("performed_procedures"."unit_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_favorites" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_favorites_organization_id_user_id_service_id_pk" PRIMARY KEY("organization_id","user_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_primary_provider_id_memberships_id_fk" FOREIGN KEY ("primary_provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_procedures" ADD CONSTRAINT "performed_procedures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_procedures" ADD CONSTRAINT "performed_procedures_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_procedures" ADD CONSTRAINT "performed_procedures_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_procedures" ADD CONSTRAINT "performed_procedures_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_procedures" ADD CONSTRAINT "performed_procedures_price_override_approved_by_user_id_users_id_fk" FOREIGN KEY ("price_override_approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_procedures" ADD CONSTRAINT "performed_procedures_performing_provider_id_memberships_id_fk" FOREIGN KEY ("performing_provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_procedures" ADD CONSTRAINT "performed_procedures_status_changed_by_user_id_users_id_fk" FOREIGN KEY ("status_changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performed_procedures" ADD CONSTRAINT "performed_procedures_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_favorites" ADD CONSTRAINT "service_favorites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_favorites" ADD CONSTRAINT "service_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_favorites" ADD CONSTRAINT "service_favorites_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "encounters_patient_date_idx" ON "encounters" USING btree ("organization_id","patient_id","service_date");--> statement-breakpoint
CREATE INDEX "encounters_provider_date_idx" ON "encounters" USING btree ("organization_id","primary_provider_id","service_date");--> statement-breakpoint
CREATE INDEX "performed_procedures_patient_date_idx" ON "performed_procedures" USING btree ("organization_id","patient_id","service_date");--> statement-breakpoint
CREATE INDEX "performed_procedures_encounter_idx" ON "performed_procedures" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "performed_procedures_service_idx" ON "performed_procedures" USING btree ("organization_id","service_id","created_at");--> statement-breakpoint
CREATE INDEX "service_favorites_user_idx" ON "service_favorites" USING btree ("organization_id","user_id","created_at");