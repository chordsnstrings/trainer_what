-- Tenant scope hardening (docs/features/isolation.md). Idempotent; run as the
-- migration administrator after infra/runtime-role.sql.
--
-- Tenant transactions run as trainer_app with the scope settings fixed by the
-- db package. Without EXECUTE on set_config no tenant-scoped statement can
-- change role, app.tenant_id, app.user_id, app.role or any other setting.
-- Releases before migration 061 called set_config after SET ROLE, so this is
-- applied only by a controller whose own release is scope-compatible
-- (infra/digitalocean/host.py runtime_role), never during the upgrade from an
-- older release, and by CI to its fresh databases.
REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) TO trainer_service;
