CREATE TABLE push_subscriptions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 session_id uuid NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,
 endpoint_hash text NOT NULL UNIQUE, encrypted_endpoint text NOT NULL, vapid_key_id text NOT NULL,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX push_subscriptions_recipient ON push_subscriptions(tenant_id,user_id,expires_at);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY push_scope ON push_subscriptions USING (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
 (user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner')
) WITH CHECK (
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
 (user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.role',true)='owner')
);
GRANT SELECT,INSERT,UPDATE,DELETE ON push_subscriptions TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('035_browser_push');
