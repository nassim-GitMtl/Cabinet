-- Financial subledger guards (§16). Application services check these rules
-- first; these triggers are the backstop so no code path can break them.

CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['service_prices', 'credit_notes', 'payment_allocations', 'refunds']::text[] $$;
--> statement-breakpoint
SELECT app_private.apply_security();
--> statement-breakpoint
-- Payments: no deletion; updates limited by trigger to reversal.
REVOKE DELETE ON public.payments FROM cabinet_app;
--> statement-breakpoint

-- Issued invoices are immutable except issued -> void (no payments, no credits).
CREATE OR REPLACE FUNCTION app_private.guard_invoice() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  allocated bigint;
  credited bigint;
  immutable_cols text[] := ARRAY['status', 'voided_at', 'voided_by_user_id', 'void_reason', 'updated_at', 'version'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'ledger: only draft invoices can be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status = 'void' THEN
      RAISE EXCEPTION 'ledger: a draft invoice is deleted, not voided';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'issued' AND NEW.status = 'void'
     AND (to_jsonb(NEW) - immutable_cols) = (to_jsonb(OLD) - immutable_cols) THEN
    SELECT coalesce(sum(amount_minor), 0) INTO allocated FROM public.payment_allocations WHERE invoice_id = OLD.id;
    SELECT coalesce(sum(amount_minor), 0) INTO credited FROM public.credit_notes WHERE invoice_id = OLD.id;
    IF allocated <> 0 OR credited <> 0 THEN
      RAISE EXCEPTION 'ledger: invoice with payments or credit notes cannot be voided';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ledger: issued invoices are immutable';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS invoices_guard ON public.invoices;
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_invoice();
--> statement-breakpoint

-- Lines change only while the invoice is a draft; voiding releases them.
CREATE OR REPLACE FUNCTION app_private.guard_invoice_line() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent_status invoice_status;
BEGIN
  SELECT status INTO parent_status FROM public.invoices
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF parent_status IS NULL OR parent_status = 'draft' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND parent_status = 'void' AND NEW.released AND NOT OLD.released
     AND (to_jsonb(NEW) - 'released') = (to_jsonb(OLD) - 'released') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ledger: lines of an issued invoice are immutable';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS invoice_lines_guard ON public.invoice_lines;
CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_invoice_line();
--> statement-breakpoint

-- Payments: only posted -> reversed, and only when nothing is applied or refunded.
CREATE OR REPLACE FUNCTION app_private.guard_payment() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  allocated bigint;
  refunded bigint;
  mutable_cols text[] := ARRAY['status', 'reversed_at', 'reversed_by_user_id', 'reversal_reason'];
BEGIN
  IF OLD.status = 'posted' AND NEW.status = 'reversed'
     AND (to_jsonb(NEW) - mutable_cols) = (to_jsonb(OLD) - mutable_cols) THEN
    SELECT coalesce(sum(amount_minor), 0) INTO allocated FROM public.payment_allocations WHERE payment_id = OLD.id;
    SELECT coalesce(sum(amount_minor), 0) INTO refunded FROM public.refunds WHERE payment_id = OLD.id;
    IF allocated <> 0 OR refunded <> 0 THEN
      RAISE EXCEPTION 'ledger: release allocations and refunds before reversing a payment';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ledger: payments are immutable';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS payments_guard ON public.payments;
CREATE TRIGGER payments_guard BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_payment();
--> statement-breakpoint

-- Allocation invariants (checked after each insert, inside the same transaction).
CREATE OR REPLACE FUNCTION app_private.check_allocation() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  p record;
  i record;
  pay_allocated bigint;
  pay_refunded bigint;
  inv_allocated bigint;
  inv_credited bigint;
  pair_allocated bigint;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = NEW.payment_id;
  SELECT * INTO i FROM public.invoices WHERE id = NEW.invoice_id;
  IF p.currency <> i.currency OR p.legal_entity_id <> i.legal_entity_id OR p.patient_id <> i.patient_id THEN
    RAISE EXCEPTION 'ledger: allocation must stay within one patient account, legal entity and currency';
  END IF;
  IF NEW.amount_minor > 0 AND (p.status <> 'posted' OR i.status <> 'issued') THEN
    RAISE EXCEPTION 'ledger: allocate only posted payments to issued invoices';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO pay_allocated FROM public.payment_allocations WHERE payment_id = p.id;
  SELECT coalesce(sum(amount_minor), 0) INTO pay_refunded FROM public.refunds WHERE payment_id = p.id;
  IF pay_allocated + pay_refunded > p.amount_minor THEN
    RAISE EXCEPTION 'ledger: payment over-allocated';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO inv_allocated FROM public.payment_allocations WHERE invoice_id = i.id;
  SELECT coalesce(sum(amount_minor), 0) INTO inv_credited FROM public.credit_notes WHERE invoice_id = i.id;
  IF inv_allocated > i.total_minor - inv_credited THEN
    RAISE EXCEPTION 'ledger: invoice over-allocated';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO pair_allocated FROM public.payment_allocations
   WHERE payment_id = p.id AND invoice_id = i.id;
  IF pair_allocated < 0 THEN
    RAISE EXCEPTION 'ledger: cannot release more than was allocated';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS payment_allocations_check ON public.payment_allocations;
CREATE TRIGGER payment_allocations_check AFTER INSERT ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION app_private.check_allocation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.check_refund() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  p record;
  pay_allocated bigint;
  pay_refunded bigint;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = NEW.payment_id;
  IF p.status <> 'posted' THEN
    RAISE EXCEPTION 'ledger: cannot refund a reversed payment';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO pay_allocated FROM public.payment_allocations WHERE payment_id = p.id;
  SELECT coalesce(sum(amount_minor), 0) INTO pay_refunded FROM public.refunds WHERE payment_id = p.id;
  IF pay_allocated + pay_refunded > p.amount_minor THEN
    RAISE EXCEPTION 'ledger: refund exceeds unapplied payment value';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS refunds_check ON public.refunds;
CREATE TRIGGER refunds_check AFTER INSERT ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION app_private.check_refund();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.check_credit_note() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  i record;
  credited bigint;
  allocated bigint;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id = NEW.invoice_id;
  IF i.status <> 'issued' OR i.currency <> NEW.currency OR i.legal_entity_id <> NEW.legal_entity_id THEN
    RAISE EXCEPTION 'ledger: credit notes apply to issued invoices of the same entity and currency';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO credited FROM public.credit_notes WHERE invoice_id = i.id;
  SELECT coalesce(sum(amount_minor), 0) INTO allocated FROM public.payment_allocations WHERE invoice_id = i.id;
  IF credited > i.total_minor OR allocated > i.total_minor - credited THEN
    RAISE EXCEPTION 'ledger: credit exceeds the remaining charge';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS credit_notes_check ON public.credit_notes;
CREATE TRIGGER credit_notes_check AFTER INSERT ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION app_private.check_credit_note();
--> statement-breakpoint

-- Reception issues invoices at checkout (system role template update).
UPDATE public.roles
   SET permissions = array_append(permissions, 'invoice.issue')
 WHERE key = 'receptionist' AND is_system AND NOT ('invoice.issue' = ANY (permissions));
