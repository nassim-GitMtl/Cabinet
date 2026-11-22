ALTER TABLE "provider_service_terms" DROP CONSTRAINT "provider_service_terms_value_valid";--> statement-breakpoint
ALTER TABLE "provider_service_term_history" ALTER COLUMN "rule_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_service_term_history" ALTER COLUMN "rule_value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_service_terms" ALTER COLUMN "rule_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_service_terms" ALTER COLUMN "rule_value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_service_terms" ADD CONSTRAINT "provider_service_terms_value_valid" CHECK (("provider_service_terms"."rule_type" is null and "provider_service_terms"."rule_value" is null) or ("provider_service_terms"."rule_type" = 'percent' and "provider_service_terms"."rule_value" between 0 and 10000) or ("provider_service_terms"."rule_type" = 'fixed' and "provider_service_terms"."rule_value" >= 0));--> statement-breakpoint
-- User decision 2026-11-22: only the owner and the practitioner concerned see what a practitioner earned, and prices
-- are set by the owner. The owner-only keys leave every other role (built-in or custom); dentists no longer change
-- a price when recording an act (their own price list, set by the owner, applies).
UPDATE public.roles
   SET permissions = ARRAY(SELECT p FROM unnest(permissions) AS p
                            WHERE p NOT IN ('honorarium.read.all', 'honorarium.manage', 'honorarium.pay', 'honorarium.close'))
 WHERE key <> 'owner'
   AND permissions && ARRAY['honorarium.read.all', 'honorarium.manage', 'honorarium.pay', 'honorarium.close']::text[];
--> statement-breakpoint
UPDATE public.roles
   SET permissions = ARRAY(SELECT p FROM unnest(permissions) AS p WHERE p <> 'price.override')
 WHERE key = 'dentist' AND is_system AND 'price.override' = ANY(permissions);
--> statement-breakpoint
SELECT app_private.apply_security();
