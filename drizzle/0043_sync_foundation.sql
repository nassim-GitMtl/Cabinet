CREATE TABLE "sync_changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"txid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"origin" text NOT NULL,
	"table_name" text NOT NULL,
	"op" text NOT NULL,
	"pk" jsonb NOT NULL,
	"row_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_nodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"label" text NOT NULL,
	"pairing_code_hash" text,
	"pairing_expires_at" timestamp with time zone,
	"node_key_hash" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_pending" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"change_id" bigint NOT NULL,
	"table_name" text NOT NULL,
	"op" text NOT NULL,
	"pk" jsonb NOT NULL,
	"row_data" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_row_versions" (
	"organization_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"pk" text NOT NULL,
	"origin" text NOT NULL,
	"change_id" bigint NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_row_versions_organization_id_table_name_pk_pk" PRIMARY KEY("organization_id","table_name","pk")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "data_home" text DEFAULT 'cloud' NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_nodes" ADD CONSTRAINT "sync_nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_nodes" ADD CONSTRAINT "sync_nodes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_pending" ADD CONSTRAINT "sync_pending_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_row_versions" ADD CONSTRAINT "sync_row_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_changes_read_idx" ON "sync_changes" USING btree ("organization_id","origin","txid","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_nodes_pairing_uq" ON "sync_nodes" USING btree ("pairing_code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_nodes_key_uq" ON "sync_nodes" USING btree ("node_key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_nodes_active_uq" ON "sync_nodes" USING btree ("organization_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_pending_change_uq" ON "sync_pending" USING btree ("organization_id","origin","change_id");--> statement-breakpoint
-- ===========================================================================
-- Offline clinic computer <-> cloud copy (docs/ARCHITECTURE.md "Offline clinic computer and cloud sync").
-- ===========================================================================
ALTER TABLE public.organizations ADD CONSTRAINT organizations_data_home_ck CHECK (data_home IN ('cloud', 'clinic'));
--> statement-breakpoint
ALTER TABLE public.sync_changes ADD CONSTRAINT sync_changes_op_ck CHECK (op IN ('upsert', 'delete'));
--> statement-breakpoint
ALTER TABLE public.sync_pending ADD CONSTRAINT sync_pending_op_ck CHECK (op IN ('upsert', 'delete'));
--> statement-breakpoint
-- What this database is: the hosted copy ("cloud", default) or one clinic's computer ("clinic", set by the
-- clinic install's migrate job). On a clinic computer it also holds the pairing with the cloud copy.
CREATE TABLE IF NOT EXISTS app_private.node_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  node_role text NOT NULL DEFAULT 'cloud' CHECK (node_role IN ('cloud', 'clinic')),
  organization_id uuid,
  cloud_url text,
  node_key_enc text,
  state text NOT NULL DEFAULT 'unpaired' CHECK (state IN ('unpaired', 'bootstrapping', 'active')),
  push_cursor jsonb,
  pull_cursor jsonb,
  bootstrap_progress jsonb,
  last_push_at timestamptz,
  last_pull_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO app_private.node_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.node_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app_private AS $$
  SELECT coalesce((SELECT node_role FROM app_private.node_settings WHERE singleton), 'cloud') $$;
--> statement-breakpoint
-- The sync login. It has the runtime role's privileges and NO BYPASSRLS (tenant isolation still applies);
-- only it can switch business triggers off while applying records already checked on the other copy.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cabinet_sync') THEN
    CREATE ROLE cabinet_sync NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END $$;
--> statement-breakpoint
GRANT cabinet_app TO cabinet_sync;
--> statement-breakpoint
GRANT SELECT, UPDATE ON app_private.node_settings TO cabinet_sync;
--> statement-breakpoint
-- True only on a connection logged in as cabinet_sync that has declared it is applying replicated records.
-- cabinet_app cannot become cabinet_sync, so setting app.sync_apply there does nothing.
CREATE OR REPLACE FUNCTION app_private.sync_applying() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT session_user::text = 'cabinet_sync' AND coalesce(current_setting('app.sync_apply', true), '') = 'on' $$;
--> statement-breakpoint
-- Tables copied between the clinic computer and the cloud: every clinic table except the sync bookkeeping,
-- plus the shared rows they need (organization, staff accounts, consent records). Node-local tables (sessions,
-- MFA challenges, password resets, rate limits, patient portal accounts) are never copied.
CREATE OR REPLACE FUNCTION app_private.sync_tables() RETURNS text[]
  LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT coalesce((
    SELECT array_agg(c.relname::text ORDER BY c.relname)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped)
       AND c.relname NOT IN ('sync_changes', 'sync_row_versions', 'sync_pending', 'sync_nodes')
  ), '{}'::text[]) || ARRAY['organizations', 'users', 'consent_requests', 'consent_grants']::text[] $$;
--> statement-breakpoint
-- Clinics a row belongs to (a staff account belongs to every clinic it is a member of).
CREATE OR REPLACE FUNCTION app_private.sync_row_orgs(p_table text, p_row jsonb) RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE p_table
    WHEN 'organizations' THEN ARRAY[(p_row->>'id')::uuid]
    WHEN 'users' THEN (SELECT coalesce(array_agg(DISTINCT m.organization_id), '{}'::uuid[]) FROM public.memberships m WHERE m.user_id = (p_row->>'id')::uuid)
    WHEN 'consent_requests' THEN ARRAY[(p_row->>'requesting_organization_id')::uuid]
    WHEN 'consent_grants' THEN ARRAY[(p_row->>'receiving_organization_id')::uuid]
    ELSE CASE WHEN p_row->>'organization_id' IS NULL THEN '{}'::uuid[] ELSE ARRAY[(p_row->>'organization_id')::uuid] END
  END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.sync_org_captured(p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org AND o.data_home = 'clinic') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.sync_pk(p_table text, p_row jsonb) RETURNS jsonb
  LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_object_agg(a.attname, p_row -> a.attname::text)
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
   WHERE i.indrelid = format('public.%I', p_table)::regclass AND i.indisprimary $$;
--> statement-breakpoint
-- Records every change of a clinic whose data lives on a clinic computer, on both copies. Rows applied by the
-- sync are not recorded again (the trigger is skipped while applying), so nothing echoes back.
CREATE OR REPLACE FUNCTION app_private.sync_capture() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  rec jsonb;
  old_rec jsonb;
  change text;
  org uuid;
  node text := app_private.node_role();
  linked uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;
  -- Staff accounts are managed on the clinic computer; cloud-side login bookkeeping stays in the cloud.
  IF node = 'cloud' AND TG_TABLE_NAME = 'users' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    rec := to_jsonb(OLD); change := 'delete';
  ELSE
    rec := to_jsonb(NEW); change := 'upsert';
    old_rec := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  END IF;
  FOREACH org IN ARRAY app_private.sync_row_orgs(TG_TABLE_NAME, rec) LOOP
    CONTINUE WHEN org IS NULL OR NOT app_private.sync_org_captured(org);
    -- Shared rows this one points to travel just before it.
    IF change = 'upsert' AND TG_TABLE_NAME = 'memberships' AND (old_rec IS NULL OR old_rec->>'user_id' IS DISTINCT FROM rec->>'user_id') THEN
      INSERT INTO public.sync_changes (organization_id, origin, table_name, op, pk, row_data)
        SELECT org, node, 'users', 'upsert', jsonb_build_object('id', u.id), to_jsonb(u) FROM public.users u WHERE u.id = (rec->>'user_id')::uuid;
    END IF;
    linked := nullif(rec->>'network_patient_id', '')::uuid;
    IF change = 'upsert' AND linked IS NOT NULL AND (old_rec IS NULL OR old_rec->>'network_patient_id' IS DISTINCT FROM rec->>'network_patient_id') THEN
      INSERT INTO public.sync_changes (organization_id, origin, table_name, op, pk, row_data)
        SELECT org, node, 'network_patients', 'upsert', jsonb_build_object('id', p.id), to_jsonb(p) FROM public.network_patients p WHERE p.id = linked;
    END IF;
    INSERT INTO public.sync_changes (organization_id, origin, table_name, op, pk, row_data)
      VALUES (org, node, TG_TABLE_NAME, change, app_private.sync_pk(TG_TABLE_NAME, rec), CASE WHEN change = 'delete' THEN NULL ELSE rec END);
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- On the cloud copy, staff cannot change the data of a clinic whose clinic computer is in charge (patients'
-- own online actions and audit records are still accepted and travel down to the clinic computer).
CREATE OR REPLACE FUNCTION app_private.sync_writer_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  org uuid;
BEGIN
  IF app_private.node_role() = 'cloud' AND app_private.current_actor_type() = 'staff' THEN
    FOREACH org IN ARRAY app_private.sync_row_orgs(TG_TABLE_NAME, to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END)) LOOP
      IF org IS NOT NULL AND app_private.sync_org_captured(org) THEN
        RAISE EXCEPTION 'clinic_read_only: % is managed by the clinic computer', TG_TABLE_NAME USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Applies one replicated change (insert-or-update, or delete). Runs as cabinet_sync with the tenant context set,
-- so row-level security still decides what may be written. Append-only rows are only ever inserted.
CREATE OR REPLACE FUNCTION app_private.sync_apply_row(p_table text, p_op text, p_pk jsonb, p_row jsonb) RETURNS void
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  rel regclass;
  cols text[];
  pkcols text[];
  others text[];
  col_list text;
  insert_only boolean;
BEGIN
  IF NOT app_private.sync_applying() THEN RAISE EXCEPTION 'sync apply: not a sync session'; END IF;
  IF NOT (p_table = ANY (app_private.sync_tables()) OR p_table = 'network_patients') THEN
    RAISE EXCEPTION 'sync apply: table % is not replicated', p_table;
  END IF;
  rel := format('public.%I', p_table)::regclass;
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO cols
    FROM pg_attribute a WHERE a.attrelid = rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '';
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO pkcols
    FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
   WHERE i.indrelid = rel AND i.indisprimary;
  IF p_op = 'delete' THEN
    EXECUTE format('DELETE FROM %s t USING jsonb_populate_record(NULL::%s, $1) r WHERE %s', rel, rel,
      (SELECT string_agg(format('t.%1$I = r.%1$I', c), ' AND ') FROM unnest(pkcols) c)) USING p_pk;
    RETURN;
  END IF;
  IF p_op <> 'upsert' THEN RAISE EXCEPTION 'sync apply: unknown operation %', p_op; END IF;
  col_list := (SELECT string_agg(format('%I', c), ', ') FROM unnest(cols) c);
  others := ARRAY(SELECT c FROM unnest(cols) c WHERE NOT c = ANY (pkcols));
  insert_only := p_table = ANY (app_private.append_only_tables()) OR p_table = 'network_patients' OR cardinality(others) = 0;
  IF insert_only THEN
    EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_record(NULL::%s, $1) ON CONFLICT (%s) DO NOTHING',
      rel, col_list, col_list, rel, (SELECT string_agg(format('%I', c), ', ') FROM unnest(pkcols) c)) USING p_row;
  ELSE
    EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_record(NULL::%s, $1) ON CONFLICT (%s) DO UPDATE SET (%s) = ROW(%s)',
      rel, col_list, col_list, rel, (SELECT string_agg(format('%I', c), ', ') FROM unnest(pkcols) c),
      (SELECT string_agg(format('%I', c), ', ') FROM unnest(others) c),
      (SELECT string_agg(format('EXCLUDED.%I', c), ', ') FROM unnest(others) c)) USING p_row;
  END IF;
END $$;
--> statement-breakpoint
-- Makes every business trigger skip rows being applied by the sync (already checked on the other copy), and puts
-- the capture + read-only guard triggers on every replicated table. Called by apply_security(), so triggers
-- added by later migrations are covered automatically (tests/integration/sync-triggers.test.ts checks it).
CREATE OR REPLACE FUNCTION app_private.apply_sync_triggers() RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  t record;
  def text;
  tbl text;
BEGIN
  FOR t IN
    SELECT tg.tgname, c.relname, pg_get_triggerdef(tg.oid) AS def
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT tg.tgisinternal
       AND tg.tgname NOT IN ('sync_capture', 'sync_writer_guard')
       AND position('sync_applying()' IN pg_get_triggerdef(tg.oid)) = 0
  LOOP
    IF t.def ~ ' WHEN \(' THEN
      def := regexp_replace(t.def, ' WHEN \((.*)\) EXECUTE FUNCTION ', ' WHEN ((NOT app_private.sync_applying()) AND (\1)) EXECUTE FUNCTION ');
    ELSE
      def := replace(t.def, ' EXECUTE FUNCTION ', ' WHEN (NOT app_private.sync_applying()) EXECUTE FUNCTION ');
    END IF;
    EXECUTE format('DROP TRIGGER %I ON public.%I', t.tgname, t.relname);
    EXECUTE def;
  END LOOP;
  FOREACH tbl IN ARRAY app_private.sync_tables() LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sync_capture ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW '
      'WHEN (NOT app_private.sync_applying()) EXECUTE FUNCTION app_private.sync_capture()', tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS sync_writer_guard ON public.%I', tbl);
    IF tbl <> 'audit_events' THEN
      EXECUTE format('CREATE TRIGGER sync_writer_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW '
        'WHEN (NOT app_private.sync_applying()) EXECUTE FUNCTION app_private.sync_writer_guard()', tbl);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Cloud: a clinic computer exchanges its single-use pairing code for its node key. From then on the clinic
-- computer is in charge of this clinic's data (the cloud copy becomes read-only for staff).
CREATE OR REPLACE FUNCTION app_private.claim_sync_pairing(p_code_hash text, p_key_hash text)
RETURNS TABLE (node_id uuid, organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE node public.sync_nodes%ROWTYPE;
BEGIN
  SELECT * INTO node FROM public.sync_nodes n
   WHERE n.pairing_code_hash = p_code_hash AND n.pairing_expires_at > now() AND n.revoked_at IS NULL AND n.paired_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.sync_nodes SET node_key_hash = p_key_hash, paired_at = now(), last_seen_at = now(), pairing_code_hash = NULL
   WHERE id = node.id;
  PERFORM set_config('app.org_id', node.organization_id::text, true);
  PERFORM set_config('app.actor_type', 'system', true);
  UPDATE public.organizations SET data_home = 'clinic', updated_at = now() WHERE id = node.organization_id;
  RETURN QUERY SELECT node.id, node.organization_id;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.resolve_sync_node(p_key_hash text)
RETURNS TABLE (node_id uuid, organization_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.sync_nodes n SET last_seen_at = now()
   WHERE n.node_key_hash = p_key_hash AND n.revoked_at IS NULL AND n.paired_at IS NOT NULL
  RETURNING n.id, n.organization_id $$;
--> statement-breakpoint
-- Cloud: the owner unpairs the clinic computer of the clinic in the current context; the cloud copy is in charge again.
CREATE OR REPLACE FUNCTION app_private.revoke_sync_node() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE org uuid := app_private.current_org(); actor text := app_private.current_actor_type();
BEGIN
  IF org IS NULL THEN RAISE EXCEPTION 'revoke_sync_node: no clinic context'; END IF;
  UPDATE public.sync_nodes SET revoked_at = now(), pairing_code_hash = NULL WHERE organization_id = org AND revoked_at IS NULL;
  PERFORM set_config('app.actor_type', 'system', true);
  UPDATE public.organizations SET data_home = 'cloud', updated_at = now() WHERE id = org;
  PERFORM set_config('app.actor_type', coalesce(actor, ''), true);
END $$;
--> statement-breakpoint
-- Clinic computer: records the pairing obtained from the cloud copy. Only possible on a fresh clinic computer
-- (no clinic created locally yet); the sync worker then downloads the clinic's data.
CREATE OR REPLACE FUNCTION app_private.begin_clinic_node(p_org uuid, p_cloud_url text, p_key_enc text, p_pull_from text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, app_private AS $$
BEGIN
  IF app_private.node_role() <> 'clinic' THEN RAISE EXCEPTION 'begin_clinic_node: this database is not a clinic computer'; END IF;
  IF (SELECT state FROM app_private.node_settings WHERE singleton) <> 'unpaired' THEN RAISE EXCEPTION 'begin_clinic_node: already paired'; END IF;
  IF EXISTS (SELECT 1 FROM public.organizations) THEN RAISE EXCEPTION 'begin_clinic_node: a clinic already exists on this computer'; END IF;
  UPDATE app_private.node_settings
     SET organization_id = p_org, cloud_url = p_cloud_url, node_key_enc = p_key_enc, state = 'bootstrapping',
         push_cursor = NULL, pull_cursor = jsonb_build_object('from', p_pull_from, 'to', NULL, 'after', 0),
         bootstrap_progress = '{}'::jsonb, last_error = NULL, last_error_at = NULL, updated_at = now()
   WHERE singleton;
END $$;
--> statement-breakpoint
-- What the screens may show about sync (never the node key).
CREATE OR REPLACE FUNCTION app_private.node_status()
RETURNS TABLE (node_role text, state text, organization_id uuid, cloud_url text, last_push_at timestamptz,
               last_pull_at timestamptz, last_error text, last_error_at timestamptz, bootstrap_progress jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app_private AS $$
  SELECT node_role, state, organization_id, cloud_url, last_push_at, last_pull_at, last_error, last_error_at, bootstrap_progress
    FROM app_private.node_settings WHERE singleton $$;
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
    'patient_imports', 'sync_changes'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.no_delete_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'payments', 'cash_sessions', 'expenses', 'appointments', 'booking_requests',
    'treatment_plans', 'clinical_notes', 'questionnaire_versions', 'inventory_items',
    'inventory_purchase_orders', 'inventory_item_identifiers', 'procedure_consumptions',
    'sterilizers', 'instrument_sets', 'sterilization_cycles', 'sterilization_packs', 'sterilization_pack_uses',
    'questionnaire_tablet_sessions', 'sync_nodes'
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
  PERFORM app_private.apply_sync_triggers();
END $$;
--> statement-breakpoint
SELECT app_private.apply_security();
