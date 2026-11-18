CREATE TYPE "public"."sterilization_cycle_status" AS ENUM('pending_release', 'released', 'failed', 'recalled');--> statement-breakpoint
CREATE TYPE "public"."sterilization_indicator_result" AS ENUM('not_used', 'pending', 'pass', 'fail');--> statement-breakpoint
CREATE TABLE "instrument_sets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contents" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sterilization_cycles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sterilizer_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"program" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"temperature_c" numeric(5, 1),
	"pressure_bar" numeric(5, 2),
	"hold_minutes" numeric(5, 1),
	"chemical_indicator" "sterilization_indicator_result" NOT NULL,
	"air_removal_test" "sterilization_indicator_result" NOT NULL,
	"biological_indicator" "sterilization_indicator_result" NOT NULL,
	"notes" text,
	"status" "sterilization_cycle_status" DEFAULT 'pending_release' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"recalled_by_user_id" uuid,
	"recalled_at" timestamp with time zone,
	"recall_reason" text,
	"biological_recorded_by_user_id" uuid,
	"biological_recorded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sterilization_pack_uses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"performed_procedure_id" uuid,
	"used_on" date NOT NULL,
	"used_by_user_id" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sterilization_packs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"instrument_set_id" uuid,
	"code" text NOT NULL,
	"label" text,
	"expires_on" date,
	"discarded_at" timestamp with time zone,
	"discarded_by_user_id" uuid,
	"discard_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sterilizers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"serial_number" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instrument_sets" ADD CONSTRAINT "instrument_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_sets" ADD CONSTRAINT "instrument_sets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_cycles" ADD CONSTRAINT "sterilization_cycles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_cycles" ADD CONSTRAINT "sterilization_cycles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_cycles" ADD CONSTRAINT "sterilization_cycles_sterilizer_id_sterilizers_id_fk" FOREIGN KEY ("sterilizer_id") REFERENCES "public"."sterilizers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_cycles" ADD CONSTRAINT "sterilization_cycles_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_cycles" ADD CONSTRAINT "sterilization_cycles_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_cycles" ADD CONSTRAINT "sterilization_cycles_recalled_by_user_id_users_id_fk" FOREIGN KEY ("recalled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_cycles" ADD CONSTRAINT "sterilization_cycles_biological_recorded_by_user_id_users_id_fk" FOREIGN KEY ("biological_recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_pack_uses" ADD CONSTRAINT "sterilization_pack_uses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_pack_uses" ADD CONSTRAINT "sterilization_pack_uses_pack_id_sterilization_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."sterilization_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_pack_uses" ADD CONSTRAINT "sterilization_pack_uses_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_pack_uses" ADD CONSTRAINT "sterilization_pack_uses_performed_procedure_id_performed_procedures_id_fk" FOREIGN KEY ("performed_procedure_id") REFERENCES "public"."performed_procedures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_pack_uses" ADD CONSTRAINT "sterilization_pack_uses_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_pack_uses" ADD CONSTRAINT "sterilization_pack_uses_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_packs" ADD CONSTRAINT "sterilization_packs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_packs" ADD CONSTRAINT "sterilization_packs_cycle_id_sterilization_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."sterilization_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_packs" ADD CONSTRAINT "sterilization_packs_instrument_set_id_instrument_sets_id_fk" FOREIGN KEY ("instrument_set_id") REFERENCES "public"."instrument_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilization_packs" ADD CONSTRAINT "sterilization_packs_discarded_by_user_id_users_id_fk" FOREIGN KEY ("discarded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilizers" ADD CONSTRAINT "sterilizers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilizers" ADD CONSTRAINT "sterilizers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sterilizers" ADD CONSTRAINT "sterilizers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_sets_org_code_uq" ON "instrument_sets" USING btree ("organization_id",upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "sterilization_cycles_reference_uq" ON "sterilization_cycles" USING btree ("organization_id","sterilizer_id",lower("reference"));--> statement-breakpoint
CREATE INDEX "sterilization_cycles_recent_idx" ON "sterilization_cycles" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sterilization_pack_uses_active_uq" ON "sterilization_pack_uses" USING btree ("pack_id") WHERE "sterilization_pack_uses"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "sterilization_pack_uses_patient_idx" ON "sterilization_pack_uses" USING btree ("organization_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sterilization_packs_org_code_uq" ON "sterilization_packs" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "sterilization_packs_cycle_idx" ON "sterilization_packs" USING btree ("organization_id","cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sterilizers_org_name_uq" ON "sterilizers" USING btree ("organization_id",lower("name"));