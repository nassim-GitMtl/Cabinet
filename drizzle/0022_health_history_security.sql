-- Medical history (§8): responses and reviews are append-only; a questionnaire
-- version's wording never changes (only its current flag and a one-time approval).
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings', 'clinical_note_versions',
    'questionnaire_responses', 'health_history_reviews'
  ]::text[] $$;
--> statement-breakpoint
SELECT app_private.apply_security();
--> statement-breakpoint
REVOKE DELETE ON public.questionnaire_versions FROM cabinet_app;
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
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS questionnaire_versions_guard ON public.questionnaire_versions;
CREATE TRIGGER questionnaire_versions_guard BEFORE UPDATE ON public.questionnaire_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_questionnaire_version();
