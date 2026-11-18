CREATE TYPE "public"."inventory_identifier_format" AS ENUM('ean13', 'gtin', 'code128', 'qr', 'other');--> statement-breakpoint
CREATE TABLE "inventory_item_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"format" "inventory_identifier_format" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"deactivated_by_user_id" uuid,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_item_identifiers_deactivation_complete" CHECK (("inventory_item_identifiers"."is_active" and "inventory_item_identifiers"."deactivated_at" is null and "inventory_item_identifiers"."deactivated_by_user_id" is null) or (not "inventory_item_identifiers"."is_active" and "inventory_item_identifiers"."deactivated_at" is not null and "inventory_item_identifiers"."deactivated_by_user_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "inventory_item_identifiers" ADD CONSTRAINT "inventory_item_identifiers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_identifiers" ADD CONSTRAINT "inventory_item_identifiers_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_identifiers" ADD CONSTRAINT "inventory_item_identifiers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_identifiers" ADD CONSTRAINT "inventory_item_identifiers_deactivated_by_user_id_users_id_fk" FOREIGN KEY ("deactivated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_item_identifiers_org_code_uq" ON "inventory_item_identifiers" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "inventory_item_identifiers_item_idx" ON "inventory_item_identifiers" USING btree ("organization_id","item_id","is_active");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings', 'clinical_note_versions',
    'questionnaire_responses', 'health_history_reviews', 'inventory_lots', 'inventory_movements',
    'inventory_purchase_order_lines'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.no_delete_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'payments', 'cash_sessions', 'expenses', 'appointments', 'booking_requests',
    'treatment_plans', 'clinical_notes', 'questionnaire_versions', 'inventory_items',
    'inventory_purchase_orders', 'inventory_item_identifiers'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_inventory_item_identifier() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  item_org uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT organization_id INTO item_org FROM public.inventory_items WHERE id = NEW.item_id;
    IF item_org IS NULL OR item_org <> NEW.organization_id THEN
      RAISE EXCEPTION 'inventory: identifier item must belong to the same organization';
    END IF;
    IF NEW.created_by_user_id IS DISTINCT FROM app_private.current_user_id() OR NOT NEW.is_active
       OR NEW.deactivated_by_user_id IS NOT NULL OR NEW.deactivated_at IS NOT NULL THEN
      RAISE EXCEPTION 'inventory: invalid identifier actor or initial state';
    END IF;
  ELSE
    IF NEW.organization_id <> OLD.organization_id OR NEW.item_id <> OLD.item_id OR NEW.code <> OLD.code
       OR NEW.format <> OLD.format OR NEW.created_by_user_id <> OLD.created_by_user_id
       OR NEW.created_at <> OLD.created_at OR NOT OLD.is_active OR NEW.is_active
       OR NEW.deactivated_by_user_id IS DISTINCT FROM app_private.current_user_id()
       OR NEW.deactivated_at IS NULL THEN
      RAISE EXCEPTION 'inventory: identifier may only be deactivated once';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_item_identifiers_guard BEFORE INSERT OR UPDATE ON public.inventory_item_identifiers
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_inventory_item_identifier();
--> statement-breakpoint
SELECT app_private.apply_security();
