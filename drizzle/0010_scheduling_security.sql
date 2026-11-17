-- Scheduling (§9): server-side double-booking protection and default setup.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- No two BOOKED appointments may overlap for the same provider, chair or patient.
-- Enforced by PostgreSQL, so concurrent bookings cannot both succeed.
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_provider_no_overlap EXCLUDE USING gist (
    provider_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (scheduling_status = 'booked');
--> statement-breakpoint
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_chair_no_overlap EXCLUDE USING gist (
    chair_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (scheduling_status = 'booked' AND chair_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_patient_no_overlap EXCLUDE USING gist (
    patient_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (scheduling_status = 'booked');
--> statement-breakpoint
SELECT app_private.apply_security();
--> statement-breakpoint
REVOKE DELETE ON public.appointments FROM cabinet_app;
--> statement-breakpoint
-- Defaults for existing clinics: one chair, common appointment types, and
-- Sunday–Thursday 08:00–12:00 / 13:00–17:00 for every clinician (editable).
INSERT INTO public.chairs (organization_id, branch_id, name)
SELECT b.organization_id, b.id, 'Fauteuil 1' FROM public.branches b
 WHERE NOT EXISTS (SELECT 1 FROM public.chairs c WHERE c.organization_id = b.organization_id);
--> statement-breakpoint
INSERT INTO public.appointment_types (organization_id, code, name, default_duration_min, color)
SELECT o.id, v.code, v.name::jsonb, v.duration, v.color
  FROM public.organizations o
 CROSS JOIN (VALUES
   ('CONSULT', '{"fr":"Consultation","en":"Consultation","ar":"استشارة"}', 20, 'teal'),
   ('CARE', '{"fr":"Soins","en":"Treatment","ar":"علاج"}', 30, 'blue'),
   ('HYGIENE', '{"fr":"Détartrage","en":"Hygiene","ar":"إزالة الجير"}', 30, 'green'),
   ('SURGERY', '{"fr":"Chirurgie","en":"Surgery","ar":"جراحة"}', 60, 'red'),
   ('PROSTH', '{"fr":"Prothèse","en":"Prosthetics","ar":"تركيبات"}', 45, 'violet'),
   ('FOLLOWUP', '{"fr":"Contrôle","en":"Follow-up","ar":"متابعة"}', 15, 'gray'),
   ('URGENT', '{"fr":"Urgence","en":"Emergency","ar":"استعجال"}', 20, 'orange')
 ) AS v(code, name, duration, color)
 WHERE NOT EXISTS (SELECT 1 FROM public.appointment_types t WHERE t.organization_id = o.id);
--> statement-breakpoint
INSERT INTO public.working_hours (organization_id, provider_id, branch_id, weekday, start_time, end_time)
SELECT m.organization_id, m.id, b.id, d.wd, s.st, s.et
  FROM public.memberships m
  JOIN LATERAL (SELECT id FROM public.branches WHERE organization_id = m.organization_id ORDER BY created_at LIMIT 1) b ON true
 CROSS JOIN (VALUES (7), (1), (2), (3), (4)) AS d(wd)
 CROSS JOIN (VALUES (time '08:00', time '12:00'), (time '13:00', time '17:00')) AS s(st, et)
 WHERE m.is_provider AND NOT EXISTS (SELECT 1 FROM public.working_hours w WHERE w.provider_id = m.id);
--> statement-breakpoint
-- Assistants and receptionists manage the agenda; dentists already can.
UPDATE public.roles SET permissions = array_append(permissions, 'appointment.read')
 WHERE key IN ('accountant') AND is_system AND NOT ('appointment.read' = ANY (permissions));
