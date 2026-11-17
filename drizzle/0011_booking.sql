CREATE TYPE "public"."booking_request_status" AS ENUM('submitted', 'under_review', 'awaiting_information', 'alternative_proposed', 'approved', 'declined', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TABLE "booking_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"token" text NOT NULL,
	"label" text NOT NULL,
	"appointment_type_ids" uuid[] NOT NULL,
	"provider_ids" uuid[],
	"horizon_days" integer DEFAULT 30 NOT NULL,
	"min_notice_hours" integer DEFAULT 12 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"link_id" uuid,
	"status" "booking_request_status" DEFAULT 'submitted' NOT NULL,
	"ref_hash" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_email" text,
	"declares_existing_patient" boolean DEFAULT false NOT NULL,
	"preferred_locale" text DEFAULT 'fr' NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"requested_starts_at" timestamp with time zone NOT NULL,
	"requested_ends_at" timestamp with time zone NOT NULL,
	"message" text,
	"decline_reason" text,
	"patient_id" uuid,
	"appointment_id" uuid,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"ip_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_link_id_booking_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."booking_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_appointment_type_id_appointment_types_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_provider_id_memberships_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD CONSTRAINT "booking_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_links_token_uq" ON "booking_links" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_requests_ref_uq" ON "booking_requests" USING btree ("ref_hash");--> statement-breakpoint
CREATE INDEX "booking_requests_org_status_idx" ON "booking_requests" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "booking_requests_phone_idx" ON "booking_requests" USING btree ("organization_id","contact_phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_requests_appointment_uq" ON "booking_requests" USING btree ("appointment_id") WHERE appointment_id is not null;