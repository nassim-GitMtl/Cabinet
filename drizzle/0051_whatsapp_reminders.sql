CREATE TYPE "public"."outbound_message_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"appointment_starts_at" timestamp with time zone,
	"to_e164" text NOT NULL,
	"locale" text NOT NULL,
	"template_name" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" "outbound_message_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "outbound_messages_kind_valid" CHECK ("outbound_messages"."kind" in ('appointment_reminder')),
	CONSTRAINT "outbound_messages_channel_valid" CHECK ("outbound_messages"."channel" in ('whatsapp')),
	CONSTRAINT "outbound_messages_attempts_valid" CHECK ("outbound_messages"."attempts" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_reminder_once_uq" ON "outbound_messages" USING btree ("appointment_id","kind","appointment_starts_at") WHERE appointment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_provider_id_uq" ON "outbound_messages" USING btree ("provider_message_id") WHERE provider_message_id is not null;--> statement-breakpoint
CREATE INDEX "outbound_messages_org_time_idx" ON "outbound_messages" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "outbound_messages_patient_idx" ON "outbound_messages" USING btree ("organization_id","patient_id");--> statement-breakpoint
-- A message is never rewritten: only its status moves forward as the provider confirms it.
CREATE OR REPLACE FUNCTION app_private.guard_outbound_message() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  rank_old int := array_position(ARRAY['queued', 'sent', 'delivered', 'read'], OLD.status::text);
  rank_new int := array_position(ARRAY['queued', 'sent', 'delivered', 'read'], NEW.status::text);
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'provider_message_id', 'attempts', 'error_code', 'error_title', 'updated_at',
                            'sent_at', 'delivered_at', 'read_at', 'failed_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'provider_message_id', 'attempts', 'error_code', 'error_title', 'updated_at',
                            'sent_at', 'delivered_at', 'read_at', 'failed_at']) THEN
    RAISE EXCEPTION 'messaging: a sent message is not rewritten';
  END IF;
  IF OLD.provider_message_id IS NOT NULL AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id THEN
    RAISE EXCEPTION 'messaging: the provider id of a message never changes';
  END IF;
  IF OLD.status = 'failed' OR OLD.status = 'read' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'messaging: % is final', OLD.status; END IF;
  ELSIF NEW.status <> 'failed' AND rank_new < rank_old THEN
    RAISE EXCEPTION 'messaging: a message status only moves forward';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER outbound_messages_guard BEFORE UPDATE ON public.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_outbound_message();
--> statement-breakpoint
-- Clinics whose automatic WhatsApp reminders are on: module sold by the operator and switched on by the clinic.
CREATE OR REPLACE FUNCTION app_private.auto_reminder_clinics()
RETURNS TABLE (organization_id uuid, name text, timezone text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT o.id, o.name, o.timezone
    FROM public.organizations o
   WHERE o.status IN ('onboarding', 'active')
     AND 'whatsapp_reminders' = ANY (o.enabled_modules)
     AND coalesce((o.settings -> 'autoReminders' ->> 'enabled')::boolean, false)
   ORDER BY o.id $$;
--> statement-breakpoint
-- Delivery receipts from the WhatsApp webhook carry only the provider's message id (no clinic): apply them here.
-- Statuses only move forward; a late "delivered" after "read" is ignored. Returns whether a message matched.
CREATE OR REPLACE FUNCTION app_private.whatsapp_status_update(
  p_provider_id text, p_status text, p_at timestamptz, p_error_code text, p_error_title text
) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  m public.outbound_messages%ROWTYPE;
  ranks text[] := ARRAY['queued', 'sent', 'delivered', 'read'];
BEGIN
  IF p_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN RETURN false; END IF;
  SELECT * INTO m FROM public.outbound_messages WHERE provider_message_id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF m.status IN ('failed', 'read') THEN RETURN true; END IF;
  IF p_status <> 'failed' AND array_position(ranks, p_status) <= array_position(ranks, m.status::text) THEN RETURN true; END IF;
  UPDATE public.outbound_messages
     SET status = p_status::public.outbound_message_status,
         updated_at = now(),
         sent_at = coalesce(sent_at, CASE WHEN p_status IN ('sent', 'delivered', 'read') THEN p_at END),
         delivered_at = CASE WHEN p_status IN ('delivered', 'read') THEN coalesce(delivered_at, p_at) ELSE delivered_at END,
         read_at = CASE WHEN p_status = 'read' THEN p_at ELSE read_at END,
         failed_at = CASE WHEN p_status = 'failed' THEN p_at ELSE failed_at END,
         error_code = CASE WHEN p_status = 'failed' THEN left(p_error_code, 40) ELSE error_code END,
         error_title = CASE WHEN p_status = 'failed' THEN left(p_error_title, 300) ELSE error_title END
   WHERE id = m.id;
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.whatsapp_status_update(text, text, timestamptz, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.auto_reminder_clinics() FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.no_delete_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'payments', 'cash_sessions', 'expenses', 'appointments', 'booking_requests',
    'treatment_plans', 'clinical_notes', 'questionnaire_versions', 'inventory_items',
    'inventory_purchase_orders', 'inventory_item_identifiers', 'procedure_consumptions',
    'sterilizers', 'instrument_sets', 'sterilization_cycles', 'sterilization_packs', 'sterilization_pack_uses',
    'questionnaire_tablet_sessions', 'sync_nodes', 'provider_service_terms', 'patient_journey_items',
    'outbound_messages'
  ]::text[] $$;
--> statement-breakpoint
UPDATE public.roles SET permissions = permissions || ARRAY['reminders.auto.manage']::text[]
 WHERE key = 'owner' AND is_system AND NOT ('reminders.auto.manage' = ANY(permissions));
--> statement-breakpoint
SELECT app_private.apply_security();
