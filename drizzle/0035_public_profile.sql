CREATE TABLE "clinic_public_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"about" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"whatsapp_phone" text,
	"map_url" text,
	"facebook_url" text,
	"instagram_url" text,
	"booking_link_id" uuid,
	"featured_service_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"show_prices" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinic_public_profiles_slug_format" CHECK ("clinic_public_profiles"."slug" ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
	CONSTRAINT "clinic_public_profiles_featured_max" CHECK (cardinality("clinic_public_profiles"."featured_service_ids") <= 24)
);
--> statement-breakpoint
ALTER TABLE "clinic_public_profiles" ADD CONSTRAINT "clinic_public_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_public_profiles" ADD CONSTRAINT "clinic_public_profiles_booking_link_id_booking_links_id_fk" FOREIGN KEY ("booking_link_id") REFERENCES "public"."booking_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_public_profiles" ADD CONSTRAINT "clinic_public_profiles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_public_profiles_org_uq" ON "clinic_public_profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_public_profiles_slug_uq" ON "clinic_public_profiles" USING btree ("slug");--> statement-breakpoint
-- Same-clinic references only, and the editor is the acting staff member.
CREATE OR REPLACE FUNCTION app_private.guard_clinic_public_profile() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app_private.current_actor_type() <> 'staff' OR NEW.updated_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'public profile: must be edited by the staff actor';
  END IF;
  IF NEW.booking_link_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.booking_links l WHERE l.id = NEW.booking_link_id AND l.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'public profile: booking link must belong to the same organization';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.featured_service_ids) AS f(service_id)
              WHERE NOT EXISTS (SELECT 1 FROM public.services s WHERE s.id = f.service_id AND s.organization_id = NEW.organization_id)) THEN
    RAISE EXCEPTION 'public profile: featured services must belong to the same organization';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinic_public_profiles_guard BEFORE INSERT OR UPDATE ON public.clinic_public_profiles
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_clinic_public_profile();
--> statement-breakpoint
-- Visitors have no session: resolve a published page of an active clinic to its organization, nothing more.
CREATE OR REPLACE FUNCTION app_private.resolve_public_clinic(p_slug text)
  RETURNS TABLE (organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.organization_id
    FROM public.clinic_public_profiles p
    JOIN public.organizations o ON o.id = p.organization_id
   WHERE p.slug = lower(p_slug) AND p.is_published AND o.status = 'active'
$$;
--> statement-breakpoint
-- Slug availability across clinics without revealing which clinic owns it.
CREATE OR REPLACE FUNCTION app_private.public_slug_taken(p_slug text, p_organization_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.clinic_public_profiles WHERE slug = lower(p_slug) AND organization_id <> p_organization_id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.resolve_public_clinic(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.public_slug_taken(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.resolve_public_clinic(text) TO cabinet_app;
GRANT EXECUTE ON FUNCTION app_private.public_slug_taken(text, uuid) TO cabinet_app;
--> statement-breakpoint
SELECT app_private.apply_security();
