-- Account self-service and sign-in. Identity, sign-in request, email change,
-- recovery grant and notice rows are account-level (not workspace) data and
-- are reachable only through the service connection, like sessions and
-- passkeys. Workspace exits are tenant data under row-level security.
CREATE TABLE account_identities (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 provider text NOT NULL CHECK(provider IN ('google','apple')),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 255),
 email text, email_verified boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz,
 UNIQUE(provider,subject), UNIQUE(user_id,provider)
);
CREATE TABLE oidc_sign_in_requests (
 id uuid PRIMARY KEY, state_hash text NOT NULL UNIQUE, binder_hash text NOT NULL,
 provider text NOT NULL CHECK(provider IN ('google','apple')),
 intent text NOT NULL CHECK(intent IN ('sign_in','join','invite','link')),
 status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','exchanging','mfa_pending','completed','failed')),
 user_id uuid REFERENCES users(id), session_hash text, tenant_id uuid REFERENCES tenants(id),
 payload jsonb NOT NULL DEFAULT '{}', attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oidc_sign_in_requests_binder ON oidc_sign_in_requests(binder_hash,status);
CREATE INDEX oidc_sign_in_requests_expiry ON oidc_sign_in_requests(expires_at);
CREATE TABLE email_change_requests (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
 old_email text NOT NULL, new_email text NOT NULL, token_hash text NOT NULL UNIQUE, origin text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz, cancelled_at timestamptz
);
-- At most one open request per account; a new request cancels the previous one.
CREATE UNIQUE INDEX email_change_open ON email_change_requests(user_id) WHERE completed_at IS NULL AND cancelled_at IS NULL;
CREATE TABLE account_recovery_grants (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), issued_by uuid NOT NULL REFERENCES users(id),
 token_hash text NOT NULL UNIQUE, reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500), origin text NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 consumed_at timestamptz, revoked_at timestamptz, CHECK(issued_by<>user_id)
);
CREATE INDEX account_recovery_grants_user ON account_recovery_grants(user_id,created_at);
CREATE INDEX account_recovery_grants_issuer ON account_recovery_grants(issued_by,created_at);
CREATE TABLE account_notices (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
);
CREATE INDEX account_notices_user ON account_notices(user_id,created_at DESC);
REVOKE ALL ON account_identities,oidc_sign_in_requests,email_change_requests,account_recovery_grants,account_notices FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON account_identities,oidc_sign_in_requests,email_change_requests,account_recovery_grants,account_notices TO trainer_service;
END IF; END $$;

-- A follower's exit from a workspace. The membership row is removed; this row
-- keeps the relationship evidence that retained billing and audit records
-- (and late provider events for a winding-down subscription) refer to.
CREATE TABLE membership_exits (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('left','removed')), actor_id uuid NOT NULL REFERENCES users(id),
 reason text CHECK(reason IS NULL OR length(reason)<=1000),
 subscription_action text NOT NULL CHECK(subscription_action IN ('none','renewal_cancelled','already_cancelled')),
 access_until timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX membership_exits_member ON membership_exits(tenant_id,user_id,created_at DESC);
CREATE TRIGGER membership_exits_immutable BEFORE UPDATE OR DELETE ON membership_exits FOR EACH ROW EXECUTE FUNCTION immutable_record();
ALTER TABLE membership_exits ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_exits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON membership_exits
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true) IN ('owner','staff','finance'))
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND current_setting('app.role',true) IN ('owner','staff','finance'));
REVOKE ALL ON membership_exits FROM PUBLIC;
GRANT SELECT,INSERT ON membership_exits TO trainer_app;
INSERT INTO schema_migrations(version) VALUES('054_account_self_service');
