-- Early access requests from the public marketing site while trainer
-- registration is closed. Platform-scoped (no workspace), written and read
-- only by the service role: the public endpoint after its origin, rate and
-- bot checks, and the Super admin list, export and erasure.
CREATE TABLE early_access_requests (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120),
 email text NOT NULL CHECK(char_length(email) BETWEEN 3 AND 254),
 -- Lower-cased address: one request per person, later submissions update it.
 email_key text NOT NULL UNIQUE CHECK(email_key=lower(email_key)),
 instagram text NOT NULL DEFAULT '' CHECK(instagram ~ '^[a-z0-9._]{0,30}$'),
 specialty text NOT NULL DEFAULT '' CHECK(specialty ~ '^[a-z_]{0,32}$'),
 emirate text NOT NULL DEFAULT '' CHECK(emirate IN ('','abu_dhabi','dubai','sharjah','ajman','umm_al_quwain','ras_al_khaimah','fujairah','outside_uae')),
 followers integer CHECK(followers IS NULL OR followers BETWEEN 0 AND 10000000),
 -- The follower calculator result the visitor saw: stories, price, low, high, version.
 estimate jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(estimate)='object'),
 slug text NOT NULL DEFAULT '' CHECK(slug ~ '^([a-z][a-z0-9-]{2,39})?$'),
 -- Channel and campaign codes, only from a visitor who gave optional
 -- analytics permission (the acquisition consent record).
 visitor_id uuid,
 source text NOT NULL DEFAULT '' CHECK(source ~ '^[a-z0-9._ -]{0,80}$'),
 campaign text NOT NULL DEFAULT '' CHECK(campaign ~ '^[a-zA-Z0-9_-]{0,80}$'),
 medium text NOT NULL DEFAULT '' CHECK(medium ~ '^[a-z0-9._ -]{0,40}$'),
 consent_version text NOT NULL CHECK(char_length(consent_version) BETWEEN 1 AND 200),
 consented_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','invited','declined')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX early_access_requests_recent ON early_access_requests(created_at DESC,id DESC);
ALTER TABLE early_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE early_access_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY service_only ON early_access_requests USING (current_user<>'trainer_app') WITH CHECK (current_user<>'trainer_app');
REVOKE ALL ON early_access_requests FROM PUBLIC,trainer_app;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='trainer_service') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON early_access_requests TO trainer_service;
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES('067_early_access');
