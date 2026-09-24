CREATE TABLE user_security (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 totp_secret text,
 pending_secret text,
 pending_until timestamptz,
 enabled boolean NOT NULL DEFAULT false,
 last_counter bigint NOT NULL DEFAULT -1
);
ALTER TABLE sessions ADD COLUMN mfa_at timestamptz;
REVOKE ALL ON sessions,one_time_tokens,user_security,tenants,provider_events,provider_objects FROM trainer_app;
REVOKE ALL ON users,memberships FROM trainer_app;
GRANT SELECT(id,name,email) ON users TO trainer_app;
GRANT SELECT ON memberships TO trainer_app;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_scope ON memberships USING (
 current_user<>'trainer_app' OR
 (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
 (current_setting('app.role',true)<>'subscriber' OR user_id=nullif(current_setting('app.user_id',true),'')::uuid))
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY directory_scope ON users USING (
 current_user<>'trainer_app' OR id=nullif(current_setting('app.user_id',true),'')::uuid OR
 EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=users.id AND m.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
);
DROP POLICY record_subscriber_scope ON records;
CREATE POLICY record_subscriber_scope ON records AS RESTRICTIVE USING (
 current_setting('app.role',true)<>'subscriber' OR
 (kind='product' AND status='published') OR
 (owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid AND
 kind IN ('intake','program','workout','message','refund','booking','support','settings','preferences','privacy_request','wearable') AND
 (kind<>'message' OR status='sent'))
) WITH CHECK (
 current_setting('app.role',true)<>'subscriber' OR owner_user_id=nullif(current_setting('app.user_id',true),'')::uuid
);
CREATE POLICY finance_record_scope ON records AS RESTRICTIVE USING (
 current_setting('app.role',true)<>'finance' OR kind IN ('product','beneficiary','refund','statement','reconciliation','close','privacy_request')
);
INSERT INTO schema_migrations(version) VALUES('003_account_security');
