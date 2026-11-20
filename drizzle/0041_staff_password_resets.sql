CREATE TYPE "public"."staff_password_reset_channel" AS ENUM('admin_link', 'email', 'server_command');--> statement-breakpoint
CREATE TABLE "staff_password_resets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"channel" "staff_password_reset_channel" NOT NULL,
	"issued_by_organization_id" uuid,
	"issued_by_user_id" uuid,
	"reset_mfa" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_password_resets" ADD CONSTRAINT "staff_password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_password_resets" ADD CONSTRAINT "staff_password_resets_issued_by_organization_id_organizations_id_fk" FOREIGN KEY ("issued_by_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_password_resets" ADD CONSTRAINT "staff_password_resets_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_password_resets_token_uq" ON "staff_password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_password_resets_user_idx" ON "staff_password_resets" USING btree ("user_id","created_at");--> statement-breakpoint
-- Platform auth table (like staff_mfa_challenges): no organization_id column, so no tenant RLS; reached only
-- through src/server/auth/password-reset.ts. Rows are never deleted: they are the reset history.
GRANT SELECT, INSERT, UPDATE ON public.staff_password_resets TO cabinet_app;
--> statement-breakpoint
ALTER TABLE public.staff_password_resets ADD CONSTRAINT staff_password_resets_admin_issuer_ck
  CHECK (channel <> 'admin_link' OR (issued_by_organization_id IS NOT NULL AND issued_by_user_id IS NOT NULL));
--> statement-breakpoint
-- Only used_at / revoked_at may be set, once; everything else is frozen.
CREATE OR REPLACE FUNCTION app_private.guard_staff_password_reset() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.token_hash <> OLD.token_hash OR NEW.channel <> OLD.channel
     OR NEW.issued_by_organization_id IS DISTINCT FROM OLD.issued_by_organization_id
     OR NEW.issued_by_user_id IS DISTINCT FROM OLD.issued_by_user_id OR NEW.reset_mfa <> OLD.reset_mfa
     OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at
     OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'staff password reset: only a single use or revocation may be recorded';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER staff_password_resets_guard BEFORE UPDATE ON public.staff_password_resets
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_staff_password_reset();
--> statement-breakpoint
-- Can a clinic reset this account? Only an active, non-operator account whose only active clinic is this
-- one: otherwise an admin of clinic A could take over the access the same person has at clinic B.
CREATE OR REPLACE FUNCTION app_private.staff_reset_scope(p_user_id uuid, p_organization_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.status = 'active' AND u.platform_role = 'none')
      THEN 'unavailable'
    WHEN NOT EXISTS (SELECT 1 FROM public.memberships m
                      WHERE m.user_id = p_user_id AND m.organization_id = p_organization_id AND m.status = 'active')
      THEN 'unavailable'
    WHEN EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.user_id = p_user_id AND m.organization_id <> p_organization_id AND m.status = 'active')
      THEN 'shared'
    ELSE 'ok'
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.staff_reset_scope(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.staff_reset_scope(uuid, uuid) TO cabinet_app;
--> statement-breakpoint
SELECT app_private.apply_security();
