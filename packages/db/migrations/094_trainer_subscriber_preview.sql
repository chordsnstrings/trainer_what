-- A trainer's private subscriber identity. It never receives a login session,
-- a paid subscription or complimentary customer access.
ALTER TABLE users ADD COLUMN is_trainer_preview boolean NOT NULL DEFAULT false;
CREATE TABLE trainer_preview_profiles (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 trainer_user_id uuid NOT NULL REFERENCES users(id),
 user_id uuid NOT NULL UNIQUE REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz,
 UNIQUE(id,tenant_id),
 CHECK (trainer_user_id<>user_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX trainer_preview_current ON trainer_preview_profiles(tenant_id,trainer_user_id) WHERE archived_at IS NULL;
CREATE TABLE trainer_preview_sessions (
 token_hash text PRIMARY KEY,
 parent_session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 profile_id uuid NOT NULL,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 FOREIGN KEY(profile_id,tenant_id) REFERENCES trainer_preview_profiles(id,tenant_id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trainer_preview_session_parent ON trainer_preview_sessions(parent_session_hash);
ALTER TABLE trainer_preview_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_preview_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY preview_profile_service ON trainer_preview_profiles USING (current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR tenant_id=nullif(current_setting('app.service_tenant_id',true),'')::uuid));
ALTER TABLE trainer_preview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_preview_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY preview_session_service ON trainer_preview_sessions USING (current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR tenant_id=nullif(current_setting('app.service_tenant_id',true),'')::uuid));
REVOKE ALL ON trainer_preview_profiles,trainer_preview_sessions FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON trainer_preview_profiles,trainer_preview_sessions TO trainer_service;
END IF; END $$;

-- These predicates return no profile content or identifiers. A current tenant
-- is mandatory; a caller cannot inspect another workspace's preview.
CREATE FUNCTION trainer_preview_member(subject uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT nullif(current_setting('app.tenant_id',true),'') IS NOT NULL AND EXISTS(SELECT 1 FROM public.users u WHERE u.id=subject AND u.is_trainer_preview);
$$;
CREATE FUNCTION trainer_preview_active(subject uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.trainer_preview_profiles p
 JOIN public.memberships m ON m.tenant_id=p.tenant_id AND m.user_id=p.trainer_user_id AND m.role='owner'
 WHERE p.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND p.user_id=subject AND p.archived_at IS NULL);
$$;
REVOKE ALL ON FUNCTION trainer_preview_member(uuid),trainer_preview_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trainer_preview_member(uuid),trainer_preview_active(uuid) TO trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT EXECUTE ON FUNCTION trainer_preview_member(uuid),trainer_preview_active(uuid) TO trainer_service;
END IF; END $$;

-- Customer lists, aggregates and background sweeps cannot see test rows.
-- The member sees their own rows. The owning trainer's explicit review scope
-- is verified by the DB package before app.preview_member_id is set.
DO $preview_isolation$
DECLARE item record;
BEGIN
 FOR item IN
  SELECT c.relname AS table_name,a.attname AS column_name
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
  AND a.attname IN ('user_id','owner_user_id')
  AND c.relname NOT IN ('cost_events','trainer_preview_profiles','trainer_preview_sessions')
  AND EXISTS(SELECT 1 FROM pg_attribute t WHERE t.attrelid=c.oid AND t.attname='tenant_id')
 LOOP
  EXECUTE format('CREATE POLICY trainer_preview_isolation ON %I AS RESTRICTIVE USING (current_user<>''trainer_app'' OR current_setting(''app.privacy_erasure'',true)=''true'' OR NOT trainer_preview_member(%I) OR %I=nullif(current_setting(''app.user_id'',true),'''')::uuid OR %I=nullif(current_setting(''app.preview_member_id'',true),'''')::uuid)',item.table_name,item.column_name,item.column_name,item.column_name);
 END LOOP;
END $preview_isolation$;
CREATE POLICY trainer_preview_directory ON users AS RESTRICTIVE USING (
 current_user<>'trainer_app' OR current_setting('app.privacy_erasure',true)='true' OR NOT is_trainer_preview
 OR id=nullif(current_setting('app.user_id',true),'')::uuid
 OR id=nullif(current_setting('app.preview_member_id',true),'')::uuid
);

CREATE FUNCTION reject_preview_login() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND is_trainer_preview) THEN
  RAISE EXCEPTION 'A trainer preview cannot have a login session' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER no_preview_login BEFORE INSERT OR UPDATE OF user_id ON sessions FOR EACH ROW EXECUTE FUNCTION reject_preview_login();
INSERT INTO schema_migrations(version) VALUES('094_trainer_subscriber_preview');
