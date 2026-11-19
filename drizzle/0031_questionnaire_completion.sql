CREATE TABLE "questionnaire_tablet_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"questionnaire_version_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questionnaire_tablet_sessions" ADD CONSTRAINT "questionnaire_tablet_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_tablet_sessions" ADD CONSTRAINT "questionnaire_tablet_sessions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_tablet_sessions" ADD CONSTRAINT "questionnaire_tablet_sessions_questionnaire_version_id_questionnaire_versions_id_fk" FOREIGN KEY ("questionnaire_version_id") REFERENCES "public"."questionnaire_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_tablet_sessions" ADD CONSTRAINT "questionnaire_tablet_sessions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_tablet_sessions_token_uq" ON "questionnaire_tablet_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "questionnaire_tablet_sessions_patient_idx" ON "questionnaire_tablet_sessions" USING btree ("organization_id","patient_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX questionnaire_versions_current_uq ON public.questionnaire_versions (organization_id, key) WHERE is_current;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.no_delete_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'payments', 'cash_sessions', 'expenses', 'appointments', 'booking_requests',
    'treatment_plans', 'clinical_notes', 'questionnaire_versions', 'inventory_items',
    'inventory_purchase_orders', 'inventory_item_identifiers', 'procedure_consumptions',
    'sterilizers', 'instrument_sets', 'sterilization_cycles', 'sterilization_packs', 'sterilization_pack_uses',
    'questionnaire_tablet_sessions'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_questionnaire_version() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  mutable_cols text[] := ARRAY['is_current', 'approved_by_user_id', 'approved_at'];
BEGIN
  IF (to_jsonb(NEW) - mutable_cols) <> (to_jsonb(OLD) - mutable_cols) THEN
    RAISE EXCEPTION 'clinical: questionnaire wording is versioned and immutable';
  END IF;
  IF OLD.approved_at IS NOT NULL AND (NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id) THEN
    RAISE EXCEPTION 'clinical: questionnaire approval cannot be changed';
  END IF;
  IF OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL AND NOT NEW.is_current THEN
    RAISE EXCEPTION 'clinical: an approved questionnaire version must be activated';
  END IF;
  IF NOT OLD.is_current AND NEW.is_current AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'clinical: an unapproved questionnaire version cannot be activated';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_questionnaire_tablet_session() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF app_private.current_actor_type() <> 'staff' OR NEW.created_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
      RAISE EXCEPTION 'clinical: tablet session must be created by its staff actor';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id = NEW.patient_id AND p.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'clinical: tablet patient must belong to the same clinic';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.questionnaire_versions v WHERE v.id = NEW.questionnaire_version_id
      AND v.organization_id = NEW.organization_id AND v.is_current AND v.approved_at IS NOT NULL) THEN
      RAISE EXCEPTION 'clinical: tablet questionnaire must be the approved current version';
    END IF;
    IF NEW.used_at IS NOT NULL OR NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'clinical: invalid initial tablet session state';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'used_at') <> (to_jsonb(OLD) - 'used_at') OR OLD.used_at IS NOT NULL OR NEW.used_at IS NULL THEN
    RAISE EXCEPTION 'clinical: tablet session may only be consumed once';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER questionnaire_tablet_sessions_guard BEFORE INSERT OR UPDATE ON public.questionnaire_tablet_sessions
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_questionnaire_tablet_session();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.questionnaire_tablet_lookup(p_token_hash text)
RETURNS TABLE (
  organization_id uuid, patient_id uuid, questionnaire_version_id uuid, patient_number text,
  first_name text, last_name text, title jsonb, questions jsonb, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.organization_id, s.patient_id, s.questionnaire_version_id, p.patient_number,
         p.first_name, p.last_name, v.title, v.questions, s.expires_at
    FROM questionnaire_tablet_sessions s
    JOIN patients p ON p.id = s.patient_id AND p.organization_id = s.organization_id
    JOIN questionnaire_versions v ON v.id = s.questionnaire_version_id AND v.organization_id = s.organization_id
   WHERE s.token_hash = p_token_hash AND s.used_at IS NULL AND s.expires_at > now()
     AND v.is_current AND v.approved_at IS NOT NULL
   LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.questionnaire_tablet_lookup(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.questionnaire_tablet_lookup(text) TO cabinet_app;
--> statement-breakpoint
UPDATE public.roles SET permissions = permissions || ARRAY['questionnaire.manage', 'questionnaire.approve']::text[]
 WHERE key = 'owner' AND is_system AND NOT ('questionnaire.manage' = ANY(permissions));
--> statement-breakpoint
UPDATE public.roles SET permissions = permissions || ARRAY['questionnaire.approve']::text[]
 WHERE key IN ('dentist', 'hygienist') AND is_system AND NOT ('questionnaire.approve' = ANY(permissions));
--> statement-breakpoint
SELECT app_private.apply_security();
