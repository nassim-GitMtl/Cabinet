CREATE TYPE "public"."inventory_movement_kind" AS ENUM('receipt', 'usage', 'adjustment_in', 'adjustment_out', 'expired', 'waste');--> statement-breakpoint
CREATE TYPE "public"."inventory_unit" AS ENUM('piece', 'box', 'pack', 'bottle', 'cartridge', 'milliliter', 'gram');--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"unit" "inventory_unit" NOT NULL,
	"minimum_stock" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_minimum_nonnegative" CHECK ("inventory_items"."minimum_stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"lot_number" text NOT NULL,
	"expires_on" date,
	"received_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" "inventory_movement_kind" NOT NULL,
	"quantity_delta" integer NOT NULL,
	"occurred_on" date NOT NULL,
	"reference" text,
	"reason" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_nonzero" CHECK ("inventory_movements"."quantity_delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_org_sku_uq" ON "inventory_items" USING btree ("organization_id",lower("sku"));--> statement-breakpoint
CREATE INDEX "inventory_items_org_name_idx" ON "inventory_items" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_lots_identity_uq" ON "inventory_lots" USING btree ("organization_id","item_id","branch_id",lower("lot_number"));--> statement-breakpoint
CREATE INDEX "inventory_lots_fefo_idx" ON "inventory_lots" USING btree ("organization_id","item_id","branch_id","expires_on");--> statement-breakpoint
CREATE INDEX "inventory_movements_lot_idx" ON "inventory_movements" USING btree ("organization_id","lot_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_item_idx" ON "inventory_movements" USING btree ("organization_id","item_id","branch_id","occurred_on");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings', 'clinical_note_versions',
    'questionnaire_responses', 'health_history_reviews', 'inventory_lots', 'inventory_movements'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.no_delete_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'payments', 'cash_sessions', 'expenses', 'appointments', 'booking_requests',
    'treatment_plans', 'clinical_notes', 'questionnaire_versions', 'inventory_items'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_inventory_lot() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  item_org uuid;
  branch_org uuid;
BEGIN
  SELECT organization_id INTO item_org FROM public.inventory_items WHERE id = NEW.item_id;
  SELECT organization_id INTO branch_org FROM public.branches WHERE id = NEW.branch_id;
  IF item_org IS NULL OR branch_org IS NULL OR item_org <> NEW.organization_id OR branch_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'inventory: lot references must belong to the same organization';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_lots_guard BEFORE INSERT ON public.inventory_lots
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_inventory_lot();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_inventory_movement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  lot_org uuid;
  lot_item uuid;
  lot_branch uuid;
  resulting_balance integer;
BEGIN
  IF NEW.created_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'inventory: movement actor does not match the request context';
  END IF;
  SELECT organization_id, item_id, branch_id INTO lot_org, lot_item, lot_branch
    FROM public.inventory_lots WHERE id = NEW.lot_id FOR UPDATE;
  IF lot_org IS NULL OR lot_org <> NEW.organization_id OR lot_item <> NEW.item_id OR lot_branch <> NEW.branch_id THEN
    RAISE EXCEPTION 'inventory: movement must match its lot and organization';
  END IF;
  IF NEW.kind IN ('receipt', 'adjustment_in') AND NEW.quantity_delta <= 0 THEN
    RAISE EXCEPTION 'inventory: inbound movement must be positive';
  END IF;
  IF NEW.kind IN ('usage', 'adjustment_out', 'expired', 'waste') AND NEW.quantity_delta >= 0 THEN
    RAISE EXCEPTION 'inventory: outbound movement must be negative';
  END IF;
  SELECT coalesce(sum(quantity_delta), 0)::integer + NEW.quantity_delta INTO resulting_balance
    FROM public.inventory_movements WHERE lot_id = NEW.lot_id;
  IF resulting_balance < 0 THEN
    RAISE EXCEPTION 'inventory: lot balance cannot be negative';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_movements_guard BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_inventory_movement();
--> statement-breakpoint
SELECT app_private.apply_security();
