-- Cash control guards (§17).
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements']::text[] $$;
--> statement-breakpoint
SELECT app_private.apply_security();
--> statement-breakpoint
REVOKE DELETE ON public.cash_sessions, public.expenses FROM cabinet_app;
--> statement-breakpoint
-- A closed session only moves to approved; an approved session never changes.
CREATE OR REPLACE FUNCTION app_private.guard_cash_session() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  approval_cols text[] := ARRAY['status', 'approved_by_user_id', 'approved_at'];
BEGIN
  IF OLD.status = 'open' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' AND NEW.status = 'approved'
     AND (to_jsonb(NEW) - approval_cols) = (to_jsonb(OLD) - approval_cols) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ledger: closed cash sessions are immutable';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS cash_sessions_guard ON public.cash_sessions;
CREATE TRIGGER cash_sessions_guard BEFORE UPDATE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_cash_session();
--> statement-breakpoint
-- Movements only on open sessions.
CREATE OR REPLACE FUNCTION app_private.check_cash_movement() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM public.cash_sessions WHERE id = NEW.cash_session_id) <> 'open' THEN
    RAISE EXCEPTION 'ledger: cash session is closed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS cash_movements_check ON public.cash_movements;
CREATE TRIGGER cash_movements_check BEFORE INSERT ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION app_private.check_cash_movement();
--> statement-breakpoint
-- Paid/void expenses are immutable except unpaid -> paid/void and paid -> void.
CREATE OR REPLACE FUNCTION app_private.guard_expense() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  pay_cols text[] := ARRAY['status', 'paid_on', 'payment_method'];
  void_cols text[] := ARRAY['status', 'voided_at', 'void_reason'];
BEGIN
  IF OLD.status = 'unpaid' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'paid' AND NEW.status = 'void'
     AND (to_jsonb(NEW) - void_cols) = (to_jsonb(OLD) - void_cols) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ledger: recorded expense payments are immutable';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS expenses_guard ON public.expenses;
CREATE TRIGGER expenses_guard BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_expense();
--> statement-breakpoint
-- Receptionists keep the drawer; accountants record expenses (system templates).
UPDATE public.roles SET permissions = array_append(permissions, 'cash.close')
 WHERE key = 'receptionist' AND is_system AND NOT ('cash.close' = ANY (permissions));
UPDATE public.roles SET permissions = array_append(permissions, 'cash.manage')
 WHERE key = 'accountant' AND is_system AND NOT ('cash.manage' = ANY (permissions));
