-- Custom SQL migration file, put your code below! --
-- Clinic computer: can it be paired now? Checked before the pairing code is used in the cloud, so a computer that
-- already holds a clinic never leaves the cloud copy waiting for it.
CREATE OR REPLACE FUNCTION app_private.clinic_node_pairable() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app_private AS $$
  SELECT app_private.node_role() = 'clinic'
     AND coalesce((SELECT state FROM app_private.node_settings WHERE singleton), 'unpaired') = 'unpaired'
     AND NOT EXISTS (SELECT 1 FROM public.organizations) $$;
--> statement-breakpoint
SELECT app_private.apply_security();
