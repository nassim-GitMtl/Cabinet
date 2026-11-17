-- Public booking (§9A). Visitors have no session and no tenant context, so two
-- SECURITY DEFINER functions expose exactly what the public pages need and
-- nothing else. Everything else still goes through RLS with the resolved org.
SELECT app_private.apply_security();
--> statement-breakpoint
REVOKE DELETE ON public.booking_requests FROM cabinet_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.resolve_booking_link(p_token text)
  RETURNS TABLE (link_id uuid, organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id, l.organization_id
    FROM public.booking_links l
    JOIN public.organizations o ON o.id = l.organization_id
   WHERE l.token = p_token AND l.is_active AND o.status = 'active'
$$;
--> statement-breakpoint
-- Status page: only non-identifying fields of one request, found by its secret ref hash.
CREATE OR REPLACE FUNCTION app_private.booking_request_status(p_ref_hash text)
  RETURNS TABLE (organization_id uuid, clinic_name text, status booking_request_status,
                 requested_starts_at timestamptz, decline_reason text, type_name jsonb, timezone text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.organization_id, o.name, r.status, r.requested_starts_at, r.decline_reason, t.name, o.timezone
    FROM public.booking_requests r
    JOIN public.organizations o ON o.id = r.organization_id
    JOIN public.appointment_types t ON t.id = r.appointment_type_id
   WHERE r.ref_hash = p_ref_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.resolve_booking_link(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.booking_request_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.resolve_booking_link(text) TO cabinet_app;
GRANT EXECUTE ON FUNCTION app_private.booking_request_status(text) TO cabinet_app;
--> statement-breakpoint
-- Online-bookable defaults: consultation, hygiene and follow-up.
UPDATE public.appointment_types SET is_bookable_online = true
 WHERE code IN ('CONSULT', 'HYGIENE', 'FOLLOWUP');
