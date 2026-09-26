CREATE TABLE integration_connections (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 provider text NOT NULL CHECK(provider IN ('whoop','zepp')), status text NOT NULL CHECK(status IN ('active','syncing','attention','revocation_pending','revoked')),
 credentials text, external_user_id text, scopes text[] NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1, summary jsonb NOT NULL DEFAULT '{}',
 last_synced_at timestamptz, next_sync_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id,provider)
);
CREATE TABLE integration_oauth_states (
 state_hash text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 provider text NOT NULL CHECK(provider IN ('whoop','zepp')), session_hash text NOT NULL,
 verifier text NOT NULL, origin text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trainer_voices (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL CHECK(status IN ('pending','verified','revoked')), version integer NOT NULL DEFAULT 1,
 provider_voice_id text, evidence jsonb NOT NULL DEFAULT '{}', consent_version text NOT NULL,
 sample bytea, sample_type text CHECK(sample_type IS NULL OR sample_type IN ('audio/mpeg','audio/wav')),
 verified_by uuid REFERENCES users(id), verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(sample IS NULL OR octet_length(sample)<=6291456)
);
CREATE TABLE guided_audio (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 workout_id uuid NOT NULL, voice_id uuid NOT NULL REFERENCES trainer_voices(id), voice_version integer NOT NULL,
 fingerprint text NOT NULL, status text NOT NULL CHECK(status IN ('reserved','unknown','ready','revoked')),
 text_content text NOT NULL, audio bytea, usage_id uuid NOT NULL REFERENCES cost_events(id),
 data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id,fingerprint), FOREIGN KEY(tenant_id,workout_id) REFERENCES records(tenant_id,id),
 CHECK(audio IS NULL OR octet_length(audio)<=2097152)
);
CREATE TABLE domain_orders (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), hostname text NOT NULL,
 status text NOT NULL CHECK(status IN ('requested','quoted','approved','owned','verified','active','expired','cancelled')),
 version integer NOT NULL DEFAULT 1, token text NOT NULL, quote jsonb, evidence jsonb NOT NULL DEFAULT '{}',
 verified_at timestamptz, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX domain_order_open_host ON domain_orders(hostname) WHERE status NOT IN ('cancelled','expired');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['integration_connections','integration_oauth_states','trainer_voices','guided_audio','domain_orders'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['integration_connections','integration_oauth_states','guided_audio'] LOOP
  EXECUTE format('CREATE POLICY personal_scope ON %I AS RESTRICTIVE USING(user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid OR current_setting(''app.role'',true)=''owner'') WITH CHECK(user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid OR current_setting(''app.role'',true)=''owner'')',t);
 END LOOP;
END $$;
CREATE POLICY voice_read ON trainer_voices AS RESTRICTIVE USING(current_setting('app.role',true)='owner') WITH CHECK(current_setting('app.role',true)='owner');
CREATE POLICY domain_owner ON domain_orders AS RESTRICTIVE USING(current_setting('app.role',true)='owner') WITH CHECK(current_setting('app.role',true)='owner');
GRANT SELECT,INSERT,UPDATE,DELETE ON integration_connections,integration_oauth_states,trainer_voices,guided_audio,domain_orders TO trainer_app;
-- The app role cannot read global tenant settings. Answer only whether its
-- current scoped user still has membership in an active workspace.
CREATE FUNCTION integration_actor_is_current(p_tenant uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_tenant=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND p_user=nullif(current_setting('app.user_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM public.memberships m JOIN public.tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=p_tenant AND m.user_id=p_user
 AND coalesce(to_jsonb(t)->>'lifecycle_state','active')='active')
$$;
REVOKE ALL ON FUNCTION integration_actor_is_current(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_actor_is_current(uuid,uuid) TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('017_integrations_completion');
