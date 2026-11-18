CREATE TYPE "public"."health_history_review_outcome" AS ENUM('reviewed', 'no_changes');--> statement-breakpoint
CREATE TYPE "public"."questionnaire_response_source" AS ENUM('staff_entered', 'patient_portal', 'patient_tablet');--> statement-breakpoint
CREATE TABLE "health_history_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"outcome" "health_history_review_outcome" NOT NULL,
	"note" text,
	"appointment_id" uuid,
	"reviewed_by_user_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaire_responses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"questionnaire_version_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"source" "questionnaire_response_source" NOT NULL,
	"recorded_by_user_id" uuid,
	"patient_acknowledged" boolean DEFAULT false NOT NULL,
	"appointment_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questionnaire_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version_no" integer NOT NULL,
	"title" jsonb NOT NULL,
	"questions" jsonb NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_history_reviews" ADD CONSTRAINT "health_history_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_history_reviews" ADD CONSTRAINT "health_history_reviews_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_history_reviews" ADD CONSTRAINT "health_history_reviews_response_id_questionnaire_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."questionnaire_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_history_reviews" ADD CONSTRAINT "health_history_reviews_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_history_reviews" ADD CONSTRAINT "health_history_reviews_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_questionnaire_version_id_questionnaire_versions_id_fk" FOREIGN KEY ("questionnaire_version_id") REFERENCES "public"."questionnaire_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_versions" ADD CONSTRAINT "questionnaire_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_versions" ADD CONSTRAINT "questionnaire_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_reviews_patient_idx" ON "health_history_reviews" USING btree ("organization_id","patient_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "questionnaire_responses_patient_idx" ON "questionnaire_responses" USING btree ("organization_id","patient_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_versions_key_no_uq" ON "questionnaire_versions" USING btree ("organization_id","key","version_no");