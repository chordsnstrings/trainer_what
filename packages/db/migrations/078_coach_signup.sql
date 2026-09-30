-- Open coach sign-up and the setup wizard (owner decisions, 30 September 2026).
-- 1. Six-digit email codes for coach sign-up, sent through Resend. Only a
--    hash of the code is kept; five wrong tries or 15 minutes end a code.
--    Platform-scoped (no workspace exists yet); service role only.
CREATE TABLE coach_signup_codes (
 id uuid PRIMARY KEY,
 email text NOT NULL CHECK(char_length(email) BETWEEN 3 AND 254 AND email=lower(email)),
 code_hash text NOT NULL CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 100),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coach_signup_codes_email ON coach_signup_codes(email,created_at DESC);
ALTER TABLE coach_signup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_signup_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON coach_signup_codes USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON coach_signup_codes FROM PUBLIC,trainer_app;

-- 2. "Report this coach" from a public coach page, stored for the Super
--    admin (who can suspend the workspace). The reporter's email is optional;
--    the source is kept only as a salted hash for repeat limits.
CREATE TABLE coach_reports (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK(reason IN ('unsafe_advice','medical_claims','impersonation','offensive','scam','other')),
 details text NOT NULL DEFAULT '' CHECK(char_length(details)<=2000),
 reporter_email text NOT NULL DEFAULT '' CHECK(char_length(reporter_email)<=254),
 reporter_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 source_hash text NOT NULL DEFAULT '' CHECK(source_hash ~ '^([a-f0-9]{64})?$'),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','actioned')),
 review_note text NOT NULL DEFAULT '' CHECK(char_length(review_note)<=2000),
 reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coach_reports_recent ON coach_reports(status,created_at DESC,id DESC);
CREATE INDEX coach_reports_tenant ON coach_reports(tenant_id,created_at DESC);
ALTER TABLE coach_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_reports FORCE ROW LEVEL SECURITY;
-- Carries a workspace: a service transaction bound to one workspace sees only
-- its rows (the migration 061 pattern); the tenant role sees none.
CREATE POLICY service_workspace_scope ON coach_reports
 USING (current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR tenant_id=nullif(current_setting('app.service_tenant_id',true),'')::uuid))
 WITH CHECK (current_user<>'trainer_app' AND (nullif(current_setting('app.service_tenant_id',true),'') IS NULL OR tenant_id=nullif(current_setting('app.service_tenant_id',true),'')::uuid));
REVOKE ALL ON coach_reports FROM PUBLIC,trainer_app;

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE ON coach_signup_codes TO trainer_service;
 GRANT SELECT,INSERT,UPDATE ON coach_reports TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('078_coach_signup');
