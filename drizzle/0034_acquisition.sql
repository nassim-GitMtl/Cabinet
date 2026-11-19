CREATE TYPE "public"."acquisition_channel" AS ENUM('facebook', 'instagram', 'tiktok', 'google', 'word_of_mouth', 'patient_referral', 'doctor_referral', 'walk_in', 'partner', 'other');--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "acquisition_channel" "acquisition_channel";--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "referred_by_patient_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "acquisition_channel" "acquisition_channel";--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_referred_by_patient_id_patients_id_fk" FOREIGN KEY ("referred_by_patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patients_org_created_idx" ON "patients" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "patients_referrer_idx" ON "patients" USING btree ("organization_id","referred_by_patient_id");--> statement-breakpoint
-- A referral link points to another patient of the same clinic (never across tenants, never self).
CREATE OR REPLACE FUNCTION app_private.guard_patient_referral() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.referred_by_patient_id IS NOT NULL THEN
    IF NEW.referred_by_patient_id = NEW.id THEN
      RAISE EXCEPTION 'patients: a patient cannot refer themselves';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.patients r
                    WHERE r.id = NEW.referred_by_patient_id AND r.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'patients: referring patient must belong to the same organization';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER patients_referral_guard BEFORE INSERT OR UPDATE OF referred_by_patient_id ON public.patients
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_patient_referral();
--> statement-breakpoint
SELECT app_private.apply_security();
