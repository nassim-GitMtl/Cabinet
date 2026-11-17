CREATE TYPE "public"."confirmation_status" AS ENUM('pending', 'confirmed', 'declined', 'reschedule_requested');--> statement-breakpoint
CREATE TYPE "public"."scheduling_status" AS ENUM('requested', 'booked', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."time_off_kind" AS ENUM('leave', 'holiday', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('not_arrived', 'arrived', 'waiting', 'in_treatment', 'completed');--> statement-breakpoint
CREATE TABLE "appointment_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"default_duration_min" integer DEFAULT 30 NOT NULL,
	"color" text DEFAULT 'teal' NOT NULL,
	"is_bookable_online" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"chair_id" uuid,
	"appointment_type_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"scheduling_status" "scheduling_status" DEFAULT 'booked' NOT NULL,
	"confirmation_status" "confirmation_status" DEFAULT 'pending' NOT NULL,
	"visit_status" "visit_status" DEFAULT 'not_arrived' NOT NULL,
	"notes" text,
	"cancellation_reason" text,
	"cancelled_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"treatment_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"outside_hours_override" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "appointments_order" CHECK ("appointments"."ends_at" > "appointments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "chairs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_id" uuid,
	"kind" time_off_kind NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_order" CHECK ("time_off"."ends_at" > "time_off"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "working_hours_weekday_valid" CHECK ("working_hours"."weekday" between 1 and 7),
	CONSTRAINT "working_hours_order" CHECK ("working_hours"."end_time" > "working_hours"."start_time")
);
--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_chair_id_chairs_id_fk" FOREIGN KEY ("chair_id") REFERENCES "public"."chairs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_appointment_type_id_appointment_types_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chairs" ADD CONSTRAINT "chairs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chairs" ADD CONSTRAINT "chairs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_types_org_code_uq" ON "appointment_types" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "appointments_org_start_idx" ON "appointments" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_idx" ON "appointments" USING btree ("organization_id","patient_id","starts_at");--> statement-breakpoint
CREATE INDEX "time_off_range_idx" ON "time_off" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "working_hours_provider_idx" ON "working_hours" USING btree ("organization_id","provider_id","weekday");