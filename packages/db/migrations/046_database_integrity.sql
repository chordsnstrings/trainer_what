-- Migration runners record each applied file's SHA-256 and refuse later edits.
ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text;

-- Tenant transactions assume trainer_app obeys RLS. Normalize a role restored
-- or altered with a bypass; a migrator unable to do so fails the deploy.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='trainer_app' AND (rolsuper OR rolbypassrls)) THEN
  ALTER ROLE trainer_app NOSUPERUSER NOBYPASSRLS;
 END IF;
END $$;

-- Host routing trusts domain_mappings. Tenant actors read only their own rows
-- and an owner may only disconnect one; activation and hostname transfer run
-- under the service role after administrator verification.
REVOKE ALL ON domain_mappings FROM trainer_app;
ALTER TABLE domain_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_mapping_scope ON domain_mappings
 USING (current_user<>'trainer_app' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (current_user<>'trainer_app' OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND NOT active));
CREATE POLICY domain_mapping_owner_write ON domain_mappings AS RESTRICTIVE FOR UPDATE
 USING (current_user<>'trainer_app' OR current_setting('app.role',true)='owner');
GRANT SELECT, UPDATE(active) ON domain_mappings TO trainer_app;
INSERT INTO schema_migrations(version) VALUES ('046_database_integrity');
