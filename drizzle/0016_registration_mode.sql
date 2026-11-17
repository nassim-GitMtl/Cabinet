-- Clinic-server installs allow self-registration only for the first clinic.
-- Visitors have no tenant context, so the count comes from a narrow
-- SECURITY DEFINER function that reveals nothing but a number.
CREATE OR REPLACE FUNCTION app_private.organization_count() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*) FROM public.organizations
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.organization_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.organization_count() TO cabinet_app;
