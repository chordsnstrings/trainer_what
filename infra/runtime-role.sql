-- Run as migration administrator after migrations. Substitute the password
-- through the database administration secret flow, never commit it here.
CREATE ROLE trainer_service LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE trainer TO trainer_service;
GRANT USAGE ON SCHEMA public TO trainer_service;
GRANT trainer_app TO trainer_service;
GRANT SELECT ON schema_migrations TO trainer_service;
GRANT SELECT,INSERT,UPDATE,DELETE ON users,tenants,memberships,sessions,one_time_tokens,user_security,provider_events,provider_objects,domain_mappings TO trainer_service;
GRANT SELECT,INSERT,UPDATE ON platform_settings TO trainer_service;
GRANT SELECT,INSERT ON platform_settings_audit TO trainer_service;
-- Set trainer_service's password with the database console's password workflow.
-- The runtime must not own tables. Tenant transactions explicitly SET LOCAL ROLE.
