-- Paired Apple HealthKit companion devices. Only the SHA-256 of each device
-- token is stored; the token itself is shown once to the companion app.
CREATE TABLE healthkit_devices (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
 platform text NOT NULL CHECK(platform IN ('ios','ipados')),
 app_version text CHECK(app_version IS NULL OR length(app_version) BETWEEN 1 AND 32),
 status text NOT NULL CHECK(status IN ('active','revoked')),
 revoked_reason text CHECK(revoked_reason IS NULL OR revoked_reason IN ('member','device','consent','source_revoked','membership_ended')),
 consent_version text NOT NULL CHECK(length(consent_version) BETWEEN 1 AND 300),
 version integer NOT NULL DEFAULT 1,
 quota_day date, quota_batches integer NOT NULL DEFAULT 0 CHECK(quota_batches>=0),
 quota_samples integer NOT NULL DEFAULT 0 CHECK(quota_samples>=0),
 batches_received integer NOT NULL DEFAULT 0 CHECK(batches_received>=0),
 samples_received bigint NOT NULL DEFAULT 0 CHECK(samples_received>=0),
 last_error_code text CHECK(last_error_code IS NULL OR last_error_code ~ '^[A-Z_]{2,60}$'),
 last_seen_at timestamptz, last_sync_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 CHECK((status='revoked')=(revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))
);
CREATE INDEX healthkit_devices_member ON healthkit_devices(tenant_id,user_id,status);
-- Upload receipts: the stable batch id from the device makes retries idempotent.
CREATE TABLE healthkit_sync_batches (
 tenant_id uuid NOT NULL REFERENCES tenants(id), device_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id),
 batch_id text NOT NULL CHECK(batch_id ~ '^[A-Za-z0-9_-]{8,64}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,device_id,batch_id),
 FOREIGN KEY(tenant_id,device_id) REFERENCES healthkit_devices(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX healthkit_sync_batches_age ON healthkit_sync_batches(tenant_id,created_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['healthkit_devices','healthkit_sync_batches'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('CREATE POLICY personal_scope ON %I AS RESTRICTIVE USING(user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid OR current_setting(''app.role'',true)=''owner'') WITH CHECK(user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid OR current_setting(''app.role'',true)=''owner'')',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON healthkit_devices,healthkit_sync_batches TO trainer_app;
-- One synchronized-day row per member and local day while its use is permitted.
-- Rows whose use was revoked keep their history; a later sync starts a new row.
CREATE UNIQUE INDEX healthkit_day_record ON records(tenant_id,owner_user_id,(data->>'providerKey'))
 WHERE kind='wearable' AND status='imported' AND data->>'origin'='apple_healthkit';
INSERT INTO schema_migrations(version) VALUES('060_healthkit_sync');
