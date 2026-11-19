CREATE TABLE "clinic_logos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinic_logos_mime" CHECK ("clinic_logos"."mime_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "clinic_logos_size" CHECK ("clinic_logos"."byte_size" > 0 and "clinic_logos"."byte_size" <= 307200)
);
--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "issuer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issuer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "issuer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "clinic_logos" ADD CONSTRAINT "clinic_logos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_logos" ADD CONSTRAINT "clinic_logos_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_logos_org_uq" ON "clinic_logos" USING btree ("organization_id");--> statement-breakpoint
-- Backfill: documents issued before this migration get today's issuer details. They are still the details
-- printed so far (no screen could edit the legal entity before), so nothing printed changes.
CREATE OR REPLACE FUNCTION app_private.issuer_snapshot_for(p_legal_entity_id uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
           'clinicName', o.name, 'legalName', le.legal_name, 'address', coalesce(le.address, b.address),
           'identifiers', le.identifiers, 'phone', b.phone, 'email', b.email)
    FROM public.legal_entities le
    JOIN public.organizations o ON o.id = le.organization_id
    LEFT JOIN LATERAL (SELECT br.address, br.phone, br.email FROM public.branches br
                        WHERE br.legal_entity_id = le.id AND br.is_active ORDER BY br.created_at LIMIT 1) b ON true
   WHERE le.id = p_legal_entity_id
$$;
--> statement-breakpoint
ALTER TABLE public.invoices DISABLE TRIGGER invoices_guard;
--> statement-breakpoint
UPDATE public.invoices SET issuer_snapshot = app_private.issuer_snapshot_for(legal_entity_id)
 WHERE status <> 'draft' AND issuer_snapshot IS NULL;
--> statement-breakpoint
ALTER TABLE public.invoices ENABLE TRIGGER invoices_guard;
--> statement-breakpoint
ALTER TABLE public.payments DISABLE TRIGGER payments_guard;
--> statement-breakpoint
UPDATE public.payments SET issuer_snapshot = app_private.issuer_snapshot_for(legal_entity_id) WHERE issuer_snapshot IS NULL;
--> statement-breakpoint
ALTER TABLE public.payments ENABLE TRIGGER payments_guard;
--> statement-breakpoint
UPDATE public.credit_notes SET issuer_snapshot = app_private.issuer_snapshot_for(legal_entity_id) WHERE issuer_snapshot IS NULL;
--> statement-breakpoint
-- From now on every issued document carries its own issuer copy (then frozen by the existing ledger guards).
CREATE OR REPLACE FUNCTION app_private.require_issuer_snapshot() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  -- Only invoices have a draft stage; payments (receipts) and credit notes are issued on insert.
  -- Field access stays inside the invoices branch: other tables have no (or a different) status.
  IF NEW.issuer_snapshot IS NULL THEN
    IF TG_TABLE_NAME = 'invoices' THEN
      IF NEW.status::text <> 'draft' THEN
        RAISE EXCEPTION 'ledger: issued documents must carry the issuer details';
      END IF;
    ELSE
      RAISE EXCEPTION 'ledger: issued documents must carry the issuer details';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_issuer_required BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION app_private.require_issuer_snapshot();
--> statement-breakpoint
CREATE TRIGGER payments_issuer_required BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION app_private.require_issuer_snapshot();
--> statement-breakpoint
CREATE TRIGGER credit_notes_issuer_required BEFORE INSERT ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION app_private.require_issuer_snapshot();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_clinic_logo() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app_private.current_actor_type() <> 'staff' OR NEW.updated_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'clinic logo: must be changed by the staff actor';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER clinic_logos_guard BEFORE INSERT OR UPDATE ON public.clinic_logos
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_clinic_logo();
--> statement-breakpoint
SELECT app_private.apply_security();
