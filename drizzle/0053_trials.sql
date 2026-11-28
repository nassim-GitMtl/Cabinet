CREATE TABLE "trial_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"clinic_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"city" text,
	"practitioners" integer,
	"message" text,
	"locale" text DEFAULT 'fr' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"converted_organization_id" uuid,
	"handled_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trial_requests_status_valid" CHECK ("trial_requests"."status" in ('new', 'contacted', 'converted', 'declined')),
	CONSTRAINT "trial_requests_locale_valid" CHECK ("trial_requests"."locale" in ('fr', 'en', 'ar')),
	CONSTRAINT "trial_requests_text_valid" CHECK (length(trim("trial_requests"."clinic_name")) between 2 and 160 and length(trim("trial_requests"."contact_name")) between 2 and 120
        and length("trial_requests"."phone") between 6 and 32 and length("trial_requests"."email") between 5 and 200
        and ("trial_requests"."message" is null or length("trial_requests"."message") <= 1000) and ("trial_requests"."city" is null or length("trial_requests"."city") <= 120)
        and ("trial_requests"."practitioners" is null or "trial_requests"."practitioners" between 1 and 100))
);
--> statement-breakpoint
ALTER TABLE "auth_rate_limits" DROP CONSTRAINT "auth_rate_limits_scope_ck";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trial_requests" ADD CONSTRAINT "trial_requests_converted_organization_id_organizations_id_fk" FOREIGN KEY ("converted_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_requests" ADD CONSTRAINT "trial_requests_handled_by_user_id_users_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trial_requests_created_idx" ON "trial_requests" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "auth_rate_limits" ADD CONSTRAINT "auth_rate_limits_scope_ck" CHECK ("auth_rate_limits"."scope" in ('staff_login', 'patient_login', 'password_reset', 'trial_request'));--> statement-breakpoint
-- Platform data: no clinic may read it; only the functions below (operator checks inside) and the public submit.
ALTER TABLE public.trial_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trial_requests FROM cabinet_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.submit_trial_request(
  p_clinic_name text, p_contact_name text, p_phone text, p_email text, p_city text, p_practitioners integer, p_message text, p_locale text
) RETURNS uuid
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO public.trial_requests (clinic_name, contact_name, phone, email, city, practitioners, message, locale)
  VALUES (trim(p_clinic_name), trim(p_contact_name), trim(p_phone), lower(trim(p_email)), nullif(trim(p_city), ''), p_practitioners,
          nullif(trim(p_message), ''), CASE WHEN p_locale IN ('fr', 'en', 'ar') THEN p_locale ELSE 'fr' END)
  RETURNING id $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.platform_list_trial_requests()
RETURNS TABLE (id uuid, clinic_name text, contact_name text, phone text, email text, city text, practitioners integer,
               message text, locale text, status text, converted_organization_id uuid, created_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT app_private.is_platform_operator() THEN RAISE EXCEPTION 'platform access denied' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT r.id, r.clinic_name, r.contact_name, r.phone, r.email, r.city, r.practitioners, r.message, r.locale,
                      r.status, r.converted_organization_id, r.created_at
                 FROM public.trial_requests r ORDER BY (r.status = 'new') DESC, r.created_at DESC LIMIT 200;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.platform_update_trial_request(p_id uuid, p_status text, p_organization_id uuid)
RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT app_private.is_platform_operator() THEN RAISE EXCEPTION 'platform access denied' USING ERRCODE = '42501'; END IF;
  UPDATE public.trial_requests
     SET status = p_status, converted_organization_id = coalesce(p_organization_id, converted_organization_id),
         handled_by_user_id = nullif(current_setting('app.user_id', true), '')::uuid, updated_at = now()
   WHERE id = p_id;
  RETURN FOUND;
END $$;
--> statement-breakpoint
-- Trial end per clinic (null = paid). Operator only.
CREATE OR REPLACE FUNCTION app_private.platform_set_trial(p_organization_id uuid, p_trial_ends_at timestamptz) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT app_private.is_platform_operator() THEN RAISE EXCEPTION 'platform access denied' USING ERRCODE = '42501'; END IF;
  UPDATE public.organizations SET trial_ends_at = p_trial_ends_at, updated_at = now() WHERE organizations.id = p_organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN p_organization_id;
END $$;
--> statement-breakpoint
-- Every product module (keep in sync with src/server/authz/modules.ts; tests/integration/platform.test.ts checks it).
-- 0045's list predates whatsapp_reminders and multi_site, so the console could not turn them on.
CREATE OR REPLACE FUNCTION app_private.platform_set_modules(p_organization_id uuid, p_modules text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE allowed constant text[] := ARRAY['core','online_booking','advanced_clinical','billing','reports','inventory','sterilization',
                                          'patient_engagement','laboratory','whatsapp_reminders','multi_site'];
BEGIN
  IF NOT app_private.is_platform_operator() THEN RAISE EXCEPTION 'platform access denied' USING ERRCODE = '42501'; END IF;
  IF NOT ('core' = ANY (p_modules)) OR EXISTS (SELECT 1 FROM unnest(p_modules) value WHERE NOT value = ANY (allowed)) THEN
    RAISE EXCEPTION 'invalid product module';
  END IF;
  UPDATE public.organizations SET enabled_modules = p_modules, updated_at = now() WHERE organizations.id = p_organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN p_organization_id;
END $$;
--> statement-breakpoint
-- Clinic list for the operator: commercial metadata plus usage counts (no patient or clinical content).
DROP FUNCTION IF EXISTS app_private.platform_list_organizations();
--> statement-breakpoint
CREATE FUNCTION app_private.platform_list_organizations()
RETURNS TABLE (
  id uuid, name text, kind text, status text, owner_name text, owner_email text,
  enabled_modules text[], created_at timestamptz, trial_ends_at timestamptz,
  patients integer, appointments_30d integer, invoices_30d integer, last_activity_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT app_private.is_platform_operator() THEN RAISE EXCEPTION 'platform access denied' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.kind::text, o.status::text, u.full_name, u.email, o.enabled_modules, o.created_at, o.trial_ends_at,
           (SELECT count(*)::int FROM public.patients p WHERE p.organization_id = o.id),
           (SELECT count(*)::int FROM public.appointments a WHERE a.organization_id = o.id AND a.created_at > now() - interval '30 days'),
           (SELECT count(*)::int FROM public.invoices i WHERE i.organization_id = o.id AND i.status = 'issued' AND i.issued_at > now() - interval '30 days'),
           (SELECT max(e.occurred_at) FROM public.audit_events e WHERE e.organization_id = o.id AND e.actor_type = 'staff')
      FROM public.organizations o
      LEFT JOIN public.roles r ON r.organization_id = o.id AND r.key = 'owner'
      LEFT JOIN public.memberships m ON m.organization_id = o.id AND m.role_id = r.id AND m.status = 'active'
      LEFT JOIN public.users u ON u.id = m.user_id
     ORDER BY o.created_at DESC;
END $$;
--> statement-breakpoint
-- New scope for the public trial form: 5 requests per hour per client address.
CREATE OR REPLACE FUNCTION app_private.consume_auth_rate_limit(p_scope text, p_key_hash text)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_limit integer;
  v_window interval;
  v_block interval;
  v_bucket public.auth_rate_limits%ROWTYPE;
  v_count integer;
BEGIN
  CASE p_scope
    WHEN 'staff_login' THEN v_limit := 30; v_window := interval '15 minutes'; v_block := interval '15 minutes';
    WHEN 'patient_login' THEN v_limit := 30; v_window := interval '15 minutes'; v_block := interval '15 minutes';
    WHEN 'password_reset' THEN v_limit := 10; v_window := interval '1 hour'; v_block := interval '1 hour';
    WHEN 'trial_request' THEN v_limit := 5; v_window := interval '1 hour'; v_block := interval '1 hour';
    ELSE RAISE EXCEPTION 'unknown authentication rate-limit scope';
  END CASE;
  IF p_key_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid authentication rate-limit key'; END IF;

  INSERT INTO public.auth_rate_limits(scope, key_hash, window_started_at, attempt_count, updated_at)
  VALUES (p_scope, p_key_hash, v_now, 0, v_now)
  ON CONFLICT (scope, key_hash) DO NOTHING;

  SELECT * INTO v_bucket
  FROM public.auth_rate_limits r
  WHERE r.scope = p_scope AND r.key_hash = p_key_hash
  FOR UPDATE;

  IF v_bucket.blocked_until IS NOT NULL AND v_bucket.blocked_until > v_now THEN
    RETURN QUERY SELECT false, greatest(1, ceil(extract(epoch FROM v_bucket.blocked_until - v_now))::integer);
    RETURN;
  END IF;

  -- A completed block starts a clean window instead of immediately re-blocking the client.
  IF v_bucket.blocked_until IS NOT NULL OR v_bucket.window_started_at + v_window <= v_now THEN
    UPDATE public.auth_rate_limits SET window_started_at = v_now, attempt_count = 1,
      blocked_until = NULL, updated_at = v_now
    WHERE scope = p_scope AND key_hash = p_key_hash;
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  v_count := v_bucket.attempt_count + 1;
  IF v_count > v_limit THEN
    UPDATE public.auth_rate_limits SET attempt_count = v_count, blocked_until = v_now + v_block, updated_at = v_now
    WHERE scope = p_scope AND key_hash = p_key_hash;
    RETURN QUERY SELECT false, extract(epoch FROM v_block)::integer;
  ELSE
    UPDATE public.auth_rate_limits SET attempt_count = v_count, updated_at = v_now
    WHERE scope = p_scope AND key_hash = p_key_hash;
    RETURN QUERY SELECT true, 0;
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.submit_trial_request(text, text, text, text, text, integer, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.platform_list_trial_requests() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.platform_update_trial_request(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.platform_set_trial(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.platform_list_organizations() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.submit_trial_request(text, text, text, text, text, integer, text, text) TO cabinet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.platform_list_trial_requests() TO cabinet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.platform_update_trial_request(uuid, text, uuid) TO cabinet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.platform_set_trial(uuid, timestamptz) TO cabinet_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.platform_list_organizations() TO cabinet_app;
--> statement-breakpoint
SELECT app_private.apply_security();
