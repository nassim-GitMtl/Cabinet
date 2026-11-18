CREATE TYPE "public"."portal_invitation_kind" AS ENUM('activation', 'recovery');--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD COLUMN "kind" "portal_invitation_kind" DEFAULT 'activation' NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.resolve_portal_invitation(p_token_hash text)
RETURNS TABLE (email text, locale text, clinic_name text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.email, p.preferred_locale, o.name, i.expires_at
    FROM public.portal_invitations i
    JOIN public.patients p ON p.id = i.patient_id
    JOIN public.organizations o ON o.id = i.organization_id
   WHERE i.token_hash = p_token_hash AND i.kind = 'activation'
     AND i.used_at IS NULL AND i.expires_at > now()
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.activate_patient_portal(p_token_hash text, p_password_hash text)
RETURNS TABLE (account_id uuid, network_patient_id uuid, email text, locale text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv public.portal_invitations%ROWTYPE; patient_locale text; new_id uuid;
BEGIN
  SELECT * INTO inv FROM public.portal_invitations
   WHERE token_hash = p_token_hash AND kind = 'activation'
     AND used_at IS NULL AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'portal invitation unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.patient_accounts a WHERE a.network_patient_id = inv.network_patient_id) THEN
    RAISE EXCEPTION 'portal account already exists';
  END IF;
  SELECT preferred_locale INTO patient_locale FROM public.patients WHERE id = inv.patient_id;
  INSERT INTO public.patient_accounts (network_patient_id, email, password_hash, locale)
    VALUES (inv.network_patient_id, lower(inv.email), p_password_hash, coalesce(patient_locale, 'fr'))
    RETURNING id INTO new_id;
  UPDATE public.portal_invitations SET used_at = now() WHERE id = inv.id;
  RETURN QUERY SELECT new_id, inv.network_patient_id, lower(inv.email), coalesce(patient_locale, 'fr');
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.patient_portal_account_exists(p_network_patient_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_private.current_actor_type() = 'staff'
     AND EXISTS (
       SELECT 1 FROM public.patient_identity_links l
        WHERE l.organization_id = app_private.current_org()
          AND l.network_patient_id = p_network_patient_id AND l.status = 'active'
     )
     AND EXISTS (
       SELECT 1 FROM public.patient_accounts a
        WHERE a.network_patient_id = p_network_patient_id AND a.status = 'active'
     )
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.resolve_patient_portal_recovery(p_token_hash text)
RETURNS TABLE (email text, locale text, clinic_name text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.email, a.locale, o.name, i.expires_at
    FROM public.portal_invitations i
    JOIN public.patient_accounts a ON a.network_patient_id = i.network_patient_id
    JOIN public.organizations o ON o.id = i.organization_id
   WHERE i.token_hash = p_token_hash AND i.kind = 'recovery'
     AND i.used_at IS NULL AND i.expires_at > now() AND a.status = 'active'
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.reset_patient_portal_password(p_token_hash text, p_password_hash text)
RETURNS TABLE (account_id uuid, network_patient_id uuid, email text, locale text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv public.portal_invitations%ROWTYPE; acct public.patient_accounts%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM public.portal_invitations
   WHERE token_hash = p_token_hash AND kind = 'recovery'
     AND used_at IS NULL AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'portal recovery unavailable'; END IF;
  SELECT a.* INTO acct FROM public.patient_accounts a
   WHERE a.network_patient_id = inv.network_patient_id AND a.status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'portal recovery unavailable'; END IF;
  UPDATE public.patient_accounts SET password_hash = p_password_hash,
    failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = acct.id;
  UPDATE public.patient_sessions s SET revoked_at = now()
   WHERE s.account_id = acct.id AND s.revoked_at IS NULL;
  UPDATE public.portal_invitations SET used_at = now() WHERE id = inv.id;
  RETURN QUERY SELECT acct.id, acct.network_patient_id, acct.email, acct.locale;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.patient_portal_links()
RETURNS TABLE (organization_id uuid, patient_id uuid, organization_name text,
               timezone text, currency_display text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.organization_id, l.patient_id, o.name, o.timezone,
         coalesce(o.settings->>'currencyDisplay', o.default_currency)
    FROM public.patient_identity_links l
    JOIN public.organizations o ON o.id = l.organization_id
   WHERE app_private.current_actor_type() = 'patient'
     AND l.network_patient_id = app_private.current_network_patient()
     AND l.status = 'active'
   ORDER BY o.name, l.patient_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.patient_portal_account_exists(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.resolve_patient_portal_recovery(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.reset_patient_portal_password(text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.patient_portal_links() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.patient_portal_account_exists(uuid) TO cabinet_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.resolve_patient_portal_recovery(text) TO cabinet_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.reset_patient_portal_password(text, text) TO cabinet_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.patient_portal_links() TO cabinet_app;--> statement-breakpoint
SELECT app_private.apply_security();
