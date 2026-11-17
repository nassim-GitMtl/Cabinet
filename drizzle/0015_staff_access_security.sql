CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role_id" uuid NOT NULL,
	"title" text,
	"is_provider" boolean DEFAULT false NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_mfa_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts_remaining" integer DEFAULT 5 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_recovery_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_pending_secret" text;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_mfa_challenges" ADD CONSTRAINT "staff_mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_token_uq" ON "staff_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_invitations_org_idx" ON "staff_invitations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_mfa_challenges_user_idx" ON "staff_mfa_challenges" USING btree ("user_id","expires_at");
--> statement-breakpoint
SELECT app_private.apply_security();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_mfa_challenges TO cabinet_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.resolve_staff_invitation(p_token_hash text)
RETURNS TABLE (email text, full_name text, organization_name text, expires_at timestamptz, existing_user boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.email, i.full_name, o.name, i.expires_at,
         EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = lower(i.email))
    FROM public.staff_invitations i
    JOIN public.organizations o ON o.id = i.organization_id
   WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.expires_at > now()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.accept_staff_invitation(p_token_hash text, p_password_hash text)
RETURNS TABLE (user_id uuid, organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv public.staff_invitations%ROWTYPE; existing_id uuid; new_user_id uuid;
BEGIN
  SELECT * INTO inv FROM public.staff_invitations
   WHERE token_hash = p_token_hash AND accepted_at IS NULL AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff invitation unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.id = inv.role_id AND r.organization_id = inv.organization_id) THEN
    RAISE EXCEPTION 'invitation role unavailable';
  END IF;
  SELECT u.id INTO existing_id FROM public.users u WHERE lower(u.email) = lower(inv.email) LIMIT 1;
  IF existing_id IS NULL THEN
    IF p_password_hash IS NULL THEN RAISE EXCEPTION 'password required'; END IF;
    INSERT INTO public.users (email, full_name, password_hash)
      VALUES (lower(inv.email), inv.full_name, p_password_hash) RETURNING id INTO new_user_id;
  ELSE
    new_user_id := existing_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.memberships m WHERE m.organization_id = inv.organization_id AND m.user_id = new_user_id) THEN
    RAISE EXCEPTION 'membership already exists';
  END IF;
  INSERT INTO public.memberships (organization_id, user_id, role_id, status, display_name, title, is_provider)
    VALUES (inv.organization_id, new_user_id, inv.role_id, 'active', inv.full_name, inv.title, inv.is_provider);
  UPDATE public.staff_invitations SET accepted_at = now() WHERE id = inv.id;
  RETURN QUERY SELECT new_user_id, inv.organization_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.resolve_staff_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.accept_staff_invitation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.resolve_staff_invitation(text) TO cabinet_app;
GRANT EXECUTE ON FUNCTION app_private.accept_staff_invitation(text, text) TO cabinet_app;
