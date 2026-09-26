-- Run as migration administrator after migrations. Substitute the password
-- through the database administration secret flow, never commit it here.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
    CREATE ROLE trainer_service LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
ALTER ROLE trainer_service LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE trainer TO trainer_service;
GRANT USAGE ON SCHEMA public TO trainer_service;
GRANT trainer_app TO trainer_service;
GRANT SELECT ON schema_migrations TO trainer_service;
GRANT SELECT,INSERT,UPDATE,DELETE ON users,tenants,memberships,sessions,one_time_tokens,user_security,provider_events,provider_objects,domain_mappings TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON platform_settings TO trainer_service;
GRANT SELECT,INSERT ON platform_settings_audit TO trainer_service;
-- Set trainer_service's password with the database console's password workflow.
-- The runtime must not own tables. Tenant transactions explicitly SET LOCAL ROLE.

GRANT SELECT,INSERT,UPDATE ON admin_documents,admin_experiments TO trainer_service;
GRANT SELECT,INSERT ON admin_operations_audit,acquisition_events TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON support_preview_grants TO trainer_service;
GRANT SELECT,INSERT ON infrastructure_observations,infrastructure_policies TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON infrastructure_recommendations TO trainer_service;
GRANT DELETE ON acquisition_events TO trainer_service;
GRANT SELECT,INSERT,UPDATE,DELETE ON acquisition_consents TO trainer_service;

GRANT SELECT,INSERT ON privacy_erasure_registry TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON workspace_lifecycle_requests TO trainer_service;

-- Account secrets and WebAuthn are system-only; tenant actors cannot read them.
GRANT SELECT,INSERT,DELETE ON mfa_recovery_codes TO trainer_service;
GRANT SELECT,INSERT,UPDATE,DELETE ON auth_passkeys,auth_passkey_challenges TO trainer_service;

-- Public-site lookups use the service role after host/visibility checks. All
-- writes still use scoped owner transactions. Do not grant table-wide writes.
GRANT SELECT ON brand_media,coach_galleries,coach_gallery_photos,coach_sites,coach_design_drafts TO trainer_service;
GRANT EXECUTE ON FUNCTION trainer_media_brand_reference(uuid,uuid) TO trainer_service;
-- trainer_brand_tenant(), notification-template and membership proof helpers
-- remain executable only by trainer_app, exactly as their migrations specify.
