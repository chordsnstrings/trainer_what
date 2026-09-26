CREATE TABLE brand_media (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), owner_user_id uuid NOT NULL REFERENCES users(id),
 digest text NOT NULL, media bytea NOT NULL CHECK(octet_length(media)<=8388608), width integer NOT NULL, height integer NOT NULL,
 filename text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,digest), UNIQUE(tenant_id,id)
);
CREATE TABLE coach_galleries (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), owner_user_id uuid NOT NULL REFERENCES users(id),
 title text NOT NULL, description text NOT NULL DEFAULT '', audience text NOT NULL DEFAULT 'draft' CHECK(audience IN ('draft','site','app','both')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE coach_gallery_photos (
 tenant_id uuid NOT NULL, gallery_id uuid NOT NULL, media_id uuid NOT NULL, caption text NOT NULL DEFAULT '', alt text NOT NULL,
 position integer NOT NULL DEFAULT 0 CHECK(position>=0), PRIMARY KEY(gallery_id,media_id),
 FOREIGN KEY(tenant_id,gallery_id) REFERENCES coach_galleries(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,media_id) REFERENCES brand_media(tenant_id,id)
);
CREATE TABLE coach_sites (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), draft jsonb NOT NULL DEFAULT '{}', published jsonb, version integer NOT NULL DEFAULT 0,
 published_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE coach_design_drafts (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), data jsonb NOT NULL, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['brand_media','coach_galleries','coach_gallery_photos','coach_sites','coach_design_drafts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND current_setting(''app.role'',true) IN (''owner'',''staff'',''subscriber''))',t);
  EXECUTE format('CREATE POLICY owner_write ON %I FOR ALL USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND current_setting(''app.role'',true)=''owner'') WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND current_setting(''app.role'',true)=''owner'')',t);
  EXECUTE format('CREATE POLICY service_read ON %I FOR SELECT USING (current_user<>''trainer_app'')',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO trainer_app',t);
 END LOOP;
END $$;
CREATE POLICY gallery_visibility ON coach_galleries AS RESTRICTIVE USING (current_user<>'trainer_app' OR current_setting('app.role',true)<>'subscriber' OR audience IN ('app','both'));
CREATE POLICY photo_visibility ON coach_gallery_photos AS RESTRICTIVE USING (current_user<>'trainer_app' OR current_setting('app.role',true)<>'subscriber' OR EXISTS(SELECT 1 FROM coach_galleries g WHERE g.id=gallery_id AND g.audience IN ('app','both')));
CREATE POLICY site_private ON coach_sites AS RESTRICTIVE USING (current_user<>'trainer_app' OR current_setting('app.role',true)='owner');
CREATE POLICY design_private ON coach_design_drafts AS RESTRICTIVE USING (current_user<>'trainer_app' OR current_setting('app.role',true)='owner');
CREATE FUNCTION trainer_media_brand_reference(tid uuid,mid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT tid=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
 SELECT 1 FROM tenants t WHERE t.id=tid AND '/api/v1/media/'||mid::text IN (t.theme->'design'->>'logoUrl',t.theme->'design'->>'photoUrl',t.theme->'design'->>'coverUrl'));
$$;
REVOKE ALL ON FUNCTION trainer_media_brand_reference(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trainer_media_brand_reference(uuid,uuid) TO trainer_app;
CREATE POLICY media_visibility ON brand_media AS RESTRICTIVE USING (
 current_user<>'trainer_app' OR current_setting('app.role',true) IN ('owner','staff') OR
 EXISTS(SELECT 1 FROM coach_gallery_photos p JOIN coach_galleries g ON g.id=p.gallery_id WHERE p.media_id=brand_media.id AND g.audience IN ('app','both')) OR
 trainer_media_brand_reference(tenant_id,id)
);
CREATE FUNCTION trainer_brand_tenant() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',t.id,'slug',t.slug,'name',t.name,'theme',t.theme,'published',t.published)
 FROM tenants t JOIN memberships m ON m.tenant_id=t.id
 WHERE t.id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid
 AND m.role='owner' AND current_setting('app.role',true)='owner'
 AND coalesce(to_jsonb(t)->>'lifecycle_state','active')='active';
$$;
REVOKE ALL ON FUNCTION trainer_brand_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trainer_brand_tenant() TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('018_brand_site');
