DROP INDEX "cash_sessions_org_date_uq";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "honorarium_payments" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "honorarium_payments" ADD CONSTRAINT "honorarium_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_org_branch_date_uq" UNIQUE NULLS NOT DISTINCT("organization_id","branch_id","business_date");--> statement-breakpoint
-- Rows from before multi-site belong to the clinic's first site. Closed cash days, payments and expenses are guarded
-- against edits, so their guard triggers are paused for this one deterministic statement (same result on the
-- hosted copy and on a clinic computer), inside this migration's transaction.
ALTER TABLE public.cash_sessions DISABLE TRIGGER cash_sessions_guard;
--> statement-breakpoint
UPDATE public.cash_sessions t SET branch_id = (SELECT b.id FROM public.branches b WHERE b.organization_id = t.organization_id ORDER BY b.created_at, b.id LIMIT 1) WHERE t.branch_id IS NULL;
--> statement-breakpoint
ALTER TABLE public.cash_sessions ENABLE TRIGGER cash_sessions_guard;
--> statement-breakpoint
ALTER TABLE public.payments DISABLE TRIGGER payments_guard;
--> statement-breakpoint
UPDATE public.payments t SET branch_id = (SELECT b.id FROM public.branches b WHERE b.organization_id = t.organization_id ORDER BY b.created_at, b.id LIMIT 1) WHERE t.branch_id IS NULL;
--> statement-breakpoint
ALTER TABLE public.payments ENABLE TRIGGER payments_guard;
--> statement-breakpoint
ALTER TABLE public.expenses DISABLE TRIGGER expenses_guard;
--> statement-breakpoint
UPDATE public.expenses t SET branch_id = (SELECT b.id FROM public.branches b WHERE b.organization_id = t.organization_id ORDER BY b.created_at, b.id LIMIT 1) WHERE t.branch_id IS NULL;
--> statement-breakpoint
ALTER TABLE public.expenses ENABLE TRIGGER expenses_guard;
--> statement-breakpoint
UPDATE public.refunds t SET branch_id = (SELECT b.id FROM public.branches b WHERE b.organization_id = t.organization_id ORDER BY b.created_at, b.id LIMIT 1) WHERE t.branch_id IS NULL;
--> statement-breakpoint
UPDATE public.honorarium_payments t SET branch_id = (SELECT b.id FROM public.branches b WHERE b.organization_id = t.organization_id ORDER BY b.created_at, b.id LIMIT 1) WHERE t.branch_id IS NULL;
--> statement-breakpoint
-- A cash movement belongs to its cash day; a cash entry and its drawer must be the same site.
CREATE OR REPLACE FUNCTION app_private.guard_branch_same_org() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id AND b.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'sites: the site must belong to the same clinic';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cash_sessions_branch_guard BEFORE INSERT ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION app_private.guard_branch_same_org();
--> statement-breakpoint
CREATE TRIGGER payments_branch_guard BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION app_private.guard_branch_same_org();
--> statement-breakpoint
CREATE TRIGGER refunds_branch_guard BEFORE INSERT ON public.refunds FOR EACH ROW EXECUTE FUNCTION app_private.guard_branch_same_org();
--> statement-breakpoint
CREATE TRIGGER expenses_branch_guard BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION app_private.guard_branch_same_org();
--> statement-breakpoint
CREATE TRIGGER honorarium_payments_branch_guard BEFORE INSERT ON public.honorarium_payments FOR EACH ROW EXECUTE FUNCTION app_private.guard_branch_same_org();
--> statement-breakpoint
UPDATE public.roles SET permissions = permissions || ARRAY['branches.manage']::text[]
 WHERE key = 'owner' AND is_system AND NOT ('branches.manage' = ANY(permissions));
--> statement-breakpoint
SELECT app_private.apply_security();
