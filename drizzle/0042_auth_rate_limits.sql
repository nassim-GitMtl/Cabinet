CREATE TABLE "auth_rate_limits" (
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_rate_limits_scope_key_hash_pk" PRIMARY KEY("scope","key_hash"),
	CONSTRAINT "auth_rate_limits_scope_ck" CHECK ("auth_rate_limits"."scope" in ('staff_login', 'patient_login', 'password_reset')),
	CONSTRAINT "auth_rate_limits_key_hash_ck" CHECK (char_length("auth_rate_limits"."key_hash") = 64),
	CONSTRAINT "auth_rate_limits_attempt_count_ck" CHECK ("auth_rate_limits"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limits_updated_idx" ON "auth_rate_limits" USING btree ("updated_at");
--> statement-breakpoint
-- Platform security infrastructure: the app role cannot inspect or mutate buckets directly. It can only
-- atomically consume a configured bucket through the function below.
REVOKE ALL ON public.auth_rate_limits FROM cabinet_app;
--> statement-breakpoint
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
REVOKE ALL ON FUNCTION app_private.consume_auth_rate_limit(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.consume_auth_rate_limit(text, text) TO cabinet_app;
--> statement-breakpoint
SELECT app_private.apply_security();
