CREATE TABLE "payment_installment_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_schedule_installments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"installment_number" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_schedule_installments_number_positive" CHECK ("payment_schedule_installments"."installment_number" > 0),
	CONSTRAINT "payment_schedule_installments_amount_positive" CHECK ("payment_schedule_installments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"supersedes_schedule_id" uuid,
	"currency" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_schedules_total_positive" CHECK ("payment_schedules"."total_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_installment_receipts" ADD CONSTRAINT "payment_installment_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installment_receipts" ADD CONSTRAINT "payment_installment_receipts_schedule_id_payment_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."payment_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installment_receipts" ADD CONSTRAINT "payment_installment_receipts_installment_id_payment_schedule_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."payment_schedule_installments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installment_receipts" ADD CONSTRAINT "payment_installment_receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installment_receipts" ADD CONSTRAINT "payment_installment_receipts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installment_receipts" ADD CONSTRAINT "payment_installment_receipts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_installments" ADD CONSTRAINT "payment_schedule_installments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_installments" ADD CONSTRAINT "payment_schedule_installments_schedule_id_payment_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."payment_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_installments" ADD CONSTRAINT "payment_schedule_installments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_installments" ADD CONSTRAINT "payment_schedule_installments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_plan_id_treatment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."treatment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_version_id_treatment_plan_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."treatment_plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_supersedes_schedule_id_fk" FOREIGN KEY ("supersedes_schedule_id") REFERENCES "public"."payment_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_installment_receipts_payment_uq" ON "payment_installment_receipts" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_installment_receipts_installment_idx" ON "payment_installment_receipts" USING btree ("organization_id","installment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_schedule_installments_order_uq" ON "payment_schedule_installments" USING btree ("schedule_id","installment_number");--> statement-breakpoint
CREATE INDEX "payment_schedule_installments_due_idx" ON "payment_schedule_installments" USING btree ("organization_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_schedules_supersedes_uq" ON "payment_schedules" USING btree ("supersedes_schedule_id");--> statement-breakpoint
CREATE INDEX "payment_schedules_plan_idx" ON "payment_schedules" USING btree ("organization_id","plan_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_schedules_patient_idx" ON "payment_schedules" USING btree ("organization_id","patient_id","created_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings', 'clinical_note_versions',
    'questionnaire_responses', 'health_history_reviews', 'inventory_lots', 'inventory_movements',
    'inventory_purchase_order_lines', 'audit_events', 'clinical_files', 'clinical_file_comparisons',
    'patient_contacts', 'payment_schedules', 'payment_schedule_installments', 'payment_installment_receipts'
  ]::text[] $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.guard_payment_schedule() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE est record; prior record;
BEGIN
  IF app_private.current_actor_type() <> 'staff' OR NEW.created_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'payment schedule: invalid staff actor';
  END IF;
  -- `est`, not `v`: a PL/pgSQL variable must not share its name with a table alias in the query.
  SELECT p.patient_id, p.status, p.current_version, tv.id version_id, tv.currency, tv.total_minor
    INTO est FROM public.treatment_plans p JOIN public.treatment_plan_versions tv
      ON tv.plan_id = p.id AND tv.version_number = p.current_version
   WHERE p.id = NEW.plan_id AND p.organization_id = NEW.organization_id FOR SHARE OF p;
  IF NOT FOUND OR est.patient_id IS DISTINCT FROM NEW.patient_id OR est.version_id IS DISTINCT FROM NEW.version_id
     OR est.status NOT IN ('accepted', 'completed') OR est.currency IS DISTINCT FROM NEW.currency
     OR est.total_minor IS DISTINCT FROM NEW.total_minor THEN
    RAISE EXCEPTION 'payment schedule: must match the exact accepted estimate';
  END IF;
  SELECT s.* INTO prior FROM public.payment_schedules s WHERE s.plan_id = NEW.plan_id
    AND NOT EXISTS (SELECT 1 FROM public.payment_schedules n WHERE n.supersedes_schedule_id = s.id)
    ORDER BY s.created_at DESC LIMIT 1 FOR SHARE;
  IF FOUND THEN
    IF NEW.supersedes_schedule_id IS DISTINCT FROM prior.id THEN RAISE EXCEPTION 'payment schedule: replacement must supersede current schedule'; END IF;
    IF EXISTS (SELECT 1 FROM public.payment_installment_receipts r WHERE r.schedule_id = prior.id) THEN
      RAISE EXCEPTION 'payment schedule: a schedule with receipts cannot be replaced';
    END IF;
  ELSIF NEW.supersedes_schedule_id IS NOT NULL THEN
    RAISE EXCEPTION 'payment schedule: invalid superseded schedule';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER payment_schedules_guard BEFORE INSERT ON public.payment_schedules
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_payment_schedule();--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.guard_payment_schedule_installment() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app_private.current_actor_type() <> 'staff' OR NEW.created_by_user_id IS DISTINCT FROM app_private.current_user_id()
     OR NOT EXISTS (SELECT 1 FROM public.payment_schedules s WHERE s.id = NEW.schedule_id
       AND s.organization_id = NEW.organization_id AND s.patient_id = NEW.patient_id
       AND NOT EXISTS (SELECT 1 FROM public.payment_schedules n WHERE n.supersedes_schedule_id = s.id)) THEN
    RAISE EXCEPTION 'payment schedule installment: invalid schedule or actor';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER payment_schedule_installments_guard BEFORE INSERT ON public.payment_schedule_installments
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_payment_schedule_installment();--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.check_payment_schedule_total() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE sid uuid; expected bigint; actual bigint;
BEGIN
  sid := COALESCE(NEW.schedule_id, OLD.schedule_id);
  SELECT total_minor INTO expected FROM public.payment_schedules WHERE id = sid;
  SELECT COALESCE(sum(amount_minor), 0) INTO actual FROM public.payment_schedule_installments WHERE schedule_id = sid;
  IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'payment schedule: installment total must equal estimate total'; END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_schedule_total_check AFTER INSERT OR UPDATE OR DELETE ON public.payment_schedule_installments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.check_payment_schedule_total();--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.guard_payment_installment_receipt() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE due bigint; paid bigint; receipt bigint;
BEGIN
  IF app_private.current_actor_type() <> 'staff' OR NEW.created_by_user_id IS DISTINCT FROM app_private.current_user_id() THEN
    RAISE EXCEPTION 'payment installment receipt: invalid staff actor';
  END IF;
  -- Concurrent receipts on one installment are serialized (same key as the billing service).
  PERFORM pg_advisory_xact_lock(hashtextextended('installment:' || NEW.installment_id::text, 0));
  SELECT i.amount_minor INTO due FROM public.payment_schedule_installments i JOIN public.payment_schedules s ON s.id = i.schedule_id
   WHERE i.id = NEW.installment_id AND i.schedule_id = NEW.schedule_id AND i.organization_id = NEW.organization_id
     AND i.patient_id = NEW.patient_id AND NOT EXISTS (SELECT 1 FROM public.payment_schedules n WHERE n.supersedes_schedule_id = s.id)
   FOR SHARE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment installment receipt: invalid current installment'; END IF;
  SELECT CASE WHEN p.status = 'posted' THEN p.amount_minor - COALESCE((SELECT sum(r.amount_minor) FROM public.refunds r WHERE r.payment_id = p.id), 0) ELSE 0 END
    INTO receipt FROM public.payments p WHERE p.id = NEW.payment_id AND p.organization_id = NEW.organization_id
      AND p.patient_id = NEW.patient_id AND p.purpose = 'advance_deposit' FOR SHARE;
  IF NOT FOUND OR receipt <= 0 THEN RAISE EXCEPTION 'payment installment receipt: invalid receipt'; END IF;
  SELECT COALESCE(sum(CASE WHEN p.status = 'posted' THEN p.amount_minor - COALESCE((SELECT sum(r.amount_minor) FROM public.refunds r WHERE r.payment_id = p.id), 0) ELSE 0 END), 0)
    INTO paid FROM public.payment_installment_receipts x JOIN public.payments p ON p.id = x.payment_id
   WHERE x.installment_id = NEW.installment_id;
  IF paid + receipt > due THEN RAISE EXCEPTION 'payment installment receipt: amount exceeds installment'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER payment_installment_receipts_guard BEFORE INSERT ON public.payment_installment_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_payment_installment_receipt();--> statement-breakpoint

SELECT app_private.apply_security();
