-- Sterilization traceability: tenant security, no deletes, same-clinic links and release state machine.
CREATE OR REPLACE FUNCTION app_private.no_delete_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'payments', 'cash_sessions', 'expenses', 'appointments', 'booking_requests',
    'treatment_plans', 'clinical_notes', 'questionnaire_versions', 'inventory_items',
    'inventory_purchase_orders', 'inventory_item_identifiers', 'procedure_consumptions',
    'sterilizers', 'instrument_sets', 'sterilization_cycles', 'sterilization_packs', 'sterilization_pack_uses'
  ]::text[] $$;
--> statement-breakpoint
SELECT app_private.apply_security();
--> statement-breakpoint
-- Release is an explicit, authorized act, never a side effect of recording a cycle.
UPDATE public.roles SET permissions = permissions || ARRAY['sterilization.release']::text[]
 WHERE key IN ('owner', 'dentist') AND is_system AND NOT ('sterilization.release' = ANY(permissions));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_sterilizer() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id AND b.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'sterilization: sterilizer branch must belong to the same clinic';
  END IF;
  IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW) - 'is_active') <> (to_jsonb(OLD) - 'is_active') OR (NEW.is_active AND NOT OLD.is_active)) THEN
    RAISE EXCEPTION 'sterilization: equipment records are immutable (deactivate only)';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sterilizers_guard BEFORE INSERT OR UPDATE ON public.sterilizers
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_sterilizer();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_instrument_set() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'is_active') <> (to_jsonb(OLD) - 'is_active') OR (NEW.is_active AND NOT OLD.is_active) THEN
    RAISE EXCEPTION 'sterilization: instrument set codes are immutable (deactivate only)';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER instrument_sets_guard BEFORE UPDATE ON public.instrument_sets
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_instrument_set();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_sterilization_cycle() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  mutable text[] := ARRAY['status', 'decided_by_user_id', 'decided_at', 'decision_note', 'recalled_by_user_id', 'recalled_at',
                          'recall_reason', 'biological_indicator', 'biological_recorded_by_user_id', 'biological_recorded_at'];
  me uuid := app_private.current_user_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.sterilizers s WHERE s.id = NEW.sterilizer_id AND s.organization_id = NEW.organization_id
                    AND s.branch_id = NEW.branch_id AND s.is_active) THEN
      RAISE EXCEPTION 'sterilization: cycle sterilizer must be active, in the same clinic and branch';
    END IF;
    IF NEW.status <> 'pending_release' OR NEW.operator_user_id IS DISTINCT FROM me
       OR NEW.decided_by_user_id IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.recalled_at IS NOT NULL
       OR NEW.biological_recorded_at IS NOT NULL THEN
      RAISE EXCEPTION 'sterilization: a cycle is recorded pending release by its operator';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - mutable) <> (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'sterilization: recorded cycle data is immutable';
  END IF;

  IF NEW.biological_indicator IS DISTINCT FROM OLD.biological_indicator THEN
    IF OLD.biological_indicator <> 'pending' OR NEW.biological_indicator NOT IN ('pass', 'fail')
       OR NEW.biological_recorded_by_user_id IS DISTINCT FROM me OR NEW.biological_recorded_at IS NULL THEN
      RAISE EXCEPTION 'sterilization: a pending biological indicator is resolved once';
    END IF;
  ELSIF NEW.biological_recorded_by_user_id IS DISTINCT FROM OLD.biological_recorded_by_user_id
     OR NEW.biological_recorded_at IS DISTINCT FROM OLD.biological_recorded_at THEN
    RAISE EXCEPTION 'sterilization: biological indicator record is immutable';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'pending_release' AND NEW.status = 'released' THEN
      IF NEW.chemical_indicator = 'fail' OR NEW.air_removal_test = 'fail' OR NEW.biological_indicator = 'fail' THEN
        RAISE EXCEPTION 'sterilization: a failed indicator blocks release';
      END IF;
      IF NEW.decided_by_user_id IS DISTINCT FROM me OR NEW.decided_at IS NULL THEN
        RAISE EXCEPTION 'sterilization: release must record who released';
      END IF;
    ELSIF OLD.status = 'pending_release' AND NEW.status = 'failed' THEN
      IF NEW.decided_by_user_id IS DISTINCT FROM me OR NEW.decided_at IS NULL OR coalesce(btrim(NEW.decision_note), '') = '' THEN
        RAISE EXCEPTION 'sterilization: a failed cycle needs who and why';
      END IF;
    ELSIF OLD.status = 'released' AND NEW.status = 'recalled' THEN
      IF NEW.recalled_by_user_id IS DISTINCT FROM me OR NEW.recalled_at IS NULL OR coalesce(btrim(NEW.recall_reason), '') = '' THEN
        RAISE EXCEPTION 'sterilization: a recall needs who and why';
      END IF;
    ELSE
      RAISE EXCEPTION 'sterilization: invalid cycle transition % -> %', OLD.status, NEW.status;
    END IF;
  END IF;
  IF (NEW.status = OLD.status OR NEW.status = 'recalled')
     AND (NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
          OR NEW.decision_note IS DISTINCT FROM OLD.decision_note) THEN
    RAISE EXCEPTION 'sterilization: release decision is immutable';
  END IF;
  IF NEW.status <> 'recalled' AND (NEW.recalled_at IS NOT NULL OR NEW.recalled_by_user_id IS NOT NULL OR NEW.recall_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'sterilization: recall fields only accompany a recall';
  END IF;
  IF NEW.status = 'recalled' AND OLD.status = 'recalled'
     AND (NEW.recalled_at IS DISTINCT FROM OLD.recalled_at OR NEW.recall_reason IS DISTINCT FROM OLD.recall_reason
          OR NEW.recalled_by_user_id IS DISTINCT FROM OLD.recalled_by_user_id) THEN
    RAISE EXCEPTION 'sterilization: recall record is immutable';
  END IF;
  IF NEW.status = 'released' AND NEW.biological_indicator = 'fail' THEN
    RAISE EXCEPTION 'sterilization: a released cycle with a failed biological indicator must be recalled';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sterilization_cycles_guard BEFORE INSERT OR UPDATE ON public.sterilization_cycles
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_sterilization_cycle();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_sterilization_pack() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.sterilization_cycles c WHERE c.id = NEW.cycle_id AND c.organization_id = NEW.organization_id
                    AND c.status = 'pending_release') THEN
      RAISE EXCEPTION 'sterilization: packs are added to a pending cycle of the same clinic';
    END IF;
    IF NEW.instrument_set_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.instrument_sets s WHERE s.id = NEW.instrument_set_id AND s.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'sterilization: instrument set must belong to the same clinic';
    END IF;
    IF NEW.discarded_at IS NOT NULL OR NEW.discarded_by_user_id IS NOT NULL OR NEW.discard_reason IS NOT NULL THEN
      RAISE EXCEPTION 'sterilization: a new pack cannot be discarded';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['discarded_at', 'discarded_by_user_id', 'discard_reason']) <> (to_jsonb(OLD) - ARRAY['discarded_at', 'discarded_by_user_id', 'discard_reason'])
     OR OLD.discarded_at IS NOT NULL OR NEW.discarded_at IS NULL
     OR NEW.discarded_by_user_id IS DISTINCT FROM app_private.current_user_id() OR coalesce(btrim(NEW.discard_reason), '') = '' THEN
    RAISE EXCEPTION 'sterilization: a pack may only be discarded once, with a reason';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sterilization_packs_guard BEFORE INSERT OR UPDATE ON public.sterilization_packs
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_sterilization_pack();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_sterilization_pack_use() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  cycle_status public.sterilization_cycle_status;
  pack record;
  local_today date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.* INTO pack FROM public.sterilization_packs p WHERE p.id = NEW.pack_id AND p.organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'sterilization: pack must belong to the same clinic';
    END IF;
    -- Lock the cycle so a concurrent recall/failure cannot interleave with a new use.
    SELECT c.status INTO cycle_status FROM public.sterilization_cycles c WHERE c.id = pack.cycle_id FOR SHARE;
    SELECT (now() AT TIME ZONE o.timezone)::date INTO local_today FROM public.organizations o WHERE o.id = NEW.organization_id;
    IF cycle_status <> 'released' THEN
      RAISE EXCEPTION 'sterilization: only packs from a released cycle can be used';
    END IF;
    IF pack.discarded_at IS NOT NULL OR (pack.expires_on IS NOT NULL AND pack.expires_on < local_today) THEN
      RAISE EXCEPTION 'sterilization: discarded or expired packs cannot be used';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.patients pt WHERE pt.id = NEW.patient_id AND pt.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'sterilization: patient must belong to the same clinic';
    END IF;
    IF NEW.performed_procedure_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.performed_procedures pp WHERE pp.id = NEW.performed_procedure_id
            AND pp.organization_id = NEW.organization_id AND pp.patient_id = NEW.patient_id) THEN
      RAISE EXCEPTION 'sterilization: procedure must belong to the same patient';
    END IF;
    IF NEW.used_by_user_id IS DISTINCT FROM app_private.current_user_id()
       OR NEW.voided_at IS NOT NULL OR NEW.voided_by_user_id IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
      RAISE EXCEPTION 'sterilization: invalid pack use actor or initial state';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['voided_at', 'voided_by_user_id', 'void_reason']) <> (to_jsonb(OLD) - ARRAY['voided_at', 'voided_by_user_id', 'void_reason'])
     OR OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
     OR NEW.voided_by_user_id IS DISTINCT FROM app_private.current_user_id() OR coalesce(btrim(NEW.void_reason), '') = '' THEN
    RAISE EXCEPTION 'sterilization: a pack use may only be voided once, with a reason';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sterilization_pack_uses_guard BEFORE INSERT OR UPDATE ON public.sterilization_pack_uses
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_sterilization_pack_use();
