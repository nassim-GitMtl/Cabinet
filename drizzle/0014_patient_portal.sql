CREATE TYPE "public"."patient_account_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "patient_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"network_patient_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"locale" text DEFAULT 'fr' NOT NULL,
	"status" "patient_account_status" DEFAULT 'active' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"network_patient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portal_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"network_patient_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_accounts" ADD CONSTRAINT "patient_accounts_network_patient_id_network_patients_id_fk" FOREIGN KEY ("network_patient_id") REFERENCES "public"."network_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_sessions" ADD CONSTRAINT "patient_sessions_account_id_patient_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."patient_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_sessions" ADD CONSTRAINT "patient_sessions_network_patient_id_network_patients_id_fk" FOREIGN KEY ("network_patient_id") REFERENCES "public"."network_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_network_patient_id_network_patients_id_fk" FOREIGN KEY ("network_patient_id") REFERENCES "public"."network_patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_accounts_network_uq" ON "patient_accounts" USING btree ("network_patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_accounts_email_lower_uq" ON "patient_accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "patient_sessions_account_idx" ON "patient_sessions" USING btree ("account_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_invitations_token_uq" ON "portal_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_invitations_patient_idx" ON "portal_invitations" USING btree ("organization_id","patient_id","created_at");
--> statement-breakpoint
SELECT app_private.apply_security();
--> statement-breakpoint
-- Patient accounts are global identities. They are never visible to staff or
-- another patient; public activation/login use the narrow SECURITY DEFINER
-- functions below.
ALTER TABLE public.patient_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_accounts FROM cabinet_app;
GRANT SELECT, UPDATE ON public.patient_accounts TO cabinet_app;
CREATE POLICY patient_account_self ON public.patient_accounts
  USING (app_private.current_actor_type() = 'patient'
         AND network_patient_id = app_private.current_network_patient())
  WITH CHECK (app_private.current_actor_type() = 'patient'
         AND network_patient_id = app_private.current_network_patient());
--> statement-breakpoint
ALTER TABLE public.patient_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_sessions FROM cabinet_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_sessions TO cabinet_app;
CREATE POLICY patient_session_self ON public.patient_sessions
  USING (app_private.current_actor_type() = 'patient'
         AND network_patient_id = app_private.current_network_patient())
  WITH CHECK (app_private.current_actor_type() = 'patient'
         AND network_patient_id = app_private.current_network_patient());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.resolve_portal_invitation(p_token_hash text)
RETURNS TABLE (email text, locale text, clinic_name text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.email, p.preferred_locale, o.name, i.expires_at
    FROM public.portal_invitations i
    JOIN public.patients p ON p.id = i.patient_id
    JOIN public.organizations o ON o.id = i.organization_id
   WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.expires_at > now()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.activate_patient_portal(p_token_hash text, p_password_hash text)
RETURNS TABLE (account_id uuid, network_patient_id uuid, email text, locale text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv public.portal_invitations%ROWTYPE; patient_locale text; new_id uuid;
BEGIN
  SELECT * INTO inv FROM public.portal_invitations
   WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now() FOR UPDATE;
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
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.patient_account_for_login(p_email text)
RETURNS TABLE (account_id uuid, network_patient_id uuid, email text, password_hash text,
               locale text, status patient_account_status, failed_login_count integer, locked_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.network_patient_id, a.email, a.password_hash, a.locale, a.status,
         a.failed_login_count, a.locked_until
    FROM public.patient_accounts a WHERE lower(a.email) = lower(p_email) LIMIT 1
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.patient_session_lookup(p_session_hash text)
RETURNS TABLE (session_id text, account_id uuid, network_patient_id uuid, email text, locale text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, a.id, a.network_patient_id, a.email, a.locale, s.expires_at
    FROM public.patient_sessions s JOIN public.patient_accounts a ON a.id = s.account_id
   WHERE s.id = p_session_hash AND s.revoked_at IS NULL AND s.expires_at > now() AND a.status = 'active'
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.patient_consent_organizations()
RETURNS TABLE (organization_id uuid, organization_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT o.id, o.name FROM public.organizations o
   WHERE app_private.current_actor_type() = 'patient'
     AND (
       EXISTS (SELECT 1 FROM public.consent_requests r
                WHERE r.network_patient_id = app_private.current_network_patient()
                  AND r.requesting_organization_id = o.id)
       OR EXISTS (SELECT 1 FROM public.consent_grants g
                  WHERE g.network_patient_id = app_private.current_network_patient()
                    AND g.receiving_organization_id = o.id)
     )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.resolve_portal_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.activate_patient_portal(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.patient_account_for_login(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.patient_session_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.patient_consent_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.resolve_portal_invitation(text) TO cabinet_app;
GRANT EXECUTE ON FUNCTION app_private.activate_patient_portal(text, text) TO cabinet_app;
GRANT EXECUTE ON FUNCTION app_private.patient_account_for_login(text) TO cabinet_app;
GRANT EXECUTE ON FUNCTION app_private.patient_session_lookup(text) TO cabinet_app;
GRANT EXECUTE ON FUNCTION app_private.patient_consent_organizations() TO cabinet_app;
--> statement-breakpoint
-- A portal patient may revoke a grant, but can never widen or otherwise edit it
-- after approval. Corrections require a new request and a new grant.
CREATE OR REPLACE FUNCTION app_private.guard_consent_grant_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'revoked'
     AND NEW.network_patient_id = OLD.network_patient_id
     AND NEW.receiving_organization_id = OLD.receiving_organization_id
     AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
     AND NEW.approver_type = OLD.approver_type
     AND NEW.approver_ref = OLD.approver_ref
     AND NEW.verification_method = OLD.verification_method
     AND NEW.verification_evidence_ref IS NOT DISTINCT FROM OLD.verification_evidence_ref
     AND NEW.purpose = OLD.purpose
     AND NEW.categories = OLD.categories
     AND NEW.date_from IS NOT DISTINCT FROM OLD.date_from
     AND NEW.date_to IS NOT DISTINCT FROM OLD.date_to
     AND NEW.include_future_updates = OLD.include_future_updates
     AND NEW.branch_ids IS NOT DISTINCT FROM OLD.branch_ids
     AND NEW.consent_text_version = OLD.consent_text_version
     AND NEW.consent_language = OLD.consent_language
     AND NEW.granted_at = OLD.granted_at
     AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at
     AND NEW.superseded_by_id IS NOT DISTINCT FROM OLD.superseded_by_id
  THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'consent grants are immutable except patient revocation';
END $$;
CREATE TRIGGER consent_grant_update_guard BEFORE UPDATE ON public.consent_grants
FOR EACH ROW EXECUTE FUNCTION app_private.guard_consent_grant_update();
