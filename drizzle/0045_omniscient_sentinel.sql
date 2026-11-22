ALTER TABLE "organizations" ALTER COLUMN "enabled_modules" SET DEFAULT ARRAY['core']::text[];--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- Existing clinics keep every function they had before commercial entitlements were enforced.
UPDATE public.organizations SET enabled_modules = ARRAY[
  'core','online_booking','advanced_clinical','billing','reports','inventory','sterilization','patient_engagement','laboratory'
]::text[] WHERE enabled_modules = '{}'::text[];--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.is_platform_operator() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = nullif(current_setting('app.user_id', true), '')::uuid
       AND u.status = 'active' AND u.platform_role = 'operator'
  )
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.platform_list_organizations()
RETURNS TABLE (
  id uuid, name text, kind text, status text, owner_name text, owner_email text,
  enabled_modules text[], created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT app_private.is_platform_operator() THEN RAISE EXCEPTION 'platform access denied' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.kind::text, o.status::text, u.full_name, u.email, o.enabled_modules, o.created_at
      FROM public.organizations o
      LEFT JOIN public.roles r ON r.organization_id = o.id AND r.key = 'owner'
      LEFT JOIN public.memberships m ON m.organization_id = o.id AND m.role_id = r.id AND m.status = 'active'
      LEFT JOIN public.users u ON u.id = m.user_id
     ORDER BY o.created_at DESC;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.platform_set_modules(p_organization_id uuid, p_modules text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE allowed constant text[] := ARRAY['core','online_booking','advanced_clinical','billing','reports','inventory','sterilization','patient_engagement','laboratory'];
BEGIN
  IF NOT app_private.is_platform_operator() THEN RAISE EXCEPTION 'platform access denied' USING ERRCODE = '42501'; END IF;
  IF NOT ('core' = ANY (p_modules)) OR EXISTS (SELECT 1 FROM unnest(p_modules) value WHERE NOT value = ANY (allowed)) THEN
    RAISE EXCEPTION 'invalid product module';
  END IF;
  UPDATE public.organizations SET enabled_modules = p_modules, updated_at = now() WHERE organizations.id = p_organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN p_organization_id;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.is_platform_operator() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.platform_list_organizations() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.platform_set_modules(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.is_platform_operator() TO cabinet_app;
GRANT EXECUTE ON FUNCTION app_private.platform_list_organizations() TO cabinet_app;
GRANT EXECUTE ON FUNCTION app_private.platform_set_modules(uuid, text[]) TO cabinet_app;--> statement-breakpoint

SELECT app_private.apply_security();
