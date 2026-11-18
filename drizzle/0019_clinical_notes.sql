CREATE TYPE "public"."clinical_note_kind" AS ENUM('consultation', 'progress', 'procedure', 'post_op', 'referral', 'other');--> statement-breakpoint
CREATE TYPE "public"."clinical_note_status" AS ENUM('draft', 'in_review', 'signed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."clinical_note_version_kind" AS ENUM('original', 'amendment');--> statement-breakpoint
CREATE TABLE "clinical_note_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"kind" "clinical_note_version_kind" NOT NULL,
	"body" jsonb NOT NULL,
	"amendment_reason" text,
	"template_snapshot" jsonb,
	"signed_by_user_id" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" text,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"kind" "clinical_note_kind" NOT NULL,
	"service_date" date NOT NULL,
	"provider_id" uuid NOT NULL,
	"status" "clinical_note_status" DEFAULT 'draft' NOT NULL,
	"draft_body" jsonb,
	"template_id" uuid,
	"template_name" text,
	"current_version" integer DEFAULT 0 NOT NULL,
	"author_user_id" uuid NOT NULL,
	"submitted_for_review_at" timestamp with time zone,
	"signed_by_user_id" uuid,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "clinical_note_kind" DEFAULT 'progress' NOT NULL,
	"body" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_note_id_clinical_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."clinical_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_template_id_note_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."note_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_templates" ADD CONSTRAINT "note_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_versions_note_no_uq" ON "clinical_note_versions" USING btree ("note_id","version_no");--> statement-breakpoint
CREATE INDEX "note_versions_note_idx" ON "clinical_note_versions" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "clinical_notes_patient_idx" ON "clinical_notes" USING btree ("organization_id","patient_id","service_date");--> statement-breakpoint
CREATE UNIQUE INDEX "note_templates_org_name_uq" ON "note_templates" USING btree ("organization_id","name");