-- Public discovery: the opt-in coach directory, the single discovery predicate
-- and per-workspace install icon keys for trainer-branded member apps.

-- The one predicate every public discovery query (sitemaps, the directory)
-- uses. A published, active workspace is discoverable. Workspace suspension
-- sets lifecycle_state='suspended', which already fails this test; a later
-- exclusion (for example a moderation hold) replaces this function only.
CREATE FUNCTION public_discovery_tenant(tid uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=tid AND t.published=true
  AND coalesce(to_jsonb(t)->>'lifecycle_state','active')='active')
$$;
REVOKE ALL ON FUNCTION public_discovery_tenant(uuid) FROM PUBLIC;

-- Directory listing choices. Off by default; only the owner reads or changes
-- them. Public directory reads use the service role after the predicate.
CREATE TABLE coach_directory_profiles (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 listed boolean NOT NULL DEFAULT false,
 specialties text[] NOT NULL DEFAULT '{}'
  CHECK(cardinality(specialties)<=6 AND array_to_string(specialties,',') ~ '^([a-z][a-z_]{1,31}(,|$))*$'),
 languages text[] NOT NULL DEFAULT '{}'
  CHECK(cardinality(languages)<=8 AND array_to_string(languages,',') ~ '^([a-z]{2}(,|$))*$'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 listed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(listed=(listed_at IS NOT NULL)),
 CHECK(NOT listed OR (cardinality(specialties)>0 AND cardinality(languages)>0))
);
CREATE INDEX coach_directory_listed ON coach_directory_profiles(tenant_id) WHERE listed;
ALTER TABLE coach_directory_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_directory_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_write ON coach_directory_profiles FOR ALL
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true)='owner')
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true)='owner');
CREATE POLICY service_read ON coach_directory_profiles FOR SELECT USING (current_user<>'trainer_app');
REVOKE ALL ON coach_directory_profiles FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON coach_directory_profiles TO trainer_app;

-- A random capability per workspace for member install icons. Members learn
-- it from their signed-in manifest; it is never derived from the slug, so an
-- unpublished workspace's icon cannot be discovered. System-only.
CREATE TABLE workspace_app_icons (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 icon_key text NOT NULL UNIQUE CHECK(icon_key ~ '^[A-Za-z0-9_-]{32,64}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workspace_app_icons ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_app_icons FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON workspace_app_icons USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON workspace_app_icons FROM PUBLIC,trainer_app;
INSERT INTO schema_migrations(version) VALUES('059_public_discovery');
