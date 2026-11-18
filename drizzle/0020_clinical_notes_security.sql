-- Clinical notes (§12): signed versions are append-only; a signed note's header
-- can only move its current_version forward (amendments). Drafts are never
-- deleted (discarded instead) so the audit trail stays complete.
CREATE OR REPLACE FUNCTION app_private.append_only_tables() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'service_prices', 'credit_notes', 'payment_allocations', 'refunds', 'cash_movements',
    'treatment_plan_versions', 'treatment_plan_items', 'treatment_plan_decisions',
    'treatment_plan_conversions', 'odontogram_findings', 'clinical_note_versions'
  ]::text[] $$;
--> statement-breakpoint
SELECT app_private.apply_security();
--> statement-breakpoint
REVOKE DELETE ON public.clinical_notes FROM cabinet_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.guard_clinical_note() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  moving text[] := ARRAY['current_version', 'updated_at', 'version'];
BEGIN
  IF OLD.status IN ('draft', 'in_review') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'signed' AND NEW.status = 'signed'
     AND NEW.current_version = OLD.current_version + 1
     AND (to_jsonb(NEW) - moving) = (to_jsonb(OLD) - moving) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'clinical: signed and discarded notes are immutable';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS clinical_notes_guard ON public.clinical_notes;
CREATE TRIGGER clinical_notes_guard BEFORE UPDATE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_clinical_note();
--> statement-breakpoint
-- A version can only be added to a note that is signed (or being signed in the same transaction),
-- with the next consecutive number.
CREATE OR REPLACE FUNCTION app_private.check_note_version() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  n record;
BEGIN
  SELECT * INTO n FROM public.clinical_notes WHERE id = NEW.note_id;
  IF n.status = 'discarded' THEN
    RAISE EXCEPTION 'clinical: cannot sign a discarded note';
  END IF;
  IF NEW.version_no <> n.current_version + 1 THEN
    RAISE EXCEPTION 'clinical: versions must be consecutive';
  END IF;
  IF (NEW.version_no = 1) <> (NEW.kind = 'original') THEN
    RAISE EXCEPTION 'clinical: version 1 is the original, later versions are amendments';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS clinical_note_versions_check ON public.clinical_note_versions;
CREATE TRIGGER clinical_note_versions_check BEFORE INSERT ON public.clinical_note_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.check_note_version();
--> statement-breakpoint
-- Starter templates (structure only; clinics adapt the wording).
INSERT INTO public.note_templates (organization_id, name, kind, body)
SELECT o.id, v.name, v.kind::clinical_note_kind, v.body::jsonb
  FROM public.organizations o
 CROSS JOIN (VALUES
   ('Consultation', 'consultation', '{"chiefComplaint":"","observations":"Examen exobuccal :\nExamen endobuccal :","assessment":"","plan":""}'),
   ('Soins conservateurs', 'procedure', '{"performedWork":"Anesthésie :\nPréparation :\nObturation :","plan":"Contrôle :"}'),
   ('Extraction', 'procedure', '{"performedWork":"Anesthésie :\nAvulsion :\nHémostase :","plan":"Conseils post-opératoires remis :\nContrôle :"}'),
   ('Détartrage', 'procedure', '{"performedWork":"Détartrage sus- et sous-gingival :\nPolissage :","plan":"Prochain détartrage :"}'),
   ('Contrôle', 'progress', '{"observations":"","assessment":"","plan":""}')
 ) AS v(name, kind, body)
 WHERE NOT EXISTS (SELECT 1 FROM public.note_templates t WHERE t.organization_id = o.id);
