CREATE TYPE "public"."inventory_purchase_order_status" AS ENUM('ordered', 'partially_received', 'received', 'cancelled');--> statement-breakpoint
CREATE TABLE "inventory_purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity_ordered" integer NOT NULL,
	"unit_cost_minor" bigint,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_purchase_order_lines_quantity_positive" CHECK ("inventory_purchase_order_lines"."quantity_ordered" > 0),
	CONSTRAINT "inventory_purchase_order_lines_cost_nonnegative" CHECK ("inventory_purchase_order_lines"."unit_cost_minor" is null or "inventory_purchase_order_lines"."unit_cost_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" "inventory_purchase_order_status" DEFAULT 'ordered' NOT NULL,
	"ordered_on" date NOT NULL,
	"expected_on" date,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "purchase_order_line_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_purchase_order_id_inventory_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."inventory_purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_purchase_order_lines_item_uq" ON "inventory_purchase_order_lines" USING btree ("purchase_order_id","item_id");--> statement-breakpoint
CREATE INDEX "inventory_purchase_order_lines_org_order_idx" ON "inventory_purchase_order_lines" USING btree ("organization_id","purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_purchase_orders_org_number_uq" ON "inventory_purchase_orders" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "inventory_purchase_orders_status_idx" ON "inventory_purchase_orders" USING btree ("organization_id","status","ordered_on");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_purchase_order_line_id_inventory_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."inventory_purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_purchase_order_line_idx" ON "inventory_movements" USING btree ("organization_id","purchase_order_line_id");
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
    'inventory_purchase_orders'
  ]::text[] $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_inventory_purchase_order() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  supplier_org uuid;
  branch_org uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT organization_id INTO supplier_org FROM public.suppliers WHERE id = NEW.supplier_id;
    SELECT organization_id INTO branch_org FROM public.branches WHERE id = NEW.branch_id;
    IF supplier_org IS NULL OR branch_org IS NULL OR supplier_org <> NEW.organization_id OR branch_org <> NEW.organization_id THEN
      RAISE EXCEPTION 'inventory: purchase order references must belong to the same organization';
    END IF;
    IF NEW.created_by_user_id IS DISTINCT FROM app_private.current_user_id() OR NEW.status <> 'ordered' THEN
      RAISE EXCEPTION 'inventory: invalid purchase order actor or initial status';
    END IF;
  ELSE
    IF NEW.organization_id <> OLD.organization_id OR NEW.number <> OLD.number OR NEW.supplier_id <> OLD.supplier_id
       OR NEW.branch_id <> OLD.branch_id OR NEW.ordered_on <> OLD.ordered_on
       OR NEW.expected_on IS DISTINCT FROM OLD.expected_on OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'inventory: only purchase order status may change';
    END IF;
    IF NOT ((OLD.status = 'ordered' AND NEW.status IN ('partially_received', 'received', 'cancelled'))
         OR (OLD.status = 'partially_received' AND NEW.status = 'received')) THEN
      RAISE EXCEPTION 'inventory: invalid purchase order status transition';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_purchase_orders_guard BEFORE INSERT OR UPDATE ON public.inventory_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_inventory_purchase_order();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_inventory_purchase_order_line() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  order_org uuid;
  order_status public.inventory_purchase_order_status;
  item_org uuid;
BEGIN
  SELECT organization_id, status INTO order_org, order_status
    FROM public.inventory_purchase_orders WHERE id = NEW.purchase_order_id;
  SELECT organization_id INTO item_org FROM public.inventory_items WHERE id = NEW.item_id;
  IF order_org IS NULL OR item_org IS NULL OR order_org <> NEW.organization_id OR item_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'inventory: purchase order line references must belong to the same organization';
  END IF;
  IF order_status <> 'ordered' THEN
    RAISE EXCEPTION 'inventory: lines may only be added to an ordered purchase order';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_purchase_order_lines_guard BEFORE INSERT ON public.inventory_purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_inventory_purchase_order_line();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_inventory_movement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  lot_org uuid;
  lot_item uuid;
  lot_branch uuid;
  line_org uuid;
  line_item uuid;
  line_quantity integer;
  order_branch uuid;
  order_status public.inventory_purchase_order_status;
  received_quantity integer;
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
  IF NEW.purchase_order_line_id IS NOT NULL THEN
    SELECT l.organization_id, l.item_id, l.quantity_ordered, o.branch_id, o.status
      INTO line_org, line_item, line_quantity, order_branch, order_status
      FROM public.inventory_purchase_order_lines l
      JOIN public.inventory_purchase_orders o ON o.id = l.purchase_order_id
      WHERE l.id = NEW.purchase_order_line_id FOR UPDATE OF l, o;
    IF line_org IS NULL OR line_org <> NEW.organization_id OR line_item <> NEW.item_id OR order_branch <> NEW.branch_id THEN
      RAISE EXCEPTION 'inventory: receipt must match its purchase order line';
    END IF;
    IF NEW.kind <> 'receipt' OR order_status NOT IN ('ordered', 'partially_received') THEN
      RAISE EXCEPTION 'inventory: purchase order line only accepts receipts on an open order';
    END IF;
    SELECT coalesce(sum(quantity_delta), 0)::integer INTO received_quantity
      FROM public.inventory_movements WHERE purchase_order_line_id = NEW.purchase_order_line_id;
    IF received_quantity + NEW.quantity_delta > line_quantity THEN
      RAISE EXCEPTION 'inventory: receipt exceeds ordered quantity';
    END IF;
  END IF;
  SELECT coalesce(sum(quantity_delta), 0)::integer + NEW.quantity_delta INTO resulting_balance
    FROM public.inventory_movements WHERE lot_id = NEW.lot_id;
  IF resulting_balance < 0 THEN
    RAISE EXCEPTION 'inventory: lot balance cannot be negative';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
SELECT app_private.apply_security();
