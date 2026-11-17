-- Apply the default-deny tenant policy and runtime grants to the clinical
-- tables added in 0003. Keep this as the final statement of every migration
-- that adds organization-owned tables.
SELECT app_private.apply_security();
