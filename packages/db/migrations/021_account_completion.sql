ALTER TABLE sessions ADD COLUMN session_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX session_public_id ON sessions(session_id);
CREATE TABLE mfa_recovery_codes (
 user_id uuid NOT NULL REFERENCES users(id), code_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE auth_passkeys (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), rp_id text NOT NULL,
 host_tenant_id uuid REFERENCES tenants(id), credential_id text NOT NULL, public_key bytea NOT NULL,
 counter bigint NOT NULL CHECK(counter>=0), transports text[] NOT NULL DEFAULT '{}',
 device_type text NOT NULL, backed_up boolean NOT NULL, label text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz,
 UNIQUE(rp_id,credential_id)
);
CREATE TABLE auth_passkey_challenges (
 id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), tenant_id uuid REFERENCES tenants(id),
 purpose text NOT NULL CHECK(purpose IN ('register','authenticate')), rp_id text NOT NULL, origin text NOT NULL,
 challenge text NOT NULL, nonce_hash text NOT NULL, session_hash text, label text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes', consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX passkey_user ON auth_passkeys(user_id);
REVOKE ALL ON auth_passkeys,auth_passkey_challenges FROM PUBLIC,trainer_app;
REVOKE ALL ON mfa_recovery_codes FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,DELETE ON mfa_recovery_codes TO trainer_service;
 GRANT SELECT,INSERT,UPDATE,DELETE ON auth_passkeys,auth_passkey_challenges TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('021_account_completion');
