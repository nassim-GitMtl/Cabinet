-- Row-level security and privileges for the runtime role `cabinet_app`.
-- Tenant isolation is enforced by PostgreSQL, not only by application code.
-- Re-run `SELECT app_private.apply_security();` at the end of every migration
-- that adds tables (see docs/ARCHITECTURE.md, "Adding a table").

CREATE SCHEMA IF NOT EXISTS app_private;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.current_org() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.current_actor_type() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.actor_type', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.current_network_patient() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.network_patient_id', true), '')::uuid $$;
--> statement-breakpoint

-- Tables with bespoke policies; skipped by the generic tenant loop.
CREATE OR REPLACE FUNCTION app_private.custom_policy_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['memberships', 'audit_events', 'shared_access_events']::text[] $$;
--> statement-breakpoint

-- Tenant tables whose rows must never be modified or deleted by the app.
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['service_prices']::text[] $$;
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

  -- Generic tenant isolation for every table with an organization_id column.
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
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO cabinet_app', t.table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

SELECT app_private.apply_security();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Platform tables (no clinical data). Accessed only through src/server/auth.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.users TO cabinet_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO cabinet_app;
--> statement-breakpoint

-- Organizations: visible to members (for the clinic switcher) and the active org.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.organizations TO cabinet_app;
DROP POLICY IF EXISTS org_select ON public.organizations;
CREATE POLICY org_select ON public.organizations FOR SELECT USING (
  id = app_private.current_org()
  OR id IN (SELECT m.organization_id FROM public.memberships m
             WHERE m.user_id = app_private.current_user_id() AND m.status = 'active')
);
DROP POLICY IF EXISTS org_insert ON public.organizations;
CREATE POLICY org_insert ON public.organizations FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS org_update ON public.organizations;
CREATE POLICY org_update ON public.organizations FOR UPDATE
  USING (id = app_private.current_org()) WITH CHECK (id = app_private.current_org());
--> statement-breakpoint

-- Memberships: the active org sees its members; a user sees their own memberships.
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.memberships TO cabinet_app;
DROP POLICY IF EXISTS membership_select ON public.memberships;
CREATE POLICY membership_select ON public.memberships FOR SELECT USING (
  organization_id = app_private.current_org() OR user_id = app_private.current_user_id()
);
DROP POLICY IF EXISTS membership_write ON public.memberships;
CREATE POLICY membership_write ON public.memberships FOR INSERT
  WITH CHECK (organization_id = app_private.current_org());
DROP POLICY IF EXISTS membership_update ON public.memberships;
CREATE POLICY membership_update ON public.memberships FOR UPDATE
  USING (organization_id = app_private.current_org())
  WITH CHECK (organization_id = app_private.current_org());
--> statement-breakpoint

-- Audit trail: insert + read only. Null organization only for platform events.
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_events FROM cabinet_app;
GRANT SELECT, INSERT ON public.audit_events TO cabinet_app;
DROP POLICY IF EXISTS audit_select ON public.audit_events;
CREATE POLICY audit_select ON public.audit_events FOR SELECT
  USING (organization_id = app_private.current_org());
DROP POLICY IF EXISTS audit_insert ON public.audit_events;
CREATE POLICY audit_insert ON public.audit_events FOR INSERT
  WITH CHECK (organization_id IS NULL OR organization_id = app_private.current_org());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Network identity and consent
-- ---------------------------------------------------------------------------
ALTER TABLE public.network_patients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.network_patients TO cabinet_app;
DROP POLICY IF EXISTS network_patient_select ON public.network_patients;
CREATE POLICY network_patient_select ON public.network_patients FOR SELECT USING (
  id = app_private.current_network_patient()
  OR EXISTS (SELECT 1 FROM public.patient_identity_links l
              WHERE l.network_patient_id = network_patients.id
                AND l.organization_id = app_private.current_org()
                AND l.status = 'active')
);
DROP POLICY IF EXISTS network_patient_insert ON public.network_patients;
CREATE POLICY network_patient_insert ON public.network_patients FOR INSERT WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE public.consent_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.consent_requests TO cabinet_app;
DROP POLICY IF EXISTS consent_request_access ON public.consent_requests;
CREATE POLICY consent_request_access ON public.consent_requests USING (
  requesting_organization_id = app_private.current_org()
  OR network_patient_id = app_private.current_network_patient()
) WITH CHECK (
  requesting_organization_id = app_private.current_org()
  OR network_patient_id = app_private.current_network_patient()
);
--> statement-breakpoint

-- Grants: readable by the receiving clinic and the patient; only the patient
-- (authenticated patient context) can create or change them.
ALTER TABLE public.consent_grants ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.consent_grants TO cabinet_app;
DROP POLICY IF EXISTS consent_grant_select ON public.consent_grants;
CREATE POLICY consent_grant_select ON public.consent_grants FOR SELECT USING (
  receiving_organization_id = app_private.current_org()
  OR network_patient_id = app_private.current_network_patient()
);
DROP POLICY IF EXISTS consent_grant_insert ON public.consent_grants;
CREATE POLICY consent_grant_insert ON public.consent_grants FOR INSERT WITH CHECK (
  app_private.current_actor_type() = 'patient'
  AND network_patient_id = app_private.current_network_patient()
);
DROP POLICY IF EXISTS consent_grant_update ON public.consent_grants;
CREATE POLICY consent_grant_update ON public.consent_grants FOR UPDATE
  USING (app_private.current_actor_type() = 'patient'
         AND network_patient_id = app_private.current_network_patient())
  WITH CHECK (app_private.current_actor_type() = 'patient'
         AND network_patient_id = app_private.current_network_patient());
--> statement-breakpoint

ALTER TABLE public.shared_access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_access_events FROM cabinet_app;
GRANT SELECT, INSERT ON public.shared_access_events TO cabinet_app;
DROP POLICY IF EXISTS shared_access_select ON public.shared_access_events;
CREATE POLICY shared_access_select ON public.shared_access_events FOR SELECT USING (
  organization_id = app_private.current_org()
  OR network_patient_id = app_private.current_network_patient()
);
DROP POLICY IF EXISTS shared_access_insert ON public.shared_access_events;
CREATE POLICY shared_access_insert ON public.shared_access_events FOR INSERT
  WITH CHECK (organization_id = app_private.current_org());
