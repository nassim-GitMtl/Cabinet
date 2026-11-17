CREATE TYPE "public"."actor_type" AS ENUM('staff', 'patient', 'system', 'platform');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."organization_kind" AS ENUM('solo', 'group', 'specialist', 'pediatric', 'multi_branch');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('onboarding', 'active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('none', 'operator');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."alert_kind" AS ENUM('medical', 'allergy', 'medication', 'administrative');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."birth_date_precision" AS ENUM('exact', 'year', 'estimated');--> statement-breakpoint
CREATE TYPE "public"."identity_link_method" AS ENUM('patient_account_claim', 'patient_qr', 'assisted_in_person');--> statement-breakpoint
CREATE TYPE "public"."identity_link_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."network_patient_status" AS ENUM('active', 'merged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."patient_sex" AS ENUM('female', 'male', 'other', 'undisclosed');--> statement-breakpoint
CREATE TYPE "public"."patient_status" AS ENUM('active', 'inactive', 'archived', 'deceased');--> statement-breakpoint
CREATE TYPE "public"."consent_approver_type" AS ENUM('patient', 'legal_representative');--> statement-breakpoint
CREATE TYPE "public"."consent_grant_status" AS ENUM('active', 'expired', 'revoked', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."consent_request_status" AS ENUM('requested', 'awaiting_patient', 'approved', 'declined', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."anatomy_requirement" AS ENUM('none', 'tooth', 'surface', 'arch', 'quadrant');--> statement-breakpoint
CREATE TYPE "public"."pricing_unit" AS ENUM('procedure', 'tooth', 'surface', 'arch', 'quadrant', 'session', 'item');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"patient_id" uuid,
	"ip_address" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"timezone" text DEFAULT 'Africa/Algiers' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "counters_organization_id_scope_pk" PRIMARY KEY("organization_id","scope")
);
--> statement-breakpoint
CREATE TABLE "legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"address" text,
	"currency" text DEFAULT 'DZD' NOT NULL,
	"invoice_prefix" text DEFAULT 'F' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"is_provider" boolean DEFAULT false NOT NULL,
	"branch_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"kind" "organization_kind" DEFAULT 'solo' NOT NULL,
	"status" "organization_status" DEFAULT 'onboarding' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"country_code" text DEFAULT 'DZ' NOT NULL,
	"default_locale" text DEFAULT 'fr' NOT NULL,
	"default_currency" text DEFAULT 'DZD' NOT NULL,
	"timezone" text DEFAULT 'Africa/Algiers' NOT NULL,
	"enabled_modules" text[] DEFAULT '{}'::text[] NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"locale" text DEFAULT 'fr' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"platform_role" "platform_role" DEFAULT 'none' NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_patients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"status" "network_patient_status" DEFAULT 'active' NOT NULL,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"severity" "alert_severity" DEFAULT 'warning' NOT NULL,
	"label" text NOT NULL,
	"details" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "patient_identity_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"network_patient_id" uuid NOT NULL,
	"method" "identity_link_method" NOT NULL,
	"evidence_ref" text,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "identity_link_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_relationships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"related_patient_id" uuid,
	"contact_name" text,
	"contact_phone" text,
	"relationship" text NOT NULL,
	"is_legal_representative" boolean DEFAULT false NOT NULL,
	"authority_evidence" text,
	"is_responsible_payer" boolean DEFAULT false NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_number" text NOT NULL,
	"network_patient_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"first_name_ar" text,
	"last_name_ar" text,
	"sex" "patient_sex",
	"birth_date" date,
	"birth_date_precision" "birth_date_precision",
	"phone" text,
	"phone_alt" text,
	"email" text,
	"address_line" text,
	"city" text,
	"region" text,
	"preferred_locale" text DEFAULT 'fr' NOT NULL,
	"emergency_contact" jsonb,
	"communication_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_provider_id" uuid,
	"referral_source" text,
	"referred_by" text,
	"administrative_notes" text,
	"status" "patient_status" DEFAULT 'active' NOT NULL,
	"deceased_at" date,
	"search_text" text GENERATED ALWAYS AS (public.f_unaccent(lower(coalesce("patients"."first_name", '') || ' ' || coalesce("patients"."last_name", '') || ' ' || coalesce("patients"."first_name_ar", '') || ' ' || coalesce("patients"."last_name_ar", '') || ' ' || "patients"."patient_number" || ' ' || coalesce("patients"."phone", '') || ' ' || coalesce("patients"."phone_alt", '')))) STORED,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"network_patient_id" uuid NOT NULL,
	"receiving_organization_id" uuid NOT NULL,
	"request_id" uuid,
	"approver_type" "consent_approver_type" NOT NULL,
	"approver_ref" text NOT NULL,
	"verification_method" text NOT NULL,
	"verification_evidence_ref" text,
	"purpose" text NOT NULL,
	"categories" text[] NOT NULL,
	"date_from" date,
	"date_to" date,
	"include_future_updates" boolean DEFAULT false NOT NULL,
	"branch_ids" uuid[],
	"consent_text_version" text NOT NULL,
	"consent_language" text NOT NULL,
	"status" "consent_grant_status" DEFAULT 'active' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"superseded_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "consent_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"requesting_organization_id" uuid NOT NULL,
	"network_patient_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"requested_scope" jsonb NOT NULL,
	"status" "consent_request_status" DEFAULT 'requested' NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "shared_access_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"network_patient_id" uuid NOT NULL,
	"grant_id" uuid,
	"actor_user_id" uuid,
	"category" text NOT NULL,
	"purpose" text,
	"outcome" text NOT NULL,
	"deny_reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"changed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"pricing_unit" "pricing_unit" DEFAULT 'procedure' NOT NULL,
	"anatomy" "anatomy_requirement" DEFAULT 'none' NOT NULL,
	"default_duration_min" integer DEFAULT 30 NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text DEFAULT 'DZD' NOT NULL,
	"tax_rate_bp" integer,
	"material_cost_minor" bigint,
	"note_template" text,
	"is_demo_price" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_alerts" ADD CONSTRAINT "patient_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_alerts" ADD CONSTRAINT "patient_alerts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_alerts" ADD CONSTRAINT "patient_alerts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_alerts" ADD CONSTRAINT "patient_alerts_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_identity_links" ADD CONSTRAINT "patient_identity_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_identity_links" ADD CONSTRAINT "patient_identity_links_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_identity_links" ADD CONSTRAINT "patient_identity_links_network_patient_id_network_patients_id_fk" FOREIGN KEY ("network_patient_id") REFERENCES "public"."network_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_identity_links" ADD CONSTRAINT "patient_identity_links_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_relationships" ADD CONSTRAINT "patient_relationships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_relationships" ADD CONSTRAINT "patient_relationships_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_relationships" ADD CONSTRAINT "patient_relationships_related_patient_id_patients_id_fk" FOREIGN KEY ("related_patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_network_patient_id_network_patients_id_fk" FOREIGN KEY ("network_patient_id") REFERENCES "public"."network_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_assigned_provider_id_memberships_id_fk" FOREIGN KEY ("assigned_provider_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_network_patient_id_network_patients_id_fk" FOREIGN KEY ("network_patient_id") REFERENCES "public"."network_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_receiving_organization_id_organizations_id_fk" FOREIGN KEY ("receiving_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_request_id_consent_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."consent_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_requests" ADD CONSTRAINT "consent_requests_requesting_organization_id_organizations_id_fk" FOREIGN KEY ("requesting_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_requests" ADD CONSTRAINT "consent_requests_network_patient_id_network_patients_id_fk" FOREIGN KEY ("network_patient_id") REFERENCES "public"."network_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_requests" ADD CONSTRAINT "consent_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_access_events" ADD CONSTRAINT "shared_access_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_access_events" ADD CONSTRAINT "shared_access_events_network_patient_id_network_patients_id_fk" FOREIGN KEY ("network_patient_id") REFERENCES "public"."network_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_access_events" ADD CONSTRAINT "shared_access_events_grant_id_consent_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."consent_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_access_events" ADD CONSTRAINT "shared_access_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_org_time_idx" ON "audit_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_key_uq" ON "roles" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "patient_alerts_patient_idx" ON "patient_alerts" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_links_org_patient_uq" ON "patient_identity_links" USING btree ("organization_id","patient_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "patient_relationships_patient_idx" ON "patient_relationships" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_org_number_uq" ON "patients" USING btree ("organization_id","patient_number");--> statement-breakpoint
CREATE INDEX "patients_org_phone_idx" ON "patients" USING btree ("organization_id","phone");--> statement-breakpoint
CREATE INDEX "patients_search_trgm_idx" ON "patients" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "consent_grants_lookup_idx" ON "consent_grants" USING btree ("receiving_organization_id","network_patient_id");--> statement-breakpoint
CREATE INDEX "consent_requests_patient_idx" ON "consent_requests" USING btree ("network_patient_id");--> statement-breakpoint
CREATE INDEX "shared_access_patient_idx" ON "shared_access_events" USING btree ("network_patient_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_categories_org_code_uq" ON "service_categories" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "service_prices_service_idx" ON "service_prices" USING btree ("service_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "services_org_code_uq" ON "services" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "services_org_category_idx" ON "services" USING btree ("organization_id","category_id");--> statement-breakpoint
CREATE INDEX "services_name_trgm_idx" ON "services" USING gin (public.f_unaccent(lower("code" || ' ' || ("name"->>'fr') || ' ' || coalesce("name"->>'en', '') || ' ' || coalesce("name"->>'ar', ''))) gin_trgm_ops);