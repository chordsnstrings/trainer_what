CREATE TABLE meal_captures (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 request_key uuid NOT NULL, fingerprint text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('photo','barcode')),
 status text NOT NULL CHECK(status IN ('running','draft','failed','confirmed')),
 media bytea, media_type text CHECK(media_type IS NULL OR media_type='image/jpeg'),
 data jsonb NOT NULL DEFAULT '{}',
 log_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 UNIQUE(tenant_id,user_id,request_key),
 FOREIGN KEY(tenant_id,log_id) REFERENCES records(tenant_id,id) ON DELETE CASCADE,
 CHECK(media IS NULL OR octet_length(media)<=2097152)
);
CREATE INDEX meal_capture_retention ON meal_captures(tenant_id,expires_at);
ALTER TABLE meal_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_captures FORCE ROW LEVEL SECURITY;
CREATE POLICY meal_capture_scope ON meal_captures USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
 (user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner')
) WITH CHECK (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
 (user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner')
);
GRANT SELECT,INSERT,UPDATE,DELETE ON meal_captures TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('012_meal_capture');
