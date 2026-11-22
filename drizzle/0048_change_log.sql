CREATE TABLE "record_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"row_id" text,
	"operation" text NOT NULL,
	"changed_columns" text[] DEFAULT '{}'::text[] NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_changes_operation_valid" CHECK ("record_changes"."operation" in ('insert', 'update', 'delete'))
);
--> statement-breakpoint
ALTER TABLE "record_changes" ADD CONSTRAINT "record_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_changes_org_time_idx" ON "record_changes" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "record_changes_row_idx" ON "record_changes" USING btree ("table_name","row_id","occurred_at");--> statement-breakpoint
CREATE INDEX "record_changes_actor_idx" ON "record_changes" USING btree ("organization_id","actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_org_actor_time_idx" ON "audit_events" USING btree ("organization_id","actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_org_patient_time_idx" ON "audit_events" USING btree ("organization_id","patient_id","occurred_at");--> statement-breakpoint
-- Tables whose rows are not business records (the logs themselves, sync bookkeeping, number counters).
CREATE OR REPLACE FUNCTION app_private.change_log_excluded_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['audit_events', 'record_changes', 'shared_access_events', 'sync_changes', 'sync_row_versions',
               'sync_pending', 'sync_nodes', 'counters']::text[] $$;
--> statement-breakpoint
-- Who changed what: one line per inserted, updated or deleted row, with the person from the transaction context
-- (set by withDbContext) and the names of the changed columns, never their values. SECURITY DEFINER so it also
-- works inside writes made through public SECURITY DEFINER functions (online booking, portal).
CREATE OR REPLACE FUNCTION app_private.record_change() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  new_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  old_row jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  r jsonb := coalesce(new_row, old_row);
  org uuid;
  row_key text := r ->> 'id';
  cols text[] := '{}'::text[];
  who uuid;
  kind public.actor_type;
BEGIN
  org := CASE WHEN TG_TABLE_NAME = 'organizations' THEN (r ->> 'id')::uuid ELSE (r ->> 'organization_id')::uuid END;
  IF org IS NULL THEN RETURN NULL; END IF;
  BEGIN
    who := nullif(current_setting('app.user_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    who := NULL;
  END;
  kind := CASE current_setting('app.actor_type', true)
    WHEN 'staff' THEN 'staff' WHEN 'patient' THEN 'patient' WHEN 'platform' THEN 'platform' ELSE 'system' END;
  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}'::text[]) INTO cols
      FROM jsonb_each(new_row) n
     WHERE n.key NOT IN ('updated_at', 'version') AND n.value IS DISTINCT FROM old_row -> n.key;
    IF cardinality(cols) = 0 THEN RETURN NULL; END IF;
    -- Autosave (notes, forms): the same person saving the same fields of the same record within 10 minutes is one line.
    IF row_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.record_changes c
       WHERE c.table_name = TG_TABLE_NAME AND c.row_id = row_key AND c.operation = 'update'
         AND c.actor_user_id IS NOT DISTINCT FROM who AND c.occurred_at > now() - interval '10 minutes'
         AND c.changed_columns @> cols) THEN
      RETURN NULL;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}'::text[]) INTO cols
      FROM jsonb_each(new_row) n WHERE n.value <> 'null'::jsonb;
  END IF;
  INSERT INTO public.record_changes (organization_id, table_name, row_id, operation, changed_columns, actor_type, actor_user_id)
  VALUES (org, TG_TABLE_NAME, row_key, lower(TG_OP), cols, kind, who);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.apply_change_log() RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.relname::text
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND (c.relname = 'organizations'
            OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped))
       AND NOT (c.relname = ANY (app_private.change_log_excluded_tables()))
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS record_change ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER record_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW '
      'WHEN (NOT app_private.sync_applying()) EXECUTE FUNCTION app_private.record_change()', tbl);
  END LOOP;
END $$;
--> statement-breakpoint
-- Same as 0043, plus the change log on every clinic table (new tables get it on their migration's apply_security()).
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
  PERFORM app_private.apply_change_log();
  PERFORM app_private.apply_sync_triggers();
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings', 'clinical_note_versions',
    'questionnaire_responses', 'health_history_reviews', 'inventory_lots', 'inventory_movements',
    'inventory_purchase_order_lines', 'audit_events', 'clinical_files', 'clinical_file_comparisons',
    'patient_contacts', 'payment_schedules', 'payment_schedule_installments', 'payment_installment_receipts',
    'patient_imports', 'sync_changes', 'provider_service_term_history', 'honorarium_entries',
    'honorarium_payments', 'honorarium_period_closures', 'record_changes'
  ]::text[] $$;
--> statement-breakpoint
SELECT app_private.apply_security();
