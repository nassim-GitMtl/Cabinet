-- Security fix: several migrations ran `REVOKE DELETE ON <table>` and later
-- migrations re-ran apply_security(), which granted DELETE on every tenant
-- table again. The "no delete" rule now lives inside apply_security() itself,
-- so re-running it can never re-open DELETE on these tables.
CREATE OR REPLACE FUNCTION app_private.no_delete_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'payments', 'cash_sessions', 'expenses', 'appointments', 'booking_requests',
    'treatment_plans', 'clinical_notes', 'questionnaire_versions'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.apply_security() RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  t record;
BEGIN
  GRANT USAGE ON SCHEMA public TO cabinet_app;
  GRANT USAGE ON SCHEMA app_private TO cabinet_app;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO cabinet_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cabinet_app;

  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'organization_id'
       AND tb.table_type = 'BASE TABLE'
       AND NOT (c.table_name = ANY (app_private.custom_policy_tables()))
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (organization_id = app_private.current_org())
         WITH CHECK (organization_id = app_private.current_org())',
      t.table_name);
    IF t.table_name = ANY (app_private.append_only_tables()) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM cabinet_app', t.table_name);
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO cabinet_app', t.table_name);
    ELSIF t.table_name = ANY (app_private.no_delete_tables()) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM cabinet_app', t.table_name);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO cabinet_app', t.table_name);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO cabinet_app', t.table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
SELECT app_private.apply_security();
