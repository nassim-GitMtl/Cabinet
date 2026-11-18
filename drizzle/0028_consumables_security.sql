-- Consumables from completed procedures (inventory phase 2).
CREATE OR REPLACE FUNCTION app_private.no_delete_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'payments', 'cash_sessions', 'expenses', 'appointments', 'booking_requests',
    'treatment_plans', 'clinical_notes', 'questionnaire_versions', 'inventory_items',
    'inventory_purchase_orders', 'inventory_item_identifiers', 'procedure_consumptions'
  ]::text[] $$;
--> statement-breakpoint
SELECT app_private.apply_security();
--> statement-breakpoint
-- Every referenced row must belong to the same clinic (FK checks ignore RLS).
CREATE OR REPLACE FUNCTION app_private.check_consumable_links() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'service_consumables' THEN
    IF NOT EXISTS (SELECT 1 FROM public.services s WHERE s.id = NEW.service_id AND s.organization_id = NEW.organization_id)
       OR NOT EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.id = NEW.item_id AND i.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'inventory: recipe links must stay within one clinic';
    END IF;
  ELSIF TG_TABLE_NAME = 'procedure_consumptions' THEN
    IF NOT EXISTS (SELECT 1 FROM public.performed_procedures p WHERE p.id = NEW.performed_procedure_id AND p.organization_id = NEW.organization_id)
       OR NOT EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.id = NEW.item_id AND i.organization_id = NEW.organization_id)
       OR NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id AND b.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'inventory: consumption links must stay within one clinic';
    END IF;
  ELSIF TG_TABLE_NAME = 'inventory_movements' AND NEW.performed_procedure_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.performed_procedures p WHERE p.id = NEW.performed_procedure_id AND p.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'inventory: movement procedure must belong to the same clinic';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS service_consumables_links ON public.service_consumables;
CREATE TRIGGER service_consumables_links BEFORE INSERT OR UPDATE ON public.service_consumables
  FOR EACH ROW EXECUTE FUNCTION app_private.check_consumable_links();
--> statement-breakpoint
DROP TRIGGER IF EXISTS procedure_consumptions_links ON public.procedure_consumptions;
CREATE TRIGGER procedure_consumptions_links BEFORE INSERT ON public.procedure_consumptions
  FOR EACH ROW EXECUTE FUNCTION app_private.check_consumable_links();
--> statement-breakpoint
DROP TRIGGER IF EXISTS inventory_movements_procedure_link ON public.inventory_movements;
CREATE TRIGGER inventory_movements_procedure_link BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION app_private.check_consumable_links();
--> statement-breakpoint
-- pending -> consumed | skipped, then frozen.
CREATE OR REPLACE FUNCTION app_private.guard_procedure_consumption() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  decision_cols text[] := ARRAY['status', 'note', 'decided_by_user_id', 'decided_at'];
BEGIN
  IF OLD.status = 'pending' AND (to_jsonb(NEW) - decision_cols) = (to_jsonb(OLD) - decision_cols) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'inventory: decided consumptions are immutable';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS procedure_consumptions_guard ON public.procedure_consumptions;
CREATE TRIGGER procedure_consumptions_guard BEFORE UPDATE ON public.procedure_consumptions
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_procedure_consumption();
